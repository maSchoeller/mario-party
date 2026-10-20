import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgHud, MinigameDef } from '../types';
import { BOT_DISPLAY_LAG } from './botLag';

/**
 * #20 Memo-Duell (Duell, Tippen): the TV lights up a growing color sequence on 4 big pads,
 * both players repeat it at the same time on their phone pads. A wrong pad (or running out
 * of time) = out for this round and costs one of LIVES hearts. Whoever loses the last heart
 * loses the duel. If at least one player was correct, the sequence grows by one; if both
 * were wrong, a new sequence of the same length follows. Both lose their last heart in the
 * same round → whoever got further wins (equal → both get a heart back, replay).
 * Emergency brake: from SOFT_LIMIT on, a round where both are correct is decided by speed;
 * at HARD_LIMIT the game ends immediately (more hearts, then further in the current round,
 * then faster).
 */
export const PAD_COLORS = ['#e8464b', '#3f7fe0', '#4cbf5a', '#f2c230'];
const PAD_DARK = ['#6e2a2c', '#22406e', '#275f2e', '#7a6320'];
const PAD_X = [-4.2, -1.4, 1.4, 4.2];

const START_LEN = 3;
const LEAD_IN = 0.8;
const OFF = 0.18;
const JUDGE = 1.8;
const SOFT_LIMIT = 46;
const HARD_LIMIT = 58;
/** hearts per player – one mistake must not end the duel after a few seconds (MINI-03) */
export const LIVES = 2;

/** Time one pad stays lit while showing a sequence of length len (gets a bit faster). */
export function onTime(len: number): number {
  return Math.max(0.32, 0.6 - 0.03 * (len - START_LEN));
}
const inputLimit = (len: number) => 2.5 + 0.9 * len;

interface P {
  /** hearts left */
  lives: number;
  /** correct presses in the current round */
  pos: number;
  failed: boolean;
  done: boolean;
  /** seconds from input start to the last correct press (this round) */
  roundTime: number;
  /** sum of completion times of all completed rounds (tie-break) */
  totalTime: number;
  /** last press time, for a short jump animation */
  lastPress: number;
  botNext: number | null;
}

export interface MemoDuellState {
  t: number;
  practice: boolean;
  phase: 'show' | 'input' | 'judge' | 'done';
  phaseStart: number;
  seq: number[];
  round: number;
  ps: [P, P];
  /** pad that is lit on the TV right now (null = none) – host plays the tone of this pad */
  lit: number | null;
  /** index of the lit step inside the sequence (changes → new tone) */
  litStep: number | null;
  /** longer: both correct · life: a heart lost, sequence grows · retry: both wrong, same length */
  outcome: 'longer' | 'life' | 'retry' | 'decided' | null;
  winner: number | null;
  /** decided by the time limit */
  byTime: boolean;
}

const newP = (): P => ({ lives: LIVES, pos: 0, failed: false, done: false, roundTime: 0, totalTime: 0, lastPress: -9, botNext: null });

function showDuration(len: number): number {
  return LEAD_IN + len * (onTime(len) + OFF);
}

function startShow(s: MemoDuellState): void {
  s.phase = 'show';
  s.phaseStart = s.t;
  s.outcome = null;
  for (const p of s.ps) {
    p.pos = 0;
    p.failed = false;
    p.done = false;
    p.roundTime = 0;
    p.botNext = null;
  }
}

function randomSeq(len: number, rng: Rng): number[] {
  return Array.from({ length: len }, () => rng.int(0, 3));
}

/** Who leads right now: more hearts, then further in the current round, then faster (overall). */
function leaderByProgress(s: MemoDuellState): number | null {
  const [a, b] = s.ps;
  if (a.lives !== b.lives) return a.lives > b.lives ? 0 : 1;
  const inRound = s.phase === 'input' || s.phase === 'judge';
  const pa = inRound ? a.pos : 0;
  const pb = inRound ? b.pos : 0;
  if (pa !== pb) return pa > pb ? 0 : 1;
  const ta = a.totalTime + (inRound ? a.roundTime : 0);
  const tb = b.totalTime + (inRound ? b.roundTime : 0);
  if (Math.abs(ta - tb) > 1e-6) return ta < tb ? 0 : 1;
  return null;
}

