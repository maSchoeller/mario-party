import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { ageFx, emitFx, faceAngle, ranksFromScores, ringSpawn, viewFx, type FxState } from '../util';
import { BOT_DISPLAY_LAG } from './botLag';

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
const JUMP = 0.72; // fixed jump duration
const JUMP_H = 1.5;
const SAFE = 0.06; // take-off / landing frames that don't count as "in the air"
const GRACE = 0.2;
const MAX_LAG = 0.5; // presses older than this are clamped
const COUNTDOWN = 2;
const OMEGA0 = 1.7;
const OMEGA_ACC = 0.085;
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

export interface LavaSeilState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  n: number;
  angle: number;
  omega: number;
  ps: P[];
  pending: { p: number; tc: number }[];
  endAt: number | null;
  /** view only: last time a jump sound played (throttle) and the beam speed level */
  jumpSfxAt: number;
  speedLvl: number;
}

const LAVA = '#ff7a3d';
const JUMP_SFX_GAP = 0.3;

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
      jumpSfxAt: -1,
      speedLvl: 0,
      fx: [],
      fxN: 0,
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
    // take-off puff; the sound is throttled so four players jumping never turn into noise
    const loud = s.t - s.jumpSfxAt >= JUMP_SFX_GAP;
    if (loud) s.jumpSfxAt = s.t;
    emitFx(s, { kind: 'dust', sfx: loud ? 'jump' : undefined, x: Math.cos(p.phi) * RP, y: 0.05, z: Math.sin(p.phi) * RP, s: 0.5 });
  },
  tick(s, dt) {
    const t0 = s.t;
    s.t += dt;
    if (s.t > COUNTDOWN) s.omega = Math.min(OMEGA_MAX, OMEGA0 + OMEGA_ACC * (s.t - COUNTDOWN));
    // the beam starts / gets a notch faster: the core flares up
    const lvl = s.omega > 0 ? 1 + Math.floor(s.omega - OMEGA0) : 0;
    if (lvl > s.speedLvl) {
      s.speedLvl = lvl;
      emitFx(s, { kind: 'embers', sfx: lvl === 1 ? 'sizzle' : 'whoosh', x: 0, y: 1.4, z: 0, s: 1 + lvl * 0.3 }, 0.5);
    }
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
      const [hx, hz] = [Math.cos(p.phi) * RP, Math.sin(p.phi) * RP];
      emitFx(s, { kind: 'hit', sfx: 'sizzle', x: hx, y: 1.2, z: hz }, 0.4);
      emitFx(s, { kind: 'embers', x: hx, y: 0.3, z: hz, color: LAVA }, 0.4);
      if (!s.practice) {
        p.out = tc;
        const sp = ringSpawn(s.n, OUT_R, i);
        emitFx(s, { kind: 'smoke', sfx: 'aww', x: sp.x, y: 0.8, z: sp.z }, 0.5);
      }
      return false;
    });
    for (const p of s.ps) p.hitT = Math.max(0, p.hitT - dt);
    ageFx(s, dt);
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
    // humans see the beam a little late (TV + touch latency, see botLag.ts) and therefore
    // jump late on average – bots get the same handicap
    p.botPress = tc - JUMP / 2 + BOT_DISPLAY_LAG + rng.noise() * sigma;
    return [];
  },
  view(s) {
    const entities: MgEntity[] = [
      // a basalt island in the lava sea with a paved arena, the beam pivots on a glowing core
      // molten lava glowing around the hot rock (the backdrop's lava sea is mostly dark crust)
      { id: 'molten', kind: 'cylinder', x: 0, y: -0.43, z: 0, sx: 16.9, sy: 0.04, sz: 16.9, color: '#ff6a1f', glow: true, alpha: 0.8 },
      { id: 'island', kind: 'cylinder', x: 0, y: -0.9, z: 0, sx: 17, sy: 1.7, sz: 17, color: '#5a4f58', mat: 'basalt', taper: 15 / 17 },
      { id: 'arena', kind: 'cylinder', x: 0, y: -0.04, z: 0, sx: 14.2, sy: 0.1, sz: 14.2, color: '#8a7670', mat: 'stone' },
      { id: 'ringIn', kind: 'cylinder', x: 0, y: 0.02, z: 0, sx: RP * 2 + 1.5, sy: 0.04, sz: RP * 2 + 1.5, color: '#a08a80', mat: 'stone' },
      { id: 'ringIn2', kind: 'cylinder', x: 0, y: 0.06, z: 0, sx: RP * 2 - 1.5, sy: 0.04, sz: RP * 2 - 1.5, color: '#7c6862', mat: 'stone' },
      { id: 'pillar', kind: 'cylinder', x: 0, y: 0.6, z: 0, sx: 1.9, sy: 1.2, sz: 1.9, color: '#4a4048', mat: 'basalt', taper: 0.75 },
      { id: 'core', kind: 'sphere', x: 0, y: 1.3, z: 0, sx: 1, sy: 1, sz: 1, color: '#ff8a3d', mat: 'lava' },
      { id: 'coreGlow', kind: 'sphere', x: 0, y: 1.3, z: 0, sx: 0.7, sy: 0.7, sz: 0.7, color: '#ffb04a', glow: true },
    ];
    // torches on the rim (outside the beam's reach) and rocks / crystals in the lava around
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      entities.push({ id: `torch${k}`, kind: 'prop', prop: 'torch', x: Math.cos(a) * 7.7, y: -0.25, z: Math.sin(a) * 7.7 });
    }
    const deco: [string, number, number, number][] = [
      ['obsidian', 2.35, 11.5, 1.3],
      ['crystal', 0.8, 11, 1.2],
      ['lavarock', -0.75, 11, 1.6],
      ['lavarock', -2.4, 11.5, 1.4],
      ['vent', 3.55, 12, 1.1],
      ['lavarock', 1.55, 12.5, 1.2],
    ];
    deco.forEach(([prop, a, r, sc], k) => entities.push({ id: `deco${k}`, kind: 'prop', prop, x: Math.cos(a) * r, y: prop === 'vent' ? -0.35 : -0.5, z: Math.sin(a) * r, sx: sc, ry: a * 2 }));
    // the beam: a glowing lava rope turning around the core
    const mid = (BEAM_IN + BEAM_OUT) / 2;
    entities.push({ id: 'beam', kind: 'cylinder', x: Math.cos(s.angle) * mid, y: 0.35, z: Math.sin(s.angle) * mid, rz: Math.PI / 2, ry: -s.angle, sx: 0.62, sy: BEAM_OUT - BEAM_IN, sz: 0.62, color: '#ff6a1f', glow: true });
    entities.push({ id: 'beamTip', kind: 'sphere', x: Math.cos(s.angle) * BEAM_OUT, y: 0.35, z: Math.sin(s.angle) * BEAM_OUT, sx: 0.8, sy: 0.8, sz: 0.8, color: '#ffb04a', glow: true });
    const SEG = 4;
    for (let k = 0; k < SEG; k++) {
      const r = BEAM_IN + ((k + 0.5) / SEG) * (BEAM_OUT - BEAM_IN);
      entities.push({ id: `b${k}`, kind: 'sphere', x: Math.cos(s.angle) * r, y: 0.35, z: Math.sin(s.angle) * r, sx: 0.78, sy: 0.78, sz: 0.78, color: '#ff8a2d', glow: true });
    }
    const over = s.endAt !== null;
    s.ps.forEach((p, i) => {
      if (p.out !== null) {
        const sp = ringSpawn(s.n, OUT_R, i);
        entities.push({ id: `rk${i}`, kind: 'rock', x: sp.x, y: 0, z: sp.z, sx: 1.8, sy: 1, sz: 1.8, color: '#6e6168' });
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
      entities.push({ id: `sh${i}`, kind: 'cylinder', x, y: 0.1, z, sx: 1.2 - h * 0.3, sy: 0.02, sz: 1.2 - h * 0.3, color: '#222222', alpha: 0.35 });
    });
    return {
      env: 'lava',
      scenery: { set: 'volcano', clear: { r: OUT_R + 3.5 }, ground: 0, water: -0.45 },
      fx: viewFx(s),
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
