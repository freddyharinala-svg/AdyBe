import { CHARACTER_MODELS } from './config.js';

const X_CORRECTED_MODELS = new Set([
  ...Object.values(CHARACTER_MODELS),
]);

export function needsXCorrection(url) {
  return X_CORRECTED_MODELS.has(url);
}

const YAW_WRAPPED_MODELS = new Set([
  'assets/models/environment/house_03.glb',
  'assets/models/environment/house_04.glb',
  'assets/models/environment/shed.glb',
]);

export function needsYawWrapper(url) {
  return YAW_WRAPPED_MODELS.has(url);
}

const GRAFTED_ANIMATIONS = new Set([
  CHARACTER_MODELS.char_archer,
  CHARACTER_MODELS.char_kaya,
]);

const LOOP_ANIMS = new Set([
  'Idle', 'RifleIdle', 'Walk', 'Run', 'CrouchWalk',
  'WalkBackward', 'RunBackward', 'Strafe', 'StrafeLeft', 'StrafeRight',
  'TurnLeft', 'TurnRight', 'Driving', 'Falling',
]);

async function animationNames(url) {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder();
    let json;
    if (view.getUint32(0, true) === 0x46546c67) {
      const length = view.getUint32(12, true);
      json = JSON.parse(decoder.decode(bytes.subarray(20, 20 + length)));
    } else {
      json = JSON.parse(decoder.decode(bytes));
    }
    return (json.animations || []).map((animation) => animation.name);
  } catch (error) {
    return null;
  }
}

function prepareMaterials(resource) {
  for (const materialAsset of resource.materials || []) {
    const material = materialAsset && materialAsset.resource;
    if (!material) continue;
    material.cull = pc.CULLFACE_NONE;
    if (material.update) material.update();
  }
}

function stripRootDrift(track) {
  if (!track || track.__adybeStripped) return;
  track.__adybeStripped = true;
  for (const curve of track.curves || []) {
    const target = (curve.paths || []).find((path) => (
      (path.entityPath || []).some((part) => part.indexOf('Hips') !== -1)
      && (path.propertyPath || []).join('.').indexOf('localPosition') !== -1
    ));
    if (!target) continue;
    const input = track.inputs[curve.input];
    const output = track.outputs[curve.output];
    if (!input || !output) continue;
    const components = output.components;
    const data = output.data;
    if (data.length < components * 2 || !track.duration) continue;
    const drift = [];
    for (let component = 0; component < components; component += 1) {
      drift.push(data[data.length - components + component] - data[component]);
    }
    const magnitude = drift.reduce((sum, value) => sum + value * value, 0);
    if (magnitude < 0.0001) continue;
    for (let key = 0; key < input.data.length; key += 1) {
      const ratio = input.data[key] / track.duration;
      for (let component = 0; component < components; component += 1) {
        data[key * components + component] -= drift[component] * ratio;
      }
    }
  }
}

function tintMeshInstances(entity, tint) {
  const renders = entity.findComponents('render');
  for (const render of renders) {
    for (const meshInstance of render.meshInstances) {
      meshInstance.castShadows = false;
      meshInstance.receiveShadows = false;
      if (!tint || !meshInstance.material) continue;
      const material = meshInstance.material.clone();
      const diffuse = material.diffuse;
      material.diffuse.set(
        diffuse.r * tint[0],
        diffuse.g * tint[1],
        diffuse.b * tint[2],
      );
      if (material.update) material.update();
      meshInstance.material = material;
    }
  }
}

export class Models {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
  }

  load(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    const promise = new Promise((resolve, reject) => {
      this.app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (error || !asset || !asset.resource) {
          reject(error || new Error(`Modèle impossible à charger: ${url}`));
          return;
        }
        prepareMaterials(asset.resource);
        resolve(asset);
      });
    });
    this.cache.set(url, promise);
    promise.catch(() => this.cache.delete(url));
    return promise;
  }

  async instantiate(url, options = {}) {
    try {
      const asset = await this.load(url);
      const entity = asset.resource.instantiateRenderEntity({
        castShadows: false,
        receiveShadows: false,
      });
      entity.name = options.name || url.split('/').pop();
      tintMeshInstances(entity, options.tint);
      return entity;
    } catch (error) {
      console.warn('[adybe] modèle ignoré', url, error);
      return null;
    }
  }

  async createAvatar(url, tint, speed) {
    const asset = await this.load(url);
    const entity = asset.resource.instantiateRenderEntity({
      castShadows: false,
      receiveShadows: false,
    });
    entity.name = 'avatar';
    tintMeshInstances(entity, tint);
    entity.setLocalEulerAngles(needsXCorrection(url) ? -90 : 0, needsXCorrection(url) ? 0 : 180, needsXCorrection(url) ? 180 : 0);
    this.app.root.addChild(entity);

    const animations = asset.resource.animations || [];
    const sourceUrl = GRAFTED_ANIMATIONS.has(url) || animations.length < 2
      ? CHARACTER_MODELS.char_ch15 : url;
    const sourceAsset = sourceUrl === url ? asset : await this.load(sourceUrl);
    const sourceAnimations = sourceAsset.resource.animations || [];
    const names = await animationNames(sourceUrl);
    const tracks = new Map();
    for (let index = 0; index < sourceAnimations.length; index += 1) {
      const track = sourceAnimations[index].resource;
      if (!track) continue;
      const generic = (sourceAnimations[index].name || '').match(/\/animation\/(\d+)$/);
      const rawName = (names && names[index]) || `Animation${index}`;
      const name = String(rawName || generic && `Animation${generic[1]}` || `Animation${index}`).replace(/\./g, '_');
      tracks.set(name, track);
    }
    if (!tracks.size) return { entity, play: () => false };

    const ordered = ['RifleIdle', 'Idle'].filter((name) => tracks.has(name));
    for (const name of tracks.keys()) {
      if (!ordered.includes(name)) ordered.push(name);
    }
    const anim = entity.addComponent('anim', { activate: true, speed });
    for (const name of ordered) {
      const track = tracks.get(name);
      const loop = LOOP_ANIMS.has(name);
      if (loop) stripRootDrift(track);
      anim.assignAnimation(name, track, undefined, 1, loop);
    }
    anim.playing = true;
    const initial = ordered[0];
    anim.baseLayer.transition(initial, 0);
    let current = initial;

    return {
      entity,
      anim,
      play(name, force) {
        let target = name;
        if (!tracks.has(target) && target === 'Strafe' && tracks.has('StrafeRight')) target = 'StrafeRight';
        if (!tracks.has(target) && target === 'RifleIdle' && tracks.has('Idle')) target = 'Idle';
        if (!tracks.has(target)) return false;
        if (target === current && !force) return true;
        anim.baseLayer.transition(target, 0.18);
        current = target;
        return true;
      },
    };
  }
}
