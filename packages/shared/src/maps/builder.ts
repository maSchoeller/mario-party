import type { FieldDef, FieldType } from './types';

const CODE: Record<string, FieldType> = {
  B: 'blue',
  R: 'red',
  E: 'event',
  L: 'lucky',
  D: 'duel',
  I: 'item',
  S: 'shop',
  T: 'start',
  H: 'station',
  C: 'cablecar',
};

/** Tiny authoring helper for map content. Produces plain FieldDef data. */
export class MapBuilder {
  readonly fields = new Map<string, FieldDef>();

  add(id: string, type: FieldType, x: number, z: number, extra: Partial<FieldDef> = {}): string {
    if (this.fields.has(id)) throw new Error(`duplicate field ${id}`);
    this.fields.set(id, { id, type, x: round(x), z: round(z), next: [], ...extra });
    return id;
  }

  /** Adds a sequence of fields with a type pattern string (e.g. "BBRBE"). Returns ids. */
  seq(
    prefix: string,
    pattern: string,
    pos: (i: number, n: number) => { x: number; z: number; y?: number },
    extra: Partial<FieldDef> = {},
  ): string[] {
    const codes = pattern.replace(/\s+/g, '');
    const ids: string[] = [];
    for (let i = 0; i < codes.length; i++) {
      const t = CODE[codes[i]];
      if (!t) throw new Error(`unknown field code ${codes[i]}`);
      const p = pos(i, codes.length);
      ids.push(this.add(`${prefix}${i}`, t, p.x, p.z, { ...extra, ...(p.y !== undefined ? { y: round(p.y) } : {}) }));
    }
    return ids;
  }

  /** Fields along a spline (see `spline`); for open paths `from`/`to` are linked automatically. */
  path(prefix: string, pattern: string, ctrl: P[], opts: { from?: string; to?: string; closed?: boolean; tags?: string[] } = {}): string[] {
    const codes = pattern.replace(/\s+/g, '');
    const full = opts.closed ? ctrl : [...(opts.from ? [this.get(opts.from)] : []), ...ctrl, ...(opts.to ? [this.get(opts.to)] : [])];
    const pts = spline(full, codes.length, opts.closed);
    const ids = this.seq(prefix, codes, (i) => pts[i], opts.tags ? { tags: opts.tags } : {});
    this.chain(ids, opts.closed);
    if (opts.from) this.link(opts.from, ids[0]);
    if (opts.to) this.link(ids[ids.length - 1], opts.to);
    return ids;
  }

  chain(ids: string[], loop = false): void {
    for (let i = 0; i < ids.length - 1; i++) this.link(ids[i], ids[i + 1]);
    if (loop) this.link(ids[ids.length - 1], ids[0]);
  }

  link(a: string, b: string): void {
    const f = this.fields.get(a);
    if (!f) throw new Error(`unknown field ${a}`);
    if (!this.fields.has(b)) throw new Error(`unknown field ${b}`);
    if (!f.next.includes(b)) f.next.push(b);
  }

  get(id: string): FieldDef {
    const f = this.fields.get(id);
    if (!f) throw new Error(`unknown field ${id}`);
    return f;
  }

  build(): FieldDef[] {
    return [...this.fields.values()];
  }
}

export interface P {
  x: number;
  z: number;
  y?: number;
}

/**
 * Points on a Catmull-Rom spline through `ctrl`, evenly spaced by arc length.
 * open: `n` interior points (t = k/(n+1), the end points are existing fields);
 * closed: `n` points around the loop starting at ctrl[0].
 * y is interpolated linearly along the arc when the control points carry it.
 */
export function spline(ctrl: P[], n: number, closed = false): P[] {
  const pts = closed ? [ctrl[ctrl.length - 1], ...ctrl, ctrl[0], ctrl[1]] : [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const segs = closed ? ctrl.length : ctrl.length - 1;
  const dense: P[] = [];
  const RES = 40;
  for (let s = 0; s < segs; s++) {
    const [p0, p1, p2, p3] = [pts[s], pts[s + 1], pts[s + 2], pts[s + 3]];
    for (let k = 0; k < RES; k++) {
      const t = k / RES;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      dense.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        z: cr(p0.z, p1.z, p2.z, p3.z),
        y: (p1.y ?? 0) + ((p2.y ?? 0) - (p1.y ?? 0)) * t,
      });
    }
  }
  dense.push(closed ? { ...ctrl[0], y: ctrl[0].y ?? 0 } : { ...ctrl[ctrl.length - 1], y: ctrl[ctrl.length - 1].y ?? 0 });
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  const total = acc[acc.length - 1];
  const hasY = ctrl.some((c) => c.y !== undefined);
  const at = (d: number): P => {
    let i = 1;
    while (i < acc.length - 1 && acc[i] < d) i++;
    const t = (d - acc[i - 1]) / Math.max(1e-9, acc[i] - acc[i - 1]);
    const a = dense[i - 1];
    const b = dense[i];
    const p: P = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    if (hasY) p.y = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t;
    return p;
  };
  const out: P[] = [];
  for (let k = 0; k < n; k++) out.push(at(closed ? (k / n) * total : ((k + 1) / (n + 1)) * total));
  return out;
}

/** Id of the field (out of `ids`) closest to x/z – used to hook branches onto a loop. */
export function nearest(b: MapBuilder, ids: string[], x: number, z: number): string {
  let best = ids[0];
  let bd = Infinity;
  for (const id of ids) {
    const f = b.get(id);
    const d = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d < bd) (bd = d), (best = id);
  }
  return best;
}

/** Shortest distance from a point to a polyline (x/z). */
export function distToPolyline(p: { x: number; z: number }, line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.z - (az + dz * t)));
  }
  return best;
}

/**
 * Fields standing in a channel: ford stones for `fordIds` (flooded at high tide), bridge
 * fields (raised to `bridgeY`) for everything else.
 */
export function tagCrossings(b: MapBuilder, channel: [number, number][], reach: number, bridgeY: number, fordIds: string[] = []): void {
  for (const f of b.fields.values()) {
    if (distToPolyline(f, channel) > reach) continue;
    if (fordIds.includes(f.id)) {
      f.tags = ['ford'];
      f.y = -0.3;
    } else {
      f.tags = [...(f.tags ?? []), 'bridge'];
      f.y = bridgeY;
    }
  }
}

export function lerp(a: { x: number; z: number }, b: { x: number; z: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
