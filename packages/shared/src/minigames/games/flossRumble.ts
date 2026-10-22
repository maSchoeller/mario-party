import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import { botRef, type ControllerLayout, type MgEntity, type MgInput, type MgPlayer, type MinigameDef } from '../types';
import { TEAM_COLORS, ageFx, chance, clamp, emitFx, faceAngle, moveWithStick, reactTime, seenAt, seenBuf, seenPush, teamRanks, viewFx, type FxState, type SeenBuf } from '../util';
import { BOT_LIVE_LAG } from './botLag';

/**
 * #9 Floß-Rumble (2v2, Joystick + Button „Schubsen“): push the other team off a rocking,
 * slowly shrinking raft. Players in the water stay out (no climbing back). The team with
 * more players on board at the end wins – or instantly, once both opponents are swimming.
 * During the first SAFE_TIME seconds a railing keeps everybody on board (warm-up, MINI-03).
 * Tie-break at the time limit (same number on board): the team with more successful pushes
 * after the railing came off (pushes against the railing can't throw anybody off).
 */
const DURATION = 45;
const H0 = 5.5; // half size of the raft at start
const H_MIN = 3.2; // half size at the end
const SPEED = 5;
const BODY = 0.55; // player radius
const PUSH_RANGE = 1.9;
const PUSH_FORCE = 6.4;
const PUSH_CD = 0.9;
const KNOCK_DRAG = 3.2;
const FALL_TIME = 0.6;
const RESPAWN = 3; // practice only
/** railing at the start: nobody can fall during the first seconds */
export const SAFE_TIME = 6;
/** lagoon water level (visual) */
const WATER = -0.22;
/** bots by level: push attempts per second once an opponent is in reach, chance to step back from the edge */
const BOT_PUSH_RATE = { easy: 2, medium: 3, hard: 4 };
const BOT_CAREFUL = { easy: 0.5, medium: 0.8, hard: 0.95 };

interface P {
  team: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** knockback velocity */
  kx: number;
  kz: number;
  /** facing direction (unit) */
  fx: number;
  fz: number;
  stick: { x: number; y: number };
  pushCd: number;
  pushVis: number;
  stun: number;
  state: 'raft' | 'fall' | 'swim';
  fallT: number;
  y: number;
  /** bot memory: re-plan timer, target, perception delay, heading error, minds the edge */
  think: number;
  target: number;
  lag: number;
  hd: number;
  careful: boolean;
}

export interface FlossRumbleState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  ps: P[];
  half: number;
  sway: { x: number; z: number };
  /** -1 = running, 0/1 = winning team, 2 = tie */
  winner: number;
  overAt: number | null;
  /** successful pushes per team id after the railing came off (tie-break) */
  hits: number[];
  splashes: { x: number; z: number; t: number }[];
  /** bot form per player (v0.5) */
  form: number[];
  /** what the bots have seen: per player x, z, on the raft (1/0) */
  seen: SeenBuf;
}

const onBoard = (s: FlossRumbleState, team: number) => s.ps.filter((p) => p.team === team && p.state === 'raft').length;
const teamsOf = (s: FlossRumbleState) => [...new Set(s.players.map((p) => p.team))];

