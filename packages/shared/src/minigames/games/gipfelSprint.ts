import { PLAYER_COLOR_HEX } from '../../config';
import type { MgEntity, MinigameDef } from '../types';
import { ageFx, emitFx, ranksFromScores, rowSpawn, viewFx, type FxState } from '../util';

/** #3 Gipfel-Sprint (FFA, Mashen): tap as fast as possible to run up the volcano. */
const GOAL = 220; // taps to the top (~30 s for an average masher, MINI-03)
const DURATION = 40;

interface P {
  progress: number;
  finishedAt: number | null;
  tapAcc: number;
  speedVis: number;
}

export interface GipfelSprintState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  ps: P[];
  n: number;
  /** player colors (view only) */
  colors: string[];
}

// the mountain: a tapered basalt cone with a lava crater, its front slope follows the run
const MTN_Z = 14;
const MTN_H = 15;
const MTN_W = 40;
const MTN_D = 28;
const MTN_TAPER = 0.1;
const RAMP_SEGS = 5;
const RUNGS = 12;
/** dust puff every … taps, a milestone every … taps (25 / 50 / 75 %) */
const DUST_EVERY = 11;
const MILESTONE = GOAL / 4;

/** World position of a runner at progress f (0..1) on lane i. */
function runnerPos(n: number, i: number, f: number): { x: number; y: number; z: number } {
  const x = rowSpawn(n, 3, i);
  return { x: x * (1 - f * 0.7), y: f * 14.5, z: f * 12 };
}

/** Height of the mountain surface at (x, z) (for dressing on the flanks). */
function mountainY(x: number, z: number): number {
  const r = Math.hypot(x / (MTN_W / 2), (z - MTN_Z) / (MTN_D / 2));
  return Math.max(0, Math.min(MTN_H, (MTN_H * (1 - r)) / (1 - MTN_TAPER)));
}

