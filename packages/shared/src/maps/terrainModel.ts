import type { FieldDef, MapDef, TerrainDef } from './types';

/**
 * Babylon-free landscape model (v0.3, pure since v0.5 so the map tests can check the
 * geometry): a height field built from the map's terrain description (land blobs, bays,
 * hills, the volcano cone, river/lava channels) with the field graph laid into it. The
 * renderer (apps/web terrain.ts) turns it into a mesh; `height()` samples exactly the
 * triangles that mesh draws.
 */
export type Ground = 'grass' | 'sand' | 'rock' | 'water' | 'path' | 'channel';

export interface TerrainEdge {
  from: string;
  to: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ya: number;
  yb: number;
  kind: 'normal' | 'bridge' | 'pier' | 'shallow';
}

/** Grid spacing of the height field. */
export const TERRAIN_RES = 0.5;
/** clearance values beyond this are irrelevant (scatter / buildings only care about the near range) */
const CLEAR_CAP = 6;
/** Terrain under a tile and under the path, relative to the field height (tile base: fy-0.35..fy-0.13). */
export const GROUND_BELOW_TILE = 0.22;
/**
 * Radius around a tile centre that is completely level (tile base radius is 1.475; the
 * 1 m grid cells around the base must be level too), blending out to TILE_BLEND.
 */
export const TILE_FLAT = 1.9;
const TILE_BLEND = 2.9;
/** Paths meet a bridge this far below its tile (the deck ends are 0.21 below it). */
const BRIDGE_PATH_DROP = 0.1;
/** Width of the sloped bank beside a channel. */
const CHANNEL_BANK = 1.4;
/** Lava streams cut a groove this deep (the renderer's lava ribbon flows in it). */
export const LAVA_GROOVE = 0.55;

export const GROUNDS: Ground[] = ['grass', 'sand', 'rock', 'water', 'path', 'channel'];
const GROUND_ID = Object.fromEntries(GROUNDS.map((g, i) => [g, i])) as Record<Ground, number>;

export class TerrainModel {
  readonly fieldY = new Map<string, number>();
  readonly edges: TerrainEdge[] = [];
  readonly def: TerrainDef;
  readonly minX: number;
  readonly minZ: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  readonly cls: Uint8Array;
  /** distance to the nearest path edge per grid vertex (capped), for fast scatter queries */
  readonly clear: Float32Array;

  constructor(readonly map: MapDef) {
    this.def = map.terrain;
    const xs = map.fields.map((f) => f.x).concat((map.decor ?? []).map((d) => d.x));
    const zs = map.fields.map((f) => f.z).concat((map.decor ?? []).map((d) => d.z));
    const M = 22;
    this.minX = Math.floor(Math.min(...xs) - M);
    this.minZ = Math.floor(Math.min(...zs) - M);
    this.nx = Math.ceil((Math.max(...xs) + M - this.minX) / TERRAIN_RES) + 1;
    this.nz = Math.ceil((Math.max(...zs) + M - this.minZ) / TERRAIN_RES) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.cls = new Uint8Array(this.nx * this.nz);
    this.clear = new Float32Array(this.nx * this.nz);
    this.layoutFields();
    this.buildHeights();
  }

  // ------------------------------------------------------------------ height model

  /** Signed land value in world units: > 0 on land, < 0 in the sea. */
  land(x: number, z: number): number {
    const d = this.def;
    let L = -Infinity;
    for (const b of d.land) L = smax(L, ellipse(x, z, b), 4);
    for (const c of d.cuts ?? []) L = smin(L, -ellipse(x, z, c), 3);
    // ragged coastline
    return L + (fbm(x * 0.07, z * 0.07, 3, 11) - 0.5) * 5;
  }

  /** Natural height (land + hills + volcano), before paths and channels. */
  natural(x: number, z: number): { y: number; L: number } {
    const d = this.def;
    const L = this.land(x, z);
    const wl = d.water.low ?? d.water.high;
    let y: number;
    if (L < 0) {
      y = wl - 0.2 + Math.max(-6, L * 0.45);
      for (const s of d.shallows ?? []) y = Math.max(y, y + (s.y - y) * smoothstep(0, 3, ellipse(x, z, s)));
    } else y = d.water.high - 0.25 + (d.base - d.water.high + 0.25) * smoothstep(0, 4.5, L);
    const inland = smoothstep(1, 6, L);
    const v = d.volcano;
    // the plateau around the crater stays calm (the crater prop sits on it)
    const calm = v ? 1 - 0.75 * smoothstep(v.top + 2, v.top, Math.hypot(x - v.x, z - v.z)) : 1;
    y += (fbm(x * 0.05, z * 0.05, 4, 3) - 0.5) * 0.9 * inland * calm;
    for (const hl of d.hills ?? []) {
      const rz = hl.rz ?? hl.r;
      const q = ((x - hl.x) / hl.r) ** 2 + ((z - hl.z) / rz) ** 2;
      y += hl.h * Math.exp(-q * 1.6) * (hl.h > 0 ? inland : 1);
    }
    if (v) y += v.h * coneProfile((v.r - Math.hypot(x - v.x, z - v.z)) / (v.r - v.top));
    return { y, L };
  }

