import { PLAYER_COLOR_HEX } from '../../config';
import type { MgEntity, MgHud, MgPlayer, MinigameDef } from '../types';
import { ageFx, emitFx, ranksFromScores, rowSpawn, viewFx, type FxState } from '../util';

/**
 * #5 Zehn-Sekunden-Zauber (FFA, Timing): a clock starts and is visible for the first 3 s,
 * then it disappears. Everybody presses once when they think exactly 10.00 s have passed.
 * 2 rounds, the sum of the deviations counts (smaller is better). Press times are taken
 * from the phone timestamp (`press.t`, NET-05), so network latency doesn't matter.
 */
const TARGET = 10;
const SHOW = 3; // clock visible for the first seconds
const MAX_RUN = 15; // no press until then = counted as 15 s
const GRACE = 0.4; // wait for late messages before the timeout
const INTRO = 2.5;
const REVEAL = 4;
const ROUNDS = 2;
/** decor: clock center, player row, pedestal height */
const CLOCK_Y = 4.5;
const CLOCK_Z = 3;
const ROW_Z = -1.5;
const PED = 0.3;

export interface ZehnSekundenState extends FxState {
  t: number;
  /** player colors (decor only) */
  colors: string[];
  practice: boolean;
  n: number;
  round: number;
  phase: 'intro' | 'run' | 'reveal' | 'done';
  phaseAt: number;
  /** minigame time at which the clock started */
  startAt: number;
  /** measured seconds per player in this round (null = not pressed yet) */
  presses: (number | null)[];
  /** time of arrival per player (for the TV jump animation) */
  pressedAt: (number | null)[];
  /** sum of deviations from 10.00 s per player */
  total: number[];
  botPlan: (number | null)[];
}

const dev = (v: number) => Math.abs(v - TARGET);

function startRound(s: ZehnSekundenState): void {
  s.phase = 'intro';
  s.phaseAt = s.t;
  s.startAt = s.t + INTRO;
  s.presses = s.presses.map(() => null);
  s.pressedAt = s.pressedAt.map(() => null);
  s.botPlan = s.botPlan.map(() => null);
}

function finishRun(s: ZehnSekundenState): void {
  s.presses = s.presses.map((v) => (v === null ? MAX_RUN : v));
  s.presses.forEach((v, i) => (s.total[i] += dev(v!)));
  s.phase = 'reveal';
  s.phaseAt = s.t;
  // the magic cloud clears; the closest guess gets coins, everybody within 0.3 s a sparkle
  emitFx(s, { kind: 'smoke', sfx: 'magic', x: 0, y: CLOCK_Y, z: CLOCK_Z - 0.8, color: '#c9b8f0', s: 1.6 }, 0.5);
  let best = 0;
  s.presses.forEach((v, i) => {
    if (dev(v!) < dev(s.presses[best]!)) best = i;
  });
  s.presses.forEach((v, i) => {
    const x = rowSpawn(s.n, 3.2, i);
    if (i === best) emitFx(s, { kind: 'coins', sfx: 'cheer', x, y: 2.9 + PED, z: ROW_Z }, 0.5);
    else if (dev(v!) < 0.3) emitFx(s, { kind: 'sparkle', x, y: 2.9 + PED, z: ROW_Z }, 0.5);
  });
}