function doPush(s: FlossRumbleState, i: number): void {
  const p = s.ps[i];
  if (p.state !== 'raft' || p.pushCd > 0) return;
  const len = Math.hypot(p.stick.x, p.stick.y);
  let dx = p.fx;
  let dz = p.fz;
  if (len > 0.3) {
    dx = p.stick.x / len;
    dz = p.stick.y / len;
    p.fx = dx;
    p.fz = dz;
  }
  p.pushCd = PUSH_CD;
  p.pushVis = 0.3;
  // small lunge forward
  p.kx += dx * 1.5;
  p.kz += dz * 1.5;
  let landed = false;
  s.ps.forEach((o, j) => {
    if (j === i || o.state !== 'raft' || o.team === p.team) return;
    const ox = o.x - p.x;
    const oz = o.z - p.z;
    const d = Math.hypot(ox, oz);
    if (d > PUSH_RANGE || d < 1e-4) return;
    if ((ox * dx + oz * dz) / d < 0.25) return;
    // knock direction: mix of facing and the line between both players
    let kx = ox / d + dx;
    let kz = oz / d + dz;
    const kl = Math.hypot(kx, kz) || 1;
    kx /= kl;
    kz /= kl;
    // a player that is pushing back at the same moment gets knocked less
    const brace = o.pushVis > 0 && (o.fx * -ox + o.fz * -oz) / d > 0.5 ? 0.5 : 1;
    o.kx += kx * PUSH_FORCE * brace;
    o.kz += kz * PUSH_FORCE * brace;
    o.stun = 0.45;
    if (s.practice || s.t >= SAFE_TIME) s.hits[p.team] = (s.hits[p.team] ?? 0) + 1;
    emitFx(s, { kind: 'hit', sfx: 'thud', x: o.x, y: 1.2, z: o.z, s: brace < 1 ? 0.7 : 1 });
    landed = true;
  });
  // a push into thin air just swooshes
  if (!landed) emitFx(s, { sfx: 'swing', x: p.x + dx, y: 1, z: p.z + dz });
}

function respawnSpot(s: FlossRumbleState, i: number): { x: number; z: number } {
  const p = s.ps[i];
  return { x: p.team === 0 ? -1.5 : 1.5, z: (i % 2 ? 1 : -1) * 1.2 };
}

