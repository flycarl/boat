import * as THREE from 'three';

export const PIRATE_PALETTE = {
  deepTeal: '#075a70',
  lagoon: '#18b9c2',
  foam: '#e9ffff',
  sand: '#f2c96f',
  sandLight: '#ffe5a0',
  grass: '#5f9b3d',
  leaf: '#4f8c32',
  leafLight: '#83b54c',
  rock: '#6f756e',
  rockLight: '#a6a18a',
  walnut: '#55341f',
  warmWood: '#8a562d',
  oldGold: '#c89435',
  parchment: '#f3dfb0',
  coral: '#cf513d',
  navy: '#173e58',
} as const;

type SkinRole = 'hull' | 'deck' | 'accent' | 'metal';

function material(
  color: THREE.ColorRepresentation,
  options: { roughness?: number; metalness?: number; emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; role?: SkinRole } = {},
): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.04,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
    flatShading: true,
  });
  if (options.role) result.userData.skinRole = options.role;
  return result;
}

function finish(group: THREE.Object3D): void {
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.some((entry) => entry.transparent || entry instanceof THREE.MeshBasicMaterial)) {
      node.castShadow = false;
      node.receiveShadow = false;
      return;
    }
    node.castShadow = true;
    node.receiveShadow = true;
  });
}

