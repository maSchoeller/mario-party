import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { TEAM_COLORS, ageFx, clamp, emitFx, faceAngle, teamRanks, viewFx, type FxState } from '../util';

/**
 * #13 Schatz-Tauziehen (2v2, Schütteln): tug of war over a treasure chest. Every shake
 * impulse adds pulling power; the summed power of both team members moves the rope.
 * Pull the chest over your mark to win – otherwise the side with the advantage wins at the
 * end. The phone's fallback control (tapping) also sends `shake` inputs, so nothing here
 * relies on a gyroscope. Power per player is capped, so frantic tapping can't break it.
 */
const DURATION = 40;
const WIN = 4.5;
const GAIN = 0.55; // energy per full-power shake
const DECAY = 2.2;
const E_MAX = 2.6; // cap per player
const PULL = 0.25; // rope speed per energy difference
const WAVE_EVERY = 9;
const WAVE_LEN = 2.5;

export interface SchatzTauziehenState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  /** team on the left (pulls to −x) and on the right (pulls to +x) */
  sides: [number, number];
  rope: number;
  v: number;
  energy: number[];
  shakeVis: number[];
  /** "power wave": shakes count double for a moment (both teams) */
  waveAt: number;
  winner: number | null;
  overAt: number | null;
  wins: number[];
  botAcc: number[];
  botBurst: number[];
}

const sideOf = (s: SchatzTauziehenState, i: number) => (s.players[i].team === s.sides[0] ? 0 : 1);
const inWave = (s: SchatzTauziehenState) => s.t >= s.waveAt && s.t < s.waveAt + WAVE_LEN;

