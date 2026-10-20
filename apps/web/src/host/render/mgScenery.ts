import {
  Color3,
  Color4,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import type { MgScenery, MgSet, MgSurface } from '@wb/shared/minigames/types';
import { ambient, type AmbientKind } from './mgFx';
import { fbm, noise2, prng, smoothstep } from './noise';
import type { Stage } from './stage';
import { surfaceMat, surfaceTexture } from './surfaces';
import { copyTexture, detailTexture, lavaTexture, waterNormals } from './terrain';

/**
 * Minigame backdrops (v0.4): the same landscape language as the boards – a faceted height
 * field with soft vertex colors, animated water or lava, instanced vegetation and props from
 * the Blender library, landmarks, birds, ambient particles and a light setup per set – built
 * around the play area the game declares (`MgScenery.clear`) and kept out of it.
 */
type Ground = 'grass' | 'sand' | 'rock' | 'snow' | 'paving' | 'under';
export type AmbienceKey = 'sea' | 'lava' | 'meadow' | 'city' | 'ice' | 'wind' | 'studio' | 'desert' | 'night';

interface ScatterRule {
  id: string;
  on: Ground[];
  /** instances per 100 m² */
  density: number;
  scale?: [number, number];
  /** distance band outside the play area */
  d?: [number, number];
  tint?: string;
  /** above the water level by at least … */
  dry?: number;
  /** cluster strength 0..1 (default 0.85) */
  cluster?: number;
  /** keep-out radius for later scatter (big plants) */
  r?: number;
}

interface Landmark {
  id: string;
  /** position relative to the play area center */
  x: number;
  z: number;
  s?: number;
  r?: number;
  tint?: string;
  /** absolute height (default: terrain) or 'water' */
  y?: number | 'water';
}

interface SetDef {
  sky: [string, string];
  fog: string;
  fogDensity: number;
  sun: { color: string; intensity: number };
  hemi: { intensity: number; color: string; ground: string };
  colors: Partial<Record<Ground, string>> & { grass2?: string; seabed?: string };
  surface: MgSurface;
  water?: { kind: 'water' | 'lava'; color: string; alpha?: number };
  /** height relative to the ground level; d = distance outside the play area, u = (x, z) relative to its center */
  height: (x: number, z: number, d: number, w: number) => number;
  classify?: (y: number, slope: number, d: number, x: number, z: number) => Ground | null;
  scatter: ScatterRule[];
  landmarks?: Landmark[];
  ambient?: { kind: AmbientKind; y: number; size: [number, number, number]; z?: number }[];
  birds?: number;
  clouds?: { n: number; y: [number, number]; d: [number, number]; s: [number, number] };
  sound: AmbienceKey;
  extra?: (b: SceneryBuilder) => void;
}

const ridge = (x: number, z: number, f: number, seed: number) => 1 - Math.abs(fbm(x * f, z * f, 4, seed) * 2 - 1);

const SETS: Record<MgSet, SetDef> = {
  lagoon: {
    sky: ['#8fcbec', '#eaf6fb'],
    fog: '#cbe7f3',
    fogDensity: 0.006,
    sun: { color: '#fff4e0', intensity: 0.78 },
    hemi: { intensity: 0.52, color: '#ffffff', ground: '#9bb8c6' },
    colors: { grass: '#8fcb6e', grass2: '#a9d67a', sand: '#efe0b8', rock: '#b9b2a8', seabed: '#2f86a8' },
    surface: 'grass',
    water: { kind: 'water', color: '#2c9fc9', alpha: 0.7 },
    height: (x, z, d, w) => {
      // islets around the lagoon, a long island in the back, open sea in front
      const isl = [
        [0, 44, 34, 10],
        [-40, 16, 9, 13],
        [42, 24, 12, 8],
        [26, 96, 58, 20],
        [-70, 70, 26, 16],
        [-24, 34, 7, 5],
      ];
      let L = -40;
      for (const [cx, cz, rx, rz] of isl) L = Math.max(L, (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * Math.min(rx, rz));
      L += (fbm(x * 0.08, z * 0.08, 3, 4) - 0.5) * 5;
      if (d < 3) L = Math.min(L, -3);
      // shallow turquoise lagoon near the play area, deeper towards the open sea
      if (L < 0) return w - 0.3 - Math.min(1.1, Math.max(0, d) * 0.03) + Math.max(-2, L * 0.15) - smoothstep(40, 100, Math.hypot(x, z)) * 3;
      return w - 0.25 + smoothstep(0, 4, L) * 1.4 + smoothstep(4, 16, L) * (2.5 + fbm(x * 0.06, z * 0.06, 3, 9) * 5);
    },
    classify: (y, slope) => (y < 1.1 ? 'sand' : slope > 0.75 ? 'rock' : 'grass'),
    scatter: [
      { id: 'palm2', on: ['sand', 'grass'], density: 1.1, scale: [0.8, 1.2], r: 1.4, dry: 0.3 },
      { id: 'palm', on: ['grass', 'sand'], density: 1.2, scale: [0.8, 1.25], r: 1.4, dry: 0.4 },
      { id: 'bush', on: ['grass'], density: 4, scale: [0.8, 1.4], r: 0.8 },
      { id: 'fern', on: ['grass'], density: 4, scale: [0.9, 1.4] },
      { id: 'flowers', on: ['grass'], density: 2.4 },
      { id: 'grass', on: ['grass'], density: 14, scale: [0.9, 1.5] },
      { id: 'shell', on: ['sand'], density: 3, dry: 0.05 },
      { id: 'rocksmall', on: ['sand', 'rock'], density: 1.5, scale: [0.8, 1.6] },
      { id: 'driftwood', on: ['sand'], density: 0.25, dry: 0.05 },
    ],
    landmarks: [
      { id: 'lighthouse', x: 44, z: 26, s: 1 },
      { id: 'stilthut', x: -26, z: 28, s: 1, r: 0.6, tint: '#e8767a', y: 'water' },
      { id: 'boat', x: 18, z: 18, r: 2.2, y: 'water' },
      { id: 'boat', x: -18, z: -14, r: 0.7, y: 'water' },
      { id: 'cliff', x: -36, z: 22, s: 0.9, r: 1.2 },
    ],
    birds: 5,
    clouds: { n: 14, y: [22, 34], d: [40, 140], s: [3, 6] },
    sound: 'sea',
  },
  beach: {
    sky: ['#8fcbec', '#f4f1e4'],
    fog: '#d9ecf2',
    fogDensity: 0.006,
    sun: { color: '#fff1d6', intensity: 0.8 },
    hemi: { intensity: 0.5, color: '#ffffff', ground: '#c9b99a' },
    colors: { grass: '#9fcf74', grass2: '#b5d985', sand: '#f0dfb4', rock: '#bdb3a6', seabed: '#4aa3c4' },
    surface: 'sand',
    water: { kind: 'water', color: '#2ea3cc', alpha: 0.72 },
    height: (x, z, d, w) => {
      // sand all around, the sea behind the play area, dunes left/right/in front
      const shore = z - 16 - Math.max(0, d - 10) * 0.15 - (fbm(x * 0.05, 3, 2, 8) - 0.5) * 14;
      const dune = smoothstep(4, 16, d) * (fbm(x * 0.07, z * 0.07, 3, 3) * 2.4 + ridge(x, z, 0.03, 6) * 2) * smoothstep(4, -6, shore);
      const back = smoothstep(60, 140, Math.hypot(x, z)) * (6 + ridge(x, z, 0.02, 2) * 14);
      if (shore > 0) return Math.max(w - 3.5, -shore * 0.18 + 0.1) + back * smoothstep(80, 120, z);
      return Math.max(0, -shore * 0.04) - 0.04 + dune + back;
    },
    classify: (y, slope, d) => (y > 1.4 && d > 6 ? (slope > 0.8 ? 'rock' : 'grass') : 'sand'),
    scatter: [
      { id: 'palm', on: ['sand', 'grass'], density: 0.9, scale: [0.9, 1.3], d: [5, 70], r: 1.6, dry: 0.4 },
      { id: 'palm2', on: ['sand'], density: 0.6, scale: [0.8, 1.15], d: [5, 70], r: 1.6, dry: 0.4 },
      { id: 'bush', on: ['grass', 'sand'], density: 1.6, d: [6, 80], r: 0.8, dry: 0.6 },
      { id: 'grass', on: ['grass', 'sand'], density: 9, d: [3, 70], dry: 0.5 },
      { id: 'shell', on: ['sand'], density: 4, d: [1, 40] },
      { id: 'rocksmall', on: ['sand', 'rock'], density: 0.8, d: [3, 80] },
      { id: 'driftwood', on: ['sand'], density: 0.3, d: [4, 50] },
      { id: 'flowers', on: ['grass'], density: 1.4 },
    ],
    landmarks: [
      { id: 'hut', x: -24, z: 8, r: 0.9, tint: '#5fa8d6' },
      { id: 'barrel', x: -19, z: 3, r: 0.4 },
      { id: 'crab', x: 13, z: -6, r: 2.6, s: 0.8 },
      { id: 'boat', x: 22, z: 30, r: 2.6, y: 'water' },
      { id: 'lighthouse', x: 70, z: 64, s: 1.2 },
    ],
    birds: 6,
    clouds: { n: 12, y: [22, 34], d: [40, 140], s: [3, 6] },
    sound: 'sea',
  },
  volcano: {
    sky: ['#d98a72', '#f8cdb0'],
    fog: '#e0a088',
    fogDensity: 0.0052,
    sun: { color: '#ffd0a8', intensity: 0.7 },
    hemi: { intensity: 0.42, color: '#ffd9c4', ground: '#a24a2a' },
    colors: { rock: '#4e4452', grass: '#6b5e66', grass2: '#5e535c', sand: '#8a7a78', seabed: '#2a1612' },
    surface: 'basalt',
    water: { kind: 'lava', color: '#ff7a3d' },
    height: (x, z, d, w) => {
      // crags and plateaus rising out of the lava, the big volcano in the back
      const crag = ridge(x, z, 0.035, 12);
      const plate = smoothstep(0.52, 0.66, fbm(x * 0.04, z * 0.04, 3, 21) + smoothstep(30, 0, d) * 0.05);
      let y = w - 1.4 + plate * (1.8 + crag * 2.2) + smoothstep(14, 50, d) * crag * crag * 9 * plate;
      y += smoothstep(80, 150, z) * 10 * (0.6 + crag * 0.6);
      return d < 2 ? Math.min(y, w - 1.2) : y;
    },
    classify: (y, slope) => (slope > 0.55 ? 'rock' : 'grass'),
    scatter: [
      { id: 'lavarock', on: ['grass', 'rock'], density: 1.8, scale: [0.7, 1.6], dry: 0.3, r: 0.8 },
      { id: 'obsidian', on: ['grass'], density: 0.5, scale: [0.8, 1.4], dry: 0.4, r: 0.8 },
      { id: 'crystal', on: ['grass'], density: 0.6, scale: [0.7, 1.3], dry: 0.4 },
      { id: 'ashplant', on: ['grass'], density: 2.5, dry: 0.4 },
      { id: 'deadtree', on: ['grass'], density: 0.35, scale: [0.8, 1.3], dry: 0.5, r: 1 },
      { id: 'vent', on: ['grass'], density: 0.2, dry: 0.4, r: 1 },
      { id: 'bones', on: ['grass'], density: 0.15, dry: 0.4 },
    ],
    landmarks: [{ id: 'volcano', x: 14, z: 92, s: 3 }],
    ambient: [
      { kind: 'embers', y: 1, size: [60, 2, 40], z: 6 },
      { kind: 'ash', y: 14, size: [70, 6, 50], z: 10 },
    ],
    clouds: { n: 6, y: [30, 44], d: [70, 150], s: [4, 7] },
    sound: 'lava',
  },
  summit: {
    sky: ['#d98a72', '#f8cdb0'],
    fog: '#e0a088',
    fogDensity: 0.0048,
    sun: { color: '#ffd0a8', intensity: 0.72 },
    hemi: { intensity: 0.44, color: '#ffd9c4', ground: '#a24a2a' },
    colors: { rock: '#4e4452', grass: '#6b5e66', grass2: '#5e535c', sand: '#8a7a78', seabed: '#2a1612' },
    surface: 'basalt',
    water: { kind: 'lava', color: '#ff7a3d' },
    height: (x, z, d, w) => {
      const crag = ridge(x, z, 0.04, 31);
      const plate = smoothstep(0.5, 0.64, fbm(x * 0.045, z * 0.045, 3, 33));
      const y = w - 1.4 + plate * (1.6 + crag * 2) + smoothstep(20, 70, d) * crag * crag * 14 * plate;
      return d < 3 ? Math.min(y, w - 1.2) : y;
    },
    classify: (y, slope) => (slope > 0.55 ? 'rock' : 'grass'),
    scatter: [
      { id: 'lavarock', on: ['grass', 'rock'], density: 2, scale: [0.7, 1.6], dry: 0.3, r: 0.8 },
      { id: 'crystal', on: ['grass'], density: 0.7, scale: [0.7, 1.3], dry: 0.4 },
      { id: 'ashplant', on: ['grass'], density: 2.5, dry: 0.4 },
      { id: 'deadtree', on: ['grass'], density: 0.3, dry: 0.5, r: 1 },
      { id: 'vent', on: ['grass'], density: 0.25, dry: 0.4, r: 1 },
      { id: 'mushroom', on: ['grass'], density: 0.4, dry: 0.4 },
    ],
    ambient: [
      { kind: 'embers', y: 1, size: [60, 2, 40], z: 4 },
      { kind: 'ash', y: 14, size: [70, 6, 50], z: 10 },
    ],
    clouds: { n: 6, y: [34, 48], d: [70, 150], s: [4, 7] },
    sound: 'lava',
  },
  meadow: {
    sky: ['#8ec5ee', '#eef6ea'],
    fog: '#d6ebe0',
    fogDensity: 0.0055,
    sun: { color: '#fff6e6', intensity: 0.78 },
    hemi: { intensity: 0.5, color: '#ffffff', ground: '#9ab38a' },
    colors: { grass: '#93c96f', grass2: '#b0d77f', sand: '#d9c9a0', rock: '#a9a6b4', snow: '#f4f7fb', seabed: '#6aa0b0' },
    surface: 'grass',
    height: (x, z, d) => {
      const hills = smoothstep(3, 28, d) * fbm(x * 0.035, z * 0.035, 4, 5) * 5;
      const mountains = smoothstep(70, 150, Math.hypot(x, z * 1.2)) * (8 + ridge(x, z, 0.018, 7) * 30);
      return -0.04 + hills + mountains;
    },
    classify: (y, slope) => (y > 20 ? 'snow' : slope > 0.7 ? 'rock' : 'grass'),
    scatter: [
      { id: 'treeround', on: ['grass'], density: 0.9, scale: [0.8, 1.3], d: [7, 90], r: 1.6 },
      { id: 'tree', on: ['grass'], density: 0.5, scale: [0.8, 1.3], d: [9, 100], r: 1.6 },
      { id: 'bushround', on: ['grass'], density: 2, scale: [0.7, 1.2], d: [3, 80], r: 0.8 },
      { id: 'flowers', on: ['grass'], density: 3.5, d: [1.5, 60] },
      { id: 'grass', on: ['grass'], density: 16, d: [1, 50] },
      { id: 'fern', on: ['grass'], density: 1.5, d: [3, 60] },
      { id: 'rocksmall', on: ['grass', 'rock'], density: 0.6 },
    ],
    landmarks: [
      { id: 'house2', x: -34, z: 34, r: 0.5, tint: '#e8767a' },
      { id: 'fence', x: 16, z: 18, r: 0.2 },
      { id: 'fence', x: 19.5, z: 18.6, r: 0.2 },
      { id: 'fence', x: 23, z: 19.2, r: 0.2 },
    ],
    ambient: [{ kind: 'petals', y: 6, size: [50, 8, 40] }],
    birds: 4,
    clouds: { n: 14, y: [26, 38], d: [40, 150], s: [3, 6] },
    sound: 'meadow',
  },
  garden: {
    sky: ['#8ec5ee', '#eef6ea'],
    fog: '#d6ebe0',
    fogDensity: 0.006,
    sun: { color: '#fff6e6', intensity: 0.78 },
    hemi: { intensity: 0.5, color: '#ffffff', ground: '#9ab38a' },
    colors: { grass: '#93c96f', grass2: '#a6d27a', sand: '#d9c9a0', rock: '#a9a6b4', paving: '#ddd5c6', snow: '#f4f7fb' },
    surface: 'grass',
    height: (x, z, d) => -0.04 + smoothstep(10, 40, d) * fbm(x * 0.04, z * 0.04, 4, 15) * 4 + smoothstep(80, 160, Math.hypot(x, z)) * (6 + ridge(x, z, 0.02, 3) * 20),
    classify: (y, slope, d) => (d > 0.3 && d < 3.2 ? 'paving' : y > 18 ? 'snow' : slope > 0.7 ? 'rock' : 'grass'),
    scatter: [
      { id: 'hedge', on: ['grass'], density: 1.5, d: [4, 9], r: 1, cluster: 0.4 },
      { id: 'treeround', on: ['grass'], density: 0.9, scale: [0.8, 1.3], d: [8, 90], r: 1.6 },
      { id: 'bushround', on: ['grass'], density: 2.4, d: [3.5, 60], r: 0.8 },
      { id: 'flowers', on: ['grass'], density: 5, d: [3.4, 40] },
      { id: 'grass', on: ['grass'], density: 12, d: [3.4, 50] },
      { id: 'flowerbox', on: ['paving'], density: 1.2, r: 0.8, cluster: 0.2 },
    ],
    landmarks: [
      { id: 'fountain', x: -18, z: 16, r: 0 },
      { id: 'bench', x: 12, z: 14, r: Math.PI },
      { id: 'streetlamp', x: -9, z: 12 },
      { id: 'streetlamp', x: 9, z: 12 },
    ],
    ambient: [{ kind: 'petals', y: 6, size: [50, 8, 40] }],
    birds: 4,
    clouds: { n: 12, y: [26, 38], d: [40, 150], s: [3, 6] },
    sound: 'meadow',
  },
  city: {
    sky: ['#9cc4ee', '#f0f3f8'],
    fog: '#dde6ef',
    fogDensity: 0.0065,
    sun: { color: '#fff4e6', intensity: 0.76 },
    hemi: { intensity: 0.52, color: '#ffffff', ground: '#b8b0a8' },
    colors: { paving: '#d8d0c2', grass: '#9cc97a', grass2: '#a8d184', rock: '#b8b4c2' },
    surface: 'tiles',
    height: (x, z) => -0.04 + smoothstep(90, 170, Math.hypot(x, z)) * (6 + ridge(x, z, 0.02, 4) * 22),
    classify: (y, slope, d, x, z) => (y > 3 ? 'rock' : d > 26 && fbm(x * 0.05, z * 0.05, 2, 9) > 0.55 ? 'grass' : 'paving'),
    scatter: [
      { id: 'treeround', on: ['paving', 'grass'], density: 0.35, d: [5, 60], r: 1.6, cluster: 0.5 },
      { id: 'bushround', on: ['paving'], density: 0.6, d: [3, 12], r: 0.7, cluster: 0.4 },
      { id: 'flowerbox', on: ['paving'], density: 0.5, d: [2.5, 10], r: 0.6 },
    ],
    sound: 'city',
    birds: 3,
    clouds: { n: 12, y: [30, 42], d: [50, 150], s: [3, 6] },
    extra: (b) => b.cityBlocks(),
  },
  ice: {
    sky: ['#9fd2ef', '#f2fbff'],
    fog: '#dceff8',
    fogDensity: 0.0065,
    sun: { color: '#f2f8ff', intensity: 0.8 },
    hemi: { intensity: 0.56, color: '#eaf6ff', ground: '#8fb6c8' },
    colors: { snow: '#f4f8fb', rock: '#b9c6d6', grass: '#e6eef5', sand: '#dfe9f0', seabed: '#2c6f8f' },
    surface: 'snow',
    water: { kind: 'water', color: '#2788ad', alpha: 0.76 },
    height: (x, z, d, w) => {
      // icebergs and floes in a cold sea, snowy mountains far behind
      const berg = smoothstep(0.58, 0.72, fbm(x * 0.03, z * 0.03, 3, 44)) * smoothstep(10, 22, d);
      const floe = smoothstep(0.62, 0.66, fbm(x * 0.11, z * 0.11, 3, 45)) * smoothstep(3, 6, d);
      const far = smoothstep(80, 150, Math.hypot(x, z * 1.1)) * (10 + ridge(x, z, 0.02, 46) * 28);
      const y = w - 3 + berg * (3.4 + ridge(x, z, 0.08, 47) * 6) + floe * 3.25 + far;
      return y;
    },
    classify: (y, slope) => (slope > 0.9 ? 'rock' : 'snow'),
    scatter: [
      { id: 'rocksmall', on: ['snow'], density: 0.6, scale: [0.8, 1.6], tint: '#dfe8f2', dry: 0.3 },
      { id: 'snowpine', on: ['snow'], density: 0.8, scale: [0.8, 1.3], d: [20, 160], dry: 1.5, r: 1.2 },
    ],
    ambient: [{ kind: 'snow', y: 16, size: [70, 4, 60], z: 6 }],
    clouds: { n: 10, y: [26, 38], d: [50, 150], s: [3, 6] },
    sound: 'ice',
    extra: (b) => b.icebergs(),
  },
  clouds: {
    sky: ['#5fa8e6', '#8cc2ef'],
    fog: '#cfe3f6',
    fogDensity: 0.0028,
    sun: { color: '#fff8ec', intensity: 0.82 },
    hemi: { intensity: 0.6, color: '#ffffff', ground: '#c9d6ea' },
    colors: {},
    surface: 'grass',
    height: () => -100,
    scatter: [],
    birds: 5,
    clouds: { n: 28, y: [-24, -12], d: [-30, 150], s: [3, 6] },
    ambient: [{ kind: 'motes', y: 4, size: [60, 10, 40] }],
    sound: 'wind',
    extra: (b) => b.floatingIslands(),
  },
  studio: {
    sky: ['#191a33', '#2a2550'],
    fog: '#1b1a35',
    fogDensity: 0.006,
    sun: { color: '#ffe8d0', intensity: 0.35 },
    hemi: { intensity: 0.3, color: '#c9c2ff', ground: '#2a2440' },
    colors: { paving: '#3b3560' },
    surface: 'tiles',
    height: () => -0.06,
    classify: () => 'paving',
    scatter: [],
    ambient: [{ kind: 'sparkles', y: 5, size: [30, 8, 10], z: 8 }],
    sound: 'studio',
    extra: (b) => b.studio(),
  },
  desert: {
    sky: ['#9cc9ec', '#fbeed6'],
    fog: '#f2e2c6',
    fogDensity: 0.006,
    sun: { color: '#fff0d2', intensity: 0.84 },
    hemi: { intensity: 0.48, color: '#fff6ea', ground: '#c9a27a' },
    colors: { sand: '#efcf9a', rock: '#d4876a', grass: '#c9b27a' },
    surface: 'sand',
    height: (x, z, d) => {
      const dunes = smoothstep(4, 20, d) * (fbm(x * 0.05, z * 0.05, 3, 61) * 2 + ridge(x, z, 0.03, 62) * 1.5);
      // mesas: flat-topped plateaus with steep walls
      const m = fbm(x * 0.022, z * 0.022, 3, 63) + smoothstep(25, 90, d) * 0.12;
      const mesa = smoothstep(0.6, 0.64, m) * (9 + fbm(x * 0.01, z * 0.01, 2, 64) * 10) * smoothstep(16, 30, d);
      return -0.04 + dunes + mesa;
    },
    classify: (y, slope) => (y > 3.5 || slope > 0.8 ? 'rock' : 'sand'),
    scatter: [
      { id: 'cactus', on: ['sand'], density: 0.8, scale: [0.8, 1.4], d: [4, 90], r: 0.8 },
      { id: 'deadtree', on: ['sand'], density: 0.15, d: [8, 80], r: 1 },
      { id: 'bones', on: ['sand'], density: 0.25, d: [3, 60] },
      { id: 'rocksmall', on: ['sand', 'rock'], density: 1.2, scale: [0.8, 1.8], tint: '#d9a080' },
      { id: 'ashplant', on: ['sand'], density: 1.6, d: [3, 60], tint: '#b7a46a' },
    ],
    ambient: [{ kind: 'motes', y: 3, size: [60, 6, 40] }],
    birds: 2,
    clouds: { n: 6, y: [30, 44], d: [60, 150], s: [3, 6] },
    sound: 'desert',
  },
  nightwood: {
    sky: ['#121735', '#283466'],
    fog: '#1e2750',
    fogDensity: 0.008,
    sun: { color: '#a9b8ff', intensity: 0.3 },
    hemi: { intensity: 0.34, color: '#8ea0ff', ground: '#22283a' },
    colors: { grass: '#40705a', grass2: '#365f4d', rock: '#59607a', sand: '#5a5a58' },
    surface: 'grass',
    height: (x, z, d) => -0.04 + smoothstep(3, 30, d) * fbm(x * 0.04, z * 0.04, 4, 71) * 5 + smoothstep(70, 150, Math.hypot(x, z)) * (10 + ridge(x, z, 0.02, 72) * 18),
    classify: (y, slope) => (slope > 0.7 ? 'rock' : 'grass'),
    scatter: [
      { id: 'tree', on: ['grass'], density: 1.6, scale: [0.9, 1.5], d: [4, 90], r: 1.4 },
      { id: 'treeround', on: ['grass'], density: 0.8, scale: [0.9, 1.4], d: [5, 90], r: 1.4 },
      { id: 'bushround', on: ['grass'], density: 2.4, d: [2, 60], r: 0.7 },
      { id: 'fern', on: ['grass'], density: 3, d: [1.5, 50] },
      { id: 'mushroom', on: ['grass'], density: 0.7, d: [2, 40] },
      { id: 'grass', on: ['grass'], density: 10, d: [1, 40] },
      { id: 'rocksmall', on: ['grass', 'rock'], density: 0.6 },
    ],
    ambient: [{ kind: 'fireflies', y: 1.6, size: [40, 3, 30], z: 2 }],
    sound: 'night',
    extra: (b) => b.nightSky(),
  },
};

export function scenerySound(set: MgSet): AmbienceKey {
  return SETS[set].sound;
}

// ------------------------------------------------------------------------------ builder

const GROUNDS: Ground[] = ['grass', 'sand', 'rock', 'snow', 'paving', 'under'];
const N = 110;
const EXTENT = 190;

export class SceneryBuilder {
  readonly root: TransformNode;
  readonly def: SetDef;
  readonly cx: number;
  readonly cz: number;
  readonly g: number;
  readonly w: number;
  private h = new Float32Array((N + 1) * (N + 1));
  private keep: { x: number; z: number; r: number }[] = [];
  private water: Mesh | null = null;
  private waterTex: Texture | null = null;
  private emitters: ParticleSystem[] = [];
  private birds: { node: TransformNode; wings: Mesh[]; r: number; h: number; speed: number; phase: number; cx: number; cz: number }[] = [];
  private spinners: { node: TransformNode; speed: number }[] = [];
  private bobbers: { node: TransformNode; y: number; phase: number }[] = [];
  private beams: Mesh[] = [];
  private t = 0;
  private mats: StandardMaterial[] = [];
  private backup: { sun: number; sunCol: Color3; hemi: number; hemiCol: Color3; hemiGround: Color3; fog: number } | null = null;
  readonly lowQ: boolean;
  readonly testMode: boolean;

  constructor(
    private readonly stage: Stage,
    readonly sc: MgScenery,
  ) {
    this.def = SETS[sc.set];
    this.cx = sc.clear.x ?? 0;
    this.cz = sc.clear.z ?? 0;
    this.g = sc.ground ?? 0;
    this.w = sc.water ?? this.g - 0.35;
    this.root = new TransformNode(`scenery_${sc.set}`, stage.scene);
    this.lowQ = stage.qualityLevel === 0;
    this.testMode = new URLSearchParams(location.search).get('quality') === '0';
    this.applyLight();
    const d = this.def;
    stage.setSky(d.sky[0], d.sky[1], d.fog);
    if (d.height(0, 0, 50, this.w) > -50) this.buildTerrain();
    if (d.water) this.buildWater();
    if (!this.testMode) {
      d.extra?.(this);
      for (const lm of d.landmarks ?? []) this.landmark(lm);
      this.buildScatter();
      if (d.clouds) this.buildClouds(d.clouds);
      for (let k = 0; k < (d.birds ?? 0); k++) this.bird(k);
      for (const a of d.ambient ?? []) this.emitters.push(ambient(stage, a.kind, new Vector3(this.cx, this.g + a.y, this.cz + (a.z ?? 0)), new Vector3(...a.size)));
    } else d.extra?.(this);
  }

  // ---------------------------------------------------------------- geometry helpers

  /** Signed distance to the play area outline (< 0 inside). */
  dist(x: number, z: number): number {
    const c = this.sc.clear;
    const dx = x - this.cx;
    const dz = z - this.cz;
    if (c.r !== undefined) return Math.hypot(dx, dz) - c.r;
    const ex = Math.abs(dx) - (c.w ?? 10) / 2;
    const ez = Math.abs(dz) - (c.d ?? 10) / 2;
    return Math.hypot(Math.max(ex, 0), Math.max(ez, 0)) + Math.min(Math.max(ex, ez), 0);
  }

  private rawHeight(x: number, z: number): number {
    const d = this.dist(x, z);
    const y = this.def.height(x - this.cx, z - this.cz, d, this.w - this.g) + this.g;
    if (!this.def.water) return d < 0 ? Math.min(y, this.g - 0.04) : y;
    // water sets: land reaching into the play area is levelled to the ground (beach games),
    // with a short blend; water inside the play area stays water
    if (d < 4 && y > this.w + 0.05) return this.g - 0.04 + (y - (this.g - 0.04)) * smoothstep(0, 4, d);
    return y;
  }

  /** Grid coordinate → world (dense near the play area, coarse at the horizon). */
  private gx(i: number): number {
    const u = (i / N) * 2 - 1;
    return this.cx + Math.sign(u) * EXTENT * Math.abs(u) ** 1.75;
  }

  private gz(j: number): number {
    const u = (j / N) * 2 - 1;
    return this.cz + Math.sign(u) * EXTENT * Math.abs(u) ** 1.75;
  }

  height(x: number, z: number): number {
    return this.rawHeight(x, z);
  }

  private slope(x: number, z: number): number {
    const e = 0.8;
    const dx = this.rawHeight(x + e, z) - this.rawHeight(x - e, z);
    const dz = this.rawHeight(x, z + e) - this.rawHeight(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  ground(x: number, z: number, y = this.rawHeight(x, z)): Ground {
    if (this.def.water && y < this.w + 0.05) return 'under';
    return this.def.classify?.(y - this.g, this.slope(x, z), this.dist(x, z), x - this.cx, z - this.cz) ?? 'grass';
  }

  private color(gr: Ground, x: number, z: number, y: number): Color3 {
    const c = this.def.colors;
    const n = fbm(x * 0.09, z * 0.09, 3, 21);
    switch (gr) {
      case 'grass': {
        const a = Color3.FromHexString(c.grass ?? '#93c96f');
        return Color3.Lerp(a, Color3.FromHexString(c.grass2 ?? c.grass ?? '#a6d27a'), smoothstep(0.35, 0.7, n));
      }
      case 'under': {
        const depth = this.w - y;
        return Color3.Lerp(Color3.FromHexString(c.sand ?? '#e8d8b0'), Color3.FromHexString(c.seabed ?? '#3f8fb0'), smoothstep(0.1, 2.6, depth));
      }
      case 'sand': {
        const s = Color3.FromHexString(c.sand ?? '#efe0b8');
        return y < this.w + 0.25 && this.def.water ? s.scale(0.86) : s.scale(0.96 + n * 0.08);
      }
      case 'rock': {
        const r = Color3.FromHexString(c.rock ?? '#b9b6c4');
        // strata bands on cliffs and mesas
        return r.scale(0.9 + 0.12 * Math.sin(y * 2.2 + n * 3));
      }
      default:
        return Color3.FromHexString(c[gr] ?? '#cccccc').scale(0.96 + n * 0.08);
    }
  }

  private buildTerrain() {
    const s = this.stage;
    const R = N + 1;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) this.h[j * R + i] = this.rawHeight(this.gx(i), this.gz(j));
    // vertex colors per grid vertex, faceted lighting per triangle
    const vc = new Float32Array(R * R * 3);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = this.gx(i);
        const z = this.gz(j);
        const y = this.h[j * R + i];
        const c = this.color(this.ground(x, z, y), x, z, y);
        vc.set([c.r, c.g, c.b], (j * R + i) * 3);
      }
    }
    const tris = N * N * 2;
    const pos = new Float32Array(tris * 9);
    const nrm = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 12);
    const uv = new Float32Array(tris * 6);
    const idx = new Uint32Array(tris * 3);
    let v = 0;
    const P = (k: number) => [this.gx(k % R), this.h[k], this.gz(Math.floor(k / R))];
    const tri = (a: number, b: number, c: number) => {
      let pa = P(a);
      let pb = P(b);
      let pc = P(c);
      // Babylon culls clockwise faces: make the triangle face up
      if ((pb[0] - pa[0]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[0] - pa[0]) < 0) {
        [pb, pc] = [pc, pb];
        [b, c] = [c, b];
      }
      const ux = pb[0] - pa[0];
      const uy = pb[1] - pa[1];
      const uz = pb[2] - pa[2];
      const wx = pc[0] - pa[0];
      const wy = pc[1] - pa[1];
      const wz = pc[2] - pa[2];
      let fx = uy * wz - uz * wy;
      let fy = uz * wx - ux * wz;
      let fz = ux * wy - uy * wx;
      const l = Math.hypot(fx, fy, fz) || 1;
      const sg = fy < 0 ? -1 : 1;
      fx = (fx / l) * sg;
      fy = (fy / l) * sg;
      fz = (fz / l) * sg;
      const jit = 0.985 + noise2((pa[0] + ux / 3 + wx / 3) * 0.9, (pa[2] + uz / 3 + wz / 3) * 0.9, 33) * 0.03;
      for (const [k, p] of [
        [a, pa],
        [b, pb],
        [c, pc],
      ] as const) {
        pos.set(p, v * 3);
        nrm.set([fx, fy, fz], v * 3);
        col.set([vc[k * 3] * jit, vc[k * 3 + 1] * jit, vc[k * 3 + 2] * jit, 1], v * 4);
        uv.set([p[0] / 6, p[2] / 6], v * 2);
        idx[v] = v;
        v++;
      }
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k00 = j * R + i;
        const k10 = k00 + 1;
        const k01 = k00 + R;
        const k11 = k01 + 1;
        if ((i + j) % 2 === 0) {
          tri(k00, k01, k11);
          tri(k00, k11, k10);
        } else {
          tri(k00, k01, k10);
          tri(k10, k01, k11);
        }
      }
    }
    const m = new Mesh('mgTerrain', s.scene);
    const vd = new VertexData();
    Object.assign(vd, { positions: pos, normals: nrm, colors: col, uvs: uv, indices: idx });
    vd.applyToMesh(m);
    m.parent = this.root;
    const mat = this.own(new StandardMaterial(`mgTerrainMat_${this.sc.set}`, s.scene));
    mat.diffuseTexture = this.def.surface === 'grass' || this.def.surface === 'basalt' ? detailTexture(s.scene, this.sc.set) : surfaceTexture(s.scene, this.def.surface);
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    mat.ambientColor = new Color3(0.35, 0.35, 0.35);
    m.material = mat;
    m.receiveShadows = true;
    m.isPickable = false;
    m.freezeWorldMatrix();
  }

  private buildWater() {
    const s = this.stage;
    const wd = this.def.water!;
    const w = MeshBuilder.CreateGround('mgWater', { width: 700, height: 700 }, s.scene);
    w.position.set(this.cx, this.w, this.cz);
    w.parent = this.root;
    w.isPickable = false;
    const mat = this.own(new StandardMaterial(`mgWaterMat_${this.sc.set}`, s.scene));
    if (wd.kind === 'lava') {
      const tex = copyTexture(s.scene, lavaTexture(s.scene, true), 'mgLava');
      tex.uScale = tex.vScale = 700 / 30;
      mat.emissiveTexture = tex;
      mat.diffuseColor = new Color3(0.12, 0.04, 0.03);
      mat.specularColor = Color3.Black();
      this.waterTex = tex;
    } else {
      mat.diffuseColor = Color3.FromHexString(wd.color);
      mat.alpha = wd.alpha ?? 0.76;
      mat.specularColor = new Color3(0.6, 0.65, 0.7);
      mat.specularPower = 110;
      const bump = copyTexture(s.scene, waterNormals(s.scene), 'mgWaterN');
      bump.uScale = bump.vScale = 700 / 5;
      bump.level = 0.25;
      mat.bumpTexture = bump;
      this.waterTex = bump;
      mat.backFaceCulling = false;
    }
    w.material = mat;
    w.receiveShadows = true;
    this.water = w;
    // dark floor far below so the horizon never shows the void
    const floor = MeshBuilder.CreateGround('mgSeaFloor', { width: 700, height: 700 }, s.scene);
    floor.position.set(this.cx, this.w - 7, this.cz);
    floor.parent = this.root;
    const fm = this.own(new StandardMaterial(`mgSeaFloorMat_${this.sc.set}`, s.scene));
    fm.diffuseColor = Color3.FromHexString(this.def.colors.seabed ?? '#2a1612').scale(0.9);
    fm.specularColor = Color3.Black();
    floor.material = fm;
    floor.isPickable = false;
  }

  // ---------------------------------------------------------------- props

  private isFree(x: number, z: number, r: number): boolean {
    for (const k of this.keep) if (Math.abs(k.x - x) < k.r + r && Math.abs(k.z - z) < k.r + r && Math.hypot(k.x - x, k.z - z) < k.r + r) return false;
    return true;
  }

  /** Places a library prop (returns null when the prop is missing). */
  prop(id: string, x: number, z: number, opts: { s?: number; r?: number; tint?: string; y?: number; shadow?: boolean } = {}): TransformNode | null {
    const node = this.stage.assets.prop(id, `sc_${id}_${this.keep.length}`, this.root, opts.tint);
    if (!node) return null;
    node.position.set(x, opts.y ?? this.height(x, z) - 0.05, z);
    node.rotation.y = opts.r ?? 0;
    node.scaling.setAll(opts.s ?? 1);
    const near = this.dist(x, z) < 22;
    for (const m of node.getChildMeshes()) {
      m.receiveShadows = true;
      m.isPickable = false;
      if (!near || opts.shadow === false) this.stage.shadows.removeShadowCaster(m, false);
    }
    node.freezeWorldMatrix();
    for (const m of node.getChildMeshes()) m.freezeWorldMatrix();
    this.keep.push({ x, z, r: 1.5 * (opts.s ?? 1) });
    return node;
  }

  private landmark(lm: Landmark) {
    const x = this.cx + lm.x;
    const z = this.cz + lm.z;
    if (this.dist(x, z) < 1) return;
    const y = lm.y === 'water' ? this.w - 0.05 : lm.y;
    const node = this.prop(lm.id, x, z, { s: lm.s, r: lm.r, tint: lm.tint, y });
    if (node && lm.y === 'water' && lm.id === 'boat') {
      node.unfreezeWorldMatrix();
      this.bobbers.push({ node, y: node.position.y, phase: lm.x * 0.3 });
    }
  }

  private buildScatter() {
    const tr = this.def;
    tr.scatter.forEach((rule, ri) => {
      if (!this.stage.assets.hasProp(rule.id)) return;
      const rnd = prng((this.sc.seed ?? 1) * 7717 + ri * 7919);
      const cell = Math.sqrt(100 / (rule.density * (this.lowQ ? 0.35 : 1)));
      const [d0, d1] = rule.d ?? [1.2, 110];
      const span = d1 + Math.max(this.sc.clear.r ?? 0, (this.sc.clear.w ?? 0) / 2, (this.sc.clear.d ?? 0) / 2);
      const mats: Matrix[] = [];
      const cl = rule.cluster ?? 0.85;
      for (let z = this.cz - span; z < this.cz + span; z += cell) {
        for (let x = this.cx - span; x < this.cx + span; x += cell) {
          const px = x + rnd() * cell;
          const pz = z + rnd() * cell;
          const roll = rnd();
          const yaw = rnd();
          const scR = rnd();
          const d = this.dist(px, pz);
          if (d < d0 || d > d1) continue;
          // the camera looks towards +z: skip most of the hidden foreground
          if (pz < this.cz - 14 - (this.sc.clear.d ?? (this.sc.clear.r ?? 0) * 2) / 2 && rnd() < 0.85) continue;
          if (roll > 1 - cl + cl * smoothstep(0.28, 0.62, fbm(px * 0.06 + ri, pz * 0.06, 3, 50 + ri))) continue;
          const y = this.height(px, pz);
          if (this.def.water && y < this.w + (rule.dry ?? 0.1)) continue;
          if (!rule.on.includes(this.ground(px, pz, y))) continue;
          // nothing perches on cliffs and mesa walls
          if (this.slope(px, pz) > 0.65) continue;
          const big = rule.r ?? 0;
          if (!this.isFree(px, pz, big || 0.3)) continue;
          const [lo, hi] = rule.scale ?? [0.8, 1.2];
          const sc = lo + (hi - lo) * scR;
          mats.push(Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.FromEulerAngles(0, yaw * Math.PI * 2, 0), new Vector3(px, y - 0.05, pz)));
          if (big) this.keep.push({ x: px, z: pz, r: big * sc });
        }
      }
      const small = /grass|shell|fern|flowers|rocksmall|ashplant|bones/.test(rule.id);
      this.stage.assets.instances(rule.id, `mgsc_${rule.id}_${ri}`, this.root, mats, { shadows: !small && d1 <= 30, tint: rule.tint });
    });
  }

  private cloudTemplate(): Mesh {
    const parts: Mesh[] = [];
    const rnd = prng(91);
    for (let k = 0; k < 6; k++) {
      const b = MeshBuilder.CreateIcoSphere(`cl${k}`, { radius: 0.5 + rnd() * 0.35, subdivisions: 2 }, this.stage.scene);
      b.position.set((k - 2.5) * 0.45 + rnd() * 0.2, rnd() * 0.25 + (k === 2 || k === 3 ? 0.25 : 0), (rnd() - 0.5) * 0.5);
      b.scaling.y = 0.75;
      parts.push(b);
    }
    const m = Mesh.MergeMeshes(parts, true)!;
    m.convertToFlatShadedMesh();
    // soft grey bellies
    const pos = m.getVerticesData('position')!;
    const col: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const k = 0.8 + 0.2 * smoothstep(-0.3, 0.5, pos[i + 1]);
      col.push(k, k, k * 1.02, 1);
    }
    m.setVerticesData('color', col);
    const mat = this.own(new StandardMaterial('cloudMat', this.stage.scene));
    mat.diffuseColor = Color3.White();
    mat.emissiveColor = new Color3(0.2, 0.22, 0.26);
    mat.specularColor = Color3.Black();
    m.material = mat;
    m.parent = this.root;
    m.isPickable = false;
    return m;
  }

  private buildClouds(c: NonNullable<SetDef['clouds']>) {
    const m = this.cloudTemplate();
    const rnd = prng(17 + (this.sc.seed ?? 1));
    const buf = new Float32Array(c.n * 16);
    let n = 0;
    for (let k = 0; k < c.n * 4 && n < c.n; k++) {
      const a = rnd() * Math.PI * 2;
      const r = c.d[0] + rnd() * (c.d[1] - c.d[0]);
      const x = this.cx + Math.cos(a) * r;
      const z = this.cz + Math.abs(Math.sin(a)) * r * (c.y[1] > 0 || rnd() < 0.85 ? 1 : -0.4);
      if (this.dist(x, z) < 4 && c.y[1] > -2) continue;
      const sc = c.s[0] + rnd() * (c.s[1] - c.s[0]);
      Matrix.Compose(new Vector3(sc * 1.6, sc, sc), Quaternion.FromEulerAngles(0, rnd() * 0.6 - 0.3, 0), new Vector3(x, this.g + c.y[0] + rnd() * (c.y[1] - c.y[0]), z)).copyToArray(buf, n * 16);
      n++;
    }
    m.thinInstanceSetBuffer('matrix', buf.subarray(0, n * 16), 16, true);
    m.thinInstanceRefreshBoundingInfo(false);
    m.useVertexColors = true;
    this.spinners.push({ node: m, speed: 0.004 });
  }

  private bird(k: number) {
    const s = this.stage;
    const node = new TransformNode(`bird${k}`, s.scene);
    node.parent = this.root;
    const mat = s.mat(this.sc.set === 'desert' ? '#3d3a4a' : '#ffffff');
    const wings = [-1, 1].map((sd) => {
      const w = MeshBuilder.CreatePlane(`wing${k}${sd}`, { width: 0.9, height: 0.32, sideOrientation: Mesh.DOUBLESIDE }, s.scene);
      w.setPivotPoint(new Vector3(-sd * 0.45, 0, 0));
      w.position.x = sd * 0.45;
      w.rotation.x = Math.PI / 2;
      w.material = mat;
      w.parent = node;
      w.isPickable = false;
      return w;
    });
    const body = MeshBuilder.CreateSphere(`birdb${k}`, { diameter: 0.28, segments: 3 }, s.scene);
    body.scaling.z = 2.2;
    body.material = mat;
    body.parent = node;
    const rnd = prng(300 + k);
    this.birds.push({ node, wings, r: 18 + rnd() * 26, h: 12 + rnd() * 10, speed: (0.18 + rnd() * 0.12) * (rnd() < 0.5 ? 1 : -1), phase: rnd() * 6.3, cx: this.cx + (rnd() - 0.5) * 30, cz: this.cz + 18 + rnd() * 25 });
  }

  // ---------------------------------------------------------------- set specials

  cityBlocks(): void {
    // houses in rows around the plaza, facing it; larger blocks further out
    const kinds = ['house', 'house2', 'house3'];
    const tints = ['#e8767a', '#6f9de6', '#f2c25c', '#7fc79a', '#b48be0', '#f49a6a'];
    const rnd = prng(41 + (this.sc.seed ?? 1));
    const c = this.sc.clear;
    const hw = (c.w ?? (c.r ?? 8) * 2) / 2;
    const hd = (c.d ?? (c.r ?? 8) * 2) / 2;
    const ring = (off: number, gap: number) => {
      const sides: [number, number, number, number, number][] = [
        // x0, z0, dx, dz, yaw (facing the center)
        [-hw - off, hd + off, 1, 0, Math.PI],
        [-hw - off, -hd - off - 6, 0, 1, Math.PI / 2],
        [hw + off, -hd - off - 6, 0, 1, -Math.PI / 2],
      ];
      for (const [x0, z0, dx, dz, yaw] of sides) {
        const len = dx ? 2 * (hw + off) : hd + off + 6 + hd + off;
        for (let t = 0; t <= len; t += gap + rnd() * 1.5) {
          const x = this.cx + x0 + dx * t;
          const z = this.cz + z0 + dz * t;
          if (!this.isFree(x, z, 2)) continue;
          const kind = kinds[Math.floor(rnd() * kinds.length)];
          this.prop(kind, x, z, { r: yaw + (rnd() - 0.5) * 0.1, tint: tints[Math.floor(rnd() * tints.length)], s: 0.95 + rnd() * 0.2 });
        }
      }
    };
    ring(9, 4.6);
    if (!this.lowQ) ring(16, 5.2);
    // street furniture between the plaza and the houses
    const furn = ['streetlamp', 'bench', 'kiosk', 'mailbox', 'bike', 'flowerbox'];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const x = this.cx + Math.cos(a) * (hw + 4.5);
      const z = this.cz + Math.sin(a) * (hd + 4.5);
      if (this.dist(x, z) < 1.5 || !this.isFree(x, z, 0.8)) continue;
      const id = k % 2 === 0 ? 'streetlamp' : furn[1 + Math.floor(rnd() * (furn.length - 1))];
      this.prop(id, x, z, { r: Math.atan2(this.cx - x, this.cz - z) + Math.PI, tint: tints[k % tints.length] });
    }
  }

  icebergs(): void {
    // the terrain makes the bergs; give the near floes a little bob
    if (this.lowQ) return;
    const s = this.stage;
    const rnd = prng(81);
    for (let k = 0; k < 9; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 12 + rnd() * 26;
      const x = this.cx + Math.cos(a) * r;
      const z = this.cz + Math.abs(Math.sin(a)) * r;
      if (this.dist(x, z) < 3) continue;
      const floe = MeshBuilder.CreateCylinder(`floe${k}`, { diameterTop: 2.4 + rnd() * 2, diameterBottom: 2.8 + rnd() * 2, height: 0.5, tessellation: 7 }, s.scene);
      floe.convertToFlatShadedMesh();
      floe.scaling.z = 0.6 + rnd() * 0.6;
      floe.rotation.y = rnd() * 3;
      floe.material = surfaceMat(s, '#f2f8fc', 'snow');
      floe.position.set(x, this.w + 0.1, z);
      floe.parent = this.root;
      floe.receiveShadows = true;
      this.bobbers.push({ node: floe, y: floe.position.y, phase: rnd() * 6 });
    }
  }

  floatingIslands(): void {
    const s = this.stage;
    const rnd = prng(23);
    const spots: [number, number, number, number][] = [
      [-30, 26, 2, 1.2],
      [34, 34, -1, 1.5],
      [-6, 62, 6, 2.2],
      [-60, 70, 10, 2],
      [62, 80, 4, 2.4],
    ];
    for (const [ix, iz, iy, sc] of spots) {
      const x = this.cx + ix;
      const z = this.cz + iz;
      const node = new TransformNode('isle', s.scene);
      node.parent = this.root;
      node.position.set(x, this.g + iy, z);
      node.scaling.setAll(sc);
      const top = MeshBuilder.CreateCylinder('isleTop', { diameterTop: 6, diameterBottom: 5.2, height: 0.9, tessellation: 9 }, s.scene);
      top.convertToFlatShadedMesh();
      top.material = surfaceMat(s, '#93c96f', 'grass');
      top.parent = node;
      const under = MeshBuilder.CreateCylinder('isleRock', { diameterTop: 5.2, diameterBottom: 0.6, height: 4.5, tessellation: 7 }, s.scene);
      under.convertToFlatShadedMesh();
      under.position.y = -2.65;
      under.material = surfaceMat(s, '#b5a8a0', 'stone');
      under.parent = node;
      const tree = s.assets.prop(rnd() < 0.5 ? 'treeround' : 'tree', 'isleTree', node);
      if (tree) tree.position.set(rnd() - 0.5, 0.42, rnd() - 0.5);
      const bush = s.assets.prop('bushround', 'isleBush', node);
      if (bush) bush.position.set(1.6, 0.42, -0.8);
      this.bobbers.push({ node, y: node.position.y, phase: rnd() * 6 });
    }
  }

  studio(): void {
    const s = this.stage;
    const c = this.sc.clear;
    const hw = (c.w ?? (c.r ?? 8) * 2) / 2 + 3;
    const backZ = this.cz + (c.d ?? (c.r ?? 8) * 2) / 2 + 4;
    // curtain: vertical folds
    const folds = Math.ceil((hw * 2 + 10) / 1.1);
    for (let k = 0; k < folds; k++) {
      const x = this.cx - hw - 5 + k * 1.1;
      const f = MeshBuilder.CreateCylinder(`curtain${k}`, { diameter: 1.25, height: 14, tessellation: 6 }, s.scene);
      f.convertToFlatShadedMesh();
      f.position.set(x, this.g + 6.5, backZ + (k % 2) * 0.3);
      f.scaling.z = 0.5;
      f.material = surfaceMat(s, '#b8324a', 'cloth');
      f.parent = this.root;
      f.isPickable = false;
    }
    // stage riser with marquee bulbs along the edge
    const riser = MeshBuilder.CreateBox('riser', { width: hw * 2 + 8, height: 0.5, depth: 6 }, s.scene);
    riser.position.set(this.cx, this.g - 0.25, backZ - 2.5);
    riser.material = surfaceMat(s, '#4a3f78', 'planks');
    riser.parent = this.root;
    riser.receiveShadows = true;
    const bulb = MeshBuilder.CreateSphere('bulb', { diameter: 0.32, segments: 4 }, s.scene);
    bulb.material = s.mat('#ffe6a0', { emissive: 1 });
    bulb.parent = this.root;
    const buf: number[] = [];
    const tmp = Matrix.Identity();
    // arch of bulbs framing the stage
    const archW = hw + 3;
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI;
      Matrix.TranslationToRef(this.cx - Math.cos(a) * archW, this.g + 1 + Math.sin(a) * 9, backZ - 1.2, tmp);
      buf.push(...tmp.asArray());
    }
    for (let x = -hw - 3; x <= hw + 3; x += 0.9) {
      Matrix.TranslationToRef(this.cx + x, this.g + 0.05, backZ - 5.5, tmp);
      buf.push(...tmp.asArray());
    }
    bulb.thinInstanceSetBuffer('matrix', new Float32Array(buf), 16, true);
    bulb.thinInstanceRefreshBoundingInfo(false);
    // spotlight beams (additive cones) sweeping over the stage
    const beamMat = this.own(new StandardMaterial('beamMat', s.scene));
    beamMat.emissiveColor = new Color3(1, 0.93, 0.75);
    beamMat.diffuseColor = Color3.Black();
    beamMat.alpha = 0.12;
    beamMat.alphaMode = 1; // additive
    beamMat.disableLighting = true;
    beamMat.backFaceCulling = false;
    for (const sx of [-1, 1]) {
      const pivot = new TransformNode('beamPivot', s.scene);
      pivot.parent = this.root;
      pivot.position.set(this.cx + sx * (hw + 1), this.g + 13, backZ - 3);
      const cone = MeshBuilder.CreateCylinder('beam', { diameterTop: 0.6, diameterBottom: 6, height: 14, tessellation: 16, cap: 0 }, s.scene);
      cone.position.y = -7;
      cone.material = beamMat;
      cone.parent = pivot;
      cone.isPickable = false;
      pivot.rotation.z = sx * 0.35;
      this.beams.push(cone);
      this.spinners.push({ node: pivot, speed: sx * 0.5 });
    }
    // audience silhouettes on tiers at the sides
    const head = MeshBuilder.CreateCapsule('fan', { radius: 0.34, height: 1.3, tessellation: 6, subdivisions: 1 }, s.scene);
    head.material = s.mat('#2c2748');
    head.parent = this.root;
    const fans: number[] = [];
    const rnd = prng(5);
    for (const sx of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 9; k++) {
          const x = this.cx + sx * (hw + 4 + row * 1.6);
          const z = this.cz - 6 + k * 1.3 + rnd() * 0.3;
          Matrix.TranslationToRef(x, this.g + 0.6 + row * 0.7, z, tmp);
          fans.push(...tmp.asArray());
        }
      }
    }
    head.thinInstanceSetBuffer('matrix', new Float32Array(fans), 16, true);
    head.thinInstanceRefreshBoundingInfo(false);
    this.bobbers.push({ node: head, y: 0, phase: 0 });
  }

  nightSky(): void {
    const s = this.stage;
    // moon with a halo
    const moon = MeshBuilder.CreateDisc('moon', { radius: 9, tessellation: 24 }, s.scene);
    const mm = this.own(new StandardMaterial('moonMat', s.scene));
    mm.emissiveColor = new Color3(0.98, 0.96, 0.85);
    mm.disableLighting = true;
    mm.fogEnabled = false;
    moon.material = mm;
    moon.position.set(this.cx - 60, this.g + 80, this.cz + 220);
    moon.parent = this.root;
    // stars: tiny quads on a dome
    const star = MeshBuilder.CreatePlane('star', { size: 0.9 }, s.scene);
    const sm = this.own(new StandardMaterial('starMat', s.scene));
    sm.emissiveColor = new Color3(1, 1, 1);
    sm.disableLighting = true;
    sm.fogEnabled = false;
    star.material = sm;
    star.billboardMode = Mesh.BILLBOARDMODE_ALL;
    star.parent = this.root;
    const rnd = prng(9);
    const count = 260;
    const buf = new Float32Array(count * 16);
    for (let k = 0; k < count; k++) {
      const a = rnd() * Math.PI * 2;
      const el = 0.15 + rnd() * 1.2;
      const r = 260;
      const sc = 0.6 + rnd() * 1.4;
      const p = new Vector3(this.cx + Math.cos(a) * Math.cos(el) * r, this.g + Math.sin(el) * r, this.cz + Math.abs(Math.sin(a)) * Math.cos(el) * r);
      Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.Identity(), p).copyToArray(buf, k * 16);
    }
    star.thinInstanceSetBuffer('matrix', buf, 16, true);
    star.thinInstanceRefreshBoundingInfo(false);
  }

  // ---------------------------------------------------------------- light

  private applyLight() {
    const s = this.stage;
    const hemi = s.scene.lights.find((l) => l.name === 'hemi') as HemisphericLight | undefined;
    if (!hemi) return;
    this.backup = { sun: s.sun.intensity, sunCol: s.sun.diffuse.clone(), hemi: hemi.intensity, hemiCol: hemi.diffuse.clone(), hemiGround: hemi.groundColor.clone(), fog: s.scene.fogDensity };
    const d = this.def;
    s.sun.intensity = d.sun.intensity;
    s.sun.diffuse = Color3.FromHexString(d.sun.color);
    hemi.intensity = d.hemi.intensity;
    hemi.diffuse = Color3.FromHexString(d.hemi.color);
    hemi.groundColor = Color3.FromHexString(d.hemi.ground);
    s.scene.fogDensity = d.fogDensity;
  }

  private restoreLight() {
    const s = this.stage;
    const hemi = s.scene.lights.find((l) => l.name === 'hemi') as HemisphericLight | undefined;
    if (!this.backup || !hemi) return;
    s.sun.intensity = this.backup.sun;
    s.sun.diffuse = this.backup.sunCol;
    hemi.intensity = this.backup.hemi;
    hemi.diffuse = this.backup.hemiCol;
    hemi.groundColor = this.backup.hemiGround;
    s.scene.fogDensity = this.backup.fog;
    s.scene.clearColor = new Color4(0.62, 0.83, 0.93, 1);
  }

  // ---------------------------------------------------------------- runtime

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    if (this.waterTex) {
      if (this.def.water?.kind === 'lava') {
        this.waterTex.uOffset = Math.sin(t * 0.05) * 0.4;
        this.waterTex.vOffset = t * 0.012;
      } else {
        this.waterTex.uOffset = t * 0.008;
        this.waterTex.vOffset = Math.sin(t * 0.2) * 0.02 + t * 0.005;
      }
    }
    if (this.water && this.def.water?.kind === 'water') this.water.position.y = this.w + Math.sin(t * 0.7) * 0.03;
    for (const b of this.birds) {
      const a = b.phase + t * b.speed;
      b.node.position.set(b.cx + Math.cos(a) * b.r, this.g + b.h + Math.sin(t * 0.6 + b.phase) * 1.2, b.cz + Math.sin(a) * b.r * 0.5);
      b.node.rotation.y = Math.atan2(-Math.sin(a) * b.speed, Math.cos(a) * b.speed * 0.5) + (b.speed > 0 ? 0 : Math.PI);
      const flap = Math.sin(t * 9 + b.phase * 3) * 0.6;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }
    for (const sp of this.spinners) {
      if (sp.node.name === 'beamPivot') sp.node.rotation.x = Math.sin(t * sp.speed) * 0.35;
      else sp.node.rotation.y += dt * sp.speed;
    }
    for (const b of this.bobbers) {
      if (b.node.name === 'fan') b.node.position.y = Math.max(0, Math.sin(t * 6 + b.phase)) * 0.06;
      else {
        b.node.position.y = b.y + Math.sin(t * 1.1 + b.phase) * (b.node.name === 'isle' ? 0.35 : 0.06);
        b.node.rotation.z = Math.sin(t * 0.8 + b.phase) * 0.03;
      }
    }
  }

  private own(m: StandardMaterial): StandardMaterial {
    this.mats.push(m);
    return m;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const e of this.emitters) e.dispose();
    this.emitters = [];
    this.waterTex?.dispose();
    this.root.dispose(false, false);
    this.restoreLight();
  }
}
