import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import { botRef, type MgEntity, type MgInput, type MgPlayer, type MinigameDef } from '../types';
import { ageFx, chance, clamp, emitFx, faceAngle, lerp, moveWithStick, ranksFromScores, reactTime, ringSpawn, seenAt, seenBuf, seenPush, viewFx, type FxState, type SeenBuf } from '../util';
import { BOT_LIVE_LAG } from './botLag';

/**
 * #2 Schubs-Scholle (FFA, Joystick + Button): sumo on a round ice floe that melts over
 * time. Whoever slides into the water is out; ranks follow the elimination order and all
 * survivors share first place. "Schubsen" is a short dash with cooldown; bumping players
 * bounces both, a dash hit throws the other player far.
 */
const R0 = 8; // floe radius at start
const R_END = 2.4; // floe radius at the end
const PR = 0.65; // player radius
const SPEED = 5.5;
const ACCEL = 4; // low acceleration = slippery ice
const DASH_SPEED = 13;
const DASH_TIME = 0.22;
const COOLDOWN = 1.4;
const DASH_KNOCK = 6.5;
const PRACTICE_RESPAWN = 1.4;
const WATER_Y = -0.35;
/** the melting floe cracks audibly every MELT_STEP of radius lost */
const MELT_STEP = 0.6;
/** top diameter of the floe relative to its bottom (sloped ice flank, 1.1 deep) */
const SLOPE = 0.86;
const FLOE_DEPTH = 1.1;
/**
 * Bot style by level: share of plans spent just sliding around, push attempts per second once a push would work, distance from the rim
 * at which they turn back (planning / when sliding), how far they lead a moving opponent (× their perception delay),
 * minimum outward angle of a push, hunting radius, penalty for opponents further in than
 * themselves / with a push ready, and how far inside the opponent they line up.
 */
const BOT = {
  easy: { wander: 0.25, dashRate: 1.2, margin: 0.6, rescue: 0.3, lead: 0, angle: 0.2, hunt: 99, inside: 0, ready: 0, inner: 1.2 },
  medium: { wander: 0.1, dashRate: 3, margin: 1.2, rescue: 0.6, lead: 0.3, angle: 0.2, hunt: 99, inside: 1.5, ready: 0.5, inner: 1.5 },
  hard: { wander: 0, dashRate: 6, margin: 1.2, rescue: 0.6, lead: 1, angle: 0.2, hunt: 4, inside: 1.5, ready: 1.5, inner: 1.2 },
};
const DASH_RANGE = 2.6;

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
  /** bot state: re-plan timer, perception delay (s) and heading error of the current plan */
  think: number;
  lag: number;
  hd: number;
  targetX: number;
  targetZ: number;
  aimAt: number;
}

