import { MapBuilder, nearest, tagCrossings, type P } from './builder';
import type { DecorDef, MapDef } from './types';

/**
 * Map 3 – Bimmelbahn-Stadt (Komplex).
 * A ring road around the old town with three stations, two cross streets meeting at the
 * market square, a detour through the park and one over the canal bridges to the
 * harbour. The trams run on a visible timetable after each round; tickets let players
 * ride between stations.
 */
const b = new MapBuilder();

/** Canal south of the town (terrain + bridges). */
export const BIMMEL_CANAL: [number, number][] = [
  [-60, -27],
  [-30, -28.5],
  [-10, -26.5],
  [10, -27.5],
  [30, -26.5],
  [60, -28],
];

// Ring road: 40 fields, counter-clockwise from the start in the south.
const RING = 'TBRBIBLBEBBBRBDBIBBBLBRBEBBBIBRBDBBLBRBE';
const ringCtrl: P[] = [
  { x: 0, z: -20 },
  { x: 14, z: -20 },
  { x: 25, z: -18 },
  { x: 28, z: -8 },
  { x: 28, z: 8 },
  { x: 25, z: 18 },
  { x: 14, z: 20 },
  { x: 0, z: 20 },
  { x: -14, z: 20 },
  { x: -25, z: 18 },
  { x: -28, z: 8 },
  { x: -28, z: -8 },
  { x: -25, z: -18 },
  { x: -14, z: -20 },
];
const ring = b.path('c', RING, ringCtrl, { closed: true });
const at = (x: number, z: number) => nearest(b, ring, x, z);
const setType = (id: string, type: 'station' | 'shop', label?: string) => {
  const f = b.get(id);
  f.type = type;
  if (label) f.label = label;
};
setType(at(28, 0), 'station', 'station.east');
setType(at(0, 20), 'station', 'station.north');
setType(at(-28, 0), 'station', 'station.west');
setType(at(14, 20), 'shop');
setType(at(-14, -20), 'shop');

// Market street west -> east and the north-south street, crossing at the market square.
b.add('x', 'blue', 0, 0);
const midW = b.path('mw', 'BLR', [{ x: -20, z: -1 }, { x: -10, z: 0 }], { from: at(-28, -4), to: 'x' });
const midE = b.path('me', 'IBL', [{ x: 10, z: 0 }, { x: 20, z: -1 }], { from: 'x', to: at(28, 4) });
const nsS = b.path('ns', 'DB', [{ x: 1, z: -13 }, { x: 0, z: -7 }], { from: at(6, -20), to: 'x' });
const nsN = b.path('nn', 'BR', [{ x: 0, z: 7 }, { x: -1, z: 13 }], { from: 'x', to: at(-5, 20) });

// Park detour in the north-west (around the pond).
b.path('p', 'BLIB', [{ x: -11, z: 13 }, { x: -17, z: 9 }, { x: -22, z: 5 }], { from: at(-9, 20), to: at(-28, 4) });

// Harbour detour over the canal bridges.
const harbour = b.path(
  'h',
  'BBLIBB',
  [
    { x: -21, z: -25 },
    { x: -19, z: -32 },
    { x: -11, z: -34 },
    { x: -4, z: -31 },
    { x: -3, z: -25 },
  ],
  { from: at(-24, -18), to: at(-3, -20) },
);
tagCrossings(b, BIMMEL_CANAL, 2.4, 1.1);
for (const id of harbour) if (!b.get(id).tags?.includes('bridge')) b.get(id).tags = ['harbour'];

// Tram routes: five fields each, the timetable cycles through them.
const around = (id: string, k = 2) => {
  const i = ring.indexOf(id);
  return Array.from({ length: 2 * k + 1 }, (_, d) => ring[(i - k + d + ring.length) % ring.length]);
};
const ROUTES = [around(at(28, -2)), [midW[1], midW[2], 'x', midE[0], midE[1]], around(at(2, 20)), [nsS[0], nsS[1], 'x', nsN[0], nsN[1]]];
for (const r of ROUTES) for (const id of r) b.get(id).tags = [...new Set([...(b.get(id).tags ?? []), 'track'])];

