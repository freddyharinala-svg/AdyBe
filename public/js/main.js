import { VERSION, detectQuality } from './config.js';
import { Assets } from './assets.js';
import { NetClient } from './network.js';
import { UI } from './ui.js';
import { Game } from './gameplay.js';
import { Api } from './api.js';
import { Session } from './session.js';
import { Settings } from './settings.js';

const canvas = document.getElementById('game');
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  touch: new pc.TouchDevice(canvas),
  keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: {
    alpha: false,
    antialias: false,
    depth: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  },
});

app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();

const assets = new Assets(app);
let game = null;
let layout = null;
let lastSelection = null;
let lastQuality = detectQuality();
let lobbySelection = null;
let waitingLobby = false;
let matchStarting = null;
let replayTimer = null;
let frames = 0;
let fpsElapsed = 0;
let slowElapsed = 0;

const ui = new UI({
  onPlay: (selection) => {
    const roomId = 'adybe';
    connectMatch({ ...selection, roomId });
    startGame(selection, { roomId });
  },
  onResume: () => game && game.resume(),
  onAbandon: () => {
    if (!game) return;
    game.ui.showHUD(false);
    game.over = false;
    game.endMatch(false, 99);
  },
  onReplay: async () => {
    if (net.roomId && await openReplayVote(net.roomId)) return;
    localReplay();
  },
  onMenu: () => {
    clearReplayPoll();
    waitingLobby = false;
    lobbySelection = null;
    if (game) game.stop();
    net.close();
    ui.showReplayVote(null);
    ui.screen('menu');
    assets.startMusic('music/menu_theme');
  },
  onPause: () => game && game.togglePause(),
  onSound: (sound) => assets.play(sound, 0.4),
  onSoundToggle: (enabled) => assets.setEnabled(enabled),
  onAuth: () => { ui.setAuthMessage(''); ui.screen('auth'); },
  onLogin: (credentials) => login(credentials),
  onRegister: (payload) => registerAccount(payload),
  onLogout: () => logout(),
  onShop: () => loadShop(),
  onPurchase: (itemId) => purchase(itemId),
  onEquip: (itemId) => equip(itemId),
  onProfile: () => loadProfile(),
  onRanking: () => loadRanking(),
  onSettings: () => { ui.renderSettings(); ui.screen('settings'); },
  onFullscreen: (enabled) => toggleFullscreen(enabled),
  onRooms: () => loadRooms(),
  onRoomCreate: (options) => createRoom(options),
  onRoomJoin: (id) => joinRoom(id),
  onRoomJoinKey: (key) => joinByKey(key),
  onReady: () => net.sendReady(),
  onLeaveRoom: () => leaveRoom(),
  onChat: (text) => net.sendChat(text),
  onAdmin: () => loadAdmin(),
  onAdminRefresh: () => loadAdmin(),
  onReviewPayment: (id, action, note) => reviewPayment(id, action, note),
  onRequeue: () => net.roomId && openReplayVote(net.roomId),
  onReplayVote: (accept) => voteReplay(accept),
});

const net = new NetClient({
  backend: Api.base,
  onStatus: (online, text) => ui.setNet(online, text),
  onWelcome: (message) => {
    ui.feed(`Serveur — salle ${message.roomId || message.room || 'adybe'}`, '#4da3ff');
    if (waitingLobby) renderLobby(message);
  },
  onLobby: (message) => {
    if (waitingLobby) renderLobby(message);
  },
  onMatchStart: () => {
    clearReplayPoll();
    ui.showReplayVote(null);
    startGame(lobbySelection || lastSelection || ui.selection, { roomId: net.roomId, roomKey: net.roomKey });
  },
  onWorld: () => {},
  onMatchEnd: (message) => {
    clearReplayPoll();
    if (game && game.running && !game.over) {
      const self = (message.results || []).find((entry) => entry.id === net.selfId);
      game.endMatch(!!self && self.placement === 1, self ? self.placement : 99);
    }
    if (net.roomId) openReplayVote(net.roomId);
  },
  onPhase: () => {},
  onEvent: (event, data) => {
    if (game) game.onNetworkEvent(event, data);
    if (event === 'chat') ui.lobbyMessage(data.name, data.text);
    if (event === 'playerJoined') ui.lobbyMessage('Serveur', `${data.name} a rejoint la salle`);
    if (event === 'playerLeft' || event === 'playerDisconnected') ui.lobbyMessage('Serveur', `${data.name} a quitté la salle`);
    if (event === 'replayReady' && data && data.roomId) openReplayVote(data.roomId);
  },
});