function pushTriangle(target: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function createHullGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const sections = 10;
  const top: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  for (let index = 0; index <= sections; index += 1) {
    const t = index / sections;
    const z = THREE.MathUtils.lerp(-length * 0.58, length * 0.5, t);
    const silhouette = Math.pow(Math.sin(Math.PI * Math.min(0.995, Math.max(0.005, t))), 0.52);
    const sternFullness = THREE.MathUtils.lerp(0.74, 1, t);
    const halfWidth = width * 0.5 * silhouette * sternFullness;
    top.push(new THREE.Vector3(halfWidth, height * (0.82 + silhouette * 0.18), z));
    lower.push(new THREE.Vector3(halfWidth * 0.46, height * (0.14 + silhouette * 0.12), z));
  }
  for (let index = 0; index < sections; index += 1) {
    const lt0 = top[index].clone().multiply(new THREE.Vector3(-1, 1, 1));
    const lt1 = top[index + 1].clone().multiply(new THREE.Vector3(-1, 1, 1));
    const lb0 = lower[index].clone().multiply(new THREE.Vector3(-1, 1, 1));
    const lb1 = lower[index + 1].clone().multiply(new THREE.Vector3(-1, 1, 1));
    pushTriangle(positions, lt0, lb0, lb1);
    pushTriangle(positions, lt0, lb1, lt1);
    pushTriangle(positions, top[index], top[index + 1], lower[index + 1]);
    pushTriangle(positions, top[index], lower[index + 1], lower[index]);
    pushTriangle(positions, lb0, lower[index], lower[index + 1]);
    pushTriangle(positions, lb0, lower[index + 1], lb1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createDeckGeometry(length: number, width: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -length * 0.53);
  shape.quadraticCurveTo(width * 0.52, -length * 0.34, width * 0.46, 0);
  shape.quadraticCurveTo(width * 0.42, length * 0.42, width * 0.3, length * 0.48);
  shape.lineTo(-width * 0.3, length * 0.48);
  shape.quadraticCurveTo(-width * 0.42, length * 0.42, -width * 0.46, 0);
  shape.quadraticCurveTo(-width * 0.52, -length * 0.34, 0, -length * 0.53);
  return new THREE.ShapeGeometry(shape, 4);
}

function railCurve(side: number, length: number, width: number, y: number): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(Array.from({ length: 7 }, (_, index) => {
    const t = index / 6;
    const z = THREE.MathUtils.lerp(-length * 0.54, length * 0.46, t);
    const silhouette = Math.pow(Math.sin(Math.PI * Math.min(0.99, Math.max(0.01, t))), 0.52);
    return new THREE.Vector3(side * width * 0.48 * silhouette, y + silhouette * 0.05, z);
  }));
}

export function createStorybookVesselHull(
  level: number,
  colors: { hull: THREE.ColorRepresentation; deck: THREE.ColorRepresentation; accent: THREE.ColorRepresentation },
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'storybook-vessel-hull';
  const sizeTier = level <= 2 ? 0 : level <= 5 ? 1 : level <= 9 ? 2 : 3;
  const length = [1.88, 2.5, 3.15, 4.05][sizeTier];
  const width = [1.02, 1.26, 1.58, 2.08][sizeTier];
  const hullY = level <= 2 ? 0.54 : 0.6;
  const hullMat = material(colors.hull, { roughness: 0.66, role: 'hull' });
  const darkWood = material('#2c211c', { roughness: 0.76, role: 'hull' });
  const deckMat = material(colors.deck, { roughness: 0.82, role: 'deck' });
  const trimMat = material(colors.accent, { roughness: 0.38, metalness: 0.38, role: 'accent' });
  const metalMat = material('#29323a', { roughness: 0.32, metalness: 0.68, role: 'metal' });

  const shell = new THREE.Mesh(createHullGeometry(length, width, 0.62), hullMat);
  shell.name = 'curved-hull-shell';
  shell.position.y = hullY;
  const keel = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, length * 0.72, 4, 8), darkWood);
  keel.rotation.x = Math.PI / 2;
  keel.position.set(0, hullY + 0.14, 0.02);
  const deck = new THREE.Mesh(createDeckGeometry(length * 0.92, width * 0.82), deckMat);
  deck.rotation.x = Math.PI / 2;
  deck.position.y = hullY + 0.63;
  group.add(shell, keel, deck);

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve(side, length, width, hullY + 1.17), 28, 0.055, 6, false), trimMat);
    rail.name = side < 0 ? 'port-gunwale' : 'starboard-gunwale';
    group.add(rail);
    for (let index = 1; index < 6; index += 1) {
      const t = index / 6;
      const z = THREE.MathUtils.lerp(-length * 0.49, length * 0.42, t);
      const silhouette = Math.pow(Math.sin(Math.PI * t), 0.52);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.25, 6), trimMat);
      post.position.set(side * width * 0.48 * silhouette, hullY + 1.04, z);
      group.add(post);
    }
  }

  const bowCap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 6), trimMat);
  bowCap.rotation.x = -Math.PI / 2;
  bowCap.position.set(0, hullY + 0.98, -length * 0.69);
  const sternBand = new THREE.Mesh(new THREE.TorusGeometry(width * 0.28, 0.045, 6, 18, Math.PI), trimMat);
  sternBand.rotation.set(Math.PI / 2, 0, Math.PI);
  sternBand.position.set(0, hullY + 0.92, length * 0.5);
  group.add(bowCap, sternBand);

  const portholeCount = Math.max(2, Math.min(5, Math.ceil(level / 2)));
  for (const side of [-1, 1]) {
    for (let index = 0; index < portholeCount; index += 1) {
      const z = THREE.MathUtils.lerp(-length * 0.18, length * 0.32, portholeCount === 1 ? 0.5 : index / (portholeCount - 1));
      const port = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.023, 6, 14), trimMat);
      port.rotation.y = Math.PI / 2;
      port.position.set(side * width * 0.5, hullY + 0.72, z);
      group.add(port);
      const dark = new THREE.Mesh(new THREE.CircleGeometry(0.054, 12), metalMat);
      dark.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      dark.position.set(side * (width * 0.505), hullY + 0.72, z);
      group.add(dark);
    }
  }

  for (const side of [-1, 1]) {
    const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), material('#ffd56d', { emissive: '#b96b1c', emissiveIntensity: 0.65, roughness: 0.25 }));
    lantern.position.set(side * width * 0.31, hullY + 1.26, length * 0.38);
    group.add(lantern);
  }
  finish(group);
  return group;
}

function personMaterials(shirtColor: THREE.ColorRepresentation) {
  return {
    skin: material('#d79562', { roughness: 0.78 }),
    skinLight: material('#efbd89', { roughness: 0.76 }),
    shirt: material(shirtColor, { roughness: 0.86 }),
    trousers: material(PIRATE_PALETTE.navy, { roughness: 0.82 }),
    leather: material('#3b261a', { roughness: 0.88 }),
    gold: material(PIRATE_PALETTE.oldGold, { roughness: 0.42, metalness: 0.42 }),
    eye: material('#1b1714', { roughness: 0.8 }),
  };
}

function createLimb(radius: number, length: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 7), mat);
}

