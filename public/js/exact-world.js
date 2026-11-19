import { GodotRandom } from './rng.js';

const TAU = Math.PI * 2;
const MAP_SIZE = 760;

const FOREST = {
  trees1: 'assets/polyhaven/quiver_tree_01/quiver_tree_01_1k.gltf',
  trees2: 'assets/polyhaven/quiver_tree_02/quiver_tree_02_1k.gltf',
  deadTree: 'assets/polyhaven/dead_tree_trunk_02/dead_tree_trunk_02_1k.gltf',
  stump: 'assets/polyhaven/tree_stump_01/tree_stump_01_1k.gltf',
  shrubs: 'assets/polyhaven/shrub_03/shrub_03_1k.gltf',
  shrubs4: 'assets/polyhaven/shrub_04/shrub_04_1k.gltf',
  ferns: 'assets/polyhaven/fern_02/fern_02_1k.gltf',
  rocks: 'assets/models/environment/rock.gltf',
  moss: 'assets/polyhaven/rock_moss_set_01/rock_moss_set_01_1k.gltf',
  shed: 'assets/models/environment/shed.glb',
  house3: 'assets/models/environment/house_03.glb',
  house4: 'assets/models/environment/house_04.glb',
  crate: 'assets/models/environment/crate.gltf',
};

const CITY_BUILDINGS = ['a', 'c', 'e', 'g', 'i', 'k', 'm', 'o', 'q', 's']
  .map((letter) => `assets/models/environment/kenney/building-${letter}.glb`);

const CITY = {
  rocks: 'assets/models/environment/rock.gltf',
  crates: 'assets/models/environment/crate.gltf',
};

const PROP_TYPES = {
  quiver_tree_01_1k: 'tree',
  quiver_tree_02_1k: 'tree',
  dead_tree_trunk_02_1k: 'deadTree',
  tree_stump_01_1k: 'stump',
  shrub_03_1k: 'shrub',
  shrub_04_1k: 'shrub',
  fern_02_1k: 'fern',
  'rock.gltf': 'rock',
  rock_moss_set_01_1k: 'rock',
  'crate.gltf': 'crate',
};

function typeOf(path) {
  const file = path.split('/').pop();
  const name = file.replace(/\.[^.]+$/, '');
  if (file.indexOf('building-') === 0 || file.indexOf('house_') === 0 || file === 'shed.glb') return 'building';
  return PROP_TYPES[name] || file;
}

function capacity(props, path, limits) {
  const limit = limits[typeOf(path)];
  if (limit == null) return Infinity;
  let used = 0;
  for (const prop of props) {
    if (prop.type === typeOf(path)) used += 1;
  }
  return Math.max(0, limit - used);
}

function groundOffset(path, scale) {
  const name = path.split('/').pop();
  if (name === 'dead_tree_trunk_02_1k.gltf') return 0.33 * scale;
  if (name === 'tree_stump_01_1k.gltf') return 0.19 * scale;
  if (name === 'fern_02_1k.gltf') return 0.03 * scale;
  if (name === 'rock_moss_set_01_1k.gltf') return 0.66 * scale;
  if (name === 'crate.gltf') return 0.5 * scale;
  return 0;
}

function colliderFor(path, x, z, scale) {
  const type = typeOf(path);
  if (type === 'tree') return { x, z, r: 0.16 * scale, h: 2.8 * scale };
  if (type === 'deadTree') return { x, z, r: 0.18 * scale, h: 1.1 * scale };
  if (type === 'stump') return { x, z, r: 0.28 * scale, h: 0.6 * scale };
  if (type === 'rock') return { x, z, r: 0.7 * scale, h: 1.2 * scale };
  if (type === 'crate') return { x, z, r: 0.7 * scale, h: 1.2 * scale };
  return null;
}

function pushProp(props, path, x, y, z, scale, rotationY) {
  props.push({ path, type: typeOf(path), x, y, z, scale, rotationY });
}

