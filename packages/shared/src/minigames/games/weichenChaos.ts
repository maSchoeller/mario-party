import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import { botRef, type ControllerLayout, type MgEntity, type MgInput, type MgPlayer, type MinigameDef } from '../types';
import { TEAM_COLORS, ageFx, clamp, emitFx, teamRanksFromScores, viewFx, type FxState } from '../util';
import { BOT_DISPLAY_LAG } from './botLag';

/**
 * #12 Weichen-Chaos (2v2, Timing): trains in both team colors roll down four tracks. Every
 * player owns the switch on one track and flips it with one button: trains of the own color
 * should go to the own station (+1), other trains onto the siding. A foreign train in the own
 * station costs a point. Both teams get mirrored train sequences (fair).
 * Press times come from the phone clock (NET-05): a press that happened just before a train
 * reached the switch still counts, even if the message arrives a moment later.
 * Tie-break (same score at the end – the mirrored trains make that common): the team whose
 * switches were set correctly earlier, i.e. the bigger sum of lead times (time between the
 * last flip and the train reaching the switch, capped at LEAD_CAP) over all correctly routed trains.
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
/** trains start inside the tunnel portal (whole loco hidden in it) */
const S_SPAWN = -2.4;
const PORTAL_DEPTH = 4;
const TRAIN_SCALE = 0.75;
const LEAD_CAP = 2;
/** spread of the bots' choice reaction (s) */
const BOT_CHOICE_SD = 0.18;
/** grassy hill (ellipsoid) the tunnels lead into: covers the back of the portals */
const HILL = { y: -0.8, z: 19, rx: 22, ry: 5, rz: 6.5 };
/** track pieces (entry, station, siding diagonal, siding end) sit a few mm apart in height, so
 * gravel, sleepers and rails don't z-fight where two pieces meet */
const PIECE_DY: Record<string, number> = { a: 0, st: 0.008, sd: 0.016, se: 0.024 };
const hillY = (x: number, z: number) => HILL.y + HILL.ry * Math.sqrt(Math.max(0, 1 - (x / HILL.rx) ** 2 - ((z - HILL.z) / HILL.rz) ** 2)) - 0.08;

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
  /** time of the last flip (phone timestamp) */
  flipAt: number;
}

interface Train {
  id: number;
  line: number;
  /** team color of the train */
  color: number;
  s: number;
  branch: Way | null;
  decidedAt: number;
  /** seconds the switch was already in its position when the train reached it */
  lead?: number;
}

interface BotMem {
  train: number;
  /** when the bot has made up its mind about this train (null = not looked at yet) */
  seeAt: number | null;
  decision: Way;
}

