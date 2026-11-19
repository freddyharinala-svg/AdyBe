import { MAP_SIZE, clamp } from './config.js';
import { buildExactWorldSpec } from './exact-world.js';
import { needsYawWrapper } from './models.js';

export function makeMaterial(app, options) {
  const settings = options || {};
  const material = new pc.StandardMaterial();
  const color = settings.color || [1, 1, 1];
  const specular = settings.specular || [0.04, 0.04, 0.04];
  material.diffuse.set(color[0], color[1], color[2]);
  material.specular.set(specular[0], specular[1], specular[2]);
  material.shininess = settings.shininess || 8;
  if (settings.emissive) {
    material.emissive.set(settings.emissive[0], settings.emissive[1], settings.emissive[2]);
  }
  if (settings.texture) {
    material.diffuseMap = settings.texture;
    if (settings.tiling) {
      if (Array.isArray(settings.tiling)) {
        material.diffuseMapTiling.set(settings.tiling[0], settings.tiling[1]);
      } else {
        material.diffuseMapTiling.set(settings.tiling, settings.tiling);
      }
    }
  }
  if (settings.opacity != null && settings.opacity < 1) {
    material.opacity = settings.opacity;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
  }
  if (settings.unlit) material.useLighting = false;
  material.update();
  return material;
}

export function primitive(app, type, position, scale, rotationY, material, parent) {
  const entity = new pc.Entity(type);
  entity.addComponent('render', {
    type,
    material,
    castShadows: false,
    receiveShadows: false,
  });
  entity.setLocalPosition(position[0], position[1], position[2]);
  entity.setLocalScale(scale[0], scale[1], scale[2]);
  entity.setLocalEulerAngles(0, (rotationY || 0) * 180 / Math.PI, 0);
  (parent || app.root).addChild(entity);
  return entity;
}

export class World {
  constructor(app, assets, models, layout, mapDef, quality) {
    this.app = app;
    this.assets = assets;
    this.models = models;
    this.layout = layout;
    this.mapDef = mapDef;
    this.quality = quality;
    this.colliders = [];
    this.landmarks = [];
    this.zoneEntity = null;
    this.sun = null;
    this.materials = {};
    this.group = new pc.Entity('world');
    this.app.root.addChild(this.group);
  }

  async build() {
    const isForest = this.mapDef.biome === 'forest';
    const groundTexture = this.assets.texture(this.mapDef.ground);
    const fog = this.mapDef.fog;
    const detail = this.quality.textureDetail ? 60 : 36;

    this.app.scene.ambientLight = new pc.Color(isForest ? 0.48 : 0.55, isForest ? 0.50 : 0.55, isForest ? 0.46 : 0.52);
    this.app.scene.fog.type = pc.FOG_LINEAR;
    this.app.scene.fog.color = new pc.Color(fog[0], fog[1], fog[2]);
    this.app.scene.fog.start = 55;
    this.app.scene.fog.end = this.quality.fogEnd;
    this.app.scene.exposure = 1.12;

    this.sun = new pc.Entity('sun');
    this.sun.addComponent('light', {
      type: 'directional',
      color: isForest ? new pc.Color(1, 0.89, 0.75) : new pc.Color(1, 0.95, 0.88),
      intensity: this.quality.sunIntensity,
      castShadows: false,
    });
    this.sun.setLocalEulerAngles(48, 35, 0);
    this.app.root.addChild(this.sun);

    this.materials.ground = makeMaterial(this.app, {
      texture: groundTexture, color: [1, 1, 1], tiling: detail, specular: [0.02, 0.02, 0.02], shininess: 4,
    });
    this.materials.rock = makeMaterial(this.app, { color: [0.43, 0.43, 0.40] });
    this.materials.wood = makeMaterial(this.app, { color: [0.48, 0.36, 0.24] });
    this.materials.building = makeMaterial(this.app, { color: isForest ? [0.52, 0.47, 0.39] : [0.58, 0.61, 0.66] });
    this.materials.zone = makeMaterial(this.app, {
      color: [1, 0.48, 0.24], emissive: [1, 0.32, 0.10], opacity: 0.16, unlit: true,
    });

    primitive(this.app, 'plane', [0, 0, 0], [MAP_SIZE, 1, MAP_SIZE], 0, this.materials.ground, this.group);
    await this.buildExactProps();

    this.zoneEntity = primitive(this.app, 'cylinder', [0, 20, 0], [2, 46, 2], 0, this.materials.zone, this.group);
    this.setZone(isForest ? 330 : 210, 0, 0);
  }

