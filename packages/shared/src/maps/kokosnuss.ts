import { MapBuilder, nearest, tagCrossings, type P } from './builder';
import type { MapDef } from './types';

/**
 * Map 1 – Kokosnuss-Küste (Einsteiger).
 * A coastal loop around a tropical island with a river running from the waterfall hill
 * to the east bay. The tide decides the shortcuts: at low tide the sandbank across the
 * west bay and the ford through the river are open; at high tide the river is full and
 * whoever wants to cross must take the bridge in the east or climb past the waterfall.
 * Detours: the boat jetty in the south and the lighthouse cliff in the north-east.
 */
const b = new MapBuilder();

/** River from the waterfall (north) to the east bay – also used for the terrain. */
export const KOKOS_RIVER: [number, number][] = [
  [-4, 18],
  [-1, 12],
  [3, 7],
  [8, 2.5],
  [14, -2],
  [21, -6],
  [28, -9],
  [36, -11],
  [46, -13],
];

// Main loop: 44 fields, counter-clockwise from the start beach in the south.
const MAIN = 'TBBRBIBSBLBBEBRBDBBIBRBBLBSBBRBEBIBBRBLBDBEB';
const mainCtrl: P[] = [
  { x: 0, z: -23 },
  { x: 10, z: -24 },
  { x: 19, z: -21 },
  { x: 26, z: -15 },
  { x: 31, z: -7 },
  { x: 34, z: 1 },
  { x: 33, z: 9 },
  { x: 27, z: 17 },
  { x: 18, z: 22 },
  { x: 8, z: 25 },
  { x: -2, z: 26 },
  { x: -12, z: 25 },
  { x: -21, z: 21 },
  { x: -28, z: 14 },
  { x: -29, z: 7 },
  { x: -24, z: 2 },
  { x: -23, z: -4 },
  { x: -27, z: -10 },
  { x: -29, z: -16 },
  { x: -21, z: -21 },
  { x: -11, z: -23 },
];
const main = b.path('k', MAIN, mainCtrl, { closed: true });
const at = (x: number, z: number) => nearest(b, main, x, z);

// Sandbank across the west bay (low tide only): 4 fields instead of the long way round.
const w1 = at(-29, 9);
const w2 = at(-28, -13);
b.path('sa', 'BLBI', [{ x: -34, z: 4, y: -0.3 }, { x: -34.5, z: -7, y: -0.3 }], { from: w1, to: w2, tags: ['sandbank'] });

// Boat jetty in the south (always open).
b.path('j', 'BIEBL', [{ x: 7, z: -31, y: 0.7 }, { x: 14, z: -33, y: 0.7 }, { x: 20, z: -29, y: 0.7 }], { from: at(4, -24), to: at(20, -20), tags: ['pier'] });

// Lighthouse cliff in the north-east.
b.path('l', 'BLDB', [{ x: 39, z: 15, y: 2.2 }, { x: 37, z: 23, y: 2.6 }, { x: 30, z: 26, y: 1.6 }], { from: at(33, 8), to: at(19, 22), tags: ['cliff'] });

// Jungle path from the south-west to the junction in the middle of the island.
const jungle = b.path('d', 'BRL', [{ x: -16, z: -14 }, { x: -11, z: -7 }], { from: at(-24, -19) });
b.add('jx', 'event', -5.5, 0.5);
b.link(jungle[2], 'jx');

// a) Ford through the river (low tide only) and on to the east coast.
const ford = b.path('f', 'BBIBBRBL', [{ x: 1, z: 2 }, { x: 5.4, z: 4.2 }, { x: 8.6, z: 5.6 }, { x: 13, z: 7 }, { x: 19, z: 8 }, { x: 25, z: 7 }], { from: 'jx', to: at(34, 3) });
// b) Up the waterfall hill and to the north village.
b.path('h', 'BLBE', [{ x: -9, z: 6 }, { x: -11, z: 12 }, { x: -9, z: 18 }], { from: 'jx', to: at(-11, 25), tags: ['hill'] });

// Fields standing in the river become ford stones (flooded at high tide); fields of the
// main loop over the river are bridge fields.
tagCrossings(b, KOKOS_RIVER, 2.6, 1.1, ford);
for (const f of b.fields.values()) {
  if (f.tags?.includes('sandbank')) f.y = -0.3;
  if (f.tags?.includes('pier')) f.y = 0.7;
}

