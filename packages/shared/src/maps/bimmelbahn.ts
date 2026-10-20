import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Map 3 – Bimmelbahn-Stadt (Komplex).
 * Rectangular town loop with a middle street and a north-south street crossing at the
 * market square. Trams run on a visible timetable after each round; tickets let players
 * ride between stations.
 */
const b = new MapBuilder();

const OUTER = 'BBHBRBIBLB' + 'BEHBRD' + 'BIBRBTBLBR' + 'HBSRBE';
const outer = b.seq('c', OUTER, (i) => {
  if (i < 10) return { x: -24 + 4.8 * i, z: -16 };
  if (i < 16) return { x: 24, z: -16 + (32 / 6) * (i - 10) };
  if (i < 26) return { x: 24 - 4.8 * (i - 16), z: 16 };
  return { x: -24, z: 16 - (32 / 6) * (i - 26) };
});
b.chain(outer, true);
b.get('c2').label = 'station.north';
b.get('c12').label = 'station.east';
b.get('c26').label = 'station.west';

// Middle street west -> east, crossing X at the market square.
const midW = b.seq('mw', 'BSR', (i) => ({ x: -18 + 6 * i, z: 0 }));
b.add('x', 'blue', 0, 0, { tags: ['track'] });
const midE = b.seq('me', 'IBL', (i) => ({ x: 6 + 6 * i, z: 0 }));
b.link('c29', midW[0]);
b.chain([...midW, 'x', ...midE]);
b.link(midE[2], 'c13');

// North-south street
const nsN = b.seq('nn', 'BR', (i) => ({ x: 0, z: -16 + (16 / 3) * (i + 1) }));
const nsS = b.seq('ns', 'DB', (i) => ({ x: 0, z: (16 / 3) * (i + 1) }));
b.link('c5', nsN[0]);
b.chain([...nsN, 'x', ...nsS]);
b.link(nsS[1], 'c21');

const ROUTES = [
  ['c3', 'c4', 'c5', 'c6', 'c7'],
  ['mw0', 'mw2', 'x', 'me0', 'me1'],
  ['c18', 'c19', 'c20', 'c22', 'c23'],
  ['nn0', 'nn1', 'x', 'ns0', 'ns1'],
];
for (const r of ROUTES) for (const id of r) {
  const f = b.get(id);
  f.tags = [...new Set([...(f.tags ?? []), 'track'])];
}

export const BIMMELBAHN: MapDef = {
  id: 'bimmelbahn',
  nameKey: 'map.bimmelbahn.name',
  descKey: 'map.bimmelbahn.desc',
  difficulty: 3,
  theme: 'city',
  start: 'c21',
  fields: b.build(),
  starSpots: ['c1', 'c8', 'c13', 'c24', 'c30', 'me1', 'ns1', 'c16'],
  gimmick: 'train',
  gimmickParams: {
    trainRoutes: ROUTES.map((fields) => ({ fields })),
  },
  palette: {
    sky: ['#a9c8f0', '#eef3fb'],
    ground: '#c9d6b0',
    ground2: '#d9d3c7',
    water: '#9ab7d6',
    accent: '#e87d7d',
    path: '#f4efe6',
    fog: '#dfe7f2',
  },
  decor: [
    { kind: 'house', x: -12, z: -8, r: 0 },
    { kind: 'house', x: 12, z: -8, r: 0.5 },
    { kind: 'house', x: -12, z: 8, r: 0.2 },
    { kind: 'house', x: 12, z: 8, r: -0.4 },
    { kind: 'tower', x: -6, z: -6 },
    { kind: 'fountain', x: 4, z: 4 },
    { kind: 'tree', x: -30, z: -20 },
    { kind: 'tree', x: 30, z: 20 },
    { kind: 'tree', x: 30, z: -20 },
    { kind: 'tree', x: -30, z: 20 },
  ],
  musicKey: 'city',
};