  async buildExactProps() {
    const spec = buildExactWorldSpec(this.mapDef.biome, this.quality.exact || {});
    this.colliders.push(...spec.colliders);
    this.landmarks = spec.landmarks || [];
    const limits = this.quality.exact || {};
    const counts = new Map();
    const urls = new Set();
    for (const placement of spec.props) {
      const count = counts.get(placement.type) || 0;
      const limit = limits[placement.type] == null ? Infinity : limits[placement.type];
      if (count < limit) urls.add(placement.path);
      counts.set(placement.type, count + 1);
    }
    await Promise.all(Array.from(urls).map((url) => this.models.load(url).catch(() => null)));

    const placed = new Map();
    for (const placement of spec.props) {
      const index = placed.get(placement.type) || 0;
      placed.set(placement.type, index + 1);
      const limit = limits[placement.type] == null ? Infinity : limits[placement.type];
      let entity = index < limit ? await this.models.instantiate(placement.path) : null;
      if (!entity) continue;
      const yawDegrees = placement.rotationY * 180 / Math.PI;
      if (needsYawWrapper(placement.path)) {
        const wrapper = new pc.Entity(`prop-${placement.type}`);
        wrapper.setPosition(placement.x, placement.y, placement.z);
        wrapper.setLocalEulerAngles(0, yawDegrees, 0);
        wrapper.setLocalScale(placement.scale, placement.scale, placement.scale);
        entity.setLocalPosition(0, 0, 0);
        entity.setLocalScale(1, 1, 1);
        wrapper.addChild(entity);
        this.group.addChild(wrapper);
      } else {
        entity.setPosition(placement.x, placement.y, placement.z);
        entity.setLocalEulerAngles(0, yawDegrees, 0);
        entity.setLocalScale(placement.scale, placement.scale, placement.scale);
        this.group.addChild(entity);
      }
    }
  }

  setZone(radius, x, z) {
    if (!this.zoneEntity) return;
    this.zoneEntity.setLocalPosition(x || 0, 20, z || 0);
    this.zoneEntity.setLocalScale(radius * 2, 46, radius * 2);
  }

  resolve(position, radius) {
    for (const collider of this.colliders) {
      const dx = position.x - collider.x;
      const dz = position.z - collider.z;
      const distance = Math.hypot(dx, dz);
      const minimum = radius + collider.r;
      if (distance < minimum && distance > 0.0001) {
        position.x = collider.x + (dx / distance) * minimum;
        position.z = collider.z + (dz / distance) * minimum;
      }
    }
    const limit = MAP_SIZE / 2 - 5;
    position.x = clamp(position.x, -limit, limit);
    position.z = clamp(position.z, -limit, limit);
  }

  raycast(origin, direction, maxDistance) {
    let closest = maxDistance;
    for (const collider of this.colliders) {
      const ox = origin.x - collider.x;
      const oz = origin.z - collider.z;
      const a = direction.x * direction.x + direction.z * direction.z;
      if (a < 0.000001) continue;
      const b = 2 * (ox * direction.x + oz * direction.z);
      const c = ox * ox + oz * oz - collider.r * collider.r;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) continue;
      const t = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (t <= 0 || t >= closest) continue;
      const y = origin.y + direction.y * t;
      if (y >= -0.5 && y <= collider.h + 0.5) closest = t;
    }
    return closest;
  }

  destroy() {
    if (this.sun) this.sun.destroy();
    this.group.destroy();
  }
}