function placeProp(props, colliders, path, count, minScale, maxScale, randomRotation, minRadius, limits) {
  const rng = new GodotRandom(1337);
  const target = Math.min(count, capacity(props, path, limits));
  let placed = 0;
  let attempts = 0;
  while (placed < target && attempts < target * 12) {
    attempts += 1;
    const distance = rng.randfRange(minRadius + 6, MAP_SIZE * 0.46);
    const angle = rng.randfRange(0, TAU);
    const scale = rng.randfRange(minScale, maxScale);
    const rotationY = randomRotation ? rng.randfRange(0, TAU) : 0;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    pushProp(props, path, x, groundOffset(path, scale), z, scale, rotationY);
    const collider = colliderFor(path, x, z, scale);
    if (collider) colliders.push(collider);
    placed += 1;
  }
}

function placeStatic(props, colliders, path, x, y, z, scale, rotationDeg, collision) {
  pushProp(props, path, x, y, z, scale, rotationDeg * Math.PI / 180);
  if (collision) colliders.push({ x, z, r: collision.r, h: collision.h });
}

function addLandmark(landmarks, x, z, type, name) {
  landmarks.push({ x, z, type, name });
}

function scatterCrates(props, colliders, count, radius, limits) {
  const rng = new GodotRandom(777);
  const target = Math.min(count, capacity(props, FOREST.crate, limits));
  for (let i = 0; i < target; i += 1) {
    const angle = rng.randfRange(0, TAU);
    const distance = rng.randfRange(10, radius);
    placeStatic(
      props,
      colliders,
      FOREST.crate,
      Math.cos(angle) * distance,
      0.7,
      Math.sin(angle) * distance,
      1.4,
      rng.randfRange(0, 360),
      { r: 0.75, h: 1.5 },
    );
  }
}

function placeForestLandmarks(props, colliders, landmarks, limits) {
  const buildings = [
    { path: FOREST.shed, x: -60, z: 40, y: 0, scale: 1, rotation: 30, r: 2.6, h: 3.2, name: 'Abri du Nord' },
    { path: FOREST.shed, x: 80, z: -70, y: 0, scale: 1, rotation: 140, r: 2.6, h: 3.2, name: 'Abri de la Route' },
    { path: FOREST.shed, x: 12, z: -184, y: 0, scale: 1, rotation: 75, r: 2.6, h: 3.2, name: 'Relais Sud' },
    { path: FOREST.house3, x: 30, z: 90, y: 0, scale: 0.01, rotation: 45, r: 4.5, h: 12.8, name: 'Maison du Ruisseau' },
    { path: FOREST.house3, x: -110, z: -60, y: 0, scale: 0.01, rotation: 200, r: 4.5, h: 12.8, name: 'Ferme Ouest' },
    { path: FOREST.house3, x: -150, z: 120, y: 0, scale: 0.01, rotation: 35, r: 4.5, h: 12.8, name: 'Ferme du Nord' },
    { path: FOREST.house3, x: 120, z: -130, y: 0, scale: 0.01, rotation: 285, r: 4.5, h: 12.8, name: 'Chasseur Solitaire' },
    { path: FOREST.house4, x: 140, z: 30, y: 0, scale: 0.01, rotation: 110, r: 5, h: 14.6, name: 'Tour de Thalvorn' },
    { path: FOREST.house4, x: -20, z: 220, y: 0, scale: 0.01, rotation: 320, r: 5, h: 14.6, name: 'Tour de la Colline' },
    { path: FOREST.house4, x: 200, z: 120, y: 0, scale: 0.01, rotation: 65, r: 5, h: 14.6, name: 'Poste de Mireval' },
  ];
  for (const building of buildings) {
    if (capacity(props, building.path, limits) <= 0) continue;
    placeStatic(
      props, colliders, building.path,
      building.x, building.y, building.z, building.scale, building.rotation,
      { r: building.r, h: building.h },
    );
    addLandmark(landmarks, building.x, building.z, 'house', building.name);
  }

  const treeCover = [
    [-22, -46], [20, -42], [-26, 42], [24, 46],
    [-58, 54], [-44, 36], [42, 104], [26, 86],
    [88, -62], [70, -80], [152, 42], [130, 18],
    [-122, 10], [-138, -22], [124, 18], [142, 34],
    [6, 168], [-8, 196], [70, -226], [58, -252],
  ];
  treeCover.forEach((spot, index) => {
    const scale = 2.3 + (index % 5) * 0.22;
    placeStatic(
      props, colliders, FOREST.trees1,
      spot[0], 0, spot[1], scale, (index * 47) % 360,
      { r: 0.16 * scale, h: 2.8 * scale },
    );
  });

  const rocks = [
    [-28, -8, 1.2], [30, 12, 1.4], [72, -34, 1.1], [-82, 22, 1.3],
    [188, 116, 1.5], [66, -238, 1.2], [-160, 130, 1.1], [136, -142, 1.4],
  ];
  rocks.forEach((rock, index) => {
    placeStatic(
      props, colliders, FOREST.rocks,
      rock[0], 0.25, rock[1], rock[2], (index * 61) % 360,
      { r: rock[2] * 0.82, h: rock[2] * 1.2 },
    );
  });

  const crates = [
    [-4, -24], [8, 26], [50, 84], [-70, 34], [92, -78],
    [148, 26], [208, 128], [64, -232], [0, 158], [-162, -48],
    [118, -118], [-24, 210], [178, 118], [-96, 98],
  ];
  crates.forEach((spot, index) => {
    placeStatic(
      props, colliders, FOREST.crate,
      spot[0], 0.7, spot[1], 1.4, (index * 53) % 360,
      { r: 0.75, h: 1.5 },
    );
  });
}

