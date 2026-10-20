import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { faceAngle, ranksFromScores, ringSpawn } from '../util';

/**
 * #8 Lava-Seilspringen (FFA, Timing-Button): a glowing lava beam sweeps around the centre
 * of a small island and gets faster. Players stand in a circle and must jump when it
 * passes – a jump lasts a fixed time. Whoever is hit is out; ranks follow the elimination
 * order, survivors share first place.
 *
 * Fairness (NET-05): a jump starts at the phone timestamp `press.t`. Each beam pass is only
 * judged GRACE seconds after it happened, so a press that was made in time but arrives a
 * bit late still counts.
 */
const RP = 4; // radius of the player circle
const BEAM_IN = 0.9;
const BEAM_OUT = 6.9;
const JUMP = 0.6; // fixed jump duration
const JUMP_H = 1.5;
const SAFE = 0.06; // take-off / landing frames that don't count as "in the air"
const GRACE = 0.2;
const MAX_LAG = 0.5; // presses older than this are clamped
const COUNTDOWN = 2;
const OMEGA0 = 1.7;
const OMEGA_ACC = 0.1;
const OMEGA_MAX = 6.2;
const OUT_R = 9.6;

interface P {
  phi: number;
  /** recent jump start times */
  jumps: number[];
  out: number | null;
  hitT: number;
  hits: number;
  /** bot: planned press time and the beam pass it is meant for */
  botPress: number | null;
  botFor: number | null;
}