export const schatzTauziehen: MinigameDef<SchatzTauziehenState> = {
  id: 'schatzTauziehen',
  format: '2v2',
  control: 'motion',
  motion: true,
  theme: 'island',
  duration: DURATION,
  setup(players, rng, opts) {
    const teams = [...new Set(players.map((p) => p.team))].sort();
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      sides: [teams[0], teams[1] ?? teams[0] + 1],
      rope: 0,
      v: 0,
      energy: players.map(() => 0),
      shakeVis: players.map(() => 0),
      waveAt: WAVE_EVERY + rng.range(-1.5, 1.5),
      winner: null,
      overAt: null,
      wins: [0, 0],
      botAcc: players.map(() => 0),
      botBurst: players.map(() => 1),
      fx: [],
      fxN: 0,
    };
  },
  layout: (): ControllerLayout => ({ kind: 'shake', labelKey: 'ctrl.shake' }),
  input(s, i, input: MgInput) {
    if (input.type !== 'shake' || s.winner !== null) return;
    const power = clamp(Number.isFinite(input.power) ? input.power : 0, 0, 1);
    s.energy[i] = Math.min(E_MAX, s.energy[i] + power * GAIN * (inWave(s) ? 2 : 1));
    s.shakeVis[i] = 0.25;
  },
  tick(s, dt, rng) {
    const wasWave = inWave(s);
    const prevT = s.t;
    const prevRope = s.rope;
    s.t += dt;
    ageFx(s, dt);
    const decay = Math.exp(-DECAY * dt);
    s.energy = s.energy.map((e) => e * decay);
    s.shakeVis = s.shakeVis.map((v) => Math.max(0, v - dt));
    if (s.t >= s.waveAt + WAVE_LEN) s.waveAt = s.t + WAVE_EVERY + rng.range(-2, 2);
    if (s.winner !== null) return;
    // power wave starts: the chest sparkles
    if (!wasWave && inWave(s)) emitFx(s, { kind: 'sparkle', sfx: 'magic', x: s.rope, y: 1.6, z: 0, color: '#f2c14e', s: 1.4 }, 0.5);
    // strong pullers kick up sand now and then (twice a second at most, silent)
    if (Math.floor(s.t * 2) !== Math.floor(prevT * 2)) {
      const k = [0, 0];
      s.players.forEach((_, i) => {
        const side = sideOf(s, i);
        const n = k[side]++;
        if (s.energy[i] > 1.4) emitFx(s, { kind: 'dust', x: s.rope + (side === 0 ? -1 : 1) * (3 + n * 1.8), y: 0.1, z: n % 2 ? 0.35 : -0.35, s: 0.55 });
      });
    }
    // the rope creaks under heavy load
    if (Math.abs(s.v) > 0.3 && Math.floor(s.t / 1.6) !== Math.floor(prevT / 1.6)) emitFx(s, { sfx: 'creak', x: s.rope, y: 1, z: 0 });
    let left = 0;
    let right = 0;
    s.energy.forEach((e, i) => (sideOf(s, i) === 0 ? (left += e) : (right += e)));
    const target = (right - left) * PULL;
    s.v += (target - s.v) * clamp(dt * 4, 0, 1);
    s.rope += s.v * dt;
    // the chest slides past the halfway point towards a mark
    if (Math.abs(s.rope) >= WIN / 2 && Math.abs(prevRope) < WIN / 2) emitFx(s, { kind: 'dust', sfx: 'slide', x: s.rope, y: 0.15, z: 0, s: 1.1 });
    if (Math.abs(s.rope) >= WIN) {
      const side = s.rope > 0 ? 1 : 0;
      const x = Math.sign(s.rope) * WIN;
      emitFx(s, { kind: 'coins', sfx: 'coin', x, y: 1.6, z: 0, s: 1.3 }, 0.5);
      emitFx(s, { kind: 'dust', sfx: 'thud', x, y: 0.15, z: 0, s: 1.4 }, 0.5);
      if (s.practice) {
        s.wins[side]++;
        s.rope = 0;
        s.v = 0;
      } else {
        s.rope = Math.sign(s.rope) * WIN;
        s.winner = s.sides[side];
        s.overAt = s.t + 1.2;
      }
    } else if (!s.practice && s.t >= s.duration) {
      s.winner = Math.abs(s.rope) < 0.01 ? -1 : s.sides[s.rope > 0 ? 1 : 0];
      s.overAt = s.t;
    }
  },
  isOver: (s) => !s.practice && s.overAt !== null && s.t >= s.overAt,
  result(s) {
    if (s.winner === null || s.winner < 0) {
      if (s.winner === null && Math.abs(s.rope) >= 0.01) return teamRanks(s.players, [s.sides[s.rope > 0 ? 1 : 0]]);
      return s.players.map(() => 0);
    }
    return teamRanks(s.players, [s.winner]);
  },
  bot(s, i, level: BotLevel, rng: Rng, dt) {
    if (s.winner !== null) return [];
    const cfg = { easy: { rate: 3.6, pmin: 0.4, pmax: 0.75 }, medium: { rate: 4.8, pmin: 0.55, pmax: 0.9 }, hard: { rate: 6, pmin: 0.7, pmax: 1 } }[level];
    // bursts: bots shake in waves like people do, a bit harder during a power wave
    if (rng.chance(dt * 0.8)) s.botBurst[i] = 0.7 + rng.next() * 0.6;
    const boost = inWave(s) ? 1.2 : 1;
    s.botAcc[i] += cfg.rate * s.botBurst[i] * boost * dt;
    const out: MgInput[] = [];
    while (s.botAcc[i] >= 1) {
      s.botAcc[i] -= 1;
      out.push({ type: 'shake', power: rng.range(cfg.pmin, cfg.pmax) });
    }
    return out;
  },
  view(s) {
    const r = s.rope;
    const wave = inWave(s) && s.winner === null;
    const entities: MgEntity[] = [
      // plank-framed water pit in the middle of the beach
      { id: 'pitSand', kind: 'cylinder', x: 0, y: -0.1, z: 0, sx: 4.4, sy: 0.3, sz: 6.2, color: '#d9bf8a', mat: 'sand', taper: 0.94 },
      { id: 'pitBed', kind: 'plane', x: 0, y: 0.11, z: 0, sx: 2.62, sz: 4.62, color: '#3aa6cc' },
      { id: 'pit', kind: 'water', x: 0, y: 0.15, z: 0, sx: 2.6, sz: 4.6, color: '#3fb5da' },
      { id: 'pitL', kind: 'box', x: -1.42, y: 0.14, z: 0, sx: 0.24, sy: 0.24, sz: 5.08, color: '#a8743f', mat: 'wood' },
      { id: 'pitR', kind: 'box', x: 1.42, y: 0.14, z: 0, sx: 0.24, sy: 0.24, sz: 5.08, color: '#a8743f', mat: 'wood' },
      { id: 'pitF', kind: 'box', x: 0, y: 0.14, z: -2.42, sx: 2.6, sy: 0.24, sz: 0.24, color: '#b98350', mat: 'wood' },
      { id: 'pitB', kind: 'box', x: 0, y: 0.14, z: 2.42, sx: 2.6, sy: 0.24, sz: 0.24, color: '#b98350', mat: 'wood' },
      { id: 'center', kind: 'box', x: 0, y: 0.03, z: 3.1, sx: 0.25, sy: 0.1, sz: 1, color: '#ffffff' },
      { id: 'rope', kind: 'cylinder', x: r, y: 1, z: 0, rz: Math.PI / 2, sx: 0.16, sy: 17, sz: 0.16, color: '#d8b77a', mat: 'rope' },
      { id: 'chest', kind: 'prop', prop: 'chest', x: r, y: 0, z: 0, sx: 1.35 },
      { id: 'gem', kind: 'coin', x: r, y: 2.25, z: 0, sx: 0.7, sy: 0.7, sz: 0.7 },
      // glowing ring around the chest during a power wave
      { id: 'waveRing', kind: 'torus', x: r, y: wave ? 0.08 : -4, z: 0, sx: 2.6, sy: 1, sz: 2.6, color: '#f2c14e', glow: true },
      // dressing: palms, festival bunting, a crab, beach gear
      { id: 'palm1', kind: 'palm', x: -11, y: 0, z: 6 },
      { id: 'palm2', kind: 'palm', x: 11, y: 0, z: 6.5, ry: 2.2 },
      { id: 'bunting', kind: 'prop', prop: 'bunting', x: 0, y: 0, z: 6.2, sx: 1.25 },
      { id: 'crab', kind: 'prop', prop: 'crab', x: 7.2, y: 0, z: 4.4, ry: 0.6, sx: 0.45 },
      { id: 'barrel1', kind: 'prop', prop: 'barrel', x: -8.6, y: 0, z: 4.6, ry: 0.4 },
      { id: 'barrel2', kind: 'prop', prop: 'barrel', x: -7.7, y: 0, z: 5.2, ry: 1.3, sx: 0.9 },
      { id: 'crate', kind: 'prop', prop: 'crate', x: -9.5, y: 0, z: 5.6, ry: 0.3 },
      { id: 'drift', kind: 'prop', prop: 'driftwood', x: 8.8, y: 0, z: -3.6, ry: 2.6 },
      { id: 'shell1', kind: 'prop', prop: 'shell', x: -5.6, y: 0, z: -3.4, ry: 0.5 },
      { id: 'shell2', kind: 'prop', prop: 'shell', x: 3.2, y: 0, z: -4.2, ry: 2 },
      { id: 'shell3', kind: 'prop', prop: 'shell', x: 6.3, y: 0, z: 2.9, ry: 4 },
      { id: 'rock1', kind: 'prop', prop: 'rocksmall', x: -2.4, y: 0, z: 4.6, sx: 1.2 },
      { id: 'grass1', kind: 'prop', prop: 'grass', x: -10.2, y: 0, z: 4.2 },
      { id: 'grass2', kind: 'prop', prop: 'grass', x: 10.4, y: 0, z: 5, sx: 1.3 },
      { id: 'bush1', kind: 'prop', prop: 'bush', x: 12.2, y: 0, z: 3.6, sx: 0.9 },
      { id: 'torch1', kind: 'prop', prop: 'torch', x: -7.8, y: 0, z: -3.2 },
      { id: 'torch2', kind: 'prop', prop: 'torch', x: 7.8, y: 0, z: -3.2 },
      { id: 'sign', kind: 'prop', prop: 'signpost', x: -10.2, y: 0, z: -1.2, ry: 0.5 },
      { id: 'rock2', kind: 'prop', prop: 'rocksmall', x: 5.2, y: 0, z: -6.4, ry: 1.1, sx: 1.4 },
      { id: 'rock3', kind: 'prop', prop: 'rocksmall', x: 5.9, y: 0, z: -6.1, ry: 2.5, sx: 0.8 },
      { id: 'shell4', kind: 'prop', prop: 'shell', x: -3.4, y: 0, z: -7.2, ry: 1.2, sx: 1.2 },
      { id: 'grass3', kind: 'prop', prop: 'grass', x: -8.4, y: 0, z: -6.6, sx: 1.4 },
      { id: 'grass4', kind: 'prop', prop: 'grass', x: 9.6, y: 0, z: -5.8, sx: 1.2 },
      { id: 'coco1', kind: 'coconut', x: -10.2, y: 0.12, z: 5.3 },
      { id: 'coco2', kind: 'coconut', x: -9.7, y: 0.12, z: 5.0 },
    ];
    [0, 1].forEach((side) => {
      const team = s.sides[side];
      const sign = side === 0 ? -1 : 1;
      const color = TEAM_COLORS[team] ?? '#ffffff';
      // win mark on the ground and a team flag
      entities.push({ id: `mark${side}`, kind: 'box', x: sign * WIN, y: 0.04, z: 0, sx: 0.4, sy: 0.08, sz: 5, color, glow: true });
      entities.push({ id: `flag${side}`, kind: 'prop', prop: 'flag', x: sign * WIN, y: 0, z: 2.9, ry: side === 0 ? 0 : Math.PI, sx: 0.85, color });
    });
    const k = [0, 0];
    s.players.forEach((_, i) => {
      const side = sideOf(s, i);
      const sign = side === 0 ? -1 : 1;
      const n = k[side]++;
      const x = r + sign * (3 + n * 1.8);
      const won = s.winner !== null && s.winner === s.players[i].team;
      const lost = s.winner !== null && s.winner >= 0 && !won;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x,
        y: 0,
        z: n % 2 ? 0.35 : -0.35,
        ry: faceAngle(-sign, 0),
        anim: won ? 'cheer' : lost ? 'sad' : s.shakeVis[i] > 0 || s.energy[i] > 0.6 ? 'walk' : 'idle',
      });
      entities.push({ id: `ring${i}`, kind: 'torus', x, y: 0.05, z: n % 2 ? 0.35 : -0.35, sx: 1.4, sy: 1, sz: 1.4, color: TEAM_COLORS[s.players[i].team] ?? '#ffffff' });
    });
    for (const e of entities) if (e.kind === 'prop' || e.kind === 'palm') e.y = -0.03;
    const pct = (side: number) => `${Math.round(clamp((side === 0 ? -r : r) / WIN, 0, 1) * 100)} %`;
    return {
      env: 'sand',
      scenery: { set: 'beach', clear: { w: 26, d: 15, z: 0.5 } },
      fx: viewFx(s),
      camera: { alpha: -Math.PI / 2, beta: 1.12, radius: 19, target: [r * 0.4, 1, 0] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: [0, 1].map((side) => ({ team: s.sides[side], labelKey: s.sides[side] === 0 ? 'team.red' : 'team.blue', value: pct(side) })),
        bars: s.energy.map((e, i) => ({ player: i, value: clamp(e / E_MAX, 0, 1) })),
        message: inWave(s) && s.winner === null ? { key: 'mg.schatzTauziehen.wave' } : undefined,
      },
    };
  },
};
