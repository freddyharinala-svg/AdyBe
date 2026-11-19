export const VERSION = '1.0.0-playcanvas';
export const MAP_SIZE = 760;
export const WORLD_SIZE = 800;

export const QUALITY_LEVELS = {
  low: {
    label: 'Basse (Core2Duo / 2 Go)',
    pixelRatio: 1,
    msaa: false,
    shadows: false,
    fogEnd: 260,
    trees: 90,
    props: 90,
    buildings: 14,
    bots: 5,
    maxFps: 30,
    networkRate: 0.12,
    textureDetail: true,
    anisotropy: 2,
    sunIntensity: 1.2,
    exact: { tree: 420, deadTree: 60, stump: 35, shrub: 110, fern: 70, rock: 130, crate: 32, building: 60 },
    exactLoot: 56,
  },
  medium: {
    label: 'Moyenne',
    pixelRatio: 1.25,
    msaa: false,
    shadows: false,
    fogEnd: 360,
    trees: 150,
    props: 140,
    buildings: 22,
    bots: 7,
    maxFps: 45,
    networkRate: 0.08,
    textureDetail: true,
    anisotropy: 4,
    sunIntensity: 1.35,
    exact: { tree: 650, deadTree: 90, stump: 55, shrub: 170, fern: 120, rock: 200, crate: 60, building: 90 },
    exactLoot: 84,
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
    anisotropy: 8,
    sunIntensity: 1.5,
    exact: { tree: 999, deadTree: 999, stump: 999, shrub: 999, fern: 999, rock: 999, crate: 999, building: 999 },
    exactLoot: 112,
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
    sky: [0.169, 0.247, 0.200],
    fog: [0.275, 0.314, 0.243],
    ground: 'assets/textures/grass_albedo.png',
  },
  city: {
    id: 'city',
    name: 'Ville d’Ady',
    short: 'Ville',
    desc: 'Blocs urbains, rues ouvertes et toits praticables. Combat vertical.',
    biome: 'urban',
    minimap: 'assets/maps/city-minimap.png',
    sky: [0.239, 0.322, 0.400],
    fog: [0.353, 0.337, 0.298],
    ground: 'assets/textures/asphalt_albedo.png',
  },
};

export const MODES = {
  solo: { id: 'solo', name: 'Solo — Royaume des ombres' },
  training: { id: 'training', name: 'Entraînement — manœuvres' },
};

export const AIRDROP = {
  first: 30,
  interval: 65,
  count: 3,
  planeSpeed: 58,
  planeAltitude: 72,
  fallSpeed: 16,
  radius: 2.6,
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

export const SKIN_TINTS = {
  skin_recruit: [0.95, 0.72, 0.32],
  skin_jungle: [0.42, 0.72, 0.38],
  skin_ghost: [0.58, 0.64, 0.72],
  skin_phoenix: [1, 0.42, 0.18],
};

export const FX_PATHS = {
  impact_ring: 'assets/effects/impact_ring.png',
  spark: 'assets/effects/spark.png',
  blood_particle: 'assets/effects/blood_particle.png',
  muzzle_flash: 'assets/effects/muzzle_flash.png',
  smoke: 'assets/effects/smoke_particle.png',
};

export const CHARACTER_MODELS = {
  char_ch15: 'assets/models/characters/hero_ch15.glb',
  char_dying: 'assets/models/characters/hero_dying.glb',
  char_dying1: 'assets/models/characters/hero_dying1.glb',
  char_archer: 'assets/models/characters/hero_archer.glb',
  char_kaya: 'assets/models/characters/hero_kaya.glb',
};

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
  'fx/explosion': 'assets/audio/weapons/shotgun.wav',
  'player/hurt': 'assets/audio/player/hurt.wav',
  'player/heal': 'assets/audio/player/heal.wav',
  'player/footstep_grass': 'assets/audio/player/footstep_grass.wav',
  'player/jump': 'assets/audio/player/jump.wav',
  'battle-royale/victory': 'assets/audio/battle-royale/victory.wav',
  'battle-royale/defeat': 'assets/audio/battle-royale/defeat.wav',
  'battle-royale/elimination': 'assets/audio/battle-royale/elimination.wav',
  'battle-royale/drop_alarm': 'assets/audio/battle-royale/drop_alarm.wav',
  'music/menu_theme': 'assets/audio/music/menu_theme.wav',
  'music/battle_theme': 'assets/audio/music/battle_theme.wav',
  'vehicles/engine_loop': 'assets/audio/vehicles/engine_loop.wav',
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