function placeCityLandmarks(props, colliders, landmarks, limits) {
  const buildings = [
    { path: CITY_BUILDINGS[4], x: 54, z: 0, name: 'Bloc Est' },
    { path: CITY_BUILDINGS[7], x: -54, z: 0, name: 'Bloc Ouest' },
    { path: CITY_BUILDINGS[2], x: 0, z: 54, name: 'Bloc Nord' },
    { path: CITY_BUILDINGS[9], x: 0, z: -54, name: 'Bloc Sud' },
    { path: CITY_BUILDINGS[0], x: 80, z: 80, name: 'Tour Nord-Est' },
    { path: CITY_BUILDINGS[6], x: -80, z: -80, name: 'Entrepôt Sud-Ouest' },
  ];
  buildings.forEach((building, index) => {
    if (capacity(props, building.path, limits) <= 0) return;
    const scale = 5 + (index % 3) * 0.35;
    placeStatic(
      props, colliders, building.path,
      building.x, 0, building.z, scale, (index % 4) * 90,
      { r: 5.25, h: 3.4 * scale },
    );
    addLandmark(landmarks, building.x, building.z, 'house', building.name);
  });

  const barricades = [
    [26, 0], [0, 26], [-26, 0], [0, -26],
    [78, 26], [26, 78], [-78, -26], [-26, -78],
    [104, 0], [0, 104], [-104, 0], [0, -104],
  ];
  barricades.forEach((spot, index) => {
    placeStatic(
      props, colliders, CITY.crates,
      spot[0], 0.7, spot[1], 1.5, (index * 45) % 360,
      { r: 0.8, h: 1.5 },
    );
  });

  [[18, 18], [-18, 18], [18, -18], [-18, -18], [66, 66], [-66, -66]].forEach((spot, index) => {
    placeStatic(
      props, colliders, CITY.rocks,
      spot[0], 0.25, spot[1], 1.2, (index * 70) % 360,
      { r: 0.98, h: 1.4 },
    );
  });
}

function tryCityTree(props, colliders, path, x, z, scale, rotationDeg, limits) {
  if (capacity(props, path, limits) <= 0) return;
  if (Math.hypot(x, z) < 18) return;
  const collider = colliderFor(path, x, z, scale);
  if (collider && colliders.some((other) => Math.hypot(other.x - x, other.z - z) < other.r + collider.r + 1)) return;
  pushProp(props, path, x, groundOffset(path, scale), z, scale, rotationDeg * Math.PI / 180);
  if (collider) colliders.push(collider);
}

