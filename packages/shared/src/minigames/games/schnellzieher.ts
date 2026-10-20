import type { MgEntity, MinigameDef } from '../types';
import { ageFx, emitFx, skill, viewFx, type FxState } from '../util';
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
const PAUSE = 2.5; // after a decided round
/** decor: duelists' spots on the main street and the signal flag */
const PX = [-3, 3];
const FLAG_Z = 1.6;

export interface SchnellzieherState extends FxState {
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
      fx: [],
      fxN: 0,
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
      emitFx(s, { kind: 'hit', sfx: 'buzz', x: PX[i], y: 2.2, z: 0, color: '#e8464b' });
      emitFx(s, { kind: 'dust', x: PX[i], y: 0.1, z: 0, s: 0.8 });
      return;
    }
    if (s.resolveAt === 0) s.resolveAt = s.t + GRACE;
  },
  tick(s, dt, rng) {
    s.t += dt;
    ageFx(s, dt);
    if (s.phase === 'wait' && s.t >= s.signalAt) {
      s.phase = 'signal';
      // the official signal itself: the flag shoots up with a bell (no hint before it)
      emitFx(s, { kind: 'ring', sfx: 'ding', x: 0, y: 3.4, z: FLAG_Z, color: '#5cc08a', s: 1.3 });
    }
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
      if (s.phase === 'resolved') {
        if (s.roundWinner !== null) {
          // the draw: a cork pops from the winner's pistol, the other one tumbles into the dust
          const w = s.roundWinner;
          const dir = w === 0 ? 1 : -1;
          emitFx(s, { kind: 'smoke', sfx: 'pop', x: PX[w] + dir * 0.9, y: 1.1, z: -0.2, s: 0.5 });
          emitFx(s, { kind: 'sparkle', x: PX[w], y: 2.6, z: 0 }, 0.4);
          emitFx(s, { kind: 'dust', sfx: 'thud', x: PX[1 - w], y: 0.1, z: 0 }, 0.4);
        } else emitFx(s, { kind: 'dust', sfx: 'whoosh', x: 0, y: 0.3, z: 0.5, s: 1.4 }); // nobody drew
      }
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
      s.signalAt = s.t + rng.range(2.5, 5.5);
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
      // dusty main street of a western town, saloon and sheriff's office behind it
      { id: 'street', kind: 'box', x: 0, y: -0.02, z: 0.4, sx: 34, sy: 0.08, sz: 5, color: '#dcb88a', mat: 'sand' },
      // signal flag: at half-mast while waiting, shoots up at "JETZT!"
      { id: 'flag', kind: 'prop', prop: 'flag', x: -0.7, y: signal ? 0 : -1.5, z: FLAG_Z, color: signal ? '#5cc08a' : '#e8676b', sx: 1.1 },
      { id: 'flagBase', kind: 'cylinder', x: -0.7, y: 0.15, z: FLAG_Z, sx: 0.9, sy: 0.3, sz: 0.9, color: '#a89a8a', mat: 'stone', taper: 0.7 },
      ...building('saloon', -6.6, '#b97c48', '#7d4a2c'),
      ...building('sheriff', 6.6, '#9d7a5e', '#5d4636'),
      { id: 'badge', kind: 'cylinder', x: 6.6, y: 4.75, z: 5.25, rx: -Math.PI / 2, sx: 0.8, sy: 0.1, sz: 0.8, color: '#f2c94c', mat: 'gold' },
      // dressing
      { id: 'barrel1', kind: 'prop', prop: 'barrel', x: -4.1, y: 0.24, z: 4.4, sx: 1 },
      { id: 'barrel2', kind: 'prop', prop: 'barrel', x: -3.2, y: 0, z: 4.6, sx: 0.9, ry: 1 },
      { id: 'trough', kind: 'box', x: 2.7, y: 0.35, z: 4.3, sx: 1.8, sy: 0.6, sz: 0.7, color: '#8a5a3c', mat: 'planks' },
      { id: 'troughW', kind: 'box', x: 2.7, y: 0.6, z: 4.3, sx: 1.6, sy: 0.08, sz: 0.5, color: '#6fb6d6' },
      { id: 'hay1', kind: 'prop', prop: 'haybale', x: 9.6, y: 0, z: 2.6, ry: 1.2 },
      { id: 'hay2', kind: 'prop', prop: 'haybale', x: -10.2, y: 0, z: 3.2, ry: 0.3 },
      { id: 'crate1', kind: 'prop', prop: 'crate', x: -9.6, y: 0, z: 1.4, ry: 0.4 },
      { id: 'crate2', kind: 'prop', prop: 'crate', x: -9.5, y: 0.8, z: 1.5, ry: 0.9, sx: 0.85 },
      { id: 'sign', kind: 'prop', prop: 'signpost', x: 1.4, y: 0, z: 3.8, ry: 0.3 },
      { id: 'cactus1', kind: 'prop', prop: 'cactus', x: -11, y: 0, z: 5.4, sx: 1.4 },
      { id: 'cactus2', kind: 'prop', prop: 'cactus', x: 11.2, y: 0, z: 5.8, sx: 1.6, ry: 2 },
      { id: 'cactus3', kind: 'prop', prop: 'cactus', x: 0.6, y: 0, z: 9.5, sx: 1.2, ry: 0.6 },
      { id: 'fence1', kind: 'prop', prop: 'fence', x: -2.4, y: 0, z: 8.4 },
      { id: 'fence2', kind: 'prop', prop: 'fence', x: 2.4, y: 0, z: 8.4, ry: 0.1 },
      { id: 'saloonSign', kind: 'box', x: -6.6, y: 4.55, z: 5.5, sx: 3.4, sy: 0.8, sz: 0.1, color: '#8a2f2a', mat: 'wood' },
      { id: 'saloonSign2', kind: 'box', x: -6.6, y: 4.55, z: 5.44, sx: 2.6, sy: 0.18, sz: 0.06, color: '#f2d28a', mat: 'paper' },
      { id: 'pebbles', kind: 'prop', prop: 'rocksmall', x: 1.4, y: 0, z: -2.6, color: '#d9a080' },
    ];
    // signal beacon on top of the pole (only while "JETZT!")
    if (signal) entities.push({ id: 'beacon', kind: 'sphere', x: -0.7, y: 3.95, z: FLAG_Z, sx: 0.45, sy: 0.45, sz: 0.45, color: '#7dffa8', glow: true });
    [0, 1].forEach((i) => {
      const won = s.phase === 'resolved' && s.roundWinner === i;
      const lost = s.phase === 'resolved' && s.roundWinner === 1 - i;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: PX[i],
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
      scenery: { set: 'desert', clear: { w: 26, d: 12, z: 3 } },
      camera: { alpha: -Math.PI / 2, beta: 1.25, radius: 13.5, target: [0, 1.4, 0.4] },
      entities,
      fx: viewFx(s),
      hud: { scores: [0, 1].map((i) => ({ player: i, value: '★'.repeat(s.wins[i]) || '–' })), message },
    };
  },
};

