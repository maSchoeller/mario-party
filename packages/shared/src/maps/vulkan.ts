import { MapBuilder, nearest, tagCrossings, type P } from './builder';
import type { MapDef } from './types';

/**
 * Map 2 – Vulkan-Gipfel (Mittel).
 * A volcanic island in a lava sea. The ring road circles the volcano; the crater path
 * climbs over the rim (the star likes it up there) and the ash road takes the short way
 * along the lava stream. Both are closed by lava when the volcano erupts (red fields and
 * quake fields fill the counter). A paid cable car lifts players onto the rim; detours
 * lead to the old temple and the giant mushroom grove.
 */
const b = new MapBuilder();

/** Lava stream from the crater to the south-west lava sea (terrain + bridge). */
export const VULKAN_LAVA: [number, number][] = [
  [2, 9],
  [-4, 4],
  [-10, -1],
  [-17, -6],
  [-25, -11],
  [-33, -16],
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

// Crater path over the rim (lava group 0).
const crater = b.path(
  's',
  'BBRBLBEBB',
  [
    { x: -19, z: 9, y: 1.5 },
    { x: -12, z: 12, y: 3.2 },
    { x: -5, z: 13, y: 4.6 },
    { x: 2, z: 14, y: 5.2 },
    { x: 9, z: 13, y: 4.6 },
    { x: 15, z: 10, y: 3 },
  ],
  { from: at(-26, 11), to: at(25, 14), tags: ['summit'] },
);

// Ash road along the lava stream (lava group 1): short, but hot.
const ash = b.path('a', 'BRBIBL', [{ x: -14, z: -14 }, { x: -6, z: -9 }, { x: 2, z: -6 }, { x: 10, z: -7 }, { x: 17, z: -11 }], { from: at(-22, -16), to: at(27, -11), tags: ['ash'] });

// Temple detour in the south-east.
b.path('t', 'BIBL', [{ x: 24, z: -27 }, { x: 33, z: -22 }], { from: at(15, -21), to: at(29, -6) });

// Giant mushroom grove in the north-east.
b.path('m', 'BLDB', [{ x: 37, z: 7 }, { x: 34, z: 18 }], { from: at(31, -1), to: at(17, 21) });

tagCrossings(b, VULKAN_LAVA, 2.3, 1.3);

export const VULKAN: MapDef = {
  id: 'vulkan',
  nameKey: 'map.vulkan.name',
  descKey: 'map.vulkan.desc',
  difficulty: 2,
  theme: 'volcano',
  start: 'r0',
  fields: b.build(),
  // the rim is listed twice as often so the star lands up there more often
  starSpots: ['r4', 'r13', 'r21', 'r28', 'r35', 's3', 's4', 's5', 'a3', 't2', 'm1'],
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
      { x: 0, z: 0, rx: 34, rz: 26 },
      { x: 30, z: -18, rx: 10, rz: 10 },
      { x: 33, z: 12, rx: 9, rz: 10 },
      { x: -26, z: 12, rx: 10, rz: 9 },
    ],
    cuts: [{ x: -38, z: -22, rx: 8, rz: 7 }],
    hills: [
      { x: 1, z: 15, r: 11, h: 5.2, rz: 7 },
      { x: 2, z: 24, r: 9, h: 3 },
      { x: -22, z: 0, r: 5, h: 0.8 },
      { x: 20, z: 2, r: 6, h: 0.7 },
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
    { kind: 'volcano', x: 2, z: 27, s: 1.25 },
    { kind: 'cablecar', x: 0, z: 0 },
    { kind: 'temple', x: 31, z: -29, r: 2.6 },
    { kind: 'mushroom', x: 39, z: 13, s: 1.3 },
    { kind: 'mushroom', x: 36, z: 22, s: 1 },
    { kind: 'mushroom', x: 41, z: 4, s: 0.8, r: 1 },
    { kind: 'obsidian', x: -34, z: 2 },
    { kind: 'obsidian', x: -30, z: 16, r: 1.2 },
    { kind: 'bones', x: -8, z: -14, r: 0.6 },
    { kind: 'minecart', x: 10, z: -27, r: 1.4 },
    { kind: 'vent', x: -5, z: 6 },
    { kind: 'vent', x: 12, z: 6 },
  ],
  musicKey: 'volcano',
};
