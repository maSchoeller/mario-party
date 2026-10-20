import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Map 2 – Vulkan-Gipfel (Mittel).
 * Ring around the volcano, a summit path (star often up there), an outer detour along a
 * lava river and a paid cable car to the summit. Red fields fill the eruption counter.
 */
const b = new MapBuilder();

const RING = 'TBBRBIRBEBLBSBRDBBRBRBBEBRLBCBIRBDBR';
const ring = b.seq('r', RING, (i, n) => {
  const theta = Math.PI / 2 + (i / n) * Math.PI * 2;
  return { x: Math.cos(theta) * 25, z: Math.sin(theta) * 19 };
});
b.chain(ring, true);

// Summit path r6 -> s0..s8 -> r16 (quadratic curve over the crater rim)
const r6 = b.get('r6');
const r16 = b.get('r16');
const summit = b.seq('s', 'BBRBBBEBL', (i) => {
  const t = (i + 1) / 10;
  const c = { x: 0, z: -2 };
  const x = (1 - t) ** 2 * r6.x + 2 * (1 - t) * t * c.x + t ** 2 * r16.x;
  const z = (1 - t) ** 2 * r6.z + 2 * (1 - t) * t * c.z + t ** 2 * r16.z;
  return { x, z, y: Math.sin(t * Math.PI) * 5 };
}, { tags: ['summit'] });
b.link('r6', summit[0]);
b.chain(summit);
b.link(summit[8], 'r16');

// Outer detour r19 -> o0..o4 -> r25 along the lava river
const r19 = b.get('r19');
const r25 = b.get('r25');
const outer = b.seq('o', 'BIBLB', (i) => {
  const t = (i + 1) / 6;
  const a1 = Math.atan2(r19.z / 19, r19.x / 25);
  let a2 = Math.atan2(r25.z / 19, r25.x / 25);
  if (a2 < a1) a2 += Math.PI * 2;
  const a = a1 + (a2 - a1) * t;
  const bulge = 1.28 + Math.sin(t * Math.PI) * 0.08;
  return { x: Math.cos(a) * 25 * bulge, z: Math.sin(a) * 19 * bulge };
}, { tags: ['riverside'] });
b.link('r19', outer[0]);
b.chain(outer);
b.link(outer[4], 'r25');

for (const id of ['r20', 'r21', 'r22', 'r23', 'r24']) b.get(id).tags = ['lavaflow'];

export const VULKAN: MapDef = {
  id: 'vulkan',
  nameKey: 'map.vulkan.name',
  descKey: 'map.vulkan.desc',
  difficulty: 2,
  theme: 'volcano',
  start: 'r0',
  fields: b.build(),
  // Summit spots are listed so that the star lands up there more often.
  starSpots: ['r2', 'r9', 'r17', 'r27', 'r33', 's3', 's4', 's5', 'o2'],
  gimmick: 'eruption',
  gimmickParams: {
    cableCarTarget: 's4',
    lavaGroups: [
      ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
      ['r20', 'r21', 'r22', 'r23', 'r24'],
    ],
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
  decor: [
    { kind: 'volcano', x: 0, z: -2, s: 1 },
    { kind: 'obsidian', x: -18, z: 8 },
    { kind: 'obsidian', x: 16, z: -12 },
    { kind: 'obsidian', x: 30, z: 4 },
    { kind: 'cablecar', x: 0, z: 0 },
    { kind: 'rock', x: -10, z: 12 },
    { kind: 'rock', x: 12, z: 13 },
    { kind: 'deadtree', x: -22, z: -10 },
  ],
  musicKey: 'volcano',
};
