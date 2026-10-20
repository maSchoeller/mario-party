import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, ranksFromScores, rowSpawn, skill } from '../util';

/**
 * #4 Wackel-Brücke (FFA, Gyro): every player balances a marble on their own swaying
 * rope bridge (4 lanes side by side). Tilting the phone tilts the bridge: x = sideways,
 * y = forward. Wind (same for everybody) and the wobbling of the bridge – stronger the
 * faster you roll – push the marble sideways. Falling off restarts at the last checkpoint.
 * Rank by finish time, otherwise by the furthest progress.
 */
const L = 84; // bridge length
const HALF_W = 1.1; // half bridge width
const CHECK = 14; // checkpoint distance
const LANE = 4.5; // lane spacing on the TV
const CTRL = 4.5; // sideways acceleration at full tilt
const DIST = 9; // acceleration per unit of disturbance
const FWD = 5; // forward acceleration at full tilt
const MAX_VZ = 4.2;
const FALL = 1.1; // seconds of falling before the respawn
const PLANK = 10;

interface P {
  x: number;
  z: number;
  vx: number;
  vz: number;
  tiltX: number;
  tiltY: number;
  /** current checkpoint (z) */
  cp: number;
  best: number;
  fallT: number | null;
  falls: number;
  finishedAt: number | null;
  /** bot: time until the next control update */
  think: number;
}

export interface WackelBrueckeState {
  t: number;
  duration: number;
  practice: boolean;
  n: number;
  colors: string[];
  ps: P[];
  wind: number;
  windTarget: number;
  windIn: number;
}

/** Sideways disturbance (in tilt units) for a marble at z with forward speed vz. */
function disturbance(s: WackelBrueckeState, p: P): number {
  const sway = 0.16 * Math.sin(2.6 * s.t + p.z * 0.35) * (0.3 + Math.abs(p.vz) / 2.5);
  return s.wind + sway;
}

