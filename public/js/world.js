import { MAP_SIZE, clamp } from './config.js';
import { buildExactWorldSpec } from './exact-world.js';
import { needsYawWrapper } from './models.js';

const COLLIDER_CELL = 16;
const PROCEDURAL_HOUSE = 'procedural-house';

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
    this.colliderGrid = new Map();
    this.colliderCell = COLLIDER_CELL;
    this.queryStamp = 0;
    this.landmarks = [];
    this.interiors = [];
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

    primitive(this.app, 'plane', [0, 0, 0], [MAP_SIZE, 1, MAP_SIZE], 0, this.materials.ground, this.group);
    await this.buildExactProps();
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
      if (count < limit && placement.path !== PROCEDURAL_HOUSE) urls.add(placement.path);
      counts.set(placement.type, count + 1);
    }
    await Promise.all(Array.from(urls).map((url) => this.models.load(url).catch(() => null)));

    const placed = new Map();
    for (const placement of spec.props) {
      const index = placed.get(placement.type) || 0;
      placed.set(placement.type, index + 1);
      const limit = limits[placement.type] == null ? Infinity : limits[placement.type];
      if (placement.path === PROCEDURAL_HOUSE) {
        if (index < limit) this.interiors.push(this.createEnterableHouse(placement));
        continue;
      }
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
    this.buildColliderGrid();
  }

  houseMaterial(key, color, emissive) {
    const name = `house-${key}`;
    let material = this.materials[name];
    if (!material) {
      material = makeMaterial(this.app, { color, emissive, specular: [0.05, 0.05, 0.05], shininess: 12 });
      this.materials[name] = material;
    }
    return material;
  }

  createEnterableHouse(placement) {
    const spec = placement.interior || {};
    const width = spec.width || 9;
    const depth = spec.depth || 9;
    const height = spec.height || 5;
    const door = spec.door || 2.6;
    const wall = this.houseMaterial('wall', spec.tint || [0.58, 0.48, 0.36]);
    const floor = this.houseMaterial('floor', [0.32, 0.25, 0.18]);
    const roof = this.houseMaterial('roof', spec.roofTint || [0.28, 0.3, 0.32]);
    const wood = this.houseMaterial('wood', [0.42, 0.31, 0.2]);
    const glow = this.houseMaterial('glow', [1, 0.82, 0.45], [0.35, 0.27, 0.1]);
    const root = new pc.Entity('enterable-house');
    root.setPosition(placement.x, 0, placement.z);
    root.setLocalEulerAngles(0, placement.rotationY * 180 / Math.PI, 0);
    this.group.addChild(root);

    primitive(this.app, 'box', [0, 0.05, 0], [width, 0.1, depth], 0, floor, root);
    const thickness = 0.28;
    primitive(this.app, 'box', [0, height / 2, depth / 2], [width, height, thickness], 0, wall, root);
    primitive(this.app, 'box', [-width / 2, height / 2, 0], [thickness, height, depth], 0, wall, root);
    primitive(this.app, 'box', [width / 2, height / 2, 0], [thickness, height, depth], 0, wall, root);
    const side = (width - door) / 2;
    primitive(this.app, 'box', [-(door + side) / 2, height / 2, -depth / 2], [side, height, thickness], 0, wall, root);
    primitive(this.app, 'box', [(door + side) / 2, height / 2, -depth / 2], [side, height, thickness], 0, wall, root);
    primitive(this.app, 'box', [0, door + (height - door) / 2, -depth / 2], [door, height - door, thickness], 0, wall, root);
    primitive(this.app, 'box', [-door / 2, door / 2, -depth / 2 - 0.04], [0.18, door, 0.36], 0, wood, root);
    primitive(this.app, 'box', [door / 2, door / 2, -depth / 2 - 0.04], [0.18, door, 0.36], 0, wood, root);
    for (const windowX of [-width * 0.3, width * 0.3]) {
      primitive(this.app, 'box', [windowX, height * 0.62, depth / 2 + 0.08], [1.4, 1, 0.08], 0, glow, root);
    }
    const roofEntity = primitive(
      this.app, 'box', [0, height + 0.18, 0], [width + 0.9, 0.36, depth + 0.9], 0, roof, root,
    );

    primitive(this.app, 'box', [0, 0.78, depth * 0.16], [2.4, 0.16, 1.3], 0, wood, root);
    primitive(this.app, 'box', [-0.95, 0.38, depth * 0.16], [0.16, 0.76, 0.16], 0, wood, root);
    primitive(this.app, 'box', [0.95, 0.38, depth * 0.16], [0.16, 0.76, 0.16], 0, wood, root);
    primitive(this.app, 'box', [width * 0.28, 0.34, -depth * 0.2], [1.8, 0.48, 2.4], 0, wood, root);
    const crate = this.houseMaterial('crate', [0.58, 0.42, 0.22]);
    primitive(this.app, 'box', [-width * 0.3, 0.45, depth * 0.24], [1.2, 0.9, 1], 0, crate, root);
    primitive(this.app, 'box', [-width * 0.3, 1.35, depth / 2 - 0.25], [1.4, 0.12, 0.4], 0, wood, root);

    const cosine = Math.cos(placement.rotationY);
    const sine = Math.sin(placement.rotationY);
    return {
      x: placement.x,
      z: placement.z,
      rotation: placement.rotationY,
      width,
      depth,
      right: { x: cosine, z: -sine },
      back: { x: sine, z: cosine },
      roof: roofEntity,
      inside: false,
      hideRadius: Math.max(width, depth) * 0.52 + 1.2,
    };
  }

  buildColliderGrid() {
    const cell = this.colliderCell;
    this.colliderGrid.clear();
    for (const collider of this.colliders) {
      const minX = Math.floor((collider.x - collider.r) / cell);
      const maxX = Math.floor((collider.x + collider.r) / cell);
      const minZ = Math.floor((collider.z - collider.r) / cell);
      const maxZ = Math.floor((collider.z + collider.r) / cell);
      for (let gx = minX; gx <= maxX; gx += 1) {
        for (let gz = minZ; gz <= maxZ; gz += 1) {
          const key = `${gx}:${gz}`;
          let bucket = this.colliderGrid.get(key);
          if (!bucket) {
            bucket = [];
            this.colliderGrid.set(key, bucket);
          }
          bucket.push(collider);
        }
      }
    }
  }

  resolve(position, radius) {
    const cell = this.colliderCell;
    const reach = radius + 2;
    const minX = Math.floor((position.x - reach) / cell);
    const maxX = Math.floor((position.x + reach) / cell);
    const minZ = Math.floor((position.z - reach) / cell);
    const maxZ = Math.floor((position.z + reach) / cell);
    const stamp = ++this.queryStamp;
    for (let gx = minX; gx <= maxX; gx += 1) {
      for (let gz = minZ; gz <= maxZ; gz += 1) {
        const bucket = this.colliderGrid.get(`${gx}:${gz}`);
        if (!bucket) continue;
        for (const collider of bucket) {
          if (collider.queryStamp === stamp) continue;
          collider.queryStamp = stamp;
          const dx = position.x - collider.x;
          const dz = position.z - collider.z;
          const minimum = radius + collider.r;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared >= minimum * minimum || distanceSquared <= 0.00000001) continue;
          const distance = Math.sqrt(distanceSquared);
          position.x = collider.x + (dx / distance) * minimum;
          position.z = collider.z + (dz / distance) * minimum;
        }
      }
    }
    const limit = MAP_SIZE / 2 - 5;
    position.x = clamp(position.x, -limit, limit);
    position.z = clamp(position.z, -limit, limit);
  }

  raycast(origin, direction, maxDistance) {
    const a = direction.x * direction.x + direction.z * direction.z;
    if (a < 0.000001) return maxDistance;
    const cell = this.colliderCell;
    const endX = origin.x + direction.x * maxDistance;
    const endZ = origin.z + direction.z * maxDistance;
    const minX = Math.floor((Math.min(origin.x, endX) - 2) / cell);
    const maxX = Math.floor((Math.max(origin.x, endX) + 2) / cell);
    const minZ = Math.floor((Math.min(origin.z, endZ) - 2) / cell);
    const maxZ = Math.floor((Math.max(origin.z, endZ) + 2) / cell);
    const stamp = ++this.queryStamp;
    let closest = maxDistance;
    for (let gx = minX; gx <= maxX; gx += 1) {
      for (let gz = minZ; gz <= maxZ; gz += 1) {
        const bucket = this.colliderGrid.get(`${gx}:${gz}`);
        if (!bucket) continue;
        for (const collider of bucket) {
          if (collider.queryStamp === stamp) continue;
          collider.queryStamp = stamp;
          const ox = origin.x - collider.x;
          const oz = origin.z - collider.z;
          const b = 2 * (ox * direction.x + oz * direction.z);
          const c = ox * ox + oz * oz - collider.r * collider.r;
          const discriminant = b * b - 4 * a * c;
          if (discriminant < 0) continue;
          const t = (-b - Math.sqrt(discriminant)) / (2 * a);
          if (t <= 0 || t >= closest) continue;
          const y = origin.y + direction.y * t;
          if (y >= -0.5 && y <= collider.h + 0.5) closest = t;
        }
      }
    }
    return closest;
  }

  destroy() {
    if (this.sun) this.sun.destroy();
    this.group.destroy();
    this.colliderGrid.clear();
    this.colliders.length = 0;
    this.interiors.length = 0;
  }
}
