import { MapBuilder, nearest, tagCrossings, type P } from './builder';
import type { MapDef } from './types';

/**
 * Map 2 – Vulkan-Gipfel (Mittel).
 * A volcanic island in a lava sea. The ring road circles the volcano in the middle; the
 * crater path spirals up its flank to the crater rim (the star likes it up there) and the
 * ash road takes the short way along the lava stream that pours from the crater down to
 * the lava sea. Both are closed by lava when the volcano erupts (red fields and quake
 * fields fill the counter). A paid cable car lifts players onto the rim; detours lead to
 * the old temple and the giant mushroom grove.
 */
const b = new MapBuilder();

/** The volcano: cone around the crater (terrain), crater prop on its plateau. */
const V = { x: 0, z: 5 };
const polar = (deg: number, r: number) => ({ x: V.x + Math.cos((deg * Math.PI) / 180) * r, z: V.z + Math.sin((deg * Math.PI) / 180) * r });

/** Lava stream from the crater down the south flank and west to the lava sea (terrain + bridge). */
export const VULKAN_LAVA: [number, number][] = [
  [0, 2],
  [-0.6, -3],
  [-2.6, -7.6],
  [-7, -10],
  [-13, -9.6],
  [-19.5, -10.4],
  [-25.6, -12.4],
  [-32, -15.6],
  [-44, -21],
];

// Ring road: 42 fields, counter-clockwise from the start in the south.
const RING = 'TBBRBIBEBCBLBRBDBBSBRBIBEBBLBRBDBBIBRBEBLB';
const ringCtrl: P[] = [
  { x: 0, z: -22 },
  { x: 11, z: -22 },
  { x: 21, z: -18 },
  { x: 28, z: -10 },
  { x: 31, z: 0 },
  { x: 29, z: 10 },
  { x: 22, z: 18 },
  { x: 11, z: 22 },
  { x: -1, z: 23 },
  { x: -13, z: 21 },
  { x: -23, z: 15 },
  { x: -29, z: 6 },
  { x: -30, z: -4 },
  { x: -25, z: -13 },
  { x: -13, z: -20 },
];
const ring = b.path('r', RING, ringCtrl, { closed: true });
const at = (x: number, z: number) => nearest(b, ring, x, z);

// Crater path (lava group 0): from the west foot it spirals up the flank, runs along the
// north rim of the crater and down the east flank. Placed field by field so every climb
// is spread evenly (about 1.2 m per step).
const west = b.get(at(-30, 3));
const east = b.get(at(31, 5));
const s1 = polar(190, 15.5);
const s7 = polar(-6, 16.1);
const craterPos = [
  { x: (west.x + s1.x) / 2, z: (west.z + s1.z) / 2 },
  s1,
  polar(170, 11.4),
  polar(134, 7.3),
  polar(90, 6.7),
  polar(46, 7.3),
  polar(10, 11.4),
  s7,
  { x: (east.x + s7.x) / 2, z: (east.z + s7.z) / 2 },
];
const crater = [...'BBRBLBEBB'].map((code, i) => b.add(`s${i}`, ({ B: 'blue', R: 'red', L: 'lucky', E: 'event' } as const)[code as 'B'], craterPos[i].x, craterPos[i].z, { tags: ['summit'] }));
b.chain(crater);
b.link(west.id, crater[0]);
b.link(crater[crater.length - 1], east.id);

// Ash road along the lava stream (lava group 1): short, but hot.
const ash = b.path(
  'a',
  'BRBIBL',
  [
    { x: -14.5, z: -14.3 },
    { x: -8, z: -14.2 },
    { x: -1.5, z: -13.6 },
    { x: 6, z: -14 },
    { x: 14, z: -12.6 },
  ],
  { from: at(-20, -17), to: at(25, -13), tags: ['ash'] },
);

// Temple detour in the south-east.
b.path('t', 'BIBL', [{ x: 21.5, z: -26 }, { x: 28.5, z: -27.5 }, { x: 34, z: -22 }], { from: at(16, -21), to: at(28, -10) });

// Giant mushroom grove in the north-east.
b.path('m', 'BLDB', [{ x: 36.5, z: 11 }, { x: 38, z: 18 }, { x: 33, z: 23.5 }], { from: at(29, 9), to: at(21, 18) });

