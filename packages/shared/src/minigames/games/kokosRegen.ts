import type { Rng } from '../../rng';
import { botRef, type MgEntity, type MgInput, type MgPlayer, type MinigameDef } from '../types';
import { ageFx, clamp, dist2, emitFx, faceAngle, moveWithStick, ranksFromScores, reactTime, ringSpawn, seenAt, seenBuf, seenPush, viewFx, type FxState, type SeenBuf } from '../util';
import { BOT_LIVE_LAG } from './botLag';

/**
 * #1 Kokos-Regen (FFA, Joystick): catch falling coconuts (+1), dodge falling stones
 * (stunned, -1). Tie-break: fewer stone hits, then whoever reached the final score earlier.
 */
interface Faller {
  id: number;
  kind: 'coconut' | 'stone';
  x: number;
  z: number;
  /** time until impact */
  eta: number;
  /** spawn time (bots notice it one reaction later) */
  at: number;
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
  /** stone hits and the time of the last score change (tie-break) */
  hits: number;
  scoreAt: number;
  /** bot: current target, re-plan timer, perception delay, heading error, landing-time misjudgement */
  target?: { x: number; z: number } | null;
  think: number;
  lag: number;
  hd: number;
  misjudge: number;
}

export interface KokosRegenState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  ps: P[];
  fallers: Faller[];
  spawnIn: number;
  nextId: number;
  flashes: { id: number; x: number; z: number; t: number; kind: 'catch' | 'hit' }[];
  /** bot form per player (v0.5) */
  form: number[];
  /** what the bots have seen: player positions */
  seen: SeenBuf;
}