export const KOKOSNUSS: MapDef = {
  id: 'kokosnuss',
  nameKey: 'map.kokosnuss.name',
  descKey: 'map.kokosnuss.desc',
  difficulty: 1,
  theme: 'island',
  start: 'k0',
  fields: b.build(),
  starSpots: ['k5', 'k12', 'k19', 'k24', 'k30', 'k37', 'j2', 'l2', 'f5', 'h1'],
  gimmick: 'tides',
  palette: {
    sky: ['#8fcbea', '#e8f4fa'],
    ground: '#9fcf85',
    ground2: '#efe2c0',
    water: '#5fbfd8',
    accent: '#f4a259',
    path: '#efe6d2',
    fog: '#cfe8f2',
  },
  terrain: {
    base: 0.6,
    water: { high: 0.05, low: -0.75, kind: 'sea' },
    land: [
      { x: 2, z: 1, rx: 33, rz: 25 },
      { x: 30, z: 18, rx: 11, rz: 9 },
      { x: -22, z: 16, rx: 12, rz: 10 },
      { x: 0, z: -18, rx: 22, rz: 9 },
      { x: -22, z: -14, rx: 10, rz: 8 },
    ],
    cuts: [{ x: -36, z: -2, rx: 9, rz: 10 }],
    hills: [
      { x: -5, z: 20, r: 7, h: 4.6 },
      { x: -13, z: 16, r: 6, h: 2.2 },
      { x: 37, z: 21, r: 6, h: 2.8 },
      { x: 12, z: 15, r: 7, h: 0.8 },
      { x: -14, z: -2, r: 6, h: 0.6 },
    ],
    channels: [{ points: KOKOS_RIVER, width: 3, kind: 'water' }],
    colors: { grass: '#8fc979', grass2: '#b5d98a', sand: '#f1e2b8', rock: '#a9a3a0', path: '#e6d3a8', seabed: '#3f9fbf' },
    scatter: [
      { kind: 'palm', on: 'sand', density: 0.5, scale: [0.9, 1.25] },
      { kind: 'palm2', on: 'grass', density: 0.35, scale: [0.9, 1.2] },
      { kind: 'bush', on: 'grass', density: 2.2, scale: [0.8, 1.4] },
      { kind: 'fern', on: 'grass', density: 2.5, scale: [0.8, 1.3] },
      { kind: 'flowers', on: 'grass', density: 1.6, scale: [0.8, 1.2] },
      { kind: 'grass', on: 'grass', density: 9, scale: [0.8, 1.5] },
      { kind: 'shell', on: 'sand', density: 1.5, scale: [0.8, 1.3] },
      { kind: 'rocksmall', on: 'sand', density: 0.6, scale: [0.7, 1.4] },
      { kind: 'rocksmall', on: 'rock', density: 2, scale: [0.8, 1.8] },
    ],
  },
  decor: [
    { kind: 'lighthouse', x: 41, z: 22, r: -0.6 },
    { kind: 'cliff', x: -2, z: 24.5, s: 0.9, r: 0.2 },
    { kind: 'waterfall', x: -4, z: 18 },
    { kind: 'cannon', x: -9, z: 0, r: 0.7 },
    { kind: 'crab', x: 22, z: -24, r: 0.3 },
    { kind: 'boat', x: 3, z: -33, r: 1.1 },
    { kind: 'boat', x: 24, z: -33, r: -0.4 },
    { kind: 'stilthut', x: 6, z: 31, r: 3.1, tint: '#e8767a' },
    { kind: 'stilthut', x: -16, z: 30, r: 2.9, tint: '#6f9de6' },
    { kind: 'hut', x: 14, z: 30, r: 3.3, tint: '#f4a259' },
    { kind: 'ruin', x: -15, z: -9, r: 0.4 },
    { kind: 'ruin', x: 6, z: -8, r: 2.1 },
    { kind: 'torch', x: -3, z: -2 },
    { kind: 'torch', x: -8, z: 3 },
    { kind: 'driftwood', x: -38, z: 10, r: 0.6 },
    { kind: 'driftwood', x: 12, z: -30, r: 2.2 },
    { kind: 'palm', x: -6, z: -28, s: 1.2 },
    { kind: 'palm2', x: 27, z: -20, s: 1.1, r: 2 },
    { kind: 'palm', x: 37, z: 3, s: 1.2 },
  ],
  musicKey: 'island',
};
