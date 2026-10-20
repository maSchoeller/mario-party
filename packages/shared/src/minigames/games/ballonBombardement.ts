import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, faceAngle, lerp, skill, teamRanks } from '../util';

/**
 * #17 Ballon-Bombardement (1 vs 3, Schütteln vs. Tippen): every trio member pumps up a
 * balloon by shaking the phone (fallback: tapping, which also sends `shake`). A full
 * balloon floats away and counts for the trio. The solo player throws darts at the
 * balloons by tapping one of three colored pads (cooldown) – a popped balloon starts again
 * from zero. Trio wins as soon as they have GOAL balloons together; otherwise solo wins.
 */
const DURATION = 45;
const GOAL = 7;
/** air per shake impulse = BASE + POWER * power */
const PUMP_BASE = 0.016;
const PUMP_POWER = 0.012;
/** ignore shake impulses faster than this (no advantage from sensor spam) */
const PUMP_MIN_GAP = 0.13;
const DART_COOLDOWN = 1.6;
const DART_FLIGHT = 0.5;
/** hit chance of a dart = HIT_BASE + (1 - HIT_BASE) * fill */
const HIT_BASE = 0.3;
const POP_PAUSE = 0.7;
const DONE_PAUSE = 0.6;
const STATION_X = [-5, 0, 5];
const SOLO_Z = -4.5;

interface Balloon {
  fill: number;
  /** 'pump' = can be pumped, 'popped' / 'done' = short pause before a new balloon */
  phase: 'pump' | 'popped' | 'done';
  pause: number;
  /** count of balloons (for stable entity ids of floating balloons) */
  gen: number;
  lastPump: number;
  /** visual wobble after a pump */
  wobble: number;
}

interface Dart {
  id: number;
  /** trio slot 0..2 */
  slot: number;
  eta: number;
}

export interface BallonBombardementState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  solo: number;
  /** trio member player index per slot 0..2 */
  trio: number[];
  balloons: Balloon[];
  darts: Dart[];
  nextId: number;
  cooldown: number;
  done: number;
  pops: number;
  /** floating finished balloons / pop effects for the view */
  fx: { id: number; slot: number; t: number; kind: 'done' | 'pop' | 'miss' }[];
  /** bot memory */
  botAcc: number[];
  botWait: number;
  botPick: number | null;
}

function pump(s: BallonBombardementState, slot: number, power: number): void {
  const b = s.balloons[slot];
  if (b.phase !== 'pump' || s.t - b.lastPump < PUMP_MIN_GAP) return;
  b.lastPump = s.t;
  b.fill += PUMP_BASE + PUMP_POWER * clamp(power, 0, 1);
  b.wobble = 1;
  if (b.fill >= 1) {
    b.fill = 1;
    b.phase = 'done';
    b.pause = DONE_PAUSE;
    s.done++;
    s.fx.push({ id: s.nextId++, slot, t: 1.6, kind: 'done' });
  }
}

