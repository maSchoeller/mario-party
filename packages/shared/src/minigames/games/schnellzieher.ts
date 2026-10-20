import type { MgEntity, MinigameDef } from '../types';
import { skill } from '../util';
import { BOT_DISPLAY_LAG } from './botLag';

/**
 * #18 Schnellzieher (Duell, Reaktion): wait for "JETZT!", first press wins the round.
 * A press before the signal loses the round. Best of 5 (first to 3 round wins). Press times
 * are measured on the phone with a synchronized clock (NET-05) so network latency doesn't
 * decide. Emergency brake: after MAX_ROUNDS rounds or at TIME_LIMIT the leader wins (a tie
 * in round wins stays a tie).
 */
const GRACE = 0.35; // wait for late-arriving earlier presses
const WINS = 3;
const MAX_ROUNDS = 7;
const TIME_LIMIT = 55;
const PAUSE = 2.2; // after a decided round

export interface SchnellzieherState {
  t: number;
  practice: boolean;
  round: number;
  wins: [number, number];
  /** time of the signal in the current round */
  signalAt: number;
  presses: [number | null, number | null];
  phase: 'wait' | 'signal' | 'resolved' | 'done';
  resolveAt: number;
  roundWinner: number | null;
  falseStart: number | null;
  nextAt: number;
  botPlan: [number | null, number | null];
}

export const schnellzieher: MinigameDef<SchnellzieherState> = {
  id: 'schnellzieher',
  format: 'duel',
  control: 'tap',
  theme: 'any',
  duration: 45,
  setup(_players, rng, opts) {
    return {
      t: 0,
      practice: opts.practice,
      round: 1,
      wins: [0, 0],
      signalAt: 1.5 + rng.range(1.5, 4),
      presses: [null, null],
      phase: 'wait',
      resolveAt: 0,
      roundWinner: null,
      falseStart: null,
      nextAt: 0,
      botPlan: [null, null],
    };
  },
  layout: (s) => ({ kind: 'button', labelKey: s.phase === 'signal' ? 'ctrl.now' : 'ctrl.wait' }),
  input(s, i, input) {
    if (input.type !== 'press' || (s.phase !== 'wait' && s.phase !== 'signal')) return;
    if (s.presses[i] !== null) return;
    const t = Math.min(input.t, s.t);
    s.presses[i] = t;
    if (t < s.signalAt) {
      // false start loses the round immediately
      s.falseStart = i;
      s.roundWinner = 1 - i;
      s.wins[1 - i]++;
      s.phase = 'resolved';
      s.nextAt = s.t + PAUSE;
      return;
    }
    if (s.resolveAt === 0) s.resolveAt = s.t + GRACE;
  },
  tick(s, dt, rng) {
    s.t += dt;
    if (s.phase === 'wait' && s.t >= s.signalAt) s.phase = 'signal';
    if (s.phase === 'signal') {
      const [a, b] = s.presses;
      if (s.resolveAt && (s.t >= s.resolveAt || (a !== null && b !== null))) {
        if (a !== null && (b === null || a <= b)) s.roundWinner = 0;
        else s.roundWinner = 1;
        s.phase = 'resolved';
        s.nextAt = s.t + PAUSE;
      } else if (s.t - s.signalAt > 3) {
        s.roundWinner = null; // nobody pressed
        s.phase = 'resolved';
        s.nextAt = s.t + 1.5;
      }
      if (s.phase === 'resolved' && s.roundWinner !== null) s.wins[s.roundWinner]++;
    }
    if (s.phase === 'resolved' && s.t >= s.nextAt) {
      if (!s.practice && (s.wins[0] >= WINS || s.wins[1] >= WINS || s.round >= MAX_ROUNDS || s.t >= TIME_LIMIT)) {
        s.phase = 'done';
        return;
      }
      if (s.practice && (s.wins[0] >= WINS || s.wins[1] >= WINS)) s.wins = [0, 0];
      s.round++;
      s.presses = [null, null];
      s.falseStart = null;
      s.roundWinner = null;
      s.resolveAt = 0;
      s.botPlan = [null, null];
      s.signalAt = s.t + rng.range(2, 5);
      s.phase = 'wait';
    }
  },
  isOver: (s) => s.phase === 'done',
  result: (s) => (s.wins[0] === s.wins[1] ? [0, 0] : s.wins[0] > s.wins[1] ? [0, 1] : [1, 0]),
  bot(s, i, level, rng) {
    if (s.presses[i] !== null) return [];
    if (s.phase === 'wait') {
      // rare false start for weak bots
      if (level === 'easy' && s.signalAt - s.t < 0.3 && rng.chance(0.004)) return [{ type: 'press', t: s.t }];
      return [];
    }
    if (s.phase !== 'signal') return [];
    if (s.botPlan[i] === null) {
      // reaction plus the display lag a human has on top (TV picture + touch, see botLag.ts):
      // effectively hard ≈ 0.34 s, medium ≈ 0.41 s, easy ≈ 0.52 s
      const base = { easy: 0.42, medium: 0.31, hard: 0.24 }[level] + BOT_DISPLAY_LAG;
      s.botPlan[i] = s.signalAt + base + rng.noise() * 0.05 * (1.2 - skill(level).accuracy);
    }
    if (s.t >= s.botPlan[i]!) return [{ type: 'press', t: s.botPlan[i]! }];
    return [];
  },
  view(s) {
    const signal = s.phase === 'signal';
    const entities: MgEntity[] = [
      { id: 'ground', kind: 'box', x: 0, y: -0.25, z: 0, sx: 16, sy: 0.5, sz: 8, color: '#e7cf9f' },
      { id: 'cactus1', kind: 'cylinder', x: -6, y: 1.2, z: 3, sx: 0.7, sy: 2.4, sz: 0.7, color: '#6fae6a' },
      { id: 'cactus2', kind: 'cylinder', x: 6.5, y: 1, z: 2.5, sx: 0.6, sy: 2, sz: 0.6, color: '#6fae6a' },
      { id: 'flag', kind: 'box', x: 0, y: signal ? 3.2 : 1.6, z: 1.5, sx: 1.2, sy: 0.8, sz: 0.1, color: signal ? '#5cc08a' : '#e8676b', glow: signal },
      { id: 'pole', kind: 'cylinder', x: -0.6, y: 1.6, z: 1.5, sx: 0.1, sy: 3.4, sz: 0.1, color: '#7a5c45' },
    ];
    [0, 1].forEach((i) => {
      const won = s.phase === 'resolved' && s.roundWinner === i;
      const lost = s.phase === 'resolved' && s.roundWinner === 1 - i;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: i === 0 ? -3 : 3,
        y: 0,
        z: 0,
        ry: i === 0 ? -Math.PI / 2 : Math.PI / 2,
        anim: won ? 'cheer' : lost ? 'sad' : s.presses[i] !== null ? 'jump' : 'idle',
      });
    });
    let message: { key: string; params?: Record<string, string | number> } | undefined;
    if (signal) message = { key: 'mg.schnellzieher.now' };
    else if (s.phase === 'resolved' && s.falseStart !== null) message = { key: 'mg.schnellzieher.falseStart' };
    else if (s.phase === 'wait') message = { key: 'mg.schnellzieher.ready' };
    return {
      env: 'sand',
      camera: { alpha: -Math.PI / 2, beta: 1.25, radius: 13, target: [0, 1.2, 0] },
      entities,
      hud: { scores: [0, 1].map((i) => ({ player: i, value: '★'.repeat(s.wins[i]) || '–' })), message },
    };
  },
};
