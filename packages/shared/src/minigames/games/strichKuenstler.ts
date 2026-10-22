import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import { botRef, type MgEntity, type MgHud, type MgPlayer, type MinigameDef } from '../types';
import { ageFx, clamp, emitFx, ranksFromScores, rowSpawn, viewFx, type FxState } from '../util';

/**
 * #6 Strich-Künstler (FFA, Zeichnen): trace a given shape on the phone in one stroke.
 * Score per shape (max 100) = accuracy (mean distance of the drawn points to the shape)
 * + coverage (how much of the shape was traced), with a small bonus for being fast (only for
 * the part of the shape actually traced, so a hasty half trace doesn't beat a careful one).
 * 3 shapes in a row, points are summed.
 *
 * Coordinates: shape and stroke points are 0..1 with y pointing DOWN (screen coordinates,
 * top of the phone canvas = 0). The TV maps the top of the shape to +z (far side).
 */
export type ShapeId = 'star' | 'heart' | 'wave' | 'bolt';
type Pt = [number, number];

const SHAPE_IDS: ShapeId[] = ['star', 'heart', 'wave', 'bolt'];
const ROUNDS = 3;
const SHOW = 2;
const DRAW = 12;
const SCORE = 3;
const N = 64; // resample size for scoring
const COVER_R = 0.07;
const ACC_R = 0.12;
/** bots: how early the finger tends to lift (share of the shape left out, sd) */
const BOT_LIFT = { easy: 0.16, medium: 0.1, hard: 0.07 };
/** bots: chance per shape that the stroke goes wrong halfway (finger slips off) */
const BOT_SLIP = { easy: 0.25, medium: 0.18, hard: 0.12 };

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

// TV layout: big tilted easel board with the shape, one drawing desk per player
const BW = 9;
const BZ = 6;
const TILT = 0.35;
const BOARD_Y = 1.95;
const SW = 4.2;
const SZ = -4.2;
const DESK_H = 0.6;
const sheetX = (n: number, i: number) => rowSpawn(n, 5.2, i);
/** world position of a point on the tilted board (lx right, lz up the board, ly off the surface) */
function onBoard(lx: number, lz: number, ly: number): { x: number; y: number; z: number } {
  return { x: lx, y: BOARD_Y + ly * Math.cos(TILT) + lz * Math.sin(TILT), z: BZ - ly * Math.sin(TILT) + lz * Math.cos(TILT) };
}

function makeShape(id: ShapeId): Pt[] {
  const pts: Pt[] = [];
  if (id === 'star') {
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 === 0 ? 0.45 : 0.19;
      pts.push([0.5 + Math.cos(a) * r, 0.53 + Math.sin(a) * r]);
    }
  } else if (id === 'heart') {
    for (let k = 0; k <= 40; k++) {
      const t = (k / 40) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([0.5 + x / 38, 0.47 - y / 38]);
    }
  } else if (id === 'wave') {
    for (let k = 0; k <= 32; k++) {
      const u = k / 32;
      pts.push([0.08 + u * 0.84, 0.5 - 0.25 * Math.sin(u * Math.PI * 4)]);
    }
  } else {
    pts.push([0.66, 0.04], [0.3, 0.52], [0.56, 0.5], [0.36, 0.96], [0.76, 0.4], [0.5, 0.42], [0.66, 0.04]);
  }
  return pts.map(([x, y]) => [r4(x), r4(y)]);
}

export const SHAPES: Record<ShapeId, Pt[]> = {
  star: makeShape('star'),
  heart: makeShape('heart'),
  wave: makeShape('wave'),
  bolt: makeShape('bolt'),
};

function pathLength(pts: Pt[]): number {
  let l = 0;
  for (let k = 1; k < pts.length; k++) l += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return l;
}

