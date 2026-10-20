import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, faceAngle, lerp, moveWithStick, ranksFromScores, ringSpawn, skill, steerTo } from '../util';

/**
 * #2 Schubs-Scholle (FFA, Joystick + Button): sumo on a round ice floe that melts over
 * time. Whoever slides into the water is out; ranks follow the elimination order and all
 * survivors share first place. "Schubsen" is a short dash with cooldown; bumping players
 * bounces both, a dash hit throws the other player far.
 */
const R0 = 8; // floe radius at start
const R_END = 3.2; // floe radius at the end
const PR = 0.65; // player radius
const SPEED = 5.5;
const ACCEL = 4; // low acceleration = slippery ice
const DASH_SPEED = 13;
const DASH_TIME = 0.22;
const COOLDOWN = 1.4;
const DASH_KNOCK = 6.5;
const PRACTICE_RESPAWN = 1.4;

interface P {
  x: number;
  z: number;
  vx: number;
  vz: number;
  ry: number;
  /** facing direction (unit vector) – dash direction */
  fx: number;
  fz: number;
  stick: { x: number; y: number };
  wantPush: boolean;
  dash: number;
  cd: number;
  /** "got hit" animation timer */
  hitT: number;
  /** seconds since falling off (null = on the floe) */
  fallT: number | null;
  /** minigame time of elimination (null = still in) */
  out: number | null;
  /** bot state */
  think: number;
  targetX: number;
  targetZ: number;
  aimAt: number;
}

export interface ScholleState {
  t: number;
  duration: number;
  practice: boolean;
  n: number;
  colors: string[];
  radius: number;
  ps: P[];
  endAt: number | null;
}

function floeRadius(s: ScholleState): number {
  if (s.practice) return R0 * 0.85;
  return lerp(R0, R_END, clamp((s.t - 3) / (s.duration - 10), 0, 1));
}

const onFloe = (p: P) => p.fallT === null && p.out === null;