game = new Game(app, assets, ui, net);
window.adybe = {
  app, assets, ui, net,
  api: Api, session: Session, settings: Settings,
  get game() { return game; },
};

function applyQuality(name) {
  const quality = name === 'high' ? { pixelRatio: 2, msaa: true }
    : name === 'medium' ? { pixelRatio: 1.25, msaa: false }
      : { pixelRatio: 1, msaa: false };
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
  if (pc.GAMMA_SRGB != null) app.scene.gammaCorrection = pc.GAMMA_SRGB;
  if (pc.TONEMAP_ACES != null) app.scene.toneMapping = pc.TONEMAP_ACES;
}

function applySettings(detail) {
  if (!detail) return;
  if (game && typeof game.applySettings === 'function') game.applySettings(detail);
  assets.setEnabled(detail.sound !== false);
  const quality = detail.quality || 'auto';
  ui.selection.quality = quality;
  const select = document.getElementById('select-quality');
  if (select) select.value = quality;
  if (quality !== 'auto') {
    lastQuality = quality;
    applyQuality(quality);
  }
}

window.addEventListener('adybe:settings', (event) => applySettings(event.detail || Settings.get()));

function connectMatch(info) {
  net.connect({
    name: info.name || Session.displayName().slice(0, 16),
    token: Session.token(),
    mode: info.mode || 'solo',
    map: info.map || 'forest',
    roomId: info.roomId || 'adybe',
    roomKey: info.roomKey || null,
  });
}

function startGame(selection, room = {}) {
  if (matchStarting) return matchStarting;
  if (game && game.running && !game.over) return Promise.resolve();
  const payload = {
    ...selection,
    character: Session.equipped().character,
    skin: Session.equipped().skin,
    roomId: room.roomId || net.roomId || null,
    roomKey: room.roomKey || net.roomKey || null,
  };
  lastSelection = payload;
  matchStarting = (async () => {
    if (!ui.isTouch && canvas.requestPointerLock) {
      const lockPromise = canvas.requestPointerLock();
      if (lockPromise && lockPromise.catch) lockPromise.catch(() => {});
    }
    ui.feed('Chargement du monde…', '#ffcf5c');
    lastQuality = payload.quality === 'auto' || !payload.quality ? detectQuality() : payload.quality;
    applyQuality(lastQuality);
    if (!layout) {
      try {
        layout = await assets.json('assets/maps/world-layout.json');
      } catch (error) {
        ui.toast('Impossible de charger la carte');
        return;
      }
    }
    waitingLobby = false;
    ui.showReplayVote(null);
    const gamePayload = { ...payload, mode: payload.mode === 'training' ? 'training' : 'solo' };
    await game.start(gamePayload, lastQuality, layout);
  })().catch((error) => {
    ui.toast('Impossible de démarrer la partie');
  }).finally(() => {
    matchStarting = null;
  });
  return matchStarting;
}

function renderLobby(message) {
  ui.renderLobby({ ...message, selfId: net.selfId });
  if (ui.current !== 'lobby') ui.screen('lobby');
}

function clearReplayPoll() {
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
}

function localReplay() {
  if (!game || !lastSelection) return;
  connectMatch({ ...lastSelection, roomId: 'adybe' });
  startGame(lastSelection);
}

async function openReplayVote(roomId) {
  clearReplayPoll();
  const response = await Api.replayStart(roomId);
  if (!response.ok || !response.data) {
    ui.showReplayVote(null);
    return false;
  }
  ui.showReplayVote(response.data);
  if (response.data.status === 'approved') {
    handleReplayApproved(roomId);
    return true;
  }
  replayTimer = setInterval(() => pollReplay(roomId), 2000);
  return true;
}

async function pollReplay(roomId) {
  const response = await Api.replayStatus(roomId);
  if (!response.ok || !response.data) return;
  const vote = response.data;
  if (vote.status === 'approved') {
    clearReplayPoll();
    handleReplayApproved(roomId);
    return;
  }
  if (vote.status === 'refused') {
    clearReplayPoll();
    ui.showReplayVote(null);
    ui.toast('Rejeu refusé');
    return;
  }
  ui.showReplayVote(vote);
}

function handleReplayApproved(roomId) {
  ui.showReplayVote(null);
  ui.toast('Rejeu accepté — retour en salle');
  waitingLobby = true;
  lobbySelection = lastSelection || ui.selection;
  ui.lobbyChat = [];
  ui.screen('lobby');
  connectMatch({ ...lobbySelection, roomId });
}

