const KEY = 'adybe.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  master: 0.8,
  music: 0.5,
  sfx: 0.9,
  sensitivity: 6,
  camera: 'tps',
  quality: 'auto',
  sound: true,
});

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

function number(value, fallback, low, high) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, low, high) : fallback;
}

function sanitize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const camera = source.camera === 'fps' ? 'fps' : 'tps';
  const quality = ['auto', 'low', 'medium', 'high'].includes(source.quality) ? source.quality : 'auto';
  return {
    master: number(source.master, DEFAULT_SETTINGS.master, 0, 1),
    music: number(source.music, DEFAULT_SETTINGS.music, 0, 1),
    sfx: number(source.sfx, DEFAULT_SETTINGS.sfx, 0, 1),
    sensitivity: number(source.sensitivity, DEFAULT_SETTINGS.sensitivity, 1, 12),
    camera,
    quality,
    sound: source.sound !== false,
  };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

let state = read();

export const Settings = {
  get() {
    return { ...state };
  },

  set(patch) {
    state = sanitize({ ...state, ...(patch || {}) });
    this.save();
    return this.get();
  },

  reset() {
    state = { ...DEFAULT_SETTINGS };
    this.save();
    return this.get();
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
    }
    return this.get();
  },

  apply() {
    const detail = this.get();
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('adybe:settings', { detail }));
    }
    return detail;
  },
};

export default Settings;