export interface WeichenChaosState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  teamIds: number[];
  lines: Line[];
  trains: Train[];
  scores: number[];
  /** sum of lead times of correctly routed trains per team (tie-break) */
  lead: number[];
  nextSpawn: number[];
  nextId: number;
  /** arrival markers floating over station / buffer */
  marks: { id: number; line: number; kind: 'good' | 'bad' | 'siding'; t: number }[];
  /** next time the train horn may sound (throttle) */
  hornAt: number;
  botMem: (BotMem | null)[];
  /** bot form per player (v0.5) */
  form: number[];
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
    line.flipAt = tp;
    emitFx(s, { kind: 'dust', sfx: 'click', x: line.x0, y: 0.3, z: Z_SWITCH - 0.8, s: 0.45 });
    // the press happened before the train reached the switch: it still takes the new way
    for (const tr of s.trains) {
      if (tr.line === li && tr.branch !== null && tr.decidedAt > tp && tr.s - LEN_A <= speedAt(s) * GRACE) {
        tr.branch = line.state;
        tr.lead = tr.decidedAt - tp;
      }
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
        lines.push({ team, owner: m[slot] ?? m[0], slot, x0: side * (slot === 0 ? 10 : 5), dsx: -side * SID_DX, state: 'station', flipVis: 0, flipAt: 0 });
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
      lead: teamIds.map(() => 0),
      nextSpawn: [0.6, 1.5],
      nextId: 1,
      marks: [],
      hornAt: 0,
      botMem: players.map(() => null),
      form: players.map((p) => p.form ?? 1),
      fx: [],
      fxN: 0,
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
        s.trains.push({ id: s.nextId++, line: li, color, s: S_SPAWN, branch: null, decidedAt: 0 });
      });
      s.nextSpawn[slot] = s.t + rng.range(1.25, 3.1) * (1 - 0.25 * f);
    }
    for (const line of s.lines) line.flipVis = Math.max(0, line.flipVis - dt);
    for (const tr of s.trains) {
      const before = tr.s;
      tr.s += v * dt;
      const line = s.lines[tr.line];
      if (before < 0 && tr.s >= 0) {
        // out of the tunnel: a puff of steam, the horn at most every few seconds
        const horn = s.t >= s.hornAt;
        if (horn) s.hornAt = s.t + 3.5;
        emitFx(s, { kind: 'smoke', sfx: horn ? 'train' : undefined, x: line.x0, y: 2.4, z: Z_START - 0.4, color: '#f4f4f4', s: 0.7 });
      }
      if (tr.branch === null && tr.s >= LEN_A) {
        tr.branch = line.state;
        tr.decidedAt = s.t - (tr.s - LEN_A) / v;
        tr.lead = Math.max(0, tr.decidedAt - line.flipAt);
      }
    }
    const arrived = s.trains.filter((tr) => tr.branch !== null && tr.s - LEN_A >= (tr.branch === 'station' ? LEN_STATION : LEN_SIDING));
    for (const tr of arrived) {
      const line = s.lines[tr.line];
      const ti = s.teamIds.indexOf(line.team);
      const correct = (tr.branch === 'station') === (tr.color === line.team);
      if (correct) s.lead[ti] += Math.min(LEAD_CAP, tr.lead ?? 0);
      if (tr.branch === 'siding') {
        s.marks.push({ id: tr.id, line: tr.line, kind: 'siding', t: 0.8 });
        emitFx(s, { kind: 'dust', sfx: 'thud', x: line.x0 + line.dsx, y: 0.4, z: Z_SWITCH - SID_DZ - 2, s: 0.8 });
      } else if (tr.color === line.team) {
        s.scores[ti]++;
        s.marks.push({ id: tr.id, line: tr.line, kind: 'good', t: 0.8 });
        emitFx(s, { kind: 'confetti', sfx: 'correct', x: line.x0, y: 3, z: -5.6, color: TEAM_COLORS[line.team], s: 0.8 });
      } else {
        s.scores[ti] = Math.max(0, s.scores[ti] - 1);
        s.marks.push({ id: tr.id, line: tr.line, kind: 'bad', t: 0.8 });
        emitFx(s, { kind: 'smoke', sfx: 'buzz', x: line.x0, y: 2.6, z: -5.6, color: '#5b5560', s: 1 });
      }
    }
    s.trains = s.trains.filter((tr) => !arrived.includes(tr));
    s.marks = s.marks.filter((e) => (e.t -= dt) > 0);
    ageFx(s, dt);
    if (s.practice && s.scores.some((x) => x >= 99)) s.scores = s.scores.map(() => 0);
  },
  isOver: (s) => !s.practice && s.t >= s.duration,
  result: (s) =>
    teamRanksFromScores(s.players, (team) => {
      const k = s.teamIds.indexOf(team);
      // score plus a fraction < 0.5 that grows with the lead time (tie-break)
      return (s.scores[k] ?? 0) + 0.5 * (1 - 1 / (1 + (s.lead[k] ?? 0)));
    }),
  bot(s, i, level: BotLevel, rng: Rng) {
    const li = s.lines.findIndex((l) => l.owner === i);
    if (li < 0) return [];
    const line = s.lines[li];
    const ref = botRef(level, s.form[i]);
    const next = s.trains.filter((tr) => tr.line === li && tr.branch === null).sort((a, b) => b.s - a.s)[0];
    if (!next) return [];
    let mem = s.botMem[i];
    if (!mem || mem.train !== next.id) {
      // colour check own / foreign: a choice reaction that is sometimes wrong
      const desired: Way = next.color === line.team ? 'station' : 'siding';
      mem = s.botMem[i] = { train: next.id, seeAt: null, decision: rng.next() < ref.choiceError ? other(desired) : desired };
    }
    // looked at once the train is out of the tunnel and the one before it has passed the switch
    if (mem.seeAt === null && next.s >= 0) mem.seeAt = s.t + BOT_DISPLAY_LAG + Math.max(ref.choice * 0.8, ref.choice + rng.noise() * BOT_CHOICE_SD);
    if (mem.seeAt !== null && s.t >= mem.seeAt && line.state !== mem.decision) return [{ type: 'press', t: s.t }];
    return [];
  },
  view(s) {
    const entities: MgEntity[] = [
      // grassy hill with the tunnel portals at the far end
      { id: 'hill', kind: 'sphere', x: 0, y: HILL.y, z: HILL.z, sx: HILL.rx * 2, sy: HILL.ry * 2, sz: HILL.rz * 2, color: '#7fb85e', mat: 'grass' },
      { id: 'hillTree1', kind: 'prop', prop: 'treeround', x: -12.5, y: hillY(-12.5, 18.2), z: 18.2, sx: 0.9 },
      { id: 'hillTree2', kind: 'prop', prop: 'tree', x: 1.2, y: hillY(1.2, 18.8), z: 18.8, sx: 0.9 },
      { id: 'hillTree3', kind: 'prop', prop: 'treeround', x: 12.8, y: hillY(12.8, 18), z: 18, sx: 0.8, ry: 2 },
      { id: 'hillBush1', kind: 'prop', prop: 'bushround', x: -2.6, y: hillY(-2.6, 15.6), z: 15.6 },
      { id: 'hillBush2', kind: 'prop', prop: 'bushround', x: 7.6, y: hillY(7.6, 16.4), z: 16.4, ry: 1.5 },
      { id: 'hillFlow1', kind: 'prop', prop: 'flowers', x: -7.4, y: hillY(-7.4, 15.9), z: 15.9 },
      { id: 'hillFlow2', kind: 'prop', prop: 'flowers', x: 2.8, y: hillY(2.8, 15.4), z: 15.4, ry: 3 },
      // dressing along the outside of the layout and in the middle strip
      { id: 'hay1', kind: 'prop', prop: 'haybale', x: -14.4, y: 0, z: 6.5, ry: 0.3 },
      { id: 'hay2', kind: 'prop', prop: 'haybale', x: -14.8, y: 0, z: 4.6, ry: -0.2, sx: 0.9 },
      { id: 'hay3', kind: 'prop', prop: 'haybale', x: 14.6, y: 0, z: 0.4, ry: 1.4 },
      { id: 'treeL', kind: 'prop', prop: 'treeround', x: -15.6, y: 0, z: 12.2, sx: 1.1 },
      { id: 'treeR', kind: 'prop', prop: 'tree', x: 15.4, y: 0, z: 11.6 },
      { id: 'bushM', kind: 'prop', prop: 'bushround', x: 0, y: 0, z: 10.8 },
      { id: 'flowM1', kind: 'prop', prop: 'flowers', x: 0, y: 0, z: 7.4 },
      { id: 'flowM2', kind: 'prop', prop: 'flowers', x: 0.2, y: 0, z: 4.2, ry: 2 },
      { id: 'flowM3', kind: 'prop', prop: 'flowers', x: -0.1, y: 0, z: 0.6, ry: 4 },
      { id: 'signM', kind: 'prop', prop: 'signpost', x: 0, y: 0, z: -3.6, ry: Math.PI },
      { id: 'flowL', kind: 'prop', prop: 'flowers', x: -13.2, y: 0, z: -2.4 },
      { id: 'flowR', kind: 'prop', prop: 'flowers', x: 13.4, y: 0, z: 7.6, ry: 1 },
    ];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) entities.push({ id: `fence${side}_${k}`, kind: 'prop', prop: 'fence', x: side * 13, y: 0, z: -3 + k * 2.1, ry: Math.PI / 2 });
    }
    // track: gravel bed, wooden sleepers (every other one a hair higher), two steel rails
    const rail = (piece: string, li: number, x: number, z: number, len: number, ry = 0) => {
      const id = `${piece}${li}`;
      const dy = PIECE_DY[piece];
      const cs = Math.cos(ry);
      const sn = Math.sin(ry);
      entities.push({ id: `${id}b`, kind: 'box', x, y: 0.05 + dy, z, sx: 1.7, sy: 0.1, sz: len, ry, color: '#a49a8b', mat: 'stone' });
      const n = Math.max(1, Math.round(len / 0.85));
      for (let k = 0; k < n; k++) {
        const o = (k + 0.5) * (len / n) - len / 2;
        entities.push({ id: `${id}s${k}`, kind: 'box', x: x + sn * o, y: 0.14 + dy + (k % 2) * 0.004, z: z + cs * o, sx: 1.3, sy: 0.08, sz: 0.28, ry, color: '#7a5a40', mat: 'wood' });
      }
      for (const [r, o] of [
        [0, -0.38],
        [1, 0.38],
      ] as [number, number][]) {
        entities.push({ id: `${id}r${r}`, kind: 'box', x: x + cs * o, y: 0.22 + dy + r * 0.004, z: z - sn * o, sx: 0.1, sy: 0.08, sz: len, ry, color: '#8d939c', mat: 'metal' });
      }
    };
    s.teamIds.forEach((team, k) => {
      const cx = k === 0 ? -7.5 : 7.5;
      const color = TEAM_COLORS[team] ?? '#ffffff';
      const good = s.marks.some((e) => e.kind === 'good' && s.lines[e.line].team === team);
      // station building (team tinted) facing the track ends: its own platform at the front
      // (model -z, turned towards +z) continues in a forecourt that lights up for a good train
      entities.push({ id: `platform${k}`, kind: 'box', x: cx, y: 0.145, z: -6.5, sx: 7.6, sy: 0.29, sz: 1.6, color: '#d9d1c4', mat: 'tiles', glow: good });
      entities.push({ id: `station${k}`, kind: 'prop', prop: 'station', x: cx, y: 0, z: -8.2, ry: Math.PI, sx: 0.72, color });
      // team name above the roof (a label sits 1.1 over its entity: carried by a tiny box in the gable)
      entities.push({ id: `stationName${k}`, kind: 'box', x: cx, y: 2.75, z: -8.85, sx: 0.02, sy: 0.02, sz: 0.02, color, labelKey: team === 0 ? 'team.red' : 'team.blue' });
      entities.push({ id: `flagA${k}`, kind: 'prop', prop: 'flag', x: cx - 3.6, y: 0, z: -6.6, color, sx: 0.8 });
      entities.push({ id: `flagB${k}`, kind: 'prop', prop: 'flag', x: cx + 3.6, y: 0, z: -6.6, color, sx: 0.8 });
    });
    s.lines.forEach((line, li) => {
      const x0 = line.x0;
      const xs = x0 + line.dsx;
      // tunnel portal in the hill, deep enough to hide a whole train
      entities.push({ id: `tunnel${li}`, kind: 'box', x: x0, y: 1.4, z: Z_START - 0.2 + PORTAL_DEPTH / 2, sx: 2.6, sy: 2.8, sz: PORTAL_DEPTH, color: '#b3aca4', mat: 'stone' });
      entities.push({ id: `tunnelTop${li}`, kind: 'box', x: x0, y: 2.95, z: Z_START + 0.3, sx: 2.9, sy: 0.3, sz: 1.4, color: '#8f877f', mat: 'stone' });
      entities.push({ id: `tunnelHole${li}`, kind: 'box', x: x0, y: 1.05, z: Z_START - 0.22, sx: 1.7, sy: 2.1, sz: 0.06, color: '#1f2126' });
      rail('a', li, x0, (Z_START + Z_SWITCH) / 2, LEN_A);
      rail('st', li, x0, Z_SWITCH - LEN_STATION / 2, LEN_STATION);
      rail('sd', li, x0 + line.dsx / 2, Z_SWITCH - SID_DZ / 2, LEN_DIAG, Math.atan2(line.dsx, -SID_DZ));
      rail('se', li, xs, Z_SWITCH - SID_DZ - 1, 2);
      // buffer stop at the end of the siding
      entities.push({ id: `bufferB${li}`, kind: 'box', x: xs, y: 0.3, z: Z_SWITCH - SID_DZ - 2.35, sx: 1.2, sy: 0.6, sz: 0.5, color: '#7a5a40', mat: 'planks' });
      entities.push({ id: `buffer${li}`, kind: 'box', x: xs, y: 0.72, z: Z_SWITCH - SID_DZ - 2.15, sx: 1.6, sy: 0.3, sz: 0.25, color: '#e05a5a', mat: 'metal' });
      // switch blade: glowing piece pointing along the selected way
      const toStation = line.state === 'station';
      const bdx = toStation ? 0 : line.dsx / LEN_DIAG;
      const bdz = toStation ? -1 : -SID_DZ / LEN_DIAG;
      entities.push({ id: `blade${li}`, kind: 'box', x: x0 + bdx * 1.1, y: 0.3, z: Z_SWITCH + bdz * 1.1, sx: 0.6, sy: 0.14, sz: 2.2, ry: Math.atan2(bdx, bdz), color: '#ffe066', glow: true });
      // signal mast with a lamp in the team color (station) or grey (siding)
      const px = x0 - Math.sign(line.dsx) * 1.8;
      entities.push({ id: `signalBox${li}`, kind: 'box', x: px, y: 2.6, z: Z_SWITCH + 1.62, sx: 0.95, sy: 1.15, sz: 0.3, color: '#2f333b', mat: 'metal' });
      entities.push({ id: `signal${li}`, kind: 'sphere', x: px, y: 2.6, z: Z_SWITCH + 1.4, sx: 0.8, sy: 0.8, sz: 0.8, color: toStation ? TEAM_COLORS[line.team] ?? '#ffffff' : '#9aa0a6', glow: true });
      entities.push({ id: `post${li}`, kind: 'cylinder', x: px, y: 1.05, z: Z_SWITCH + 1.62, sx: 0.16, sy: 2.1, sz: 0.16, color: '#4a4f5c', mat: 'metal' });
      entities.push({ id: `lever${li}`, kind: 'box', x: px, y: 0.35, z: Z_SWITCH + 1.0, rx: toStation ? -0.5 : 0.5, sx: 0.12, sy: 0.7, sz: 0.12, color: '#e05a5a', mat: 'metal' });
      entities.push({ id: `p${line.owner}`, kind: 'player', player: line.owner, x: px, y: 0, z: Z_SWITCH + 0.2, anim: line.flipVis > 0 ? 'jump' : 'idle' });
      entities.push({ id: `ring${line.owner}`, kind: 'torus', x: px, y: 0.05, z: Z_SWITCH + 0.2, sx: 1.4, sy: 1, sz: 1.4, color: TEAM_COLORS[line.team] ?? '#ffffff' });
    });
    for (const tr of s.trains) {
      const p = trainPos(s.lines[tr.line], tr);
      entities.push({
        id: `train${tr.id}`,
        // library loco directly (chimney = model +z first; kind 'train' drives it cab-first)
        kind: 'prop',
        prop: 'loco',
        x: p.x,
        y: 0.26,
        z: p.z,
        ry: Math.atan2(p.dx, p.dz),
        sx: TRAIN_SCALE,
        sy: TRAIN_SCALE,
        sz: TRAIN_SCALE,
        color: TEAM_COLORS[tr.color] ?? '#ffffff',
      });
      // cab roof in the train color too (readable from above), resting on the cab
      const back = 0.72;
      entities.push({ id: `trainRoof${tr.id}`, kind: 'box', x: p.x - p.dx * back, y: 2.13, z: p.z - p.dz * back, ry: Math.atan2(-p.dz, p.dx), sx: 1.3, sy: 0.12, sz: 1.5, color: TEAM_COLORS[tr.color] ?? '#ffffff' });
    }
    for (const e of s.marks) {
      const line = s.lines[e.line];
      const atStation = e.kind !== 'siding';
      const x = atStation ? line.x0 : line.x0 + line.dsx;
      const z = atStation ? -5 : Z_SWITCH - SID_DZ - 2;
      const kind = e.kind === 'good' ? 'star' : e.kind === 'bad' ? 'rock' : 'sphere';
      entities.push({ id: `fx${e.id}`, kind, x, y: 3 + (0.8 - e.t) * 2, z, sx: 1, sy: 1, sz: 1, color: e.kind === 'bad' ? '#e05a5a' : e.kind === 'siding' ? '#d8d8d8' : undefined, alpha: Math.min(1, e.t * 1.5) });
    }
    return {
      env: 'grass',
      scenery: { set: 'meadow', clear: { w: 30, d: 32, z: 6 } },
      camera: { alpha: -Math.PI / 2, beta: 0.78, radius: 31, target: [0, 0, 3] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: s.teamIds.map((team, k) => ({ team, labelKey: team === 0 ? 'team.red' : 'team.blue', value: `🚂 ${s.scores[k]}` })),
      },
    };
  },
};
