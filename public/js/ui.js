import { MAPS, MODES, WORLD_SIZE, clamp, VERSION } from './config.js';
import { Settings } from './settings.js';
import { Session } from './session.js';

const byId = (id) => document.getElementById(id);
const setText = (id, text) => {
  const node = byId(id);
  if (node) node.textContent = text == null ? '' : String(text);
};
const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const on = (id, event, handler) => {
  const node = byId(id);
  if (node) node.addEventListener(event, handler);
};
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const minimapImages = new Map();
const getMinimapImage = (src) => {
  if (!src) return null;
  if (!minimapImages.has(src)) {
    const image = new Image();
    image.src = src;
    minimapImages.set(src, image);
  }
  const image = minimapImages.get(src);
  return image.complete && image.naturalWidth ? image : null;
};

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
    this.hudRefs = null;
    this.lastHud = {};
    this.minimapStatic = null;
    this.minimapStaticKey = '';
    this.bannerTimer = 0;
    this.hitTimer = 0;
    this.shopItems = [];
    this.shopState = {};
    this.shopFilter = 'all';
    this.lobbyChat = [];
    this.authTab = 'login';
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

    this.bindAccount();
    this.bindTouch();
  }

  bindAccount() {
    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', () => {
        this.handlers.onSound && this.handlers.onSound('ui/click');
        this.handlers.onMenu && this.handlers.onMenu();
        this.screen('menu');
      });
    });

    const nav = {
      'btn-auth': 'onAuth', 'btn-shop': 'onShop', 'btn-profile': 'onProfile',
      'btn-ranking': 'onRanking', 'btn-settings': 'onSettings',
      'btn-rooms': 'onRooms', 'btn-admin': 'onAdmin', 'btn-logout': 'onLogout',
    };
    Object.keys(nav).forEach((id) => {
      on(id, 'click', () => {
        this.handlers.onSound && this.handlers.onSound('ui/click');
        const handler = this.handlers[nav[id]];
        if (handler) handler();
      });
    });

    on('tab-login', 'click', () => this.setAuthTab('login'));
    on('tab-register', 'click', () => this.setAuthTab('register'));
    on('btn-login', 'click', () => {
      const username = (byId('auth-login-username').value || '').trim();
      const password = byId('auth-login-password').value || '';
      if (!username || !password) {
        this.setAuthMessage('Identifiant et mot de passe requis.', true);
        return;
      }
      if (this.handlers.onLogin) this.handlers.onLogin({ username, password });
    });
    on('btn-register', 'click', () => {
      const username = (byId('auth-reg-username').value || '').trim();
      const displayName = (byId('auth-reg-display').value || '').trim();
      const email = (byId('auth-reg-email').value || '').trim();
      const password = byId('auth-reg-password').value || '';
      if (username.length < 3) {
        this.setAuthMessage("L'identifiant doit faire au moins 3 caractères.", true);
        return;
      }
      if (password.length < 6) {
        this.setAuthMessage('Le mot de passe doit contenir au moins 6 caractères.', true);
        return;
      }
      if (this.handlers.onRegister) this.handlers.onRegister({ username, displayName, email, password });
    });
    on('auth-login-password', 'keydown', (event) => { if (event.key === 'Enter') byId('btn-login').click(); });
    on('auth-reg-password', 'keydown', (event) => { if (event.key === 'Enter') byId('btn-register').click(); });

    ['all', 'skin', 'character'].forEach((filter) => {
      on(`shop-filter-${filter}`, 'click', () => this.setShopFilter(filter));
    });
    on('shop-grid', 'click', (event) => {
      const button = event.target.closest('[data-shop-action]');
      if (!button) return;
      const itemId = button.dataset.item;
      if (button.dataset.shopAction === 'equip' && this.handlers.onEquip) this.handlers.onEquip(itemId);
      if (button.dataset.shopAction === 'purchase' && this.handlers.onPurchase) this.handlers.onPurchase(itemId);
    });
    on('profile-content', 'click', (event) => {
      const button = event.target.closest('[data-equip]');
      if (button && this.handlers.onEquip) this.handlers.onEquip(button.dataset.equip);
    });

    const volume = (id, key) => on(id, 'input', (event) => {
      const value = Number(event.target.value) / 100;
      Settings.set({ [key]: value });
      Settings.apply();
      setText(`${id}-value`, Math.round(value * 100));
      if (this.handlers.onSettings) this.handlers.onSettings(Settings.get());
    });
    volume('set-master', 'master');
    volume('set-music', 'music');
    volume('set-sfx', 'sfx');
    const updateSensitivity = (event) => {
      Settings.set({ sensitivity: Number(event.target.value) });
      Settings.apply();
      setText('set-sensitivity-value', event.target.value);
      if (this.handlers.onSettings) this.handlers.onSettings(Settings.get());
    };
    on('set-sensitivity', 'input', updateSensitivity);
    on('set-sensitivity', 'change', updateSensitivity);
    on('set-camera', 'change', (event) => {
      Settings.set({ camera: event.target.value });
      Settings.apply();
      if (this.handlers.onSettings) this.handlers.onSettings(Settings.get());
    });
    on('set-quality', 'change', (event) => {
      Settings.set({ quality: event.target.value });
      Settings.apply();
      if (this.handlers.onSettings) this.handlers.onSettings(Settings.get());
    });
    on('chk-audio', 'change', (event) => {
      Settings.set({ sound: event.target.checked });
      Settings.apply();
      if (this.handlers.onSettings) this.handlers.onSettings(Settings.get());
    });
    on('chk-fullscreen', 'change', (event) => {
      if (this.handlers.onFullscreen) this.handlers.onFullscreen(event.target.checked);
    });
    on('btn-reset-settings', 'click', () => {
      Settings.reset();
      Settings.apply();
      this.renderSettings();
      this.toast('Réglages réinitialisés');
      if (this.handlers.onSettings) this.handlers.onSettings(Settings.get());
    });

    on('btn-admin-refresh', 'click', () => this.handlers.onAdminRefresh && this.handlers.onAdminRefresh());
    on('admin-payments', 'click', (event) => {
      const button = event.target.closest('[data-payment-action]');
      if (button && this.handlers.onReviewPayment) {
        this.handlers.onReviewPayment(button.dataset.paymentId, button.dataset.paymentAction, '');
      }
    });

    on('btn-room-create', 'click', () => {
      this.handlers.onRoomCreate && this.handlers.onRoomCreate({
        price: Number(byId('room-price').value) || 0,
        duration: Number(byId('room-duration').value) || 300,
        maxPlayers: Number(byId('room-players').value) || 5,
        map: byId('room-map').value,
        mode: byId('room-mode').value,
      });
    });
    on('btn-room-join-key', 'click', () => {
      const key = (byId('room-key').value || '').trim();
      if (!key) {
        this.setMessage('rooms-message', 'Saisissez une clé de salle.', true);
        return;
      }
      if (this.handlers.onRoomJoinKey) this.handlers.onRoomJoinKey(key);
    });
    on('rooms-list', 'click', (event) => {
      const button = event.target.closest('[data-room-id]');
      if (button && this.handlers.onRoomJoin) this.handlers.onRoomJoin(button.dataset.roomId);
    });

    on('btn-ready', 'click', () => this.handlers.onReady && this.handlers.onReady());
    on('btn-leave-room', 'click', () => this.handlers.onLeaveRoom && this.handlers.onLeaveRoom());
    on('lobby-chat-input', 'keydown', (event) => {
      if (event.key !== 'Enter') return;
      const input = event.target;
      const text = (input.value || '').trim();
      if (!text) return;
      if (this.handlers.onChat) this.handlers.onChat(text);
      input.value = '';
    });

    on('btn-requeue', 'click', () => this.handlers.onRequeue && this.handlers.onRequeue());
    on('btn-replay-accept', 'click', () => this.handlers.onReplayVote && this.handlers.onReplayVote(true));
    on('btn-replay-reject', 'click', () => this.handlers.onReplayVote && this.handlers.onReplayVote(false));
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
    const target = name ? byId(`screen-${name}`) : null;
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('active');
    }
    this.current = name || null;
  }

  showHUD(visible) {
    byId('hud').classList.toggle('hidden', !visible);
    byId('touch-controls').classList.toggle('hidden', !(visible && this.isTouch));
    if (visible) this.lastHud = {};
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
    if (!this.hudRefs) {
      this.hudRefs = {
        hp: byId('hud-hp'),
        hpFill: byId('hud-hp-fill'),
        armorFill: byId('hud-armor-fill'),
        weapon: byId('hud-weapon'),
        ammo: byId('hud-ammo'),
        kills: byId('hud-kills'),
        alive: byId('hud-alive'),
        medkits: byId('hud-medkits'),
        grenades: byId('hud-grenades'),
        crosshair: byId('hud-crosshair'),
        vignette: byId('hud-vignette'),
        vehicle: byId('hud-vehicle'),
        compassLeft: byId('compass-left'),
        compassCenter: byId('compass-center'),
        compassDegrees: byId('compass-degrees'),
        compassRight: byId('compass-right'),
      };
      this.lastHud = {};
    }
    const refs = this.hudRefs;
    const last = this.lastHud;
    const set = (key, value, write) => {
      if (last[key] === value) return;
      last[key] = value;
      write();
    };
    const hp = clamp(Math.round(state.hp), 0, 100);
    set('hp', hp, () => {
      refs.hp.textContent = String(hp);
      refs.hpFill.style.width = `${hp}%`;
      refs.hpFill.style.background = hp <= 25 ? '#ff4d4d' : hp <= 60 ? '#ffcf5c' : '#3ddc84';
    });
    const armor = clamp(state.armor, 0, 100);
    set('armor', armor, () => { refs.armorFill.style.width = `${armor}%`; });
    set('weaponName', state.weaponName, () => { refs.weapon.textContent = state.weaponName; });
    const ammo = state.weaponKey === 'knife' ? '—' : `${state.mag} / ${state.reserve}`;
    set('ammo', ammo, () => { refs.ammo.textContent = ammo; });
    const kills = `ÉLIMINATIONS ${state.kills}`;
    set('kills', kills, () => { refs.kills.textContent = kills; });
    const alive = `VIVANTS ${state.alive}`;
    set('alive', alive, () => { refs.alive.textContent = alive; });
    set('medkits', state.medkits, () => { refs.medkits.textContent = String(state.medkits); });
    set('grenades', state.grenades, () => { refs.grenades.textContent = String(state.grenades); });
    set('aiming', !!state.aiming, () => {
      refs.crosshair.style.visibility = state.aiming ? 'hidden' : 'visible';
    });
    const flash = Math.round(clamp(state.damageFlash || 0, 0, 1) * 100) / 100;
    set('flash', flash, () => { refs.vignette.style.opacity = String(flash); });
    const hint = state.vehicleHint || '';
    set('vehicleHint', hint, () => {
      refs.vehicle.textContent = hint;
      refs.vehicle.classList.toggle('hidden', !hint);
    });
    const heading = Math.round(((-(state.heading || 0) * 180 / Math.PI + 360) % 360 + 360) % 360) % 360;
    const point = Math.round(heading / 45) % 8;
    set('compass', heading, () => {
      refs.compassLeft.textContent = COMPASS_POINTS[(point + 6) % 8];
      refs.compassCenter.textContent = COMPASS_POINTS[point];
      refs.compassRight.textContent = COMPASS_POINTS[(point + 2) % 8];
      refs.compassDegrees.textContent = `${String(heading).padStart(3, '0')}°`;
    });
  }

  feed(text, color) {
    const line = document.createElement('div');
    line.textContent = text;
    if (color) line.style.borderLeftColor = color;
    const box = byId('hud-feed');
    box.insertBefore(line, box.firstChild);
    setTimeout(() => line.remove(), 4200);
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

  minimap(layout, player, others, mapDef) {
    const canvas = byId('minimap');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const half = WORLD_SIZE / 2;
    const scale = size / WORLD_SIZE;
    const project = (x, z) => [(x + half) * scale, (z + half) * scale];
    const source = layout || {};
    const positionOf = (entry, fallback) => {
      if (!entry) return fallback;
      const sourcePoint = entry.pos || entry;
      const x = Number(sourcePoint.x !== undefined ? sourcePoint.x : entry.x);
      const z = Number(sourcePoint.z !== undefined ? sourcePoint.z : entry.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return fallback;
      return { x, z, yaw: Number(entry.yaw) || 0, alive: entry.alive !== false };
    };

    const mapSrc = (mapDef && mapDef.minimap) || (MAPS.forest && MAPS.forest.minimap) || '';
    const mapImage = getMinimapImage(mapSrc);
    const staticKey = `${size}|${mapSrc}|${mapImage ? 1 : 0}`;
    if (!this.minimapStatic || staticKey !== this.minimapStaticKey || layout !== this.minimapLayout) {
      const staticCanvas = document.createElement('canvas');
      staticCanvas.width = size;
      staticCanvas.height = size;
      const staticCtx = staticCanvas.getContext('2d');
      if (staticCtx) {
        if (mapImage) {
          staticCtx.drawImage(mapImage, 0, 0, size, size);
        } else {
          staticCtx.fillStyle = '#0d120e';
          staticCtx.fillRect(0, 0, size, size);
        }
        if (Array.isArray(source.towns)) {
          staticCtx.font = 'bold 8px monospace';
          staticCtx.textAlign = 'center';
          for (const town of source.towns) {
            const [x, y] = project(town.x, town.z);
            const radius = Math.max(2, (town.radius || 20) * scale);
            staticCtx.fillStyle = 'rgba(168,146,102,.35)';
            staticCtx.strokeStyle = 'rgba(240,225,180,.8)';
            staticCtx.lineWidth = 1;
            staticCtx.beginPath();
            staticCtx.arc(x, y, radius, 0, Math.PI * 2);
            staticCtx.fill();
            staticCtx.stroke();
            staticCtx.fillStyle = 'rgba(245,232,190,.95)';
            staticCtx.fillText(String(town.name || '').slice(0, 10), x, y + 3);
          }
        }
      }
      this.minimapStatic = staticCanvas;
      this.minimapStaticKey = staticKey;
      this.minimapLayout = layout;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.clip();
    ctx.drawImage(this.minimapStatic, 0, 0);

    if (Array.isArray(others)) {
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      let botCount = 0;
      let playerCount = 0;
      for (const other of others) {
        const point = positionOf(other, null);
        if (!point) continue;
        const [x, y] = project(point.x, point.z);
        const isBot = other.isBot === true || other.type === 'bot';
        if (isBot) botCount += 1; else playerCount += 1;
        if (!point.alive) {
          ctx.strokeStyle = 'rgba(190,190,190,.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 3, y - 3);
          ctx.lineTo(x + 3, y + 3);
          ctx.moveTo(x + 3, y - 3);
          ctx.lineTo(x - 3, y + 3);
          ctx.stroke();
          continue;
        }
        if (!isBot) {
          const pulse = 4.5 + Math.sin(performance.now() / 220) * 1.5;
          ctx.strokeStyle = 'rgba(255,212,92,.75)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = isBot ? '#ff4d4d' : '#ffd45c';
        ctx.strokeStyle = '#0b0b0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const label = isBot ? 'B' : String(other.name || 'P').charAt(0).toUpperCase();
        ctx.fillStyle = '#0b0b0b';
        ctx.fillText(label, x + 0.5, y + 3.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x, y + 3);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(234,255,241,.9)';
      ctx.fillText(`J${playerCount} B${botCount}`, size - 3, size - 4);
      ctx.textAlign = 'left';
    }

    const playerPoint = positionOf(player, null);
    if (playerPoint) {
      const [px, py] = project(playerPoint.x, playerPoint.z);
      const sweepRadius = Math.max(26, 150 * scale);
      const sweepAngle = (performance.now() / 1400) % (Math.PI * 2);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(sweepAngle);
      const gradient = ctx.createLinearGradient(0, 0, sweepRadius, 0);
      gradient.addColorStop(0, 'rgba(61,220,132,.32)');
      gradient.addColorStop(1, 'rgba(61,220,132,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, sweepRadius, -0.34, 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(61,220,132,.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sweepRadius, 0);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-(playerPoint.yaw || 0));
      ctx.fillStyle = '#0b1a10';
      ctx.strokeStyle = '#eafff1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(234,255,241,.9)';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('N', size / 2 - 3, 10);
    ctx.restore();
  }

  setMessage(id, text, error) {
    const node = byId(id);
    if (!node) return;
    node.textContent = text || '';
    node.style.color = error ? 'var(--red)' : '';
  }

  setAuthMessage(text, error) {
    this.setMessage('auth-message', text, error);
  }

  setAuthTab(tab) {
    this.authTab = tab === 'register' ? 'register' : 'login';
    const login = this.authTab === 'login';
    byId('auth-login-panel').classList.toggle('hidden', !login);
    byId('auth-reg-panel').classList.toggle('hidden', login);
    byId('tab-login').classList.toggle('selected', login);
    byId('tab-register').classList.toggle('selected', !login);
    this.setAuthMessage('');
    this.handlers.onSound && this.handlers.onSound('ui/click');
  }

  setAuthState(user) {
    const name = user ? String(user.displayName || user.username || 'Joueur') : 'Invité';
    setText('menu-user', name);
    setText('menu-meta', user
      ? `Niv. ${(user.levelInfo && user.levelInfo.level) || user.level || 1} · ${((user.stats && user.stats.wins) || 0)} V · ${((user.stats && user.stats.kills) || 0)} élim.`
      : 'Connecte-toi pour jouer en ligne');
    setText('menu-credits', user ? ((user.credits == null ? 0 : user.credits)) : '—');
    setText('menu-avatar', name.slice(0, 1).toUpperCase());
    const auth = byId('btn-auth');
    const logout = byId('btn-logout');
    const admin = byId('btn-admin');
    if (auth) {
      auth.classList.toggle('hidden', !!user);
      auth.textContent = "SE CONNECTER / S'INSCRIRE";
    }
    if (logout) logout.classList.toggle('hidden', !user);
    if (admin) admin.classList.toggle('hidden', !(user && user.role === 'admin'));
    if (user) {
      this.selection.name = name.slice(0, 16);
      const input = byId('input-name');
      if (input) input.value = this.selection.name;
      try { localStorage.setItem('adybe.name', this.selection.name); } catch (error) {}
    }
  }

  setApiStatus(ok, text) {
    const badge = byId('api-status');
    if (!badge) return;
    badge.textContent = text || (ok ? 'En ligne' : 'Hors-ligne');
    badge.classList.toggle('badge-on', !!ok);
    badge.classList.toggle('badge-off', !ok);
  }

  setShopFilter(filter) {
    this.shopFilter = filter === 'skin' || filter === 'character' ? filter : 'all';
    ['all', 'skin', 'character'].forEach((name) => {
      const button = byId(`shop-filter-${name}`);
      if (button) button.classList.toggle('selected', name === this.shopFilter);
    });
    this.drawShop();
  }

  renderShop(items, state) {
    this.shopItems = Array.isArray(items) ? items : [];
    this.shopState = state || {};
    setText('shop-credits', this.shopState.credits == null ? '—' : this.shopState.credits);
    this.setMessage('shop-message', '');
    this.drawShop();
  }

  drawShop() {
    const grid = byId('shop-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const owned = new Set(this.shopState.owned || []);
    const equipped = this.shopState.equipped || {};
    const items = this.shopItems.filter((item) => this.shopFilter === 'all' || item.category === this.shopFilter);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Aucun article dans cette catégorie.';
      grid.appendChild(empty);
      return;
    }
    const rarityColors = { common: '#9aa4ae', uncommon: '#3ddc84', rare: '#4da3ff', epic: '#b366ff', legendary: '#ffcf5c' };
    const categoryNames = { skin: 'Skin', character: 'Personnage', weaponSkin: 'Arme' };
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'shop-card';
      const preview = document.createElement('img');
      preview.src = item.preview || '';
      preview.alt = item.name || '';
      preview.loading = 'lazy';
      const bar = document.createElement('div');
      bar.className = 'rarity-bar';
      bar.style.background = rarityColors[item.rarity] || 'var(--muted)';
      const body = document.createElement('div');
      body.className = 'card-body';
      const tag = document.createElement('span');
      tag.className = 'card-tag';
      tag.textContent = `${categoryNames[item.category] || 'Objet'} · ${item.rarity || 'common'}`.toUpperCase();
      const title = document.createElement('strong');
      title.className = 'card-title';
      title.textContent = item.name || item.id;
      const desc = document.createElement('span');
      desc.className = 'card-desc';
      desc.textContent = item.description || '';
      const foot = document.createElement('div');
      foot.className = 'card-foot';
      const price = document.createElement('span');
      price.className = `price${item.price > 0 ? '' : ' free'}`;
      price.textContent = item.price > 0 ? `${item.price} CR` : 'GRATUIT';
      const action = document.createElement('button');
      action.className = 'mini-btn';
      action.dataset.item = item.id;
      const equippedId = item.category === 'character' ? equipped.character
        : item.category === 'weaponSkin' ? equipped.weaponSkin : equipped.skin;
      if (owned.has(item.id) && equippedId === item.id) {
        action.textContent = 'ÉQUIPÉ';
        action.disabled = true;
        action.classList.add('success');
      } else if (owned.has(item.id)) {
        action.textContent = 'ÉQUIPER';
        action.dataset.shopAction = 'equip';
      } else {
        action.textContent = item.price > 0 ? 'ACHETER' : 'OBTENIR';
        action.dataset.shopAction = 'purchase';
      }
      foot.appendChild(price);
      foot.appendChild(action);
      body.appendChild(tag);
      body.appendChild(title);
      body.appendChild(desc);
      body.appendChild(foot);
      card.appendChild(preview);
      card.appendChild(bar);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  renderProfile(data) {
    const target = byId('profile-content');
    if (!target) return;
    const payload = data || {};
    const user = payload.user || Session.user() || {};
    const stats = user.stats || {};
    const levelInfo = user.levelInfo || {};
    const level = levelInfo.level || user.level || 1;
    const xp = levelInfo.currentLevelXp == null ? (user.xp || 0) : levelInfo.currentLevelXp;
    const nextXp = levelInfo.nextLevelXp || 250;
    const catalog = payload.catalog || this.shopItems || [];
    const byItem = new Map(catalog.map((item) => [item.id, item]));
    const name = String(user.displayName || user.username || 'Joueur');
    const kd = stats.deaths ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills || 0);
    const cells = [
      ['MATCHS', stats.matches || 0], ['VICTOIRES', stats.wins || 0],
      ['ÉLIMINATIONS', stats.kills || 0], ['K/D', kd],
      ['ÉLIM. / MATCH', ((stats.kills || 0) / Math.max(1, stats.matches || 0)).toFixed(1)],
      ['DÉGÂTS', stats.damage || 0],
    ];
    const inventory = user.inventory || [];
    const equipped = user.equipped || {};
    target.innerHTML = `
      <div class="profile-cols">
        <div>
          <div class="panel page-panel">
            <div class="profile-card">
              <div class="profile-avatar">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
              <div>
                <div class="profile-name">${escapeHtml(name)}</div>
                <div class="profile-handle">@${escapeHtml(user.username || '—')}</div>
                <div class="profile-chips"><span class="pill">NIVEAU ${level}</span><span class="pill">${escapeHtml(user.credits == null ? 0 : user.credits)} CR</span></div>
              </div>
            </div>
            <span class="section-label">PROGRESSION</span>
            <div class="xp-track"><i style="width:${Math.round((levelInfo.progress || 0) * 100)}%"></i></div>
            <p class="muted">${escapeHtml(xp)} / ${escapeHtml(nextXp)} XP vers le niveau ${Number(level) + 1}</p>
          </div>
          <div class="stat-grid">${cells.map(([label, value]) => `<div class="stat-cell"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('')}</div>
        </div>
        <div>
          <div class="page-head"><div><h2 style="font-size:24px">INVENTAIRE</h2><p>${inventory.length} objet(s)</p></div></div>
          <div class="inventory-grid">${inventory.length ? inventory.map((id) => {
            const item = byItem.get(id) || { id, name: id, category: 'Objet', preview: '' };
            const equippedId = item.category === 'character' ? equipped.character
              : item.category === 'weaponSkin' ? equipped.weaponSkin : equipped.skin;
            const isEquipped = equippedId === id;
            return `<div class="inv-card"><img src="${escapeHtml(item.preview || '')}" alt="" loading="lazy"><strong>${escapeHtml(item.name || id)}</strong><button class="mini-btn ${isEquipped ? 'success' : ''}" data-equip="${escapeHtml(id)}" ${isEquipped ? 'disabled' : ''}>${isEquipped ? 'ÉQUIPÉ' : 'ÉQUIPER'}</button></div>`;
          }).join('') : '<div class="empty-state">Ton inventaire est vide.</div>'}</div>
        </div>
      </div>`;
  }

  renderRanking(list) {
    const target = byId('ranking-list');
    if (!target) return;
    const entries = Array.isArray(list) ? list : ((list && list.leaderboard) || []);
    if (!entries.length) {
      target.innerHTML = '<div class="empty-state">Aucun combattant classé pour le moment.</div>';
      return;
    }
    const row = (cells, className) => `<div class="ranking-row ${className}">${cells.map((cell, index) => `<span class="${index === 0 ? 'rank' : ''}">${escapeHtml(cell)}</span>`).join('')}</div>`;
    target.innerHTML = row(['#', 'COMBATTANT', 'VICT.', 'ÉLIM.', 'DÉGÂTS'], 'header')
      + entries.map((entry, index) => row([
        String(index + 1),
        String(entry.displayName || entry.username || '?'),
        String(entry.wins || 0), String(entry.kills || 0), String(entry.damage || 0),
      ], index < 3 ? `rank-${index + 1}` : '')).join('');
  }

  renderSettings() {
    const s = Settings.get();
    const setRange = (id, value, label) => {
      const node = byId(id);
      if (node) node.value = value;
      setText(`${id}-value`, label);
    };
    setRange('set-master', Math.round(s.master * 100), Math.round(s.master * 100));
    setRange('set-music', Math.round(s.music * 100), Math.round(s.music * 100));
    setRange('set-sfx', Math.round(s.sfx * 100), Math.round(s.sfx * 100));
    setRange('set-sensitivity', s.sensitivity, s.sensitivity);
    const camera = byId('set-camera');
    const quality = byId('set-quality');
    const audio = byId('chk-audio');
    if (camera) camera.value = s.camera;
    if (quality) quality.value = s.quality;
    if (audio) audio.checked = s.sound !== false;
    setText('settings-info', `Version ${VERSION} · Préférences enregistrées sur cet appareil (${s.camera.toUpperCase()} / ${s.quality.toUpperCase()}).`);
  }

  renderAdmin(stats, payments) {
    setText('admin-stats', '');
    const cells = [
      ['UTILISATEURS', stats.users], ['EN LIGNE', stats.connected],
      ['MATCHS', stats.matches], ['PAIEMENTS ATT.', stats.pendingPayments],
      ['PAIEMENTS OK', stats.approvedPayments], ['REVENUS (AR)', stats.revenue],
      ['RETRAITS ATT.', stats.pendingWithdrawals], ['CRÉDITS EN JEU', stats.creditsInCirculation],
    ];
    const grid = byId('admin-stats');
    if (grid) {
      grid.innerHTML = cells.map(([label, value]) => `<div class="stat-cell"><strong>${escapeHtml(value == null ? 0 : value)}</strong><span>${label}</span></div>`).join('');
    }
    const list = byId('admin-payments');
    if (!list) return;
    const pending = (Array.isArray(payments) ? payments : []).filter((p) => p.status === 'pending');
    if (!pending.length) {
      list.innerHTML = '<div class="empty-state">Aucun paiement en attente.</div>';
      return;
    }
    list.innerHTML = pending.map((p) => `
      <div class="payment-row">
        <div>
          <strong>${escapeHtml(p.displayName || p.username || '?')} (@${escapeHtml(p.username || '?')})</strong>
          <p>${escapeHtml(p.offerName || 'Offre')} · ${escapeHtml(p.operator || '?')} · ${escapeHtml(p.amount || 0)} Ar · Réf. ${escapeHtml(p.reference || '?')}</p>
        </div>
        <div class="payment-actions">
          <button class="mini-btn success" data-payment-action="approve" data-payment-id="${escapeHtml(p.id)}">VALIDER</button>
          <button class="mini-btn danger" data-payment-action="refuse" data-payment-id="${escapeHtml(p.id)}">REFUSER</button>
        </div>
      </div>`).join('');
  }

  renderRooms(list) {
    const target = byId('rooms-list');
    if (!target) return;
    const rooms = Array.isArray(list) ? list : ((list && list.rooms) || []);
    if (!rooms.length) {
      target.innerHTML = '<div class="empty-state">Aucune salle disponible.</div>';
      return;
    }
    target.innerHTML = rooms.map((room) => {
      const locked = room.locked || room.status === 'active' || room.status === 'closed' || room.status === 'finished'
        || (room.playerCount != null && room.maxPlayers != null && room.playerCount >= room.maxPlayers);
      const mapName = (MAPS[room.map] && MAPS[room.map].name) || room.map || 'Forêt';
      return `<article class="shop-card">
        <div class="card-body">
          <span class="card-tag">${escapeHtml(room.type === 'private' ? 'PRIVÉE' : 'PUBLIQUE')} · ${escapeHtml(room.id)}</span>
          <strong class="card-title">${escapeHtml(room.name || room.id)}</strong>
          <span class="card-desc">${escapeHtml(mapName)} · ${escapeHtml(room.mode || 'solo')} · ${escapeHtml(room.playerCount == null ? 0 : room.playerCount)}/${escapeHtml(room.maxPlayers || 10)} joueurs</span>
          <div class="card-foot">
            <span class="price${room.price > 0 ? '' : ' free'}">${room.price > 0 ? `${escapeHtml(room.price)} CR` : 'GRATUIT'}</span>
            <button class="mini-btn" data-room-id="${escapeHtml(room.id)}" ${locked ? 'disabled' : ''}>${locked ? 'INDISPONIBLE' : 'REJOINDRE'}</button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  renderLobby(state) {
    const data = state || {};
    const info = data.roomInfo || {};
    const mapName = (MAPS[data.map || info.map] && MAPS[data.map || info.map].name) || data.map || info.map || '—';
    setText('lobby-room-info', `${mapName} · ${data.mode || info.mode || 'solo'} · ${data.roomId || info.id || ''}`);
    setText('lobby-code', data.inviteCode || info.inviteCode || data.roomKey || info.key || '—');
    setText('lobby-countdown', data.countdown > 0 ? `${data.countdown} s` : 'EN ATTENTE');
    const me = (data.players || []).find((player) => player.id === data.selfId);
    setText('lobby-ready', me ? (me.ready ? 'PRÊT' : 'EN ATTENTE') : 'EN ATTENTE');
    const list = byId('lobby-players');
    if (list) {
      list.innerHTML = (data.players || []).map((player) => `
        <div class="lobby-player"><span>${escapeHtml(player.name || player.id)}</span>
        <span class="ready ${player.ready ? 'on' : ''}">${player.ready ? 'PRÊT' : 'EN ATTENTE'}${player.connected === false ? ' · ABSENT' : ''}</span></div>`).join('')
        || '<div class="empty-state">En attente de combattants…</div>';
    }
    const chat = byId('lobby-chat-log');
    if (chat) {
      chat.innerHTML = '';
      this.lobbyChat.slice(-30).forEach((line) => {
        const row = document.createElement('div');
        row.innerHTML = `<b>${escapeHtml(line.name)}</b> ${escapeHtml(line.text)}`;
        chat.appendChild(row);
      });
      chat.scrollTop = chat.scrollHeight;
    }
  }

  lobbyMessage(name, text) {
    this.lobbyChat.push({ name: name || 'Serveur', text: String(text || '') });
    if (this.lobbyChat.length > 60) this.lobbyChat.shift();
    const chat = byId('lobby-chat-log');
    if (!chat) return;
    const row = document.createElement('div');
    row.innerHTML = `<b>${escapeHtml(name || 'Serveur')}</b> ${escapeHtml(text || '')}`;
    chat.appendChild(row);
    while (chat.children.length > 30) chat.removeChild(chat.firstChild);
    chat.scrollTop = chat.scrollHeight;
  }

  showReplayVote(state) {
    const block = byId('results-replay-vote');
    const requeue = byId('btn-requeue');
    const accept = byId('btn-replay-accept');
    const reject = byId('btn-replay-reject');
    const nodes = [block, requeue, accept, reject].filter(Boolean);
    if (!state) {
      nodes.forEach((node) => node.classList.add('hidden'));
      return;
    }
    nodes.forEach((node) => node.classList.remove('hidden'));
    const status = state.status === 'pending' ? 'Vote en cours' : state.status === 'approved' ? 'Rejeu accepté' : 'Rejeu refusé';
    const seconds = state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)) : 0;
    setText('replay-vote-info', `${status} · ${state.accepted || 0}/${state.votes || 0} en faveur${seconds ? ` · ${seconds} s` : ''}${state.myVote != null ? (state.myVote ? ' · Votre vote : oui' : ' · Votre vote : non') : ''}`);
  }
}