/** A small western building with a false front, porch and boardwalk (front faces the street). */
function building(id: string, x: number, wall: string, trim: string): MgEntity[] {
  const z = 7.2;
  const front = z - 1.6;
  return [
    { id: `${id}Body`, kind: 'box', x, y: 2, z, sx: 5, sy: 4, sz: 3.2, color: wall, mat: 'planks' },
    { id: `${id}Front`, kind: 'box', x, y: 4.55, z: front + 0.05, sx: 5.4, sy: 1.3, sz: 0.25, color: wall, mat: 'planks' },
    { id: `${id}Cap`, kind: 'box', x, y: 5.25, z: front + 0.05, sx: 5.6, sy: 0.14, sz: 0.4, color: trim, mat: 'wood' },
    { id: `${id}Door`, kind: 'box', x, y: 1.25, z: front - 0.02, sx: 1.2, sy: 2.1, sz: 0.1, color: '#4a3020', mat: 'wood' },
    { id: `${id}WinL`, kind: 'box', x: x - 1.6, y: 1.9, z: front - 0.02, sx: 1, sy: 0.9, sz: 0.1, color: '#3a2c28', mat: 'metal' },
    { id: `${id}WinR`, kind: 'box', x: x + 1.6, y: 1.9, z: front - 0.02, sx: 1, sy: 0.9, sz: 0.1, color: '#3a2c28', mat: 'metal' },
    { id: `${id}Walk`, kind: 'box', x, y: 0.12, z: front - 0.9, sx: 5.6, sy: 0.24, sz: 1.8, color: '#9a6a44', mat: 'planks' },
    { id: `${id}Roof`, kind: 'box', x, y: 2.95, z: front - 0.9, rx: -0.18, sx: 5.6, sy: 0.12, sz: 1.9, color: trim, mat: 'planks' },
    { id: `${id}PostL`, kind: 'cylinder', x: x - 2.6, y: 1.5, z: front - 1.7, sx: 0.18, sy: 2.8, sz: 0.18, color: trim, mat: 'wood' },
    { id: `${id}PostR`, kind: 'cylinder', x: x + 2.6, y: 1.5, z: front - 1.7, sx: 0.18, sy: 2.8, sz: 0.18, color: trim, mat: 'wood' },
  ];
}