  channelDist(x: number, z: number): { d: number; w: number; kind: 'water' | 'lava' } | null {
    let best: { d: number; w: number; kind: 'water' | 'lava' } | null = null;
    let meander: number | null = null;
    for (const c of this.def.channels ?? []) {
      const reach = c.width / 2 + 3;
      for (let i = 0; i < c.points.length - 1; i++) {
        const [ax, az] = c.points[i];
        const [bx, bz] = c.points[i + 1];
        if (x < Math.min(ax, bx) - reach || x > Math.max(ax, bx) + reach || z < Math.min(az, bz) - reach || z > Math.max(az, bz) + reach) continue;
        // meander the banks a little (one noise lookup per point)
        meander ??= (noise2(x * 0.18, z * 0.18, 5) - 0.5) * 1.0;
        const dd = distToSegment(x, z, ax, az, bx, bz).d + meander;
        if (!best || dd - c.width / 2 < best.d - best.w / 2) best = { d: dd, w: c.width, kind: c.kind };
      }
    }
    return best;
  }

  private layoutFields() {
    const d = this.def;
    const has = (f: FieldDef, t: string) => !!f.tags?.includes(t);
    const idx = new Map(this.map.fields.map((f) => [f.id, f]));
    for (const f of this.map.fields) {
      const nat = this.natural(f.x, f.z).y;
      this.fieldY.set(f.id, f.y ?? Math.max(nat, d.water.high + 0.4));
    }
    // bridge fields: a little above their banks (deck ends meet the path), above the water
    for (const f of this.map.fields) {
      if (f.y !== undefined || !has(f, 'bridge')) continue;
      const banks = [...f.next, ...this.map.fields.filter((g) => g.next.includes(f.id)).map((g) => g.id)].filter((id) => !has(idx.get(id)!, 'bridge'));
      const bank = banks.length ? banks.reduce((sum, id) => sum + this.fieldY.get(id)!, 0) / banks.length : d.base;
      this.fieldY.set(f.id, Math.max(bank + 0.15, d.water.high + 0.55));
    }
    // paths run up to a bridge deck slightly below its tile, so they end under the deck
    const level = (f: FieldDef) => this.fieldY.get(f.id)! - (has(f, 'bridge') ? BRIDGE_PATH_DROP : 0);
    for (const f of this.map.fields) {
      for (const n of f.next) {
        const g = idx.get(n)!;
        let kind: TerrainEdge['kind'] = 'normal';
        if (has(f, 'pier') || has(g, 'pier')) kind = 'pier';
        else if (has(f, 'bridge') || has(g, 'bridge')) kind = 'bridge';
        else if (has(f, 'sandbank') || has(g, 'sandbank') || has(f, 'ford') || has(g, 'ford')) kind = 'shallow';
        this.edges.push({ from: f.id, to: g.id, ax: f.x, az: f.z, bx: g.x, bz: g.z, ya: level(f), yb: level(g), kind });
      }
    }
  }

  /**
   * Height of the path along an edge at parameter t (0..1, centre to centre): level on
   * both tiles, the climb happens in between.
   */
  static pathLevel(e: TerrainEdge, t: number): number {
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const ramp = Math.max(0.01, len - 2 * TILE_FLAT);
    const u = Math.max(0, Math.min(1, (t * len - TILE_FLAT) / ramp));
    return e.ya + (e.yb - e.ya) * u;
  }

