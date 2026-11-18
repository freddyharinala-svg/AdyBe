export const VERSION = '1.0.0-playcanvas';
export const MAP_SIZE = 760;
export const WORLD_SIZE = 800;

export const ZONE = {
  initial: 330,
  cityInitial: 210,
  min: 22,
  hold: 42,
  stepHold: 30,
  shrink: 0.06,
  factor: 0.62,
  damage: 6,
};

export const QUALITY_LEVELS = {
  low: {
    label: 'Basse (Core2Duo / 2 Go)',
    pixelRatio: 1,
    msaa: false,
    shadows: false,
    fogEnd: 230,
    trees: 70,
    props: 70,
    buildings: 12,
    bots: 5,
    maxFps: 30,
    networkRate: 0.12,
    textureDetail: false,
  },
  medium: {
    label: 'Moyenne',
    pixelRatio: 1.25,
    msaa: false,
    shadows: false,
    fogEnd: 340,
    trees: 150,
    props: 140,
    buildings: 22,
    bots: 7,
    maxFps: 45,
    networkRate: 0.08,
    textureDetail: true,
  },
  high: {
    label: 'Haute',
    pixelRatio: 2,
    msaa: true,
    shadows: true,
    fogEnd: 480,
    trees: 260,
    props: 220,
    buildings: 32,
    bots: 9,
    maxFps: 60,
    networkRate: 0.05,
    textureDetail: true,
  },
};

export function detectQuality() {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = navigator.deviceMemory || 2;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (cores <= 2 || memory <= 2) return 'low';
  if (mobile || cores <= 4) return 'medium';
  return 'high';
}

export const MAPS = {
  forest: {
    id: 'forest',
    name: 'Forêt de Thalvorn',
    short: 'Forêt',
    desc: 'Forêt dense, collines et ruines. Idéale pour les embuscades.',
    biome: 'forest',
    minimap: 'assets/maps/forest-minimap.png',
    sky: [0.17, 0.25, 0.20],
    fog: [0.27, 0.31, 0.25],
    ground: 'assets/textures/grass_albedo.png',
  },
  city: {
    id: 'city',
    name: 'Ville d’Ady',
    short: 'Ville',
    desc: 'Blocs urbains, rues ouvertes et toits praticables. Combat vertical.',
    biome: 'urban',
    minimap: 'assets/maps/city-minimap.png',
    sky: [0.24, 0.32, 0.40],
    fog: [0.35, 0.34, 0.30],
    ground: 'assets/textures/asphalt_albedo.png',
  },
};

export const MODES = {
  solo: { id: 'solo', name: 'Solo — Royaume des ombres', zone: true },
  training: { id: 'training', name: 'Entraînement — manœuvres', zone: false },
};

export const WEAPONS = [
  {
    key: 'rifle', name: 'Fusil d’assaut AK', damage: 34, rpm: 620, auto: true,
    magSize: 30, reserve: 150, reload: 2.1, range: 420, spread: 0.9,
    zoomFov: 55, sound: 'weapons/rifle', pellets: 1,
  },
  {
    key: 'pistol', name: 'Pistolet 1911', damage: 26, rpm: 420, auto: false,
    magSize: 12, reserve: 84, reload: 1.5, range: 220, spread: 0.55,
    zoomFov: 60, sound: 'weapons/pistol', pellets: 1,
  },
  {
    key: 'sniper', name: 'Fusil de précision M700', damage: 95, rpm: 72, auto: false,
    magSize: 5, reserve: 25, reload: 2.6, range: 700, spread: 0.1,
    zoomFov: 26, sound: 'weapons/sniper', pellets: 1,
  },
  {
    key: 'knife', name: 'Couteau de combat', damage: 65, rpm: 150, auto: false,
    magSize: 999, reserve: 0, reload: 0, range: 2.6, spread: 0,
    zoomFov: 70, sound: 'weapons/knife_swing', pellets: 1,
  },
];

export const BOT_NAMES = ['Fantôme', 'Kaya', 'Viper', 'Recrue-7', 'Ombre', 'Suricate', 'Braise', 'Mistral', 'Lynx'];
export const BOT_TINTS = [
  [0.77, 0.42, 0.42], [0.42, 0.56, 0.77], [0.77, 0.69, 0.42],
  [0.60, 0.42, 0.77], [0.42, 0.77, 0.49], [0.77, 0.49, 0.66], [0.49, 0.77, 0.77],
];

export const AUDIO_PATHS = {
  'ui/click': 'assets/audio/interface/click.wav',
  'ui/hover': 'assets/audio/interface/hover.wav',
  'ui/notify': 'assets/audio/interface/notify.wav',
  'ui/error': 'assets/audio/interface/error.wav',
  'weapons/rifle': 'assets/audio/weapons/rifle.wav',
  'weapons/pistol': 'assets/audio/weapons/pistol.wav',
  'weapons/sniper': 'assets/audio/weapons/sniper.wav',
  'weapons/shotgun': 'assets/audio/weapons/shotgun.wav',
  'weapons/knife_swing': 'assets/audio/weapons/knife_swing.wav',
  'weapons/reload': 'assets/audio/weapons/reload.wav',
  'weapons/empty_click': 'assets/audio/weapons/empty_click.wav',
  'player/hurt': 'assets/audio/player/hurt.wav',
  'player/heal': 'assets/audio/player/heal.wav',
  'player/footstep_grass': 'assets/audio/player/footstep_grass.wav',
  'player/jump': 'assets/audio/player/jump.wav',
  'battle-royale/victory': 'assets/audio/battle-royale/victory.wav',
  'battle-royale/defeat': 'assets/audio/battle-royale/defeat.wav',
  'battle-royale/elimination': 'assets/audio/battle-royale/elimination.wav',
  'music/menu_theme': 'assets/audio/music/menu_theme.wav',
  'music/battle_theme': 'assets/audio/music/battle_theme.wav',
  'vehicles/engine_loop': 'assets/audio/vehicles/engine_loop.wav',
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
