import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgHud, MinigameDef } from '../types';
import { PLAYER_COLOR_HEX } from '../../config';
import { ageFx, clamp, emitFx, ranksFromScores, rowSpawn, skill, viewFx, type FxState } from '../util';
import { BOT_DISPLAY_LAG } from './botLag';

/**
 * Final minigame Gipfelsturm (FFA, mixed controls, never drawn randomly): a three-stage
 * climb, every player on their own lane at their own pace:
 *  1. Hang  – mash to sprint up the slope (layout `mash`)
 *  2. Lava  – auto-run, press at the right moment to jump the lava gaps (layout `button`,
 *             evaluated with the phone timestamp `press.t`)
 *  3. Pfade – a sign on the TV shows a color/symbol, choose it on the phone (layout `choice`,
 *             options shuffled per fork)
 * First on the summit wins; at the time limit unfinished players are ranked by progress.
 * No gyro/shake (works with the A11Y motion filter).
 */
const DURATION = 60;

// stage 1 – slope
export const TAPS = 75;
const Z0 = -12;
const SLOPE_LEN = 6;
const SLOPE_H = 2.5;
const SLOPE_STEPS = 5;

// stage 2 – lava gaps (world units along +z, starting at Z1)
const Z1 = Z0 + SLOPE_LEN; // -6
export const TRACK = 16;
export const GAPS = [2.5, 5.5, 8.5, 11.5, 14];
export const GAP_W = 0.8;
export const RUN_SPEED = 2.4;
export const AIR = 0.75;
export const JUMP_LEN = RUN_SPEED * AIR;
const JUMP_H = 1.1;
/** wait this long after reaching an edge for a late-arriving earlier press (NET-05) */
const GRACE = 0.15;
const FALL_TIME = 1.2;
const RESPAWN_BACK = 1.6;

// stage 3 – path forks
const Z2 = Z1 + TRACK; // 10
export const FORKS = 6;
const FORK_STEP = 1.2;
const FORK_RISE = 0.5;
const WALK = 0.9;
const PENALTY = 1.5;
export const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export type PathColor = (typeof COLORS)[number];
const COLOR_HEX: Record<PathColor, string> = { red: '#e8464b', blue: '#3f7fe0', green: '#4cbf5a', yellow: '#f2c230' };
const COLOR_ICON: Record<PathColor, string> = { red: '🔺', blue: '🔵', green: '🟩', yellow: '⭐' };
const COLOR_SIGN: Record<PathColor, string> = { red: '▲', blue: '●', green: '■', yellow: '★' };

// summit
const SUMMIT_Z = Z2 + FORKS * FORK_STEP + 1.6;
const SUMMIT_Y = SLOPE_H + FORKS * FORK_RISE + 0.5;

interface Jump {
  start: number;
  until: number;
  x0: number;
}

interface P {
  stage: 1 | 2 | 3 | 4;
  // stage 1
  taps: number;
  speedVis: number;
  tapAcc: number;
  // stage 2
  jx: number;
  gap: number;
  jump: Jump | null;
  fallUntil: number | null;
  /** earliest time a press may refer to (start of the current run / last landing) */
  runSince: number;
  falls: number;
  // stage 3
  fork: number;
  target: PathColor;
  order: PathColor[];
  walkUntil: number;
  penaltyUntil: number;
  lastPick: PathColor | null;
  /** penalty ended: options must be reshuffled in tick */
  reshuffle: boolean;
  finishedAt: number | null;
  // bots
  botX: number | null;
  botAt: number | null;
}

export interface GipfelsturmState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  n: number;
  ps: P[];
  /** player colors (view only) */
  colors: string[];
}

const LANE = 4;
const laneX = (s: GipfelsturmState, i: number) => rowSpawn(s.n, LANE, i);
/** lava in the gaps of stage 2 (the backdrop's lava sea lies deeper) */
const GAP_LAVA_Y = 2.2; // high enough to be seen in the narrow gaps from the camera
const LAVA = '#ff7a3d';

function newP(rng: Rng): P {
  return {
    stage: 1,
    taps: 0,
    speedVis: 0,
    tapAcc: 0,
    jx: 0,
    gap: 0,
    jump: null,
    fallUntil: null,
    runSince: 0,
    falls: 0,
    fork: 0,
    target: rng.pick(COLORS),
    order: rng.shuffle([...COLORS]),
    walkUntil: 0,
    penaltyUntil: 0,
    lastPick: null,
    reshuffle: false,
    finishedAt: null,
    botX: null,
    botAt: null,
  };
}