export interface ScholleState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  n: number;
  colors: string[];
  radius: number;
  ps: P[];
  endAt: number | null;
  /** melt steps already announced with a crack */
  cracks: number;
  /** throttles for frequent sounds */
  whooshAt: number;
  bumpAt: number;
  /** bot form per player (v0.5) */
  form: number[];
  /** what the bots have seen: per player x, z, on the floe (1/0) */
  seen: SeenBuf;
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
      cracks: 0,
      whooshAt: 0,
      bumpAt: 0,
      form: players.map((p) => p.form ?? 1),
      seen: seenBuf(),
      fx: [],
      fxN: 0,
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
          lag: 0.4,
          hd: 0,
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
    ageFx(s, dt);
    const melt = Math.floor((R0 - s.radius) / MELT_STEP);
    if (melt > s.cracks) {
      s.cracks = melt;
      const a = melt * 2.39996;
      emitFx(s, { kind: 'ice', sfx: 'crack', x: Math.cos(a) * s.radius, y: 0.05, z: Math.sin(a) * s.radius, s: 0.9 });
    }
    for (const p of s.ps) {
      p.hitT = Math.max(0, p.hitT - dt);
      if (p.fallT !== null) {
        const before = p.fallT;
        p.fallT += dt;
        // hits the water surface (y = -5 t²)
        if (before < 0.26 && p.fallT >= 0.26) {
          emitFx(s, { kind: 'splash', sfx: 'splash', x: p.x, y: WATER_Y, z: p.z, s: 1.2 }, 0.5);
          if (!s.practice) emitFx(s, { sfx: 'aww', x: p.x, y: 1, z: p.z }, 0.5);
        }
        p.x += p.vx * dt * 0.5;
        p.z += p.vz * dt * 0.5;
        // slide down outside the sloped ice flank instead of dropping through it
        const depth = clamp((p.fallT * p.fallT * 5) / FLOE_DEPTH, 0, 1);
        const need = s.radius + (s.radius / SLOPE - s.radius) * depth + PR * 0.8;
        const pr = Math.hypot(p.x, p.z);
        if (pr > 1e-6 && pr < need) {
          p.x *= need / pr;
          p.z *= need / pr;
        }
        if (s.practice && p.fallT >= PRACTICE_RESPAWN) {
          // practice: back onto the floe
          p.x = 0;
          p.z = 0;
          p.vx = p.vz = 0;
          p.fallT = null;
          p.dash = 0;
          emitFx(s, { kind: 'pop', sfx: 'pop', x: 0, y: 1, z: 0, color: s.colors[s.ps.indexOf(p)] });
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
        const loud = s.t >= s.whooshAt;
        if (loud) s.whooshAt = s.t + 0.35;
        emitFx(s, { kind: 'ice', sfx: loud ? 'whoosh' : undefined, x: p.x, y: 0.1, z: p.z, s: 0.5 });
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
        const mx = (pa.x + pb.x) / 2;
        const mz = (pa.z + pb.z) / 2;
        if (pa.dash > 0 || pb.dash > 0) emitFx(s, { kind: 'hit', sfx: 'thud', x: mx, y: 1, z: mz });
        else if (vrel > 2.5 && s.t >= s.bumpAt) {
          s.bumpAt = s.t + 0.4;
          emitFx(s, { kind: 'ice', sfx: 'pop', x: mx, y: 0.6, z: mz, s: 0.4 });
        }
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
    const ref = botRef(level, s.form[i]);
    const cfg = BOT[level];
    // the TV picture as the bots see it: positions of everybody, read back late
    if (s.seen.t[s.seen.t.length - 1] !== s.t) seenPush(s.seen, s.t, s.ps.flatMap((o) => [o.x, o.z, onFloe(o) ? 1 : 0, o.cd <= 0 ? 1 : 0]), 1.5);
    const now = seenAt(s.seen, s.t - p.lag)!;
    const before = seenAt(s.seen, s.t - p.lag - 0.1)!;
    const me = seenAt(s.seen, s.t - BOT_LIVE_LAG)!;
    const me0 = seenAt(s.seen, s.t - BOT_LIVE_LAG - 0.1)!;
    // own position: seen late too, but you know where you are steering
    const mx = me[i * 4] + (me[i * 4] - me0[i * 4]) * 10 * BOT_LIVE_LAG * cfg.lead;
    const mz = me[i * 4 + 1] + (me[i * 4 + 1] - me0[i * 4 + 1]) * 10 * BOT_LIVE_LAG * cfg.lead;
    // where an opponent will be: seen position, extrapolated along its seen motion
    const lead = cfg.lead * p.lag;
    const seenPos = (k: number) => ({
      x: now[k * 4] + (now[k * 4] - before[k * 4]) * 10 * lead,
      z: now[k * 4 + 1] + (now[k * 4 + 1] - before[k * 4 + 1]) * 10 * lead,
      on: now[k * 4 + 2] > 0,
      // the glowing ring under a player shows a push is ready
      ready: now[k * 4 + 3] > 0,
    });
    const out: MgInput[] = [];
    const r = Math.hypot(mx, mz);
    p.think -= dt;
    if (p.think <= 0) {
      // re-plan on what was seen one reaction time ago
      p.think = 0.25 + rng.next() * 0.2;
      p.lag = reactTime(ref, rng, BOT_LIVE_LAG);
      p.hd = rng.noise() * ref.headingNoise;
      p.aimAt = -1;
      p.targetX = 0;
      p.targetZ = 0;
      if (rng.next() < cfg.wander) {
        // distracted: just slide somewhere on the floe
        const a = rng.next() * Math.PI * 2;
        const d = Math.sqrt(rng.next()) * Math.max(0, s.radius - 1);
        p.targetX = Math.cos(a) * d;
        p.targetZ = Math.sin(a) * d;
      } else if (r <= s.radius - cfg.margin) {
        // hunt an opponent: the nearest one – better players skip those further in than themselves
        let best = -1;
        let bestScore = Infinity;
        s.ps.forEach((_, k) => {
          const o = seenPos(k);
          if (k === i || !o.on) return;
          const d = Math.hypot(o.x - mx, o.z - mz);
          const inside = Math.hypot(o.x, o.z) < r ? cfg.inside : 0;
          // practised players hold the middle and only go for opponents close by
          if (d > cfg.hunt) return;
          const score = d + inside + (o.ready ? cfg.ready : 0) + rng.next() * ref.headingNoise * 12;
          if (score < bestScore) {
            bestScore = score;
            best = k;
          }
        });
        if (best >= 0) {
          const o = seenPos(best);
          const or = Math.hypot(o.x, o.z) || 1;
          // get between the centre and the opponent (never out on the rim), then push outwards
          let tx = o.x - (o.x / or) * cfg.inner;
          let tz = o.z - (o.z / or) * cfg.inner;
          const tr = Math.hypot(tx, tz);
          const lim = Math.max(0, s.radius - 2);
          if (tr > lim) {
            tx *= lim / tr;
            tz *= lim / tr;
          }
          p.targetX = tx;
          p.targetZ = tz;
          p.aimAt = best;
        }
      }
    }
    // sliding towards the rim (e.g. after a hit): steer back to the middle, one reaction late
    const sx = now[i * 4] + (now[i * 4] - before[i * 4]) * 3;
    const sz = now[i * 4 + 1] + (now[i * 4 + 1] - before[i * 4 + 1]) * 3;
    if (Math.hypot(sx, sz) > s.radius - cfg.rescue) {
      const a = Math.atan2(-sz, -sx) + p.hd;
      out.push({ type: 'stick', x: Math.cos(a) * ref.stickMag, y: Math.sin(a) * ref.stickMag });
      return out;
    }
    const o = p.aimAt >= 0 ? seenPos(p.aimAt) : null;
    if (o && o.on && p.cd <= 0) {
      const dx = o.x - mx;
      const dz = o.z - mz;
      const d = Math.hypot(dx, dz) || 1;
      const or = Math.hypot(o.x, o.z) || 1;
      const outward = (dx / d) * (o.x / or) + (dz / d) * (o.z / or);
      // don't dash yourself off the floe: the dash ends where it hits the opponent
      const travel = Math.max(0, d - 2 * PR + 0.3);
      const after = Math.hypot(mx + (dx / d) * travel, mz + (dz / d) * travel);
      if (d < DASH_RANGE && outward > cfg.angle && (after < s.radius - 0.4 || level === 'easy') && rng.next() < chance(cfg.dashRate, dt)) {
        const a = Math.atan2(dz, dx) + rng.noise() * ref.headingNoise;
        out.push({ type: 'stick', x: Math.cos(a), y: Math.sin(a) });
        out.push({ type: 'button', id: 'push', down: true });
        return out;
      }
    }
    const tx = p.targetX - mx;
    const tz = p.targetZ - mz;
    const len = Math.hypot(tx, tz);
    if (len < 0.15) {
      out.push({ type: 'stick', x: 0, y: 0 });
      return out;
    }
    const a = Math.atan2(tz, tx) + p.hd;
    const mag = ref.stickMag * clamp(len / 1.2, 0.3, 1);
    out.push({ type: 'stick', x: Math.cos(a) * mag, y: Math.sin(a) * mag });
    return out;
  },
  view(s) {
    const r = s.radius;
    const buoyY = (k: number) => WATER_Y - 0.05 + Math.sin(s.t * 1.6 + k * 2) * 0.04;
    const entities: MgEntity[] = [
      // the floe: clear ice with sloped flanks into the sea, a snow layer on top (rim = danger)
      { id: 'floe', kind: 'cylinder', x: 0, y: -FLOE_DEPTH / 2, z: 0, sx: (r * 2) / SLOPE, sy: FLOE_DEPTH, sz: (r * 2) / SLOPE, color: '#cfeaf6', mat: 'ice', taper: SLOPE },
      { id: 'snowcap', kind: 'cylinder', x: 0, y: 0, z: 0, sx: Math.max(0.5, r * 2 - 0.7), sy: 0.08, sz: Math.max(0.5, r * 2 - 0.7), color: '#f8fbfd', mat: 'snow', taper: 0.98 },
      // icebergs, a small floe with a pine and a few buoys around the arena
      { id: 'berg1', kind: 'cone', x: -13.5, y: -1.4, z: 8, sx: 4.4, sy: 5.2, sz: 4, color: '#f4f9fc', mat: 'snow' },
      { id: 'berg2', kind: 'cone', x: 13.5, y: -1.2, z: 5.5, sx: 3.2, sy: 3.6, sz: 3, color: '#e6f4fb', mat: 'ice' },
      { id: 'berg3', kind: 'cone', x: 10, y: -1.6, z: 12.5, sx: 5, sy: 6.2, sz: 4.6, color: '#f4f9fc', mat: 'snow' },
      { id: 'isle', kind: 'cylinder', x: -11, y: -0.45, z: 12, sx: 4.6, sy: 0.7, sz: 3.8, color: '#f2f8fc', mat: 'snow', taper: 0.85 },
      { id: 'islePine', kind: 'prop', prop: 'snowpine', x: -11.4, y: -0.1, z: 12.4, sx: 0.9 },
      { id: 'isleFlag', kind: 'prop', prop: 'flag', x: -9.8, y: -0.1, z: 11.6, color: '#5f8fe0', sx: 0.6 },
      // buoys float with their waterline (model y = 0) on the bobbing sea
      { id: 'buoy1', kind: 'prop', prop: 'buoy', x: -11, y: buoyY(0), z: 2.5, rz: Math.sin(s.t * 1.2) * 0.07 },
      { id: 'buoy2', kind: 'prop', prop: 'buoy', x: 11.2, y: buoyY(1), z: -1.5, ry: 1, rz: Math.sin(s.t * 1.1 + 2) * 0.07 },
      { id: 'buoy3', kind: 'prop', prop: 'buoy', x: 4, y: buoyY(2), z: 12.4, ry: 2, rz: Math.sin(s.t * 1.3 + 1) * 0.07 },
    ];
    const over = s.endAt !== null && s.t >= s.endAt - 1.2;
    s.ps.forEach((p, i) => {
      if (p.fallT !== null && p.fallT > 1.2) {
        // splash ring where the player went down
        if (p.fallT < 2.2) entities.push({ id: `sp${i}`, kind: 'torus', x: p.x, y: WATER_Y + 0.05, z: p.z, sx: 1 + p.fallT, sy: 1, sz: 1 + p.fallT, color: '#ffffff', alpha: clamp(2.2 - p.fallT, 0, 1) });
        return;
      }
      const y = p.fallT !== null ? -p.fallT * p.fallT * 5 : 0.03;
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
        entities.push({ id: `rdy${i}`, kind: 'torus', x: p.x, y: 0.09, z: p.z, sx: 1.6, sy: 1, sz: 1.6, player: i, color: s.colors[i], alpha: p.cd <= 0 ? 0.9 : 0.25, glow: p.cd <= 0 });
      }
    });
    return {
      env: 'ice',
      scenery: { set: 'ice', clear: { r: R0 + 2 }, water: WATER_Y },
      camera: { alpha: -Math.PI / 2, beta: 0.8, radius: 12 + s.radius * 1.6, target: [0, 0, 0.5] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        scores: s.ps.map((p, i) => ({ player: i, value: p.out === null ? '🧊' : '💦' })),
        message: s.t < 2 && !s.practice ? { key: 'mg.schubsScholle.start' } : undefined,
      },
    };
  },
};