async function voteReplay(accept) {
  if (!net.roomId) return;
  const response = await Api.replayVote(net.roomId, accept);
  if (!response.ok) {
    ui.toast((response.data && response.data.error) || 'Vote impossible');
    return;
  }
  ui.showReplayVote(response.data);
  if (response.data.status === 'approved') {
    clearReplayPoll();
    handleReplayApproved(net.roomId);
  } else if (response.data.status === 'refused') {
    clearReplayPoll();
    ui.showReplayVote(null);
    ui.toast('Rejeu refusé');
  }
}

async function login(credentials) {
  ui.setAuthMessage('Connexion…');
  const response = await Api.login(credentials.username, credentials.password);
  if (response.ok && response.data.token) {
    Session.set({ token: response.data.token, user: response.data.user || null });
    ui.setAuthMessage('Connexion réussie.');
    ui.screen('menu');
    ui.toast(`Bienvenue, ${Session.displayName()}`);
    return;
  }
  ui.setAuthMessage((response.data && response.data.error) || 'Connexion impossible.', true);
}

async function registerAccount(payload) {
  ui.setAuthMessage('Création du compte…');
  const response = await Api.register(payload);
  if (response.ok && response.data.token) {
    Session.set({ token: response.data.token, user: response.data.user || null });
    ui.setAuthMessage('Compte créé.');
    ui.screen('menu');
    ui.toast(`Bienvenue, ${Session.displayName()}`);
    return;
  }
  ui.setAuthMessage((response.data && response.data.error) || 'Inscription impossible.', true);
}

async function logout() {
  await Api.logout();
  Session.clear();
  ui.setAuthState(null);
  ui.screen('menu');
  ui.toast('Déconnecté');
}

async function loadShop() {
  ui.screen('shop');
  let local = { items: [] };
  try {
    const response = await fetch('data/shop_catalog.json');
    if (response.ok) local = await response.json();
  } catch (error) {}
  const response = await Api.shop();
  const items = response.ok && Array.isArray(response.data.items) && response.data.items.length
    ? response.data.items : local.items;
  const user = Session.user() || {};
  const state = response.ok ? {
    credits: response.data.credits == null ? user.credits : response.data.credits,
    owned: response.data.owned || [],
    equipped: response.data.equipped || Session.equipped(),
  } : { credits: user.credits, owned: user.inventory || [], equipped: Session.equipped() };
  ui.renderShop(items || [], state);
  ui.screen('shop');
}

async function purchase(itemId) {
  const response = await Api.purchase(itemId);
  if (!response.ok) {
    ui.setMessage('shop-message', (response.data && response.data.error) || 'Achat impossible.', true);
    return;
  }
  if (response.data.user) Session.setUser(response.data.user);
  ui.setMessage('shop-message', 'Achat confirmé. Bon courage sur l’Île !');
  await loadShop();
}

async function equip(itemId) {
  const response = await Api.equip(itemId);
  if (!response.ok) {
    ui.setMessage('shop-message', (response.data && response.data.error) || 'Équipement impossible.', true);
    return;
  }
  if (response.data.user) Session.setUser(response.data.user);
  await loadShop();
}

async function loadProfile() {
  if (!Session.token()) {
    ui.toast('Connecte-toi pour voir ton profil');
    ui.screen('auth');
    return;
  }
  const response = await Api.profile();
  if (response.ok && response.data.user) Session.setUser(response.data.user);
  const data = { ...response.data, catalog: (ui.shopItems && ui.shopItems.length) ? ui.shopItems : undefined };
  ui.renderProfile(data);
  ui.screen('profile');
}

async function loadRanking() {
  const response = await Api.leaderboard();
  ui.renderRanking(response.ok ? response.data.leaderboard || [] : []);
  ui.screen('ranking');
}

async function loadRooms() {
  if (!Session.token()) {
    ui.toast('Connecte-toi pour rejoindre une salle');
    ui.screen('auth');
    return;
  }
  const response = await Api.rooms();
  ui.renderRooms(response.ok ? response.data : { rooms: [] });
  ui.setMessage('rooms-message', response.ok ? '' : ((response.data && response.data.error) || 'Salles indisponibles.'), !response.ok);
  ui.screen('rooms');
}

async function createRoom(options) {
  if (!Session.token()) {
    ui.toast('Connecte-toi pour créer une salle');
    ui.screen('auth');
    return;
  }
  const response = await Api.createRoom(options);
  if (!response.ok) {
    ui.setMessage('rooms-message', (response.data && response.data.error) || 'Création impossible.', true);
    return;
  }
  const room = response.data.room || {};
  enterRoom(room.id || response.data.roomId, response.data.key || room.key, room);
}

