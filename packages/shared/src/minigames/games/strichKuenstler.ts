import { PLAYER_COLOR_HEX } from '../../config';
import type { Rng } from '../../rng';
import type { MgEntity, MgHud, MgPlayer, MinigameDef } from '../types';
import { clamp, ranksFromScores, rowSpawn } from '../util';

/**
 * #6 Strich-Künstler (FFA, Zeichnen): trace a given shape on the phone in one stroke.
 * Score per shape (max 100) = accuracy (mean distance of the drawn points to the shape)
 * + coverage (how much of the shape was traced), with a small bonus for being fast.
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

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

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

/** Points for one shape (0..100): quality, plus up to 25 % bonus for fast drawing. */
export function strokePoints(quality: number, seconds: number): number {
  const speed = clamp(1 - (seconds - 2) / (DRAW - 2), 0, 1);
  return Math.round(100 * quality * (0.75 + 0.25 * speed));
}

interface P {
  total: number;
  /** points for the current shape (null = nothing drawn yet) */
  pts: number | null;
  /** drawn stroke for the TV (reduced) */
  stroke: Pt[] | null;
  botAt: number | null;
}

export interface StrichKuenstlerState {
  t: number;
  practice: boolean;
  n: number;
  colors: string[];
  order: ShapeId[];
  round: number;
  phase: 'show' | 'draw' | 'score' | 'done';
  phaseAt: number;
  ps: P[];
}

const shapeOf = (s: StrichKuenstlerState) => s.order[(s.round - 1) % s.order.length];

function finishDraw(s: StrichKuenstlerState): void {
  for (const p of s.ps) {
    if (p.pts === null) p.pts = 0;
    p.total += p.pts;
  }
  s.phase = 'score';
  s.phaseAt = s.t;
}

function submit(s: StrichKuenstlerState, i: number, stroke: Pt[]): void {
  const p = s.ps[i];
  const q = strokeQuality(SHAPES[shapeOf(s)], stroke);
  p.pts = strokePoints(q.quality, s.t - s.phaseAt);
  p.stroke = resample(stroke, 20).map(([x, y]) => [r4(x), r4(y)]);
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
    if (p.botAt === null) {
      const time = { easy: 7.5, medium: 5.5, hard: 4 }[level];
      p.botAt = s.phaseAt + time + rng.noise() * 0.8;
    }
    if (s.t < p.botAt) return [];
    // trace the shape with a shaky hand; weak bots also stop early
    const shake = { easy: 0.05, medium: 0.03, hard: 0.015 }[level];
    const reach = { easy: 0.78, medium: 0.9, hard: 0.97 }[level] + rng.next() * 0.06;
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
    const entities: MgEntity[] = [];
    // big board with the shape to trace
    const BW = 9;
    const BZ = 6;
    entities.push({ id: 'board', kind: 'box', x: 0, y: 0.1, z: BZ, sx: BW + 1, sy: 0.2, sz: BW + 1, color: '#fdf6e3' });
    resample(SHAPES[shape], 40).forEach(([px, py], k) =>
      entities.push({ id: `sh${k}`, kind: 'sphere', x: (px - 0.5) * BW, y: 0.35, z: BZ + (0.5 - py) * BW, sx: 0.45, sy: 0.25, sz: 0.45, color: '#3b2f4f' }),
    );
    // one small board per player showing the drawn stroke and the points
    const SW = 4.2;
    const SZ = -4.2;
    const small = resample(SHAPES[shape], 14);
    s.ps.forEach((p, i) => {
      const cx = rowSpawn(s.n, 5.2, i);
      entities.push({ id: `sb${i}`, kind: 'box', x: cx, y: 0.1, z: SZ, sx: SW + 0.6, sy: 0.2, sz: SW + 0.6, color: '#ffffff' });
      small.forEach(([px, py], k) =>
        entities.push({ id: `st${i}_${k}`, kind: 'sphere', x: cx + (px - 0.5) * SW, y: 0.3, z: SZ + (0.5 - py) * SW, sx: 0.22, sy: 0.12, sz: 0.22, color: '#c9c3d6' }),
      );
      p.stroke?.forEach(([px, py], k) =>
        entities.push({ id: `dr${i}_${k}`, kind: 'sphere', x: cx + (px - 0.5) * SW, y: 0.4, z: SZ + (0.5 - py) * SW, sx: 0.32, sy: 0.2, sz: 0.32, color: s.colors[i], player: i }),
      );
      const showPts = p.pts !== null && (s.phase === 'score' || s.phase === 'done' || p.stroke !== null);
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: cx,
        y: 0,
        z: SZ - SW / 2 - 1.3,
        anim: s.phase === 'score' && p.pts !== null && p.pts >= 70 ? 'cheer' : s.phase === 'draw' && p.pts === null ? 'walk' : 'idle',
        label: showPts ? `+${p.pts}` : undefined,
      });
    });
    const hud: MgHud = { scores: s.ps.map((p, i) => ({ player: i, value: `✏️ ${p.total}` })) };
    if (s.phase === 'show') hud.message = { key: `mg.strichKuenstler.shape.${shape}` };
    if (s.phase === 'draw') hud.timer = Math.max(0, s.phaseAt + DRAW - s.t);
    return {
      env: 'grass',
      camera: { alpha: -Math.PI / 2, beta: 0.62, radius: 27, target: [0, 0, 1] },
      entities,
      hud,
    };
  },
};