function judge(s: MemoDuellState): void {
  const [a, b] = s.ps;
  let winner: number | null = null;
  let outcome: MemoDuellState['outcome'];
  for (const p of s.ps) if (!p.done) p.lives = Math.max(0, p.lives - 1);
  if (a.done && b.done) {
    if (!s.practice && s.t >= SOFT_LIMIT && Math.abs(a.roundTime - b.roundTime) > 1e-6) {
      winner = a.roundTime < b.roundTime ? 0 : 1;
      s.byTime = true;
    }
    outcome = winner === null ? 'longer' : 'decided';
  } else if (a.lives > 0 && b.lives > 0) {
    outcome = a.done || b.done ? 'life' : 'retry';
  } else if (a.lives !== b.lives) {
    winner = a.lives > b.lives ? 0 : 1;
    outcome = 'decided';
  } else if (a.pos !== b.pos) {
    // both lost their last heart in the same round
    winner = a.pos > b.pos ? 0 : 1;
    outcome = 'decided';
  } else {
    for (const p of s.ps) p.lives = 1;
    outcome = 'retry';
  }
  for (const p of s.ps) if (p.done) p.totalTime += p.roundTime;
  s.outcome = outcome;
  s.winner = winner;
  s.phase = 'judge';
  s.phaseStart = s.t;
  s.lit = null;
  s.litStep = null;
}

export function botErrorChance(level: BotLevel, len: number): number {
  const base = { easy: 0.026, medium: 0.014, hard: 0.0075 }[level];
  return Math.min(0.6, base * Math.pow(len / START_LEN, 2.2));
}

