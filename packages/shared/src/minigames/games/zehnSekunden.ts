import type { MgEntity, MgHud, MgPlayer, MinigameDef } from '../types';
import { ranksFromScores, rowSpawn } from '../util';

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

export interface ZehnSekundenState {
  t: number;
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
  },
  tick(s, dt) {
    s.t += dt;
    if (s.phase === 'intro' && s.t >= s.startAt) {
      s.phase = 'run';
      s.phaseAt = s.startAt;
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
      { id: 'stage', kind: 'box', x: 0, y: -0.25, z: 0, sx: 16, sy: 0.5, sz: 8, color: '#6f5aa8' },
      // clock face (cylinder turned to face the camera)
      { id: 'clock', kind: 'cylinder', x: 0, y: 4.6, z: 3, rx: -Math.PI / 2, sx: 6, sy: 0.4, sz: 6, color: '#fdf6e3', label: reveal ? '10.00' : visible ? elapsed.toFixed(1) : '?' },
      { id: 'rim', kind: 'torus', x: 0, y: 4.6, z: 2.85, rx: -Math.PI / 2, sx: 6.3, sy: 1, sz: 6.3, color: '#f0c04a', glow: true },
      { id: 'hub', kind: 'sphere', x: 0, y: 4.6, z: 2.6, sx: 0.5, sy: 0.5, sz: 0.5, color: '#3b2f4f' },
    ];
    if (visible || reveal) {
      // one turn of the hand = 10 s
      const a = ((reveal ? TARGET : elapsed) / TARGET) * Math.PI * 2;
      entities.push({ id: 'hand', kind: 'box', x: Math.sin(a) * 1.25, y: 4.6 + Math.cos(a) * 1.25, z: 2.65, rz: -a, sx: 0.3, sy: 2.5, sz: 0.15, color: '#3b2f4f' });
    } else {
      // the clock is covered by a magic cloud
      entities.push({ id: 'cloud1', kind: 'sphere', x: -1.2, y: 4.6, z: 2.3, sx: 3.6, sy: 3, sz: 1.5, color: '#b9a6e8', alpha: 0.95 });
      entities.push({ id: 'cloud2', kind: 'sphere', x: 1.3, y: 4.9, z: 2.3, sx: 3.4, sy: 3.2, sz: 1.5, color: '#c9b8f0', alpha: 0.95 });
      entities.push({ id: 'cloud3', kind: 'sphere', x: 0, y: 3.7, z: 2.2, sx: 4, sy: 2.2, sz: 1.5, color: '#a993e0', alpha: 0.95 });
    }
    let best = -1;
    if (reveal) best = s.presses.reduce<number>((b, v, i) => (b < 0 || dev(v ?? MAX_RUN) < dev(s.presses[b] ?? MAX_RUN) ? i : b), -1);
    for (let i = 0; i < s.n; i++) {
      const x = rowSpawn(s.n, 3.2, i);
      const pressed = s.presses[i] !== null;
      const jumping = s.pressedAt[i] !== null && s.t - s.pressedAt[i]! < 0.6;
      entities.push({ id: `p${i}`, kind: 'player', player: i, x, y: 0, z: -1.5, anim: reveal ? (i === best ? 'cheer' : 'idle') : jumping ? 'jump' : 'idle' });
      if (pressed || reveal) {
        entities.push({
          id: `mk${i}`,
          kind: 'sphere',
          x,
          y: 2.6,
          z: -1.5,
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
      camera: { alpha: -Math.PI / 2, beta: 1.2, radius: 17, target: [0, 2.6, 0.5] },
      entities,
      hud,
    };
  },
};
