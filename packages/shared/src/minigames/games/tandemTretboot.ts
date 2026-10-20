import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { TEAM_COLORS, clamp, faceAngle, teamRanks } from '../util';

/**
 * #10 Tandem-Tretboot (2v2, Rhythmus-Tippen): each team pedals one boat. The two team
 * members must tap ALTERNATELY (A, B, A, B …). An even rhythm gives speed, tapping twice in
 * a row makes the boat stall. First team at the finish buoy – or further ahead at the end – wins.
 * Press times come from the phone clock (NET-05), so the rhythm is judged fairly.
 */
const DURATION = 45;
const COURSE = 140;
const BOOST = 1.0;
const DRAG = 0.8;
const VMAX = 7;
const STALL = 0.6;
/** after this pause the rhythm starts over and either player may begin */
const RESET_AFTER = 1.5;
const LANE_Z = [2.4, -2.4];

interface Boat {
  team: number;
  /** minigame player indices: [first, second] */
  members: number[];
  pos: number;
  v: number;
  /** role (0/1) expected next, -1 = anyone may start */
  next: number;
  lastT: number | null;
  lastInterval: number | null;
  stall: number;
  quality: number;
  strokeVis: number[];
  finishedAt: number | null;
}

export interface TandemTretbootState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  boats: Boat[];
  /** player -> boat index / role */
  boatOf: number[];
  roleOf: number[];
  /** bot memory per player */
  botPlan: (number | null)[];
  botOops: (number | null)[];
}

function stroke(s: TandemTretbootState, i: number, t: number): void {
  const b = s.boats[s.boatOf[i]];
  const role = s.roleOf[i];
  if (b.finishedAt !== null || b.stall > 0) return;
  const tp = Math.max(clamp(t, s.t - 0.5, s.t), b.lastT ?? -Infinity);
  if (b.next === -1 || b.next === role || b.members.length < 2) {
    let q = 0.6;
    if (b.lastT !== null) {
      const interval = tp - b.lastT;
      let tempo = 1;
      if (interval < 0.22) tempo = clamp(0.25 + ((interval - 0.12) / 0.1) * 0.75, 0.25, 1); // too hectic
      else if (interval > 0.7) tempo = clamp(1 - (interval - 0.7), 0.2, 1); // too slow
      const even = b.lastInterval === null ? 0.7 : 1 - Math.min(1, Math.abs(interval - b.lastInterval) / Math.max(b.lastInterval, 0.15));
      q = (0.45 + 0.55 * even) * tempo;
      b.lastInterval = interval;
    }
    b.quality = q;
    b.v = Math.min(VMAX, b.v + BOOST * q);
    b.lastT = tp;
    b.next = b.members.length < 2 ? -1 : 1 - role;
    b.strokeVis[role] = 0.3;
  } else {
    // same player twice in a row: the pedals jam
    b.v *= 0.35;
    b.stall = STALL;
    b.quality = 0;
    b.lastInterval = null;
  }
}