tagCrossings(b, VULKAN_LAVA, 2.3);

export const VULKAN: MapDef = {
  id: 'vulkan',
  nameKey: 'map.vulkan.name',
  descKey: 'map.vulkan.desc',
  difficulty: 2,
  theme: 'volcano',
  start: 'r0',
  fields: b.build(),
  // the summit (s3–s5) makes up a quarter of the spots, so the star lands up there often
  starSpots: ['r4', 'r13', 'r21', 'r28', 'r39', 's3', 's4', 's5', 'a3', 't2', 'm1'],
  gimmick: 'eruption',
  gimmickParams: {
    cableCarTarget: crater[4],
    lavaGroups: [crater, ash],
  },
  palette: {
    sky: ['#f2b49b', '#fbe3d0'],
    ground: '#8d7f86',
    ground2: '#c99a83',
    water: '#ff7a3d',
    accent: '#ffb347',
    path: '#e9ddd6',
    fog: '#f3cdbd',
  },
  terrain: {
    base: 0.7,
    water: { high: -0.5, kind: 'lava' },
    land: [
      { x: 0, z: 0, rx: 35, rz: 27 },
      { x: 30, z: -20, rx: 11, rz: 11 },
      { x: 23, z: -24, rx: 9, rz: 6 },
      { x: 34, z: 14, rx: 10, rz: 13 },
      { x: 22, z: 20, rx: 10, rz: 8 },
      { x: -26, z: 12, rx: 10, rz: 9 },
    ],
    cuts: [{ x: -39, z: -23, rx: 8, rz: 7 }],
    volcano: { x: V.x, z: V.z, r: 16, h: 3.0, top: 5.2 },
    hills: [
      { x: -22, z: 0, r: 5, h: 0.8 },
      { x: 22, z: 2, r: 5, h: 0.6 },
    ],
    channels: [{ points: VULKAN_LAVA, width: 3.2, kind: 'lava' }],
    colors: { grass: '#a08a7e', grass2: '#bb9c84', sand: '#4a3f46', rock: '#7d6c70', path: '#ecdccc', seabed: '#3a1a10' },
    scatter: [
      { kind: 'lavarock', on: 'rock', density: 2.8, scale: [0.6, 1.3] },
      { kind: 'lavarock', on: 'sand', density: 1.6, scale: [0.5, 1.1] },
      { kind: 'rocksmall', on: 'grass', density: 3.2, scale: [0.7, 1.4] },
      { kind: 'ashplant', on: 'grass', density: 5.72, scale: [0.8, 1.3] },
      { kind: 'cactus', on: 'grass', density: 1, scale: [0.8, 1.3] },
      { kind: 'deadtree', on: 'grass', density: 0.56, scale: [0.8, 1.2] },
      { kind: 'crystal', on: 'rock', density: 0.3, scale: [0.6, 1.1] },
      { kind: 'vent', on: 'grass', density: 0.18, scale: [0.8, 1.1] },
    ],
  },
  decor: [
    // crater cap on the plateau: only its top (rim + lava lake) rises out of the cone, its
    // glowing gullies face south where the lava stream leaves the crater
    { kind: 'volcano', x: V.x, z: V.z, s: 1, dy: -7.7, r: -2.36 },
    { kind: 'cablecar', x: 0, z: 0 },
    { kind: 'temple', x: 27, z: -21.5, s: 0.8, r: 2.6 },
    { kind: 'mushroom', x: 32, z: 14, s: 1.3 },
    { kind: 'mushroom', x: 29.5, z: 17.5, s: 1 },
    { kind: 'mushroom', x: 33.5, z: 18, s: 0.8, r: 1 },
    { kind: 'obsidian', x: -19, z: -3 },
    { kind: 'obsidian', x: -17, z: 13, r: 1.2 },
    { kind: 'bones', x: 2, z: -18, r: 0.6 },
    { kind: 'minecart', x: 9, z: -18, r: 1.4 },
    // steam vents on the flank
    ...[polar(225, 10.5), polar(-48, 11), polar(118, 12.5)].map((p) => ({ kind: 'vent', x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 })),
  ],
  musicKey: 'volcano',
};
