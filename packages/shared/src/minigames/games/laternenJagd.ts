import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, dist, dist2, faceAngle, moveWithStick, skill, steerTo, teamRanks } from '../util';

/**
 * #16 Laternen-Jagd (1 vs 3, Joystick, Nacht): the solo player hides in a dark garden,
 * the trio searches with lanterns. The solo is only visible on the TV while standing in a
 * lantern beam – plus fair hints for everybody (the solo needs them to steer, too):
 * glowing footprints while running and a short sparkle every few seconds. Bushes hide
 * the solo from beams that are further away. Light the solo long enough → trio wins;
 * survive until time runs out → solo wins.
 * Pacing (MINI-03): the trio starts at the gate and waits HIDE_TIME seconds, the first
 * sparkle comes late; towards the end the seekers get faster, the sparkles more frequent and
 * the light catches quicker – the hunt gets hotter instead of being decided in the first seconds.
 */
const R = 10; // garden radius
const DURATION = 45;
const SOLO_SPEED = 5.6;
const SEEK_SPEED = 3.8;
const SEEK_LATE = 6.4;
/** lantern turn speed (rad/s) – a quick side step can escape the beam */
const TURN = 4;
/** lantern beam: rectangle in front of the seeker (matches the drawn light) */
const BEAM_LEN = 4.6;
const BEAM_W = 2.6;
/** glow circle around the lantern */
const NEAR_R = 1.4;
const BUSH_R = 1.3;
const BUSHES = 8;
const BUSH_GAP = 3.6;
/** inside a bush the solo is only seen by a lantern closer than this */
const BUSH_SEE = 2.4;
/** seconds of light (one lantern) until caught: CATCH_TIME at the start, CATCH_LATE at the end */
const CATCH_TIME = 2.0;
const CATCH_LATE = 1.2;
const CATCH_DECAY = 2.5;
/** sparkle interval: from SPARK_EVERY at the start down to SPARK_LATE at the end (the hunt gets hotter) */
const SPARK_EVERY = 4.5;
const SPARK_LATE = 2;
/** first sparkle a bit later: the solo needs a moment to sneak away from the start */
const FIRST_SPARK = 10;
const SPARK_TIME = 0.5;
const STEP_DIST = 0.85;
const STEP_LIFE = 1.8;
/** footprints glow up a moment after the step – they show the way, not the spot */
const STEP_DELAY = 0.8;
/** moving slower than this (half stick) leaves no footprints */
const SNEAK_SPEED = 3.4;
/** bot stick strength per level */
const RUN = { easy: 0.85, medium: 0.92, hard: 1 };
const SIDE_W = 1.5;
const FLEE_KEEP = 1.5;
/** head start for the solo: the trio waits at the gate (not in practice) */
const HIDE_TIME = 5;

interface P {
  x: number;
  z: number;
  vx: number;
  vz: number;
  ry: number;
  stick: { x: number; y: number };
  /** bot memory */
  think: number;
  target: { x: number; z: number } | null;
  clue: { x: number; z: number; t: number } | null;
  sneak: boolean;
}

interface Step {
  id: number;
  x: number;
  z: number;
  ry: number;
  t: number;
}

export interface LaternenJagdState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  solo: number;
  trio: number[];
  ps: P[];
  bushes: { x: number; z: number }[];
  /** 0..1 catch meter */
  caught: number;
  /** number of lanterns currently lighting the solo */
  litBy: number;
  sparkIn: number;
  spark: number;
  steps: Step[];
  stepAcc: number;
  nextId: number;
  catches: number;
  won: boolean;
}

/** the hunt gets hotter: seekers get faster towards the end */
function seekSpeed(s: LaternenJagdState): number {
  return s.practice ? SEEK_SPEED : SEEK_SPEED + (SEEK_LATE - SEEK_SPEED) * clamp(s.t / s.duration, 0, 1);
}

function inBush(s: LaternenJagdState, x: number, z: number): boolean {
  return s.bushes.some((b) => dist2(b.x, b.z, x, z) < BUSH_R * BUSH_R);
}

