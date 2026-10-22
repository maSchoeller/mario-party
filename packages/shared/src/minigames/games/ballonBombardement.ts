import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { ageFx, clamp, emitFx, faceAngle, lerp, reactTime, refOf, teamRanks, viewFx, type FxState } from '../util';
import { BOT_LIVE_LAG, SHAKE_MIN_GAP } from './botLag';

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
const PUMP_BASE = 0.018;
const PUMP_POWER = 0.02;
/** full air per stroke needs this much time between two strokes (s) */
const STROKE = 0.2;
/**
 * one shake impulse per SHAKE_MIN_GAP counts (real shaking or tapping alike, no advantage
 * from sensor spam); the host accepts a little less to absorb network jitter
 */
const PUMP_MIN_GAP = SHAKE_MIN_GAP * 0.8;
const DART_COOLDOWN = 1;
const DART_FLIGHT = 0.5;
/** hit chance of a dart = HIT_BASE + HIT_FILL * fill (a full balloon is easier to hit) */
const HIT_BASE = 0.42;
const HIT_FILL = 0.3;
/** trio bots: shake impulses per second and power */
const BOT_PUMP = { easy: { rate: 5.8, power: 0.7 }, medium: { rate: 6.3, power: 0.8 }, hard: { rate: 6.8, power: 0.9 } };
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

export interface BallonBombardementState extends FxState {
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
  floats: { id: number; slot: number; t: number; kind: 'done' | 'pop' | 'miss' }[];
  /** bot memory */
  botAcc: number[];
  botWait: number;
  botPick: number | null;
}

const BALLOON_Z = 2.2;
const balloonSize = (fill: number) => 0.5 + fill * 2.4;
const balloonY = (fill: number) => 2.4 + balloonSize(fill) / 2;
const slotColor = (s: BallonBombardementState, slot: number) => PLAYER_COLOR_HEX[s.players[s.trio[slot]].color];

