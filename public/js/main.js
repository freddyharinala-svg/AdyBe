import { VERSION, detectQuality } from './config.js';
import { Assets } from './assets.js';
import { NetClient } from './network.js';
import { UI } from './ui.js';
import { Game } from './gameplay.js';

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
let frames = 0;
let fpsElapsed = 0;
let slowElapsed = 0;

const ui = new UI({
  onPlay: async (selection) => {
    if (!ui.isTouch && canvas.requestPointerLock) {
      const lockPromise = canvas.requestPointerLock();
      if (lockPromise && lockPromise.catch) lockPromise.catch(() => {});
    }
    ui.feed('Chargement du monde…', '#ffcf5c');
    lastSelection = selection;
    lastQuality = selection.quality === 'auto' ? detectQuality() : selection.quality;
    applyQuality(lastQuality);
    if (!layout) {
      try {
        layout = await assets.json('assets/maps/world-layout.json');
      } catch (error) {
        ui.toast('Impossible de charger la carte');
        return;
      }
    }
    net.connect(selection.name, 'adybe', selection.map);
    game.start(selection, lastQuality, layout);
  },
  onResume: () => game && game.resume(),
  onAbandon: () => {
    if (!game) return;
    game.ui.showHUD(false);
    game.over = false;
    game.endMatch(false, 99);
  },
  onReplay: () => {
    if (!game || !lastSelection) return;
    net.connect(lastSelection.name, 'adybe', lastSelection.map);
    game.start(lastSelection, lastQuality, layout);
  },
  onMenu: () => {
    if (game) game.stop();
    ui.screen('menu');
    assets.startMusic('music/menu_theme');
  },
  onPause: () => game && game.togglePause(),
  onSound: (sound) => assets.play(sound, 0.4),
  onSoundToggle: (enabled) => assets.setEnabled(enabled),
});

const net = new NetClient({
  onStatus: (online, text) => ui.setNet(online, text),
  onEvent: (event, data) => { if (game) game.onNetworkEvent(event, data); },
  onWelcome: (message) => ui.feed(`Serveur — salle ${message.room}`, '#4da3ff'),
});

game = new Game(app, assets, ui, net);
window.adybe = {
  app, assets, ui, net,
  get game() { return game; },
};

function applyQuality(name) {
  const quality = name === 'high' ? { pixelRatio: 2, msaa: true } : name === 'medium' ? { pixelRatio: 1.25, msaa: false } : { pixelRatio: 1, msaa: false };
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
  if (pc.GAMMA_SRGB != null) app.scene.gammaCorrection = pc.GAMMA_SRGB;
  if (pc.TONEMAP_ACES != null) app.scene.toneMapping = pc.TONEMAP_ACES;
}

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

ui.setVersion(VERSION);
ui.setNet(false, 'Connexion…');
net.connect(ui.selection.name, 'adybe', ui.selection.map);
assets.startMusic('music/menu_theme');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