export const zehnSekunden: MinigameDef<ZehnSekundenState> = {
  id: 'zehnSekunden',
  format: 'ffa',
  control: 'tap',
  theme: 'any',
  duration: 40,
  setup(players: MgPlayer[], _rng, opts) {
    const n = players.length;
    return {
      t: 0,
      colors: players.map((p) => PLAYER_COLOR_HEX[p.color] ?? '#d9d6ea'),
      fx: [],
      fxN: 0,
      practice: opts.practice,
      n,
      round: 1,
      phase: 'intro',
      phaseAt: 0,
      startAt: INTRO,
      presses: Array(n).fill(null),
      pressedAt: Array(n).fill(null),
      total: Array(n).fill(0),
      botPlan: Array(n).fill(null),
    };
  },
  layout(s, i) {
    if (s.phase === 'run' && s.presses[i] === null) return { kind: 'button', labelKey: 'ctrl.press' };
    if (s.phase === 'run') return { kind: 'wait', labelKey: 'mg.zehnSekunden.pressed' };
    if (s.phase === 'intro') return { kind: 'button', labelKey: 'ctrl.wait' };
    return { kind: 'wait', labelKey: 'ctrl.watch' };
  },
  input(s, i, input) {
    if (input.type !== 'press' || s.phase !== 'run' || s.presses[i] !== null) return;
    const t = Number.isFinite(input.t) ? Math.min(input.t, s.t) : s.t;
    s.presses[i] = Math.max(0, Math.min(MAX_RUN, t - s.startAt));
    s.pressedAt[i] = s.t;
    // the marker above the head is already shown to everybody – the sound just goes with it
    emitFx(s, { kind: 'pop', sfx: 'click', x: rowSpawn(s.n, 3.2, i), y: 2.6 + PED, z: ROW_Z, s: 0.6 });
  },
  tick(s, dt) {
    s.t += dt;
    ageFx(s, dt);
    if (s.phase === 'intro' && s.t >= s.startAt) {
      s.phase = 'run';
      s.phaseAt = s.startAt;
      emitFx(s, { kind: 'ring', sfx: 'ding', x: 0, y: CLOCK_Y, z: CLOCK_Z - 0.6, color: '#f0c04a', s: 1.6 });
    }
    // the clock vanishes in a magic cloud (fixed 3 s after the start – no hint about 10 s)
    if (s.phase === 'run' && s.t - s.startAt >= SHOW && s.t - dt - s.startAt < SHOW) {
      emitFx(s, { kind: 'smoke', sfx: 'whoosh', x: 0, y: CLOCK_Y, z: CLOCK_Z - 0.9, color: '#b9a6e8', s: 1.6 }, 0.5);
    }
    if (s.phase === 'run') {
      if (s.presses.every((v) => v !== null) || s.t >= s.startAt + MAX_RUN + GRACE) finishRun(s);
      return;
    }
    if (s.phase === 'reveal' && s.t >= s.phaseAt + REVEAL) {
      if (s.round >= ROUNDS) {
        if (!s.practice) {
          s.phase = 'done';
          return;
        }
        s.round = 0;
        s.total = s.total.map(() => 0);
      }
      s.round++;
      startRound(s);
    }
  },
  isOver: (s) => s.phase === 'done',
  result: (s) => ranksFromScores(s.total.map((v) => Math.round(v * 1000)), false),
  bot(s, i, level, rng) {
    if (s.phase !== 'run' || s.presses[i] !== null) return [];
    if (s.botPlan[i] === null) {
      const sigma = { easy: 0.85, medium: 0.45, hard: 0.18 }[level];
      s.botPlan[i] = s.startAt + TARGET + rng.noise() * sigma;
    }
    if (s.t >= s.botPlan[i]!) return [{ type: 'press', t: s.botPlan[i]! }];
    return [];
  },
  view(s) {
    const run = s.phase === 'run';
    const elapsed = run ? s.t - s.startAt : 0;
    const visible = s.phase === 'intro' || (run && elapsed < SHOW);
    const reveal = s.phase === 'reveal' || s.phase === 'done';
    const entities: MgEntity[] = [
      // magic show stage: wooden stage, the big clock on a column in front of the curtain
      { id: 'stage', kind: 'box', x: 0, y: -0.15, z: 0, sx: 16, sy: 0.3, sz: 8, color: '#6f5aa8', mat: 'planks' },
      { id: 'rug', kind: 'cylinder', x: 0, y: 0.02, z: CLOCK_Z - 1.2, sx: 5, sy: 0.04, sz: 2.4, color: '#3b2f6f', mat: 'cloth' },
      { id: 'column', kind: 'cylinder', x: 0, y: 0.95, z: CLOCK_Z + 0.25, sx: 0.9, sy: 1.7, sz: 0.9, color: '#3b2f4f', mat: 'metal', taper: 0.75 },
      { id: 'foot', kind: 'cylinder', x: 0, y: 0.18, z: CLOCK_Z + 0.25, sx: 2.4, sy: 0.36, sz: 2.4, color: '#f0c04a', mat: 'gold', taper: 0.7 },
      { id: 'back', kind: 'cylinder', x: 0, y: CLOCK_Y, z: CLOCK_Z + 0.3, rx: -Math.PI / 2, sx: 6.9, sy: 0.3, sz: 6.9, color: '#3b2f4f', mat: 'metal' },
      // clock face (cylinder turned to face the camera)
      { id: 'clock', kind: 'cylinder', x: 0, y: CLOCK_Y, z: CLOCK_Z, rx: -Math.PI / 2, sx: 6, sy: 0.4, sz: 6, color: '#fdf6e3', mat: 'paper' },
      // the read-out floats in front of the upper half of the face (a label on the face itself would be hidden inside it)
      { id: 'readout', kind: 'sphere', x: 0, y: CLOCK_Y + 0.3, z: CLOCK_Z - 2.5, sx: 0.02, sy: 0.02, sz: 0.02, color: '#3b2f4f', label: reveal ? '10.00' : visible ? elapsed.toFixed(1) : '?' },
      { id: 'rim', kind: 'torus', x: 0, y: CLOCK_Y, z: CLOCK_Z - 0.15, rx: -Math.PI / 2, sx: 6.3, sy: 1, sz: 6.3, color: '#f0c04a' },
      { id: 'hub', kind: 'sphere', x: 0, y: CLOCK_Y, z: CLOCK_Z - 0.4, sx: 0.5, sy: 0.5, sz: 0.5, color: '#3b2f4f', mat: 'metal' },
      // stage lights, a magician's hat and an hourglass at the sides
      { id: 'spotL', kind: 'prop', prop: 'stagelight', x: -7.4, y: 0, z: -3, ry: 2.5, sx: 1.2 },
      { id: 'spotR', kind: 'prop', prop: 'stagelight', x: 7.4, y: 0, z: -3, ry: -2.5, sx: 1.2 },
      { id: 'tableL', kind: 'cylinder', x: -7.3, y: 0.5, z: 1.2, sx: 1.2, sy: 1, sz: 1.2, color: '#b8324a', mat: 'cloth', taper: 0.8 },
      { id: 'hatL', kind: 'cylinder', x: -7.3, y: 1.38, z: 1.2, sx: 0.7, sy: 0.7, sz: 0.7, color: '#25213a', mat: 'cloth' },
      { id: 'brimL', kind: 'cylinder', x: -7.3, y: 1.04, z: 1.2, sx: 1.1, sy: 0.06, sz: 1.1, color: '#25213a', mat: 'cloth' },
      { id: 'tableR', kind: 'cylinder', x: 7.3, y: 0.5, z: 1.2, sx: 1.2, sy: 1, sz: 1.2, color: '#b8324a', mat: 'cloth', taper: 0.8 },
      { id: 'glassB', kind: 'cone', x: 7.3, y: 1.0, z: 1.2, sx: 0.8, sy: 0.55, sz: 0.8, color: '#f0c04a', mat: 'sand' },
      { id: 'glassT', kind: 'cone', x: 7.3, y: 2.1, z: 1.2, rx: Math.PI, sx: 0.8, sy: 0.55, sz: 0.8, color: '#f0c04a', mat: 'sand' },
      { id: 'glassCap', kind: 'cylinder', x: 7.3, y: 2.14, z: 1.2, sx: 0.95, sy: 0.08, sz: 0.95, color: '#7a5c45', mat: 'wood' },
    ];
    // ten tick marks: one turn of the hand = 10 s, the gold one is "10.00"
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      entities.push({
        id: `tick${k}`,
        kind: 'box',
        x: Math.sin(a) * 2.5,
        y: CLOCK_Y + Math.cos(a) * 2.5,
        z: CLOCK_Z - 0.24,
        rz: -a,
        sx: k === 0 ? 0.22 : 0.13,
        sy: k === 0 ? 0.6 : 0.42,
        sz: 0.06,
        color: k === 0 ? '#e0a020' : '#3b2f4f',
      });
    }
    // marquee bulbs around the rim (static decoration)
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      entities.push({ id: `bulb${k}`, kind: 'sphere', x: Math.sin(a) * 3.2, y: CLOCK_Y + Math.cos(a) * 3.2, z: CLOCK_Z - 0.32, sx: 0.26, sy: 0.26, sz: 0.26, color: '#ffe6a0', glow: true });
    }
    if (visible || reveal) {
      // one turn of the hand = 10 s
      const a = ((reveal ? TARGET : elapsed) / TARGET) * Math.PI * 2;
      entities.push({ id: 'hand', kind: 'box', x: Math.sin(a) * 1.25, y: CLOCK_Y + Math.cos(a) * 1.25, z: CLOCK_Z - 0.35, rz: -a, sx: 0.3, sy: 2.5, sz: 0.15, color: '#3b2f4f' });
    } else {
      // the clock is covered by a magic cloud
      const puffs: [number, number, number, number, string][] = [
        [-1.4, 0.2, 3.4, 3, '#6c56c0'],
        [1.4, 0.4, 3.4, 3.2, '#7660c8'],
        [0, -1.2, 4.2, 2.4, '#5f4bb0'],
        [0, 1.4, 3.6, 2.6, '#8069d0'],
        [-2.3, -0.9, 2.2, 2, '#644fb8'],
        [2.3, -0.9, 2.2, 2, '#705ac4'],
      ];
      puffs.forEach(([x, y, w, h, c], k) =>
        entities.push({ id: `cloud${k}`, kind: 'sphere', x, y: CLOCK_Y + y + Math.sin(s.t * 1.3 + k) * 0.08, z: CLOCK_Z - 0.9 - (k % 2) * 0.2, sx: w, sy: h, sz: 1.6, color: c, glow: true }),
      );
    }
    let best = -1;
    if (reveal) best = s.presses.reduce<number>((b, v, i) => (b < 0 || dev(v ?? MAX_RUN) < dev(s.presses[b] ?? MAX_RUN) ? i : b), -1);
    for (let i = 0; i < s.n; i++) {
      const x = rowSpawn(s.n, 3.2, i);
      const pressed = s.presses[i] !== null;
      const jumping = s.pressedAt[i] !== null && s.t - s.pressedAt[i]! < 0.6;
      entities.push({ id: `ped${i}`, kind: 'cylinder', x, y: PED / 2, z: ROW_Z, sx: 1.9, sy: PED, sz: 1.9, color: '#3b3560', mat: 'metal', taper: 0.92 });
      entities.push({ id: `ring${i}`, kind: 'torus', x, y: PED + 0.01, z: ROW_Z, sx: 1.7, sy: 0.5, sz: 1.7, color: s.colors[i], glow: true });
      entities.push({ id: `p${i}`, kind: 'player', player: i, x, y: PED, z: ROW_Z, anim: reveal ? (i === best ? 'cheer' : 'idle') : jumping ? 'jump' : 'idle' });
      if (pressed || reveal) {
        entities.push({
          id: `mk${i}`,
          kind: 'sphere',
          x,
          y: 2.6 + PED,
          z: ROW_Z,
          sx: 0.5,
          sy: 0.5,
          sz: 0.5,
          color: reveal ? (dev(s.presses[i] ?? MAX_RUN) < 0.3 ? '#5cc08a' : '#f0c04a') : '#ffffff',
          glow: true,
          label: reveal ? (s.presses[i] ?? MAX_RUN).toFixed(2) : undefined,
        });
      }
    }
    const hud: MgHud = {};
    if (reveal) hud.scores = s.presses.map((v, i) => ({ player: i, value: `${(v ?? MAX_RUN).toFixed(2)} s (±${s.total[i].toFixed(2)})` }));
    else if (run) hud.scores = s.presses.map((v, i) => ({ player: i, value: v !== null ? '✔' : '…' }));
    else hud.scores = s.total.map((v, i) => ({ player: i, value: `±${v.toFixed(2)}` }));
    if (s.phase === 'intro') hud.message = { key: 'mg.zehnSekunden.round', params: { round: s.round, total: ROUNDS } };
    else if (run && elapsed < SHOW) hud.message = { key: 'mg.zehnSekunden.watch' };
    else if (run) hud.message = { key: 'mg.zehnSekunden.count' };
    else if (reveal) hud.message = { key: 'mg.zehnSekunden.reveal' };
    return {
      env: 'night',
      scenery: { set: 'studio', clear: { w: 16, d: 8, z: 0.5 } },
      camera: { alpha: -Math.PI / 2, beta: 1.2, radius: 17.5, target: [0, 2.6, 0.5] },
      entities,
      fx: viewFx(s),
      hud,
    };
  },
};
