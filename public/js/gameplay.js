import {
  MAP_SIZE, ZONE, QUALITY_LEVELS, WEAPONS, BOT_NAMES, BOT_TINTS,
  MODES, MAPS, clamp, rand, dist2,
} from './config.js';
import { World, makeMaterial, primitive } from './world.js';

const forwardOf = (actor) => ({
  x: -Math.sin(actor.yaw) * Math.cos(actor.pitch),
  y: Math.sin(actor.pitch),
  z: -Math.cos(actor.yaw) * Math.cos(actor.pitch),
});

const rightOf = (actor) => ({ x: Math.cos(actor.yaw), y: 0, z: -Math.sin(actor.yaw) });

function raySphere(origin, direction, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return -1;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  if (near >= 0) return near;
  const far = -b + root;
  return far >= 0 ? far : -1;
}

function makeActorVisual(app, parent, tint, materials) {
  const entity = new pc.Entity('actor');
  const bodyMaterial = materials.get(tint.join(',')) || (() => {
    const material = makeMaterial(app, { color: tint });
    materials.set(tint.join(','), material);
    return material;
  })();
  const body = new pc.Entity('body');
  body.addComponent('render', { type: 'capsule', material: bodyMaterial, castShadows: false });
  body.setLocalPosition(0, 0.9, 0);
  body.setLocalScale(0.78, 1.8, 0.78);
  entity.addChild(body);
  const head = new pc.Entity('head');
  head.addComponent('render', { type: 'sphere', material: materials.get('head') || makeMaterial(app, { color: [0.76, 0.62, 0.50] }), castShadows: false });
  if (!materials.has('head')) materials.set('head', head.render.material);
  head.setLocalPosition(0, 1.78, 0);
  head.setLocalScale(0.48, 0.48, 0.48);
  entity.addChild(head);
  const gun = new pc.Entity('gun');
  gun.addComponent('render', { type: 'box', material: materials.get('gun') || makeMaterial(app, { color: [0.11, 0.12, 0.13] }), castShadows: false });
  if (!materials.has('gun')) materials.set('gun', gun.render.material);
  gun.setLocalPosition(0.34, 1.28, -0.45);
  gun.setLocalScale(0.12, 0.12, 0.8);
  entity.addChild(gun);
  parent.addChild(entity);
  return entity;
}

function newWeaponState() {
  return WEAPONS.map((weapon) => ({ mag: weapon.magSize, reserve: weapon.reserve }));
}

export class Game {
  constructor(app, assets, ui, net) {
    this.app = app;
    this.assets = assets;
    this.ui = ui;
    this.net = net;
    this.running = false;
    this.paused = false;
    this.over = false;
    this.actors = [];
    this.bots = [];
    this.remotes = new Map();
    this.loot = [];
    this.vehicles = [];
    this.tracers = [];
    this.materials = new Map();
    this.keys = {};
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.boundKey = null;
    this.boundKeyUp = null;
    this.boundMove = null;
    this.boundDown = null;
    this.boundUp = null;
    this.boundLock = null;
  }