export const flossRumble: MinigameDef<FlossRumbleState> = {
  id: 'flossRumble',
  format: '2v2',
  control: 'joystick',
  theme: 'island',
  duration: DURATION,
  setup(players, _rng, opts) {
    // each team starts on its own side of the raft
    const seen = [0, 0];
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      ps: players.map((pl) => {
        const k = seen[pl.team === 0 ? 0 : 1]++;
        const side = pl.team === 0 ? -1 : 1;
        return {
          team: pl.team,
          x: side * 2.6,
          z: k === 0 ? -1.6 : 1.6,
          vx: 0,
          vz: 0,
          kx: 0,
          kz: 0,
          fx: -side,
          fz: 0,
          stick: { x: 0, y: 0 },
          pushCd: 0,
          pushVis: 0,
          stun: 0,
          state: 'raft' as const,
          fallT: 0,
          y: 0,
          think: 0,
          target: -1,
          lag: 0.4,
          hd: 0,
          careful: true,
        };
      }),
      half: H0,
      sway: { x: 0, z: 0 },
      winner: -1,
      overAt: null,
      hits: [0, 0],
      splashes: [],
      form: players.map((p) => p.form ?? 1),
      seen: seenBuf(),
      fx: [],
      fxN: 0,
    };
  },
  layout(s, i): ControllerLayout {
    if (s.ps[i].state !== 'raft') return { kind: 'wait', labelKey: s.practice ? 'mg.flossRumble.respawn' : 'mg.flossRumble.splash' };
    return { kind: 'joystick', buttons: [{ id: 'push', labelKey: 'ctrl.push' }] };
  },
  input(s, i, input: MgInput) {
    const p = s.ps[i];
    if (input.type === 'stick') p.stick = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
    else if (input.type === 'button' && input.id === 'push' && input.down && s.winner < 0) doPush(s, i);
  },
  tick(s, dt) {
    const prevT = s.t;
    s.t += dt;
    ageFx(s, dt);
    if (s.winner >= 0) {
      for (const p of s.ps) if (p.state === 'fall' && (p.fallT += dt) > FALL_TIME) p.state = 'swim';
      return;
    }
    s.half = s.practice ? H0 : H0 - (H0 - H_MIN) * clamp(s.t / s.duration, 0, 1);
    // gentle rocking: the raft slowly pushes everybody a little to one side
    const rock = 0.35 + 0.5 * clamp(s.t / s.duration, 0, 1);
    s.sway = { x: Math.sin(s.t * 0.9) * rock, z: Math.sin(s.t * 0.63 + 1.3) * rock * 0.8 };
    const H = s.half;
    if (!s.practice && prevT < SAFE_TIME && s.t >= SAFE_TIME) {
      // the railing comes off: puffs at all four sides
      emitFx(s, { kind: 'dust', sfx: 'creak', x: 0, y: 0.6, z: -H, s: 1.2 }, 0.5);
      emitFx(s, { kind: 'dust', x: 0, y: 0.6, z: H, s: 1.2 }, 0.5);
      emitFx(s, { kind: 'dust', x: -H, y: 0.6, z: 0, s: 1.2 }, 0.5);
      emitFx(s, { kind: 'dust', x: H, y: 0.6, z: 0, s: 1.2 }, 0.5);
    }
    // now and then a wave slaps against the rocking raft and the planks creak
    if (s.t > SAFE_TIME && Math.floor(s.t / 7.5) !== Math.floor(prevT / 7.5)) {
      const k = Math.floor(s.t / 7.5) % 4;
      const [ex, ez] = [
        [-1, 0.4],
        [0.3, 1],
        [1, -0.5],
        [-0.4, -1],
      ][k];
      emitFx(s, { kind: 'splash', sfx: 'creak', x: ex * (H + 0.3), y: WATER, z: ez * (H + 0.3), s: 0.7 }, 0.5);
    }
    s.ps.forEach((p, i) => {
      p.pushCd = Math.max(0, p.pushCd - dt);
      p.pushVis = Math.max(0, p.pushVis - dt);
      if (p.state === 'raft') {
        const lim = H - BODY * 0.5;
        // the railing only stops players from crossing the edge (not ones already outside)
        const railing = !s.practice && s.t < SAFE_TIME && Math.abs(p.x) <= H + 0.15 && Math.abs(p.z) <= H + 0.15;
        const ctrl = p.stun > 0 ? 0.25 : 1;
        p.stun = Math.max(0, p.stun - dt);
        moveWithStick(p, { x: p.stick.x * ctrl, y: p.stick.y * ctrl }, SPEED, dt);
        const drag = Math.exp(-KNOCK_DRAG * dt);
        p.x += (p.kx + s.sway.x) * dt;
        p.z += (p.kz + s.sway.z) * dt;
        p.kx *= drag;
        p.kz *= drag;
        if (Math.hypot(p.stick.x, p.stick.y) > 0.3) {
          const l = Math.hypot(p.stick.x, p.stick.y);
          p.fx = p.stick.x / l;
          p.fz = p.stick.y / l;
        }
        if (railing) {
          // the railing holds: stay on board
          if (Math.abs(p.x) > lim) {
            p.x = Math.sign(p.x) * lim;
            p.kx = 0;
          }
          if (Math.abs(p.z) > lim) {
            p.z = Math.sign(p.z) * lim;
            p.kz = 0;
          }
        } else if (Math.abs(p.x) > H + 0.15 || Math.abs(p.z) > H + 0.15) {
          p.state = 'fall';
          p.fallT = 0;
          s.splashes.push({ x: p.x, z: p.z, t: 0.8 });
          emitFx(s, { kind: 'splash', sfx: 'splash', x: p.x, y: WATER, z: p.z, s: 1.4 }, 0.5);
        }
      } else if (p.state === 'fall') {
        p.fallT += dt;
        p.x += (p.vx + p.kx) * dt * 0.5;
        p.z += (p.vz + p.kz) * dt * 0.5;
        p.y = -1.2 * (p.fallT / FALL_TIME);
        if (p.fallT >= FALL_TIME) {
          p.state = 'swim';
          p.fallT = 0;
        }
      } else {
        // swimming: drift slowly away from the raft – no way back on board
        p.fallT += dt;
        p.y = -0.9 + Math.sin(s.t * 3 + i) * 0.08;
        const ax = Math.abs(p.x);
        const az = Math.abs(p.z);
        const minOut = H + 1.3;
        if (ax >= az) p.x += Math.sign(p.x || 1) * Math.max(0, Math.min(0.8 * dt, minOut + 0.6 - ax));
        else p.z += Math.sign(p.z || 1) * Math.max(0, Math.min(0.8 * dt, minOut + 0.6 - az));
        if (Math.abs(p.x) < minOut && Math.abs(p.z) < minOut) {
          if (ax >= az) p.x = Math.sign(p.x || 1) * minOut;
          else p.z = Math.sign(p.z || 1) * minOut;
        }
        if (s.practice && p.fallT > RESPAWN) {
          const r = respawnSpot(s, i);
          emitFx(s, { kind: 'sparkle', sfx: 'pop', x: r.x, y: 1, z: r.z });
          Object.assign(p, { state: 'raft', x: r.x, z: r.z, y: 0, vx: 0, vz: 0, kx: 0, kz: 0, stun: 0, fallT: 0 });
        }
      }
    });
    // body collisions on the raft
    for (let a = 0; a < s.ps.length; a++) {
      for (let b = a + 1; b < s.ps.length; b++) {
        const pa = s.ps[a];
        const pb = s.ps[b];
        if (pa.state !== 'raft' || pb.state !== 'raft') continue;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const d = Math.hypot(dx, dz);
        if (d >= BODY * 2 || d < 1e-6) continue;
        const push = (BODY * 2 - d) / 2;
        pa.x -= (dx / d) * push;
        pa.z -= (dz / d) * push;
        pb.x += (dx / d) * push;
        pb.z += (dz / d) * push;
      }
    }
    s.splashes = s.splashes.filter((sp) => (sp.t -= dt) > 0);
    if (s.practice) return;
    const [ta, tb] = teamsOf(s);
    const na = onBoard(s, ta);
    const nb = onBoard(s, tb ?? 1 - ta);
    if (na === 0 || nb === 0 || s.t >= s.duration) {
      const hb = tb ?? 1 - ta;
      if (na !== nb) s.winner = na > nb ? ta : hb;
      else {
        // same number on board: more successful pushes wins
        const ha = s.hits[ta] ?? 0;
        const hh = s.hits[hb] ?? 0;
        s.winner = ha === hh ? 2 : ha > hh ? ta : hb;
      }
      s.overAt = s.t + (s.t >= s.duration ? 0 : 1.2);
    }
  },
  isOver: (s) => !s.practice && s.overAt !== null && s.t >= s.overAt,
  result(s) {
    if (s.winner === 2 || s.winner < 0) {
      const teams = teamsOf(s);
      const best = Math.max(...teams.map((t) => onBoard(s, t)));
      return teamRanks(s.players, teams.filter((t) => onBoard(s, t) === best));
    }
    return teamRanks(s.players, [s.winner]);
  },
  bot(s, i, level: BotLevel, rng: Rng, dt) {
    const p = s.ps[i];
    // what the bots see on the TV: everybody's position, read back late
    if (s.seen.t[s.seen.t.length - 1] !== s.t) seenPush(s.seen, s.t, s.ps.flatMap((o) => [o.x, o.z, o.state === 'raft' ? 1 : 0]), 1);
    if (p.state !== 'raft' || s.winner >= 0) return [{ type: 'stick', x: 0, y: 0 }];
    const ref = botRef(level, s.form[i]);
    const H = s.half;
    const now = seenAt(s.seen, s.t - p.lag)!;
    const me = seenAt(s.seen, s.t - BOT_LIVE_LAG)!;
    const mx = me[i * 3];
    const mz = me[i * 3 + 1];
    const out: MgInput[] = [];
    p.think -= dt;
    if (p.think <= 0) {
      // re-plan on what was seen one reaction time ago
      p.think = 0.25 + rng.next() * 0.2;
      p.lag = reactTime(ref, rng, BOT_LIVE_LAG);
      p.hd = rng.noise() * ref.headingNoise;
      p.careful = rng.next() < BOT_CAREFUL[level];
      const opps = s.ps.map((o, j) => ({ o, j })).filter(({ o, j }) => o.team !== p.team && now[j * 3 + 2]);
      const ox = (j: number) => now[j * 3];
      const oz = (j: number) => now[j * 3 + 1];
      if (!opps.length) p.target = -1;
      else if (level === 'easy' || rng.next() < 0.3) {
        // nearest opponent
        opps.sort((a, b) => Math.hypot(ox(a.j) - mx, oz(a.j) - mz) - Math.hypot(ox(b.j) - mx, oz(b.j) - mz));
        p.target = opps[0].j;
      } else {
        // smarter: the opponent closest to the edge (easier to push off), weighted by distance
        const score = (j: number) => H - Math.max(Math.abs(ox(j)), Math.abs(oz(j))) + Math.hypot(ox(j) - mx, oz(j) - mz) * 0.4;
        opps.sort((a, b) => score(a.j) - score(b.j));
        p.target = opps[0].j;
      }
    }
    const myEdge = H - Math.max(Math.abs(mx), Math.abs(mz));
    let goal: { x: number; z: number } | null = null;
    if (myEdge < 1.1 && p.careful) {
      goal = { x: mx * 0.4, z: mz * 0.4 };
    } else if (p.target >= 0 && now[p.target * 3 + 2]) {
      const tx = now[p.target * 3];
      const tz = now[p.target * 3 + 1];
      // position on the inner side of the opponent, so the push goes towards the closest edge
      let ux: number;
      let uz: number;
      if (Math.abs(tx) >= Math.abs(tz)) {
        ux = Math.sign(tx || 1);
        uz = 0;
      } else {
        ux = 0;
        uz = Math.sign(tz || 1);
      }
      const behind = level === 'easy' ? 0 : 1.15;
      goal = { x: tx - ux * behind, z: tz - uz * behind };
      const d = Math.hypot(tx - mx, tz - mz);
      if (d < PUSH_RANGE * 0.85 && p.pushCd <= 0 && rng.next() < chance(BOT_PUSH_RATE[level], dt)) {
        const a = Math.atan2(tz - mz, tx - mx) + rng.noise() * ref.headingNoise;
        out.push({ type: 'stick', x: Math.cos(a), y: Math.sin(a) });
        out.push({ type: 'button', id: 'push', down: true }, { type: 'button', id: 'push', down: false });
        return out;
      }
    }
    if (!goal) {
      out.push({ type: 'stick', x: 0, y: 0 });
      return out;
    }
    const gx = goal.x - mx;
    const gz = goal.z - mz;
    const len = Math.hypot(gx, gz);
    if (len < 0.15) {
      out.push({ type: 'stick', x: 0, y: 0 });
      return out;
    }
    const a = Math.atan2(gz, gx) + p.hd;
    const mag = ref.stickMag * clamp(len / 1.2, 0.3, 1);
    out.push({ type: 'stick', x: Math.cos(a) * mag, y: Math.sin(a) * mag });
    return out;
  },
  view(s) {
    const H = s.half;
    const bob = Math.sin(s.t * 1.4) * 0.06;
    const tiltX = s.sway.z * 0.05;
    const tiltZ = -s.sway.x * 0.05;
    // height of the rocking raft deck at (x, z): everything on board follows the tilt
    const ry0 = (x: number, z: number) => bob + x * Math.sin(tiltZ) - z * Math.sin(tiltX);
    const entities: MgEntity[] = [
      // sandbars with palms in the lagoon behind the raft
      { id: 'isle1', kind: 'cylinder', x: -15, y: WATER - 0.3, z: 10.5, sx: 8, sy: 0.7, sz: 5.5, color: '#efe0b8', mat: 'sand', taper: 0.72 },
      { id: 'palm1', kind: 'palm', x: -15.4, y: WATER + 0.05, z: 11 },
      { id: 'isle1b', kind: 'prop', prop: 'bush', x: -13.6, y: WATER + 0.05, z: 9.8, sx: 0.9 },
      { id: 'isle1c', kind: 'prop', prop: 'rocksmall', x: -17, y: WATER + 0.02, z: 9.6, sx: 1.6 },
      { id: 'isle2', kind: 'cylinder', x: 15.5, y: WATER - 0.3, z: 11.5, sx: 6.5, sy: 0.7, sz: 4.5, color: '#efe0b8', mat: 'sand', taper: 0.7 },
      { id: 'palm2', kind: 'prop', prop: 'palm2', x: 15.8, y: WATER + 0.05, z: 12, ry: 3.5 },
      { id: 'isle2b', kind: 'prop', prop: 'driftwood', x: 14.2, y: WATER + 0.05, z: 10.6, ry: 0.4 },
      { id: 'isle2c', kind: 'prop', prop: 'shell', x: 16.6, y: WATER + 0.05, z: 10.4 },
      // channel buoys and a moored dinghy
      { id: 'buoy1', kind: 'prop', prop: 'buoy', x: -10.2, y: WATER - 0.08 + Math.sin(s.t * 1.7) * 0.05, z: -5.5, rz: Math.sin(s.t * 1.3) * 0.08, sx: 0.8, color: '#e8676b' },
      { id: 'buoy2', kind: 'prop', prop: 'buoy', x: 10.4, y: WATER - 0.08 + Math.sin(s.t * 1.5 + 1) * 0.05, z: -4.5, rz: Math.sin(s.t * 1.1 + 2) * 0.08, sx: 0.8, color: '#5f8fe0' },
      { id: 'buoy3', kind: 'prop', prop: 'buoy', x: 9.8, y: WATER - 0.08 + Math.sin(s.t * 1.6 + 2) * 0.05, z: 8.5, rz: Math.sin(s.t * 1.2 + 1) * 0.08, sx: 0.7, color: '#f2c94c' },
      { id: 'dinghy', kind: 'boat', x: -11.5, y: WATER - 0.12 + Math.sin(s.t * 1.2) * 0.04, z: 6.5, ry: 0.5, rz: Math.sin(s.t * 0.9) * 0.04, color: '#e8676b' },
    ];
    const planks = 7;
    const w = (2 * H) / planks;
    for (let k = 0; k < planks; k++) {
      const x = -H + w * (k + 0.5);
      entities.push({
        id: `plank${k}`,
        kind: 'box',
        x,
        y: -0.2 + ry0(x, 0),
        z: 0,
        sx: w * 0.94,
        sy: 0.4,
        sz: 2 * H,
        rx: tiltX,
        rz: tiltZ,
        color: k % 2 ? '#c08a55' : '#d4a26b',
        mat: 'wood',
      });
    }
    // rope lashings across the planks and the cross beams below
    for (const side of [-1, 1]) {
      const z = side * (H - 0.75);
      entities.push({ id: `lash${side}`, kind: 'box', x: 0, y: 0.04 + ry0(0, z), z, sx: 2 * H + 0.08, sy: 0.14, sz: 0.2, rx: tiltX, rz: tiltZ, color: '#d9bd86', mat: 'rope' });
      // the cross beams stay under the planks (their ends would cut through the bobbing water)
      entities.push({ id: `beam${side}`, kind: 'box', x: 0, y: -0.45 + ry0(0, side * (H - 0.5)), z: side * (H - 0.5), sx: 2 * H - 0.1, sy: 0.3, sz: 0.5, rx: tiltX, rz: tiltZ, color: '#8a5a32', mat: 'wood' });
    }
    if (!s.practice && s.t < SAFE_TIME) {
      // rope railing on posts (disappears when the warm-up is over)
      const a = clamp(SAFE_TIME - s.t, 0, 1);
      for (const [k, x, z, sx, sz] of [
        [0, -H, 0, 0.12, 2 * H],
        [1, H, 0, 0.12, 2 * H],
        [2, 0, -H, 2 * H, 0.12],
        [3, 0, H, 2 * H, 0.12],
      ] as const) {
        entities.push({ id: `rail${k}`, kind: 'box', x, y: 0.75 + ry0(x, z), z, sx, sy: 0.12, sz, rx: tiltX, rz: tiltZ, color: '#e8d4a8', mat: 'rope', alpha: a });
      }
      let n = 0;
      for (const px of [-1, 0, 1]) {
        for (const pz of [-1, 0, 1]) {
          if (px === 0 && pz === 0) continue;
          const x = px * H;
          const z = pz * H;
          entities.push({ id: `post${n++}`, kind: 'cylinder', x, y: 0.4 + ry0(x, z), z, sx: 0.16, sy: 0.8, sz: 0.16, color: '#8a5a32', mat: 'wood', alpha: a });
        }
      }
    }
    // team flags in the back corners show which side belongs to whom
    for (const team of [0, 1]) {
      const side = team === 0 ? -1 : 1;
      const x = side * (H - 0.3);
      const z = H - 0.3;
      entities.push({ id: `flag${team}`, kind: 'prop', prop: 'flag', x, y: ry0(x, z), z, ry: team === 0 ? 0 : Math.PI, rx: tiltX, rz: tiltZ, sx: 0.72, color: TEAM_COLORS[team] });
    }
    s.ps.forEach((p, i) => {
      const onRaft = p.state === 'raft';
      const won = s.winner >= 0 && s.winner !== 2 && p.team === s.winner;
      const py = onRaft ? ry0(p.x, p.z) : p.y;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: p.x,
        y: py,
        z: p.z,
        ry: faceAngle(p.fx, p.fz),
        anim: won && onRaft ? 'cheer' : !onRaft ? 'sad' : p.stun > 0 ? 'hit' : p.pushVis > 0 ? 'jump' : Math.hypot(p.vx, p.vz) > 0.6 ? 'walk' : 'idle',
      });
      if (onRaft) entities.push({ id: `ring${i}`, kind: 'torus', x: p.x, y: py + 0.06, z: p.z, sx: 1.4, sy: 1, sz: 1.4, color: TEAM_COLORS[p.team] ?? '#ffffff' });
      else entities.push({ id: `tube${i}`, kind: 'torus', x: p.x, y: WATER + 0.06 + Math.sin(s.t * 3 + i) * 0.05, z: p.z, sx: 1.5, sy: 1.6, sz: 1.5, color: TEAM_COLORS[p.team] ?? '#ffffff' });
      if (onRaft && p.pushVis > 0) entities.push({ id: `push${i}`, kind: 'sphere', x: p.x + p.fx * 1.1, y: 0.9 + py, z: p.z + p.fz * 1.1, sx: 0.8, sy: 0.8, sz: 0.8, color: '#ffffff', alpha: p.pushVis * 2.5 });
    });
    const dots = (team: number) => {
      const members = s.ps.filter((p) => p.team === team);
      return members.map((p) => (p.state === 'raft' ? '●' : '○')).join(' ');
    };
    return {
      env: 'water',
      scenery: { set: 'lagoon', clear: { r: 10 }, water: WATER },
      camera: { alpha: -Math.PI / 2, beta: 0.82, radius: 21, target: [0, 0, 0.6] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: [
          { team: 0, labelKey: 'team.red', value: `${dots(0)} · 👊 ${s.hits[0] ?? 0}` },
          { team: 1, labelKey: 'team.blue', value: `${dots(1)} · 👊 ${s.hits[1] ?? 0}` },
        ],
        message:
          s.winner >= 0 && s.winner !== 2 && s.t < s.duration
            ? { key: 'mg.flossRumble.overboard' }
            : !s.practice && s.t < SAFE_TIME
              ? { key: 'mg.flossRumble.rail', params: { s: Math.ceil(SAFE_TIME - s.t) } }
              : undefined,
      },
    };
  },
};