export const tandemTretboot: MinigameDef<TandemTretbootState> = {
  id: 'tandemTretboot',
  format: '2v2',
  control: 'tap',
  theme: 'island',
  duration: DURATION,
  setup(players, _rng, opts) {
    const teams = [...new Set(players.map((p) => p.team))].sort();
    const boats: Boat[] = teams.map((team) => ({
      team,
      members: players.filter((p) => p.team === team).map((p) => p.idx),
      pos: 0,
      v: 0,
      next: -1,
      lastT: null,
      lastInterval: null,
      stall: 0,
      quality: 0,
      strokeVis: [0, 0],
      finishedAt: null,
    }));
    const boatOf = players.map((p) => teams.indexOf(p.team));
    const roleOf = players.map((p) => boats[teams.indexOf(p.team)].members.indexOf(p.idx));
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      boats,
      boatOf,
      roleOf,
      botPlan: players.map(() => null),
      botOops: players.map(() => null),
    };
  },
  layout(s, i): ControllerLayout {
    const b = s.boats[s.boatOf[i]];
    if (b.finishedAt !== null) return { kind: 'wait', labelKey: 'mg.tandemTretboot.finished' };
    if (b.next === -1) return { kind: 'button', labelKey: 'ctrl.pedal' };
    return { kind: 'button', labelKey: b.next === s.roleOf[i] ? 'ctrl.pedalYou' : 'ctrl.pedalPartner' };
  },
  input(s, i, input: MgInput) {
    if (input.type === 'press') stroke(s, i, input.t);
    else if (input.type === 'tap') stroke(s, i, s.t);
  },
  tick(s, dt) {
    s.t += dt;
    for (const b of s.boats) {
      b.strokeVis = b.strokeVis.map((v) => Math.max(0, v - dt));
      b.stall = Math.max(0, b.stall - dt);
      if (b.finishedAt !== null) {
        b.v *= Math.exp(-2 * dt);
        continue;
      }
      b.v *= Math.exp(-DRAG * dt);
      const before = b.pos;
      b.pos += b.v * dt;
      if (b.lastT !== null && s.t - b.lastT > RESET_AFTER) {
        b.next = -1;
        b.lastT = null;
        b.lastInterval = null;
      }
      if (b.pos >= COURSE) {
        if (s.practice) {
          b.pos = 0;
        } else {
          // exact crossing time inside this tick: two boats finishing in the same tick are
          // ranked fairly (independent of the update order)
          const f = b.pos > before ? (COURSE - before) / (b.pos - before) : 1;
          b.pos = COURSE;
          b.finishedAt = s.t - dt * (1 - clamp(f, 0, 1));
        }
      }
    }
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || s.boats.some((b) => b.finishedAt !== null)),
  result(s) {
    const score = (b: Boat) => (b.finishedAt !== null ? 1e6 - b.finishedAt : b.pos);
    const best = Math.max(...s.boats.map(score));
    return teamRanks(
      s.players,
      s.boats.filter((b) => Math.abs(score(b) - best) < 1e-6).map((b) => b.team),
    );
  },
  bot(s, i, level: BotLevel, rng: Rng) {
    const b = s.boats[s.boatOf[i]];
    const role = s.roleOf[i];
    if (b.finishedAt !== null) return [];
    const out: MgInput[] = [];
    const cfg = { easy: { iv: 0.42, jit: 0.1, oops: 0.07 }, medium: { iv: 0.33, jit: 0.05, oops: 0.03 }, hard: { iv: 0.27, jit: 0.025, oops: 0.008 } }[level];
    // occasional mistake: tapping twice in a row
    const oops = s.botOops[i];
    if (oops !== null && s.t >= oops) {
      s.botOops[i] = null;
      out.push({ type: 'press', t: s.t });
      return out;
    }
    if (b.stall > 0) {
      s.botPlan[i] = null;
      return out;
    }
    let myTurn = b.next === role;
    if (b.next === -1) {
      // the first member starts; with a human partner the bot doesn't wait for them
      const partner = b.members[1 - role];
      const partnerIsBot = partner === undefined || s.players[partner].isBot;
      myTurn = role === 0 || !partnerIsBot;
    }
    if (!myTurn) {
      s.botPlan[i] = null;
      return out;
    }
    if (s.botPlan[i] === null) {
      const base = b.lastT ?? s.t;
      s.botPlan[i] = base + cfg.iv * (1 + rng.noise() * cfg.jit * 2);
    }
    if (s.t >= s.botPlan[i]!) {
      const t = Math.max(s.botPlan[i]!, s.t - 1 / 30);
      s.botPlan[i] = null;
      out.push({ type: 'press', t });
      if (rng.chance(cfg.oops)) s.botOops[i] = s.t + 0.12;
    }
    return out;
  },
  view(s) {
    const lead = Math.max(...s.boats.map((b) => b.pos));
    const trail = Math.min(...s.boats.map((b) => b.pos));
    const gap = lead - trail;
    const cx = clamp((lead + trail) / 2 + 3, 6, COURSE - 2);
    const entities: MgEntity[] = [];
    // lane buoys every 10 m along both outer sides
    for (let x = 10; x < COURSE; x += 10) {
      for (const side of [1, -1]) {
        entities.push({ id: `buoy${x}_${side}`, kind: 'sphere', x, y: 0.2, z: side * 5.2, sx: 0.7, sy: 0.7, sz: 0.7, color: (x / 10) % 2 ? '#ffffff' : '#ff8a3d' });
      }
      entities.push({ id: `mid${x}`, kind: 'sphere', x, y: 0.1, z: 0, sx: 0.4, sy: 0.4, sz: 0.4, color: '#ffffff', alpha: 0.7 });
    }
    // start pier and finish gate with the big goal buoys
    entities.push({ id: 'pier', kind: 'box', x: -3.5, y: 0.2, z: 0, sx: 3, sy: 0.4, sz: 11, color: '#b98350' });
    entities.push({ id: 'finishLine', kind: 'plane', x: COURSE, y: 0.05, z: 0, sx: 0.8, sz: 11, color: '#ffffff' });
    for (const side of [1, -1]) {
      entities.push({ id: `goalPost${side}`, kind: 'cylinder', x: COURSE, y: 2, z: side * 5.6, sx: 0.4, sy: 4, sz: 0.4, color: '#ffffff' });
    }
    entities.push({ id: 'goalBanner', kind: 'box', x: COURSE, y: 4.2, z: 0, sx: 0.3, sy: 0.8, sz: 11.6, color: '#f2c14e', glow: true });
    s.boats.forEach((b, k) => {
      const z = LANE_Z[k] ?? 0;
      entities.push({ id: `goalBuoy${k}`, kind: 'sphere', x: COURSE + 2.5, y: 0.6, z, sx: 1.8, sy: 1.8, sz: 1.8, color: '#f2c14e', glow: true });
      const bob = Math.sin(s.t * 2 + k) * 0.05;
      entities.push({
        id: `boat${k}`,
        kind: 'boat',
        x: b.pos,
        y: bob,
        z,
        sx: 1.5,
        sy: 1.5,
        sz: 1.5,
        color: TEAM_COLORS[b.team] ?? '#ffffff',
        labelKey: b.stall > 0 ? 'mg.tandemTretboot.stall' : undefined,
      });
      if (b.v > 1) entities.push({ id: `wake${k}`, kind: 'sphere', x: b.pos - 3, y: 0, z, sx: 1.5 + b.v * 0.3, sy: 0.15, sz: 1.6, color: '#ffffff', alpha: clamp(b.v / VMAX, 0.2, 0.7) });
      b.members.forEach((pi, role) => {
        const px = b.pos + (role === 0 ? 0.9 : -0.9);
        entities.push({
          id: `p${pi}`,
          kind: 'player',
          player: pi,
          x: px,
          y: 0.45 + bob,
          z,
          ry: faceAngle(1, 0),
          anim: b.finishedAt !== null ? 'cheer' : b.stall > 0 ? 'hit' : b.strokeVis[role] > 0 ? 'walk' : 'idle',
        });
        // glowing arrow over the player whose turn it is
        const turn = b.finishedAt === null && (b.next === role || (b.next === -1 && role === 0));
        entities.push({ id: `turn${pi}`, kind: 'cone', x: px, y: turn ? 2.6 : -3, z, rx: Math.PI, sx: 0.6, sy: 0.7, sz: 0.6, color: TEAM_COLORS[b.team] ?? '#ffffff', glow: true, alpha: turn ? 1 : 0 });
      });
    });
    return {
      env: 'water',
      camera: { alpha: -Math.PI / 2, beta: 1.0, radius: clamp(17 + gap * 0.6, 17, 52), target: [cx, 0, 0] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: s.boats.map((b) => ({ team: b.team, labelKey: b.team === 0 ? 'team.red' : 'team.blue', value: `${Math.round((b.pos / COURSE) * 100)} %` })),
        bars: s.boats.flatMap((b) => b.members.map((pi) => ({ player: pi, value: b.pos / COURSE }))),
      },
    };
  },
};