// Houses line the streets of the old town blocks, facing the nearest street.
const ROOFS = ['#e8767a', '#6f9de6', '#f4a259', '#6cc69a', '#a78bdb', '#e8767a'];
const houses: DecorDef[] = [];
const kinds = ['house', 'house2', 'house3', 'house2'];
let n = 0;
const facing = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const block = (x0: number, x1: number, z0: number, z1: number) => {
  for (let x = x0; x <= x1; x += 6.5) {
    houses.push({ kind: kinds[n % 4], x, z: z1, r: facing(0, 1), s: 0.8, tint: ROOFS[n++ % ROOFS.length] });
    houses.push({ kind: kinds[n % 4], x, z: z0, r: facing(0, -1), s: 0.8, tint: ROOFS[n++ % ROOFS.length] });
  }
};
block(6, 21, -15, -6); // south-east
block(6, 21, 6, 15); // north-east
block(-21, -8, -15, -6); // south-west
// outside the ring
for (let x = -30; x <= 30; x += 7.5) {
  houses.push({ kind: kinds[n % 4], x, z: 27, r: facing(0, -1), s: 0.8, tint: ROOFS[n++ % ROOFS.length] });
}
for (const side of [-1, 1]) {
  for (let z = -14; z <= 14; z += 7) {
    if (Math.abs(z) < 5) continue; // stations sit there
    houses.push({ kind: kinds[n % 4], x: side * 35, z, r: facing(-side, 0), s: 0.8, tint: ROOFS[n++ % ROOFS.length] });
  }
}

export const BIMMELBAHN: MapDef = {
  id: 'bimmelbahn',
  nameKey: 'map.bimmelbahn.name',
  descKey: 'map.bimmelbahn.desc',
  difficulty: 3,
  theme: 'city',
  start: 'c0',
  fields: b.build(),
  starSpots: ['c3', 'c9', 'c16', 'c23', 'c29', 'c36', 'me1', 'nn1', 'p2', 'h2'],
  gimmick: 'train',
  gimmickParams: {
    trainRoutes: ROUTES.map((fields) => ({ fields })),
  },
  palette: {
    sky: ['#a9c8f0', '#eef3fb'],
    ground: '#c9d6b0',
    ground2: '#d9d3c7',
    water: '#7fa9d1',
    accent: '#e87d7d',
    path: '#f4efe6',
    fog: '#dfe7f2',
  },
  terrain: {
    base: 0.6,
    water: { high: -0.1, kind: 'sea' },
    land: [{ x: 0, z: 0, rx: 62, rz: 48 }],
    hills: [
      { x: -40, z: 30, r: 10, h: 2.5 },
      { x: 42, z: 28, r: 9, h: 2 },
      { x: -15, z: 8, r: 4, h: -1.4 },
    ],
    channels: [{ points: BIMMEL_CANAL, width: 3.6, kind: 'water' }],
    colors: { grass: '#a5cc86', grass2: '#c2dc98', sand: '#d6cfc2', rock: '#b4aea8', path: '#e3d8c8', seabed: '#5d86ad' },
    scatter: [
      { kind: 'treeround', on: 'grass', density: 0.77, scale: [0.85, 1.25] },
      { kind: 'tree', on: 'grass', density: 0.3, scale: [0.8, 1.2] },
      { kind: 'bushround', on: 'grass', density: 3.64, scale: [0.8, 1.3] },
      { kind: 'flowers', on: 'grass', density: 3.64, scale: [0.8, 1.2] },
      { kind: 'grass', on: 'grass', density: 18, scale: [0.8, 1.4] },
    ],
  },
  decor: [
    { kind: 'tower', x: -5, z: -5 },
    { kind: 'fountain', x: 5, z: 5 },
    { kind: 'marketstall', x: 5, z: -5, r: 0.8, tint: '#e87d7d' },
    { kind: 'marketstall', x: -6, z: 5, r: -2.2, tint: '#6f9de6' },
    { kind: 'kiosk', x: 35, z: -21, r: -1.6 },
    { kind: 'boat', x: 18, z: -27.5, r: 1.6 },
    { kind: 'boat', x: -34, z: -28, r: 1.5 },
    { kind: 'bench', x: -13, z: 4, r: 2.2 },
    { kind: 'bench', x: -20, z: 13, r: 0.6 },
    { kind: 'streetlamp', x: -3, z: 3 },
    { kind: 'streetlamp', x: 3, z: -3 },
    { kind: 'streetlamp', x: 31, z: 10 },
    { kind: 'streetlamp', x: -31, z: -10 },
    { kind: 'hedge', x: -24, z: 12, r: 0.5 },
    { kind: 'mailbox', x: 3, z: 9 },
    ...houses,
  ],
  musicKey: 'city',
};
