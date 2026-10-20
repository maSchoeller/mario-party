import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { TEAM_COLORS, clamp, skill, teamRanksFromScores } from '../util';

/**
 * #12 Weichen-Chaos (2v2, Timing): trains in both team colors roll down four tracks. Every
 * player owns the switch on one track and flips it with one button: trains of the own color
 * should go to the own station (+1), other trains onto the siding. A foreign train in the own
 * station costs a point. Both teams get mirrored train sequences (fair).
 * Press times come from the phone clock (NET-05): a press that happened just before a train
 * reached the switch still counts, even if the message arrives a moment later.
 */
const DURATION = 45;
const Z_START = 13;
const Z_SWITCH = 2;
const LEN_A = Z_START - Z_SWITCH; // entry → switch
const LEN_STATION = 7; // switch → station (z = -5)
const SID_DX = 2.5;
const SID_DZ = 3.5;
const LEN_DIAG = Math.hypot(SID_DX, SID_DZ);
const LEN_SIDING = LEN_DIAG + 2;
const GRACE = 0.2;
const TRAIN_SCALE = 0.75;

type Way = 'station' | 'siding';

interface Line {
  team: number;
  /** owning minigame player */
  owner: number;
  slot: number;
  x0: number;
  /** direction of the siding (+/- x) */
  dsx: number;
  state: Way;
  flipVis: number;
}

interface Train {
  id: number;
  line: number;
  /** team color of the train */
  color: number;
  s: number;
  branch: Way | null;
  decidedAt: number;
}

interface BotMem {
  train: number;
  seeAt: number | null;
  decision: Way;
}

export interface WeichenChaosState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  teamIds: number[];
  lines: Line[];
  trains: Train[];
  scores: number[];
  nextSpawn: number[];
  nextId: number;
  fx: { id: number; line: number; kind: 'good' | 'bad' | 'siding'; t: number }[];
  botMem: (BotMem | null)[];
}

const other = (w: Way): Way => (w === 'station' ? 'siding' : 'station');

export function trainPos(line: Line, tr: Pick<Train, 's' | 'branch'>): { x: number; z: number; dx: number; dz: number } {
  if (tr.s <= LEN_A || tr.branch === null) return { x: line.x0, z: Z_START - tr.s, dx: 0, dz: -1 };
  const u = tr.s - LEN_A;
  if (tr.branch === 'station') return { x: line.x0, z: Z_SWITCH - u, dx: 0, dz: -1 };
  if (u <= LEN_DIAG) {
    const f = u / LEN_DIAG;
    return { x: line.x0 + line.dsx * f, z: Z_SWITCH - SID_DZ * f, dx: line.dsx / LEN_DIAG, dz: -SID_DZ / LEN_DIAG };
  }
  return { x: line.x0 + line.dsx, z: Z_SWITCH - SID_DZ - (u - LEN_DIAG), dx: 0, dz: -1 };
}

const speedAt = (s: WeichenChaosState) => 3.6 + 1.6 * (s.practice ? 0 : clamp(s.t / s.duration, 0, 1));

function flip(s: WeichenChaosState, i: number, t: number): void {
  const tp = clamp(t, s.t - GRACE, s.t);
  s.lines.forEach((line, li) => {
    if (line.owner !== i) return;
    line.state = other(line.state);
    line.flipVis = 0.35;
    // the press happened before the train reached the switch: it still takes the new way
    for (const tr of s.trains) {
      if (tr.line === li && tr.branch !== null && tr.decidedAt > tp && tr.s - LEN_A < 1.5) tr.branch = line.state;
    }
  });
}