/** Is point (x,z) lit by the lantern of seeker p? */
function lights(p: P, x: number, z: number): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  if (dx * dx + dz * dz < NEAR_R * NEAR_R) return true;
  // facing direction from ry (inverse of faceAngle)
  const fx = -Math.sin(p.ry);
  const fz = -Math.cos(p.ry);
  const along = dx * fx + dz * fz;
  const perp = Math.abs(-dx * fz + dz * fx);
  return along > 0 && along < BEAM_LEN && perp < BEAM_W / 2;
}

function litCount(s: LaternenJagdState): number {
  const sp = s.ps[s.solo];
  const hidden = inBush(s, sp.x, sp.z);
  return s.trio.filter((i) => {
    const p = s.ps[i];
    if (!lights(p, sp.x, sp.z)) return false;
    return !hidden || dist2(p.x, p.z, sp.x, sp.z) < BUSH_SEE * BUSH_SEE;
  }).length;
}

function placeSolo(s: LaternenJagdState, rng: Rng): void {
  const sp = s.ps[s.solo];
  // a hiding spot far away from all seekers and their beams, preferably in a bush, but not
  // right at the fence (no way out there) – nobody should be caught in the first seconds
  const cands = s.bushes.map((b) => ({ x: b.x, z: b.z }));
  for (let k = 0; k < 10; k++) {
    const a = rng.next() * Math.PI * 2;
    const r = (0.3 + rng.next() * 0.45) * R;
    cands.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  let best = { x: 0, z: R - 2 };
  let bestV = -Infinity;
  for (const c of cands) {
    const d = Math.min(
      ...s.trio.map((i) => {
        const q = s.ps[i];
        const bx = q.x - Math.sin(q.ry) * BEAM_LEN * 0.6;
        const bz = q.z - Math.cos(q.ry) * BEAM_LEN * 0.6;
        return Math.min(dist(q.x, q.z, c.x, c.z), dist(bx, bz, c.x, c.z));
      }),
    );
    const v = Math.min(d, 11) + (inBush(s, c.x, c.z) ? 1.5 : 0) - Math.max(0, Math.hypot(c.x, c.z) - 0.75 * R) * 2 + rng.next();
    if (v > bestV) {
      bestV = v;
      best = c;
    }
  }
  sp.x = best.x;
  sp.z = best.z;
  sp.vx = 0;
  sp.vz = 0;
}

function keepInside(p: { x: number; z: number }): void {
  const d = Math.hypot(p.x, p.z);
  if (d > R - 0.5) {
    p.x *= (R - 0.5) / d;
    p.z *= (R - 0.5) / d;
  }
}

export const laternenJagd: MinigameDef<LaternenJagdState> = {
  id: 'laternenJagd',
  format: '1v3',
  control: 'joystick',
  theme: 'any',
  duration: DURATION,
  setup(players, rng, opts) {
    const solo = Math.max(0, players.findIndex((p) => p.team === 0));
    const trio = players.map((_, i) => i).filter((i) => i !== solo);
    // bushes spread over the garden (not right in the middle)
    const bushes: { x: number; z: number }[] = [];
    for (let tries = 0; bushes.length < BUSHES && tries < 300; tries++) {
      const a = rng.next() * Math.PI * 2;
      const r = (0.35 + rng.next() * 0.55) * R;
      const b = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (bushes.every((o) => dist(o.x, o.z, b.x, b.z) > BUSH_GAP)) bushes.push(b);
    }
    const ps: P[] = players.map(() => ({ x: 0, z: 0, vx: 0, vz: 0, ry: 0, stick: { x: 0, y: 0 }, think: 0, target: null, clue: null, sneak: false }));
    // the trio starts together at the front gate (near the camera), the solo hides somewhere
    // far away – a real head start, nobody is caught within the first seconds (MINI-03)
    trio.forEach((i, k) => {
      ps[i].x = (k - 1) * 2.4;
      ps[i].z = -(R - 2.2) + Math.abs(k - 1) * 0.6;
      ps[i].ry = faceAngle((k - 1) * 0.35, 1);
    });
    const s: LaternenJagdState = {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      solo,
      trio,
      ps,
      bushes,
      caught: 0,
      litBy: 0,
      sparkIn: FIRST_SPARK,
      spark: 0,
      steps: [],
      stepAcc: 0,
      nextId: 1,
      catches: 0,
      won: false,
    };
    placeSolo(s, rng);
    return s;
  },
  layout: () => ({ kind: 'joystick' }),
  input(s, i, input: MgInput) {
    if (input.type === 'stick') s.ps[i].stick = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
  },
  tick(s, dt, rng) {
    s.t += dt;
    s.ps.forEach((p, i) => {
      const before = { x: p.x, z: p.z };
      // head start: the trio waits at the gate while the solo hides
      const frozen = i !== s.solo && !s.practice && s.t < HIDE_TIME;
      moveWithStick(p, frozen ? { x: 0, y: 0 } : p.stick, i === s.solo ? SOLO_SPEED : seekSpeed(s), dt);
      keepInside(p);
      // the lantern keeps pointing where you last walked and turns with limited speed
      if (Math.hypot(p.vx, p.vz) > 0.6) {
        const want = faceAngle(p.vx, p.vz);
        if (i === s.solo) p.ry = want;
        else {
          let d = want - p.ry;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          p.ry += clamp(d, -TURN * dt, TURN * dt);
        }
      }
      if (i === s.solo) {
        const moved = dist(before.x, before.z, p.x, p.z);
        if (!inBush(s, p.x, p.z) && Math.hypot(p.vx, p.vz) > SNEAK_SPEED) s.stepAcc += moved;
        if (s.stepAcc >= STEP_DIST) {
          s.stepAcc = 0;
          s.steps.push({ id: s.nextId++, x: p.x, z: p.z, ry: p.ry, t: STEP_LIFE + STEP_DELAY });
        }
      }
    });
    s.steps = s.steps.filter((st) => (st.t -= dt) > 0);
    // sparkle hint
    s.spark = Math.max(0, s.spark - dt);
    s.sparkIn -= dt;
    if (s.sparkIn <= 0) {
      s.sparkIn = s.practice ? SPARK_EVERY : SPARK_EVERY + (SPARK_LATE - SPARK_EVERY) * clamp(s.t / s.duration, 0, 1);
      s.spark = SPARK_TIME;
    }
    // light
    s.litBy = litCount(s);
    const catchTime = s.practice ? CATCH_TIME : CATCH_TIME + (CATCH_LATE - CATCH_TIME) * clamp(s.t / s.duration, 0, 1);
    if (s.litBy > 0) s.caught += (dt / catchTime) * Math.min(1.5, s.litBy);
    else s.caught = Math.max(0, s.caught - CATCH_DECAY * dt);
    if (s.caught >= 1) {
      s.catches++;
      if (s.practice) {
        s.caught = 0;
        placeSolo(s, rng);
        s.steps = [];
      } else {
        s.caught = 1;
        s.won = true;
      }
    }
  },
  isOver: (s) => !s.practice && (s.won || s.t >= s.duration),
  result: (s) => teamRanks(s.players, [s.won ? 1 : 0]),
  bot(s, i, level, rng, dt) {
    const sk = skill(level);
    const p = s.ps[i];
    p.think -= dt;
    if (i === s.solo) {
      if (p.think <= 0) {
        p.think = sk.reaction * (0.7 + rng.next() * 0.6);
        const seekers = s.trio.map((k) => s.ps[k]);
        const threat = Math.min(...seekers.map((q) => dist(q.x, q.z, p.x, p.z)));
        const danger = s.litBy > 0 || threat < BEAM_LEN + { easy: 1.1, medium: 1.3, hard: 1.6 }[level] || seekers.some((q) => lights(q, p.x, p.z));
        const score = (x: number, z: number) => {
          let v = Math.min(...seekers.map((q) => dist(q.x, q.z, x, z)));
          if (inBush(s, x, z)) v += 2.5;
          if (Math.hypot(x, z) > R - 1.5) v -= 2; // the fence is a trap
          // don't run straight through a seeker
          const mx = (x + p.x) / 2;
          const mz = (z + p.z) / 2;
          const through = Math.min(...seekers.map((q) => dist(q.x, q.z, mx, mz)));
          return v + Math.min(0, through - 3.5) * 2;
        };
        const here = score(p.x, p.z);
        // the sparkle just gave the hiding place away: sneak somewhere else
        const revealed = s.spark > 0 && !danger && (!p.target || dist2(p.x, p.z, p.target.x, p.target.z) < 1);
        p.sneak = !danger;
        // once spooked, keep re-checking quickly
        if (danger) p.think = 0.12 + sk.reaction * 0.5 * (0.7 + rng.next() * 0.6);
        if (danger) {
          if (rng.chance(sk.accuracy + 0.3)) {
            // flee: pushed away from every seeker (closer = stronger), sideways out of beams,
            // and away from the fence
            let fx = 0;
            let fz = 0;
            for (const q of seekers) {
              const dx = p.x - q.x;
              const dz = p.z - q.z;
              const d2 = Math.max(0.5, dx * dx + dz * dz);
              fx += (dx / d2) * 4;
              fz += (dz / d2) * 4;
              if (lights(q, p.x, p.z)) {
                // step out of the beam sideways
                const bx = -Math.sin(q.ry);
                const bz = -Math.cos(q.ry);
                const side = -dx * bz + dz * bx > 0 ? 1 : -1;
                fx += -bz * side * SIDE_W;
                fz += bx * side * SIDE_W;
              }
            }
            const r = Math.hypot(p.x, p.z);
            if (r > R - 3.5) {
              fx -= (p.x / r) * (r - (R - 3.5)) * 0.6;
              fz -= (p.z / r) * (r - (R - 3.5)) * 0.6;
            }
            const ang = Math.atan2(fz, fx) + rng.noise() * (1 - sk.accuracy) * 0.8;
            // don't flee into the fence: turn along it (towards the side with more room);
            // keep running the way you already run (no dithering inside the beam)
            const prev = p.target ? Math.atan2(p.target.z - p.z, p.target.x - p.x) : null;
            let best = ang;
            let bestV = -Infinity;
            for (const da of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
              const tx = p.x + Math.cos(ang + da) * 4;
              const tz = p.z + Math.sin(ang + da) * 4;
              const out = Math.max(0, Math.hypot(tx, tz) - (R - 1.5));
              const room = Math.min(...seekers.map((q) => dist(q.x, q.z, tx, tz)));
              const keep = prev === null ? 0 : Math.cos(ang + da - prev) * FLEE_KEEP;
              const v = room - out * 3 - Math.abs(da) * 0.8 + keep;
              if (v > bestV) {
                bestV = v;
                best = ang + da;
              }
            }
            p.target = { x: p.x + Math.cos(best) * 4, z: p.z + Math.sin(best) * 4 };
          }
        } else if (revealed || !p.target || dist2(p.x, p.z, p.target.x, p.target.z) < 0.3 || here < 5) {
          if (rng.chance(sk.accuracy + 0.1)) {
            // calm: sneak to a good hiding place (bushes preferred) or stay put
            const cands = s.bushes.map((bb) => ({ x: bb.x, z: bb.z }));
            for (let k = 0; k < 6; k++) {
              const a = rng.next() * Math.PI * 2;
              const r = rng.next() * 5;
              cands.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r });
            }
            let best = { x: p.x, z: p.z };
            let bestV = revealed ? -Infinity : here + 1.5;
            for (const c of cands) {
              if (Math.hypot(c.x, c.z) > R - 0.8) continue;
              if (revealed && dist2(p.x, p.z, c.x, c.z) < 2.5 * 2.5) continue;
              const v = score(c.x, c.z) - dist(p.x, p.z, c.x, c.z) * 0.15 + rng.noise() * (1 - sk.accuracy) * 3;
              if (v > bestV) {
                bestV = v;
                best = c;
              }
            }
            p.target = best;
          }
        }
      }
      if (!p.target) return [{ type: 'stick', x: 0, y: 0 }];
      const st = steerTo(p.x, p.z, p.target.x, p.target.z, rng, sk.accuracy);
      // sneaking (half stick) leaves no footprints
      const f = p.sneak ? 0.5 : RUN[level];
      return [{ type: 'stick', x: st.x * f, y: st.y * f }];
    }
    // seekers: only use what everybody sees on the TV (light, footprints, sparkle)
    if (p.think <= 0) {
      p.think = sk.reaction * (0.7 + rng.next() * 0.6);
      const sp = s.ps[s.solo];
      const visible = s.litBy > 0 || s.spark > 0;
      if (visible && rng.chance(sk.accuracy + 0.15)) p.clue = { x: sp.x, z: sp.z, t: s.t };
      else {
        const fresh = s.steps.filter((st) => st.t <= STEP_LIFE).pop();
        if (fresh && rng.chance(sk.accuracy) && (!p.clue || p.clue.t < s.t - (STEP_LIFE + STEP_DELAY - fresh.t))) {
          // follow the trail a bit ahead in walking direction
          p.clue = { x: fresh.x - Math.sin(fresh.ry) * 1.5, z: fresh.z - Math.cos(fresh.ry) * 1.5, t: s.t - (STEP_LIFE + STEP_DELAY - fresh.t) };
        }
      }
      const clueAge = p.clue ? s.t - p.clue.t : 99;
      if (p.clue && clueAge < { easy: 3, medium: 4.5, hard: 6 }[level] && dist2(p.x, p.z, p.clue.x, p.clue.z) > 1) {
        // spread out a little around the clue so the trio doesn't walk in a line
        const k = s.trio.indexOf(i);
        const off = clueAge > 1 ? 1.6 : 0.3;
        const a = (k / 3) * Math.PI * 2;
        p.target = { x: p.clue.x + Math.cos(a) * off, z: p.clue.z + Math.sin(a) * off };
      } else if (!p.target || dist2(p.x, p.z, p.target.x, p.target.z) < 1.5 || rng.chance(0.04)) {
        // patrol: check a bush that no teammate is heading for
        p.clue = clueAge < 1 ? p.clue : null;
        const taken = s.trio.filter((k) => k !== i).map((k) => s.ps[k].target);
        const free = s.bushes.filter((b) => dist2(b.x, b.z, p.x, p.z) > 4 && taken.every((t) => !t || dist2(t.x, t.z, b.x, b.z) > 4));
        const b = free.length ? rng.pick(free) : rng.pick(s.bushes.length ? s.bushes : [{ x: 0, z: 0 }]);
        p.target = { x: b.x + rng.noise() * 0.8, z: b.z + rng.noise() * 0.8 };
      }
    }
    if (!p.target) return [{ type: 'stick', x: 0, y: 0 }];
    const st = steerTo(p.x, p.z, p.target.x, p.target.z, rng, sk.accuracy);
    return [{ type: 'stick', x: st.x * RUN[level], y: st.y * RUN[level] }];
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'garden', kind: 'cylinder', x: 0, y: -0.25, z: 0, sx: R * 2 + 1, sy: 0.5, sz: R * 2 + 1, color: '#2c4a3a' },
      { id: 'moon', kind: 'sphere', x: -R + 1, y: 9, z: R + 4, sx: 2.5, sy: 2.5, sz: 2.5, color: '#f4f1d0', glow: true },
    ];
    s.bushes.forEach((b, k) =>
      entities.push({ id: `bush${k}`, kind: 'sphere', x: b.x, y: 0.7, z: b.z, sx: BUSH_R * 2.1, sy: 1.6, sz: BUSH_R * 2.1, color: '#3d7d47' }),
    );
    for (const i of s.trio) {
      const p = s.ps[i];
      const fx = -Math.sin(p.ry);
      const fz = -Math.cos(p.ry);
      entities.push({ id: `p${i}`, kind: 'player', player: i, x: p.x, y: 0, z: p.z, ry: p.ry, anim: s.won ? 'cheer' : Math.hypot(p.vx, p.vz) > 0.6 ? 'walk' : 'idle' });
      entities.push({ id: `lantern${i}`, kind: 'lantern', x: p.x + fx * 0.6, y: 1.2, z: p.z + fz * 0.6, ry: p.ry, glow: true });
      // light on the ground – exactly the area that counts
      entities.push({
        id: `beam${i}`,
        kind: 'plane',
        x: p.x + fx * (BEAM_LEN / 2),
        y: 0.04,
        z: p.z + fz * (BEAM_LEN / 2),
        sx: BEAM_W,
        sz: BEAM_LEN,
        ry: p.ry,
        color: '#ffe9a0',
        alpha: 0.35,
        glow: true,
      });
      entities.push({ id: `glow${i}`, kind: 'cylinder', x: p.x, y: 0.03, z: p.z, sx: NEAR_R * 2, sy: 0.02, sz: NEAR_R * 2, color: '#ffe9a0', alpha: 0.25, glow: true });
    }
    // solo: only shown while lit, while sparkling or after the game
    const sp = s.ps[s.solo];
    const shown = s.litBy > 0 || s.spark > 0 || s.won || (!s.practice && s.t >= s.duration);
    if (shown) {
      entities.push({
        id: `p${s.solo}`,
        kind: 'player',
        player: s.solo,
        x: sp.x,
        y: 0,
        z: sp.z,
        ry: sp.ry,
        anim: s.won ? 'sad' : s.litBy > 0 ? 'hit' : Math.hypot(sp.vx, sp.vz) > 0.6 ? 'walk' : 'idle',
      });
    }
    if (s.spark > 0) entities.push({ id: 'spark', kind: 'star', x: sp.x, y: 2.3, z: sp.z, sx: 0.9, sy: 0.9, sz: 0.9, color: '#b8f0ff', glow: true });
    for (const st of s.steps) {
      if (st.t > STEP_LIFE) continue;
      entities.push({ id: `st${st.id}`, kind: 'cylinder', x: st.x, y: 0.03, z: st.z, sx: 0.45, sy: 0.02, sz: 0.6, ry: st.ry, color: '#9fe3ff', glow: true, alpha: (st.t / STEP_LIFE) * 0.8 });
    }
    // catch meter as a ring that fills over the solo when lit (visible to everybody)
    if (s.caught > 0.02 && shown) entities.push({ id: 'meter', kind: 'torus', x: sp.x, y: 2.6, z: sp.z, sx: 0.6 + s.caught * 1.2, sy: 1, sz: 0.6 + s.caught * 1.2, color: '#ffd23f', glow: true });
    const seconds = Math.max(0, s.duration - s.t);
    return {
      env: 'night',
      camera: { alpha: -Math.PI / 2, beta: 0.7, radius: 27, target: [0, 0, 0.5] },
      entities,
      hud: {
        timer: s.practice ? undefined : seconds,
        teams: [
          { team: 0, labelKey: 'team.solo', value: `${Math.ceil(seconds)} s` },
          { team: 1, labelKey: 'team.trio', value: `🔦 ${Math.round(s.caught * 100)} %` },
        ],
        bars: [{ player: s.solo, value: s.caught }],
        message: s.won
          ? { key: 'mg.laternenJagd.caught' }
          : s.litBy > 0
            ? { key: 'mg.laternenJagd.lit' }
            : !s.practice && s.t < HIDE_TIME
              ? { key: 'mg.laternenJagd.hide' }
              : undefined,
      },
    };
  },
};