export const ballonBombardement: MinigameDef<BallonBombardementState> = {
  id: 'ballonBombardement',
  format: '1v3',
  control: 'motion',
  motion: true,
  theme: 'any',
  duration: DURATION,
  setup(players, _rng, opts) {
    const solo = Math.max(0, players.findIndex((p) => p.team === 0));
    const trio = players.map((_, i) => i).filter((i) => i !== solo);
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      solo,
      trio,
      balloons: trio.map(() => ({ fill: 0, phase: 'pump' as const, pause: 0, gen: 0, lastPump: -1, wobble: 0 })),
      darts: [],
      nextId: 1,
      cooldown: 1,
      done: 0,
      pops: 0,
      fx: [],
      botAcc: players.map(() => 0),
      botWait: 0,
      botPick: null,
    };
  },
  layout(s, i) {
    if (i === s.solo) {
      return {
        kind: 'pads',
        count: 3,
        colors: s.trio.map((k) => PLAYER_COLOR_HEX[s.players[k].color]),
        active: s.cooldown <= 0,
      };
    }
    return { kind: 'shake', labelKey: 'ctrl.pump' };
  },
  input(s, i, input: MgInput) {
    if (i === s.solo) {
      if (input.type !== 'pad' || s.cooldown > 0) return;
      const slot = Math.floor(input.idx);
      if (slot < 0 || slot > 2) return;
      s.darts.push({ id: s.nextId++, slot, eta: DART_FLIGHT });
      s.cooldown = DART_COOLDOWN;
      return;
    }
    if (input.type !== 'shake') return;
    const slot = s.trio.indexOf(i);
    if (slot >= 0) pump(s, slot, Number.isFinite(input.power) ? input.power : 0);
  },
  tick(s, dt, rng: Rng) {
    s.t += dt;
    s.cooldown = Math.max(0, s.cooldown - dt);
    for (const d of s.darts) {
      d.eta -= dt;
      if (d.eta > 0) continue;
      const b = s.balloons[d.slot];
      // only a balloon with some air in it can pop – a finished one already flew away.
      // Big balloons are easier to hit than small ones.
      if (b.phase !== 'pump') continue;
      if (b.fill > 0.04 && rng.chance(HIT_BASE + (1 - HIT_BASE) * b.fill)) {
        b.phase = 'popped';
        b.pause = POP_PAUSE;
        s.pops++;
        s.fx.push({ id: s.nextId++, slot: d.slot, t: 0.6, kind: 'pop' });
      } else {
        s.fx.push({ id: s.nextId++, slot: d.slot, t: 0.6, kind: 'miss' });
      }
    }
    s.darts = s.darts.filter((d) => d.eta > 0);
    for (const b of s.balloons) {
      b.wobble = Math.max(0, b.wobble - dt * 4);
      if (b.phase === 'pump') continue;
      b.pause -= dt;
      if (b.pause <= 0) {
        b.phase = 'pump';
        b.fill = 0;
        b.gen++;
      }
    }
    s.fx = s.fx.filter((f) => (f.t -= dt) > 0);
    if (s.practice && s.done >= GOAL) s.done = 0;
  },
  isOver: (s) => !s.practice && (s.done >= GOAL || s.t >= s.duration),
  result: (s) => teamRanks(s.players, [s.done >= GOAL ? 1 : 0]),
  bot(s, i, level, rng, dt) {
    const sk = skill(level);
    if (i === s.solo) {
      if (s.cooldown > 0) {
        s.botWait = sk.reaction * (0.7 + rng.next() * 0.6);
        s.botPick = null;
        return [];
      }
      // reaction delay after the dart is ready again
      s.botWait -= dt;
      if (s.botWait > 0) return [];
      if (s.botPick === null) {
        // aim for the fullest balloon that will not be finished before the dart lands
        const ranked = [0, 1, 2]
          .filter((k) => s.balloons[k].phase === 'pump' && !s.darts.some((d) => d.slot === k))
          .sort((a, b) => s.balloons[b].fill - s.balloons[a].fill);
        if (!ranked.length) return [];
        const best = s.balloons[ranked[0]].fill;
        // patient bots wait a moment for a juicier target
        const patience = { easy: 0.0, medium: 0.25, hard: 0.4 }[level];
        if (best < patience && s.done < GOAL - 1) return [];
        s.botPick = rng.chance(sk.accuracy) ? ranked[0] : rng.pick([0, 1, 2]);
      }
      return [{ type: 'pad', idx: s.botPick }];
    }
    // trio: shake at a skill dependent rhythm
    const rate = { easy: 5.4, medium: 6, hard: 6.6 }[level] * (0.85 + rng.next() * 0.3);
    s.botAcc[i] += rate * dt;
    const out: MgInput[] = [];
    while (s.botAcc[i] >= 1) {
      s.botAcc[i] -= 1;
      out.push({ type: 'shake', power: clamp({ easy: 0.65, medium: 0.75, hard: 0.85 }[level] + rng.noise() * 0.1, 0.2, 1) });
    }
    return out;
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'ground', kind: 'box', x: 0, y: -0.25, z: 0, sx: 18, sy: 0.5, sz: 13, color: '#9fd47a' },
      { id: 'fence', kind: 'box', x: 0, y: 0.4, z: 4.5, sx: 17, sy: 0.8, sz: 0.3, color: '#c99a6b' },
      { id: 'soloMat', kind: 'cylinder', x: 0, y: 0.02, z: SOLO_Z, sx: 2.6, sy: 0.04, sz: 2.6, color: '#e8676b' },
    ];
    const soloThrow = s.cooldown > DART_COOLDOWN - 0.35;
    entities.push({ id: `p${s.solo}`, kind: 'player', player: s.solo, x: 0, y: 0, z: SOLO_Z, ry: faceAngle(0, 1), anim: soloThrow ? 'jump' : 'idle' });
    // dart in the solo's hand while reloading is done
    if (s.cooldown <= 0) entities.push({ id: 'dartReady', kind: 'cone', x: 0.5, y: 1.9, z: SOLO_Z, sx: 0.25, sy: 0.8, sz: 0.25, color: '#ffd23f', glow: true });
    s.trio.forEach((pi, slot) => {
      const b = s.balloons[slot];
      const x = STATION_X[slot];
      const color = PLAYER_COLOR_HEX[s.players[pi].color];
      entities.push({
        id: `p${pi}`,
        kind: 'player',
        player: pi,
        x,
        y: 0,
        z: 1,
        ry: 0,
        anim: b.phase === 'popped' ? 'sad' : b.phase === 'done' ? 'cheer' : b.wobble > 0.2 ? 'jump' : 'idle',
      });
      entities.push({ id: `pump${slot}`, kind: 'cylinder', x: x + 1.1, y: 0.6 - b.wobble * 0.2, z: 1.4, sx: 0.4, sy: 1.2, sz: 0.4, color: '#5a6170' });
      if (b.phase === 'pump') {
        const size = 0.5 + b.fill * 2.4;
        entities.push({
          id: `bl${slot}-${b.gen}`,
          kind: 'balloon',
          x,
          y: 2.4 + size / 2,
          z: 2.2,
          sx: size * (1 + b.wobble * 0.06),
          sy: size,
          sz: size * (1 + b.wobble * 0.06),
          color,
          glow: b.fill > 0.8,
        });
        entities.push({ id: `fill${slot}`, kind: 'box', x, y: 0.05, z: 3.5, sx: 3 * b.fill + 0.01, sy: 0.1, sz: 0.5, color });
      }
    });
    for (const d of s.darts) {
      const f = 1 - d.eta / DART_FLIGHT;
      const tx = STATION_X[d.slot];
      const fill = s.balloons[d.slot].fill;
      entities.push({
        id: `dart${d.id}`,
        kind: 'cone',
        x: lerp(0.5, tx, f),
        y: lerp(1.9, 2.4 + (0.5 + fill * 2.4) / 2, f) + Math.sin(f * Math.PI) * 1.5,
        z: lerp(SOLO_Z, 2.2, f),
        rx: Math.PI / 2,
        ry: Math.atan2(tx - 0.5, 2.2 - SOLO_Z),
        sx: 0.25,
        sy: 0.8,
        sz: 0.25,
        color: '#ffd23f',
      });
    }
    for (const f of s.fx) {
      const x = STATION_X[f.slot];
      const color = PLAYER_COLOR_HEX[s.players[s.trio[f.slot]].color];
      if (f.kind === 'done') {
        entities.push({ id: `fx${f.id}`, kind: 'balloon', x, y: 4 + (1.6 - f.t) * 5, z: 2.2, sx: 2.9, sy: 2.9, sz: 2.9, color, alpha: Math.min(1, f.t) });
        entities.push({ id: `fxs${f.id}`, kind: 'star', x, y: 6.5 + (1.6 - f.t) * 2, z: 2, sx: 1.2, sy: 1.2, sz: 1.2, color: '#ffd23f', alpha: Math.min(1, f.t) });
      } else if (f.kind === 'miss') {
        entities.push({ id: `fx${f.id}`, kind: 'cone', x: x + 1.8, y: 1 - (0.6 - f.t) * 1.5, z: 2.6, rx: Math.PI / 2, sx: 0.25, sy: 0.8, sz: 0.25, color: '#ffd23f', alpha: f.t * 1.6 });
      } else {
        entities.push({ id: `fx${f.id}`, kind: 'star', x, y: 3.5, z: 2.2, sx: 2.2 - f.t, sy: 2.2 - f.t, sz: 2.2 - f.t, color: '#ff5a3d', alpha: f.t * 1.6 });
      }
    }
    return {
      env: 'sky',
      camera: { alpha: -Math.PI / 2, beta: 1.2, radius: 20, target: [0, 2.4, 0.5] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: [
          { team: 0, labelKey: 'team.solo', value: `🎯 ${s.pops}` },
          { team: 1, labelKey: 'team.trio', value: `🎈 ${s.done}/${GOAL}` },
        ],
        bars: s.trio.map((pi, slot) => ({ player: pi, value: s.balloons[slot].phase === 'pump' ? s.balloons[slot].fill : 0 })),
      },
    };
  },
};