async function joinRoom(id) {
  if (!id) return;
  const [detail, validated] = await Promise.all([Api.room(id), Api.joinRoom(id)]);
  if (!validated.ok) {
    ui.setMessage('rooms-message', (validated.data && validated.data.error) || 'Impossible de rejoindre la salle.', true);
    return;
  }
  enterRoom(id, detail.ok && detail.data.room ? detail.data.room.key : null, (detail.data && detail.data.room) || {});
}

async function joinByKey(key) {
  const response = await Api.joinByKey(key);
  if (!response.ok) {
    ui.setMessage('rooms-message', (response.data && response.data.error) || 'Clé invalide.', true);
    return;
  }
  const roomId = response.data.roomId;
  const detail = await Api.room(roomId);
  enterRoom(roomId, detail.ok && detail.data.room ? detail.data.room.key : null, (detail.data && detail.data.room) || {});
}

function enterRoom(roomId, roomKey, room) {
  if (!roomId) {
    ui.setMessage('rooms-message', 'Salle introuvable.', true);
    return;
  }
  const selection = {
    ...ui.selection,
    mode: room.mode || ui.selection.mode,
    map: room.map || ui.selection.map,
  };
  lobbySelection = { ...selection, roomId, roomKey };
  waitingLobby = true;
  ui.lobbyChat = [];
  ui.renderLobby({
    roomId, roomKey,
    inviteCode: room.key || room.code || roomKey,
    roomInfo: room,
    players: [],
    mode: selection.mode,
    map: selection.map,
    selfId: null,
  });
  ui.screen('lobby');
  connectMatch(lobbySelection);
}

function leaveRoom() {
  clearReplayPoll();
  net.sendLeave();
  waitingLobby = false;
  lobbySelection = null;
  ui.showReplayVote(null);
  ui.screen('menu');
  assets.startMusic('music/menu_theme');
}

async function loadAdmin() {
  if (!Session.isAdmin()) {
    ui.toast('Accès administrateur requis');
    ui.screen('menu');
    return;
  }
  const [stats, payments] = await Promise.all([Api.adminStats(), Api.adminPayments()]);
  ui.renderAdmin(stats.ok ? stats.data : {}, payments.ok ? payments.data.payments || [] : []);
  ui.screen('admin');
}

async function reviewPayment(id, action, note) {
  const response = await Api.reviewPayment(id, action, note);
  ui.toast(response.ok ? 'Paiement traité.' : ((response.data && response.data.error) || 'Action impossible.'));
  if (response.ok) await loadAdmin();
}

function toggleFullscreen(enabled) {
  const promise = enabled ? document.documentElement.requestFullscreen && document.documentElement.requestFullscreen()
    : document.exitFullscreen && document.exitFullscreen();
  if (promise && promise.catch) promise.catch(() => ui.toast('Plein écran indisponible'));
}

async function pollHealth() {
  const response = await Api.health();
  ui.setApiStatus(response.ok, response.ok ? 'API en ligne' : 'API hors-ligne');
}

function refreshAuth() {
  ui.setAuthState(Session.user());
}

window.addEventListener('adybe:session', refreshAuth);

app.on('update', (dt) => {
  frames += 1;
  fpsElapsed += dt;
  if (fpsElapsed >= 1) {
    const fps = Math.round(frames / fpsElapsed);
    ui.setFps(fps);
    if (game && game.running && !game.paused && !game.over) {
      if (fps < 24) slowElapsed += 1; else slowElapsed = 0;
      if (slowElapsed >= 4 && lastQuality !== 'low') {
        lastQuality = 'low';
        applyQuality('low');
        ui.toast('Qualité réduite automatiquement pour rester fluide');
        slowElapsed = 0;
      }
    }
    frames = 0;
    fpsElapsed = 0;
  }
});

refreshAuth();
ui.setVersion(VERSION);
ui.setNet(false, 'Prêt');
ui.setApiStatus(false, 'API…');
Settings.apply();
pollHealth();
setInterval(pollHealth, 15000);
assets.startMusic('music/menu_theme');

(async () => {
  if (!Session.token()) return;
  const response = await Api.me();
  if (response.ok && response.data.user) {
    Session.setUser(response.data.user);
  } else if (response.status === 401) {
    Session.clear();
    ui.toast('Session expirée — reconnecte-toi');
  }
  refreshAuth();
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