export const memoDuell: MinigameDef<MemoDuellState> = {
  id: 'memoDuell',
  format: 'duel',
  control: 'tap',
  theme: 'any',
  duration: 55,
  setup(_players, rng, opts) {
    const s: MemoDuellState = {
      t: 0,
      practice: opts.practice,
      phase: 'show',
      phaseStart: 0,
      seq: randomSeq(START_LEN, rng),
      round: 1,
      ps: [newP(), newP()],
      lit: null,
      litStep: null,
      outcome: null,
      winner: null,
      byTime: false,
    };
    startShow(s);
    return s;
  },
  layout(s, i): ControllerLayout {
    const p = s.ps[i];
    if (s.phase === 'input' && p.failed) return { kind: 'wait', labelKey: 'ctrl.memoFail' };
    if (s.phase === 'input' && p.done) return { kind: 'wait', labelKey: 'ctrl.memoDone' };
    return { kind: 'pads', count: 4, colors: PAD_COLORS, active: s.phase === 'input' };
  },
  input(s, i, input) {
    if (input.type !== 'pad' || s.phase !== 'input') return;
    const p = s.ps[i];
    if (p.failed || p.done) return;
    if (!Number.isInteger(input.idx) || input.idx < 0 || input.idx > 3) return;
    p.lastPress = s.t;
    if (input.idx !== s.seq[p.pos]) {
      p.failed = true;
      return;
    }
    p.pos++;
    p.roundTime = s.t - s.phaseStart;
    if (p.pos >= s.seq.length) p.done = true;
  },
  tick(s, dt, rng) {
    s.t += dt;
    if (s.phase === 'done') return;
    if (!s.practice && s.t >= HARD_LIMIT) {
      if (s.winner === null) {
        s.winner = leaderByProgress(s);
        s.byTime = true;
      }
      s.phase = 'done';
      s.lit = null;
      return;
    }
    const pt = s.t - s.phaseStart;
    if (s.phase === 'show') {
      const len = s.seq.length;
      const step = onTime(len) + OFF;
      const k = Math.floor((pt - LEAD_IN) / step);
      const inStep = pt - LEAD_IN - k * step;
      if (pt >= LEAD_IN && k < len && inStep < onTime(len)) {
        s.lit = s.seq[k];
        s.litStep = k;
      } else {
        s.lit = null;
        s.litStep = null;
      }
      if (pt >= showDuration(len)) {
        s.phase = 'input';
        s.phaseStart = s.t;
      }
      return;
    }
    if (s.phase === 'input') {
      const finished = s.ps.every((p) => p.done || p.failed);
      if (finished || pt >= inputLimit(s.seq.length)) {
        for (const p of s.ps) if (!p.done) p.failed = true; // timeout counts as a mistake
        judge(s);
      }
      return;
    }
    // judge
    if (pt < JUDGE) return;
    if (s.outcome === 'decided') {
      if (!s.practice) {
        s.phase = 'done';
        return;
      }
      // practice: start over
      s.winner = null;
      s.byTime = false;
      for (const p of s.ps) {
        p.totalTime = 0;
        p.lives = LIVES;
      }
      s.seq = randomSeq(START_LEN, rng);
    } else if (s.outcome === 'longer' || s.outcome === 'life') s.seq.push(rng.int(0, 3));
    else s.seq = randomSeq(s.seq.length, rng);
    s.round++;
    startShow(s);
  },
  isOver: (s) => s.phase === 'done',
  result: (s) => (s.winner === null ? [0, 0] : s.winner === 0 ? [0, 1] : [1, 0]),
  bot(s, i, level, rng) {
    const p = s.ps[i];
    if (s.phase !== 'input' || p.done || p.failed) return [];
    const len = s.seq.length;
    if (p.botNext === null) {
      // think time before the first press, plus the display lag a human has (botLag.ts)
      p.botNext = s.t + BOT_DISPLAY_LAG + { easy: 0.9, medium: 0.65, hard: 0.5 }[level] * (0.8 + rng.next() * 0.4);
    }
    if (s.t < p.botNext) return [];
    p.botNext = s.t + { easy: 0.7, medium: 0.5, hard: 0.38 }[level] * (0.8 + rng.next() * 0.4);
    const right = s.seq[p.pos];
    if (rng.chance(botErrorChance(level, len))) {
      const wrong = [0, 1, 2, 3].filter((x) => x !== right);
      return [{ type: 'pad', idx: rng.pick(wrong) }];
    }
    return [{ type: 'pad', idx: right }];
  },
  view(s) {
    const len = s.seq.length;
    const entities: MgEntity[] = [
      { id: 'floor', kind: 'box', x: 0, y: -0.25, z: 0, sx: 16, sy: 0.5, sz: 10, color: '#3b3552' },
      { id: 'wall', kind: 'box', x: 0, y: 3, z: 3.6, sx: 13, sy: 4.4, sz: 0.4, color: '#2a2540' },
    ];
    for (let k = 0; k < 4; k++) {
      const lit = s.lit === k;
      entities.push({
        id: `pad${k}`,
        kind: 'box',
        x: PAD_X[k],
        y: 3,
        z: lit ? 3 : 3.25,
        sx: lit ? 2.7 : 2.4,
        sy: lit ? 2.7 : 2.4,
        sz: 0.3,
        color: lit ? PAD_COLORS[k] : PAD_DARK[k],
        glow: lit,
        label: String(k + 1),
      });
    }
    const champ = s.phase === 'done' ? s.winner : null;
    [0, 1].forEach((i) => {
      const p = s.ps[i];
      const px = i === 0 ? -3.5 : 3.5;
      const decided = s.phase === 'judge' && s.outcome === 'decided';
      let anim: MgEntity['anim'] = 'idle';
      if (champ === i || (decided && s.winner === i)) anim = 'cheer';
      else if (champ === 1 - i || (decided && s.winner === 1 - i)) anim = 'sad';
      else if (s.phase === 'input' && p.failed) anim = 'hit';
      else if (s.phase === 'judge' && s.outcome === 'life' && !p.done) anim = 'hit';
      else if (s.phase === 'input' && p.done) anim = 'cheer';
      else if (s.t - p.lastPress < 0.25) anim = 'jump';
      entities.push({ id: `p${i}`, kind: 'player', player: i, x: px, y: 0, z: -2.2, ry: 0, anim });
      // progress dots above the head (no colors – the opponent must not copy)
      const showDots = s.phase === 'input' || s.phase === 'judge';
      for (let k = 0; k < len; k++) {
        let color = '#d8d2cc';
        let glow = false;
        if (showDots && k < p.pos) color = '#5cc08a';
        if (showDots && p.failed && k === p.pos) color = '#e8464b';
        if (showDots && p.done) {
          color = '#f2c230';
          glow = true;
        }
        entities.push({
          id: `dot${i}_${k}`,
          kind: 'sphere',
          x: px + (k - (len - 1) / 2) * 0.45,
          y: 2.4,
          z: -2.2,
          sx: 0.36,
          sy: 0.36,
          sz: 0.36,
          color,
          glow,
        });
      }
    });
    const hud: MgHud = {
      timer: s.practice ? undefined : Math.max(0, HARD_LIMIT - s.t),
      scores: [0, 1].map((i) => ({ player: i, value: `${'❤️'.repeat(s.ps[i].lives) || '💔'} ${s.phase === 'show' ? 0 : s.ps[i].pos}/${len}` })),
    };
    if (s.phase === 'show') hud.message = { key: 'mg.memoDuell.watch' };
    else if (s.phase === 'input') hud.message = { key: 'mg.memoDuell.go' };
    else if (s.phase === 'judge' || s.phase === 'done') {
      if (s.byTime) hud.message = { key: 'mg.memoDuell.time' };
      else if (s.outcome === 'longer') hud.message = { key: 'mg.memoDuell.longer' };
      else if (s.outcome === 'life') hud.message = { key: 'mg.memoDuell.life' };
      else if (s.outcome === 'retry') hud.message = { key: 'mg.memoDuell.retry' };
      else hud.message = { key: 'mg.memoDuell.decided' };
    }
    return {
      env: 'night',
      camera: { alpha: -Math.PI / 2, beta: 1.25, radius: 15, target: [0, 2.2, 0.5] },
      entities,
      hud,
    };
  },
};