/** Overall progress 0..1 (used for ranking unfinished players and the HUD bars). */
export function progress(p: P): number {
  if (p.stage === 4) return 1;
  if (p.stage === 1) return (p.taps / TAPS) / 3;
  if (p.stage === 2) return 1 / 3 + clamp(p.jx / TRACK, 0, 1) / 3;
  return 2 / 3 + (p.fork / FORKS) / 3;
}

function newFork(p: P, rng: Rng): void {
  const prev = p.target;
  p.target = rng.pick(COLORS.filter((c) => c !== prev));
  p.order = rng.shuffle([...COLORS]);
}

function fall(s: GipfelsturmState, p: P, i: number): void {
  emitFx(s, { kind: 'splash', sfx: 'sizzle', x: laneX(s, i), y: GAP_LAVA_Y + 0.1, z: Z1 + Math.min(p.jx, TRACK), color: LAVA }, 0.5);
  p.jump = null;
  p.fallUntil = s.t + FALL_TIME;
  p.falls++;
  p.botX = null;
}

function finishPlayer(s: GipfelsturmState, p: P, i: number, rng: Rng): void {
  emitFx(s, { kind: 'confetti', sfx: 'cheer', x: laneX(s, i), y: SUMMIT_Y + 2, z: SUMMIT_Z - 0.4, color: s.colors[i] }, 0.6);
  if (s.practice) {
    // practice: start over from the bottom
    Object.assign(p, newP(rng));
    return;
  }
  p.stage = 4;
  p.finishedAt = s.t;
}