export const gipfelSprint: MinigameDef<GipfelSprintState> = {
  id: 'gipfelSprint',
  format: 'ffa',
  control: 'tap',
  theme: 'volcano',
  duration: DURATION,
  setup(players, _rng, opts) {
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      n: players.length,
      ps: players.map(() => ({ progress: 0, finishedAt: null, tapAcc: 0, speedVis: 0 })),
      colors: players.map((p) => PLAYER_COLOR_HEX[p.color]),
      fx: [],
      fxN: 0,
    };
  },
  layout: () => ({ kind: 'mash', labelKey: 'ctrl.tapFast' }),
  input(s, i, input) {
    if (input.type !== 'tap') return;
    const p = s.ps[i];
    if (p.finishedAt !== null) return;
    p.progress = Math.min(GOAL, p.progress + 1);
    p.speedVis = Math.min(1, p.speedVis + 0.18);
    if (p.progress >= GOAL) p.finishedAt = s.t;
    const at = runnerPos(s.n, i, p.progress / GOAL);
    if (p.progress >= GOAL) {
      // reached the crater: confetti for everyone, the first one makes the volcano rumble
      emitFx(s, { kind: 'confetti', sfx: 'cheer', x: at.x, y: at.y + 1.8, z: at.z, color: s.colors[i] }, 0.6);
      if (s.ps.filter((o) => o.finishedAt !== null).length === 1) emitFx(s, { kind: 'embers', sfx: 'boom', x: 0, y: MTN_H + 0.4, z: MTN_Z, s: 2.4 }, 0.6);
    } else if (p.progress % MILESTONE === 0) emitFx(s, { kind: 'sparkle', sfx: 'ding', x: at.x, y: at.y + 1.6, z: at.z, color: s.colors[i] });
    else if (p.progress % DUST_EVERY === 0) emitFx(s, { kind: 'dust', x: at.x, y: at.y + 0.05, z: at.z, s: 0.45 });
    if (s.practice && p.progress >= GOAL) {
      p.progress = 0;
      p.finishedAt = null;
    }
  },
  tick(s, dt) {
    s.t += dt;
    for (const p of s.ps) p.speedVis = Math.max(0, p.speedVis - dt * 1.5);
    ageFx(s, dt);
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || s.ps.every((p) => p.finishedAt !== null)),
  result(s) {
    // finished players by time, others by progress
    return ranksFromScores(s.ps.map((p) => (p.finishedAt !== null ? 1000 - p.finishedAt : p.progress)));
  },
  bot(s, i, level, rng, dt) {
    const rate = { easy: 5.2, medium: 6.8, hard: 8.2 }[level] * (0.85 + rng.next() * 0.3);
    const p = s.ps[i];
    p.tapAcc += rate * dt;
    const out: { type: 'tap' }[] = [];
    while (p.tapAcc >= 1) {
      p.tapAcc -= 1;
      out.push({ type: 'tap' });
    }
    return out;
  },
  view(s) {
    const entities: MgEntity[] = [
      // basalt foothills rising out of the lava sea, the mountain with a glowing crater on top
      { id: 'foot', kind: 'cylinder', x: 0, y: -0.65, z: 11, sx: 50, sy: 1.3, sz: 40, color: '#5a4f58', mat: 'basalt', taper: 0.88 },
      { id: 'mountain', kind: 'cylinder', x: 0, y: MTN_H / 2, z: MTN_Z, sx: MTN_W, sy: MTN_H, sz: MTN_D, color: '#857680', mat: 'basalt', taper: MTN_TAPER },
      { id: 'lava', kind: 'cylinder', x: 0, y: MTN_H + 0.02, z: MTN_Z, sx: 3.2, sy: 0.2, sz: 2.2, color: '#ff7a3d', mat: 'lava' },
      // start: torches and a sign
      { id: 'torchL', kind: 'prop', prop: 'torch', x: -6.6, y: 0, z: -0.4 },
      { id: 'torchR', kind: 'prop', prop: 'torch', x: 6.6, y: 0, z: -0.4 },
      { id: 'sign', kind: 'prop', prop: 'signpost', x: -8.4, y: 0, z: 0.8, ry: 0.4 },
      // dressing on the foothills and flanks
      { id: 'rockL', kind: 'prop', prop: 'lavarock', x: -11, y: 0, z: -1.5, sx: 1.5, ry: 0.6 },
      { id: 'rockR', kind: 'prop', prop: 'lavarock', x: 11.5, y: 0, z: 0.5, sx: 1.8, ry: 2.2 },
      { id: 'ventL', kind: 'prop', prop: 'vent', x: -15, y: 0, z: 4.5, sx: 1.2 },
      { id: 'obsR', kind: 'prop', prop: 'obsidian', x: 16, y: 0, z: 5.5, sx: 1.3, ry: -0.5 },
      { id: 'cryL', kind: 'prop', prop: 'crystal', x: -9, y: mountainY(-9, 9) - 0.25, z: 9, sx: 1.2, ry: 0.3 },
      { id: 'cryR', kind: 'prop', prop: 'crystal', x: 7.5, y: mountainY(7.5, 12) - 0.25, z: 12, sx: 0.9, ry: 2 },
      { id: 'treeL', kind: 'prop', prop: 'deadtree', x: -12.5, y: mountainY(-12.5, 11) - 0.2, z: 11, ry: 1 },
      { id: 'ashR', kind: 'prop', prop: 'ashplant', x: 10.5, y: mountainY(10.5, 8) - 0.1, z: 8 },
      { id: 'ashL', kind: 'prop', prop: 'ashplant', x: -4, y: 0, z: -2.2, sx: 0.8 },
      { id: 'flankL', kind: 'prop', prop: 'lavarock', x: -6.5, y: mountainY(-6.5, 5) - 0.3, z: 5, sx: 1.2, ry: 1.3 },
      { id: 'flankR', kind: 'prop', prop: 'lavarock', x: 5.5, y: mountainY(5.5, 7.5) - 0.3, z: 7.5, sx: 1.1, ry: 0.2 },
      { id: 'ventR', kind: 'prop', prop: 'vent', x: 9, y: mountainY(9, 5) - 0.2, z: 5, sx: 0.9 },
      { id: 'bones', kind: 'prop', prop: 'bones', x: 9, y: 0, z: -3, sx: 0.6, ry: 2.6 },
    ];
    s.ps.forEach((p, i) => {
      // a wooden boardwalk with rungs up the slope for every runner (narrower towards the top)
      const a = runnerPos(s.n, i, 0);
      const b = runnerPos(s.n, i, 1);
      const [dx, dy, dz] = [b.x - a.x, b.y - a.y, b.z - a.z];
      const len = Math.hypot(dx, dy, dz);
      const rx = -Math.asin(dy / len);
      const ry = Math.atan2(dx, dz);
      // local "up" of the tilted boards
      const [nx, ny, nz] = [Math.sin(-rx) * -Math.sin(ry), Math.cos(rx), -Math.sin(-rx) * Math.cos(ry)];
      for (let k = 0; k < RAMP_SEGS; k++) {
        const fm = (k + 0.5) / RAMP_SEGS;
        const m = runnerPos(s.n, i, fm);
        const th = 0.6;
        entities.push({ id: `rp${i}_${k}`, kind: 'box', x: m.x - nx * th * 0.5, y: m.y - ny * th * 0.5, z: m.z - nz * th * 0.5, rx, ry, sx: 2.1 * (1 - fm * 0.68), sy: th, sz: len / RAMP_SEGS + 0.08, color: '#b88a5c', mat: 'planks' });
      }
      for (let k = 1; k < RUNGS; k++) {
        const fm = k / RUNGS;
        const m = runnerPos(s.n, i, fm);
        entities.push({ id: `rg${i}_${k}`, kind: 'box', x: m.x + nx * 0.05, y: m.y + ny * 0.05, z: m.z + nz * 0.05, rx, ry, sx: 2.2 * (1 - fm * 0.68), sy: 0.12, sz: 0.22, color: '#7a5236', mat: 'wood' });
      }
      entities.push({ id: `start${i}`, kind: 'box', x: a.x, y: -0.08, z: -0.5, sx: 2.3, sy: 0.2, sz: 1.4, color: s.colors[i], mat: 'stone' });
      const f = p.progress / GOAL;
      const at = runnerPos(s.n, i, f);
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: at.x,
        y: at.y,
        z: at.z,
        ry: Math.PI,
        anim: p.finishedAt !== null ? 'cheer' : p.speedVis > 0.1 ? 'walk' : 'idle',
      });
      // finishers plant their flag at the crater rim
      if (p.finishedAt !== null) entities.push({ id: `flag${i}`, kind: 'prop', prop: 'flag', x: (i - (s.n - 1) / 2) * 0.85, y: MTN_H - 0.1, z: MTN_Z + 1.2, sx: 0.55, color: s.colors[i] });
    });
    return {
      env: 'lava',
      scenery: { set: 'summit', clear: { x: 0, z: 11, w: 52, d: 42 }, ground: 0, water: -0.45 },
      camera: { alpha: -Math.PI / 2, beta: 1.15, radius: 33, target: [0, 7, 6.5] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        bars: s.ps.map((p, i) => ({ player: i, value: p.progress / GOAL })),
      },
    };
  },
};
