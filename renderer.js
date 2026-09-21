import * as THREE from './vendor/three.module.js';
import { dinoByTier } from './dinos.js';
import { teamPower, canBeat } from './engine.js';

const LANE_WIDTH = 2.4;
const TRACK_WIDTH = 8.35;
const TRACK_HEIGHT = 0.72;
const CHUNK_LENGTH = 18;
const CHUNK_COUNT = 18;
const NEAR_BEHIND = 18;
const FAR_AHEAD = 145;
const BOSS_GAP = 4.5;
const LEADER_VISUAL_POWER = 10;

const PALETTES = [
  { name: 'Palmenbaai', sky: 0x65d8ff, water: 0x169bd5, ground: 0xf4cf67, accent: 0xff5f57, foliage: 0x54be52 },
  { name: 'Bamboebos', sky: 0x91e8bb, water: 0x35aab2, ground: 0x59b95f, accent: 0xffe066, foliage: 0x278c50 },
  { name: 'Koraalkust', sky: 0x70ddf2, water: 0x087fa9, ground: 0xef9f75, accent: 0xff4f9a, foliage: 0x42bc77 },
  { name: 'Kristalgrotten', sky: 0x8076d9, water: 0x293b91, ground: 0x695a8d, accent: 0x63f4ff, foliage: 0x6bd0ba },
  { name: 'Ambermoeras', sky: 0xd4cf68, water: 0x438b75, ground: 0x8c8349, accent: 0xffb347, foliage: 0x526f39 },
  { name: 'Vulkaanrand', sky: 0xdd6b52, water: 0x49385f, ground: 0x4a4145, accent: 0xffcf40, foliage: 0x7e5945 },
  { name: 'Wolkenriffen', sky: 0xb9e8ff, water: 0x689ed4, ground: 0x8ed1a1, accent: 0xff7fa7, foliage: 0x58af7d },
  { name: 'Sterrentoendra', sky: 0x7189d8, water: 0x3b70a0, ground: 0xb4d9de, accent: 0xf6f08a, foliage: 0x7bb7b0 },
  { name: 'Oerwoudtempel', sky: 0x4bbf91, water: 0x187f83, ground: 0x547b45, accent: 0xffc857, foliage: 0x28633b },
  { name: 'Komeeteiland', sky: 0x463c84, water: 0x283664, ground: 0x745b7e, accent: 0x8bffcf, foliage: 0x52788d },
];

const COLORS = {
  white: 0xffffff,
  ink: 0x153850,
  cyanSide: 0x18bcd4,
  pink: 0xff6ca8,
  green: 0x45dc70,
  red: 0xff5367,
  gold: 0xffcf32,
  orange: 0xff8f2f,
  brown: 0x8b5737,
  rock: 0x7b8193,
  lava: 0xff552e,
  shield: 0x57e8ff,
};