  start(selection, qualityName, layout) {
    this.stop();
    this.selection = selection;
    this.layout = layout;
    this.quality = QUALITY_LEVELS[qualityName];
    this.mapDef = MAPS[selection.map];
    this.modeDef = MODES[selection.mode];
    this.group = new pc.Entity('actors');
    this.app.root.addChild(this.group);

    this.world = new World(this.app, this.assets, layout, this.mapDef, this.quality);
    this.world.build();

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(this.mapDef.sky[0], this.mapDef.sky[1], this.mapDef.sky[2]),
      fov: 74,
      nearClip: 0.08,
      farClip: 620,
    });
    this.app.root.addChild(this.camera);

    const spawnAngle = rand(0, Math.PI * 2);
    const spawnRadius = this.mapDef.biome === 'forest' ? 150 : 95;
    this.player = this.createActor({
      id: 'local', name: selection.name, tint: [0.95, 0.72, 0.32], isPlayer: true,
      x: Math.cos(spawnAngle) * spawnRadius, y: 0, z: Math.sin(spawnAngle) * spawnRadius,
    });
    this.actors = [this.player];
    this.player.weapons = newWeaponState();

    this.spawnBots();
    this.spawnLoot();
    this.spawnVehicles();
    this.bindInput();

    this.zoneEnabled = this.modeDef.zone;
    this.zoneRadius = this.mapDef.biome === 'forest' ? ZONE.initial : ZONE.cityInitial;
    this.zoneInitial = this.zoneRadius;
    this.zoneTarget = this.zoneRadius;
    this.zoneHold = ZONE.hold;
    this.zonePhase = 0;
    this.zoneTimer = 0;
    this.zoneText = '';
    this.zoneDanger = false;
    this.world.setZone(this.zoneRadius, 0, 0);

    this.matchStart = performance.now();
    this.elapsed = 0;
    this.paused = false;
    this.over = false;
    this.running = true;
    this.lastFeedVehicle = false;
    this.app.on('update', this.update, this);

    this.ui.showHUD(true);
    this.ui.screen(null);
    this.ui.banner('DÉPLOIEMENT — DERNIER COMBATTANT DEBOUT', 3);
    this.assets.startMusic('music/battle_theme');
    this.assets.play('ui/notify', 0.45);
  }

  stop() {
    if (this.running) {
      this.app.off('update', this.update, this);
      this.running = false;
    }
    this.unbindInput();
    if (this.group) { this.group.destroy(); this.group = null; }
    if (this.camera) { this.camera.destroy(); this.camera = null; }
    if (this.world) { this.world.destroy(); this.world = null; }
    this.actors = [];
    this.bots = [];
    this.remotes.clear();
    this.loot = [];
    this.vehicles = [];
    this.tracers = [];
    this.paused = false;
    this.over = false;
    this.ui.showHUD(false);
  }

  createActor(options) {
    const actor = {
      id: options.id,
      name: options.name,
      tint: options.tint,
      isPlayer: !!options.isPlayer,
      isBot: !!options.isBot,
      alive: true,
      hp: 100,
      armor: 0,
      kills: 0,
      damage: 0,
      pos: { x: options.x, y: options.y || 0, z: options.z },
      yaw: options.yaw || 0,
      pitch: 0,
      speed: { x: 0, y: 0, z: 0 },
      grounded: true,
      weaponIndex: 0,
      weapons: newWeaponState(),
      medkits: 1,
      grenades: 2,
      shootTimer: 0,
      reloadTimer: 0,
      damageFlash: 0,
      aiming: false,
      driving: null,
      waypoint: { x: rand(-120, 120), z: rand(-120, 120) },
      thinkTimer: rand(0.2, 1),
      entity: makeActorVisual(this.app, this.group, options.tint, this.materials),
    };
    actor.entity.setPosition(actor.pos.x, actor.pos.y, actor.pos.z);
    this.actors.push(actor);
    return actor;
  }

  spawnBots() {
    const count = this.quality.bots;
    for (let i = 0; i < count; i += 1) {
      let x = 0;
      let z = 0;
      let tries = 0;
      do {
        const angle = rand(0, Math.PI * 2);
        const radius = this.mapDef.biome === 'forest' ? 150 : 95;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        tries += 1;
      } while (dist2({ x, z }, this.player.pos) < 16 && tries < 40);
      const bot = this.createActor({
        id: `bot-${i}`, name: BOT_NAMES[i % BOT_NAMES.length], tint: BOT_TINTS[i % BOT_TINTS.length],
        isBot: true, x, z, yaw: rand(0, Math.PI * 2),
      });
      bot.weaponIndex = i % 3;
      this.bots.push(bot);
    }
  }

  spawnLoot() {
    const definitions = [
      { type: 'ammo', color: [0.9, 0.72, 0.25], count: 7 },
      { type: 'medkit', color: [0.9, 0.25, 0.25], count: 6 },
      { type: 'armor', color: [0.3, 0.64, 1], count: 4 },
      { type: 'grenade', color: [1, 0.55, 0.2], count: 4 },
    ];
    for (const definition of definitions) {
      const material = makeMaterial(this.app, { color: definition.color, emissive: definition.color.map((v) => v * 0.15) });
      for (let i = 0; i < definition.count; i += 1) {
        const angle = rand(0, Math.PI * 2);
        const radius = rand(18, 160);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const entity = primitive(this.app, 'box', [x, 0.4, z], [0.9, 0.55, 0.65], angle, material, this.group);
        this.loot.push({ id: `loot-${this.loot.length}`, type: definition.type, x, z, entity });
      }
    }
  }

  spawnVehicles() {
    const material = makeMaterial(this.app, { color: [0.30, 0.36, 0.32] });
    const spots = this.mapDef.biome === 'forest'
      ? [[-52, 47], [34, 96]]
      : [[9, 14], [-22, -12]];
    for (const spot of spots) {
      const entity = primitive(this.app, 'box', [spot[0], 0.85, spot[1]], [4.2, 1.7, 2.2], rand(0, Math.PI * 2), material, this.group);
      this.vehicles.push({ x: spot[0], z: spot[1], yaw: entity.getLocalEulerAngles().y * Math.PI / 180, entity, occupant: null });
    }
  }

  bindInput() {
    this.boundKey = (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      this.keys[event.code] = true;
      if (event.repeat) return;
      if (event.code === 'Escape') this.togglePause();
      if (event.code === 'KeyR') this.reload();
      if (event.code === 'KeyQ') this.useMedkit();
      if (event.code === 'KeyG') this.useGrenade();
      if (event.code === 'KeyE') this.toggleVehicle();
      if (event.code === 'KeyV') this.toggleView();
      const slots = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
      if (slots[event.code] != null) this.selectWeapon(slots[event.code]);
    };
    this.boundKeyUp = (event) => { this.keys[event.code] = false; };
    this.boundMove = (event) => {
      if (document.pointerLockElement !== this.app.graphicsDevice.canvas) return;
      this.mouse.dx += event.movementX;
      this.mouse.dy += event.movementY;
    };
    this.boundDown = (event) => {
      const canvas = this.app.graphicsDevice.canvas;
      if (document.pointerLockElement !== canvas) {
        if (canvas.requestPointerLock) {
          const lockPromise = canvas.requestPointerLock();
          if (lockPromise && lockPromise.catch) lockPromise.catch(() => {});
        }
        return;
      }
      if (event.button === 0) this.mouse.left = true;
      if (event.button === 2) this.mouse.right = true;
    };
    this.boundUp = (event) => {
      if (event.button === 0) this.mouse.left = false;
      if (event.button === 2) this.mouse.right = false;
    };
    this.boundLock = () => {
      if (document.pointerLockElement !== this.app.graphicsDevice.canvas && this.paused === false && this.running && !this.over && !this.ui.isTouch) {
        this.pause();
      }
    };
    window.addEventListener('keydown', this.boundKey);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousemove', this.boundMove);
    window.addEventListener('mousedown', this.boundDown);
    window.addEventListener('mouseup', this.boundUp);
    document.addEventListener('pointerlockchange', this.boundLock);
    this.preventContext = (event) => event.preventDefault();
    this.app.graphicsDevice.canvas.addEventListener('contextmenu', this.preventContext);
  }

  unbindInput() {
    if (!this.boundKey) return;
    window.removeEventListener('keydown', this.boundKey);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousemove', this.boundMove);
    window.removeEventListener('mousedown', this.boundDown);
    window.removeEventListener('mouseup', this.boundUp);
    document.removeEventListener('pointerlockchange', this.boundLock);
    if (this.preventContext) this.app.graphicsDevice.canvas.removeEventListener('contextmenu', this.preventContext);
    if (document.pointerLockElement) document.exitPointerLock();
    this.boundKey = null;
  }

  togglePause() {
    if (!this.running || this.over) return;
    if (this.paused) this.resume(); else this.pause();
  }

  pause() {
    this.paused = true;
    this.ui.screen('pause');
    this.ui.showHUD(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    this.paused = false;
    this.ui.screen(null);
    this.ui.showHUD(true);
  }

  toggleView() {
    const camera = this.camera.camera;
    camera.fov = camera.fov > 60 ? 35 : 74;
  }

  selectWeapon(index) {
    if (index < 0 || index >= WEAPONS.length || index === this.player.weaponIndex) return;
    this.player.weaponIndex = index;
    this.player.reloadTimer = 0;
    this.assets.play('ui/click', 0.35);
  }

  reload() {
    const player = this.player;
    const state = player.weapons[player.weaponIndex];
    const weapon = WEAPONS[player.weaponIndex];
    if (player.reloadTimer > 0 || state.mag >= weapon.magSize || state.reserve <= 0) return;
    player.reloadTimer = weapon.reload;
    this.assets.play('weapons/reload', 0.4);
  }

  useMedkit() {
    const player = this.player;
    if (player.medkits <= 0 || player.hp >= 100) return;
    player.medkits -= 1;
    player.hp = Math.min(100, player.hp + 55);
    this.assets.play('player/heal', 0.5);
    this.ui.feed('+55 points de vie', '#3ddc84');
  }

  useGrenade() {
    const player = this.player;
    if (player.grenades <= 0) return;
    player.grenades -= 1;
    const direction = forwardOf(player);
    const origin = { x: player.pos.x, y: player.pos.y + 1.5, z: player.pos.z };
    const center = {
      x: origin.x + direction.x * 22,
      y: 0.5,
      z: origin.z + direction.z * 22,
    };
    let material = this.materials.get('grenade');
    if (!material) {
      material = makeMaterial(this.app, { color: [1, 0.5, 0.15], emissive: [1, 0.3, 0.05], opacity: 0.5 });
      this.materials.set('grenade', material);
    }
    const blast = primitive(this.app, 'sphere', [center.x, 1, center.z], [5, 5, 5], 0, material, this.group);
    setTimeout(() => blast.destroy(), 260);
    for (const actor of this.actors) {
      if (!actor.alive) continue;
      const distance = Math.hypot(actor.pos.x - center.x, actor.pos.z - center.z);
      if (distance < 8) this.applyDamage(actor, Math.round(90 * (1 - distance / 8)), player);
    }
    this.ui.feed('Grenade !', '#ffb14d');
  }

  toggleVehicle() {
    const player = this.player;
    if (player.driving) {
      const vehicle = player.driving;
      player.driving = null;
      vehicle.occupant = null;
      player.pos.x = vehicle.x + 3;
      player.pos.z = vehicle.z + 2;
      player.entity.enabled = true;
      this.ui.feed('À pied');
      return;
    }
    let nearest = null;
    let best = 4.5;
    for (const vehicle of this.vehicles) {
      const distance = dist2(player.pos, vehicle);
      if (distance < best) { best = distance; nearest = vehicle; }
    }
    if (!nearest) return;
    nearest.occupant = player;
    player.driving = nearest;
    player.entity.enabled = false;
    this.ui.feed('Humvee — ZQSD rouler, E descendre', '#ffcf5c');
  }

  shoot(actor) {
    if (actor.shootTimer > 0 || actor.reloadTimer > 0) return;
    const weapon = WEAPONS[actor.weaponIndex];
    const state = actor.weapons[actor.weaponIndex];
    if (weapon.key !== 'knife' && state.mag <= 0) {
      actor.shootTimer = 0.25;
      this.assets.play('weapons/empty_click', 0.35);
      return;
    }
    actor.shootTimer = 60 / weapon.rpm;
    if (weapon.key !== 'knife') state.mag -= 1;
    this.assets.play(weapon.sound, actor.isPlayer ? 0.55 : 0.18);

    const direction = forwardOf(actor);
    const spread = weapon.spread * Math.PI / 180;
    direction.x += rand(-spread, spread);
    direction.y += rand(-spread, spread);
    direction.z += rand(-spread, spread);
    const length = Math.hypot(direction.x, direction.y, direction.z);
    direction.x /= length; direction.y /= length; direction.z /= length;

    const origin = { x: actor.pos.x, y: actor.pos.y + 1.45, z: actor.pos.z };
    let closest = this.world.raycast(origin, direction, weapon.range);
    let target = null;
    for (const other of this.actors) {
      if (other === actor || !other.alive) continue;
      const distance = raySphere(origin, direction, { x: other.pos.x, y: other.pos.y + 1.15, z: other.pos.z }, 0.62);
      if (distance > 0 && distance < closest) { closest = distance; target = other; }
    }
    const end = {
      x: origin.x + direction.x * closest,
      y: origin.y + direction.y * closest,
      z: origin.z + direction.z * closest,
    };
    this.spawnTracer(origin, end);

    if (!target) return;
    const damage = weapon.damage;
    if (actor.isPlayer && target.isBot) {
      this.applyDamage(target, damage, actor);
      this.ui.hitmarker(target.hp <= 0);
      if (this.net.online) {
        this.net.send('shot', { targetId: target.id, damage, weapon: weapon.key });
      }
    } else if (actor.isPlayer && !target.isBot && this.net.online) {
      this.net.send('shot', { targetId: target.id, damage, weapon: weapon.key });
    } else if (actor.isBot && target.isPlayer) {
      this.applyDamage(target, damage, actor);
    }
  }

  spawnTracer(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.5) return;
    let material = this.materials.get('tracer');
    if (!material) {
      material = makeMaterial(this.app, { color: [1, 0.8, 0.4], emissive: [1, 0.55, 0.1], unlit: true, opacity: 0.8 });
      this.materials.set('tracer', material);
    }
    const entity = primitive(this.app, 'box', [
      (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2,
    ], [0.045, 0.045, length], 0, material, this.group);
    entity.lookAt(to.x, to.y, to.z);
    this.tracers.push({ entity, timer: 0.07 });
  }

  applyDamage(target, amount, attacker) {
    if (!target.alive || this.over) return;
    let damage = Math.max(1, Math.round(amount));
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, damage * 0.5);
      target.armor -= absorbed;
      damage -= absorbed;
    }
    target.hp -= damage;
    target.damageFlash = 1;
    if (attacker) attacker.damage += damage;
    if (target.isPlayer) this.assets.play('player/hurt', 0.5);
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(target, attacker) {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.entity.enabled = false;
    if (attacker && attacker !== target) attacker.kills += 1;
    if (attacker && attacker.isPlayer) {
      this.ui.feed(`Vous avez éliminé ${target.name}`, '#ffcf5c');
      this.assets.play('battle-royale/elimination', 0.5);
      this.ui.hitmarker(true);
    } else {
      this.ui.feed(`${target.name} — éliminé`, '#ff8a8a');
    }
    const remaining = this.actors.filter((actor) => actor.alive && !actor.isPlayer && !actor.isBot).length
      + this.bots.filter((bot) => bot.alive).length;
    if (target.isPlayer) {
      this.endMatch(false, remaining + 1);
    } else if (remaining === 0) {
      this.endMatch(true, 1);
    }
  }

  update(dt) {
    if (!this.running) return;
    this.ui.tick(dt);
    if (this.paused || this.over) {
      this.updateCamera(dt);
      return;
    }
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;
    this.updateLook();
    this.updatePlayer(dt);
    this.updateBots(dt);
    this.updateRemotes(dt);
    this.updateZone(dt);
    this.updateLoot(dt);
    this.updateVehicles(dt);
    this.updateTracers(dt);
    this.updateCamera(dt);
    this.updateNetwork(dt);
    this.updateHUD();
  }

  updateLook() {
    const sensitivity = 0.0022;
    const player = this.player;
    const touch = this.ui.touch;
    if (!this.ui.isTouch) {
      player.yaw -= this.mouse.dx * sensitivity;
      player.pitch -= this.mouse.dy * sensitivity;
      this.mouse.dx = 0;
      this.mouse.dy = 0;
    } else {
      player.yaw -= touch.lookX;
      player.pitch -= touch.lookY;
      touch.lookX = 0;
      touch.lookY = 0;
    }
    player.pitch = clamp(player.pitch, -1.35, 1.35);
  }

  movementInput() {
    const keys = this.keys;
    const touch = this.ui.touch;
    let x = 0;
    let z = 0;
    if (keys.KeyW || keys.ArrowUp) z += 1;
    if (keys.KeyS || keys.ArrowDown) z -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (this.ui.isTouch) {
      x += touch.moveX;
      z -= touch.moveY;
    }
    const length = Math.hypot(x, z);
    if (length > 1) { x /= length; z /= length; }
    return { x, z };
  }

  updatePlayer(dt) {
    const player = this.player;
    if (!player.alive) return;
    player.shootTimer = Math.max(0, player.shootTimer - dt);
    player.damageFlash = Math.max(0, player.damageFlash - dt * 1.8);
    if (player.reloadTimer > 0) {
      player.reloadTimer -= dt;
      if (player.reloadTimer <= 0) {
        const state = player.weapons[player.weaponIndex];
        const weapon = WEAPONS[player.weaponIndex];
        const needed = weapon.magSize - state.mag;
        const taken = Math.min(needed, state.reserve);
        state.mag += taken;
        state.reserve -= taken;
      }
    }

    if (player.driving) {
      const input = this.movementInput();
      const vehicle = player.driving;
      vehicle.yaw -= input.x * dt * 1.8;
      const speed = 17 * input.z;
      vehicle.x += -Math.sin(vehicle.yaw) * speed * dt;
      vehicle.z += -Math.cos(vehicle.yaw) * speed * dt;
      this.world.resolve(vehicle, 2.2);
      vehicle.entity.setPosition(vehicle.x, 0.85, vehicle.z);
      vehicle.entity.setEulerAngles(0, vehicle.yaw * 180 / Math.PI, 0);
      player.pos.x = vehicle.x + Math.cos(vehicle.yaw) * -0.5;
      player.pos.y = 1.1;
      player.pos.z = vehicle.z - Math.sin(vehicle.yaw) * -0.5;
      player.yaw = vehicle.yaw;
      player.pitch = 0;
      if (this.ui.isTouch && this.ui.touch.interact) this.toggleVehicle();
      return;
    }

    const input = this.movementInput();
    const forward = forwardOf(player);
    const right = rightOf(player);
    const sprint = this.keys.ShiftLeft || this.keys.ShiftRight || (this.ui.isTouch && false);
    const crouch = this.keys.ControlLeft || this.keys.KeyC;
    const speed = crouch ? 2.6 : sprint ? 9 : 5.6;
    const desiredX = forward.x * input.z + right.x * input.x;
    const desiredZ = forward.z * input.z + right.z * input.x;
    const smoothing = 1 - Math.exp(-dt * 12);
    player.speed.x += (desiredX * speed - player.speed.x) * smoothing;
    player.speed.z += (desiredZ * speed - player.speed.z) * smoothing;

    if ((this.keys.Space || (this.ui.isTouch && this.ui.touch.jump)) && player.grounded) {
      player.speed.y = 7;
      player.grounded = false;
      this.assets.play('player/jump', 0.3);
    }
    if (this.ui.isTouch && this.ui.touch.reload) this.reload();
    if (this.ui.isTouch && this.ui.touch.medkit) this.useMedkit();
    if (this.ui.isTouch && this.ui.touch.grenade) this.useGrenade();
    if (this.ui.isTouch && this.ui.touch.weapon) this.selectWeapon((player.weaponIndex + 1) % WEAPONS.length);
    if (this.ui.isTouch && this.ui.touch.interact) this.toggleVehicle();

    player.speed.y -= 20 * dt;
    player.pos.x += player.speed.x * dt;
    player.pos.y += player.speed.y * dt;
    player.pos.z += player.speed.z * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.speed.y = 0; player.grounded = true; }
    this.world.resolve(player.pos, 0.4);
    player.entity.setPosition(player.pos.x, player.pos.y, player.pos.z);
    player.entity.setEulerAngles(0, player.yaw * 180 / Math.PI, 0);

    const firing = this.mouse.left || (this.ui.isTouch && this.ui.touch.fire);
    const weapon = WEAPONS[player.weaponIndex];
    player.aiming = this.mouse.right || (this.ui.isTouch && this.ui.touch.aim);
    if (firing && (weapon.auto || !this.player.firedOnce)) {
      this.shoot(player);
      this.player.firedOnce = true;
    }
    if (!firing) this.player.firedOnce = false;
    this.camera.camera.fov += ((player.aiming ? weapon.zoomFov : 74) - this.camera.camera.fov) * Math.min(1, dt * 10);
  }

  updateBots(dt) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      bot.shootTimer = Math.max(0, bot.shootTimer - dt);
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.thinkTimer = rand(0.8, 2.4);
        bot.waypoint = { x: rand(-160, 160), z: rand(-160, 160) };
      }
      let targetX = bot.waypoint.x;
      let targetZ = bot.waypoint.z;
      if (this.zoneEnabled && Math.hypot(bot.pos.x, bot.pos.z) > this.zoneRadius - 12) {
        targetX = 0;
        targetZ = 0;
      }
      let target = null;
      let best = 95;
      for (const other of this.actors) {
        if (!other.alive || other === bot || other.isBot) continue;
        const distance = dist2(bot.pos, other.pos);
        if (distance < best) { best = distance; target = other; }
      }
      if (target) {
        targetX = target.pos.x;
        targetZ = target.pos.z;
        const desiredYaw = Math.atan2(-(targetX - bot.pos.x), -(targetZ - bot.pos.z));
        bot.yaw = this.approachAngle(bot.yaw, desiredYaw, dt * 3.5);
        if (best < 65 && bot.shootTimer <= 0) {
          bot.shootTimer = rand(0.6, 1.4);
          bot.pitch = Math.atan2(1.1 - 1.25, best) * 0.2;
          this.shoot(bot);
        }
      } else {
        const desiredYaw = Math.atan2(-(targetX - bot.pos.x), -(targetZ - bot.pos.z));
        bot.yaw = this.approachAngle(bot.yaw, desiredYaw, dt * 1.4);
      }
      const step = 3.2 * dt;
      const dx = targetX - bot.pos.x;
      const dz = targetZ - bot.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 8) {
        bot.pos.x += (dx / distance) * step;
        bot.pos.z += (dz / distance) * step;
      }
      this.world.resolve(bot.pos, 0.4);
      bot.pos.y = 0;
      bot.entity.setPosition(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.entity.setEulerAngles(0, bot.yaw * 180 / Math.PI, 0);
    }
  }

  approachAngle(current, desired, maxStep) {
    let difference = (desired - current + Math.PI) % (Math.PI * 2);
    if (difference < 0) difference += Math.PI * 2;
    difference -= Math.PI;
    return current + clamp(difference, -maxStep, maxStep);
  }

  updateRemotes(dt) {
    for (const [id, state] of this.net.players) {
      if (id === this.net.selfId || !state) continue;
      let actor = this.remotes.get(id);
      if (!actor) {
        actor = this.createActor({
          id, name: state.name || 'Combattant', tint: state.tint || [0.5, 0.6, 0.8],
          x: state.x || 0, z: state.z || 0, yaw: state.yaw || 0,
        });
        this.remotes.set(id, actor);
      }
      actor.pos.x += ((state.x || 0) - actor.pos.x) * Math.min(1, dt * 12);
      actor.pos.z += ((state.z || 0) - actor.pos.z) * Math.min(1, dt * 12);
      actor.yaw = state.yaw || actor.yaw;
      actor.pitch = state.pitch || 0;
      actor.alive = state.alive !== false;
      actor.hp = state.hp == null ? actor.hp : state.hp;
      actor.entity.enabled = actor.alive;
      actor.entity.setPosition(actor.pos.x, 0, actor.pos.z);
      actor.entity.setEulerAngles(0, actor.yaw * 180 / Math.PI, 0);
    }
    for (const [id, actor] of this.remotes) {
      if (!this.net.players.has(id) || id === this.net.selfId) {
        actor.entity.destroy();
        this.actors = this.actors.filter((node) => node !== actor);
        this.remotes.delete(id);
      }
    }
    if (this.net.selfId && this.player.id !== this.net.selfId) this.player.id = this.net.selfId;
  }

  updateZone(dt) {
    if (!this.zoneEnabled) {
      this.zoneText = 'MODE LIBRE — PAS DE ZONE';
      this.zoneDanger = false;
      return;
    }
    if (this.net.online && this.net.zone && this.net.zone.radius > 0) {
      this.zoneRadius = this.net.zone.radius;
      this.zoneTarget = this.net.zone.target || this.zoneRadius;
      this.zoneText = this.net.zone.shrinking
        ? 'LA ZONE SE RESSERRE…'
        : `ZONE SE RESSERRE DANS ${this.formatTime(this.net.zone.hold || 0)}`;
    } else {
      if (this.zoneTarget < this.zoneRadius) {
        this.zoneRadius = Math.max(this.zoneTarget, this.zoneRadius - this.zoneInitial * ZONE.shrink * dt);
        if (this.zoneRadius - this.zoneTarget < 0.5) {
          this.zonePhase += 1;
          this.zoneTarget = Math.max(ZONE.min, this.zoneTarget * ZONE.factor);
          this.zoneHold = ZONE.stepHold + this.zonePhase * 6;
          this.ui.banner('LA ZONE SE RESSERRE', 2.4);
        }
        this.zoneText = 'LA ZONE SE RESSERRE…';
      } else {
        this.zoneHold -= dt;
        if (this.zoneHold <= 0) this.zoneTarget = Math.max(ZONE.min, this.zoneRadius * ZONE.factor);
        this.zoneText = `ZONE SE RESSERRE DANS ${this.formatTime(this.zoneHold)}`;
      }
    }
    this.world.setZone(this.zoneRadius, 0, 0);

    this.zoneTimer += dt;
    if (this.zoneTimer >= 1) {
      this.zoneTimer = 0;
      for (const actor of this.actors) {
        if (!actor.alive) continue;
        if (Math.hypot(actor.pos.x, actor.pos.z) > this.zoneRadius) {
          if (actor.isPlayer || actor.isBot) this.applyDamage(actor, ZONE.damage, null);
        }
      }
    }
    this.zoneDanger = this.player.alive && Math.hypot(this.player.pos.x, this.player.pos.z) > this.zoneRadius;
    if (this.zoneDanger) this.zoneText = 'RENTRER DANS LA ZONE !';
  }

  formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  updateLoot(dt) {
    for (let i = this.loot.length - 1; i >= 0; i -= 1) {
      const item = this.loot[i];
      item.entity.rotateLocal(0, dt * 90, 0);
      if (!this.player.alive) continue;
      if (dist2(this.player.pos, item) > 1.9) continue;
      if (item.type === 'ammo') {
        for (const state of this.player.weapons) state.reserve += 40;
        this.ui.feed('+40 munitions par arme', '#ffcf5c');
      } else if (item.type === 'medkit') {
        this.player.medkits += 1;
        this.ui.feed('+1 trousse de soin [Q]', '#3ddc84');
      } else if (item.type === 'armor') {
        this.player.armor = Math.min(100, this.player.armor + 50);
        this.ui.feed('+50 armure', '#4da3ff');
      } else if (item.type === 'grenade') {
        this.player.grenades += 1;
        this.ui.feed('+1 grenade [G]', '#ffb14d');
      }
      this.assets.play('ui/notify', 0.3);
      item.entity.destroy();
      this.loot.splice(i, 1);
    }
  }

  updateVehicles(dt) {
    for (const vehicle of this.vehicles) {
      if (vehicle.occupant) continue;
      if (!this.player.alive || this.player.driving) continue;
      if (dist2(this.player.pos, vehicle) < 4.5) {
        this.ui.showVehicleHint('E — MONTER À BORD DU HUMVEE');
        if (this.keys.KeyE || (this.ui.isTouch && this.ui.touch.interact)) this.toggleVehicle();
      }
    }
    if (!this.player.driving && !(this.player.alive && this.vehicles.some((v) => !v.occupant && dist2(this.player.pos, v) < 4.5))) {
      this.ui.showVehicleHint('');
    }
  }

  updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      this.tracers[i].timer -= dt;
      if (this.tracers[i].timer <= 0) {
        this.tracers[i].entity.destroy();
        this.tracers.splice(i, 1);
      }
    }
  }

  updateCamera(dt) {
    if (!this.camera) return;
    const player = this.player;
    if (!player) return;
    if (player.driving) {
      this.camera.setPosition(player.pos.x, 2.6, player.pos.z);
      this.camera.setEulerAngles(-5, player.yaw * 180 / Math.PI, 0);
      return;
    }
    const height = player.pos.y + 1.62;
    this.camera.setPosition(player.pos.x, height, player.pos.z);
    this.camera.setEulerAngles(player.pitch * 180 / Math.PI, player.yaw * 180 / Math.PI, 0);
    this.minimapTimer = (this.minimapTimer || 0) - dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      this.ui.minimap(this.layout, this.player, { x: 0, z: 0, radius: this.zoneRadius }, this.remotes.size ? Array.from(this.remotes.values()) : this.bots);
    }
  }

  updateNetwork(dt) {
    if (!this.net.online || !this.player.alive) return;
    this.networkTimer = (this.networkTimer || 0) - dt;
    if (this.networkTimer > 0) return;
    this.networkTimer = this.quality.networkRate;
    this.net.send('state', {
      x: this.player.pos.x,
      y: this.player.pos.y,
      z: this.player.pos.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      hp: this.player.hp,
      alive: this.player.alive,
      name: this.player.name,
      tint: this.player.tint,
    });
  }

  onNetworkEvent(event, data) {
    if (event === 'hit') {
      const target = this.actors.find((actor) => actor.id === data.targetId);
      if (target && target !== this.player) this.applyDamage(target, data.damage, null);
      if (data.targetId === this.player.id) this.applyDamage(this.player, data.damage, null);
    } else if (event === 'shot') {
      const actor = this.actors.find((node) => node.id === data.shooterId);
      if (actor && data.dir) {
        this.spawnTracer(
          { x: actor.pos.x, y: actor.pos.y + 1.45, z: actor.pos.z },
          { x: actor.pos.x + data.dir.x * 60, y: actor.pos.y + 1.45 + data.dir.y * 60, z: actor.pos.z + data.dir.z * 60 },
        );
      }
    } else if (event === 'chat') {
      this.ui.feed(`${data.name}: ${data.text}`);
    } else if (event === 'join') {
      this.ui.feed(`${data.name} a rejoint la partie`, '#4da3ff');
    } else if (event === 'leave') {
      this.ui.feed(`${data.name} a quitté la partie`);
    }
  }

  updateHUD() {
    const player = this.player;
    const weapon = WEAPONS[player.weaponIndex];
    const state = player.weapons[player.weaponIndex];
    const aliveBots = this.bots.filter((bot) => bot.alive).length;
    const aliveRemotes = Array.from(this.remotes.values()).filter((actor) => actor.alive).length;
    const vehicle = this.vehicles.find((node) => !node.occupant && dist2(player.pos, node) < 4.5);
    this.ui.updateHUD({
      hp: player.hp,
      armor: player.armor,
      weaponName: weapon.name,
      weaponKey: weapon.key,
      mag: state.mag,
      reserve: state.reserve,
      kills: player.kills,
      alive: (player.alive ? 1 : 0) + aliveBots + aliveRemotes,
      medkits: player.medkits,
      grenades: player.grenades,
      aiming: player.aiming,
      damageFlash: player.damageFlash,
      zoneEnabled: this.zoneEnabled,
      zoneText: this.zoneText,
      zoneDanger: this.zoneDanger,
      vehicleHint: this.ui.pendingVehicleHint || '',
    });
  }

  showVehicleHint(text) { this.ui.pendingVehicleHint = text; }

  endMatch(victory, placement) {
    if (this.over) return;
    this.over = true;
    const duration = Math.floor((performance.now() - this.matchStart) / 1000);
    this.assets.play(victory ? 'battle-royale/victory' : 'battle-royale/defeat', 0.7);
    this.assets.startMusic('music/menu_theme');
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showHUD(false);
    this.ui.results({
      victory,
      placement,
      kills: this.player.kills,
      damage: Math.round(this.player.damage),
      duration: this.formatTime(duration),
      map: this.selection.map,
      mode: this.selection.mode,
      board: this.actors
        .filter((actor) => actor.id !== 'local')
        .map((actor) => ({ name: actor.name, placement: actor.alive ? 1 : 2, kills: actor.kills, self: false }))
        .concat([{ name: this.player.name, placement, kills: this.player.kills, self: true }])
        .sort((a, b) => a.placement - b.placement || b.kills - a.kills),
    });
  }
}