function pump(s: BallonBombardementState, slot: number, power: number): void {
  const b = s.balloons[slot];
  const gap = s.t - b.lastPump;
  if (b.phase !== 'pump' || gap < PUMP_MIN_GAP) return;
  b.lastPump = s.t;
  const before = b.fill;
  // the pump has to draw air between two strokes: faster than one stroke per STROKE pushes
  // less air each (a child shaking steadily keeps up with frantic adults, v0.5)
  b.fill += (PUMP_BASE + PUMP_POWER * clamp(power, 0, 1)) * Math.min(1, gap / STROKE);
  b.wobble = 1;
  // a puff of air from the pump every quarter of a balloon (silent: pumping is constant)
  if (Math.floor(b.fill * 4) > Math.floor(before * 4) && b.fill < 1) emitFx(s, { kind: 'smoke', x: STATION_X[slot] + 1.1, y: 1.3, z: 1.4, s: 0.35 });
  if (b.fill >= 1) {
    b.fill = 1;
    b.phase = 'done';
    b.pause = DONE_PAUSE;
    s.done++;
    s.floats.push({ id: s.nextId++, slot, t: 1.6, kind: 'done' });
    emitFx(s, { kind: 'sparkle', sfx: 'ding', x: STATION_X[slot], y: balloonY(1), z: BALLOON_Z, color: slotColor(s, slot) }, 0.5);
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
      floats: [],
      fx: [],
      fxN: 0,
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
      emitFx(s, { sfx: 'whoosh', x: 0.5, y: 1.9, z: SOLO_Z });
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
      if (b.fill > 0.04 && rng.chance(HIT_BASE + HIT_FILL * b.fill)) {
        b.phase = 'popped';
        b.pause = POP_PAUSE;
        s.pops++;
        s.floats.push({ id: s.nextId++, slot: d.slot, t: 0.6, kind: 'pop' });
        emitFx(s, { kind: 'pop', sfx: 'pop', x: STATION_X[d.slot], y: balloonY(b.fill), z: BALLOON_Z, color: slotColor(s, d.slot), s: 0.6 + b.fill }, 0.4);
      } else {
        s.floats.push({ id: s.nextId++, slot: d.slot, t: 0.6, kind: 'miss' });
        emitFx(s, { kind: 'dust', sfx: 'thud', x: STATION_X[d.slot] + 1.8, y: 0.1, z: 2.6, s: 0.5 }, 0.4);
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
    s.floats = s.floats.filter((f) => (f.t -= dt) > 0);
    ageFx(s, dt);
    if (s.practice && s.done >= GOAL) s.done = 0;
  },
  isOver: (s) => !s.practice && (s.done >= GOAL || s.t >= s.duration),
  result: (s) => teamRanks(s.players, [s.done >= GOAL ? 1 : 0]),
  bot(s, i, level, rng, dt) {
    const ref = refOf(s.players, i, level);
    const form = s.players[i].form ?? 1;
    if (i === s.solo) {
      if (s.cooldown > 0) {
        // the dart in the hand (TV) / the pads light up again (phone): a simple reaction
        s.botWait = reactTime(ref, rng, BOT_LIVE_LAG);
        s.botPick = null;
        return [];
      }
      s.botWait -= dt;
      if (s.botWait > 0) return [];
      if (s.botPick === null) {
        // throw at once at the biggest balloon (sizes are on the TV); now and then the wrong
        // pad – balloon colour → pad colour under time pressure is where the solo's skill shows
        const ranked = [0, 1, 2]
          .filter((k) => s.balloons[k].phase === 'pump' && !s.darts.some((d) => d.slot === k))
          .sort((a, b) => s.balloons[b].fill - s.balloons[a].fill);
        if (!ranked.length) return [];
        s.botPick = rng.chance(ref.choiceError * 3) ? rng.pick([0, 1, 2]) : ranked[0];
      }
      return [{ type: 'pad', idx: s.botPick }];
    }
    // trio: shake at a skill dependent rhythm, never faster than one impulse per SHAKE_MIN_GAP
    const cfg = BOT_PUMP[level];
    const rate = cfg.rate * form * (0.85 + rng.next() * 0.3);
    s.botAcc[i] += dt;
    if (s.botAcc[i] < Math.max(SHAKE_MIN_GAP, 1 / rate)) return [];
    s.botAcc[i] = 0;
    return [{ type: 'shake', power: clamp(cfg.power * form + rng.noise() * 0.08, 0.2, 1) }];
  },
  view(s) {
    const entities: MgEntity[] = [
      // fairground on the meadow: a wooden fence, bunting, hay bales and the solo's throwing stage
      { id: 'soloMat', kind: 'cylinder', x: 0, y: 0.03, z: SOLO_Z, sx: 2.6, sy: 0.06, sz: 2.6, color: '#e8676b', mat: 'planks' },
      // two garlands, posts at x ±3 of each: the inner posts stand apart, not inside each other
      { id: 'bunting1', kind: 'prop', prop: 'bunting', x: -3.4, y: 0, z: 5 },
      { id: 'bunting2', kind: 'prop', prop: 'bunting', x: 3.4, y: 0, z: 5 },
      { id: 'hay1', kind: 'prop', prop: 'haybale', x: -8.2, y: 0, z: 2.4, ry: 0.3 },
      { id: 'hay2', kind: 'prop', prop: 'haybale', x: -8.1, y: 0, z: 0.9, ry: -0.2 },
      { id: 'hay3', kind: 'prop', prop: 'haybale', x: 8.3, y: 0, z: 1.6, ry: 1.7 },
      { id: 'crate', kind: 'prop', prop: 'crate', x: -2.2, y: 0, z: SOLO_Z - 0.6, ry: 0.4 },
      { id: 'barrel', kind: 'prop', prop: 'barrel', x: 2.1, y: 0, z: SOLO_Z - 0.4 },
      { id: 'stall', kind: 'prop', prop: 'marketstall', x: -11.5, y: 0, z: 7, ry: 0.5 },
      { id: 'flow1', kind: 'prop', prop: 'flowers', x: -6.5, y: 0, z: -5.8 },
      { id: 'flow2', kind: 'prop', prop: 'flowers', x: 6.2, y: 0, z: -5.6, ry: 2 },
      { id: 'flow3', kind: 'prop', prop: 'flowers', x: -4.6, y: 0, z: 3.4, ry: 1 },
      { id: 'flow4', kind: 'prop', prop: 'flowers', x: 7.6, y: 0, z: 3.6, ry: 3 },
      { id: 'bushL', kind: 'prop', prop: 'bushround', x: -8.6, y: 0, z: -4.6, sx: 0.9 },
      { id: 'bushR', kind: 'prop', prop: 'bushround', x: 8.5, y: 0, z: -3.6, sx: 0.8 },
    ];
    for (let k = 0; k < 8; k++) entities.push({ id: `fence${k}`, kind: 'prop', prop: 'fence', x: -7 + k * 2, y: 0, z: 4.5 });
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
      entities.push({ id: `pumpBase${slot}`, kind: 'box', x: x + 1.1, y: 0.06, z: 1.4, sx: 0.9, sy: 0.12, sz: 0.5, color: '#8a5a3c', mat: 'wood' });
      entities.push({ id: `pump${slot}`, kind: 'cylinder', x: x + 1.1, y: 0.6, z: 1.4, sx: 0.4, sy: 1.0, sz: 0.4, color: '#c9534f', mat: 'metal' });
      entities.push({ id: `pumpRod${slot}`, kind: 'cylinder', x: x + 1.1, y: 1.3 - b.wobble * 0.25, z: 1.4, sx: 0.08, sy: 0.5, sz: 0.08, color: '#9aa0aa', mat: 'metal' });
      entities.push({ id: `pumpGrip${slot}`, kind: 'box', x: x + 1.1, y: 1.55 - b.wobble * 0.25, z: 1.4, sx: 0.7, sy: 0.09, sz: 0.12, color: '#3d3a4a' });
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
    for (const f of s.floats) {
      const x = STATION_X[f.slot];
      const color = PLAYER_COLOR_HEX[s.players[s.trio[f.slot]].color];
      if (f.kind === 'done') {
        entities.push({ id: `fl${f.id}`, kind: 'balloon', x, y: 4 + (1.6 - f.t) * 5, z: 2.2, sx: 2.9, sy: 2.9, sz: 2.9, color, alpha: Math.min(0.95, f.t) });
        entities.push({ id: `fls${f.id}`, kind: 'star', x, y: 6.5 + (1.6 - f.t) * 2, z: 2, sx: 1.2, sy: 1.2, sz: 1.2, color: '#ffd23f', alpha: Math.min(0.95, f.t) });
      } else if (f.kind === 'miss') {
        entities.push({ id: `fl${f.id}`, kind: 'cone', x: x + 1.8, y: 1 - (0.6 - f.t) * 1.5, z: 2.6, rx: Math.PI / 2, sx: 0.25, sy: 0.8, sz: 0.25, color: '#ffd23f', alpha: f.t * 1.6 });
      } else {
        entities.push({ id: `fl${f.id}`, kind: 'star', x, y: 3.5, z: 2.2, sx: 2.2 - f.t, sy: 2.2 - f.t, sz: 2.2 - f.t, color: '#ff5a3d', alpha: f.t * 1.6 });
      }
    }
    return {
      env: 'sky',
      scenery: { set: 'meadow', clear: { x: 0, z: 0, w: 22, d: 16 } },
      fx: viewFx(s),
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