/** Resample a polyline to n points evenly spaced along its length. */
export function resample(pts: Pt[], n: number): Pt[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as Pt);
  const total = pathLength(pts);
  if (total <= 1e-9) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as Pt);
  const out: Pt[] = [];
  let seg = 1;
  let acc = 0; // length up to pts[seg-1]
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < pts.length - 1 && acc + Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]) < target) {
      acc += Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
      seg++;
    }
    const a = pts[seg - 1];
    const b = pts[seg];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const f = l > 0 ? clamp((target - acc) / l, 0, 1) : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const f = l2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - dx * f, p[1] - a[1] - dy * f);
}

function distToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) best = Math.min(best, distToSegment(p, line[k - 1], line[k]));
  return best;
}

/**
 * Quality of a stroke for a shape, 0..1: half accuracy (mean distance of the drawn points to
 * the shape), half coverage (share of the shape that has a drawn point close by).
 */
export function strokeQuality(shape: Pt[], stroke: Pt[]): { accuracy: number; coverage: number; quality: number } {
  if (stroke.length < 2) return { accuracy: 0, coverage: 0, quality: 0 };
  const drawn = resample(stroke, N);
  const target = resample(shape, N);
  const mean = drawn.reduce((sum, p) => sum + distToPolyline(p, shape), 0) / drawn.length;
  const accuracy = clamp(1 - mean / ACC_R, 0, 1);
  const covered = target.filter((t) => drawn.some((d) => Math.hypot(d[0] - t[0], d[1] - t[1]) < COVER_R)).length;
  const coverage = covered / target.length;
  return { accuracy, coverage, quality: accuracy * 0.5 + coverage * 0.5 };
}

/** Points for one shape (0..100): quality, plus up to 25 % bonus for fast drawing, scaled by the coverage. */
export function strokePoints(quality: number, seconds: number, coverage = 1): number {
  const speed = clamp(1 - (seconds - 2) / (DRAW - 2), 0, 1);
  return Math.round(100 * quality * (0.75 + 0.25 * speed * coverage));
}

interface P {
  total: number;
  /** points for the current shape (null = nothing drawn yet) */
  pts: number | null;
  /** drawn stroke for the TV (reduced) */
  stroke: Pt[] | null;
  botAt: number | null;
}

export interface StrichKuenstlerState extends FxState {
  t: number;
  practice: boolean;
  n: number;
  colors: string[];
  order: ShapeId[];
  round: number;
  phase: 'show' | 'draw' | 'score' | 'done';
  phaseAt: number;
  ps: P[];
  /** bot form per player (v0.5) */
  form: number[];
}

const shapeOf = (s: StrichKuenstlerState) => s.order[(s.round - 1) % s.order.length];

function finishDraw(s: StrichKuenstlerState): void {
  for (const p of s.ps) {
    if (p.pts === null) p.pts = 0;
    p.total += p.pts;
  }
  // round scored: confetti over good drawings (one sound for the best), smoke for empty sheets
  const best = Math.max(...s.ps.map((p) => p.pts ?? 0));
  let sounded = false;
  s.ps.forEach((p, i) => {
    const x = sheetX(s.n, i);
    if ((p.pts ?? 0) >= 70) {
      const sfx = !sounded && p.pts === best ? 'correct' : undefined;
      if (sfx) sounded = true;
      emitFx(s, { kind: 'confetti', sfx, x, y: 2.2, z: SZ, color: s.colors[i], s: 0.8 }, 0.6);
    } else if (!p.pts) emitFx(s, { kind: 'smoke', x, y: 1.2, z: SZ, color: '#b9b3c4', s: 0.7 }, 0.6);
  });
  if (!sounded) emitFx(s, { sfx: best > 0 ? 'ding' : 'aww', x: 0, y: 2, z: SZ });
  s.phase = 'score';
  s.phaseAt = s.t;
}