export interface LavaSeilState {
  t: number;
  duration: number;
  practice: boolean;
  n: number;
  angle: number;
  omega: number;
  ps: P[];
  pending: { p: number; tc: number }[];
  endAt: number | null;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Is the player in the air (high enough) at time t? */
export function airborne(p: { jumps: number[] }, t: number): boolean {
  return p.jumps.some((j) => t >= j + SAFE && t <= j + JUMP - SAFE);
}

function jumpHeight(p: P, t: number): number {
  for (const j of p.jumps) {
    const u = (t - j) / JUMP;
    if (u >= 0 && u <= 1) return 4 * JUMP_H * u * (1 - u);
  }
  return 0;
}

export const lavaSeil: MinigameDef<LavaSeilState> = {
  id: 'lavaSeil',
  format: 'ffa',
  control: 'tap',
  theme: 'volcano',
  duration: 45,
  setup(players: MgPlayer[], _rng, opts) {
    const n = players.length;
    return {
      t: 0,
      duration: 45,
      practice: opts.practice,
      n,
      // start between two players
      angle: -Math.PI / 2 + Math.PI / n,
      omega: 0,
      ps: players.map((_, i) => ({ phi: wrap(-Math.PI / 2 + (i / n) * TAU), jumps: [], out: null, hitT: 0, hits: 0, botPress: null, botFor: null })),
      pending: [],
      endAt: null,
    };
  },
  layout(s, i) {
    if (s.ps[i].out !== null) return { kind: 'wait', labelKey: 'ctrl.eliminated' };
    return { kind: 'button', labelKey: 'ctrl.jump' };
  },
  input(s, i, input: MgInput) {
    if (input.type !== 'press') return;
    const p = s.ps[i];
    if (p.out !== null) return;
    const raw = Number.isFinite(input.t) ? input.t : s.t;
    const tj = Math.max(s.t - MAX_LAG, Math.min(raw, s.t));
    // no double jump: ignore presses while still in the air (or older than the last jump)
    if (p.jumps.some((j) => tj < j + JUMP)) return;
    p.jumps.push(tj);
    if (p.jumps.length > 3) p.jumps.shift();
  },
  tick(s, dt) {
    const t0 = s.t;
    s.t += dt;
    if (s.t > COUNTDOWN) s.omega = Math.min(OMEGA_MAX, OMEGA0 + OMEGA_ACC * (s.t - COUNTDOWN));
    if (s.omega > 0) {
      // find beam passes in this tick (beam turns in +angle direction)
      s.ps.forEach((p, i) => {
        if (p.out !== null) return;
        const d = wrap(p.phi - s.angle);
        if (d < s.omega * dt) s.pending.push({ p: i, tc: t0 + d / s.omega });
      });
      s.angle = wrap(s.angle + s.omega * dt);
    }
    // judge passes once late presses had time to arrive
    s.pending = s.pending.filter(({ p: i, tc }) => {
      if (s.t < tc + GRACE) return true;
      const p = s.ps[i];
      if (p.out !== null || airborne(p, tc)) return false;
      p.hitT = 1;
      p.hits++;
      if (!s.practice) p.out = tc;
      return false;
    });
    for (const p of s.ps) p.hitT = Math.max(0, p.hitT - dt);
    if (!s.practice && s.endAt === null && s.ps.filter((p) => p.out === null).length <= 1) s.endAt = s.t + 1.5;
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || (s.endAt !== null && s.t >= s.endAt)),
  result: (s) => ranksFromScores(s.ps.map((p) => (p.out === null ? 1e6 : p.out))),
  bot(s, i, level, rng: Rng) {
    const p = s.ps[i];
    if (p.out !== null || s.omega <= 0) return [];
    if (p.botPress !== null && s.t >= p.botPress) {
      const t = p.botPress;
      p.botPress = null;
      return [{ type: 'press', t }];
    }
    if (p.botPress !== null) return [];
    const ttc = wrap(p.phi - s.angle) / s.omega;
    const tc = s.t + ttc;
    if (ttc > 1 || (p.botFor !== null && Math.abs(tc - p.botFor) < 0.3)) return [];
    // the faster the beam, the harder the timing
    const sigma = { easy: 0.075, medium: 0.06, hard: 0.05 }[level] * (1 + s.omega / 3);
    p.botFor = tc;
    p.botPress = tc - JUMP / 2 + rng.noise() * sigma;
    return [];
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'island', kind: 'cylinder', x: 0, y: -0.4, z: 0, sx: 15, sy: 0.8, sz: 15, color: '#5b4a45' },
      { id: 'pillar', kind: 'cylinder', x: 0, y: 0.6, z: 0, sx: 1.6, sy: 1.2, sz: 1.6, color: '#3b2f2f' },
      { id: 'core', kind: 'sphere', x: 0, y: 1.3, z: 0, sx: 1, sy: 1, sz: 1, color: '#ff8a3d', glow: true },
    ];
    // the beam: a chain of glowing segments (rotation-free)
    const SEG = 9;
    for (let k = 0; k < SEG; k++) {
      const r = BEAM_IN + ((k + 0.5) / SEG) * (BEAM_OUT - BEAM_IN);
      entities.push({ id: `b${k}`, kind: 'cylinder', x: Math.cos(s.angle) * r, y: 0.35, z: Math.sin(s.angle) * r, sx: 0.85, sy: 0.55, sz: 0.85, color: k % 2 ? '#ff5a1f' : '#ff7a2d', glow: true });
    }
    const over = s.endAt !== null;
    s.ps.forEach((p, i) => {
      if (p.out !== null) {
        const sp = ringSpawn(s.n, OUT_R, i);
        entities.push({ id: `rk${i}`, kind: 'rock', x: sp.x, y: 0, z: sp.z, sx: 1.8, sy: 1, sz: 1.8 });
        entities.push({ id: `p${i}`, kind: 'player', player: i, x: sp.x, y: 0.5, z: sp.z, ry: faceAngle(-sp.x, -sp.z), anim: p.hitT > 0 ? 'hit' : 'sad' });
        return;
      }
      const x = Math.cos(p.phi) * RP;
      const z = Math.sin(p.phi) * RP;
      const h = jumpHeight(p, s.t);
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x,
        y: h,
        z,
        ry: faceAngle(-x, -z),
        anim: p.hitT > 0 ? 'hit' : h > 0 ? 'jump' : over ? 'cheer' : 'idle',
      });
      entities.push({ id: `sh${i}`, kind: 'cylinder', x, y: 0.02, z, sx: 1.2 - h * 0.3, sy: 0.02, sz: 1.2 - h * 0.3, color: '#222222', alpha: 0.35 });
    });
    return {
      env: 'lava',
      camera: { alpha: -Math.PI / 2, beta: 0.72, radius: 26, target: [0, 0, 0.5] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        scores: s.ps.map((p, i) => ({ player: i, value: s.practice ? `💥 ${p.hits}` : p.out === null ? '❤️' : '💥' })),
        message: s.t < COUNTDOWN ? { key: 'mg.lavaSeil.ready' } : undefined,
      },
    };
  },
};
