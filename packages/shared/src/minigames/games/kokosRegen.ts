import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, dist2, faceAngle, moveWithStick, ranksFromScores, ringSpawn, skill, steerTo } from '../util';

/**
 * #1 Kokos-Regen (FFA, Joystick): catch falling coconuts (+1), dodge falling stones
 * (stunned, -1).
 */
interface Faller {
  id: number;
  kind: 'coconut' | 'stone';
  x: number;
  z: number;
  /** time until impact */
  eta: number;
}

interface P {
  x: number;
  z: number;
  vx: number;
  vz: number;
  ry: number;
  stick: { x: number; y: number };
  stun: number;
  score: number;
  /** bot: current target */
  target?: { x: number; z: number } | null;
  think: number;
}

export interface KokosRegenState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  ps: P[];
  fallers: Faller[];
  spawnIn: number;
  nextId: number;
  flashes: { x: number; z: number; t: number; kind: 'catch' | 'hit' }[];
}

const R = 8; // arena radius
const FALL = 1.6; // seconds of visible fall
const SPEED = 6;

export const kokosRegen: MinigameDef<KokosRegenState> = {
  id: 'kokosRegen',
  format: 'ffa',
  control: 'joystick',
  theme: 'island',
  duration: 40,
  setup(players, _rng, opts) {
    return {
      t: 0,
      duration: 40,
      practice: opts.practice,
      players,
      ps: players.map((_, i) => {
        const s = ringSpawn(players.length, 4, i);
        return { x: s.x, z: s.z, vx: 0, vz: 0, ry: 0, stick: { x: 0, y: 0 }, stun: 0, score: 0, think: 0 };
      }),
      fallers: [],
      spawnIn: 0.5,
      nextId: 1,
      flashes: [],
    };
  },
  layout: () => ({ kind: 'joystick' }),
  input(s, i, input: MgInput) {
    if (input.type === 'stick') s.ps[i].stick = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
  },
  tick(s, dt, rng) {
    s.t += dt;
    // spawn
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) {
      const intensity = Math.min(1, s.t / s.duration);
      s.spawnIn = 0.45 - intensity * 0.2;
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * (R - 0.8);
      s.fallers.push({ id: s.nextId++, kind: rng.chance(0.3 + intensity * 0.15) ? 'stone' : 'coconut', x: Math.cos(a) * r, z: Math.sin(a) * r, eta: FALL });
    }
    // players
    for (const p of s.ps) {
      if (p.stun > 0) {
        p.stun -= dt;
        p.vx *= 0.8;
        p.vz *= 0.8;
        continue;
      }
      moveWithStick(p, p.stick, SPEED, dt);
      const d = Math.hypot(p.x, p.z);
      if (d > R - 0.5) {
        p.x *= (R - 0.5) / d;
        p.z *= (R - 0.5) / d;
      }
      if (Math.hypot(p.vx, p.vz) > 0.5) p.ry = faceAngle(p.vx, p.vz);
    }
    // impacts
    for (const f of s.fallers) {
      f.eta -= dt;
      if (f.eta > 0) continue;
      const hitR = f.kind === 'coconut' ? 1.1 : 1.3;
      let best = -1;
      let bestD = hitR * hitR;
      s.ps.forEach((p, i) => {
        const d = dist2(p.x, p.z, f.x, f.z);
        if (d < bestD && (f.kind === 'stone' || p.stun <= 0)) {
          best = i;
          bestD = d;
        }
      });
      if (f.kind === 'stone') {
        s.ps.forEach((p) => {
          if (dist2(p.x, p.z, f.x, f.z) < hitR * hitR && p.stun <= 0) {
            p.stun = 1.4;
            p.score = Math.max(0, p.score - 1);
            s.flashes.push({ x: p.x, z: p.z, t: 0.6, kind: 'hit' });
          }
        });
      } else if (best >= 0) {
        s.ps[best].score++;
        s.flashes.push({ x: f.x, z: f.z, t: 0.5, kind: 'catch' });
      }
    }
    s.fallers = s.fallers.filter((f) => f.eta > 0);
    s.flashes = s.flashes.filter((fl) => (fl.t -= dt) > 0);
  },
  isOver: (s) => !s.practice && s.t >= s.duration,
  result: (s) => ranksFromScores(s.ps.map((p) => p.score)),
  bot(s, i, level, rng: Rng, dt) {
    const p = s.ps[i];
    const sk = skill(level);
    p.think -= dt;
    if (p.think <= 0) {
      p.think = sk.reaction * (0.7 + rng.next() * 0.6);
      // dodge stones first
      const danger = s.fallers.find((f) => f.kind === 'stone' && f.eta < 0.9 && dist2(p.x, p.z, f.x, f.z) < 2.6 && rng.chance(sk.accuracy));
      if (danger) {
        const dx = p.x - danger.x || 0.1;
        const dz = p.z - danger.z || 0.1;
        p.target = { x: clamp(p.x + dx * 2, -R + 1, R - 1), z: clamp(p.z + dz * 2, -R + 1, R - 1) };
      } else {
        const reachable = s.fallers
          .filter((f) => f.kind === 'coconut' && Math.sqrt(dist2(p.x, p.z, f.x, f.z)) / (SPEED * sk.speed) < f.eta + 0.2)
          .sort((a, b) => dist2(p.x, p.z, a.x, a.z) - dist2(p.x, p.z, b.x, b.z));
        p.target = reachable[0] ? { x: reachable[0].x, z: reachable[0].z } : p.target ?? null;
      }
    }
    const stick = p.target ? steerTo(p.x, p.z, p.target.x, p.target.z, rng, sk.accuracy) : { x: 0, y: 0 };
    stick.x *= sk.speed;
    stick.y *= sk.speed;
    return [{ type: 'stick', ...stick }];
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'beach', kind: 'cylinder', x: 0, y: -0.25, z: 0, sx: R * 2, sy: 0.5, sz: R * 2, color: '#efe2c0' },
      { id: 'palm1', kind: 'palm', x: -R - 1.5, y: 0, z: 3 },
      { id: 'palm2', kind: 'palm', x: R + 1.5, y: 0, z: 2 },
      { id: 'palm3', kind: 'palm', x: 2, y: 0, z: R + 1.5 },
    ];
    s.ps.forEach((p, i) =>
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: p.x,
        y: 0,
        z: p.z,
        ry: p.ry,
        anim: p.stun > 0 ? 'hit' : Math.hypot(p.vx, p.vz) > 0.6 ? 'walk' : 'idle',
      }),
    );
    for (const f of s.fallers) {
      const y = (f.eta / FALL) * 12;
      entities.push({ id: `f${f.id}`, kind: f.kind === 'coconut' ? 'coconut' : 'rock', x: f.x, y, z: f.z, ry: f.eta * 3 });
      entities.push({ id: `sh${f.id}`, kind: 'cylinder', x: f.x, y: 0.02, z: f.z, sx: 1.4 - f.eta * 0.4, sy: 0.02, sz: 1.4 - f.eta * 0.4, color: f.kind === 'stone' ? '#c0504d' : '#555555', alpha: 0.35 });
    }
    s.flashes.forEach((fl, k) => entities.push({ id: `fx${k}`, kind: fl.kind === 'catch' ? 'coin' : 'star', x: fl.x, y: 1.5 + (0.6 - fl.t) * 3, z: fl.z, alpha: fl.t * 2, sx: 0.6, sy: 0.6, sz: 0.6 }));
    return {
      env: 'water',
      camera: { alpha: -Math.PI / 2, beta: 0.85, radius: 24, target: [0, 0, 0.5] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        scores: s.ps.map((p, i) => ({ player: i, value: `🥥 ${p.score}` })),
      },
    };
  },
};