function submit(s: StrichKuenstlerState, i: number, stroke: Pt[]): void {
  const p = s.ps[i];
  const q = strokeQuality(SHAPES[shapeOf(s)], stroke);
  p.pts = strokePoints(q.quality, s.t - s.phaseAt, q.coverage);
  p.stroke = resample(stroke, 20).map(([x, y]) => [r4(x), r4(y)]);
  emitFx(s, { kind: 'sparkle', sfx: 'scribble', x: sheetX(s.n, i), y: DESK_H + 0.8, z: SZ, color: s.colors[i] });
}

export const strichKuenstler: MinigameDef<StrichKuenstlerState> = {
  id: 'strichKuenstler',
  format: 'ffa',
  control: 'draw',
  theme: 'any',
  duration: 45,
  setup(players: MgPlayer[], rng, opts) {
    return {
      t: 0,
      practice: opts.practice,
      n: players.length,
      colors: players.map((p) => PLAYER_COLOR_HEX[p.color]),
      order: rng.shuffle([...SHAPE_IDS]),
      round: 1,
      phase: 'show',
      phaseAt: 0,
      ps: players.map(() => ({ total: 0, pts: null, stroke: null, botAt: null })),
      form: players.map((p) => p.form ?? 1),
      fx: [],
      fxN: 0,
    };
  },
  layout(s, i) {
    if (s.phase === 'draw' && s.ps[i].pts === null) return { kind: 'draw', shape: SHAPES[shapeOf(s)] };
    if (s.phase === 'draw') return { kind: 'wait', labelKey: 'mg.strichKuenstler.done' };
    return { kind: 'wait', labelKey: 'ctrl.watch' };
  },
  input(s, i, input) {
    if (input.type !== 'draw' || s.phase !== 'draw' || s.ps[i].pts !== null) return;
    if (!Array.isArray(input.points)) return;
    const stroke: Pt[] = [];
    for (const pt of input.points.slice(0, 2000)) {
      if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
      stroke.push([clamp(pt[0], 0, 1), clamp(pt[1], 0, 1)]);
    }
    // ignore accidental taps
    if (stroke.length < 3 || pathLength(stroke) < 0.15) return;
    submit(s, i, stroke);
  },
  tick(s, dt) {
    s.t += dt;
    ageFx(s, dt);
    if (s.phase === 'show' && s.t >= s.phaseAt + SHOW) {
      s.phase = 'draw';
      s.phaseAt = s.t;
    } else if (s.phase === 'draw') {
      if (s.ps.every((p) => p.pts !== null) || s.t >= s.phaseAt + DRAW) finishDraw(s);
    } else if (s.phase === 'score' && s.t >= s.phaseAt + SCORE) {
      if (s.round >= ROUNDS && !s.practice) {
        s.phase = 'done';
        return;
      }
      if (s.practice && s.round % ROUNDS === 0) for (const p of s.ps) p.total = 0;
      s.round++;
      s.phase = 'show';
      s.phaseAt = s.t;
      const c = onBoard(0, 0, 0.6);
      emitFx(s, { kind: 'sparkle', sfx: 'magic', x: c.x, y: c.y, z: c.z, color: '#ffe08a', s: 1.6 });
      for (const p of s.ps) {
        p.pts = null;
        p.stroke = null;
        p.botAt = null;
      }
    }
  },
  isOver: (s) => s.phase === 'done',
  result: (s) => ranksFromScores(s.ps.map((p) => p.total)),
  bot(s, i, level, rng: Rng) {
    const p = s.ps[i];
    if (s.phase !== 'draw' || p.pts !== null) return [];
    const ref = botRef(level, s.form[i]);
    if (p.botAt === null) p.botAt = s.phaseAt + ref.traceTime * (1 + rng.noise() * 0.2);
    if (s.t < p.botAt) return [];
    // trace the shape with a shaky hand: some strokes go much better than others, and now and
    // then the finger lifts before the end (weak bots more often)
    const shake = ref.traceDev * Math.exp(rng.noise() * 0.6);
    const slip = rng.next() < BOT_SLIP[level];
    const reach = slip ? 0.45 + rng.next() * 0.35 : 1 - Math.abs(rng.noise()) * BOT_LIFT[level];
    const base = resample(SHAPES[shapeOf(s)], 48);
    const cut = Math.max(3, Math.round(base.length * Math.min(1, reach)));
    const ox = rng.noise() * shake;
    const oy = rng.noise() * shake;
    const points = base.slice(0, cut).map(([x, y], k) => [
      clamp(x + ox + rng.noise() * shake + Math.sin(k * 0.7) * shake * 0.5, 0, 1),
      clamp(y + oy + rng.noise() * shake + Math.cos(k * 0.6) * shake * 0.5, 0, 1),
    ]) as Pt[];
    return [{ type: 'draw', points, duration: s.t - s.phaseAt }];
  },
  view(s) {
    const shape = shapeOf(s);
    const nrm = onBoard(0, 0, 1);
    const ctr = onBoard(0, 0, 0);
    const ny = nrm.y - ctr.y;
    const nz = nrm.z - ctr.z;
    const top = onBoard(0, BW / 2 + 0.5, 0);
    const bottom = onBoard(0, -BW / 2 - 0.5, 0);
    const entities: MgEntity[] = [
      // big easel: wooden frame, paper sheet tilted towards the TV, legs and a chalk ledge
      { id: 'boardFrame', kind: 'box', x: 0, y: ctr.y - ny * 0.14, z: ctr.z - nz * 0.14, rx: -TILT, sx: BW + 1.7, sy: 0.22, sz: BW + 1.7, color: '#9a6a44', mat: 'wood' },
      { id: 'board', kind: 'box', x: 0, y: ctr.y, z: ctr.z, rx: -TILT, sx: BW + 1, sy: 0.12, sz: BW + 1, color: '#fdf6e3', mat: 'paper' },
      { id: 'legL', kind: 'box', x: -4.4, y: top.y / 2, z: top.z + 0.25, sx: 0.32, sy: top.y, sz: 0.32, color: '#8a5d3b', mat: 'wood' },
      { id: 'legR', kind: 'box', x: 4.4, y: top.y / 2, z: top.z + 0.25, sx: 0.32, sy: top.y, sz: 0.32, color: '#8a5d3b', mat: 'wood' },
      { id: 'ledge', kind: 'box', x: 0, y: Math.max(0.15, bottom.y - 0.05), z: bottom.z - 0.3, sx: BW + 1.8, sy: 0.3, sz: 0.5, color: '#8a5d3b', mat: 'wood' },
      // garden atelier dressing
      { id: 'easelL', kind: 'prop', prop: 'easel', x: -7.4, y: 0, z: 6.4, ry: 0.35, sx: 1.25 },
      { id: 'easelR', kind: 'prop', prop: 'easel', x: 7.4, y: 0, z: 6.2, ry: -0.35, sx: 1.25 },
      { id: 'bunting', kind: 'prop', prop: 'bunting', x: 0, y: 0, z: 11.9, sx: 1.9 },
      { id: 'bushL', kind: 'prop', prop: 'bushround', x: -9.6, y: 0, z: 9.2 },
      { id: 'bushR', kind: 'prop', prop: 'bushround', x: 9.8, y: 0, z: 9.6, ry: 2 },
      { id: 'flowL', kind: 'prop', prop: 'flowers', x: -6.2, y: 0, z: 9.6 },
      { id: 'flowR', kind: 'prop', prop: 'flowers', x: 6.4, y: 0, z: 9.8, ry: 2 },
      { id: 'flowM', kind: 'prop', prop: 'flowers', x: -10.4, y: 0, z: 2.2, ry: 1 },
      { id: 'flowN', kind: 'prop', prop: 'flowers', x: 10.6, y: 0, z: 1.4, ry: 3 },
      { id: 'lampL', kind: 'prop', prop: 'streetlamp', x: -11, y: 0, z: -2.6 },
      { id: 'lampR', kind: 'prop', prop: 'streetlamp', x: 11, y: 0, z: -2.6 },
    ];
    // the shape to trace, painted onto the big board
    resample(SHAPES[shape], 40).forEach(([px, py], k) => {
      const p = onBoard((px - 0.5) * BW, (0.5 - py) * BW, 0.12);
      entities.push({ id: `sh${k}`, kind: 'sphere', x: p.x, y: p.y, z: p.z, rx: -TILT, sx: 0.45, sy: 0.22, sz: 0.45, color: '#3b2f4f' });
    });
    // one drawing desk per player: wooden desk, paper sheet, template dots, drawn stroke
    const small = resample(SHAPES[shape], 14);
    s.ps.forEach((p, i) => {
      const cx = sheetX(s.n, i);
      entities.push({ id: `desk${i}`, kind: 'box', x: cx, y: DESK_H / 2 - 0.02, z: SZ, sx: SW + 0.8, sy: DESK_H, sz: SW + 0.8, color: '#b0835a', mat: 'planks' });
      entities.push({ id: `sb${i}`, kind: 'box', x: cx, y: DESK_H + 0.02, z: SZ, sx: SW + 0.5, sy: 0.06, sz: SW + 0.5, color: '#ffffff', mat: 'paper' });
      entities.push({ id: `pen${i}`, kind: 'box', x: cx + SW / 2 + 0.05, y: DESK_H + 0.1, z: SZ - SW / 2 + 0.2, ry: 0.5, sx: 0.12, sy: 0.12, sz: 1.1, color: s.colors[i] });
      small.forEach(([px, py], k) =>
        entities.push({ id: `st${i}_${k}`, kind: 'sphere', x: cx + (px - 0.5) * SW, y: DESK_H + 0.08, z: SZ + (0.5 - py) * SW, sx: 0.22, sy: 0.1, sz: 0.22, color: '#c9c3d6' }),
      );
      p.stroke?.forEach(([px, py], k) =>
        entities.push({ id: `dr${i}_${k}`, kind: 'sphere', x: cx + (px - 0.5) * SW, y: DESK_H + 0.12, z: SZ + (0.5 - py) * SW, sx: 0.32, sy: 0.16, sz: 0.32, color: s.colors[i], player: i }),
      );
      const showPts = p.pts !== null && (s.phase === 'score' || s.phase === 'done' || p.stroke !== null);
      // the artist stands behind the desk, facing the TV
      const pz = SZ + SW / 2 + 1.1;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: cx,
        y: 0,
        z: pz,
        anim: s.phase === 'score' && p.pts !== null && p.pts >= 70 ? 'cheer' : s.phase === 'draw' && p.pts === null ? 'walk' : 'idle',
      });
      // the "+NN" floats well above the head (a label sits 1.1 over its entity: a tiny carrier box)
      if (showPts) entities.push({ id: `pts${i}`, kind: 'box', x: cx, y: 2.9, z: pz, sx: 0.02, sy: 0.02, sz: 0.02, color: s.colors[i], label: `+${p.pts}` });
    });
    const hud: MgHud = { scores: s.ps.map((p, i) => ({ player: i, value: `✏️ ${p.total}` })) };
    if (s.phase === 'show') hud.message = { key: `mg.strichKuenstler.shape.${shape}` };
    if (s.phase === 'draw') hud.timer = Math.max(0, s.phaseAt + DRAW - s.t);
    return {
      env: 'grass',
      scenery: { set: 'garden', clear: { w: 24, d: 21, z: 1.6 } },
      camera: { alpha: -Math.PI / 2, beta: 0.66, radius: 27.5, target: [0, 0.6, 1.4] },
      entities,
      fx: viewFx(s),
      hud,
    };
  },
};