export const gipfelsturm: MinigameDef<GipfelsturmState> = {
  id: 'gipfelsturm',
  format: 'ffa',
  control: 'tap',
  theme: 'volcano',
  duration: DURATION,
  final: true,
  setup(players, rng, opts) {
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      n: players.length,
      ps: players.map(() => newP(rng)),
      colors: players.map((p) => PLAYER_COLOR_HEX[p.color]),
      fx: [],
      fxN: 0,
    };
  },
  layout(s, i): ControllerLayout {
    const p = s.ps[i];
    if (p.stage === 1) return { kind: 'mash', labelKey: 'ctrl.tapFast' };
    if (p.stage === 2) return { kind: 'button', labelKey: 'ctrl.jump' };
    if (p.stage === 4) return { kind: 'wait', labelKey: 'ctrl.summit' };
    if (s.t < p.penaltyUntil) return { kind: 'wait', labelKey: 'ctrl.stumble' };
    return {
      kind: 'choice',
      options: p.order.map((c) => ({ id: c, labelKey: `ctrl.${c}`, color: COLOR_HEX[c], icon: COLOR_ICON[c] })),
      locked: s.t < p.walkUntil ? p.lastPick : null,
    };
  },
  input(s, i, input) {
    const p = s.ps[i];
    if (p.stage === 1) {
      if (input.type !== 'tap') return;
      p.taps++;
      p.speedVis = Math.min(1, p.speedVis + 0.18);
      if (p.taps >= TAPS) {
        p.stage = 2;
        p.jx = 0;
        p.runSince = s.t;
        emitFx(s, { kind: 'ring', sfx: 'ding', x: laneX(s, i), y: SLOPE_H + 0.2, z: Z1, color: s.colors[i] });
      } else if (p.taps % 15 === 0) {
        const f = p.taps / TAPS;
        const y = ((Math.min(SLOPE_STEPS - 1, Math.floor(f * SLOPE_STEPS)) + 1) * SLOPE_H) / SLOPE_STEPS;
        emitFx(s, { kind: 'dust', x: laneX(s, i), y: y + 0.05, z: Z0 + 0.3 + f * (SLOPE_LEN - 0.3), s: 0.45 });
      }
      return;
    }
    if (p.stage === 2) {
      if (input.type !== 'press' || p.jump || p.fallUntil !== null) return;
      // takeoff at the phone timestamp, reconstructed position on the (constant-speed) run
      const tp = clamp(Number.isFinite(input.t) ? input.t : s.t, p.runSince, s.t);
      const x0 = p.jx - RUN_SPEED * (s.t - tp);
      const g = GAPS[p.gap];
      if (g !== undefined && x0 > g) {
        // took off over the lava – too late
        fall(s, p, i);
        return;
      }
      p.jump = { start: tp, until: tp + AIR, x0 };
      emitFx(s, { kind: 'dust', sfx: 'jump', x: laneX(s, i), y: SLOPE_H + 0.05, z: Z1 + Math.min(p.jx, TRACK), s: 0.5 });
      p.botX = null;
      return;
    }
    if (p.stage === 3) {
      if (input.type !== 'choice' || s.t < p.walkUntil || s.t < p.penaltyUntil) return;
      if (!(COLORS as readonly string[]).includes(input.id)) return;
      const fy = SLOPE_H + p.fork * FORK_RISE;
      const fz = Z2 - 0.3 + p.fork * FORK_STEP;
      if (input.id === p.target) {
        emitFx(s, { kind: 'sparkle', sfx: 'correct', x: laneX(s, i), y: fy + 1.8, z: fz, color: COLOR_HEX[p.target] });
        p.lastPick = p.target;
        p.fork++;
        p.walkUntil = s.t + WALK;
      } else {
        emitFx(s, { kind: 'hit', sfx: 'buzz', x: laneX(s, i), y: fy + 1.6, z: fz });
        p.penaltyUntil = s.t + PENALTY;
        p.reshuffle = true;
      }
      p.botAt = null;
    }
  },
  tick(s, dt, rng) {
    s.t += dt;
    ageFx(s, dt);
    for (let i = 0; i < s.ps.length; i++) {
      const p = s.ps[i];
      p.speedVis = Math.max(0, p.speedVis - dt * 1.5);
      if (p.stage === 2) {
        if (p.fallUntil !== null) {
          if (s.t >= p.fallUntil) {
            p.fallUntil = null;
            p.jx = Math.max(0, GAPS[p.gap] - RESPAWN_BACK);
            p.runSince = s.t;
          }
          continue;
        }
        p.jx += RUN_SPEED * dt;
        const g = GAPS[p.gap];
        if (p.jump) {
          if (s.t >= p.jump.until) {
            const land = p.jump.x0 + JUMP_LEN;
            p.jump = null;
            p.runSince = s.t;
            if (g !== undefined && land >= g) {
              if (land < g + GAP_W) {
                fall(s, p, i); // jumped too short, landed in the lava
                continue;
              }
              p.gap++; // cleared
              emitFx(s, { kind: 'dust', x: laneX(s, i), y: SLOPE_H + 0.05, z: Z1 + Math.min(p.jx, TRACK), s: 0.6 });
            }
          }
        } else if (g !== undefined && p.jx >= g + RUN_SPEED * GRACE) {
          fall(s, p, i);
          continue;
        }
        if (!p.jump && p.gap >= GAPS.length && p.jx >= TRACK) {
          emitFx(s, { kind: 'ring', sfx: 'ding', x: laneX(s, i), y: SLOPE_H + 0.2, z: Z2, color: s.colors[i] });
          p.stage = 3;
          p.fork = 0;
          p.walkUntil = s.t + WALK * 0.5;
          newFork(p, rng);
        }
      } else if (p.stage === 3) {
        if (p.reshuffle && s.t >= p.penaltyUntil) {
          p.reshuffle = false;
          p.order = rng.shuffle([...COLORS]);
        }
        if (p.walkUntil > 0 && s.t >= p.walkUntil) {
          p.walkUntil = 0;
          if (p.fork >= FORKS) finishPlayer(s, p, i, rng);
          else if (p.lastPick !== null) newFork(p, rng);
          p.lastPick = null;
        }
      }
    }
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || s.ps.every((p) => p.finishedAt !== null)),
  result(s) {
    return ranksFromScores(s.ps.map((p) => (p.finishedAt !== null ? 1000 - p.finishedAt : progress(p))));
  },
  bot(s, i, level, rng, dt) {
    const p = s.ps[i];
    const sk = skill(level);
    if (p.stage === 1) {
      const rate = { easy: 5.2, medium: 6.6, hard: 8 }[level] * (0.85 + rng.next() * 0.3);
      p.tapAcc += rate * dt;
      const out: { type: 'tap' }[] = [];
      while (p.tapAcc >= 1) {
        p.tapAcc -= 1;
        out.push({ type: 'tap' });
      }
      return out;
    }
    if (p.stage === 2) {
      if (p.jump || p.fallUntil !== null || p.gap >= GAPS.length) return [];
      const g = GAPS[p.gap];
      if (p.botX === null) {
        // aim for the middle of the takeoff window, timing noise depends on skill; plus the
        // display lag a human has (sees the runner a bit late, see botLag.ts)
        const sigma = { easy: 0.15, medium: 0.085, hard: 0.05 }[level];
        p.botX = g - (JUMP_LEN - GAP_W) / 2 + (BOT_DISPLAY_LAG + rng.noise() * sigma) * RUN_SPEED;
      }
      if (p.jx >= p.botX) {
        const t = s.t - (p.jx - p.botX) / RUN_SPEED;
        return [{ type: 'press', t }];
      }
      return [];
    }
    if (p.stage === 3) {
      if (s.t < p.walkUntil || s.t < p.penaltyUntil || p.reshuffle) return [];
      if (p.botAt === null) p.botAt = s.t + { easy: 1.3, medium: 0.9, hard: 0.6 }[level] * (0.8 + rng.next() * 0.4);
      if (s.t < p.botAt) return [];
      p.botAt = null;
      const correct = rng.chance({ easy: 0.72, medium: 0.87, hard: 0.96 }[level] * (0.9 + 0.1 * sk.accuracy));
      const id = correct ? p.target : rng.pick(COLORS.filter((c) => c !== p.target));
      return [{ type: 'choice', id }];
    }
    return [];
  },
  view(s) {
    const W = s.n * LANE - 0.6; // width of the climbing massif
    const MTN_Z = SUMMIT_Z + 8;
    const entities: MgEntity[] = [
      // the peak behind the summit, a stone start ledge in front
      { id: 'mountain', kind: 'cylinder', x: 0, y: 6.5, z: MTN_Z, sx: 46, sy: 13, sz: 22, color: '#7d6f78', mat: 'basalt', taper: 0.16 },
      { id: 'start', kind: 'box', x: 0, y: -0.5, z: Z0 - 1.4, sx: W + 1.2, sy: 1, sz: 2.8, color: '#9a8a80', mat: 'stone' },
      { id: 'summit', kind: 'box', x: 0, y: (SUMMIT_Y - 1) / 2, z: SUMMIT_Z, sx: s.n * LANE + 1, sy: SUMMIT_Y + 1, sz: 2.4, color: '#b3a396', mat: 'stone' },
      { id: 'goal', kind: 'star', x: 0, y: SUMMIT_Y + 3, z: SUMMIT_Z + 0.8, sx: 1.8, sy: 1.8, sz: 1.8, color: '#ffd84a', glow: true },
      { id: 'flagL', kind: 'prop', prop: 'flag', x: -(s.n * LANE) / 2 - 0.1, y: SUMMIT_Y, z: SUMMIT_Z + 0.6, color: '#ffd84a' },
      { id: 'flagR', kind: 'prop', prop: 'flag', x: (s.n * LANE) / 2 + 0.1, y: SUMMIT_Y, z: SUMMIT_Z + 0.6, ry: Math.PI, color: '#ffd84a' },
      // start dressing
      { id: 'sign', kind: 'prop', prop: 'signpost', x: -W / 2 - 0.2, y: 0, z: Z0 - 2.2, ry: 0.5 },
      { id: 'torchS1', kind: 'prop', prop: 'torch', x: -W / 2 + 0.2, y: 0, z: Z0 - 0.6 },
      { id: 'torchS2', kind: 'prop', prop: 'torch', x: W / 2 - 0.2, y: 0, z: Z0 - 0.6 },
      // rocks and crystals rising out of the lava along the climb
      { id: 'lr1', kind: 'prop', prop: 'lavarock', x: -W / 2 - 2.2, y: -0.6, z: -9, sx: 1.8, ry: 0.4 },
      { id: 'lr2', kind: 'prop', prop: 'lavarock', x: W / 2 + 2.4, y: -0.6, z: -2, sx: 2, ry: 2.1 },
      { id: 'lr3', kind: 'prop', prop: 'lavarock', x: -W / 2 - 2.6, y: -0.6, z: 6, sx: 1.6, ry: 1.2 },
      { id: 'ob1', kind: 'prop', prop: 'obsidian', x: W / 2 + 3.5, y: -0.6, z: 8, sx: 1.4, ry: -0.6 },
      { id: 'ob2', kind: 'prop', prop: 'obsidian', x: -W / 2 - 4, y: -0.6, z: -3, sx: 1.2, ry: 0.9 },
      { id: 'cr1', kind: 'prop', prop: 'crystal', x: W / 2 + 2.2, y: -0.4, z: 14, sx: 1.3, ry: 2.4 },
      { id: 'cr2', kind: 'prop', prop: 'crystal', x: -W / 2 - 2, y: -0.4, z: 15, sx: 1.1 },
      { id: 'vent', kind: 'prop', prop: 'vent', x: W / 2 + 2.8, y: -0.5, z: -10, sx: 1.3 },
    ];
    // between the summit torches
    for (let k = 1; k < s.n; k++) entities.push({ id: `torchT${k}`, kind: 'prop', prop: 'torch', x: (k - s.n / 2) * LANE, y: SUMMIT_Y, z: SUMMIT_Z + 0.9 });
    // the massif under the lanes (a little lower, so every lane reads as its own ridge)
    for (let k = 0; k < SLOPE_STEPS; k++) {
      const top = ((k + 1) * SLOPE_H) / SLOPE_STEPS - 0.25;
      const d = SLOPE_LEN / SLOPE_STEPS;
      entities.push({ id: `ms${k}`, kind: 'box', x: 0, y: (top - 1) / 2, z: Z0 + (k + 0.5) * d, sx: W, sy: top + 1, sz: d - 0.06, color: '#5e535c', mat: 'basalt' });
    }
    const bounds = [0, ...GAPS.flatMap((g) => [g, g + GAP_W]), TRACK];
    for (let k = 0; k < bounds.length; k += 2) {
      const [a, b] = [bounds[k], bounds[k + 1]];
      entities.push({ id: `mr${k / 2}`, kind: 'box', x: 0, y: (SLOPE_H - 0.3 - 1) / 2, z: Z1 + (a + b) / 2, sx: W, sy: SLOPE_H - 0.3 + 1, sz: b - a - 0.06, color: '#4e4452', mat: 'basalt' });
    }
    // glowing lava in every gap
    // (molten and bright: the textured lava surface is mostly dark crust, too dim for a 0.8 m gap)
    GAPS.forEach((g, k) => entities.push({ id: `lava${k}`, kind: 'box', x: 0, y: GAP_LAVA_Y - 0.1, z: Z1 + g + GAP_W / 2, sx: W, sy: 0.2, sz: GAP_W - 0.02, color: '#ff5a1f', glow: true }));
    for (let k = 0; k < FORKS; k++) {
      const top = SLOPE_H + (k + 1) * FORK_RISE - 0.25;
      entities.push({ id: `mf${k}`, kind: 'box', x: 0, y: (top - 1) / 2, z: Z2 + (k + 0.5) * FORK_STEP, sx: W, sy: top + 1, sz: FORK_STEP - 0.06, color: '#5e535c', mat: 'basalt' });
    }
    const place = ranksFromScores(s.ps.map((p) => (p.finishedAt !== null ? 1000 - p.finishedAt : -1)));
    s.ps.forEach((p, i) => {
      const lx = laneX(s, i);
      // stage 1: steps up the slope
      for (let k = 0; k < SLOPE_STEPS; k++) {
        const top = ((k + 1) * SLOPE_H) / SLOPE_STEPS;
        const d = SLOPE_LEN / SLOPE_STEPS;
        entities.push({ id: `s${i}_${k}`, kind: 'box', x: lx, y: (top - 1) / 2, z: Z0 + (k + 0.5) * d, sx: 3, sy: top + 1, sz: d, color: k === 0 ? s.colors[i] : '#b09d90', mat: 'stone' });
      }
      // stage 2: rock platforms with lava gaps between them
      for (let k = 0; k < bounds.length; k += 2) {
        const a = bounds[k];
        const b = bounds[k + 1];
        entities.push({ id: `r${i}_${k / 2}`, kind: 'box', x: lx, y: (SLOPE_H - 1) / 2, z: Z1 + (a + b) / 2, sx: 3, sy: SLOPE_H + 1, sz: b - a, color: '#887880', mat: 'basalt' });
      }
      // stage 3: steps of the path forks
      for (let k = 0; k < FORKS; k++) {
        const top = SLOPE_H + (k + 1) * FORK_RISE;
        entities.push({ id: `f${i}_${k}`, kind: 'box', x: lx, y: (top - 1) / 2, z: Z2 + (k + 0.5) * FORK_STEP, sx: 3, sy: top + 1, sz: FORK_STEP, color: '#b09d90', mat: 'stone' });
      }
      if (p.stage === 4) entities.push({ id: `pflag${i}`, kind: 'prop', prop: 'flag', x: lx + 1, y: SUMMIT_Y, z: SUMMIT_Z + 0.5, sx: 0.6, color: s.colors[i] });
      // player position & animation
      let z = Z0;
      let y = 0;
      let anim: MgEntity['anim'] = 'idle';
      let ry = Math.PI; // facing up the mountain
      if (p.stage === 1) {
        const f = p.taps / TAPS;
        z = Z0 + 0.3 + f * (SLOPE_LEN - 0.3);
        y = ((Math.min(SLOPE_STEPS - 1, Math.floor(f * SLOPE_STEPS)) + 1) * SLOPE_H) / SLOPE_STEPS;
        anim = p.speedVis > 0.1 ? 'walk' : 'idle';
      } else if (p.stage === 2) {
        z = Z1 + Math.min(p.jx, TRACK);
        y = SLOPE_H;
        anim = 'walk';
        if (p.fallUntil !== null) {
          const u = clamp(1 - (p.fallUntil - s.t) / FALL_TIME, 0, 1);
          y = SLOPE_H - u * (SLOPE_H + 1);
          anim = 'hit';
        } else if (p.jump) {
          const u = clamp((s.t - p.jump.start) / AIR, 0, 1);
          y = SLOPE_H + 4 * JUMP_H * u * (1 - u);
          anim = 'jump';
        } else if (GAPS[p.gap] !== undefined && p.jx > GAPS[p.gap]) {
          z = Z1 + GAPS[p.gap]; // grace time: wait at the edge
        }
      } else if (p.stage === 3) {
        // a = number of fork steps reached (continuous while walking up to the next step)
        const walking = s.t < p.walkUntil && p.lastPick !== null;
        const a = walking ? p.fork - 1 + clamp(1 - (p.walkUntil - s.t) / WALK, 0, 1) : p.fork;
        z = Z2 - 0.3 + a * FORK_STEP;
        y = SLOPE_H + Math.min(FORKS, Math.round(a)) * FORK_RISE;
        anim = s.t < p.penaltyUntil ? 'sad' : walking ? 'walk' : 'idle';
        // the sign in front of the player shows which path is safe
        if (s.t >= p.walkUntil && p.fork < FORKS) {
          const sz = Z2 + (p.fork + 0.5) * FORK_STEP;
          const top = SLOPE_H + (p.fork + 1) * FORK_RISE;
          entities.push({ id: `pole${i}`, kind: 'cylinder', x: lx + 1.2, y: top + 1, z: sz, sx: 0.16, sy: 2, sz: 0.16, color: '#7a5c45', mat: 'wood' });
          entities.push({
            id: `sign${i}`,
            kind: 'box',
            x: lx + 1.2,
            y: top + 2.3,
            z: sz,
            sx: 1.9,
            sy: 1.5,
            sz: 0.2,
            color: COLOR_HEX[p.target],
            glow: true,
            label: COLOR_SIGN[p.target],
          });
        }
      } else {
        z = SUMMIT_Z - 0.4;
        y = SUMMIT_Y;
        anim = 'cheer';
        ry = 0;
      }
      entities.push({ id: `p${i}`, kind: 'player', player: i, x: lx, y, z, ry, anim, label: p.stage === 4 ? `${place[i] + 1}.` : undefined });
    });
    const hud: MgHud = {
      timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
      bars: s.ps.map((p, i) => ({ player: i, value: progress(p) })),
      scores: s.ps.map((p, i) => ({ player: i, value: p.stage === 4 ? `${place[i] + 1}.` : `${p.stage}/3` })),
    };
    if (s.t < 2.5) hud.message = { key: 'mg.gipfelsturm.start' };
    return {
      env: 'lava',
      scenery: { set: 'summit', clear: { x: 0, z: (Z0 - 3 + MTN_Z) / 2, w: W + 6, d: MTN_Z - Z0 + 6 }, ground: 0, water: -0.3 },
      camera: { alpha: -Math.PI / 2, beta: 1.0, radius: 34, target: [0, 3, 2] },
      entities,
      hud,
      fx: viewFx(s),
    };
  },
};
