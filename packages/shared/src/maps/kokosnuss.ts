import { MapBuilder, lerp } from './builder';
import type { MapDef } from './types';

/**
 * Map 1 – Kokosnuss-Küste (Einsteiger).
 * Main loop around the island; two sandbank shortcuts across bays that only exist at
 * low tide (gimmick "tides"); a jetty detour with the crab merchant nearby.
 */
const b = new MapBuilder();

// Main loop: 40 fields on an ellipse with two bays (indentations) for the sandbanks.
const MAIN = 'TBBRBEBIBBLBRBBDBESBBRBBIBLBRBEBBBDBRBIB';
const bay = (theta: number, center: number, width: number) => {
  const d = Math.atan2(Math.sin(theta - center), Math.cos(theta - center));
  return Math.abs(d) < width ? Math.cos((d / width) * (Math.PI / 2)) ** 2 : 0;
};
const main = b.seq('k', MAIN, (i, n) => {
  const theta = Math.PI / 2 + (i / n) * Math.PI * 2; // start at the bottom (z>0 is front)
  const indent = 0.32 * bay(theta, Math.PI / 2 + (12 / n) * Math.PI * 2, 0.62) + 0.3 * bay(theta, Math.PI / 2 + (32 / n) * Math.PI * 2, 0.62);
  const r = 1 - indent;
  return { x: Math.cos(theta) * 27 * r, z: Math.sin(theta) * 19 * r };
});
b.chain(main, true);

// Sandbank A: k8 -> 4 fields -> k16 (straight across the bay; 5 steps instead of 8)
const sa = (i: number) => lerp(b.get('k8'), b.get('k16'), (i + 1) / 5);
const sandA = b.seq('sa', 'BLBI', (i) => sa(i), { tags: ['sandbank'] });
b.link('k8', sandA[0]);
b.chain(sandA);
b.link(sandA[3], 'k16');

// Sandbank B: k28 -> 4 fields -> k36
const sbp = (i: number) => lerp(b.get('k28'), b.get('k36'), (i + 1) / 5);
const sandB = b.seq('sb', 'BDBL', (i) => sbp(i), { tags: ['sandbank'] });
b.link('k28', sandB[0]);
b.chain(sandB);
b.link(sandB[3], 'k36');

// Jetty detour (always open): k20 -> pier (4 fields, outward) -> k23
const k20 = b.get('k20');
const k23 = b.get('k23');
const jetty = b.seq('j', 'BIEB', (i) => {
  const t = (i + 1) / 5;
  const p = lerp(k20, k23, t);
  const out = Math.sin(t * Math.PI) * 7;
  const len = Math.hypot(p.x, p.z) || 1;
  return { x: p.x + (p.x / len) * out, z: p.z + (p.z / len) * out };
}, { tags: ['jetty'] });
b.link('k20', jetty[0]);
b.chain(jetty);
b.link(jetty[3], 'k23');

export const KOKOSNUSS: MapDef = {
  id: 'kokosnuss',
  nameKey: 'map.kokosnuss.name',
  descKey: 'map.kokosnuss.desc',
  difficulty: 1,
  theme: 'island',
  start: 'k0',
  fields: b.build(),
  starSpots: ['k4', 'k11', 'k14', 'k23', 'k31', 'k37', 'j0'],
  gimmick: 'tides',
  palette: {
    sky: ['#9fd3ec', '#e8f4fa'],
    ground: '#b9d7a1',
    ground2: '#efe2c0',
    water: '#86c8e0',
    accent: '#f4a259',
    path: '#efe6d2',
    fog: '#cfe8f2',
  },
  decor: [
    { kind: 'palm', x: -20, z: -8 },
    { kind: 'palm', x: 18, z: -11 },
    { kind: 'palm', x: 6, z: 12 },
    { kind: 'palm', x: -8, z: 9 },
    { kind: 'palm', x: 24, z: 6 },
    { kind: 'palm', x: -26, z: 4 },
    { kind: 'hut', x: -4, z: -3, r: 0.4 },
    { kind: 'hut', x: 5, z: -5, r: -0.3 },
    { kind: 'cannon', x: 0, z: 3 },
    { kind: 'crab', x: 22, z: 2 },
    { kind: 'rock', x: -14, z: -2 },
    { kind: 'rock', x: 12, z: 4 },
  ],
  musicKey: 'island',
};
