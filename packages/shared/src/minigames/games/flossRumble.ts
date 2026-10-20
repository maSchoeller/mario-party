import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { TEAM_COLORS, clamp, faceAngle, moveWithStick, skill, steerTo, teamRanks } from '../util';

/**
 * #9 Floß-Rumble (2v2, Joystick + Button „Schubsen“): push the other team off a rocking,
 * slowly shrinking raft. Players in the water stay out (no climbing back). The team with
 * more players on board at the end wins – or instantly, once both opponents are swimming.
 */
const DURATION = 45;
const H0 = 5.5; // half size of the raft at start
const H_MIN = 3.2; // half size at the end
const SPEED = 5;
const BODY = 0.55; // player radius
const PUSH_RANGE = 1.9;
const PUSH_FORCE = 7;
const PUSH_CD = 0.9;
const KNOCK_DRAG = 3.2;
const FALL_TIME = 0.6;
const RESPAWN = 3; // practice only

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
  /** bot memory */
  think: number;
  target: number;
}

export interface FlossRumbleState {
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
  splashes: { x: number; z: number; t: number }[];
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
  });
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
        };
      }),
      half: H0,
      sway: { x: 0, z: 0 },
      winner: -1,
      overAt: null,
      splashes: [],
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
    s.t += dt;
    if (s.winner >= 0) {
      for (const p of s.ps) if (p.state === 'fall' && (p.fallT += dt) > FALL_TIME) p.state = 'swim';
      return;
    }
    s.half = s.practice ? H0 : H0 - (H0 - H_MIN) * clamp(s.t / s.duration, 0, 1);
    // gentle rocking: the raft slowly pushes everybody a little to one side
    const rock = 0.35 + 0.5 * clamp(s.t / s.duration, 0, 1);
    s.sway = { x: Math.sin(s.t * 0.9) * rock, z: Math.sin(s.t * 0.63 + 1.3) * rock * 0.8 };
    const H = s.half;
    s.ps.forEach((p, i) => {
      p.pushCd = Math.max(0, p.pushCd - dt);
      p.pushVis = Math.max(0, p.pushVis - dt);
      if (p.state === 'raft') {
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
        if (Math.abs(p.x) > H + 0.15 || Math.abs(p.z) > H + 0.15) {
          p.state = 'fall';
          p.fallT = 0;
          s.splashes.push({ x: p.x, z: p.z, t: 0.8 });
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
      s.winner = na === nb ? 2 : na > nb ? ta : tb ?? 1 - ta;
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
    if (p.state !== 'raft' || s.winner >= 0) return [{ type: 'stick', x: 0, y: 0 }];
    const sk = skill(level);
    const H = s.half;
    const out: MgInput[] = [];
    p.think -= dt;
    if (p.think <= 0) {
      p.think = sk.reaction * (0.6 + rng.next() * 0.8);
      const opps = s.ps.map((o, j) => ({ o, j })).filter(({ o }) => o.team !== p.team && o.state === 'raft');
      if (!opps.length) p.target = -1;
      else if (level === 'easy' || rng.chance(0.3)) {
        // nearest opponent
        opps.sort((a, b) => Math.hypot(a.o.x - p.x, a.o.z - p.z) - Math.hypot(b.o.x - p.x, b.o.z - p.z));
        p.target = opps[0].j;
      } else {
        // smarter: the opponent closest to the edge (easier to push off), weighted by distance
        const score = (o: P) => H - Math.max(Math.abs(o.x), Math.abs(o.z)) + Math.hypot(o.x - p.x, o.z - p.z) * 0.4;
        opps.sort((a, b) => score(a.o) - score(b.o));
        p.target = opps[0].j;
      }
    }
    const myEdge = H - Math.max(Math.abs(p.x), Math.abs(p.z));
    let goal: { x: number; z: number } | null = null;
    if (myEdge < 1.1 && rng.chance(0.3 + sk.accuracy * 0.7)) {
      goal = { x: p.x * 0.4, z: p.z * 0.4 };
    } else if (p.target >= 0 && s.ps[p.target].state === 'raft') {
      const o = s.ps[p.target];
      // position on the inner side of the opponent, so the push goes towards the closest edge
      let ux: number;
      let uz: number;
      if (Math.abs(o.x) >= Math.abs(o.z)) {
        ux = Math.sign(o.x || 1);
        uz = 0;
      } else {
        ux = 0;
        uz = Math.sign(o.z || 1);
      }
      const behind = level === 'easy' ? 0 : 1.15;
      goal = { x: o.x - ux * behind, z: o.z - uz * behind };
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < PUSH_RANGE * 0.85 && p.pushCd <= 0 && rng.chance(sk.accuracy * dt * 4)) {
        const aim = steerTo(p.x, p.z, o.x, o.z, rng, sk.accuracy);
        out.push({ type: 'stick', x: aim.x, y: aim.y });
        out.push({ type: 'button', id: 'push', down: true }, { type: 'button', id: 'push', down: false });
        return out;
      }
    }
    const stick = goal ? steerTo(p.x, p.z, goal.x, goal.z, rng, sk.accuracy) : { x: 0, y: 0 };
    out.push({ type: 'stick', x: stick.x * sk.speed, y: stick.y * sk.speed });
    return out;
  },
  view(s) {
    const H = s.half;
    const bob = Math.sin(s.t * 1.4) * 0.06;
    const tiltX = s.sway.z * 0.05;
    const tiltZ = -s.sway.x * 0.05;
    const entities: MgEntity[] = [
      { id: 'isle1', kind: 'cylinder', x: -15, y: -0.3, z: 11, sx: 7, sy: 0.8, sz: 5, color: '#efe2c0' },
      { id: 'palm1', kind: 'palm', x: -15, y: 0, z: 11.5 },
      { id: 'isle2', kind: 'cylinder', x: 15, y: -0.3, z: 12, sx: 6, sy: 0.8, sz: 4, color: '#efe2c0' },
      { id: 'palm2', kind: 'palm', x: 15.5, y: 0, z: 12.5 },
    ];
    const planks = 7;
    const w = (2 * H) / planks;
    for (let k = 0; k < planks; k++) {
      entities.push({
        id: `plank${k}`,
        kind: 'box',
        x: -H + w * (k + 0.5),
        y: -0.2 + bob,
        z: 0,
        sx: w * 0.93,
        sy: 0.4,
        sz: 2 * H,
        rx: tiltX,
        rz: tiltZ,
        color: k % 2 ? '#b98350' : '#cf9a62',
      });
    }
    for (const side of [-1, 1]) {
      entities.push({ id: `beam${side}`, kind: 'box', x: 0, y: -0.38 + bob, z: side * (H - 0.5), sx: 2 * H + 0.6, sy: 0.3, sz: 0.5, rx: tiltX, rz: tiltZ, color: '#8a5a32' });
    }
    // team corner flags show which side belongs to whom at the start
    for (const team of [0, 1]) {
      const side = team === 0 ? -1 : 1;
      entities.push({ id: `pole${team}`, kind: 'cylinder', x: side * (H - 0.3), y: 1.2 + bob, z: H - 0.3, sx: 0.12, sy: 2.4, sz: 0.12, color: '#7a5c45' });
      entities.push({ id: `flag${team}`, kind: 'box', x: side * (H - 0.3) - side * 0.5, y: 2.1 + bob, z: H - 0.3, sx: 0.9, sy: 0.6, sz: 0.06, color: TEAM_COLORS[team] });
    }
    s.ps.forEach((p, i) => {
      const onRaft = p.state === 'raft';
      const won = s.winner >= 0 && s.winner !== 2 && p.team === s.winner;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: p.x,
        y: onRaft ? bob : p.y,
        z: p.z,
        ry: faceAngle(p.fx, p.fz),
        anim: won && onRaft ? 'cheer' : !onRaft ? 'sad' : p.stun > 0 ? 'hit' : p.pushVis > 0 ? 'jump' : Math.hypot(p.vx, p.vz) > 0.6 ? 'walk' : 'idle',
      });
      if (onRaft) entities.push({ id: `ring${i}`, kind: 'torus', x: p.x, y: 0.05 + bob, z: p.z, sx: 1.4, sy: 1, sz: 1.4, color: TEAM_COLORS[p.team] ?? '#ffffff' });
      else entities.push({ id: `tube${i}`, kind: 'torus', x: p.x, y: -0.15, z: p.z, sx: 1.5, sy: 1.6, sz: 1.5, color: TEAM_COLORS[p.team] ?? '#ffffff' });
      if (onRaft && p.pushVis > 0) entities.push({ id: `push${i}`, kind: 'sphere', x: p.x + p.fx * 1.1, y: 0.9, z: p.z + p.fz * 1.1, sx: 0.8, sy: 0.8, sz: 0.8, color: '#ffffff', alpha: p.pushVis * 2.5 });
    });
    s.splashes.forEach((sp, k) => entities.push({ id: `splash${k}`, kind: 'sphere', x: sp.x, y: -0.2, z: sp.z, sx: 2.6 - sp.t, sy: 0.6, sz: 2.6 - sp.t, color: '#ffffff', alpha: sp.t }));
    const dots = (team: number) => {
      const members = s.ps.filter((p) => p.team === team);
      return members.map((p) => (p.state === 'raft' ? '●' : '○')).join(' ');
    };
    return {
      env: 'water',
      camera: { alpha: -Math.PI / 2, beta: 0.82, radius: 21, target: [0, 0, 0.6] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: [
          { team: 0, labelKey: 'team.red', value: dots(0) },
          { team: 1, labelKey: 'team.blue', value: dots(1) },
        ],
        message: s.winner >= 0 && s.winner !== 2 && s.t < s.duration ? { key: 'mg.flossRumble.overboard' } : undefined,
      },
    };
  },
};