export const wackelBruecke: MinigameDef<WackelBrueckeState> = {
  id: 'wackelBruecke',
  format: 'ffa',
  control: 'motion',
  motion: true,
  theme: 'any',
  duration: 55,
  setup(players: MgPlayer[], rng, opts) {
    return {
      t: 0,
      duration: 55,
      practice: opts.practice,
      n: players.length,
      colors: players.map((p) => PLAYER_COLOR_HEX[p.color]),
      ps: players.map(() => ({ x: 0, z: 0, vx: 0, vz: 0, tiltX: 0, tiltY: 0, cp: 0, best: 0, fallT: null, falls: 0, finishedAt: null, think: 0 })),
      wind: 0,
      windTarget: rng.range(-0.15, 0.15),
      windIn: 2,
    };
  },
  layout(s, i) {
    if (s.ps[i].finishedAt !== null) return { kind: 'wait', labelKey: 'mg.wackelBruecke.finished' };
    return { kind: 'tilt', labelKey: 'ctrl.tilt' };
  },
  input(s, i, input: MgInput) {
    if (input.type !== 'tilt') return;
    const p = s.ps[i];
    p.tiltX = clamp(Number.isFinite(input.x) ? input.x : 0, -1, 1);
    p.tiltY = clamp(Number.isFinite(input.y) ? input.y : 0, -1, 1);
  },
  tick(s, dt, rng) {
    s.t += dt;
    // wind: the same for everybody, gets stronger over time
    s.windIn -= dt;
    if (s.windIn <= 0) {
      const strength = 0.15 + Math.min(1, s.t / 40) * 0.25;
      s.windTarget = rng.range(-strength, strength);
      s.windIn = rng.range(1.5, 3);
    }
    s.wind += (s.windTarget - s.wind) * clamp(dt * 3, 0, 1);
    for (const p of s.ps) {
      if (p.finishedAt !== null) continue;
      if (p.fallT !== null) {
        p.fallT += dt;
        if (p.fallT >= FALL) {
          p.fallT = null;
          p.x = 0;
          p.z = p.cp;
          p.vx = p.vz = 0;
        }
        continue;
      }
      const ax = CTRL * p.tiltX + DIST * disturbance(s, p) - 0.8 * p.vx;
      const az = FWD * p.tiltY - 1.2 * p.vz;
      p.vx += ax * dt;
      p.vz = clamp(p.vz + az * dt, -2, MAX_VZ);
      p.x += p.vx * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      if (p.z <= 0 && p.vz < 0) p.vz = 0;
      p.best = Math.max(p.best, Math.min(L, p.z));
      p.cp = Math.max(p.cp, Math.min(L - CHECK, Math.floor(p.z / CHECK) * CHECK));
      if (Math.abs(p.x) > HALF_W) {
        p.fallT = 0;
        p.falls++;
      } else if (p.z >= L) {
        if (s.practice) {
          p.z = 0;
          p.cp = 0;
          p.best = 0;
          p.vx = p.vz = 0;
        } else {
          p.finishedAt = s.t;
          p.z = L;
        }
      }
    }
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || s.ps.every((p) => p.finishedAt !== null)),
  result: (s) => ranksFromScores(s.ps.map((p) => (p.finishedAt !== null ? 1000 - p.finishedAt : Math.floor(p.best * 10) / 10))),
  bot(s, i, level, rng: Rng, dt) {
    const p = s.ps[i];
    if (p.finishedAt !== null || p.fallT !== null) return [];
    const sk = skill(level);
    p.think -= dt;
    if (p.think > 0) return [];
    p.think = sk.reaction * 0.6 * (0.8 + rng.next() * 0.4);
    // PD controller towards the middle of the bridge, compensating the disturbance
    const comp = { easy: 0.35, medium: 0.7, hard: 0.95 }[level];
    const want = -(3.2 * p.x + 1.8 * p.vx) - DIST * disturbance(s, p) * comp;
    const x = clamp(want / CTRL + (1 - sk.accuracy) * 0.6 * rng.noise(), -1, 1);
    const pace = { easy: 0.55, medium: 0.7, hard: 0.85 }[level];
    const y = clamp(pace * (1 - clamp(Math.abs(p.x) / HALF_W, 0, 1) * 0.9) + 0.05 * rng.noise(), -1, 1);
    return [{ type: 'tilt', x, y }];
  },
  view(s) {
    const entities: MgEntity[] = [];
    const lanes = s.ps.map((_, i) => rowSpawn(s.n, LANE, i));
    let minZ = L;
    let maxZ = 0;
    s.ps.forEach((p, i) => {
      const lx = lanes[i];
      const tilt = p.finishedAt !== null ? 0 : (p.tiltX * CTRL + disturbance(s, p) * DIST) / (CTRL + DIST);
      const rz = -tilt * 0.35;
      for (let k = 0; k < L / PLANK; k++) {
        entities.push({ id: `pl${i}_${k}`, kind: 'box', x: lx, y: -0.15, z: k * PLANK + PLANK / 2, sx: HALF_W * 2, sy: 0.3, sz: PLANK - 0.3, rz, color: k % 2 ? '#b07a4a' : '#9c6a3f' });
      }
      for (let c = 0; c <= L; c += CHECK) {
        const reached = p.best >= c;
        for (const side of [-1, 1]) {
          entities.push({ id: `po${i}_${c}_${side}`, kind: 'cylinder', x: lx + side * (HALF_W + 0.2), y: 0.6, z: c, sx: 0.25, sy: 1.6, sz: 0.25, color: reached ? '#5cc08a' : '#6b4a33', glow: reached && c > 0 });
        }
      }
      const fy = p.fallT !== null ? -p.fallT * p.fallT * 8 : 0;
      entities.push({ id: `m${i}`, kind: 'sphere', x: lx + p.x, y: 0.45 + fy, z: p.z, sx: 0.9, sy: 0.9, sz: 0.9, player: i, color: s.colors[i], glow: true });
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: lx + p.x * 0.5,
        y: 0,
        z: Math.max(-2.5, p.z - 1.8),
        ry: p.finishedAt !== null ? 0 : Math.PI,
        anim: p.finishedAt !== null ? 'cheer' : p.fallT !== null ? 'sad' : Math.abs(p.vz) > 0.3 ? 'walk' : 'idle',
      });
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    });
    const w = (s.n * LANE) / 2 + 1;
    entities.push({ id: 'start', kind: 'box', x: 0, y: -0.3, z: -2.5, sx: w * 2, sy: 0.6, sz: 4, color: '#8d7f86' });
    entities.push({ id: 'goal', kind: 'box', x: 0, y: -0.3, z: L + 2.5, sx: w * 2, sy: 0.6, sz: 5, color: '#8d7f86' });
    entities.push({ id: 'arch', kind: 'box', x: 0, y: 3.6, z: L + 0.5, sx: w * 2, sy: 0.6, sz: 0.6, color: '#f0c04a', glow: true });
    entities.push({ id: 'archL', kind: 'cylinder', x: -w, y: 1.8, z: L + 0.5, sx: 0.5, sy: 3.6, sz: 0.5, color: '#f0c04a' });
    entities.push({ id: 'archR', kind: 'cylinder', x: w, y: 1.8, z: L + 0.5, sx: 0.5, sy: 3.6, sz: 0.5, color: '#f0c04a' });
    entities.push({ id: 'goalStar', kind: 'star', x: 0, y: 5, z: L + 0.5, sx: 1.6, sy: 1.6, sz: 1.6 });
    // wind indicator: a balloon drifting with the wind
    entities.push({ id: 'wind', kind: 'balloon', x: s.wind * 25, y: 6, z: (minZ + maxZ) / 2 + 6, color: '#ffffff', alpha: 0.85 });
    const spread = maxZ - minZ;
    return {
      env: 'sky',
      camera: { alpha: -Math.PI / 2, beta: 0.95, radius: clamp(20 + spread * 0.7, 20, 48), target: [0, 0, (minZ + maxZ) / 2 + 3] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        bars: s.ps.map((p, i) => ({ player: i, value: p.finishedAt !== null ? 1 : p.best / L })),
        scores: s.ps.map((p, i) => ({ player: i, value: p.finishedAt !== null ? `🏁 ${p.finishedAt.toFixed(1)} s` : `${Math.round((p.best / L) * 100)} %` })),
      },
    };
  },
};