export const weichenChaos: MinigameDef<WeichenChaosState> = {
  id: 'weichenChaos',
  format: '2v2',
  control: 'tap',
  theme: 'city',
  duration: DURATION,
  setup(players, _rng, opts) {
    const teamIds = [...new Set(players.map((p) => p.team))].sort();
    const lines: Line[] = [];
    teamIds.forEach((team, k) => {
      const m = players.filter((p) => p.team === team).map((p) => p.idx);
      const side = k === 0 ? -1 : 1;
      for (let slot = 0; slot < 2; slot++) {
        lines.push({ team, owner: m[slot] ?? m[0], slot, x0: side * (slot === 0 ? 10 : 5), dsx: -side * SID_DX, state: 'station', flipVis: 0 });
      }
    });
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      teamIds,
      lines,
      trains: [],
      scores: teamIds.map(() => 0),
      nextSpawn: [0.6, 1.5],
      nextId: 1,
      fx: [],
      botMem: players.map(() => null),
    };
  },
  layout(s, i): ControllerLayout {
    const line = s.lines.find((l) => l.owner === i);
    if (!line) return { kind: 'wait', labelKey: 'ctrl.watch' };
    return { kind: 'button', labelKey: line.state === 'station' ? 'ctrl.switchToSiding' : 'ctrl.switchToStation' };
  },
  input(s, i, input: MgInput) {
    if (input.type === 'press') flip(s, i, input.t);
    else if (input.type === 'tap') flip(s, i, s.t);
  },
  tick(s, dt, rng) {
    s.t += dt;
    const v = speedAt(s);
    const f = s.practice ? 0 : clamp(s.t / s.duration, 0, 1);
    // spawn: per slot the same "own / foreign" pattern for both teams
    for (let slot = 0; slot < 2; slot++) {
      if (s.t < s.nextSpawn[slot]) continue;
      const own = rng.chance(0.5);
      s.lines.forEach((line, li) => {
        if (line.slot !== slot) return;
        const color = own ? line.team : s.teamIds.find((t) => t !== line.team) ?? line.team;
        s.trains.push({ id: s.nextId++, line: li, color, s: -1.5, branch: null, decidedAt: 0 });
      });
      s.nextSpawn[slot] = s.t + rng.range(1.25, 3.1) * (1 - 0.25 * f);
    }
    for (const line of s.lines) line.flipVis = Math.max(0, line.flipVis - dt);
    for (const tr of s.trains) {
      tr.s += v * dt;
      const line = s.lines[tr.line];
      if (tr.branch === null && tr.s >= LEN_A) {
        tr.branch = line.state;
        tr.decidedAt = s.t - (tr.s - LEN_A) / v;
      }
    }
    const arrived = s.trains.filter((tr) => tr.branch !== null && tr.s - LEN_A >= (tr.branch === 'station' ? LEN_STATION : LEN_SIDING));
    for (const tr of arrived) {
      const line = s.lines[tr.line];
      const ti = s.teamIds.indexOf(line.team);
      if (tr.branch === 'siding') s.fx.push({ id: tr.id, line: tr.line, kind: 'siding', t: 0.8 });
      else if (tr.color === line.team) {
        s.scores[ti]++;
        s.fx.push({ id: tr.id, line: tr.line, kind: 'good', t: 0.8 });
      } else {
        s.scores[ti] = Math.max(0, s.scores[ti] - 1);
        s.fx.push({ id: tr.id, line: tr.line, kind: 'bad', t: 0.8 });
      }
    }
    s.trains = s.trains.filter((tr) => !arrived.includes(tr));
    s.fx = s.fx.filter((e) => (e.t -= dt) > 0);
    if (s.practice && s.scores.some((x) => x >= 99)) s.scores = s.scores.map(() => 0);
  },
  isOver: (s) => !s.practice && s.t >= s.duration,
  result: (s) => teamRanksFromScores(s.players, (team) => s.scores[s.teamIds.indexOf(team)] ?? 0),
  bot(s, i, level: BotLevel, rng: Rng) {
    const li = s.lines.findIndex((l) => l.owner === i);
    if (li < 0) return [];
    const line = s.lines[li];
    const sk = skill(level);
    const next = s.trains.filter((tr) => tr.line === li && tr.branch === null).sort((a, b) => b.s - a.s)[0];
    if (!next) return [];
    let mem = s.botMem[i];
    if (!mem || mem.train !== next.id) {
      const desired: Way = next.color === line.team ? 'station' : 'siding';
      mem = s.botMem[i] = { train: next.id, seeAt: null, decision: rng.chance(0.6 + 0.4 * sk.accuracy) ? desired : other(desired) };
    }
    const timeToSwitch = (LEN_A - next.s) / speedAt(s);
    const lookahead = { easy: 1.1, medium: 1.7, hard: 2.6 }[level];
    if (mem.seeAt === null && timeToSwitch <= lookahead) mem.seeAt = s.t + sk.reaction * (0.8 + rng.next() * 0.4);
    if (mem.seeAt !== null && s.t >= mem.seeAt && line.state !== mem.decision) return [{ type: 'press', t: s.t }];
    return [];
  },
  view(s) {
    const entities: MgEntity[] = [];
    const rail = (id: string, x: number, z: number, len: number, ry = 0) => {
      entities.push({ id: `${id}b`, kind: 'box', x, y: 0.05, z, sx: 1.4, sy: 0.1, sz: len, ry, color: '#8a6a4f' });
      entities.push({ id: `${id}r`, kind: 'box', x, y: 0.16, z, sx: 0.9, sy: 0.08, sz: len, ry, color: '#5b616d' });
    };
    s.teamIds.forEach((team, k) => {
      const cx = k === 0 ? -7.5 : 7.5;
      const color = TEAM_COLORS[team] ?? '#ffffff';
      const good = s.fx.some((e) => e.kind === 'good' && s.lines[e.line].team === team);
      entities.push({ id: `station${k}`, kind: 'box', x: cx, y: 1.2, z: -6.4, sx: 8.4, sy: 2.4, sz: 2.4, color, glow: good, labelKey: team === 0 ? 'team.red' : 'team.blue' });
      entities.push({ id: `roof${k}`, kind: 'box', x: cx, y: 2.6, z: -6.4, sx: 9, sy: 0.4, sz: 3, color: '#f4efe6' });
    });
    s.lines.forEach((line, li) => {
      const x0 = line.x0;
      const xs = x0 + line.dsx;
      entities.push({ id: `tunnel${li}`, kind: 'box', x: x0, y: 1.3, z: Z_START + 0.6, sx: 2.4, sy: 2.6, sz: 1.2, color: '#6b6f7a' });
      rail(`a${li}`, x0, (Z_START + Z_SWITCH) / 2, LEN_A);
      rail(`st${li}`, x0, Z_SWITCH - LEN_STATION / 2, LEN_STATION);
      rail(`sd${li}`, x0 + line.dsx / 2, Z_SWITCH - SID_DZ / 2, LEN_DIAG, Math.atan2(line.dsx, -SID_DZ));
      rail(`se${li}`, xs, Z_SWITCH - SID_DZ - 1, 2);
      entities.push({ id: `buffer${li}`, kind: 'box', x: xs, y: 0.45, z: Z_SWITCH - SID_DZ - 2.2, sx: 1.4, sy: 0.9, sz: 0.4, color: '#e05a5a' });
      // switch blade: glowing piece pointing along the selected way
      const toStation = line.state === 'station';
      const bdx = toStation ? 0 : line.dsx / LEN_DIAG;
      const bdz = toStation ? -1 : -SID_DZ / LEN_DIAG;
      entities.push({ id: `blade${li}`, kind: 'box', x: x0 + bdx * 1.1, y: 0.3, z: Z_SWITCH + bdz * 1.1, sx: 0.6, sy: 0.14, sz: 2.2, ry: Math.atan2(bdx, bdz), color: '#ffe066', glow: true });
      const px = x0 - Math.sign(line.dsx) * 1.8;
      entities.push({ id: `signal${li}`, kind: 'sphere', x: px, y: 2.6, z: Z_SWITCH + 1.4, sx: 0.8, sy: 0.8, sz: 0.8, color: toStation ? TEAM_COLORS[line.team] ?? '#ffffff' : '#9aa0a6', glow: true });
      entities.push({ id: `post${li}`, kind: 'cylinder', x: px, y: 1.1, z: Z_SWITCH + 1.4, sx: 0.15, sy: 2.2, sz: 0.15, color: '#4a4f5c' });
      entities.push({ id: `p${line.owner}`, kind: 'player', player: line.owner, x: px, y: 0, z: Z_SWITCH + 0.2, anim: line.flipVis > 0 ? 'jump' : 'idle' });
      entities.push({ id: `ring${line.owner}`, kind: 'torus', x: px, y: 0.05, z: Z_SWITCH + 0.2, sx: 1.4, sy: 1, sz: 1.4, color: TEAM_COLORS[line.team] ?? '#ffffff' });
    });
    for (const tr of s.trains) {
      const p = trainPos(s.lines[tr.line], tr);
      entities.push({
        id: `train${tr.id}`,
        kind: 'train',
        x: p.x,
        y: 0.2,
        z: p.z,
        ry: Math.atan2(-p.dz, p.dx),
        sx: TRAIN_SCALE,
        sy: TRAIN_SCALE,
        sz: TRAIN_SCALE,
        color: TEAM_COLORS[tr.color] ?? '#ffffff',
      });
    }
    for (const e of s.fx) {
      const line = s.lines[e.line];
      const atStation = e.kind !== 'siding';
      const x = atStation ? line.x0 : line.x0 + line.dsx;
      const z = atStation ? -5 : Z_SWITCH - SID_DZ - 2;
      const kind = e.kind === 'good' ? 'star' : e.kind === 'bad' ? 'rock' : 'sphere';
      entities.push({ id: `fx${e.id}`, kind, x, y: 3 + (0.8 - e.t) * 2, z, sx: 1, sy: 1, sz: 1, color: e.kind === 'bad' ? '#e05a5a' : e.kind === 'siding' ? '#d8d8d8' : undefined, alpha: Math.min(1, e.t * 1.5) });
    }
    return {
      env: 'grass',
      camera: { alpha: -Math.PI / 2, beta: 0.78, radius: 31, target: [0, 0, 3.2] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: s.teamIds.map((team, k) => ({ team, labelKey: team === 0 ? 'team.red' : 'team.blue', value: `🚂 ${s.scores[k]}` })),
      },
    };
  },
};