export function createStylizedCrew(shirtColor: THREE.ColorRepresentation = PIRATE_PALETTE.coral): THREE.Group {
  const crew = new THREE.Group();
  crew.name = 'crew-member';
  crew.position.set(-0.27, 0.94, 0.32);
  const mats = personMaterials(shirtColor);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.24, 5, 9), mats.shirt);
  torso.position.y = 0.34;
  torso.scale.set(1.05, 1, 0.78);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.026, 6, 12), mats.leather);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.22;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.025), mats.gold);
  buckle.position.set(0, 0.22, -0.125);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 9), mats.skinLight);
  head.position.y = 0.7;
  head.scale.set(0.92, 1, 0.92);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), mats.skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.69, -0.13);
  for (const x of [-0.045, 0.045]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), mats.eye);
    eye.position.set(x, 0.735, -0.118);
    crew.add(eye);
  }
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.035, 14), mats.leather);
  brim.position.y = 0.81;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.leather);
  crown.position.y = 0.79;
  crown.scale.set(1, 0.72, 1);
  for (const x of [-0.145, 0.145]) {
    const arm = createLimb(0.038, 0.22, mats.skin);
    arm.position.set(x, 0.39, -0.01);
    arm.rotation.z = x < 0 ? -0.45 : 0.45;
    crew.add(arm);
  }
  for (const x of [-0.07, 0.07]) {
    const leg = createLimb(0.044, 0.18, mats.trousers);
    leg.position.set(x, 0.05, 0);
    crew.add(leg);
  }
  crew.add(torso, belt, buckle, head, nose, brim, crown);
  finish(crew);
  return crew;
}

export function createStylizedCastaway(flagColor: THREE.ColorRepresentation): THREE.Group {
  const group = createStylizedCrew('#e8e0c4');
  group.name = 'storybook-castaway';
  group.position.set(0, 0, 0);
  group.scale.setScalar(1.12);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 12), material(PIRATE_PALETTE.coral, { roughness: 0.84 }));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.58;
  group.add(scarf);
  const wavingArm = createLimb(0.04, 0.28, material('#d79562', { roughness: 0.78 }));
  wavingArm.name = 'waving-arm';
  wavingArm.position.set(0.2, 0.62, 0);
  wavingArm.rotation.z = -2.25;
  group.add(wavingArm);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.88, 6), material('#5d3a20', { roughness: 0.9 }));
  pole.position.set(-0.32, 0.5, 0.04);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.24, 3, 1), new THREE.MeshStandardMaterial({ color: flagColor, roughness: 0.82, side: THREE.DoubleSide }));
  flag.position.set(-0.1, 0.78, 0.04);
  group.add(pole, flag);
  finish(group);
  return group;
}

function seeded(seed: number, index: number): number {
  return Math.sin(seed * 91.17 + index * 37.31) * 0.5 + 0.5;
}