function placeCityTrees(props, colliders, limits) {
  const rng = new GodotRandom(9137);
  let streetTree = 0;
  for (const x of [-72, -54, -36, -18, 0, 18, 36, 54, 72]) {
    for (const z of [-63, -45, -27, 27, 45, 63]) {
      const path = streetTree % 2 === 0 ? FOREST.trees1 : FOREST.trees2;
      streetTree += 1;
      tryCityTree(props, colliders, path, x, z, rng.randfRange(2.1, 2.9), rng.randfRange(0, 360), limits);
    }
  }
  for (const x of [-126, -144]) {
    for (let z = -144; z <= 144; z += 36) {
      tryCityTree(props, colliders, FOREST.trees1, x, z, rng.randfRange(2.3, 3.1), rng.randfRange(0, 360), limits);
    }
  }
  for (const x of [126, 144]) {
    for (let z = -144; z <= 144; z += 36) {
      tryCityTree(props, colliders, FOREST.trees2, x, z, rng.randfRange(2.3, 3.1), rng.randfRange(0, 360), limits);
    }
  }
  for (const z of [-126, -144]) {
    for (let x = -108; x <= 108; x += 36) {
      tryCityTree(props, colliders, FOREST.trees1, x, z, rng.randfRange(1.8, 2.6), rng.randfRange(0, 360), limits);
    }
  }
  for (const z of [126, 144]) {
    for (let x = -108; x <= 108; x += 36) {
      tryCityTree(props, colliders, FOREST.trees2, x, z, rng.randfRange(1.8, 2.6), rng.randfRange(0, 360), limits);
    }
  }
  for (const [x, z] of [[-108, -108], [108, 108], [-108, 108], [108, -108]]) {
    tryCityTree(props, colliders, FOREST.deadTree, x, z, 1.6, rng.randfRange(0, 360), limits);
    tryCityTree(props, colliders, FOREST.stump, x + 8, z - 6, 1.8, rng.randfRange(0, 360), limits);
  }
}

function buildForest(limits) {
  const props = [];
  const colliders = [];
  const landmarks = [];
  placeForestLandmarks(props, colliders, landmarks, limits);
  placeProp(props, colliders, FOREST.trees1, 150, 2.1, 3.4, true, 30, limits);
  placeProp(props, colliders, FOREST.trees2, 100, 1.8, 2.8, true, 20, limits);
  placeProp(props, colliders, FOREST.trees1, 70, 1.8, 2.8, true, 24, limits);
  placeProp(props, colliders, FOREST.trees2, 70, 1.6, 2.4, true, 20, limits);
  placeProp(props, colliders, FOREST.deadTree, 55, 1.1, 2.1, true, 16, limits);
  placeProp(props, colliders, FOREST.stump, 40, 1.2, 2.2, true, 12, limits);
  placeProp(props, colliders, FOREST.shrubs, 110, 1.4, 2.4, true, 0, limits);
  placeProp(props, colliders, FOREST.shrubs4, 80, 1.2, 2.2, true, 0, limits);
  placeProp(props, colliders, FOREST.ferns, 90, 1.4, 2.6, true, 0, limits);
  placeProp(props, colliders, FOREST.rocks, 40, 0.6, 1.6, false, 0, limits);
  placeProp(props, colliders, FOREST.moss, 22, 1, 1.9, true, 0, limits);
  scatterCrates(props, colliders, 14, 90, limits);
  return { props, colliders, landmarks };
}

function buildCity(limits) {
  const props = [];
  const colliders = [];
  const landmarks = [];
  const rng = new GodotRandom(2026);
  placeCityLandmarks(props, colliders, landmarks, limits);
  const spacing = 18;
  for (let xIndex = -4; xIndex <= 4; xIndex += 1) {
    for (let zIndex = -4; zIndex <= 4; zIndex += 1) {
      const x = xIndex * spacing;
      const z = zIndex * spacing;
      if (Math.hypot(x, z) < 18) continue;
      if (landmarks.some((landmark) => Math.hypot(landmark.x - x, landmark.z - z) < 11)) continue;
      if (rng.randf() < 0.1) continue;
      const path = CITY_BUILDINGS[rng.randi() % CITY_BUILDINGS.length];
      if (capacity(props, path, limits) <= 0) continue;
      const scale = rng.randfRange(3.6, 5.4);
      const rotation = (rng.randi() % 4) * 90;
      placeStatic(props, colliders, path, x, 0, z, scale, rotation, { r: 4.6, h: 3.4 * scale });
    }
  }
  placeProp(props, colliders, CITY.rocks, 25, 0.5, 1.2, false, 0, limits);
  placeProp(props, colliders, CITY.crates, 30, 1, 1.6, true, 0, limits);
  scatterCrates(props, colliders, 10, 80, limits);
  placeCityTrees(props, colliders, limits);
  return { props, colliders, landmarks };
}

export function buildExactWorldSpec(biome, limits = {}) {
  return biome === 'forest' ? buildForest(limits) : buildCity(limits);
}
