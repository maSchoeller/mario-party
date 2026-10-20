import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { TEAM_COLORS, ageFx, clamp, emitFx, faceAngle, skill, teamRanksFromScores, viewFx, type FxState } from '../util';

/**
 * #11 Paket-Kette (2v2, Wischen): parcels arrive on a conveyor belt at the thrower (first
 * team member), who swipes them up to the partner. The sorter (second member) swipes each
 * parcel into the chute of its color (left / up / right). Right chute +1, wrong chute −1.
 * Both teams get the very same parcels at the same time (fair).
 * Tie-break (same score at the end): the team that reached its score first.
 */
const DURATION = 45;
/** parcel colors; index = chute: 0 = left, 1 = up (back), 2 = right */
export const PARCEL_COLORS = ['#f2c14e', '#5cc08a', '#b07cd8'];
const CHUTE_DIRS = ['left', 'up', 'right'] as const;
const BELT_SPEED = 0.55; // belt length 1 per ~1.8 s
const GAP = 0.2; // minimum spacing on the belt
const FLIGHT = 0.45;
const HAND_MAX = 3;
const AREA_X = [-6.5, 6.5];

interface Parcel {
  id: number;
  color: number;
}

interface TeamState {
  team: number;
  thrower: number;
  sorter: number;
  belt: (Parcel & { pos: number })[];
  flying: (Parcel & { t: number })[];
  hand: Parcel[];
  score: number;
  /** time the current score was reached (tie-break: earlier wins) */
  scoreAt: number;
  fx: { id: number; color: number; chute: number; ok: boolean | null; t: number }[];
  throwVis: number;
  sortVis: number;
}

export interface PaketKetteState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  teams: TeamState[];
  teamOf: number[];
  roleOf: ('thrower' | 'sorter')[];
  spawnIn: number;
  nextId: number;
  botCd: number[];
}

const chuteOf = (dir: string) => CHUTE_DIRS.indexOf(dir as (typeof CHUTE_DIRS)[number]);

// layout of one team area (view + effects)
const THROWER_Z = -3.4;
const SORTER_Z = 1.4;
const beltStart = (k: number) => (AREA_X[k] ?? 0) + (k === 0 ? -1 : 1) * 5.5;
const beltEnd = (k: number) => (AREA_X[k] ?? 0) + (k === 0 ? -1 : 1) * 1.2;
function chutePos(k: number, ci: number): { x: number; z: number } {
  const cx = AREA_X[k] ?? 0;
  return ci === 0 ? { x: cx - 2.8, z: SORTER_Z } : ci === 1 ? { x: cx, z: SORTER_Z + 3 } : { x: cx + 2.8, z: SORTER_Z };
}

function throwParcel(s: PaketKetteState, ts: TeamState): boolean {
  const front = ts.belt[0];
  if (!front || front.pos < 0.9) return false;
  ts.belt.shift();
  ts.flying.push({ id: front.id, color: front.color, t: 0 });
  ts.throwVis = 0.3;
  emitFx(s, { sfx: 'whoosh', x: beltEnd(s.teams.indexOf(ts)), y: 1.6, z: THROWER_Z });
  return true;
}

function sortParcel(s: PaketKetteState, ts: TeamState, chute: number): void {
  const p = ts.hand.shift();
  if (!p) return;
  const ok = p.color === chute;
  const before = ts.score;
  ts.score = ok ? ts.score + 1 : Math.max(0, ts.score - 1);
  if (ts.score !== before) ts.scoreAt = s.t;
  ts.fx.push({ id: p.id, color: p.color, chute, ok, t: 0.6 });
  ts.sortVis = 0.3;
  const c = chutePos(s.teams.indexOf(ts), chute);
  if (ok) emitFx(s, { kind: 'sparkle', sfx: 'correct', x: c.x, y: 2, z: c.z, color: PARCEL_COLORS[p.color], s: 1.2 });
  else emitFx(s, { kind: 'smoke', sfx: 'buzz', x: c.x, y: 1.9, z: c.z, color: '#8a8f99', s: 0.8 });
}

/** score plus a fraction < 1 that is bigger the earlier the score was reached */
function tieBreakScore(s: PaketKetteState, ts: TeamState | undefined): number {
  if (!ts) return 0;
  return ts.score + 0.5 * (1 - clamp(ts.scoreAt / (s.duration + 1), 0, 1));
}