function createIslandGeometry(radius: number, height: number, seed: number, segments = 18): THREE.BufferGeometry {
  const positions: number[] = [];
  const topCenter = new THREE.Vector3(0, height, 0);
  const bottomCenter = new THREE.Vector3(0, -0.05, 0);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const angleA = index / segments * Math.PI * 2;
    const angleB = next / segments * Math.PI * 2;
    const radiusA = radius * (0.84 + seeded(seed, index) * 0.22);
    const radiusB = radius * (0.84 + seeded(seed, next) * 0.22);
    const topA = new THREE.Vector3(Math.cos(angleA) * radiusA, height + (seeded(seed + 3, index) - 0.5) * 0.08, Math.sin(angleA) * radiusA * 0.86);
    const topB = new THREE.Vector3(Math.cos(angleB) * radiusB, height + (seeded(seed + 3, next) - 0.5) * 0.08, Math.sin(angleB) * radiusB * 0.86);
    const bottomA = new THREE.Vector3(topA.x * 1.13, -0.05, topA.z * 1.13);
    const bottomB = new THREE.Vector3(topB.x * 1.13, -0.05, topB.z * 1.13);
    pushTriangle(positions, topCenter, topA, topB);
    pushTriangle(positions, topA, bottomA, bottomB);
    pushTriangle(positions, topA, bottomB, topB);
    pushTriangle(positions, bottomCenter, bottomB, bottomA);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createPalm(seed: number, scale = 1): THREE.Group {
  const group = new THREE.Group();
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05 * Math.sin(seed), 0.42 * scale, 0),
    new THREE.Vector3(0.13 * Math.sin(seed * 1.7), 0.86 * scale, 0.04 * Math.cos(seed)),
    new THREE.Vector3(0.2 * Math.sin(seed * 1.4), 1.3 * scale, 0.1 * Math.cos(seed * 0.7)),
  ];
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.09 * scale, 7, false), material('#8f5d2d', { roughness: 0.92 }));
  group.add(trunk);
  const crown = points[points.length - 1];
  const leafShape = new THREE.Shape();
  leafShape.moveTo(-0.05 * scale, 0);
  leafShape.quadraticCurveTo(-0.17 * scale, 0.38 * scale, 0, 0.84 * scale);
  leafShape.quadraticCurveTo(0.17 * scale, 0.38 * scale, 0.05 * scale, 0);
  const leafGeometry = new THREE.ShapeGeometry(leafShape, 3);
  for (let index = 0; index < 7; index += 1) {
    const leaf = new THREE.Mesh(leafGeometry, material(index % 2 ? PIRATE_PALETTE.leaf : PIRATE_PALETTE.leafLight, { roughness: 0.9 }));
    leaf.position.copy(crown);
    leaf.rotation.set(-Math.PI / 2.35 + (index % 2) * 0.12, index / 7 * Math.PI * 2 + seed, (index % 3 - 1) * 0.12);
    group.add(leaf);
  }
  for (let index = 0; index < 3; index += 1) {
    const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.075 * scale, 7, 5), material('#5a3d22', { roughness: 0.94 }));
    coconut.position.copy(crown).add(new THREE.Vector3((index - 1) * 0.08, -0.08, index % 2 ? 0.05 : -0.04));
    group.add(coconut);
  }
  finish(group);
  return group;
}

export function createStorybookIsland(scale: number, seed: number): THREE.Group {
  const island = new THREE.Group();
  island.name = 'storybook-island';
  const cliff = new THREE.Mesh(createIslandGeometry(3.05 * scale, 0.48, seed), material(PIRATE_PALETTE.rockLight, { roughness: 0.96 }));
  const sand = new THREE.Mesh(createIslandGeometry(2.92 * scale, 0.63, seed + 7), material(PIRATE_PALETTE.sand, { roughness: 0.94 }));
  const grass = new THREE.Mesh(createIslandGeometry(2.08 * scale, 0.72, seed + 13), material(PIRATE_PALETTE.grass, { roughness: 0.96 }));
  island.add(cliff, sand, grass);
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2 + seed * 0.19;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry((0.22 + seeded(seed, index) * 0.18) * scale, 0), material(index % 2 ? PIRATE_PALETTE.rock : PIRATE_PALETTE.rockLight, { roughness: 0.98 }));
    rock.position.set(Math.cos(angle) * (2.45 + seeded(seed + 4, index) * 0.42) * scale, 0.5, Math.sin(angle) * (2.05 + seeded(seed + 9, index) * 0.35) * scale);
    rock.rotation.set(index * 0.43, angle, index * 0.29);
    rock.scale.set(1, 0.75 + seeded(seed + 12, index) * 0.55, 0.82);
    island.add(rock);
  }
  const palmCount = scale > 1.6 ? 5 : scale > 1.2 ? 4 : 3;
  for (let index = 0; index < palmCount; index += 1) {
    const palm = createPalm(seed + index * 1.7, 0.86 + seeded(seed + 22, index) * 0.34);
    const angle = index / palmCount * Math.PI * 2 + seed * 0.33;
    const distance = (0.55 + seeded(seed + 17, index) * 0.95) * scale;
    palm.position.set(Math.cos(angle) * distance, 0.66, Math.sin(angle) * distance * 0.74);
    palm.rotation.y = angle + Math.PI;
    island.add(palm);
  }
  for (let index = 0; index < 8; index += 1) {
    const bush = new THREE.Mesh(new THREE.DodecahedronGeometry((0.13 + seeded(seed + 30, index) * 0.12) * scale, 0), material(index % 3 ? '#588f37' : '#b65c3b', { roughness: 0.96 }));
    const angle = index / 8 * Math.PI * 2 + seed;
    bush.position.set(Math.cos(angle) * (1.45 + seeded(seed, index) * 0.4) * scale, 0.82, Math.sin(angle) * (1.1 + seeded(seed + 2, index) * 0.35) * scale);
    island.add(bush);
  }
  const shallows = new THREE.Mesh(new THREE.CircleGeometry(4.35 * scale, 48), new THREE.MeshBasicMaterial({ color: '#74e1d2', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  shallows.rotation.x = -Math.PI / 2;
  shallows.scale.set(1.06, 0.87, 1);
  shallows.position.y = 0.015;
  island.add(shallows);
  for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
    const foam = new THREE.Mesh(new THREE.RingGeometry((3.15 + ringIndex * 0.28) * scale, (3.21 + ringIndex * 0.28) * scale, 48), new THREE.MeshBasicMaterial({ color: PIRATE_PALETTE.foam, transparent: true, opacity: 0.28 - ringIndex * 0.06, depthWrite: false, side: THREE.DoubleSide }));
    foam.rotation.x = -Math.PI / 2;
    foam.rotation.z = seed + ringIndex * 0.45;
    foam.scale.set(1.06, 0.86, 1);
    foam.position.y = 0.08 + ringIndex * 0.012;
    island.add(foam);
  }
  finish(island);
  return island;
}

export function createTimberDock(length: number, width: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'storybook-dock';
  const plankMat = material('#8b572f', { roughness: 0.94 });
  const edgeMat = material('#4b3422', { roughness: 0.96 });
  const plankCount = Math.max(5, Math.round(length / 0.42));
  for (let index = 0; index < plankCount; index += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(length / plankCount * 0.9, 0.11, width), index % 3 ? plankMat : edgeMat);
    plank.position.x = -length * 0.5 + (index + 0.5) * length / plankCount;
    plank.rotation.y = (seeded(length * 13, index) - 0.5) * 0.035;
    group.add(plank);
  }
  for (const x of [-length * 0.44, length * 0.44]) {
    for (const z of [-width * 0.45, width * 0.45]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.86, 7), edgeMat);
      post.position.set(x, -0.18, z);
      group.add(post);
    }
  }
  finish(group);
  return group;
}

