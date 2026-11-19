import { AUDIO_PATHS } from './config.js';

export class Assets {
  constructor(app) {
    this.app = app;
    this.textures = new Map();
    this.sounds = new Map();
    this.music = null;
    this.musicName = '';
    this.enabled = true;
    this.anisotropy = 1;
  }

  setQuality(quality) {
    const maximum = this.app.graphicsDevice.maxAnisotropy || 1;
    this.anisotropy = Math.max(1, Math.min(quality.anisotropy || 1, maximum));
  }

  async json(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Chargement impossible: ${path}`);
    return response.json();
  }

  texture(path) {
    if (this.textures.has(path)) return this.textures.get(path);
    const texture = new pc.Texture(this.app.graphicsDevice, {
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      mipmaps: true,
      anisotropy: this.anisotropy,
    });
    const image = new Image();
    image.addEventListener('load', () => texture.setSource(image), { once: true });
    image.src = path;
    this.textures.set(path, texture);
    return texture;
  }

  play(name, volume) {
    if (!this.enabled) return;
    const path = AUDIO_PATHS[name];
    if (!path) return;
    let pool = this.sounds.get(name);
    if (!pool) {
      pool = [new Audio(path), new Audio(path), new Audio(path)];
      pool.forEach((audio) => { audio.preload = 'auto'; audio.volume = volume == null ? 0.5 : volume; });
      this.sounds.set(name, pool);
    }
    const free = pool.find((audio) => audio.paused || audio.ended) || pool[0];
    free.currentTime = 0;
    if (volume != null) free.volume = volume;
    const promise = free.play();
    if (promise && promise.catch) promise.catch(() => {});
  }

  startMusic(name) {
    if (!this.enabled || this.musicName === name) return;
    this.stopMusic();
    const path = AUDIO_PATHS[name];
    if (!path) return;
    this.music = new Audio(path);
    this.music.loop = true;
    this.music.volume = 0.28;
    this.musicName = name;
    const promise = this.music.play();
    if (promise && promise.catch) promise.catch(() => {});
  }

  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
      this.music = null;
    }
    this.musicName = '';
  }

  setEnabled(value) {
    this.enabled = value;
    if (this.music) this.music.volume = value ? 0.28 : 0;
  }
}