  private buildHeights() {
    const d = this.def;
    // tiles keep a flat pad (bridge and pier tiles stand on their deck)
    const pads = this.map.fields.filter((f) => !f.tags?.some((t) => t === 'pier' || t === 'bridge'));
    // tiles next to a channel keep solid ground under them (only crossings stand in it)
    const dry = pads.filter((f) => !f.tags?.includes('ford'));
    // coarse buckets: which edges / pads can matter around a grid vertex
    const B = 4;
    const bw = Math.ceil((this.nx * TERRAIN_RES) / B) + 1;
    const bh = Math.ceil((this.nz * TERRAIN_RES) / B) + 1;
    const bucketsOf = <T>(items: T[], box: (it: T) => [number, number, number, number]) => {
      const out: T[][] = Array.from({ length: bw * bh }, () => []);
      for (const it of items) {
        const [x0, z0, x1, z1] = box(it);
        for (let bj = Math.max(0, Math.floor((z0 - this.minZ) / B)); bj <= Math.min(bh - 1, Math.floor((z1 - this.minZ) / B)); bj++)
          for (let bi = Math.max(0, Math.floor((x0 - this.minX) / B)); bi <= Math.min(bw - 1, Math.floor((x1 - this.minX) / B)); bi++) out[bj * bw + bi].push(it);
      }
      return out;
    };
    const edgeB = bucketsOf(this.edges, (e) => [Math.min(e.ax, e.bx) - CLEAR_CAP, Math.min(e.az, e.bz) - CLEAR_CAP, Math.max(e.ax, e.bx) + CLEAR_CAP, Math.max(e.az, e.bz) + CLEAR_CAP]);
    const padB = bucketsOf(pads, (f) => [f.x - 4, f.z - 4, f.x + 4, f.z + 4]);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.minX + i * TERRAIN_RES;
        const z = this.minZ + j * TERRAIN_RES;
        const bk = Math.floor((z - this.minZ) / B) * bw + Math.floor((x - this.minX) / B);
        const nearEdges = edgeB[bk];
        const nearPads = padB[bk];
        const nat = this.natural(x, z);
        let y = nat.y;
        let cls: Ground = 'grass';
        // 1) paths are flattened into the land …
        let w = 0;
        let target = y;
        let nearest = CLEAR_CAP;
        for (const e of nearEdges) {
          // cheap bounding-box reject before the exact distance
          if (x < Math.min(e.ax, e.bx) - CLEAR_CAP || x > Math.max(e.ax, e.bx) + CLEAR_CAP || z < Math.min(e.az, e.bz) - CLEAR_CAP || z > Math.max(e.az, e.bz) + CLEAR_CAP) continue;
          const s = distToSegment(x, z, e.ax, e.az, e.bx, e.bz);
          if (s.d < nearest) nearest = s.d;
          if (e.kind === 'pier' || e.kind === 'shallow') continue;
          const k = smoothstep(3.4, 1.3, s.d);
          if (k > w) {
            w = k;
            target = TerrainModel.pathLevel(e, s.t) - GROUND_BELOW_TILE;
          }
        }
        this.clear[j * this.nx + i] = nearest;
        if (w > 0) {
          y = y + (target - y) * w;
          if (w > 0.55) cls = 'path';
        }
        // … and every tile gets a level pad that wins over the sloped paths around it
        let kt = 0;
        let pad = y;
        let dryDist = Infinity;
        for (const f of nearPads) {
          if (Math.abs(x - f.x) > 4 || Math.abs(z - f.z) > 4) continue;
          const r = Math.hypot(x - f.x, z - f.z);
          if (!f.tags?.includes('ford')) dryDist = Math.min(dryDist, r);
          const k = smoothstep(TILE_BLEND, TILE_FLAT, r);
          if (k > kt) {
            kt = k;
            pad = this.fieldY.get(f.id)! - GROUND_BELOW_TILE;
          }
        }
        if (kt > 0) {
          y = y + (pad - y) * kt;
          if (kt > 0.55) cls = 'path';
        }
        // 2) channels (river / lava) are carved below the water, never under a dry tile
        const ch = this.channelDist(x, z);
        if (ch) {
          const half = ch.w / 2;
          const bed = (ch.kind === 'lava' ? d.water.high : (d.water.low ?? d.water.high)) - 0.7;
          let k = smoothstep(half + CHANNEL_BANK, half - 0.4, ch.d);
          if (dry.length) k *= smoothstep(TILE_FLAT + 0.2, TILE_BLEND + 0.9, dryDist);
          if (k > 0) {
            // a lava stream runs in a groove that follows the ground down to the lava sea
            const floor = ch.kind === 'lava' ? Math.max(bed, y - LAVA_GROOVE) : bed;
            y = y + (Math.min(y, floor) - y) * k;
            if (k > 0.5) cls = 'channel';
          }
        }
        // 3) sandbank / ford bars rise from the water just below their fields
        for (const e of nearEdges) {
          if (e.kind !== 'shallow' || nearest > 2.4) continue;
          const s = distToSegment(x, z, e.ax, e.az, e.bx, e.bz);
          const k = smoothstep(2.4, 1.0, s.d);
          if (k > 0) {
            const bar = Math.min(e.ya, e.yb) - GROUND_BELOW_TILE - noise2(x * 0.8, z * 0.8, 9) * 0.08;
            if (y < bar || cls === 'channel') y = y + (bar - y) * k;
            if (k > 0.5) cls = 'sand';
          }
        }
        if (cls === 'grass') cls = this.classify(x, z, y, nat.L);
        this.h[j * this.nx + i] = y;
        this.cls[j * this.nx + i] = GROUND_ID[cls];
      }
    }
    // slope based rock after the heights exist
    for (let j = 1; j < this.nz - 1; j++) {
      for (let i = 1; i < this.nx - 1; i++) {
        const k = j * this.nx + i;
        if (this.cls[k] !== GROUND_ID.grass) continue;
        const gx = (this.h[k + 1] - this.h[k - 1]) / (2 * TERRAIN_RES);
        const gz = (this.h[k + this.nx] - this.h[k - this.nx]) / (2 * TERRAIN_RES);
        if (Math.hypot(gx, gz) > 0.75) this.cls[k] = GROUND_ID.rock;
      }
    }
  }

  private classify(x: number, z: number, y: number, L: number): Ground {
    const d = this.def;
    if (y < d.water.high - 0.02) return 'water';
    if (L < (d.beach ?? 3.2) + (noise2(x * 0.2, z * 0.2, 4) - 0.5) * 2 && y < d.base + 0.5) return 'sand';
    return 'grass';
  }

  // ------------------------------------------------------------------ queries

  /**
   * Height of the built terrain mesh: the plane of the very triangle the renderer draws
   * (cells alternate their diagonal, see `cellDiagonal`).
   */
  height(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.minX) / TERRAIN_RES));
    const fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.minZ) / TERRAIN_RES));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * this.nx + i;
    const a = this.h[k]; // (0,0)
    const b = this.h[k + 1]; // (1,0)
    const c = this.h[k + this.nx]; // (0,1)
    const e = this.h[k + this.nx + 1]; // (1,1)
    if (cellDiagonal(i, j) === 0) {
      // diagonal (0,0)–(1,1)
      return u >= v ? a + (b - a) * u + (e - b) * v : a + (c - a) * v + (e - c) * u;
    }
    // diagonal (1,0)–(0,1)
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (b - e) * (1 - v);
  }

  ground(x: number, z: number): Ground {
    const i = Math.round((x - this.minX) / TERRAIN_RES);
    const j = Math.round((z - this.minZ) / TERRAIN_RES);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 'water';
    return GROUNDS[this.cls[j * this.nx + i]];
  }

  /** Distance to the nearest path edge (for keeping scatter off the paths), capped at CLEAR_CAP. */
  clearance(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.minX) / TERRAIN_RES));
    const fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.minZ) / TERRAIN_RES));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * this.nx + i;
    const c = this.clear;
    // bilinear interpolation underestimates near the path, which is the safe side
    return c[k] * (1 - u) * (1 - v) + c[k + 1] * u * (1 - v) + c[k + this.nx] * (1 - u) * v + c[k + this.nx + 1] * u * v;
  }

  /** Lowest terrain point inside a circle (footprint checks against water / lava). */
  minHeight(x: number, z: number, r: number): number {
    let lo = this.height(x, z);
    for (let rr = r / 2; rr <= r + 1e-6; rr += r / 2) for (let a = 0; a < Math.PI * 2; a += 0.5) lo = Math.min(lo, this.height(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    return lo;
  }

  get bounds() {
    return { minX: this.minX, minZ: this.minZ, maxX: this.minX + (this.nx - 1) * TERRAIN_RES, maxZ: this.minZ + (this.nz - 1) * TERRAIN_RES };
  }
}

/**
 * Volcano flank: an even slope (the climb spreads over the whole path) with rounded foot
 * and shoulder. u = 0 at the foot, 1 at the plateau.
 */
export function coneProfile(u: number): number {
  const b = 0.25;
  const a = 1 / (1 - b);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < b) return (a * u * u) / (2 * b);
  if (u > 1 - b) return 1 - (a * (1 - u) ** 2) / (2 * b);
  return a * (u - b / 2);
}