export function createShipwrightLandmark(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shipwright-landmark';
  const timber = material(PIRATE_PALETTE.warmWood, { roughness: 0.9 });
  const dark = material('#3b2a20', { roughness: 0.92 });
  const roof = material('#a84632', { roughness: 0.84 });
  const gold = material(PIRATE_PALETTE.oldGold, { roughness: 0.42, metalness: 0.38 });
  const hut = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.84, 1.05, 6), timber);
  hut.position.y = 1.22;
  const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.65, 6), roof);
  roofMesh.position.y = 2.05;
  const doorway = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.64, 0.08), dark);
  doorway.position.set(0, 1.08, -0.77);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 8, 24), gold);
  wheel.position.set(0, 2.62, 0);
  for (let index = 0; index < 8; index += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.62, 0.035), gold);
    spoke.position.copy(wheel.position);
    spoke.rotation.z = index / 8 * Math.PI;
    group.add(spoke);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 1.6, 7), dark);
  mast.position.set(0, 2.45, 0.22);
  group.add(hut, roofMesh, doorway, wheel, mast);
  finish(group);
  return group;
}

export function createBankLandmark(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bank-landmark';
  const stone = material('#a8a68f', { roughness: 0.84, metalness: 0.08 });
  const darkStone = material('#5f665f', { roughness: 0.9 });
  const teal = material('#17677a', { roughness: 0.5, metalness: 0.28 });
  const gold = material('#dbab43', { roughness: 0.32, metalness: 0.62, emissive: '#7c4d0b', emissiveIntensity: 0.12 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.98, 1.45, 8), stone);
  tower.position.y = 1.25;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.18, 0.72, 8), teal);
  roof.position.y = 2.33;
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20), darkStone);
  door.rotation.x = Math.PI / 2;
  door.position.set(0, 1.15, -0.91);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 20), gold);
  coin.rotation.x = Math.PI / 2;
  coin.position.set(0, 1.18, -1);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.1, 7, 20, Math.PI), gold);
  arch.rotation.z = Math.PI;
  arch.position.set(0, 1.3, -0.94);
  group.add(tower, roof, door, coin, arch);
  finish(group);
  return group;
}