const R = 8; // arena radius
const FALL = 1.6; // seconds of visible fall
const SPEED = 6;
/** bots: chance to notice a stone coming down on them, and the spread of their landing-time guess */
const BOT_SPOT = { easy: 0.6, medium: 0.8, hard: 0.95 };
const BOT_ETA_SD = { easy: 0.25, medium: 0.15, hard: 0.08 };
/** bots leave a coconut to an opponent that is this much closer to it (practised players only) */
const BOT_YIELD = { easy: 99, medium: 99, hard: 1.5 };
/** the beach: flat top (r <= R) at y 0, sloping into the lagoon (-0.6 at R + 1) */
const BEACH_DROP = 0.6;
const beachY = (x: number, z: number) => -clamp(Math.hypot(x, z) - R, 0, 1) * BEACH_DROP;

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
        return { x: s.x, z: s.z, vx: 0, vz: 0, ry: 0, stick: { x: 0, y: 0 }, stun: 0, score: 0, hits: 0, scoreAt: 0, think: 0, lag: 0.4, hd: 0, misjudge: 0 };
      }),
      fallers: [],
      spawnIn: 0.5,
      nextId: 1,
      flashes: [],
      form: players.map((p) => p.form ?? 1),
      seen: seenBuf(),
      fx: [],
      fxN: 0,
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
      s.fallers.push({ id: s.nextId++, kind: rng.chance(0.3 + intensity * 0.15) ? 'stone' : 'coconut', x: Math.cos(a) * r, z: Math.sin(a) * r, eta: FALL, at: s.t });
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
        let hit = false;
        s.ps.forEach((p) => {
          if (dist2(p.x, p.z, f.x, f.z) < hitR * hitR && p.stun <= 0) {
            p.stun = 1.4;
            p.hits++;
            if (p.score > 0) p.scoreAt = s.t;
            p.score = Math.max(0, p.score - 1);
            s.flashes.push({ id: s.nextId++, x: p.x, z: p.z, t: 0.6, kind: 'hit' });
            emitFx(s, { kind: 'hit', sfx: 'thud', x: p.x, y: 1.6, z: p.z });
            hit = true;
          }
        });
        if (!hit) emitFx(s, { kind: 'dust', sfx: 'land', x: f.x, y: 0.1, z: f.z, s: 0.9 });
      } else if (best >= 0) {
        s.ps[best].score++;
        s.ps[best].scoreAt = s.t;
        s.flashes.push({ id: s.nextId++, x: f.x, z: f.z, t: 0.5, kind: 'catch' });
        emitFx(s, { kind: 'sparkle', sfx: 'catch', x: s.ps[best].x, y: 1.8, z: s.ps[best].z });
      } else emitFx(s, { kind: 'dust', x: f.x, y: 0.1, z: f.z, s: 0.6 });
    }
    s.fallers = s.fallers.filter((f) => f.eta > 0);
    s.flashes = s.flashes.filter((fl) => (fl.t -= dt) > 0);
    ageFx(s, dt);
  },
  isOver: (s) => !s.practice && s.t >= s.duration,
  // more coconuts; on a tie fewer stone hits, then the one who got there first
  result: (s) => ranksFromScores(s.ps.map((p) => p.score * 1e6 - p.hits * 1e3 - p.scoreAt)),
  bot(s, i, level, rng: Rng, dt) {
    const p = s.ps[i];
    const ref = botRef(level, s.form[i]);
    // own position: seen on the TV a moment late
    if (s.seen.t[s.seen.t.length - 1] !== s.t) seenPush(s.seen, s.t, s.ps.flatMap((o) => [o.x, o.z]), 1);
    const me = seenAt(s.seen, s.t - BOT_LIVE_LAG)!;
    const mx = me[i * 2];
    const mz = me[i * 2 + 1];
    // fallers only count once the bot has noticed them (one reaction after they appeared);
    // their landing time is judged from the shrinking height, not known exactly
    const seen = s.fallers.filter((f) => s.t - f.at >= p.lag);
    p.think -= dt;
    if (p.think <= 0) {
      p.think = 0.25 + rng.next() * 0.2;
      p.lag = reactTime(ref, rng, BOT_LIVE_LAG);
      p.hd = rng.noise() * ref.headingNoise;
      p.misjudge = rng.noise() * BOT_ETA_SD[level];
      const others = seenAt(s.seen, s.t - p.lag)!;
      // a stone's shadow under you: step away (some stones are simply overlooked)
      const danger = seen.find((f) => f.kind === 'stone' && f.eta < 0.9 && dist2(mx, mz, f.x, f.z) < 2.6 && ((f.id * 7919 + i * 104729) % 1000) / 1000 < BOT_SPOT[level]);
      if (danger) {
        const dx = mx - danger.x || 0.1;
        const dz = mz - danger.z || 0.1;
        p.target = { x: clamp(mx + dx * 2, -R + 1, R - 1), z: clamp(mz + dz * 2, -R + 1, R - 1) };
      } else {
        const speed = SPEED * ref.stickMag;
        const reachable = seen
          .filter((f) => {
            if (f.kind !== 'coconut') return false;
            const d = Math.sqrt(dist2(mx, mz, f.x, f.z));
            if (d / speed >= f.eta * (1 + p.misjudge) + 0.2) return false;
            return !s.ps.some((_, k) => k !== i && Math.sqrt(dist2(others[k * 2], others[k * 2 + 1], f.x, f.z)) + BOT_YIELD[level] < d);
          })
          .sort((a, b) => dist2(mx, mz, a.x, a.z) - dist2(mx, mz, b.x, b.z));
        p.target = reachable[0] ? { x: reachable[0].x, z: reachable[0].z } : p.target ?? null;
      }
    }
    if (!p.target) return [{ type: 'stick', x: 0, y: 0 }];
    const dx = p.target.x - mx;
    const dz = p.target.z - mz;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) return [{ type: 'stick', x: 0, y: 0 }];
    const a = Math.atan2(dz, dx) + p.hd;
    const mag = ref.stickMag * clamp(len / 1.2, 0.3, 1);
    return [{ type: 'stick', x: Math.cos(a) * mag, y: Math.sin(a) * mag }];
  },
  view(s) {
    const entities: MgEntity[] = [
      // sandy island with a wet rim sloping into the lagoon, palms and a few shells
      { id: 'beach', kind: 'cylinder', x: 0, y: -BEACH_DROP / 2, z: 0, sx: R * 2 + 2, sy: BEACH_DROP, sz: R * 2 + 2, color: '#f0e0b6', mat: 'sand', taper: (R * 2) / (R * 2 + 2) },
      { id: 'rim', kind: 'cylinder', x: 0, y: -1.1, z: 0, sx: R * 2 + 7, sy: 1, sz: R * 2 + 7, color: '#d6c08c', mat: 'sand', taper: (R * 2 + 2) / (R * 2 + 7) },
    ];
    // palms, bushes and beach finds stand on the sand (flat top or the slope above the waterline)
    for (const [id, kind, x, z, ry, sx] of [
      ['palm1', 'palm', -R + 0.1, 3, 0, 1],
      ['palm2', 'palm', R + 0.2, 2, 2, 1],
      ['palm3', 'palm', 2, R + 0.3, 4, 1],
      ['bush1', 'bush', -R + 1.4, 4.4, 0, 1],
      ['bush2', 'bush', R - 1.4, 5.2, 0, 0.8],
      ['fern1', 'fern', 4.6, R - 1.2, 0, 1],
      ['shell1', 'shell', -3, -R + 0.8, 0, 1],
      ['shell2', 'shell', 5.2, -R + 2.4, 2, 1],
      ['drift', 'driftwood', -R + 1.6, -3.2, 0.7, 1],
    ] as const) {
      const base = { id, x, y: beachY(x, z) - 0.04, z, ry, sx };
      entities.push(kind === 'palm' ? { ...base, kind: 'palm' } : { ...base, kind: 'prop', prop: kind });
    }
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
      // shadow disks at slightly different heights, so two overlapping ones don't flicker
      entities.push({ id: `sh${f.id}`, kind: 'cylinder', x: f.x, y: 0.012 + (f.id % 16) * 0.0035, z: f.z, sx: 1.4 - f.eta * 0.4, sy: 0.02, sz: 1.4 - f.eta * 0.4, color: f.kind === 'stone' ? '#c0504d' : '#555555', alpha: 0.35 });
    }
    s.flashes.forEach((fl) => entities.push({ id: `fl${fl.id}`, kind: fl.kind === 'catch' ? 'coin' : 'star', x: fl.x, y: 1.5 + (0.6 - fl.t) * 3, z: fl.z, alpha: fl.t * 2, sx: 0.6, sy: 0.6, sz: 0.6 }));
    return {
      env: 'water',
      scenery: { set: 'lagoon', clear: { r: R + 3 }, water: -0.5 },
      camera: { alpha: -Math.PI / 2, beta: 0.85, radius: 24, target: [0, 0, 0.5] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        scores: s.ps.map((p, i) => ({ player: i, value: `🥥 ${p.score}` })),
      },
    };
  },
};
