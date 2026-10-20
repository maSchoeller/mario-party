import type { MgEntity, MinigameDef } from '../types';
import { ranksFromScores, rowSpawn } from '../util';

/** #3 Gipfel-Sprint (FFA, Mashen): tap as fast as possible to run up the volcano. */
const GOAL = 220; // taps to the top (~30 s for an average masher, MINI-03)
const DURATION = 40;

interface P {
  progress: number;
  finishedAt: number | null;
  tapAcc: number;
  speedVis: number;
}

export interface GipfelSprintState {
  t: number;
  duration: number;
  practice: boolean;
  ps: P[];
  n: number;
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
    if (s.practice && p.progress >= GOAL) {
      p.progress = 0;
      p.finishedAt = null;
    }
  },
  tick(s, dt) {
    s.t += dt;
    for (const p of s.ps) p.speedVis = Math.max(0, p.speedVis - dt * 1.5);
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
      { id: 'mountain', kind: 'cone', x: 0, y: 0, z: 14, sx: 34, sy: 16, sz: 14, color: '#8d7f86' },
      { id: 'lava', kind: 'cylinder', x: 0, y: 15.6, z: 14, sx: 3, sy: 0.4, sz: 3, color: '#ff7a3d', glow: true },
    ];
    s.ps.forEach((p, i) => {
      const f = p.progress / GOAL;
      const x = rowSpawn(s.n, 3, i);
      entities.push({ id: `lane${i}`, kind: 'box', x, y: 0.02, z: 0, sx: 2.4, sy: 0.04, sz: 1, color: '#e9ddd6' });
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: x * (1 - f * 0.7),
        y: f * 14.5,
        z: f * 12,
        ry: Math.PI,
        anim: p.finishedAt !== null ? 'cheer' : p.speedVis > 0.1 ? 'walk' : 'idle',
      });
    });
    return {
      env: 'lava',
      camera: { alpha: -Math.PI / 2, beta: 1.15, radius: 30, target: [0, 6, 6] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        bars: s.ps.map((p, i) => ({ player: i, value: p.progress / GOAL })),
      },
    };
  },
};
