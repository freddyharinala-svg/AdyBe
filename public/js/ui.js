import { MAPS, MODES, clamp } from './config.js';

const byId = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.selection = {
      name: localStorage.getItem('adybe.name') || 'Combattant',
      map: 'forest',
      mode: 'solo',
      quality: 'auto',
    };
    this.touch = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0,
      fire: false, aim: false, jump: false, reload: false,
      medkit: false, grenade: false, interact: false, weapon: false,
    };
    this.feedLines = [];
    this.bannerTimer = 0;
    this.hitTimer = 0;
    this.isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
    this.bind();
    if (this.isTouch) document.body.classList.add('touch');
  }

  bind() {
    byId('input-name').value = this.selection.name;
    byId('input-name').addEventListener('change', (event) => {
      this.selection.name = event.target.value.trim().slice(0, 16) || 'Combattant';
      localStorage.setItem('adybe.name', this.selection.name);
    });

    document.querySelectorAll('#map-choices .choice').forEach((button) => {
      button.addEventListener('click', () => {
        this.selection.map = button.dataset.map;
        document.querySelectorAll('#map-choices .choice').forEach((node) => node.classList.toggle('selected', node === button));
        const map = MAPS[this.selection.map];
        byId('plan-image').src = map.minimap;
        byId('plan-desc').textContent = map.desc;
        this.handlers.onSound && this.handlers.onSound('ui/click');
      });
    });

    document.querySelectorAll('#mode-choices .chip').forEach((button) => {
      button.addEventListener('click', () => {
        this.selection.mode = button.dataset.mode;
        document.querySelectorAll('#mode-choices .chip').forEach((node) => node.classList.toggle('selected', node === button));
        this.handlers.onSound && this.handlers.onSound('ui/click');
      });
    });

    byId('select-quality').addEventListener('change', (event) => {
      this.selection.quality = event.target.value;
    });

    byId('btn-play').addEventListener('click', () => {
      this.selection.name = byId('input-name').value.trim().slice(0, 16) || 'Combattant';
      localStorage.setItem('adybe.name', this.selection.name);
      this.handlers.onPlay && this.handlers.onPlay(Object.assign({}, this.selection));
    });
    byId('btn-resume').addEventListener('click', () => this.handlers.onResume && this.handlers.onResume());
    byId('btn-abandon').addEventListener('click', () => this.handlers.onAbandon && this.handlers.onAbandon());
    byId('btn-replay').addEventListener('click', () => this.handlers.onReplay && this.handlers.onReplay());
    byId('btn-menu').addEventListener('click', () => this.handlers.onMenu && this.handlers.onMenu());
    byId('btn-pause-mobile').addEventListener('click', () => this.handlers.onPause && this.handlers.onPause());
    byId('chk-sound').addEventListener('change', (event) => this.handlers.onSoundToggle && this.handlers.onSoundToggle(event.target.checked));

    this.bindTouch();
  }

  bindTouch() {
    if (!this.isTouch) return;
    byId('touch-controls').classList.remove('hidden');
    byId('btn-pause-mobile').classList.remove('hidden');

    const stick = byId('stick');
    const knob = byId('stick-knob');
    let stickId = null;
    const moveStick = (event) => {
      const rect = stick.getBoundingClientRect();
      let x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      let y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      this.touch.moveX = x;
      this.touch.moveY = y;
      knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`;
    };
    stick.addEventListener('pointerdown', (event) => {
      stickId = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      moveStick(event);
    });
    stick.addEventListener('pointermove', (event) => { if (event.pointerId === stickId) moveStick(event); });
    const endStick = (event) => {
      if (event.pointerId !== stickId) return;
      stickId = null;
      this.touch.moveX = 0;
      this.touch.moveY = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    const pad = byId('look-pad');
    let lookId = null;
    let lastX = 0;
    let lastY = 0;
    pad.addEventListener('pointerdown', (event) => {
      lookId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      pad.setPointerCapture(event.pointerId);
    });
    pad.addEventListener('pointermove', (event) => {
      if (event.pointerId !== lookId) return;
      this.touch.lookX += (event.clientX - lastX) * 0.004;
      this.touch.lookY += (event.clientY - lastY) * 0.004;
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const endLook = (event) => { if (event.pointerId === lookId) lookId = null; };
    pad.addEventListener('pointerup', endLook);
    pad.addEventListener('pointercancel', endLook);

    document.querySelectorAll('.tbtn').forEach((button) => {
      const action = button.dataset.action;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.touch[action] = true;
        if (action !== 'fire' && action !== 'aim') {
          setTimeout(() => { this.touch[action] = false; }, 60);
        }
      });
      button.addEventListener('pointerup', () => {
        if (action === 'fire' || action === 'aim') this.touch[action] = false;
      });
      button.addEventListener('pointercancel', () => { this.touch[action] = false; });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  screen(name) {
    document.querySelectorAll('.screen').forEach((node) => node.classList.remove('active'));
    if (name) byId(`screen-${name}`).classList.add('active');
  }

  showHUD(visible) {
    byId('hud').classList.toggle('hidden', !visible);
    byId('touch-controls').classList.toggle('hidden', !(visible && this.isTouch));
  }

  showVehicleHint(text) {
    this.pendingVehicleHint = text || '';
  }

  setNet(online, text) {
    const badge = byId('net-status');
    badge.textContent = text;
    badge.classList.toggle('badge-on', online);
    badge.classList.toggle('badge-off', !online);
  }

  setFps(fps) { byId('fps-status').textContent = `${fps} FPS`; }
  setVersion(version) { byId('version-status').textContent = version; }

  updateHUD(state) {
    const hp = clamp(Math.round(state.hp), 0, 100);
    byId('hud-hp').textContent = String(hp);
    byId('hud-hp-fill').style.width = `${hp}%`;
    byId('hud-hp-fill').style.background = hp <= 25 ? '#ff4d4d' : hp <= 60 ? '#ffcf5c' : '#3ddc84';
    byId('hud-armor-fill').style.width = `${clamp(state.armor, 0, 100)}%`;
    byId('hud-weapon').textContent = state.weaponName;
    byId('hud-ammo').textContent = state.weaponKey === 'knife' ? '—' : `${state.mag} / ${state.reserve}`;
    byId('hud-kills').textContent = `ÉLIMINATIONS ${state.kills}`;
    byId('hud-alive').textContent = `VIVANTS ${state.alive}`;
    byId('hud-medkits').textContent = String(state.medkits);
    byId('hud-grenades').textContent = String(state.grenades);
    byId('hud-crosshair').style.visibility = state.aiming ? 'hidden' : 'visible';
    byId('hud-vignette').style.opacity = String(clamp(state.damageFlash || 0, 0, 1));

    const zone = byId('hud-zone');
    if (!state.zoneEnabled) {
      zone.textContent = 'MODE LIBRE — PAS DE ZONE';
      zone.classList.remove('danger');
    } else {
      zone.textContent = state.zoneText;
      zone.classList.toggle('danger', state.zoneDanger);
    }

    const hint = byId('hud-vehicle');
    hint.textContent = state.vehicleHint || '';
    hint.classList.toggle('hidden', !state.vehicleHint);
  }

  feed(text, color) {
    const line = document.createElement('div');
    line.textContent = text;
    if (color) line.style.borderLeftColor = color;
    const box = byId('hud-feed');
    box.insertBefore(line, box.firstChild);
    this.feedLines.push(line);
    setTimeout(() => {
      line.remove();
      this.feedLines = this.feedLines.filter((node) => node !== line);
    }, 4200);
    while (box.children.length > 5) box.removeChild(box.lastChild);
  }

  banner(text, seconds) {
    const node = byId('hud-banner');
    node.textContent = text;
    node.classList.remove('hidden');
    this.bannerTimer = seconds;
  }

  hitmarker(killed) {
    const node = byId('hud-hitmarker');
    node.textContent = killed ? '×' : '·';
    node.style.color = killed ? '#ffcf5c' : '#f2f5f8';
    node.classList.remove('hidden');
    this.hitTimer = 0.32;
  }

  toast(text, seconds) {
    const node = byId('toast');
    node.textContent = text;
    node.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => node.classList.add('hidden'), (seconds || 2.5) * 1000);
  }

  tick(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) byId('hud-banner').classList.add('hidden');
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) byId('hud-hitmarker').classList.add('hidden');
    }
  }

  results(data) {
    const title = byId('results-title');
    title.textContent = data.victory ? 'VICTOIRE !' : 'DÉFAITE';
    title.classList.toggle('win', data.victory);
    title.classList.toggle('lose', !data.victory);
    byId('results-stats').textContent =
      `Éliminations : ${data.kills}    ·    Dégâts : ${data.damage}    ·    Placement : #${data.placement}\n` +
      `Durée : ${data.duration}    ·    ${MAPS[data.map].name} · ${MODES[data.mode].name}`;
    const board = byId('results-board');
    board.innerHTML = '';
    data.board.forEach((entry) => {
      const row = document.createElement('div');
      row.classList.toggle('self', entry.self);
      row.innerHTML = `<span>#${entry.placement} ${entry.name}</span><span>${entry.kills} élim.</span>`;
      board.appendChild(row);
    });
    this.screen('results');
  }

  minimap(layout, player, zone, others) {
    const canvas = byId('minimap');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const half = 400;
    const project = (x, z) => [(x + half) / (half * 2) * size, (z + half) / (half * 2) * size];
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#11150f';
    ctx.fillRect(0, 0, size, size);
    if (!layout) return;

    ctx.strokeStyle = 'rgba(190,175,130,.5)';
    for (const road of layout.roads || []) {
      ctx.beginPath();
      road.points.forEach((point, index) => {
        const [x, y] = project(point[0], point[1]);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.lineWidth = Math.max(1, (road.width || 5) / (half * 2) * size);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(160,140,100,.35)';
    for (const town of layout.towns || []) {
      const [x, y] = project(town.x, town.z);
      ctx.beginPath();
      ctx.arc(x, y, town.radius / (half * 2) * size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(70,120,70,.55)';
    for (const grove of layout.groves || []) {
      const [x, y] = project(grove.x, grove.z);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    if (zone) {
      const [zx, zy] = project(zone.x || 0, zone.z || 0);
      ctx.strokeStyle = '#ff7a3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(zx, zy, zone.radius / (half * 2) * size, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const other of others || []) {
      if (!other.alive) continue;
      const [x, y] = project(other.x, other.z);
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (player) {
      const [x, y] = project(player.x, player.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-(player.yaw || 0));
      ctx.fillStyle = '#3ddc84';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