/** Which diagonal splits grid cell (i, j): 0 = (0,0)–(1,1), 1 = (1,0)–(0,1). The mesh uses the same. */
export function cellDiagonal(i: number, j: number): 0 | 1 {
  return (i + j) % 2 === 0 ? 0 : 1;
}

export function ellipse(x: number, z: number, e: { x: number; z: number; rx: number; rz: number; rot?: number }): number {
  let dx = x - e.x;
  let dz = z - e.z;
  if (e.rot) {
    const c = Math.cos(e.rot);
    const s = Math.sin(e.rot);
    [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
  }
  const q = Math.hypot(dx / e.rx, dz / e.rz);
  return (1 - q) * Math.min(e.rx, e.rz);
}

function smax(a: number, b: number, k: number): number {
  if (!Number.isFinite(a)) return b;
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
}

function smin(a: number, b: number, k: number): number {
  return -smax(-a, -b, k);
}

// ------------------------------------------------------------------ noise (same as the renderer's noise.ts)

function hash(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function noise2(x: number, z: number, seed = 1): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, seed);
  const b = hash(xi + 1, zi, seed);
  const c = hash(xi, zi + 1, seed);
  const d = hash(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fBm in [0, 1] */
export function fbm(x: number, z: number, octaves = 4, seed = 1): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * f, z * f, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}
