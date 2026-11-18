import { MAP_SIZE, clamp } from './config.js';

export function makeMaterial(app, options) {
  const settings = options || {};
  const material = new pc.StandardMaterial();
  const color = settings.color || [1, 1, 1];
  material.diffuse.set(color[0], color[1], color[2]);
  material.specular.set(0.04, 0.04, 0.04);
  material.shininess = 8;
  if (settings.emissive) {
    material.emissive.set(settings.emissive[0], settings.emissive[1], settings.emissive[2]);
  }
  if (settings.texture) {
    material.diffuseMap = settings.texture;
    if (settings.tiling) material.diffuseMapTiling.set(settings.tiling, settings.tiling);
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
  constructor(app, assets, layout, mapDef, quality) {
    this.app = app;
    this.assets = assets;
    this.layout = layout;
    this.mapDef = mapDef;
    this.quality = quality;
    this.colliders = [];
    this.zoneEntity = null;
    this.materials = {};
    this.group = new pc.Entity('world');
    this.app.root.addChild(this.group);
  }

  build() {
    const isForest = this.mapDef.biome === 'forest';
    const groundTexture = this.assets.texture(this.mapDef.ground, this.quality.textureDetail ? 60 : 24);
    const sky = this.mapDef.sky;
    const fog = this.mapDef.fog;

    this.app.scene.ambientLight = new pc.Color(0.55, 0.55, 0.52);
    this.app.scene.fog.type = pc.FOG_LINEAR;
    this.app.scene.fog.color = new pc.Color(fog[0], fog[1], fog[2]);
    this.app.scene.fog.start = 45;
    this.app.scene.fog.end = this.quality.fogEnd;
    this.app.scene.exposure = 1.05;

    this.materials.ground = makeMaterial(this.app, { texture: groundTexture, color: [1, 1, 1] });
    this.materials.road = makeMaterial(this.app, { color: isForest ? [0.32, 0.29, 0.22] : [0.24, 0.25, 0.26] });
    this.materials.wall = makeMaterial(this.app, { color: isForest ? [0.52, 0.46, 0.36] : [0.55, 0.56, 0.58] });
    this.materials.roof = makeMaterial(this.app, { color: isForest ? [0.30, 0.17, 0.13] : [0.23, 0.26, 0.31] });
    this.materials.wood = makeMaterial(this.app, { color: [0.43, 0.30, 0.18] });
    this.materials.tree = makeMaterial(this.app, { color: isForest ? [0.17, 0.32, 0.19] : [0.22, 0.36, 0.20] });
    this.materials.rock = makeMaterial(this.app, { color: [0.36, 0.36, 0.34] });
    this.materials.metal = makeMaterial(this.app, { color: [0.28, 0.31, 0.34] });
    this.materials.car = makeMaterial(this.app, { color: [0.42, 0.18, 0.16] });
    this.materials.zone = makeMaterial(this.app, {
      color: [1, 0.48, 0.24], emissive: [1, 0.32, 0.10], opacity: 0.16, unlit: true,
    });

    primitive(this.app, 'plane', [0, 0, 0], [MAP_SIZE, 1, MAP_SIZE], 0, this.materials.ground, this.group);
    this.buildRoads();
    this.buildTowns();
    this.buildGroves();
    this.buildProps();

    this.zoneEntity = primitive(this.app, 'cylinder', [0, 22, 0], [2, 44, 2], 0, this.materials.zone, this.group);
    this.setZone(330, 0, 0);
  }

  buildRoads() {
    for (const road of this.layout.roads || []) {
      const points = road.points || [];
      for (let i = 0; i < points.length - 1; i += 1) {
        const ax = points[i][0];
        const az = points[i][1];
        const bx = points[i + 1][0];
        const bz = points[i + 1][1];
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 0.01) continue;
        const angle = Math.atan2(bx - ax, bz - az);
        primitive(this.app, 'box', [(ax + bx) / 2, 0.045, (az + bz) / 2], [road.width, 0.09, length], angle, this.materials.road, this.group);
      }
    }
  }

  buildTowns() {
    let count = 0;
    for (const village of this.layout.villages || []) {
      const entries = (village.houses || []).concat(village.outbuildings || []);
      for (const entry of entries) {
        if (count >= this.quality.buildings) return;
        count += 1;
        const footprint = entry.footprint || 3;
        const height = entry.height || 5;
        const body = entry.model === 'trailer' || entry.model === 'shed' ? this.materials.wood : this.materials.wall;
        primitive(this.app, 'box', [entry.x, height / 2, entry.z], [footprint * 2, height, footprint * 2], entry.rotationY || 0, body, this.group);
        primitive(this.app, 'box', [entry.x, height + 0.18, entry.z], [footprint * 2.15, 0.36, footprint * 2.15], entry.rotationY || 0, this.materials.roof, this.group);
        this.colliders.push({ x: entry.x, z: entry.z, r: footprint * 1.15, h: height });
      }
    }
  }

  buildGroves() {
    const groves = this.layout.groves || [];
    if (!groves.length) return;
    const target = this.quality.trees;
    let placed = 0;
    let index = 0;
    while (placed < target && index < groves.length * 4) {
      const grove = groves[index % groves.length];
      const round = Math.floor(index / groves.length);
      const angle = (index * 2.399963) % (Math.PI * 2);
      const spread = Math.sqrt((round + 0.5) / 4) * grove.radius;
      const x = grove.x + Math.cos(angle) * spread;
      const z = grove.z + Math.sin(angle) * spread;
      const height = 4 + ((index * 37) % 5);
      primitive(this.app, 'cone', [x, height / 2, z], [2.2, height, 2.2], angle, this.materials.tree, this.group);
      if (index < groves.length) this.colliders.push({ x, z, r: 0.7, h: height });
      placed += 1;
      index += 1;
    }
  }

  buildProps() {
    const props = this.layout.props || [];
    if (!props.length) return;
    const stride = Math.max(1, Math.floor(props.length / this.quality.props));
    for (let i = 0; i < props.length; i += stride) {
      const prop = props[i];
      let type = 'box';
      let scale = [1, 1, 1];
      let y = 0.5;
      let material = this.materials.wood;
      if (prop.id === 'barrel') { type = 'cylinder'; scale = [0.7, 1, 0.7]; y = 0.5; material = this.materials.metal; }
      else if (prop.id === 'car') { type = 'box'; scale = [3.4, 1.5, 1.8]; y = 0.75; material = this.materials.car; }
      else if (prop.id === 'tyre') { type = 'cylinder'; scale = [0.8, 0.3, 0.8]; y = 0.15; material = this.materials.metal; }
      else if (prop.id === 'crateOld' || prop.id === 'crate') { type = 'box'; scale = [1.2, 1.2, 1.2]; y = 0.6; material = this.materials.wood; }
      else if (prop.id === 'ammo_box') { type = 'box'; scale = [0.9, 0.5, 0.6]; y = 0.25; material = this.materials.metal; }
      primitive(this.app, type, [prop.x, y, prop.z], scale, prop.rotationY || 0, material, this.group);
      if (prop.id === 'car' || prop.id === 'crateOld') {
        this.colliders.push({ x: prop.x, z: prop.z, r: Math.max(scale[0], scale[2]) * 0.45, h: scale[1] });
      }
    }
  }

  setZone(radius, x, z) {
    if (!this.zoneEntity) return;
    this.zoneEntity.setLocalPosition(x || 0, 22, z || 0);
    this.zoneEntity.setLocalScale(radius * 2, 44, radius * 2);
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
    this.group.destroy();
  }
}