function seeded(value) {
  let x = (value | 0) + 0x6d2b79f5;
  return () => {
    x |= 0;
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same growth curve for the player, rivals and the boss, so sizes compare honestly.
export function dinoScale(power) {
  return THREE.MathUtils.clamp(0.78 + Math.sqrt(Math.max(0, power || 0)) * 0.075, 0.9, 1.9);
}

function markShadows(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return root;
}

export class DinoRenderer {
  constructor(canvas) {
    if (!canvas) throw new Error('DinoRenderer: een canvas-element is vereist.');

    this.canvas = canvas;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error(`DinoRenderer: WebGL kon niet worden gestart (${error?.message || 'onbekende fout'}).`);
    }
    if (!this.renderer.getContext()) throw new Error('DinoRenderer: WebGL is niet beschikbaar op dit apparaat.');

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 310);
    this.clockTime = 0;
    this.level = null;
    this.disposed = false;
    this.activeObjects = new Map();
    this.objectPools = new Map();
    this.effects = [];
    this.previousCollected = new Set();
    this.lastPower = null;
    this.lastHits = 0;
    this.hitFlash = 0;
    this.finaleTime = 0;
    this.finaleBurst = false;
    this.lastMergeId = null;
    this.lastLossId = null;
    this.mergeAnim = null;
    this.cameraLook = new THREE.Vector3();
    // Team view: camera offsets relative to the leader (tuned in the browser via ?qa).
    this.teamCam = { x: 20, y: 11.5, z: 1.2, lookY: -4.1, lookZ: -1.6, portraitX: 24, portraitY: 13, portraitZ: 0.4, portraitLookY: -10, portraitLookZ: -0.4 };
    this.currentPalette = PALETTES[0];
    this.geometries = this._createGeometries();
    this.materials = this._createMaterials(this.currentPalette);

    this.world = new THREE.Group();
    this.trackRoot = new THREE.Group();
    this.objectRoot = new THREE.Group();
    this.decorRoot = new THREE.Group();
    this.effectRoot = new THREE.Group();
    this.scene.add(this.world);
    this.world.add(this.trackRoot, this.objectRoot, this.decorRoot, this.effectRoot);

    this._setupLights();
    this._setupWorld();
    this.mergeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.09, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, depthWrite: false })
    );
    this.mergeRing.rotation.x = -Math.PI / 2;
    this.mergeRing.visible = false;
    this.effectRoot.add(this.mergeRing);
    // A golden beam of light marks an evolution, visible even from the team camera.
    this.mergeBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.7, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    this.mergeBeam.visible = false;
    this.effectRoot.add(this.mergeBeam);
    this.player = this._createDino({ body: 0x71dc52, belly: 0xd5f59c, spikes: 0xffd744, size: 1 });
    this.world.add(this.player.root);
    this.player.root.rotation.y = 0;
    this.teamRoot = new THREE.Group();
    this.teamDinos = new Map();
    this.teamPools = new Map();
    this.world.add(this.teamRoot);
    this.forkRoot = new THREE.Group();
    this.world.add(this.forkRoot);

    this.boss = null;
    this.bossLabel = null;
    this.finishSet = null;
    this.resize();
  }

  _createGeometries() {
    return {
      sphere: new THREE.SphereGeometry(1, 18, 13),
      sphereLow: new THREE.SphereGeometry(1, 10, 7),
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
      cone: new THREE.ConeGeometry(1, 1, 10),
      coin: new THREE.CylinderGeometry(0.44, 0.44, 0.13, 16),
      ring: new THREE.TorusGeometry(0.55, 0.13, 8, 18),
      arch: new THREE.TorusGeometry(1.02, 0.19, 10, 24, Math.PI),
      plane: new THREE.PlaneGeometry(1, 1),
      tetra: new THREE.TetrahedronGeometry(1, 1),
    };
  }

  _createMaterials(palette) {
    const standard = (color, roughness = 0.72, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      track: standard(palette.ground, 0.88),
      side: standard(COLORS.cyanSide, 0.62),
      pink: standard(COLORS.pink, 0.55),
      white: standard(COLORS.white, 0.5),
      ink: standard(COLORS.ink, 0.55),
      green: standard(COLORS.green, 0.62),
      red: standard(COLORS.red, 0.62),
      gold: standard(COLORS.gold, 0.38, 0.18),
      orange: standard(COLORS.orange, 0.66),
      brown: standard(COLORS.brown, 0.92),
      rock: standard(COLORS.rock, 0.94),
      lava: new THREE.MeshStandardMaterial({ color: COLORS.lava, emissive: 0xff3a0a, emissiveIntensity: 0.95, roughness: 0.5 }),
      lavaRim: standard(0x4a1a12, 0.9),
      shield: new THREE.MeshStandardMaterial({ color: COLORS.shield, emissive: 0x0b78a6, emissiveIntensity: 0.45, transparent: true, opacity: 0.72 }),
      foliage: standard(palette.foliage, 0.78),
      gatePanelGreen: new THREE.MeshBasicMaterial({ color: 0x7dffa0, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
      gatePanelRed: new THREE.MeshBasicMaterial({ color: 0xff6b7d, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      sand: standard(0xffda8a, 0.95),
      water: new THREE.MeshStandardMaterial({ color: palette.water, roughness: 0.26, metalness: 0.05 }),
    };
  }

  _setupLights() {
    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x16869c, 2.25);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xfff0cf, 3.4);
    this.sun.position.set(-10, 19, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -14;
    this.sun.shadow.camera.right = 14;
    this.sun.shadow.camera.top = 20;
    this.sun.shadow.camera.bottom = -12;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 55;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
  }

  _setupWorld() {
    this.scene.background = new THREE.Color(this.currentPalette.sky);
    this.scene.fog = new THREE.Fog(this.currentPalette.sky, 45, 190);

    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(150, 360), this.materials.water);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = -1.18;
    this.ocean.receiveShadow = true;
    this.world.add(this.ocean);

    this.trackChunks = [];
    for (let i = 0; i < CHUNK_COUNT; i += 1) {
      const chunk = this._createTrackChunk(i);
      this.trackChunks.push(chunk);
      this.trackRoot.add(chunk);
    }

    this.decorSlots = [];
    for (let i = 0; i < 20; i += 1) {
      const deco = this._createIsland(i);
      this.decorSlots.push(deco);
      this.decorRoot.add(deco);
    }

    this.clouds = [];
    for (let i = 0; i < 9; i += 1) {
      const cloud = new THREE.Group();
      for (let puff = 0; puff < 4; puff += 1) {
        const mesh = new THREE.Mesh(this.geometries.sphereLow, this.materials.white);
        mesh.scale.set(1.6 + puff * 0.18, 0.55 + (puff % 2) * 0.22, 0.72);
        mesh.position.set((puff - 1.5) * 1.05, (puff % 2) * 0.3, 0);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        cloud.add(mesh);
      }
      cloud.position.set((i % 2 ? 1 : -1) * (13 + (i % 3) * 7), 10 + (i % 4) * 2, -i * 35);
      cloud.scale.setScalar(0.72 + (i % 3) * 0.22);
      this.clouds.push(cloud);
      this.decorRoot.add(cloud);
    }
  }

  _createTrackChunk(index) {
    const group = new THREE.Group();
    const slab = new THREE.Mesh(this.geometries.box, this.materials.track);
    slab.scale.set(TRACK_WIDTH, TRACK_HEIGHT, CHUNK_LENGTH + 0.08);
    slab.position.y = -0.38;
    slab.receiveShadow = true;
    group.add(slab);

    for (const sideX of [-1, 1]) {
      const side = new THREE.Mesh(this.geometries.box, this.materials.side);
      side.scale.set(0.35, 1.08, CHUNK_LENGTH + 0.12);
      side.position.set(sideX * (TRACK_WIDTH / 2 + 0.15), -0.59, 0);
      side.receiveShadow = true;
      group.add(side);
    }

    for (let z = -6.2; z <= 6.2; z += 6.2) {
      const chevron = new THREE.Group();
      for (const sideX of [-1, 1]) {
        const bar = new THREE.Mesh(this.geometries.box, this.materials.pink);
        bar.scale.set(0.34, 0.035, 2.75);
        bar.position.set(sideX * 0.95, 0.012, z);
        bar.rotation.y = sideX * 0.57;
        bar.castShadow = false;
        chevron.add(bar);
      }
      group.add(chevron);
    }
    group.userData.slot = index;
    return group;
  }

  _createIsland(seedValue) {
    const random = seeded(seedValue * 1009 + 17);
    const group = new THREE.Group();
    const base = new THREE.Mesh(this.geometries.sphereLow, this.materials.sand);
    base.scale.set(2.5 + random() * 2.8, 0.45, 1.8 + random() * 2.5);
    base.position.y = -1.15;
    group.add(base);

    const palmCount = random() > 0.52 ? 2 : 1;
    for (let p = 0; p < palmCount; p += 1) {
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(this.geometries.cylinder, this.materials.brown);
      trunk.scale.set(0.17, 1.6 + random() * 0.5, 0.17);
      trunk.position.y = 0.25;
      trunk.rotation.z = (random() - 0.5) * 0.18;
      palm.add(trunk);
      for (let j = 0; j < 6; j += 1) {
        const leaf = new THREE.Mesh(this.geometries.sphereLow, this.materials.foliage);
        leaf.scale.set(0.28, 0.09, 1.15);
        leaf.position.set(Math.sin(j * Math.PI / 3) * 0.55, 1.9, Math.cos(j * Math.PI / 3) * 0.55);
        leaf.rotation.y = j * Math.PI / 3;
        leaf.rotation.x = 0.25;
        palm.add(leaf);
      }
      palm.position.x = (p - 0.5) * 1.25;
      palm.position.z = (random() - 0.5) * 1.2;
      group.add(palm);
    }
    group.scale.setScalar(0.82 + random() * 0.45);
    return markShadows(group);
  }

  _createDino(colors) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.66 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: colors.belly, roughness: 0.73 });
    const spikeMat = new THREE.MeshStandardMaterial({ color: colors.spikes, roughness: 0.58 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x132537, roughness: 0.38 });

    const body = new THREE.Mesh(this.geometries.sphere, bodyMat);
    body.scale.set(0.76, 0.95, 1.05);
    body.position.y = 1.18;
    rig.add(body);
    const belly = new THREE.Mesh(this.geometries.sphere, bellyMat);
    belly.scale.set(0.58, 0.72, 0.75);
    belly.position.set(0, 1.12, -0.42);
    rig.add(belly);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.82, -0.68);
    const head = new THREE.Mesh(this.geometries.sphere, bodyMat);
    head.scale.set(0.67, 0.64, 0.72);
    headPivot.add(head);
    const snout = new THREE.Mesh(this.geometries.sphere, bellyMat);
    snout.scale.set(0.55, 0.34, 0.55);
    snout.position.set(0, -0.09, -0.53);
    headPivot.add(snout);
    for (const eyeX of [-1, 1]) {
      const eyeWhite = new THREE.Mesh(this.geometries.sphereLow, this.materials.white);
      eyeWhite.scale.set(0.15, 0.18, 0.105);
      eyeWhite.position.set(eyeX * 0.31, 0.17, -0.55);
      headPivot.add(eyeWhite);
      const pupil = new THREE.Mesh(this.geometries.sphereLow, eyeMat);
      pupil.scale.set(0.075, 0.09, 0.055);
      pupil.position.set(eyeX * 0.31, 0.17, -0.64);
      headPivot.add(pupil);
    }
    rig.add(headPivot);

    const tail = new THREE.Group();
    tail.position.set(0, 1.22, 0.76);
    for (let i = 0; i < 4; i += 1) {
      const part = new THREE.Mesh(this.geometries.sphereLow, bodyMat);
      part.scale.set(0.5 - i * 0.09, 0.34 - i * 0.045, 0.62);
      part.position.z = i * 0.47;
      part.position.y = -i * 0.1;
      tail.add(part);
    }
    rig.add(tail);

    for (let i = 0; i < 5; i += 1) {
      const spike = new THREE.Mesh(this.geometries.cone, spikeMat);
      spike.scale.setScalar(0.16 + (2 - Math.abs(i - 2)) * 0.025);
      spike.position.set(0, 2.28 - i * 0.27, -0.42 + i * 0.42);
      spike.rotation.x = Math.PI / 2;
      rig.add(spike);
    }

    const legs = [];
    for (const x of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(x * 0.47, 0.68, 0.12);
      const thigh = new THREE.Mesh(this.geometries.sphereLow, bodyMat);
      thigh.scale.set(0.31, 0.58, 0.35);
      thigh.position.y = -0.25;
      leg.add(thigh);
      const foot = new THREE.Mesh(this.geometries.sphereLow, bellyMat);
      foot.scale.set(0.32, 0.18, 0.5);
      foot.position.set(0, -0.69, -0.13);
      leg.add(foot);
      rig.add(leg);
      legs.push(leg);
    }

    const arms = [];
    for (const x of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(x * 0.61, 1.52, -0.5);
      const limb = new THREE.Mesh(this.geometries.sphereLow, bodyMat);
      limb.scale.set(0.18, 0.43, 0.18);
      limb.rotation.z = x * 0.38;
      limb.position.y = -0.24;
      arm.add(limb);
      rig.add(arm);
      arms.push(arm);
    }

    root.scale.setScalar(colors.size || 1);
    const dino = { root, rig, body, headPivot, tail, legs, arms, wings: [], materials: [bodyMat, bellyMat, spikeMat, eyeMat] };
    if (colors.spec) this._addDinoFeatures(dino, colors.spec);
    markShadows(root);
    return dino;
  }

  // Tier models keep the original hero skin intact, while giving each recruit a
  // readable silhouette. The added parts only use the shared low-poly geometry.
  _addDinoFeatures(dino, spec) {
    const { rig, body, headPivot, tail, materials } = dino;
    const [bodyMat, bellyMat, spikeMat] = materials;
    const tier = THREE.MathUtils.clamp(Number(spec.tier) || 0, 0, 20);
    const add = (geometry, material, scale, position, parent = rig) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(...scale); mesh.position.set(...position); parent.add(mesh); return mesh;
    };
    const hornCount = 1 + Math.floor(tier / 6);
    if (spec.shape === 'frill') {
      const frill = add(this.geometries.sphereLow, spikeMat, [0.9 + tier * .025, .72, .18], [0, .08, .48], headPivot);
      frill.rotation.x = .18;
      for (let i = 0; i < hornCount; i += 1) {
        const x = hornCount === 1 ? 0 : (i / (hornCount - 1) - .5) * .9;
        const horn = add(this.geometries.cone, spikeMat, [.13, .42 + tier * .018, .13], [x, .48, -.42], headPivot);
        horn.rotation.x = -.7;
      }
    }
    if (spec.shape === 'armored') {
      body.scale.set(.98, .7, 1.25);
      for (const z of [-.62, .72]) for (const x of [-.62, .62]) {
        const leg = add(this.geometries.sphereLow, bodyMat, [.24, .52, .27], [x, .58, z]);
        leg.rotation.z = x * .08;
      }
      for (let i = 0; i < 4 + Math.floor(tier / 4); i += 1) add(this.geometries.sphereLow, spikeMat, [.36, .17, .28], [0, 2.0 - i * .15, -.22 + i * .34]);
      const club = add(this.geometries.sphereLow, spikeMat, [.38 + tier * .015, .3, .38], [0, -.28, 1.85], tail);
      club.rotation.y = .2;
    }
    if (spec.shape === 'plates' || spec.shape === 'sail') {
      const count = 4 + Math.floor(tier / 4);
      for (let i = 0; i < count; i += 1) {
        const plate = add(this.geometries.cone, spikeMat, [.24, spec.shape === 'sail' ? .8 + tier * .03 : .42 + tier * .02, .11], [0, 2.0 - i * .1, -.35 + i * .38]);
        plate.rotation.x = spec.shape === 'sail' ? 0 : Math.PI / 2;
      }
    }
    if (spec.shape === 'longneck') {
      body.scale.set(1.02, .72, 1.25);
      for (const z of [-.58, .76]) for (const x of [-.62, .62]) add(this.geometries.sphereLow, bodyMat, [.22, .55, .25], [x, .58, z]);
      for (let i = 0; i < 3 + Math.floor(tier / 5); i += 1) add(this.geometries.sphereLow, bodyMat, [.36, .48, .36], [0, 2.0 + i * .34, -.5 - i * .12]);
      headPivot.position.set(0, 3.05 + tier * .04, -1.08);
      dino.root.userData.tall = true;
    }
    if (spec.shape === 'raptor') {
      const beak = add(this.geometries.cone, bellyMat, [.3, .72 + tier * .015, .26], [0, -.04, -.93], headPivot);
      beak.rotation.x = -Math.PI / 2;
      for (const x of [-1, 1]) {
        const claw = add(this.geometries.cone, spikeMat, [.11, .33, .11], [x * .28, -.63, -.36], dino.legs[x < 0 ? 0 : 1]);
        claw.rotation.x = -Math.PI / 2;
      }
    }
    if (spec.flying || spec.shape === 'wing') {
      for (const x of [-1, 1]) {
        const wing = new THREE.Group(); wing.position.set(x * .57, 1.5, .05);
        const membrane = add(this.geometries.sphereLow, bodyMat, [.92 + tier * .02, .08, .64], [x * .48, 0, .12], wing);
        membrane.rotation.z = x * .18; rig.add(wing); dino.wings.push(wing);
      }
      dino.root.userData.flying = true;
    }
  }

  loadLevel(level) {
    if (!level || !Array.isArray(level.objects)) throw new Error('DinoRenderer.loadLevel: ongeldig level zonder objects-array.');
    this.level = level;
    this.previousCollected.clear();
    this.lastHits = 0;
    this.hitFlash = 0;
    this.finaleTime = 0;
    this.finaleBurst = false;
    this.lastMergeId = null;
    this.lastLossId = null;
    this.mergeAnim = null;
    this.mergeRing.visible = false;
    this.mergeBeam.visible = false;
    this._clearActiveObjects();
    this._clearEffects();
    this._clearForks();
    this._buildForks(level.forks || []);

    const p = PALETTES[Math.abs(level.world || 0) % PALETTES.length];
    this.currentPalette = p;
    this.scene.background.set(p.sky);
    this.scene.fog.color.set(p.sky);
    this.materials.track.color.set(level.ground ?? p.ground);
    this.materials.water.color.set(level.water ?? p.water);
    this.materials.pink.color.set(level.accent ?? p.accent);
    this.materials.foliage.color.set(p.foliage);
    this.materials.sand.color.set(level.ground ?? p.ground);
    this.hemisphere.groundColor.set(level.water ?? p.water);

    if (this.boss) {
      this.world.remove(this.boss.root);
      this._disposeDino(this.boss);
    }
    if (this.finishSet) {
      this.world.remove(this.finishSet);
      this.finishSet.traverse((node) => {
        if (node.userData.labelTexture) this._disposeLabel(node);
        if (node.userData.finishDino) this._disposeDino(node.userData.finishDino);
      });
    }
    this.finishSet = this._createFinishSet(level);
    this.world.add(this.finishSet);
    const bossSpec = dinoByTier(level.bossTier ?? 0) || dinoByTier(0);
    this.boss = this._createDino({ body: bossSpec.body || 0xe95750, belly: bossSpec.belly || 0xffb064, spikes: bossSpec.spikes || 0x67234b, size: 1, spec: bossSpec });
    this.bossScale = Math.max(1.12, 0.94 + (Number(bossSpec.size) || 1) * .56);
    this.boss.root.scale.setScalar(this.bossScale);
    this.boss.root.position.set(0, 0, -Math.max(24, level.length || 100) - BOSS_GAP);
    this.boss.root.rotation.y = Math.PI;
    this.world.add(this.boss.root);
    this._setBossLabel(`Lv ${level.bossLevel ?? (level.bossTier ?? 0) + 1}`);
  }

  _clearForks() {
    this.forkRoot.traverse((node) => { if (node.userData.labelTexture) this._disposeLabel(node); });
    this.forkRoot.clear();
  }

  _buildForks(forks) {
    forks.forEach((fork, index) => {
      const root = new THREE.Group();
      const length = Math.max(10, fork.end - fork.start);
      const midZ = -(fork.start + fork.end) / 2;
      const makeBridge = (side, label, kind) => {
        const bridge = new THREE.Group();
        const offset = side * 2.25;
        const deck = new THREE.Mesh(this.geometries.box, this.materials.brown);
        deck.scale.set(3.25, .16, length); deck.position.set(offset, .12, midZ); bridge.add(deck);
        for (const x of [-.9, .9]) {
          const rail = new THREE.Mesh(this.geometries.cylinder, this.materials.white);
          rail.scale.set(.06, length / 2, .06); rail.position.set(offset + x * 1.45, .57, midZ); rail.rotation.x = Math.PI / 2; bridge.add(rail);
        }
        const sign = this._makeLabel(label || (side < 0 ? 'LINKS' : 'RECHTS'), kind === 'risk' ? '#db3950' : '#20a952', .55);
        sign.position.set(offset, 2.05, -(fork.start + 2)); bridge.add(sign);
        root.add(bridge);
      };
      // Water masks the normal deck through this zone; two elevated wooden bridges
      // clearly diverge even though game physics still uses the familiar 3 lanes.
      const water = new THREE.Mesh(this.geometries.box, this.materials.water);
      water.scale.set(TRACK_WIDTH + .3, .16, length + .08); water.position.set(0, .08, midZ); root.add(water);
      makeBridge(-1, fork.leftLabel, fork.leftKind);
      makeBridge(1, fork.rightLabel, fork.rightKind);
      root.userData.fork = fork; root.userData.index = index;
      this.forkRoot.add(root);
    });
  }

  _forkX(distance, lane) {
    const fork = (this.level?.forks || []).find((item) => distance >= item.start && distance <= item.end);
    if (!fork) return lane * LANE_WIDTH;
    const progress = THREE.MathUtils.smoothstep((distance - fork.start) / Math.max(1, fork.end - fork.start), 0, 1);
    const side = lane < 0 ? -1 : 1;
    // Engine selects left for a negative lane and right for center/right. Both
    // bridge centre lines stay inside the physical 3.25-wide wooden decks.
    return lane * (2.4 - .15 * Math.sin(progress * Math.PI));
  }

  _updateTeam(run, menu, distance) {
    const tiers = Array.isArray(run.team) ? run.team.slice(0, 9) : [];
    const wanted = new Set(tiers.map((tier, index) => `${tier}:${index}`));
    for (const [key, dino] of this.teamDinos) {
      if (wanted.has(key)) continue;
      this.teamRoot.remove(dino.root); this.teamDinos.delete(key);
      const pool = this.teamPools.get(dino.tier) || []; pool.push(dino); this.teamPools.set(dino.tier, pool);
    }
    tiers.forEach((rawTier, index) => {
      const tier = THREE.MathUtils.clamp(Number(rawTier) || 0, 0, 20);
      const key = `${tier}:${index}`;
      let dino = this.teamDinos.get(key);
      if (!dino) {
        dino = this.teamPools.get(tier)?.pop();
        if (!dino) {
          const spec = dinoByTier(tier) || dinoByTier(0);
          dino = this._createDino({ body: spec.body, belly: spec.belly, spikes: spec.spikes, spec });
          dino.tier = tier;
        }
        this.teamDinos.set(key, dino); this.teamRoot.add(dino.root);
      }
      const { x: baseX, z: baseZ } = this._teamSlot(index, menu, distance, run);
      const flying = Boolean(dino.root.userData.flying);
      dino.root.position.set(baseX, flying ? 1.65 + Math.sin(this.clockTime * 7 + index) * .18 : 0, baseZ);
      dino.root.rotation.y = menu ? Math.PI : 0;
      const size = Number((dinoByTier(tier) || {}).size) || 1;
      // Evolving: the new dino pops up from small with a little overshoot and a white glow.
      const merge = this.mergeAnim && this.mergeAnim.slot === index && this.mergeAnim.tier === tier ? this.mergeAnim : null;
      const pop = merge ? 0.25 + 0.75 * this._easeOutBack(Math.min(1, merge.t / 0.55)) : 1;
      dino.root.scale.setScalar((menu ? .5 : .52) * size * pop);
      const glow = merge ? Math.max(0, 1 - merge.t / 0.7) : 0;
      for (const material of dino.materials || []) {
        if (!material.emissive) continue;
        material.emissive.setRGB(1, 0.95, 0.7);
        material.emissiveIntensity = glow * 0.9;
      }
      this._animateDino(dino, this.clockTime + index * .33, run.status === 'running' ? .78 : .2);
    });
  }

  _teamSlot(index, menu, distance, run) {
    const inFork = (this.level?.forks || []).some((fork) => distance >= fork.start && distance <= fork.end);
    const col = inFork ? 0 : index % 3;
    const row = inFork ? index : Math.floor(index / 3);
    return {
      x: menu ? -1.8 + col * 1.75 : this._forkX(distance, run.x || 0) + (col - 1) * (inFork ? 0 : 1.14),
      z: -distance + (menu ? -1.6 - row * 1.55 : 2.0 + row * 1.42),
    };
  }

  _easeOutBack(k) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
  }

  // Merges and trap losses come from the engine as numbered records; each new one plays once.
  _updateTeamEffects(run, dt) {
    const distance = run.distance || 0;
    const merge = run.lastMerge;
    if (merge && merge.id !== this.lastMergeId) {
      this.lastMergeId = merge.id;
      this.mergeAnim = { slot: merge.slot, tier: merge.tier, t: 0 };
      const at = this._teamSlot(merge.slot, false, distance, run);
      this._burstAt(at.x, 0.7, at.z, [0xffd84a, 0xffffff, 0x7dffa0], 28, 2.4, 1.8);
      if (merge.removed >= 0) {
        const from = this._teamSlot(merge.removed, false, distance, run);
        this._burstAt(from.x, 0.6, from.z, [0xffffff, 0xffe9a8], 12, 1.2, 1.4);
      }
      this.mergeRing.position.set(at.x, 0.08, at.z);
      this.mergeBeam.position.set(at.x, 0, at.z);
    }
    if (this.mergeAnim) {
      this.mergeAnim.t += dt;
      const k = Math.min(1, this.mergeAnim.t / 0.8);
      this.mergeRing.visible = k < 1;
      this.mergeRing.scale.setScalar(0.5 + k * 3.4);
      this.mergeRing.material.opacity = 1 - k;
      this.mergeBeam.visible = k < 1;
      this.mergeBeam.scale.set(1 + k * 0.6, 0.5 + Math.min(1, k * 3) * 7, 1 + k * 0.6);
      this.mergeBeam.position.y = this.mergeBeam.scale.y / 2;
      this.mergeBeam.material.opacity = 0.75 * (1 - k);
      if (this.mergeAnim.t > 0.9) this.mergeAnim = null;
    }
    const loss = run.lastLoss;
    if (loss && loss.id !== this.lastLossId) {
      if (this.lastLossId !== null || loss.id > 0) {
        const at = this._teamSlot(Math.max(0, (run.team || []).length), false, distance, run);
        this._burstAt(at.x, 0.8, at.z, [0x7b8193, 0xb9bfcc, 0xff5367], 14, 1.2);
      }
      this.lastLossId = loss.id;
    }
  }

  _burstAt(x, y, z, palette, count, speed, size = 1) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    for (let i = 0; i < count; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: palette[i % palette.length], transparent: true });
      const particle = new THREE.Mesh(this.geometries.sphereLow, mat);
      particle.scale.setScalar((0.07 + (i % 3) * 0.03) * size);
      const angle = i * Math.PI * 2 / count;
      particle.userData.velocity = new THREE.Vector3(Math.cos(angle) * speed, (1.4 + (i % 4) * 0.45) * Math.max(1, size * 0.9), Math.sin(angle) * speed);
      group.add(particle);
    }
    this.effectRoot.add(group);
    this.effects.push({ group, age: 0, life: 0.8 });
  }

  setSkin(skin) {
    if (!skin) return;
    const [body, belly, spikes] = this.player.materials;
    body.color.set(skin.body);
    belly.color.set(skin.belly);
    spikes.color.set(skin.spikes);
  }

  _createFinishSet(level) {
    const root = new THREE.Group();
    root.position.z = -Math.max(24, level.length || 100);
    const postMaterial = this.materials.pink;
    for (const x of [-1, 1]) {
      const post = new THREE.Mesh(this.geometries.cylinder, postMaterial);
      post.scale.set(0.25, 7.4, 0.25);
      post.position.set(x * 3.75, 3.7, 0.9);
      root.add(post);
    }
    const banner = new THREE.Mesh(this.geometries.box, this.materials.white);
    banner.scale.set(7.75, 1.12, 0.22);
    banner.position.set(0, 7.6, 0.9);
    root.add(banner);
    const finishLabel = this._makeLabel('FINISH!', '#ed4f8c', 1.2);
    finishLabel.position.set(0, 7.63, 0.62);
    root.add(finishLabel);

    for (let i = 0; i < 4; i += 1) {
      const left = i % 2 === 0;
      const dino = this._createDino({
        body: [0x9d6ee8, 0x48cddd, 0xf1a34c, 0x75cd55][i],
        belly: 0xffe0b5,
        spikes: 0xff6c96,
        size: 0.62 + i * 0.035,
      });
      dino.root.position.set((left ? -1 : 1) * (5.1 + Math.floor(i / 2) * 1.7), 0, 1.5 - Math.floor(i / 2) * 2.4);
      dino.root.rotation.y = left ? -Math.PI / 2 : Math.PI / 2;
      dino.root.userData.finishDino = dino;
      root.add(dino.root);
    }
    return markShadows(root);
  }

  _setBossLabel(text) {
    if (this.bossLabel) {
      this.boss.root.remove(this.bossLabel);
      this._disposeLabel(this.bossLabel);
    }
    this.bossLabel = this._makeLabel(text, '#ff4d62', 1.45);
    this.bossLabel.position.set(0, 3.65, 0);
    this.boss.root.add(this.bossLabel);
  }

  _makeLabel(text, color = '#19394f', scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(26, 12, 204, 92, 40);
    } else {
      ctx.moveTo(66, 12);
      ctx.lineTo(190, 12);
      ctx.quadraticCurveTo(230, 12, 230, 52);
      ctx.lineTo(230, 64);
      ctx.quadraticCurveTo(230, 104, 190, 104);
      ctx.lineTo(66, 104);
      ctx.quadraticCurveTo(26, 104, 26, 64);
      ctx.lineTo(26, 52);
      ctx.quadraticCurveTo(26, 12, 66, 12);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '900 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 59, 190);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.2 * scale, 1.1 * scale, 1);
    sprite.userData.labelTexture = texture;
    return sprite;
  }

  _disposeLabel(label) {
    label.userData.labelTexture?.dispose();
    label.material?.dispose();
  }

  // The number above the leader is the whole team's strength (leader + team).
  _updatePlayerLabel(power) {
    const rounded = Math.max(0, Math.round(power || 0));
    if (rounded === this.lastPower) return;
    this.lastPower = rounded;
    if (this.player.label) {
      this.player.root.remove(this.player.label);
      this._disposeLabel(this.player.label);
    }
    const text = new Intl.NumberFormat('nl-NL', { notation: rounded >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(rounded);
    this.player.label = this._makeLabel(text, '#20a952', 0.72);
    this.player.label.position.set(0, 2.78, 0);
    this.player.root.add(this.player.label);
  }

  _createObject(type, item = {}) {
    const group = new THREE.Group();
    const addMesh = (geometry, material, scale, position = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(...scale);
      mesh.position.set(...position);
      group.add(mesh);
      return mesh;
    };

    if (type === 'food') {
      addMesh(this.geometries.sphereLow, this.materials.orange, [0.46, 0.34, 0.4], [0, 0.62, 0]);
      addMesh(this.geometries.cone, this.materials.green, [0.2, 0.52, 0.2], [0, 1.08, 0]).rotation.z = Math.PI;
    } else if (type === 'coin') {
      const coin = addMesh(this.geometries.coin, this.materials.gold, [1, 1, 1], [0, 0.82, 0]);
      coin.rotation.z = Math.PI / 2;
      addMesh(this.geometries.ring, this.materials.white, [0.54, 0.54, 0.54], [0, 0.82, 0]).rotation.y = Math.PI / 2;
    } else if (type === 'rock') {
      const rock = addMesh(this.geometries.tetra, this.materials.rock, [0.78, 0.72, 0.65], [0, 0.49, 0]);
      rock.rotation.set(0.2, 0.35, 0.08);
    } else if (type === 'log') {
      const log = addMesh(this.geometries.cylinder, this.materials.brown, [0.48, 2.1, 0.48], [0, 0.47, 0]);
      log.rotation.z = Math.PI / 2;
      for (const x of [-1, 1]) addMesh(this.geometries.cylinder, this.materials.sand, [0.4, 0.03, 0.4], [x * 1.055, 0.47, 0]).rotation.z = Math.PI / 2;
    } else if (type === 'lava') {
      addMesh(this.geometries.box, this.materials.lavaRim, [2.3, 0.07, 2.55], [0, 0.035, 0]);
      const lava = addMesh(this.geometries.box, this.materials.lava, [2.02, 0.08, 2.27], [0, 0.075, 0]);
      lava.rotation.y = 0.04;
      for (let i = 0; i < 3; i += 1) addMesh(this.geometries.sphereLow, this.materials.gold, [0.14, 0.035, 0.14], [(i - 1) * 0.6, 0.14, (i % 2) * 0.55]);
    } else if (type === 'rival') {
      const spec = dinoByTier(item.tier ?? 0) || dinoByTier(0);
      const hue = spec.body || new THREE.Color().setHSL(0.68, 0.72, 0.56);
      const dino = this._createDino({ body: hue, belly: spec.belly || 0xffd7b5, spikes: spec.spikes || 0xff6f72, size: 1, spec });
      dino.root.rotation.y = Math.PI;
      group.add(dino.root);
      group.userData.dino = dino;
    } else if (type === 'gate') {
      addMesh(this.geometries.arch, this.materials.green, [1, 1, 1], [0, 2.2, 0]);
      for (const x of [-1, 1]) addMesh(this.geometries.cylinder, this.materials.green, [0.19, 2.2, 0.19], [x * 1.02, 1.1, 0]);
      const panel = addMesh(this.geometries.plane, this.materials.gatePanelGreen, [2.04, 2.2, 1], [0, 1.1, 0]);
      panel.userData.gatePanel = true;
    } else if (type === 'shield') {
      addMesh(this.geometries.sphereLow, this.materials.shield, [0.72, 0.88, 0.25], [0, 0.92, 0]);
      addMesh(this.geometries.ring, this.materials.white, [0.8, 0.8, 0.8], [0, 0.92, 0]);
    }
    group.userData.type = type;
    markShadows(group);
    group.traverse((node) => { if (node.userData.gatePanel) node.castShadow = false; });
    return group;
  }

  _acquireObject(item) {
    const poolKey = item.type === 'rival' ? `rival:${item.tier ?? 0}` : item.type;
    const pool = this.objectPools.get(poolKey);
    const group = pool?.pop() || this._createObject(item.type, item);
    group.visible = true;
    group.position.set(this._forkX(item.z, item.lane), 0, -item.z);
    group.userData.item = item;
    group.userData.poolKey = poolKey;
    if (item.type === 'gate') {
      const positive = (item.value ?? 1) >= 1;
      group.traverse((child) => {
        if (child.isMesh && (child.material === this.materials.green || child.material === this.materials.red)) {
          child.material = positive ? this.materials.green : this.materials.red;
        }
        if (child.userData.gatePanel) child.material = positive ? this.materials.gatePanelGreen : this.materials.gatePanelRed;
      });
      group.userData.valueLabel = this._makeLabel(positive ? `+${item.value ?? ''}%` : `${item.value} dino`, positive ? '#20a952' : '#db3950', 0.68);
      group.userData.valueLabel.position.set(0, 3.85, 0);
      group.add(group.userData.valueLabel);
    } else if (item.type === 'rival') {
      group.userData.dino.root.scale.setScalar(0.72 + (Number((dinoByTier(item.tier ?? 0) || {}).size) || 1) * .42);
      group.userData.edible = null;
    }
    this.objectRoot.add(group);
    this.activeObjects.set(item.id, group);
  }

  _releaseObject(id, group) {
    this.objectRoot.remove(group);
    if (group.userData.valueLabel) {
      group.remove(group.userData.valueLabel);
      this._disposeLabel(group.userData.valueLabel);
      group.userData.valueLabel = null;
    }
    group.userData.item = null;
    const poolKey = group.userData.poolKey || group.userData.type;
    if (!this.objectPools.has(poolKey)) this.objectPools.set(poolKey, []);
    this.objectPools.get(poolKey).push(group);
    this.activeObjects.delete(id);
  }

  _clearActiveObjects() {
    for (const [id, group] of [...this.activeObjects]) this._releaseObject(id, group);
  }

  _updateVisibleObjects(run) {
    const minZ = run.distance - NEAR_BEHIND;
    const maxZ = run.distance + FAR_AHEAD;
    const collected = run.collected || new Set();
    for (const item of this.level.objects) {
      const visible = item.z >= minZ && item.z <= maxZ && !collected.has(item.id);
      if (visible && !this.activeObjects.has(item.id)) this._acquireObject(item);
      else if (!visible && this.activeObjects.has(item.id)) this._releaseObject(item.id, this.activeObjects.get(item.id));
    }
    for (const [id, group] of this.activeObjects) {
      const type = group.userData.type;
      const bob = Math.sin(this.clockTime * 4 + group.position.z * 0.12);
      if (type === 'coin') {
        group.rotation.y += 0.055;
        group.position.y = 0.14 + bob * 0.08;
      } else if (type === 'food' || type === 'shield') {
        group.rotation.y += 0.018;
        group.position.y = bob * 0.07;
      } else if (type === 'rival') {
        this._animateDino(group.userData.dino, this.clockTime * 1.15 + group.position.z, 0.75);
        this._updateRivalLabel(group, teamPower(run));
      }
      if (collected.has(id)) this._releaseObject(id, group);
    }
  }

  // Green means the team can beat and recruit this rival; red means it is still too strong.
  _updateRivalLabel(group, power) {
    const item = group.userData.item;
    if (!item) return;
    const edible = canBeat(power, item.value);
    if (edible === group.userData.edible) return;
    group.userData.edible = edible;
    if (group.userData.valueLabel) {
      group.remove(group.userData.valueLabel);
      this._disposeLabel(group.userData.valueLabel);
    }
    group.userData.valueLabel = this._makeLabel(`Lv ${(item.tier ?? 0) + 1}`, edible ? '#20a952' : '#e64c65', 0.62);
    const scale = group.userData.dino.root.scale.x || 1;
    group.userData.valueLabel.position.set(0, 2.55 * scale + 0.35, 0);
    group.add(group.userData.valueLabel);
  }

  _createPickupEffect(item, count = 9) {
    const palettes = {
      coin: [0xffd33d, 0xffffff],
      rock: [0x7b8193, 0xb9bfcc, 0x5a5f6e],
      log: [0x8b5737, 0xc98a55, 0xffda8a],
      rival: [0xff6f72, 0xffd7b5, 0xffffff],
      gate: item.value < 0 ? [0xff5367, 0xffffff] : [0x45dc70, 0xffffff],
      finale: [0xffcf32, 0xff6ca8, 0x57e8ff, 0x45dc70, 0xffffff],
    };
    const palette = palettes[item.type] || [0x5bec73, 0xff7daf, 0xffffff];
    const group = new THREE.Group();
    group.position.set(this._forkX(item.z, item.lane), item.type === 'finale' ? 2.4 : 0.8, -item.z);
    for (let i = 0; i < count; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ color: palette[i % palette.length], transparent: true });
      const particle = new THREE.Mesh(this.geometries.sphereLow, mat);
      particle.scale.setScalar(0.08 + (i % 3) * 0.035);
      const angle = i * Math.PI * 2 / count;
      const burst = item.type === 'finale' ? 2.6 : 1;
      particle.userData.velocity = new THREE.Vector3(Math.cos(angle) * (1.2 + i % 2) * burst, (1.3 + (i % 3) * 0.4) * burst, Math.sin(angle) * 1.1 * burst);
      group.add(particle);
    }
    this.effectRoot.add(group);
    this.effects.push({ group, age: 0, life: item.type === 'finale' ? 1.6 : 0.75 });
  }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.age += dt;
      for (const particle of effect.group.children) {
        particle.position.addScaledVector(particle.userData.velocity, dt);
        particle.userData.velocity.y -= 3.7 * dt;
        particle.material.opacity = Math.max(0, 1 - effect.age / effect.life);
      }
      if (effect.age > effect.life) {
        this.effectRoot.remove(effect.group);
        for (const particle of effect.group.children) particle.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  _clearEffects() {
    for (const effect of this.effects) {
      this.effectRoot.remove(effect.group);
      for (const particle of effect.group.children) particle.material.dispose();
    }
    this.effects.length = 0;
  }

  _detectCollections(run) {
    const collected = run.collected || new Set();
    for (const id of collected) {
      if (!this.previousCollected.has(id)) {
        const item = this.level.objects.find((candidate) => candidate.id === id);
        if (item) this._createPickupEffect(item);
      }
    }
    this.previousCollected = new Set(collected);
  }

  _animateDino(dino, phase, intensity = 1) {
    if (!dino) return;
    const stride = Math.sin(phase * 9) * 0.68 * intensity;
    dino.legs[0].rotation.x = stride;
    dino.legs[1].rotation.x = -stride;
    dino.arms[0].rotation.x = -stride * 0.55;
    dino.arms[1].rotation.x = stride * 0.55;
    dino.tail.rotation.y = Math.sin(phase * 4.5) * 0.17;
    dino.headPivot.rotation.z = Math.sin(phase * 3) * 0.025;
    for (const [index, wing] of (dino.wings || []).entries()) wing.rotation.z = (index ? -1 : 1) * (0.34 + Math.sin(phase * 13) * 0.42 * intensity);
    dino.rig.position.y = Math.abs(Math.sin(phase * 9)) * 0.075 * intensity;
    dino.rig.rotation.z = Math.sin(phase * 9) * 0.025 * intensity;
  }

  _updateTrack(distance) {
    const centerChunk = Math.floor(distance / CHUNK_LENGTH);
    const firstChunk = centerChunk - 4;
    for (let i = 0; i < this.trackChunks.length; i += 1) {
      const chunkIndex = firstChunk + i;
      const chunk = this.trackChunks[i];
      chunk.position.z = -(chunkIndex * CHUNK_LENGTH + CHUNK_LENGTH / 2);
      chunk.visible = chunkIndex >= 0 && (!this.level || chunkIndex * CHUNK_LENGTH < (this.level.length || 9999) + 15);
    }
    this.ocean.position.z = -distance - 80;

    for (let i = 0; i < this.decorSlots.length; i += 1) {
      const band = Math.floor(distance / 24) - 2 + i;
      const random = seeded((this.level?.number || 1) * 7919 + band * 83 + i);
      const deco = this.decorSlots[i];
      deco.position.x = (random() > 0.5 ? 1 : -1) * (8.5 + random() * 14);
      deco.position.z = -(band * 24 + random() * 16);
      deco.rotation.y = random() * Math.PI * 2;
    }
    for (let i = 0; i < this.clouds.length; i += 1) {
      const cloudBand = Math.floor(distance / 42) - 1 + i;
      const cloud = this.clouds[i];
      cloud.position.z = -(cloudBand * 42 + (i % 3) * 9);
      cloud.position.x = (i % 2 ? 1 : -1) * (14 + (i % 4) * 5);
    }
  }

  render(run, dt, { menu = false, teamView = false } = {}) {
    if (this.disposed || !this.level || !run) return;
    const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
    this.clockTime += safeDt;
    this._detectCollections(run);
    this._updateVisibleObjects(run);
    this._updateEffects(safeDt);
    this._updateTrack(run.distance || 0);
    this._updatePlayerLabel(teamPower(run));
    this._updateTeam(run, menu, run.distance || 0);
    if (!menu) this._updateTeamEffects(run, safeDt);

    // Hits flash the dinosaur red and shake the camera briefly.
    const hits = run.hits || 0;
    if (!menu && hits > this.lastHits) this.hitFlash = 0.45;
    this.lastHits = hits;
    this.hitFlash = Math.max(0, this.hitFlash - safeDt);
    const bodyMaterial = this.player.materials[0];
    bodyMaterial.emissive.setRGB(1, 0.12, 0.08);
    bodyMaterial.emissiveIntensity = this.hitFlash > 0 ? 0.55 * Math.abs(Math.sin(this.hitFlash * 22)) : 0;

    // Finale at the boss: won = the boss topples over, lost = your dino is knocked back.
    const finished = !menu && (run.status === 'won' || run.status === 'lost');
    this.finaleTime = finished ? this.finaleTime + safeDt : 0;
    if (!finished) this.finaleBurst = false;
    const finale = Math.min(1, this.finaleTime / 0.7);
    if (finished && run.status === 'won' && !this.finaleBurst && this.finaleTime > 0.35) {
      this.finaleBurst = true;
      this._createPickupEffect({ type: 'finale', lane: 0, z: (this.level.length || 0) + BOSS_GAP }, 24);
    }

    const powerScale = dinoScale(LEADER_VISUAL_POWER);
    const narrowMenu = menu && this.camera.aspect < 0.86;
    const menuScale = menu ? (narrowMenu ? 0.9 : 1.16) / powerScale : 1;
    const menuHeroX = menu ? (narrowMenu ? 0 : 2.45) : this._forkX(run.distance || 0, run.x || 0);
    const distance = run.distance || 0;
    let playerZ = -distance;
    let playerY = Math.max(0, run.y || 0);
    if (finished && run.status === 'won') {
      playerY = Math.abs(Math.sin(this.finaleTime * 7)) * 0.7 * Math.max(0, 1 - this.finaleTime / 2.5);
    } else if (finished) {
      playerZ += finale * 2.2;
    }
    this.player.root.scale.setScalar(powerScale * menuScale);
    this.player.root.position.set(menuHeroX, playerY, playerZ);
    this.player.root.rotation.y = menu ? Math.PI : 0;
    if (this.player.label) this.player.label.visible = !menu;
    this._animateDino(this.player, this.clockTime, run.status === 'running' ? 1 : 0.25);
    this.player.rig.rotation.x = finished && run.status === 'lost' ? finale * 1.2 : 0;

    // Bigger dinosaurs push the camera up and back so the track ahead stays readable.
    const grow = powerScale - 1 + Math.max(0, 0.75 - this.camera.aspect) * 1.2;
    const shake = this.hitFlash > 0 ? this.hitFlash * 0.35 : 0;
    // Team view (team panel open, e.g. before the boss): look at the team from the side so the
    // evolution animation is visible above the panel, with the boss in the background.
    const teamX = this.player.root.position.x;
    const portrait = this.camera.aspect < 0.86;
    const desiredCamera = menu
      ? narrowMenu
        ? new THREE.Vector3(3.25, 3.05, -distance + 7.25)
        : new THREE.Vector3(6.1, 3.45, -distance + 6.25)
      : teamView
        ? new THREE.Vector3(teamX + (portrait ? this.teamCam.portraitX : this.teamCam.x), portrait ? this.teamCam.portraitY : this.teamCam.y, -distance + (portrait ? this.teamCam.portraitZ : this.teamCam.z))
        : new THREE.Vector3(this.player.root.position.x * 0.3, 6.85 + grow * 2.15, -distance + 10.2 + grow * 2.6);
    const look = menu
      ? narrowMenu
        ? new THREE.Vector3(0, 1.25, -distance)
        : new THREE.Vector3(-0.45, 1.35, -distance)
      : teamView
        ? new THREE.Vector3(teamX, portrait ? this.teamCam.portraitLookY : this.teamCam.lookY, -distance + (portrait ? this.teamCam.portraitLookZ : this.teamCam.lookZ))
        : new THREE.Vector3(this.player.root.position.x * 0.5, 0.8, -distance - 14.8);
    const follow = 1 - Math.pow(teamView || this.lastTeamView ? 0.02 : 0.002, Math.max(safeDt, 1 / 120));
    if (menu || this.lastMenu !== menu) {
      this.camera.position.copy(desiredCamera);
      this.cameraLook.copy(look);
    } else {
      this.camera.position.lerp(desiredCamera, follow);
      this.cameraLook.lerp(look, follow);
    }
    this.lastMenu = menu;
    this.lastTeamView = teamView && this.camera.position.distanceTo(desiredCamera) > 0.05;
    if (shake) this.camera.position.add(new THREE.Vector3(Math.sin(this.clockTime * 91) * shake, Math.cos(this.clockTime * 77) * shake * 0.6, 0));
    this.camera.lookAt(this.cameraLook);

    this.sun.position.set(this.camera.position.x - 10, 18, this.camera.position.z + 2);
    this.sun.target.position.set(this.player.root.position.x, 0, -distance - 8);
    if (this.boss) {
      const bossDistance = Math.max(0, (this.level.length || 0) - distance);
      this.boss.root.visible = bossDistance < 160;
      this._animateDino(this.boss, this.clockTime * 0.68, bossDistance < 25 ? 1 : 0.35);
      this.boss.root.rotation.z = Math.sin(this.clockTime * 1.6) * 0.025;
      this.boss.rig.rotation.x = 0;
      this.boss.root.scale.setScalar(this.bossScale);
      if (finished && run.status === 'won') {
        const shrink = Math.max(0.05, 1 - Math.max(0, this.finaleTime - 0.9) * 0.9);
        this.boss.rig.rotation.x = finale * 1.45;
        this.boss.root.scale.setScalar(this.bossScale * shrink);
      } else if (finished) {
        this.boss.root.scale.setScalar(this.bossScale * (1 + Math.sin(Math.min(1, this.finaleTime / 0.5) * Math.PI) * 0.12));
      }
      if (this.bossLabel) this.bossLabel.visible = !(finished && run.status === 'won' && this.finaleTime > 0.5);
      // The finish arch and cheering dinos would block the side view on the team panel.
      this.finishSet.visible = bossDistance < 175 && !teamView;
      for (const child of this.finishSet.children) {
        if (child.userData.finishDino) this._animateDino(child.userData.finishDino, this.clockTime + child.position.x, 0.7);
      }
    }

    this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
    const targetWidth = Math.floor(width * Math.min(window.devicePixelRatio || 1, 1.6));
    const targetHeight = Math.floor(height * Math.min(window.devicePixelRatio || 1, 1.6));
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      // Portrait phones: widen the view so all three lanes stay on screen.
      const halfTan = Math.tan(THREE.MathUtils.degToRad(24)) * 0.85 / this.camera.aspect;
      this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(halfTan)), 48, 68);
      this.camera.updateProjectionMatrix();
    }
  }

  _disposeDino(dino) {
    if (!dino) return;
    if (dino.label) this._disposeLabel(dino.label);
    for (const material of dino.materials || []) material.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearActiveObjects();
    this._clearEffects();
    if (this.bossLabel) this._disposeLabel(this.bossLabel);
    this._disposeDino(this.player);
    this._disposeDino(this.boss);
    for (const dino of this.teamDinos.values()) this._disposeDino(dino);
    for (const pool of this.teamPools.values()) for (const dino of pool) this._disposeDino(dino);
    this.teamDinos.clear();
    this.teamPools.clear();
    this._clearForks();
    if (this.finishSet) {
      this.finishSet.traverse((node) => {
        if (node.userData.labelTexture) this._disposeLabel(node);
        if (node.userData.finishDino) this._disposeDino(node.userData.finishDino);
      });
    }
    for (const pool of this.objectPools.values()) {
      for (const group of pool) {
        if (group.userData.dino) this._disposeDino(group.userData.dino);
      }
    }
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.ocean.geometry.dispose();
    this.renderer.dispose();
  }
}
