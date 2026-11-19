import {
  MAP_SIZE, ZONE, QUALITY_LEVELS, WEAPONS, BOT_NAMES, BOT_TINTS,
  CHARACTER_MODELS, SKIN_TINTS, FX_PATHS, MODES, MAPS, clamp, rand, dist2,
} from './config.js';
import { World, makeMaterial, primitive } from './world.js';
import { Models } from './models.js';
import { GodotRandom } from './rng.js';
import { Api } from './api.js';
import { Session } from './session.js';

const forwardOf = (actor) => ({
  x: -Math.sin(actor.yaw) * Math.cos(actor.pitch),
  y: Math.sin(actor.pitch),
  z: -Math.cos(actor.yaw) * Math.cos(actor.pitch),
});

const rightOf = (actor) => ({ x: Math.cos(actor.yaw), y: 0, z: -Math.sin(actor.yaw) });

const resolveCharacter = (value) => (
  CHARACTER_MODELS[value] ? value : 'char_ch15'
);

const resolveTint = (value, fallback) => {
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3);
  if (SKIN_TINTS[value]) return SKIN_TINTS[value].slice();
  return fallback ? fallback.slice() : SKIN_TINTS.skin_recruit.slice();
};

const ONE_SHOT_ANIMS = new Set(['Fire', 'Reload', 'Hit', 'Grenade', 'Death', 'EnterCar', 'ExitCar', 'Jump']);

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
    this.models = new Models(app);
    this.ui = ui;
    this.net = net;
    this.avatarTasks = [];
    this.zoomed = false;
    this.cameraMode = 'tps';
    this.sensitivity = 6;
    this.sound = true;
    this.kickPitch = 0;
    this.kickYaw = 0;
    this.shake = 0;
    this.running = false;
    this.paused = false;
    this.over = false;
    this.actors = [];
    this.bots = [];
    this.remotes = new Map();
    this.remoteStates = new Map();
    this.loot = [];
    this.vehicles = [];
    this.tracers = [];
    this.grenades = [];
    this.effects = [];
    this.fxMaterials = new Map();
    this.materials = new Map();
    this.netInfo = {};
    this.lobbyState = null;
    this.startedAt = 0;
    this.matchRecorded = false;
    this.serverRecorded = false;
    this.lastResult = null;
    this.networkInterval = 0.1;
    this.keys = {};
    this.interactHeld = false;
    this.vehicleCooldownUntil = 0;
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.boundKey = null;
    this.boundKeyUp = null;
    this.boundMove = null;
    this.boundDown = null;
    this.boundUp = null;
    this.boundLock = null;
    this.installNetHooks();
  }

  applySettings(settings) {
    const detail = settings && typeof settings === 'object' ? settings : {};
    if (detail.camera === 'fps' || detail.camera === 'tps') {
      this.setCameraMode(detail.camera);
    }
    const value = Number(detail.sensitivity);
    if (Number.isFinite(value)) this.sensitivity = clamp(value, 1, 12);
    if (typeof detail.sound === 'boolean') {
      this.sound = detail.sound;
      if (this.assets && typeof this.assets.setEnabled === 'function') this.assets.setEnabled(detail.sound);
    }
    if (detail.quality && QUALITY_LEVELS[detail.quality]) {
      this.qualityName = detail.quality;
      if (!this.running) this.quality = QUALITY_LEVELS[detail.quality];
    }
    this.settings = { ...(this.settings || {}), ...detail };
  }

  setCameraMode(mode) {
    const next = mode === 'fps' ? 'fps' : 'tps';
    this.cameraMode = next;
    this.syncLocalVisibility();
  }

  setNetInfo(info) {
    const source = info && typeof info === 'object' ? info : {};
    this.netInfo = { ...this.netInfo, ...source };
    if (source.roomId || source.room) this.netInfo.roomId = source.roomId || source.room;
    return this.netInfo;
  }

  setLobbyState(state) {
    this.lobbyState = state && typeof state === 'object' ? state : null;
    if (!this.lobbyState) return;
    if (this.lobbyState.players) this.applyNetworkPlayers(this.lobbyState.players, this.lobbyState.zone);
  }

  syncLocalVisibility() {
    const player = this.player;
    if (!player || !player.entity) return;
    const hidden = this.cameraMode === 'fps' || player.driving || !player.alive;
    player.entity.enabled = !hidden;
    if (this.viewWeapon) this.viewWeapon.enabled = this.cameraMode === 'fps' && player.alive && !player.driving;
  }

  async start(selection, qualityName, layout) {
    this.stop();
    const equipped = typeof Session.equipped === 'function' ? Session.equipped() : {};
    const requested = selection && typeof selection === 'object' ? selection : {};
    this.selection = {
      ...requested,
      name: requested.name || (typeof Session.displayName === 'function' ? Session.displayName() : 'Combattant'),
      character: requested.character || equipped.character || null,
      skin: requested.skin || equipped.skin || 'skin_recruit',
      mode: requested.mode === 'training' ? 'training' : 'solo',
      map: MAPS[requested.map] ? requested.map : 'forest',
    };
    this.layout = layout;
    this.qualityName = QUALITY_LEVELS[qualityName] ? qualityName : (this.qualityName || 'low');
    this.quality = QUALITY_LEVELS[this.qualityName] || QUALITY_LEVELS.low;
    this.assets.setQuality(this.quality);
    this.mapDef = MAPS[this.selection.map];
    this.modeDef = MODES[this.selection.mode];
    this.group = new pc.Entity('actors');
    this.app.root.addChild(this.group);
    this.avatarTasks = [];
    this.zoomed = false;
    this.kickPitch = 0;
    this.kickYaw = 0;
    this.shake = 0;
    this.grenades = [];
    this.effects = [];
    this.remoteStates = new Map();
    this.matchRecorded = false;
    this.serverRecorded = false;
    this.lastResult = null;
    this.startedAt = Date.now();
    this.networkTimer = 0;
    this.lastWorldMessage = null;
    this.setNetInfo({
      roomId: this.selection.roomId || null,
      roomKey: this.selection.roomKey || null,
      mode: this.selection.mode,
      map: this.selection.map,
      name: this.selection.name,
    });
    this.applySettings(this.settings || {});

    this.world = new World(this.app, this.assets, this.models, layout, this.mapDef, this.quality);
    await this.world.build();

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(this.mapDef.sky[0], this.mapDef.sky[1], this.mapDef.sky[2]),
      fov: 68,
      nearClip: 0.08,
      farClip: Math.min(620, this.quality.fogEnd + 140),
    });
    this.app.root.addChild(this.camera);
    this.createViewWeapon();
    this.syncLocalVisibility();

    const spawnAngle = rand(0, Math.PI * 2);
    const spawnRadius = this.mapDef.biome === 'forest' ? 150 : 95;
    this.player = this.createActor({
      id: 'local', name: this.selection.name,
      tint: resolveTint(this.selection.skin, SKIN_TINTS.skin_recruit),
      character: resolveCharacter(this.selection.character),
      isPlayer: true,
      x: Math.cos(spawnAngle) * spawnRadius, y: 0, z: Math.sin(spawnAngle) * spawnRadius,
    });
    this.actors = [this.player];
    this.player.weapons = newWeaponState();
    this.syncLocalVisibility();

    this.spawnBots();
    await this.spawnLoot();
    await this.spawnVehicles();
    await Promise.all(this.avatarTasks);
    this.avatarTasks = [];
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
    if (this.pendingMatchStart) this.onMatchStart(this.pendingMatchStart);

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
    this.avatarTasks = [];
    this.actors = [];
    this.bots = [];
    this.remotes.clear();
    this.remoteStates.clear();
    this.loot = [];
    this.vehicles = [];
    this.tracers = [];
    this.grenades = [];
    this.effects = [];
    this.viewWeapon = null;
    this.player = null;
    this.paused = false;
    this.over = false;
    this.interactHeld = false;
    this.vehicleCooldownUntil = 0;
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
      animLock: 0,
      character: options.character || 'char_ch15',
    };
    actor.entity.setPosition(actor.pos.x, actor.pos.y, actor.pos.z);
    this.actors.push(actor);
    this.avatarTasks.push(this.upgradeAvatar(actor));
    return actor;
  }

  async upgradeAvatar(actor) {
    const character = resolveCharacter(actor.character);
    const url = CHARACTER_MODELS[character];
    const avatar = await this.models.createAvatar(url, actor.tint, actor.isBot ? 1.1 : 1.15);
    if (!this.actors.includes(actor)) {
      avatar.entity.destroy();
      return;
    }
    if (actor.entity && actor.entity.parent) actor.entity.destroy();
    const pivot = new pc.Entity('actor');
    this.group.addChild(pivot);
    pivot.addChild(avatar.entity);
    pivot.setPosition(actor.pos.x, actor.pos.y, actor.pos.z);
    pivot.setEulerAngles(0, actor.yaw * 180 / Math.PI, 0);
    actor.entity = pivot;
    actor.avatar = avatar;
    if (actor.isPlayer) this.syncLocalVisibility();
  }

  createViewWeapon() {
    if (!this.camera) return;
    const root = new pc.Entity('view-weapon');
    const bodyMaterial = this.materials.get('view-weapon')
      || (() => {
        const material = makeMaterial(this.app, { color: [0.13, 0.15, 0.16], specular: [0.12, 0.12, 0.12] });
        this.materials.set('view-weapon', material);
        return material;
      })();
    const parts = [
      { position: [0, 0, -0.34], scale: [0.075, 0.09, 0.62] },
      { position: [0, -0.13, 0.04], scale: [0.085, 0.22, 0.13] },
      { position: [0, 0.07, -0.55], scale: [0.035, 0.035, 0.24] },
    ];
    for (const part of parts) {
      const mesh = new pc.Entity('view-weapon-part');
      mesh.addComponent('render', { type: 'box', material: bodyMaterial, castShadows: false, receiveShadows: false });
      mesh.setLocalPosition(part.position[0], part.position[1], part.position[2]);
      mesh.setLocalScale(part.scale[0], part.scale[1], part.scale[2]);
      root.addChild(mesh);
    }
    root.setLocalPosition(0.3, -0.26, -0.42);
    this.camera.addChild(root);
    this.viewWeapon = root;
  }

  playActorAnim(actor, name, force) {
    if (!actor.avatar) return;
    if (actor.animLock > 0 && !ONE_SHOT_ANIMS.has(name)) return;
    actor.avatar.play(name, force);
  }

  lockAnim(actor, duration) {
    actor.animLock = Math.max(actor.animLock || 0, duration);
  }

  spawnBots() {
    const count = this.modeDef.id === 'training' ? 7 : 5;
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

  async spawnLoot() {
    const definitions = {
      ammo: { path: 'assets/models/equipment/ammo_box.gltf', scale: 2.2, y: 0.392, color: [0.9, 0.72, 0.25] },
      medkit: { path: 'assets/models/equipment/medkit.gltf', scale: 2, y: 0.43, color: [0.9, 0.25, 0.25] },
      armor: { path: 'assets/models/equipment/armor_vest.gltf', scale: 2, y: 0.15, color: [0.3, 0.64, 1] },
      grenade: { path: 'assets/polyhaven/stick_grenade/stick_grenade_1k.gltf', scale: 1.6, y: 0.47, color: [1, 0.55, 0.2] },
      weapon: { scale: 1, y: 0.55, color: [0.86, 0.9, 0.96] },
    };
    const spot = (type, x, z, weaponKey) => ({ type, x, z, weaponKey });
    const forestSpots = [
      spot('medkit', -18, -18), spot('armor', 16, 22), spot('ammo', 0, 44), spot('grenade', 28, -30),
      spot('medkit', -58, 32), spot('weapon', 34, 84, 'rifle'), spot('armor', 84, -62), spot('weapon', 140, 34, 'sniper'),
      spot('medkit', -108, -56), spot('weapon', 196, 136, 'pistol'), spot('ammo', -52, 47), spot('medkit', 34, 96),
      spot('grenade', 180, 120), spot('armor', -120, 8), spot('ammo', 120, 16), spot('weapon', 64, -236, 'rifle'),
      spot('medkit', 0, 160), spot('grenade', -160, -50), spot('armor', 150, 120), spot('weapon', -150, 112, 'pistol'),
      spot('ammo', 120, -130), spot('medkit', -20, 210), spot('grenade', 78, -70), spot('weapon', -60, 50, 'sniper'),
    ];
    const citySpots = [
      spot('medkit', 26, 26), spot('armor', -26, 26), spot('ammo', 26, -26), spot('grenade', -26, -26),
      spot('weapon', 54, 0, 'rifle'), spot('medkit', -54, 0), spot('weapon', 0, 54, 'sniper'), spot('armor', 0, -54),
      spot('weapon', 80, 80, 'pistol'), spot('ammo', -80, -80), spot('grenade', 80, -80), spot('medkit', -80, 80),
      spot('armor', 104, 0), spot('ammo', 0, 104), spot('medkit', -104, 0), spot('weapon', 0, -104, 'rifle'),
      spot('grenade', 78, 26), spot('medkit', 26, 78), spot('armor', -78, -26), spot('ammo', -26, -78),
      spot('weapon', 52, 52, 'pistol'), spot('weapon', -52, -52, 'sniper'), spot('medkit', 52, -52), spot('grenade', -52, 52),
    ];
    const limit = this.quality.exactLoot || 56;
    const spots = this.mapDef.biome === 'forest' ? forestSpots : citySpots;
    const fillLimit = Math.max(0, limit - spots.length);
    const fillTypes = ['ammo', 'medkit', 'armor', 'grenade', 'weapon', 'ammo', 'medkit', 'weapon', 'grenade', 'ammo'];
    const fillWeapons = ['rifle', 'pistol', 'sniper'];
    const fillRng = new GodotRandom(this.mapDef.biome === 'forest' ? 918273 : 627384);
    for (let added = 0, attempts = 0; added < fillLimit && attempts < fillLimit * 40; attempts += 1) {
      const x = fillRng.randfRange(-MAP_SIZE * 0.43, MAP_SIZE * 0.43);
      const z = fillRng.randfRange(-MAP_SIZE * 0.43, MAP_SIZE * 0.43);
      if (Math.hypot(x, z) < 18) continue;
      if (spots.some((entry) => Math.hypot(entry.x - x, entry.z - z) < 12)) continue;
      const type = fillTypes[fillRng.randi() % fillTypes.length];
      const weaponKey = type === 'weapon' ? fillWeapons[fillRng.randi() % fillWeapons.length] : undefined;
      spots.push(spot(type, x, z, weaponKey));
      added += 1;
    }
    const materials = new Map();
    for (const item of spots) {
      if (this.loot.length >= limit) break;
      const definition = definitions[item.type];
      if (!definition) continue;
      let material = materials.get(item.type);
      if (!material) {
        material = makeMaterial(this.app, {
          color: definition.color,
          emissive: definition.color.map((value) => value * 0.18),
        });
        materials.set(item.type, material);
      }
      const angle = rand(0, Math.PI * 2);
      let entity = null;
      if (item.type !== 'weapon') {
        entity = await this.models.instantiate(definition.path, { name: `loot-${item.type}` });
      }
      if (entity) {
        entity.setPosition(item.x, definition.y, item.z);
        entity.setLocalEulerAngles(0, angle * 180 / Math.PI, 0);
        entity.setLocalScale(definition.scale, definition.scale, definition.scale);
        this.group.addChild(entity);
      } else if (item.type === 'weapon') {
        entity = new pc.Entity(`loot-weapon-${item.weaponKey || 'rifle'}`);
        primitive(this.app, 'box', [0, 0, 0], [1.15, 0.18, 0.24], 0, material, entity);
        primitive(this.app, 'box', [0.72, 0.03, 0], [0.72, 0.1, 0.1], 0, material, entity);
        primitive(this.app, 'box', [-0.5, -0.13, 0], [0.34, 0.32, 0.15], 0, material, entity);
        entity.setPosition(item.x, definition.y, item.z);
        entity.setEulerAngles(0, angle * 180 / Math.PI, 0);
        this.group.addChild(entity);
      } else {
        entity = primitive(
          this.app,
          'box',
          [item.x, definition.y, item.z],
          [0.9 * definition.scale, 0.55 * definition.scale, 0.65 * definition.scale],
          angle,
          material,
          this.group,
        );
      }
      this.loot.push({
        id: `loot-${this.loot.length}`,
        type: item.type,
        weaponKey: item.weaponKey || null,
        x: item.x,
        z: item.z,
        entity,
      });
    }
  }

  async spawnVehicles() {
    const spots = this.mapDef.biome === 'forest'
      ? [[-52, 47], [34, 96], [180, 120]]
      : [[9, 14], [-22, -12], [78, 78]];
    for (const spot of spots) {
      const yaw = rand(0, Math.PI * 2);
      const entity = new pc.Entity('vehicle');
      const model = await this.models.instantiate('assets/models/vehicles/humvee.glb', { name: 'humvee' });
      if (model) {
        model.setLocalPosition(0, 0.02, 0);
        model.setLocalEulerAngles(0, 180, 0);
        model.setLocalScale(0.6, 0.6, 0.6);
        entity.addChild(model);
      } else {
        primitive(this.app, 'box', [0, 0.85, 0], [3.2, 1.7, 5], Math.PI, this.materials.get('vehicle') || makeMaterial(this.app, { color: [0.30, 0.36, 0.32] }), entity);
      }
      entity.setPosition(spot[0], 0, spot[1]);
      entity.setEulerAngles(0, yaw * 180 / Math.PI, 0);
      this.group.addChild(entity);
      this.vehicles.push({ x: spot[0], z: spot[1], yaw, entity, occupant: null });
      this.world.colliders.push({ x: spot[0], z: spot[1], r: 2.45, h: 1.9 });
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
      if (event.code === 'KeyE') { this.interactHeld = true; this.toggleVehicle(); }
      if (event.code === 'KeyV') this.toggleView();
      const slots = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
      if (slots[event.code] != null) this.selectWeapon(slots[event.code]);
    };
    this.boundKeyUp = (event) => {
      this.keys[event.code] = false;
      if (event.code === 'KeyE') this.interactHeld = false;
    };
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
    const next = this.cameraMode === 'fps' ? 'tps' : 'fps';
    this.setCameraMode(next);
    this.ui.feed(next === 'fps' ? 'Caméra à la première personne [V]' : 'Caméra à la troisième personne [V]');
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
    this.playActorAnim(player, 'Reload', true);
    this.lockAnim(player, 0.35);
    this.assets.play('weapons/reload', 0.4);
  }

  useMedkit() {
    const player = this.player;
    if (player.medkits <= 0 || player.hp >= 100) return;
    player.medkits -= 1;
    player.hp = Math.min(100, player.hp + 40);
    this.assets.play('player/heal', 0.5);
    this.ui.feed('+40 points de vie', '#3ddc84');
  }

  useGrenade() {
    const player = this.player;
    if (!player || !player.alive || player.grenades <= 0) return;
    player.grenades -= 1;
    this.playActorAnim(player, 'Grenade', true);
    this.lockAnim(player, 0.8);
    const view = {
      yaw: player.yaw + this.kickYaw,
      pitch: clamp(player.pitch + this.kickPitch, -1.35, 1.35),
    };
    const direction = forwardOf(view);
    direction.y += 0.22;
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    direction.x /= length; direction.y /= length; direction.z /= length;
    const origin = { x: player.pos.x, y: player.pos.y + 1.5, z: player.pos.z };
    let material = this.materials.get('grenade');
    if (!material) {
      material = makeMaterial(this.app, { color: [0.38, 0.42, 0.32], specular: [0.1, 0.1, 0.1] });
      this.materials.set('grenade', material);
    }
    const entity = primitive(
      this.app, 'capsule', [origin.x, origin.y, origin.z], [0.09, 0.3, 0.09], 0, material, this.group,
    );
    this.grenades.push({
      entity,
      pos: { ...origin },
      vel: { x: direction.x * 17, y: direction.y * 17, z: direction.z * 17 },
      timer: 1.6,
      owner: player,
    });
    this.spawnEffect('muzzle_flash', origin, 0.35, 0.07);
    this.assets.play('weapons/knife_swing', 0.35);
    if (this.net.online) {
      this.net.sendFire({ weapon: 'grenade', x: origin.x, y: origin.y, z: origin.z, dir: direction });
    }
    this.ui.feed('Grenade !', '#ffb14d');
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i -= 1) {
      const grenade = this.grenades[i];
      grenade.timer -= dt;
      grenade.vel.y -= 20 * dt;
      grenade.pos.x += grenade.vel.x * dt;
      grenade.pos.y += grenade.vel.y * dt;
      grenade.pos.z += grenade.vel.z * dt;
      if (grenade.pos.y <= 0.16) {
        grenade.pos.y = 0.16;
        grenade.vel.y = Math.abs(grenade.vel.y) * 0.32;
        grenade.vel.x *= 0.72;
        grenade.vel.z *= 0.72;
      }
      if (this.world) this.world.resolve(grenade.pos, 0.14);
      grenade.entity.setPosition(grenade.pos.x, grenade.pos.y, grenade.pos.z);
      grenade.entity.rotateLocal(220 * dt, 110 * dt, 0);
      if (grenade.timer <= 0) {
        this.explodeGrenade(grenade.pos, grenade.owner);
        grenade.entity.destroy();
        this.grenades.splice(i, 1);
      }
    }
  }

  explodeGrenade(center, owner) {
    const position = { x: center.x, y: Math.max(0.3, center.y), z: center.z };
    this.spawnEffect('impact_ring', position, 6.4, 0.45);
    this.spawnEffect('spark', position, 2.6, 0.28);
    for (let i = 0; i < 3; i += 1) {
      this.spawnEffect('smoke', {
        x: position.x + rand(-1.2, 1.2), y: position.y + rand(0.2, 1.2), z: position.z + rand(-1.2, 1.2),
      }, rand(1.2, 2.1), rand(0.7, 1.2));
    }
    this.assets.play('fx/explosion', 0.6);
    this.shake = Math.max(this.shake, 0.9);
    for (const actor of this.actors) {
      if (!actor.alive) continue;
      const distance = Math.hypot(actor.pos.x - position.x, (actor.pos.y + 1) - position.y, actor.pos.z - position.z);
      const amount = distance <= 4 ? 90 : distance <= 7.5 ? 45 : 0;
      if (amount) this.applyDamage(actor, amount, owner, { weapon: 'grenade' });
    }
  }

  toggleVehicle() {
    const player = this.player;
    if (!player || !player.alive || performance.now() < this.vehicleCooldownUntil) return;
    if (player.driving) {
      const vehicle = player.driving;
      const side = rightOf(vehicle);
      player.driving = null;
      vehicle.occupant = null;
      player.pos.x = vehicle.x + side.x * 5.2;
      player.pos.z = vehicle.z + side.z * 5.2;
      if (this.world) this.world.resolve(player.pos, 0.85);
      this.vehicleCooldownUntil = performance.now() + 350;
      this.syncLocalVisibility();
      this.playActorAnim(player, 'ExitCar', true);
      this.lockAnim(player, 0.9);
      this.ui.feed('À pied — E pour monter', '#4da3ff');
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
    player.pos.x = nearest.x;
    player.pos.z = nearest.z;
    this.vehicleCooldownUntil = performance.now() + 350;
    this.playActorAnim(player, 'EnterCar', true);
    this.lockAnim(player, 0.9);
    this.syncLocalVisibility();
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
    this.playActorAnim(actor, 'Fire', true);
    this.lockAnim(actor, 0.2);
    this.assets.play(weapon.sound, actor.isPlayer ? 0.55 : 0.18);

    const view = actor.isPlayer
      ? { yaw: actor.yaw + this.kickYaw, pitch: clamp(actor.pitch + this.kickPitch, -1.35, 1.35) }
      : actor;
    const direction = forwardOf(view);
    const spread = weapon.spread * (actor.aiming ? 0.35 : 1) * Math.PI / 180;
    direction.x += rand(-spread, spread);
    direction.y += rand(-spread, spread);
    direction.z += rand(-spread, spread);
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    direction.x /= length; direction.y /= length; direction.z /= length;

    const origin = { x: actor.pos.x, y: actor.pos.y + 1.45, z: actor.pos.z };
    let closest = this.world.raycast(origin, direction, weapon.range);
    let target = null;
    let headshot = false;
    for (const other of this.actors) {
      if (other === actor || !other.alive) continue;
      const center = { x: other.pos.x, z: other.pos.z };
      const headDistance = raySphere(origin, direction, { ...center, y: other.pos.y + 1.45 }, 0.28);
      const bodyDistance = raySphere(origin, direction, { ...center, y: other.pos.y + 1.15 }, 0.62);
      let distance = -1;
      let isHead = false;
      if (headDistance > 0 && bodyDistance > 0) {
        if (headDistance <= bodyDistance + 0.25) { distance = headDistance; isHead = true; } else distance = bodyDistance;
      } else if (headDistance > 0) {
        distance = headDistance; isHead = true;
      } else {
        distance = bodyDistance;
      }
      if (distance > 0 && distance < closest) {
        closest = distance;
        target = other;
        headshot = isHead;
      }
    }
    const end = {
      x: origin.x + direction.x * closest,
      y: origin.y + direction.y * closest,
      z: origin.z + direction.z * closest,
    };
    this.spawnTracer(origin, end);
    if (actor.isPlayer) {
      this.spawnEffect('muzzle_flash', {
        x: origin.x + Math.cos(actor.yaw) * 0.32,
        y: origin.y - 0.12,
        z: origin.z - Math.sin(actor.yaw) * 0.32,
      }, actor.aiming ? 0.34 : 0.48, 0.07);
      this.addRecoil(weapon, actor.aiming);
      if (this.net.online) this.net.sendFire({ weapon: weapon.key, x: origin.x, y: origin.y, z: origin.z, dir: direction });
    }
    if (target) {
      this.spawnEffect(target === this.player ? 'spark' : 'blood_particle', end, 0.7, 0.22);
      this.spawnEffect('spark', end, 0.45, 0.16);
      const damage = Math.max(1, Math.round(weapon.damage * (headshot && weapon.key !== 'knife' ? 1.75 : 1)));
      if (actor.isPlayer) this.ui.hitmarker(!target.alive || target.hp - damage <= 0);
      this.applyDamage(target, damage, actor, { weapon: weapon.key, headshot });
    } else {
      this.spawnEffect('impact_ring', end, 0.6, 0.18);
    }
  }

  addRecoil(weapon, aiming) {
    const scale = aiming ? 0.45 : 1;
    const strength = weapon.key === 'sniper' ? 0.055 : weapon.key === 'pistol' ? 0.024 : 0.017;
    this.kickPitch += strength * scale;
    this.kickYaw += rand(-0.4, 0.4) * strength * scale;
    this.shake = Math.max(this.shake, (weapon.key === 'sniper' ? 0.5 : 0.22) * scale);
  }

  spawnEffect(type, position, scale, duration) {
    const path = FX_PATHS[type];
    if (!path || !this.group) return;
    let material = this.fxMaterials.get(type);
    if (!material) {
      material = makeMaterial(this.app, {
        texture: this.assets.texture(path), color: [1, 1, 1], emissive: [0.35, 0.35, 0.35],
        unlit: true, opacity: 0.9,
      });
      this.fxMaterials.set(type, material);
    }
    const entity = primitive(this.app, 'plane', [position.x, position.y, position.z], [scale, 1, scale], 0, material, this.group);
    if (this.camera) {
      entity.lookAt(this.camera.getPosition());
      entity.rotateLocal(-90, 0, 0);
    }
    this.effects.push({ entity, timer: duration, life: duration, scale, kind: type });
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.timer -= dt;
      if (effect.timer <= 0) {
        effect.entity.destroy();
        this.effects.splice(i, 1);
        continue;
      }
      const ratio = effect.timer / effect.life;
      effect.entity.setLocalScale(effect.scale * (1 + (1 - ratio) * 0.6), 1, effect.scale * (1 + (1 - ratio) * 0.6));
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

  applyDamage(target, amount, attacker, meta) {
    if (!target || !target.alive || this.over) return;
    const info = meta || {};
    let damage = Math.max(1, Math.round(amount));
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, damage * 0.6);
      target.armor -= absorbed;
      damage -= absorbed;
    }
    target.hp -= damage;
    target.damageFlash = 1;
    this.playActorAnim(target, 'Hit', true);
    this.lockAnim(target, 0.28);
    if (attacker && attacker !== target) attacker.damage += damage;
    if (attacker === this.player && target !== this.player && this.net.online) {
      const weapon = info.weapon || WEAPONS[this.player.weaponIndex].key;
      this.net.sendHit({
        targetId: target.id, weapon, damage: Math.round(damage), headshot: !!info.headshot,
      });
    }
    if (target.isPlayer) this.assets.play('player/hurt', 0.5);
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(target, attacker) {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    this.playActorAnim(target, 'Death', true);
    if (target.isPlayer) this.syncLocalVisibility();
    const corpse = target.entity;
    setTimeout(() => { if (corpse && corpse.parent && !target.alive) corpse.enabled = false; }, 900);
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
    this.updateGrenades(dt);
    this.updateEffects(dt);
    this.updateRecoil(dt);
    this.updateCamera(dt);
    this.updateNetwork(dt);
    this.updateHUD();
  }

  updateLook() {
    const sensitivity = 0.0007 + clamp(this.sensitivity, 1, 12) * 0.00025;
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

  updateRecoil(dt) {
    const decay = Math.exp(-dt * 7);
    this.kickPitch *= decay;
    this.kickYaw *= decay;
    this.shake *= Math.exp(-dt * 9);
    if (Math.abs(this.kickPitch) < 0.00005) this.kickPitch = 0;
    if (Math.abs(this.kickYaw) < 0.00005) this.kickYaw = 0;
    if (this.shake < 0.001) this.shake = 0;
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
    player.animLock = Math.max(0, player.animLock - dt);
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
      this.playActorAnim(player, 'Driving');
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

    player.speed.y -= 20 * dt;
    player.pos.x += player.speed.x * dt;
    player.pos.y += player.speed.y * dt;
    player.pos.z += player.speed.z * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.speed.y = 0; player.grounded = true; }
    this.world.resolve(player.pos, 0.4);
    player.entity.setPosition(player.pos.x, player.pos.y, player.pos.z);
    player.entity.setEulerAngles(0, player.yaw * 180 / Math.PI, 0);

    const moving = Math.hypot(desiredX, desiredZ) > 0.1;
    let animation = 'RifleIdle';
    if (!player.grounded) {
      animation = player.speed.y > 0.5 ? 'Jump' : 'Falling';
    } else if (moving) {
      if (Math.abs(input.x) > Math.abs(input.z)) {
        animation = input.x > 0 ? 'StrafeRight' : 'StrafeLeft';
      } else if (input.z < 0) {
        animation = sprint ? 'RunBackward' : 'WalkBackward';
      } else {
        animation = crouch ? 'CrouchWalk' : sprint ? 'Run' : 'Walk';
      }
    } else if (player.weaponIndex !== 0) {
      animation = 'Idle';
    }
    this.playActorAnim(player, animation);

    const firing = this.mouse.left || (this.ui.isTouch && this.ui.touch.fire);
    const weapon = WEAPONS[player.weaponIndex];
    player.aiming = this.mouse.right || (this.ui.isTouch && this.ui.touch.aim);
    if (firing && (weapon.auto || !this.player.firedOnce)) {
      this.shoot(player);
      this.player.firedOnce = true;
    }
    if (!firing) this.player.firedOnce = false;
    const desiredFov = player.aiming ? weapon.zoomFov : 74;
    this.camera.camera.fov += (desiredFov - this.camera.camera.fov) * Math.min(1, dt * 10);
    if (this.viewWeapon) {
      const target = player.aiming ? -0.02 : 0.3;
      this.viewWeapon.setLocalPosition(target, player.aiming ? -0.17 : -0.26, -0.42);
    }
  }

  updateBots(dt) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      bot.animLock = Math.max(0, bot.animLock - dt);
      bot.shootTimer = Math.max(0, bot.shootTimer - dt);
      bot.reloadTimer = Math.max(0, bot.reloadTimer - dt);
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.thinkTimer = rand(0.8, 2.4);
        bot.waypoint = { x: rand(-160, 160), z: rand(-160, 160) };
      }
      const weapon = WEAPONS[bot.weaponIndex];
      const state = bot.weapons[bot.weaponIndex];
      if (weapon.key !== 'knife' && state.mag <= 0 && state.reserve > 0 && bot.reloadTimer <= 0) {
        bot.reloadTimer = weapon.reload;
        this.playActorAnim(bot, 'Reload', true);
        this.lockAnim(bot, 0.35);
        this.assets.play('weapons/reload', 0.18);
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
        if (!other.alive || other === bot) continue;
        const distance = dist2(bot.pos, other.pos);
        const range = other.isBot ? 55 : 95;
        if (distance < best && distance < range) { best = distance; target = other; }
      }
      if (target) {
        targetX = target.pos.x;
        targetZ = target.pos.z;
        const desiredYaw = Math.atan2(-(targetX - bot.pos.x), -(targetZ - bot.pos.z));
        bot.yaw = this.approachAngle(bot.yaw, desiredYaw, dt * 3.5);
        if (best < 70 && bot.shootTimer <= 0 && bot.reloadTimer <= 0) {
          bot.pitch = Math.atan2(1.15 - 1.45, Math.max(1, best));
          this.shoot(bot);
          bot.shootTimer = rand(0.55, 1.1);
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

      let animation = target ? 'RifleIdle' : 'Idle';
      if (distance > 8) {
        animation = 'Walk';
        if (target && best < 65) {
          const targetX = target.pos.x - bot.pos.x;
          const targetZ = target.pos.z - bot.pos.z;
          const targetLength = Math.hypot(targetX, targetZ) || 1;
          const rightX = -targetZ / targetLength;
          const rightZ = targetX / targetLength;
          const lateral = Math.abs((dx / distance) * rightX + (dz / distance) * rightZ);
          const toward = Math.abs((dx / distance) * (targetX / targetLength) + (dz / distance) * (targetZ / targetLength));
          animation = lateral > toward ? 'Strafe' : 'Run';
        }
      }
      this.playActorAnim(bot, animation);
    }
  }

  approachAngle(current, desired, maxStep) {
    let difference = (desired - current + Math.PI) % (Math.PI * 2);
    if (difference < 0) difference += Math.PI * 2;
    difference -= Math.PI;
    return current + clamp(difference, -maxStep, maxStep);
  }

  updateRemotes(dt) {
    if (this.net.online && !this.net.selfId) return;
    let states = this.remoteStates;
    if (!states.size && this.net.online && this.net.players && this.net.players.size) states = this.net.players;
    const selfId = this.net.selfId;
    const smoothing = 1 - Math.exp(-dt * 12);
    for (const [rawId, state] of states) {
      const id = String(rawId);
      if (!state || id === String(selfId)) continue;
      let actor = this.remotes.get(id);
      if (!actor) {
        actor = this.createActor({
          id,
          name: state.name || 'Combattant',
          tint: resolveTint(state.tint, BOT_TINTS[this.remotes.size % BOT_TINTS.length]),
          character: state.character || 'char_ch15',
          x: Number(state.x) || 0,
          y: Number(state.y) || 0,
          z: Number(state.z) || 0,
          yaw: Number(state.yaw) || 0,
        });
        this.remotes.set(id, actor);
      }
      actor.pos.x += ((Number(state.x) || 0) - actor.pos.x) * smoothing;
      actor.pos.z += ((Number(state.z) || 0) - actor.pos.z) * smoothing;
      actor.pos.y = Number(state.y) || 0;
      if (Number.isFinite(state.yaw)) actor.yaw = this.approachAngle(actor.yaw, state.yaw, dt * 8);
      actor.pitch = Number(state.pitch) || 0;
      actor.alive = state.alive !== false;
      actor.hp = state.hp == null ? actor.hp : state.hp;
      actor.entity.enabled = actor.alive;
      actor.entity.setPosition(actor.pos.x, actor.pos.y, actor.pos.z);
      actor.entity.setEulerAngles(0, actor.yaw * 180 / Math.PI, 0);
      this.playActorAnim(actor, actor.alive ? 'RifleIdle' : 'Death');
    }
    for (const [id, actor] of this.remotes) {
      if (!states.has(id) && !states.has(Number(id)) || id === String(selfId)) {
        actor.entity.destroy();
        this.actors = this.actors.filter((node) => node !== actor);
        this.remotes.delete(id);
      }
    }
    if (selfId && this.player && this.player.id !== selfId) this.player.id = selfId;
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
          this.applyDamage(actor, actor.isBot ? ZONE.botDamage : ZONE.damage, null, { weapon: 'zone' });
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
        for (const state of this.player.weapons) state.reserve += 60;
        this.ui.feed('+60 munitions par arme', '#ffcf5c');
      } else if (item.type === 'medkit') {
        this.player.hp = Math.min(100, this.player.hp + 40);
        this.ui.feed('+40 points de vie', '#3ddc84');
      } else if (item.type === 'armor') {
        this.player.armor = Math.min(100, this.player.armor + 50);
        this.ui.feed('+50 armure', '#4da3ff');
      } else if (item.type === 'grenade') {
        this.player.grenades += 1;
        this.ui.feed('+1 grenade [G]', '#ffb14d');
      } else if (item.type === 'weapon') {
        const index = WEAPONS.findIndex((weapon) => weapon.key === item.weaponKey);
        if (index >= 0) {
          const weapon = WEAPONS[index];
          const state = this.player.weapons[index];
          this.player.weaponIndex = index;
          this.player.reloadTimer = 0;
          state.mag = weapon.magSize;
          if (weapon.reserve) state.reserve = Math.max(state.reserve, weapon.reserve);
          this.ui.feed(`${weapon.name} récupéré`, '#d9e8ff');
        }
      }
      this.assets.play('ui/notify', 0.3);
      item.entity.destroy();
      this.loot.splice(i, 1);
    }
  }

  updateVehicles(dt) {
    const player = this.player;
    if (!player || !player.alive) {
      this.interactHeld = false;
      this.ui.showVehicleHint('');
      return;
    }
    const touchInteract = !!(this.ui.isTouch && this.ui.touch.interact);
    if (touchInteract && !this.interactHeld) this.toggleVehicle();
    this.interactHeld = touchInteract;
    if (player.driving) {
      this.ui.showVehicleHint('E / INTERAGIR — DESCENDRE DU HUMVEE');
      return;
    }
    let near = false;
    for (const vehicle of this.vehicles) {
      if (vehicle.occupant) continue;
      if (dist2(player.pos, vehicle) < 4.5) { near = true; break; }
    }
    this.ui.showVehicleHint(near ? 'E / INTERAGIR — MONTER À BORD DU HUMVEE' : '');
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
    if (!this.camera || !this.player) return;
    const player = this.player;
    const pitch = clamp(player.pitch + this.kickPitch, -1.35, 1.35);
    const yaw = player.yaw + this.kickYaw;
    const shakeX = this.shake ? rand(-this.shake, this.shake) * 0.08 : 0;
    const shakeY = this.shake ? rand(-this.shake, this.shake) * 0.08 : 0;
    const shakeZ = this.shake ? rand(-this.shake, this.shake) * 0.08 : 0;

    if (player.driving) {
      const vehicleYaw = player.driving.yaw;
      this.camera.setPosition(
        player.pos.x + Math.sin(vehicleYaw) * 7.6 + shakeX,
        3.15 + shakeY,
        player.pos.z + Math.cos(vehicleYaw) * 7.6 + shakeZ,
      );
      this.camera.camera.fov = this.zoomed ? 35 : 62;
      this.camera.setEulerAngles(-5, vehicleYaw * 180 / Math.PI, 0);
    } else if (this.cameraMode === 'fps') {
      this.camera.setPosition(
        player.pos.x + shakeX,
        player.pos.y + 1.62 + shakeY,
        player.pos.z + shakeZ,
      );
      this.camera.setEulerAngles(pitch * 180 / Math.PI, yaw * 180 / Math.PI, 0);
    } else {
      const forward = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y: Math.sin(pitch),
        z: -Math.cos(yaw) * Math.cos(pitch),
      };
      const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
      const shoulder = player.aiming ? 0.25 : 0.55;
      const pivot = {
        x: player.pos.x + right.x * shoulder,
        y: player.pos.y + 1.62,
        z: player.pos.z + right.z * shoulder,
      };
      const distance = player.aiming ? 1.85 : 3.1;
      let travel = distance;
      if (this.world) {
        const hit = this.world.raycast(pivot, { x: -forward.x, y: -forward.y, z: -forward.z }, distance);
        if (hit < distance) travel = Math.max(0.35, hit - 0.2);
      }
      this.camera.setPosition(
        pivot.x - forward.x * travel + shakeX,
        pivot.y - forward.y * travel + 0.22 + shakeY,
        pivot.z - forward.z * travel + shakeZ,
      );
      this.camera.lookAt(
        pivot.x + forward.x * 25,
        pivot.y + forward.y * 25 + 0.05,
        pivot.z + forward.z * 25,
      );
    }

    this.minimapTimer = (this.minimapTimer || 0) - dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.05;
      this.ui.minimap(
        this.layout,
        this.player,
        { x: 0, z: 0, radius: this.zoneRadius },
        Array.from(this.remotes.values()).concat(this.bots),
        { loot: this.loot, vehicles: this.vehicles, landmarks: this.world ? this.world.landmarks : [] },
      );
    }
  }

  updateNetwork(dt) {
    if (!this.net || !this.net.online || !this.player || !this.player.alive) return;
    this.networkTimer = (this.networkTimer || 0) - dt;
    if (this.networkTimer > 0) return;
    this.networkTimer = this.networkInterval;
    const state = {
      x: this.player.pos.x,
      y: this.player.pos.y,
      z: this.player.pos.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      hp: this.player.hp,
      alive: this.player.alive,
      name: this.player.name,
      tint: this.player.tint,
      character: resolveCharacter(this.player.character),
    };
    if (this.netInfo.roomId) state.roomId = this.netInfo.roomId;
    if (this.netInfo.mode) state.mode = this.netInfo.mode;
    if (this.netInfo.map) state.map = this.netInfo.map;
    if (typeof this.net.sendState === 'function') this.net.sendState(state);
    else this.net.send('state', state);
  }

  installNetHooks() {
    if (!this.net || !this.net.handlers || this.netHooksInstalled) return;
    this.netHooksInstalled = true;
    const handlers = this.net.handlers;
    const wrap = (name, callback) => {
      const original = handlers[name];
      handlers[name] = (...args) => {
        callback(...args);
        if (original) original(...args);
      };
    };
    wrap('onWorld', (message) => this.acceptWorldMessage(message));
    wrap('onSnapshot', (message) => this.acceptWorldMessage(message));
    const originalStart = handlers.onMatchStart;
    handlers.onMatchStart = (message) => {
      const result = originalStart ? originalStart(message) : null;
      Promise.resolve(result).then(() => this.onMatchStart(message));
    };
    wrap('onMatchEnd', (message) => this.onMatchEnd(message));
    wrap('onLobby', (message) => this.setLobbyState(message));
    wrap('onWelcome', (message) => this.setNetInfo(message));
  }

  acceptWorldMessage(message) {
    if (!message || message === this.lastWorldMessage) return;
    this.lastWorldMessage = message;
    this.applyNetworkPlayers(message.players, message.zone);
  }

  applyNetworkPlayers(players, zone) {
    let source = null;
    if (players instanceof Map) source = Array.from(players.values());
    else if (Array.isArray(players)) source = players;
    else if (players && typeof players === 'object') {
      source = Object.keys(players).map((key) => {
        const value = players[key] || {};
        return { ...value, id: value.id || key };
      });
    }
    if (source) {
      this.remoteStates = new Map();
      for (const state of source) {
        if (!state || !state.id) continue;
        this.remoteStates.set(String(state.id), state);
      }
    }
    if (zone) this.applyZoneState(zone);
  }

  applyZoneState(zone) {
    if (!zone || typeof zone !== 'object') return;
    if (Number.isFinite(zone.radius)) this.zoneRadius = zone.radius;
    if (Number.isFinite(zone.target)) this.zoneTarget = zone.target;
    if (Number.isFinite(zone.hold)) this.zoneHold = zone.hold;
    if (Number.isFinite(zone.phase)) this.zonePhase = zone.phase;
    this.zoneShrinking = !!zone.shrinking;
  }

  onMatchStart(data) {
    const message = data || {};
    this.setNetInfo(message);
    this.pendingMatchStart = message;
    this.lastWorldMessage = null;
    if (!this.player || !this.group || !this.running) return;
    this.pendingMatchStart = null;
    if (message.map && MAPS[message.map]) this.mapDef = MAPS[message.map];
    if (message.mode && MODES[message.mode]) {
      this.modeDef = MODES[message.mode];
      this.zoneEnabled = this.modeDef.zone;
    }
    this.applyNetworkPlayers(message.players, message.zone);
  }

  onMatchEnd(data) {
    const message = data || {};
    this.serverRecorded = true;
    this.setNetInfo(message);
    if (this.over) return;
    const results = Array.isArray(message.results) ? message.results : [];
    const self = results.find((entry) => String(entry.id) === String(this.player && this.player.id));
    const victory = !!self && self.placement === 1;
    const placement = self && self.placement ? self.placement : 99;
    const duration = Number(message.duration) || Math.floor((performance.now() - this.matchStart) / 1000);
    const board = results.map((entry) => ({
      name: entry.name || 'Combattant',
      placement: entry.placement || 0,
      kills: entry.kills || 0,
      self: String(entry.id) === String(this.player && this.player.id),
    })).sort((a, b) => a.placement - b.placement || b.kills - a.kills);
    const payload = {
      mode: MODES[message.mode] ? message.mode : (this.selection && this.selection.mode) || 'solo',
      map: MAPS[message.map] ? message.map : (this.selection && this.selection.map) || 'forest',
      winner: victory ? 'player' : 'bots',
      players: results.map((entry) => ({
        name: entry.name || 'Combattant',
        kills: entry.kills || 0,
        damage: Math.round(entry.damage || 0),
        placement: entry.placement || 0,
        isBot: false,
      })),
      startedAt: this.startedAt || Date.now() - duration * 1000,
    };
    if (!payload.players.length && this.player) {
      payload.players.push({
        name: this.player.name, kills: this.player.kills,
        damage: Math.round(this.player.damage), placement, isBot: false,
      });
    }
    this.lastResult = { payload, victory, placement, duration, server: true };
    this.showResults({
      victory,
      placement,
      kills: self ? self.kills || 0 : this.player ? this.player.kills : 0,
      damage: self ? Math.round(self.damage || 0) : this.player ? Math.round(this.player.damage) : 0,
      duration: this.formatTime(duration),
      map: MAPS[message.map] ? message.map : (this.selection && this.selection.map) || 'forest',
      mode: MODES[message.mode] ? message.mode : (this.selection && this.selection.mode) || 'solo',
      board: board.length ? board : (this.player ? [{
        name: this.player.name, placement, kills: this.player.kills, self: true,
      }] : []),
    }, victory);
    this.stop();
    this.over = true;
  }

  showResults(view, victory) {
    this.assets.play(victory ? 'battle-royale/victory' : 'battle-royale/defeat', 0.7);
    this.assets.startMusic('music/menu_theme');
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showHUD(false);
    this.ui.results(view);
  }

  onNetworkEvent(event, data) {
    const payload = data || {};
    if (event === 'worldState' || event === 'snapshot') {
      this.acceptWorldMessage(payload);
      return;
    }
    if (event === 'event') {
      const nested = payload.event || payload.type;
      if (nested) this.onNetworkEvent(nested, payload.data || payload);
      return;
    }
    if (event === 'hit') {
      const target = this.actors.find((actor) => String(actor.id) === String(payload.targetId));
      const hp = Number(payload.hp);
      const point = target
        ? { x: target.pos.x, y: target.pos.y + 1.4, z: target.pos.z }
        : { x: Number(payload.x) || 0, y: Number(payload.y) || 1.4, z: Number(payload.z) || 0 };
      this.spawnEffect('blood_particle', point, 0.7, 0.22);
      if (target && target !== this.player && Number.isFinite(hp)) target.hp = hp;
      if (target && target === this.player) {
        if (Number.isFinite(hp)) this.player.hp = hp;
        this.player.damageFlash = 1;
        this.assets.play('player/hurt', 0.5);
      }
      return;
    }
    if (event === 'shot') {
      const shooter = this.actors.find((actor) => String(actor.id) === String(payload.shooterId));
      const dir = payload.dir;
      if (dir && Number.isFinite(dir.x) && Number.isFinite(dir.y) && Number.isFinite(dir.z)) {
        const origin = Number.isFinite(payload.x)
          ? { x: payload.x, y: (Number(payload.y) || 0) + 1.45, z: payload.z }
          : { x: shooter ? shooter.pos.x : 0, y: shooter ? shooter.pos.y + 1.45 : 1.45, z: shooter ? shooter.pos.z : 0 };
        const length = Math.hypot(dir.x, dir.y, dir.z) || 1;
        this.spawnTracer(origin, {
          x: origin.x + dir.x / length * 60,
          y: origin.y + dir.y / length * 60,
          z: origin.z + dir.z / length * 60,
        });
      }
      return;
    }
    if (event === 'death' || event === 'kill') {
      const target = this.actors.find((actor) => String(actor.id) === String(payload.targetId));
      if (target && target !== this.player) {
        target.alive = false;
        target.hp = 0;
        this.playActorAnim(target, 'Death', true);
        const entity = target.entity;
        setTimeout(() => { if (entity && entity.parent) entity.enabled = false; }, 900);
      } else if (target === this.player) {
        this.player.alive = false;
        this.player.hp = 0;
        this.syncLocalVisibility();
      }
      if (payload.killer) this.ui.feed(`${payload.killer} → ${payload.victim || 'cible'}`, '#ff8a8a');
      return;
    }
    if (event === 'chat' || event === 'playerChat') {
      if (payload.name && payload.text) this.ui.feed(`${payload.name}: ${payload.text}`);
      return;
    }
    if (event === 'join' || event === 'playerJoined') {
      this.ui.feed(`${payload.name || 'Combattant'} a rejoint la partie`, '#4da3ff');
      return;
    }
    if (event === 'leave' || event === 'playerLeft' || event === 'playerDisconnected') {
      this.ui.feed(`${payload.name || 'Combattant'} a quitté la partie`);
      return;
    }
    if (event === 'zone') {
      this.applyZoneState(payload);
      this.ui.banner(payload.shrinking ? 'LA ZONE SE RESSERRE' : 'NOUVEAU CERCLE', 2.2);
      return;
    }
    if (event === 'matchEnd') this.onMatchEnd(payload);
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
    if (this.over || !this.player) return;
    this.over = true;
    const duration = Math.floor((performance.now() - this.matchStart) / 1000);
    const playerEntry = {
      name: this.player.name,
      kills: this.player.kills,
      damage: Math.round(this.player.damage),
      placement,
      isBot: false,
    };
    const bots = this.bots.map((bot) => ({
      name: bot.name,
      kills: bot.kills,
      damage: Math.round(bot.damage),
      placement: 0,
      isBot: true,
    })).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    let nextPlacement = 1;
    for (const bot of bots) {
      while (nextPlacement === placement) nextPlacement += 1;
      bot.placement = nextPlacement;
      nextPlacement += 1;
    }
    const ranked = [playerEntry, ...bots];
    const payload = {
      mode: this.selection.mode,
      map: this.selection.map,
      winner: victory ? 'player' : 'bots',
      players: ranked.map((entry) => ({ ...entry })),
      startedAt: this.startedAt || Date.now() - duration * 1000,
    };
    this.lastResult = { payload, victory, placement, duration };
    this.recordMatch(payload);
    this.showResults({
      victory,
      placement,
      kills: this.player.kills,
      damage: Math.round(this.player.damage),
      duration: this.formatTime(duration),
      map: this.selection.map,
      mode: this.selection.mode,
      board: ranked.map((entry) => ({
        name: entry.name, placement: entry.placement, kills: entry.kills, self: !entry.isBot,
      })).sort((a, b) => a.placement - b.placement || b.kills - a.kills),
    }, victory);
  }

  recordMatch(payload) {
    if (this.matchRecorded || this.serverRecorded) return;
    if (this.net && this.net.phase === 'finished') return;
    if (typeof Session.token !== 'function' || !Session.token()) return;
    this.matchRecorded = true;
    let request;
    try {
      request = Api.recordMatch(payload);
    } catch (error) {
      return;
    }
    Promise.resolve(request).then((response) => {
      if (!this.lastResult) return;
      this.lastResult.response = response;
      const data = response && response.data ? response.data : {};
      const rewards = data.rewards || data.reward || data.gains || {};
      const xp = Number(data.xp != null ? data.xp : rewards.xp);
      const credits = Number(data.credits != null ? data.credits : rewards.credits);
      let text = '';
      if (Number.isFinite(xp) && xp) text += `+${xp} XP`;
      if (Number.isFinite(credits) && credits) text += `${text ? ' · ' : ''}+${credits} crédits`;
      if (text && this.ui && typeof this.ui.toast === 'function') this.ui.toast(text, 3);
    }).catch(() => {});
  }
}