export const schubsScholle: MinigameDef<ScholleState> = {
  id: 'schubsScholle',
  format: 'ffa',
  control: 'joystick',
  theme: 'any',
  duration: 45,
  setup(players: MgPlayer[], _rng, opts) {
    const n = players.length;
    return {
      t: 0,
      duration: 45,
      practice: opts.practice,
      n,
      colors: players.map((p) => PLAYER_COLOR_HEX[p.color]),
      radius: opts.practice ? R0 * 0.85 : R0,
      endAt: null,
      ps: players.map((_, i) => {
        const sp = ringSpawn(n, 4, i);
        const len = Math.hypot(sp.x, sp.z) || 1;
        return {
          x: sp.x,
          z: sp.z,
          vx: 0,
          vz: 0,
          ry: faceAngle(-sp.x, -sp.z),
          fx: -sp.x / len,
          fz: -sp.z / len,
          stick: { x: 0, y: 0 },
          wantPush: false,
          dash: 0,
          cd: 0.5,
          hitT: 0,
          fallT: null,
          out: null,
          think: 0,
          targetX: 0,
          targetZ: 0,
          aimAt: -1,
        };
      }),
    };
  },
  layout(s, i) {
    if (s.ps[i].out !== null) return { kind: 'wait', labelKey: 'ctrl.eliminated' };
    return { kind: 'joystick', buttons: [{ id: 'push', labelKey: 'ctrl.push' }] };
  },
  input(s, i, input: MgInput) {
    const p = s.ps[i];
    if (input.type === 'stick') p.stick = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
    else if (input.type === 'button' && input.id === 'push' && input.down) p.wantPush = true;
  },
  tick(s, dt) {
    s.t += dt;
    s.radius = floeRadius(s);
    for (const p of s.ps) {
      p.hitT = Math.max(0, p.hitT - dt);
      if (p.fallT !== null) {
        p.fallT += dt;
        p.x += p.vx * dt * 0.5;
        p.z += p.vz * dt * 0.5;
        if (s.practice && p.fallT >= PRACTICE_RESPAWN) {
          // practice: back onto the floe
          p.x = 0;
          p.z = 0;
          p.vx = p.vz = 0;
          p.fallT = null;
          p.dash = 0;
        }
        p.wantPush = false;
        continue;
      }
      if (p.out !== null) continue;
      p.cd = Math.max(0, p.cd - dt);
      const len = Math.hypot(p.stick.x, p.stick.y);
      if (len > 0.2 && p.dash <= 0) {
        p.fx = p.stick.x / len;
        p.fz = p.stick.y / len;
      }
      if (p.wantPush && p.cd <= 0 && p.dash <= 0) {
        p.dash = DASH_TIME;
        p.cd = COOLDOWN;
        p.vx = p.fx * DASH_SPEED;
        p.vz = p.fz * DASH_SPEED;
      }
      p.wantPush = false;
      if (p.dash > 0) {
        p.dash -= dt;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        if (p.dash <= 0) {
          p.vx *= 0.45;
          p.vz *= 0.45;
        }
      } else {
        moveWithStick(p, p.stick, SPEED, dt, ACCEL);
      }
      if (Math.hypot(p.vx, p.vz) > 0.5) p.ry = faceAngle(p.vx, p.vz);
    }
    // collisions between players on the floe
    for (let a = 0; a < s.n; a++) {
      for (let b = a + 1; b < s.n; b++) {
        const pa = s.ps[a];
        const pb = s.ps[b];
        if (!onFloe(pa) || !onFloe(pb)) continue;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const d = Math.hypot(dx, dz);
        if (d >= PR * 2 || d < 1e-6) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = PR * 2 - d;
        pa.x -= (nx * overlap) / 2;
        pa.z -= (nz * overlap) / 2;
        pb.x += (nx * overlap) / 2;
        pb.z += (nz * overlap) / 2;
        const vrel = (pa.vx - pb.vx) * nx + (pa.vz - pb.vz) * nz;
        if (vrel > 0) {
          const j = vrel * 0.9;
          pa.vx -= j * nx;
          pa.vz -= j * nz;
          pb.vx += j * nx;
          pb.vz += j * nz;
        }
        if (pa.dash > 0) {
          pb.vx += nx * DASH_KNOCK;
          pb.vz += nz * DASH_KNOCK;
          pb.hitT = 0.5;
          pa.dash = 0;
          pa.vx *= 0.3;
          pa.vz *= 0.3;
        }
        if (pb.dash > 0) {
          pa.vx -= nx * DASH_KNOCK;
          pa.vz -= nz * DASH_KNOCK;
          pa.hitT = 0.5;
          pb.dash = 0;
          pb.vx *= 0.3;
          pb.vz *= 0.3;
        }
      }
    }
    // falling off the floe
    for (const p of s.ps) {
      if (!onFloe(p)) continue;
      if (Math.hypot(p.x, p.z) > s.radius + 0.1) {
        p.fallT = 0;
        p.dash = 0;
        if (!s.practice) p.out = s.t;
      }
    }
    if (!s.practice && s.endAt === null && s.ps.filter((p) => p.out === null).length <= 1) s.endAt = s.t + 1.2;
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || (s.endAt !== null && s.t >= s.endAt)),
  // survivors share rank 0, the others by elimination time (later = better)
  result: (s) => ranksFromScores(s.ps.map((p) => (p.out === null ? 1e6 : p.out))),
  bot(s, i, level, rng: Rng, dt) {
    const p = s.ps[i];
    if (!onFloe(p)) return [];
    const sk = skill(level);
    const margin = { easy: 0.7, medium: 1.2, hard: 1.6 }[level];
    const out: MgInput[] = [];
    p.think -= dt;
    const r = Math.hypot(p.x, p.z);
    if (p.think <= 0) {
      p.think = sk.reaction * (0.6 + rng.next() * 0.6);
      p.aimAt = -1;
      if (r > s.radius - margin) {
        p.targetX = 0;
        p.targetZ = 0;
      } else {
        // hunt the opponent: prefer the nearest (hard bots: the one closest to the edge)
        let best = -1;
        let bestScore = Infinity;
        s.ps.forEach((o, k) => {
          if (k === i || !onFloe(o)) return;
          const d = Math.hypot(o.x - p.x, o.z - p.z);
          const edge = s.radius - Math.hypot(o.x, o.z);
          const score = d + (level === 'hard' ? edge * 1.5 : 0) + rng.next() * (1 - sk.accuracy) * 4;
          if (score < bestScore) {
            bestScore = score;
            best = k;
          }
        });
        if (best >= 0) {
          const o = s.ps[best];
          const or = Math.hypot(o.x, o.z) || 1;
          // get between the centre and the opponent, then push outwards
          p.targetX = o.x - (o.x / or) * 1.5;
          p.targetZ = o.z - (o.z / or) * 1.5;
          p.aimAt = best;
        } else {
          p.targetX = 0;
          p.targetZ = 0;
        }
      }
    }
    let stick = steerTo(p.x, p.z, p.targetX, p.targetZ, rng, sk.accuracy);
    if (p.aimAt >= 0 && p.cd <= 0) {
      const o = s.ps[p.aimAt];
      if (onFloe(o)) {
        const dx = o.x - p.x;
        const dz = o.z - p.z;
        const d = Math.hypot(dx, dz);
        const or = Math.hypot(o.x, o.z) || 1;
        const outward = (dx / (d || 1)) * (o.x / or) + (dz / (d || 1)) * (o.z / or);
        // don't dash yourself off the floe
        const after = Math.hypot(p.x + (dx / (d || 1)) * 3, p.z + (dz / (d || 1)) * 3);
        if (d < 2.6 && outward > 0.2 && (after < s.radius || level === 'easy') && rng.chance(sk.accuracy * 0.25)) {
          const noise = (1 - sk.accuracy) * 0.6 * rng.noise();
          const a = Math.atan2(dz, dx) + noise;
          stick = { x: Math.cos(a), y: Math.sin(a) };
          out.push({ type: 'stick', ...stick });
          out.push({ type: 'button', id: 'push', down: true });
          return out;
        }
      }
    }
    stick.x *= sk.speed;
    stick.y *= sk.speed;
    out.push({ type: 'stick', ...stick });
    return out;
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'melt', kind: 'cylinder', x: 0, y: -0.35, z: 0, sx: R0 * 2, sy: 0.4, sz: R0 * 2, color: '#bfe3f2', alpha: 0.3 },
      { id: 'floe', kind: 'cylinder', x: 0, y: -0.3, z: 0, sx: s.radius * 2, sy: 0.6, sz: s.radius * 2, color: '#eef8fd' },
      { id: 'berg1', kind: 'cone', x: -12, y: -0.5, z: 7, sx: 3, sy: 3.5, sz: 3, color: '#ffffff' },
      { id: 'berg2', kind: 'cone', x: 12.5, y: -0.5, z: 5, sx: 2.4, sy: 2.6, sz: 2.4, color: '#e4f4fb' },
      { id: 'berg3', kind: 'cone', x: 9, y: -0.5, z: 11, sx: 3.5, sy: 4.2, sz: 3.5, color: '#ffffff' },
    ];
    const over = s.endAt !== null && s.t >= s.endAt - 1.2;
    s.ps.forEach((p, i) => {
      if (p.fallT !== null && p.fallT > 1.2) {
        // splash ring where the player went down
        if (p.fallT < 2.2) entities.push({ id: `sp${i}`, kind: 'torus', x: p.x, y: -0.2, z: p.z, sx: 1 + p.fallT, sy: 1, sz: 1 + p.fallT, color: '#ffffff', alpha: clamp(2.2 - p.fallT, 0, 1) });
        return;
      }
      const y = p.fallT !== null ? -p.fallT * p.fallT * 5 : 0;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: p.x,
        y,
        z: p.z,
        ry: p.ry,
        anim: p.fallT !== null || p.hitT > 0 ? 'hit' : over && p.out === null ? 'cheer' : p.dash > 0 ? 'roll' : Math.hypot(p.vx, p.vz) > 0.6 ? 'walk' : 'idle',
      });
      if (p.fallT === null && p.out === null) {
        // ready-to-push marker under the player
        entities.push({ id: `rdy${i}`, kind: 'torus', x: p.x, y: 0.05, z: p.z, sx: 1.6, sy: 1, sz: 1.6, player: i, color: s.colors[i], alpha: p.cd <= 0 ? 0.9 : 0.25, glow: p.cd <= 0 });
      }
    });
    return {
      env: 'water',
      camera: { alpha: -Math.PI / 2, beta: 0.8, radius: 12 + s.radius * 1.6, target: [0, 0, 0.5] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        scores: s.ps.map((p, i) => ({ player: i, value: p.out === null ? '🧊' : '💦' })),
        message: s.t < 2 && !s.practice ? { key: 'mg.schubsScholle.start' } : undefined,
      },
    };
  },
};