export const paketKette: MinigameDef<PaketKetteState> = {
  id: 'paketKette',
  format: '2v2',
  control: 'draw',
  theme: 'city',
  duration: DURATION,
  setup(players, _rng, opts) {
    const teamIds = [...new Set(players.map((p) => p.team))].sort();
    const teams: TeamState[] = teamIds.map((team) => {
      const m = players.filter((p) => p.team === team).map((p) => p.idx);
      return { team, thrower: m[0], sorter: m[1] ?? m[0], belt: [], flying: [], hand: [], score: 0, scoreAt: 0, fx: [], throwVis: 0, sortVis: 0 };
    });
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      teams,
      teamOf: players.map((p) => teamIds.indexOf(p.team)),
      roleOf: players.map((p) => (teams[teamIds.indexOf(p.team)].thrower === p.idx ? 'thrower' : 'sorter')),
      spawnIn: 1,
      nextId: 1,
      botCd: players.map(() => 0),
      fx: [],
      fxN: 0,
    };
  },
  layout(s, i): ControllerLayout {
    return { kind: 'swipe', labelKey: s.roleOf[i] === 'thrower' ? 'ctrl.swipeThrow' : 'ctrl.swipeSort' };
  },
  input(s, i, input: MgInput) {
    if (input.type !== 'swipe') return;
    const ts = s.teams[s.teamOf[i]];
    const solo = ts.thrower === ts.sorter;
    if (s.roleOf[i] === 'thrower' && input.dir === 'up' && (!solo || ts.hand.length === 0)) {
      throwParcel(s, ts);
      return;
    }
    if (s.roleOf[i] === 'sorter' || solo) {
      const chute = chuteOf(input.dir);
      if (chute >= 0) sortParcel(s, ts, chute);
    }
  },
  tick(s, dt, rng) {
    s.t += dt;
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) {
      const f = s.practice ? 0 : Math.min(1, s.t / s.duration);
      s.spawnIn = (1.35 - 0.6 * f) * (0.8 + rng.next() * 0.4);
      const color = rng.int(0, PARCEL_COLORS.length - 1);
      for (const ts of s.teams) {
        const last = ts.belt[ts.belt.length - 1];
        // belt jammed at the start: the parcel falls off (lost)
        if (last && last.pos < GAP) {
          ts.fx.push({ id: s.nextId, color, chute: -1, ok: null, t: 0.6 });
          emitFx(s, { kind: 'dust', sfx: 'thud', x: beltStart(s.teams.indexOf(ts)), y: 0.3, z: THROWER_Z, s: 0.7 });
        } else ts.belt.push({ id: s.nextId, color, pos: 0 });
        s.nextId++;
      }
    }
    for (const ts of s.teams) {
      ts.throwVis = Math.max(0, ts.throwVis - dt);
      ts.sortVis = Math.max(0, ts.sortVis - dt);
      let limit = 1;
      for (const p of ts.belt) {
        p.pos = Math.min(limit, p.pos + BELT_SPEED * dt);
        limit = p.pos - GAP;
      }
      for (const f of ts.flying) f.t += dt;
      for (const f of ts.flying.filter((f) => f.t >= FLIGHT)) {
        // partner's hands full: the parcel drops to the floor
        if (ts.hand.length >= HAND_MAX) {
          ts.fx.push({ id: f.id, color: f.color, chute: -2, ok: null, t: 0.6 });
          emitFx(s, { kind: 'dust', sfx: 'thud', x: (AREA_X[s.teams.indexOf(ts)] ?? 0) + 0.8, y: 0.2, z: SORTER_Z - 0.8, s: 0.8 });
        } else {
          ts.hand.push({ id: f.id, color: f.color });
          emitFx(s, { kind: 'pop', x: AREA_X[s.teams.indexOf(ts)] ?? 0, y: 2.6, z: SORTER_Z, color: PARCEL_COLORS[f.color], s: 0.5 });
        }
      }
      ts.flying = ts.flying.filter((f) => f.t < FLIGHT);
      ts.fx = ts.fx.filter((e) => (e.t -= dt) > 0);
      if (s.practice && ts.score >= 99) ts.score = 0;
    }
    ageFx(s, dt);
  },
  isOver: (s) => !s.practice && s.t >= s.duration,
  result: (s) => teamRanksFromScores(s.players, (team) => tieBreakScore(s, s.teams.find((ts) => ts.team === team))),
  bot(s, i, level: BotLevel, rng: Rng, dt) {
    const ts = s.teams[s.teamOf[i]];
    const sk = skill(level);
    const isThrower = s.roleOf[i] === 'thrower';
    let ready: boolean;
    if (isThrower) {
      const front = ts.belt[0];
      const partnerLoad = ts.hand.length + ts.flying.length;
      // good throwers wait while the partner's hands are full; easy ones don't care
      const careful = level === 'easy' ? rng.chance(0.3) : rng.chance(sk.accuracy);
      ready = !!front && front.pos >= 0.9 && (!careful || partnerLoad < HAND_MAX);
    } else ready = ts.hand.length > 0;
    if (!ready) {
      s.botCd[i] = sk.reaction * (0.6 + rng.next() * 0.7);
      return [];
    }
    s.botCd[i] -= dt;
    if (s.botCd[i] > 0) return [];
    s.botCd[i] = sk.reaction * (0.5 + rng.next() * 0.6);
    if (isThrower) return [{ type: 'swipe', dir: 'up' }];
    const p = ts.hand[0];
    const correct = rng.chance(0.62 + 0.38 * sk.accuracy);
    const chute = correct ? p.color : (p.color + 1 + rng.int(0, 1)) % 3;
    return [{ type: 'swipe', dir: CHUTE_DIRS[chute] }];
  },
  view(s) {
    const entities: MgEntity[] = [
      // low brick wall between the two depots, bunting over the back of each area
      { id: 'wall', kind: 'box', x: 0, y: 0.5, z: 0.5, sx: 0.5, sy: 1, sz: 11, color: '#c98f74', mat: 'stone' },
      { id: 'wallCap', kind: 'box', x: 0, y: 1.06, z: 0.5, sx: 0.66, sy: 0.12, sz: 11.2, color: '#e3dccf', mat: 'stone' },
    ];
    s.teams.forEach((ts, k) => {
      const cx = AREA_X[k] ?? 0;
      const side = k === 0 ? -1 : 1;
      const color = TEAM_COLORS[ts.team] ?? '#ffffff';
      const tz = THROWER_Z;
      const sz = SORTER_Z;
      // tiled depot floor in a light team tint with a darker border
      entities.push({ id: `rim${k}`, kind: 'plane', x: cx, y: 0.015, z: 0.5, sx: 12.4, sz: 11.4, color: ts.team === 0 ? '#b5655f' : '#5f78b5', mat: 'tiles' });
      entities.push({ id: `floor${k}`, kind: 'plane', x: cx, y: 0.03, z: 0.5, sx: 11.8, sz: 10.8, color: ts.team === 0 ? '#f2c9bf' : '#c6d5f0', mat: 'tiles' });
      // conveyor belt from the outer side to the thrower: steel frame, rubber belt, rollers
      const xs = beltStart(k);
      const xe = beltEnd(k);
      const bx = (xs + xe) / 2;
      const bl = Math.abs(xs - xe) + 1.2;
      entities.push({ id: `beltFrame${k}`, kind: 'box', x: bx, y: 0.28, z: tz, sx: bl, sy: 0.5, sz: 1.5, color: '#8d96a3', mat: 'metal' });
      entities.push({ id: `belt${k}`, kind: 'box', x: bx, y: 0.56, z: tz, sx: bl + 0.1, sy: 0.08, sz: 1.2, color: '#3b3f48', mat: 'cloth' });
      for (const [r, rx] of [
        [0, xs + side * 0.6],
        [1, xe - side * 0.6],
      ] as [number, number][]) {
        entities.push({ id: `roller${k}_${r}`, kind: 'cylinder', x: rx, y: 0.5, z: tz, rx: Math.PI / 2, sx: 0.36, sy: 1.6, sz: 0.36, color: '#f2c14e', mat: 'metal' });
      }
      // parcel source: the post office counter at the outer end, crates waiting
      entities.push({ id: `crateA${k}`, kind: 'prop', prop: 'crate', x: xs + side * 1.7, y: 0, z: tz - 0.9, ry: 0.2 });
      entities.push({ id: `crateB${k}`, kind: 'prop', prop: 'crate', x: xs + side * 1.75, y: 0.8, z: tz - 0.85, ry: -0.3, sx: 0.85 });
      entities.push({ id: `crateC${k}`, kind: 'prop', prop: 'crate', x: xs + side * 1.6, y: 0, z: tz + 0.6, ry: 0.5, sx: 0.9 });
      entities.push({ id: `mail${k}`, kind: 'prop', prop: 'mailbox', x: cx + side * 5.4, y: 0, z: sz + 2.2, ry: faceAngle(-side, -0.3) });
      entities.push({ id: `lamp${k}`, kind: 'prop', prop: 'streetlamp', x: cx + side * 5.6, y: 0, z: 5.4 });
      entities.push({ id: `bunting${k}`, kind: 'prop', prop: 'bunting', x: cx, y: 0, z: 6.6, sx: 1.45 });
      entities.push({ id: `fbox${k}`, kind: 'prop', prop: 'flowerbox', x: cx - side * 1.6, y: 0, z: 6.4, sx: 1.1 });
      for (const p of ts.belt) {
        entities.push({ id: `pk${p.id}`, kind: 'box', x: xs + (xe - xs) * p.pos, y: 0.95, z: tz, sx: 0.85, sy: 0.7, sz: 0.85, color: PARCEL_COLORS[p.color], mat: 'paper' });
      }
      for (const f of ts.flying) {
        const u = f.t / FLIGHT;
        entities.push({ id: `pk${f.id}`, kind: 'box', x: xe + (cx - xe) * u, y: 1.6 + Math.sin(u * Math.PI) * 2.2 + u, z: tz + (sz - tz) * u, ry: u * 4, sx: 0.9, sy: 0.75, sz: 0.9, color: PARCEL_COLORS[f.color], mat: 'paper' });
      }
      ts.hand.forEach((p, h) => {
        entities.push({ id: `pk${p.id}`, kind: 'box', x: h === 0 ? cx : cx + (h === 1 ? -0.7 : 0.7), y: h === 0 ? 2.9 : 2.2, z: sz, sx: h === 0 ? 1.15 : 0.6, sy: h === 0 ? 0.95 : 0.5, sz: h === 0 ? 1.15 : 0.6, color: PARCEL_COLORS[p.color], glow: h === 0, mat: 'paper' });
      });
      // three colored chutes around the sorter: left, back, right – metal bins with a funnel
      for (let ci = 0; ci < 3; ci++) {
        const c = chutePos(k, ci);
        const hit = ts.fx.find((e) => e.chute === ci);
        entities.push({ id: `chute${k}_${ci}`, kind: 'box', x: c.x, y: 0.7, z: c.z, sx: 1.7, sy: 1.4, sz: 1.7, color: PARCEL_COLORS[ci], glow: !!hit, mat: 'metal' });
        entities.push({ id: `chuteBand${k}_${ci}`, kind: 'box', x: c.x, y: 0.12, z: c.z, sx: 1.78, sy: 0.24, sz: 1.78, color: '#4a4f5c', mat: 'metal' });
        entities.push({ id: `chuteTop${k}_${ci}`, kind: 'cylinder', x: c.x, y: 1.58, z: c.z, sx: 1.4, sy: 0.36, sz: 1.4, color: '#5d6470', mat: 'metal', taper: 1.3 });
        entities.push({ id: `chuteHole${k}_${ci}`, kind: 'cylinder', x: c.x, y: 1.77, z: c.z, sx: 1.5, sy: 0.04, sz: 1.5, color: '#23262d' });
      }
      for (const e of ts.fx) {
        if (e.chute >= 0) {
          const c = chutePos(k, e.chute);
          entities.push({ id: `pk${e.id}`, kind: 'box', x: c.x, y: 1.5 + e.t, z: c.z, sx: 0.6, sy: 0.5, sz: 0.6, color: PARCEL_COLORS[e.color], alpha: e.t * 1.6 });
          entities.push({ id: `fx${e.id}`, kind: e.ok ? 'star' : 'rock', x: c.x, y: 3 + (0.6 - e.t) * 2, z: c.z, sx: 0.8, sy: 0.8, sz: 0.8, color: e.ok ? undefined : '#e05a5a', alpha: e.t * 1.6 });
        } else {
          // lost parcel (belt jammed or dropped)
          const x = e.chute === -1 ? xs : cx + 0.8;
          const z = e.chute === -1 ? tz : sz - 0.8;
          entities.push({ id: `pk${e.id}`, kind: 'box', x, y: Math.max(0.3, e.t * 2), z, rz: 1 - e.t, sx: 0.7, sy: 0.6, sz: 0.7, color: PARCEL_COLORS[e.color], alpha: 0.5 + e.t });
        }
      }
      for (const [pi, z, vis] of [
        [ts.thrower, tz - 1.2, ts.throwVis],
        [ts.sorter, sz - 0.2, ts.sortVis],
      ] as [number, number, number][]) {
        if (ts.thrower === ts.sorter && z !== tz - 1.2) continue;
        entities.push({ id: `p${pi}`, kind: 'player', player: pi, x: cx, y: 0.03, z, anim: vis > 0 ? 'jump' : 'idle' });
        entities.push({ id: `ring${pi}`, kind: 'torus', x: cx, y: 0.08, z, sx: 1.4, sy: 1, sz: 1.4, color });
      }
    });
    return {
      env: 'city',
      scenery: { set: 'city', clear: { w: 30, d: 14, z: 0.5 } },
      camera: { alpha: -Math.PI / 2, beta: 0.8, radius: 26, target: [0, 0, 0.6] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: s.teams.map((ts) => ({ team: ts.team, labelKey: ts.team === 0 ? 'team.red' : 'team.blue', value: `📦 ${ts.score}` })),
      },
    };
  },
};
