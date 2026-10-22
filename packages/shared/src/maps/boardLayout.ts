import { getField, predecessors } from './index';
import { TerrainModel, distToSegment } from './terrainModel';
import type { DecorDef, FieldDef, MapDef } from './types';

/**
 * Where the board renderer puts its structures (bridges, piers, cable car, buildings next
 * to the fields, landmarks and decor). Pure, so the map tests check exactly what the
 * renderer builds: nothing may overlap a tile, a path or another building.
 */

/** Tile base radius (the widest part of a tile). */
export const TILE_R = 1.475;
/** Bridge / pier prop contract (props.py): deck top at the centre, 7 / 3 long, 2.4 wide. */
export const BRIDGE_DECK = 0.45;
export const BRIDGE_DECK_END = 0.3;
export const BRIDGE_LEN = 7;
export const PIER_DECK = 0.45;
/** Cable car station bull wheel height above the ground. */
export const CABLE_WHEEL = 4;
/** Sag of the cable in the middle of the span. */
export const CABLE_SAG = 1.2;
/** Gondola hangs this far below its clamp (bottom of the cabin). */
export const GONDOLA_DROP = 1.95;

/** Footprint radius of a prop (unscaled), used for every overlap check. */
const FOOTPRINT: Record<string, number> = {
  // landmarks
  volcano: 4.6,
  lighthouse: 2.2,
  cliff: 3.2,
  temple: 3.6,
  waterfall: 2.5,
  // buildings next to fields
  stall: 1.7,
  camp: 1.7,
  cityshop: 1.9,
  itemshop: 1.6,
  chest: 0.6,
  luckysign: 0.6,
  duelring: 0.6,
  station: 3.2,
  cablestation: 2.5,
  startgate: 0,
  // decor
  stilthut: 2.4,
  hut: 1.9,
  house: 1.6,
  house2: 1.3,
  house3: 1.7,
  tower: 1.2,
  fountain: 1.65,
  marketstall: 1.4,
  kiosk: 1.3,
  ruin: 1.3,
  cannon: 1.1,
  crab: 0.7,
  boat: 1.6,
  barrel: 0.4,
  crate: 0.5,
  torch: 0.3,
  driftwood: 1.0,
  mushroom: 1.3,
  obsidian: 1.0,
  bones: 1.3,
  minecart: 1.3,
  vent: 0.8,
  bench: 0.9,
  streetlamp: 0.35,
  hedge: 1.1,
  mailbox: 0.35,
};

/** Authored set pieces: placed first, everything else keeps clear of them. */
export const LANDMARKS = new Set(['volcano', 'lighthouse', 'cliff', 'temple', 'waterfall']);
/** Decor that belongs in the water. */
const AFLOAT = new Set(['boat', 'stilthut']);

export function footprint(kind: string, scale = 1): number {
  return (FOOTPRINT[kind] ?? 1.2) * scale;
}

/** Half width of the drawn path ribbon including its border. */
export function ribbonHalf(map: MapDef): number {
  return map.theme === 'city' ? 1.5 : 0.84;
}

export interface KeepOut {
  x: number;
  z: number;
  r: number;
  what: string;
}

export interface Spot {
  x: number;
  z: number;
  /** yaw (radians) the prop faces */
  yaw: number;
}

export interface BuildingPlan extends Spot {
  prop: string;
  field: string;
  r: number;
}

export interface BridgePlan extends Spot {
  field: string;
  /** deck span along the walking line, relative to the field centre */
  a: number;
  b: number;
  span: number;
  /** y of the prop origin */
  y: number;
  dir: { x: number; z: number };
}

export interface PierPlan extends Spot {
  len: number;
  /** y of the prop origin */
  y: number;
}

export interface CablePlan {
  stations: (BuildingPlan & { ground: number })[];
  /** cable ends (bull wheels) */
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
}

export interface DecorPlan {
  index: number;
  def: DecorDef;
  ok: boolean;
  why?: string;
}

export interface BoardLayout {
  terrain: TerrainModel;
  piers: PierPlan[];
  /** posts under pier tiles (top y) */
  pierPosts: { x: number; z: number; top: number }[];
  bridges: BridgePlan[];
  cable: CablePlan | null;
  buildings: BuildingPlan[];
  decor: DecorPlan[];
  keepOut: KeepOut[];
  /** fields that should have a building but found no room */
  missing: { field: string; prop: string }[];
}

/** Point on the cable at t (0 = start station, 1 = target station). */
export function cablePoint(c: Pick<CablePlan, 'a' | 'b'>, t: number): { x: number; y: number; z: number } {
  return {
    x: c.a.x + (c.b.x - c.a.x) * t,
    y: c.a.y + (c.b.y - c.a.y) * t - CABLE_SAG * 4 * t * (1 - t),
    z: c.a.z + (c.b.z - c.a.z) * t,
  };
}

/** Walking direction through a field (from its predecessor to its successor). */
export function fieldTangent(map: MapDef, f: FieldDef): { x: number; z: number } {
  const next = getField(map, f.next[0]);
  const prevId = predecessors(map, f.id)[0];
  const prev = prevId ? getField(map, prevId) : f;
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const l = Math.hypot(dx, dz);
  return l > 0 ? { x: dx / l, z: dz / l } : { x: 0, z: 1 };
}

const WATER_TAGS = ['pier', 'sandbank', 'ford', 'bridge'];

export function planBoard(map: MapDef, terrain: TerrainModel = new TerrainModel(map)): BoardLayout {
  const T = terrain;
  const water = map.terrain.water;
  const half = ribbonHalf(map);
  const keepOut: KeepOut[] = [];
  const out: BoardLayout = { terrain: T, piers: [], pierPosts: [], bridges: [], cable: null, buildings: [], decor: [], keepOut, missing: [] };
  const fy = (id: string) => T.fieldY.get(id)!;

  /** Room for a footprint of radius r: off tiles, paths, other structures and on dry land. */
  const isFree = (x: number, z: number, r: number, ignore?: string, onLand = true): boolean => {
    for (const f of map.fields) if (f.id !== ignore && Math.hypot(f.x - x, f.z - z) < r + TILE_R + 0.1) return false;
    for (const k of keepOut) if (Math.hypot(k.x - x, k.z - z) < r + k.r) return false;
    if (pathDist(map, x, z, ignore) < r + half + 0.1) return false;
    return !onLand || T.minHeight(x, z, r * 0.85) > water.high + 0.12;
  };

  // ---- piers: deck segments from tile rim to tile rim, posts under the pier tiles
  for (const e of T.edges) {
    if (e.kind !== 'pier') continue;
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const dx = (e.bx - e.ax) / len;
    const dz = (e.bz - e.az) / len;
    const from = 1.25;
    const span = len - 2 * from;
    if (span <= 0) continue;
    const segs = Math.max(1, Math.round(span / 3));
    const deck = Math.min(e.ya, e.yb) - 0.04;
    for (let i = 0; i < segs; i++) {
      const d = from + (span * (i + 0.5)) / segs;
      const x = e.ax + dx * d;
      const z = e.az + dz * d;
      out.piers.push({ x, z, yaw: Math.atan2(dx, dz), len: span / segs, y: deck - PIER_DECK });
      keepOut.push({ x, z, r: 1.6, what: 'pier' });
    }
  }
  for (const f of map.fields) {
    if (!f.tags?.includes('pier')) continue;
    const t = fieldTangent(map, f);
    for (const [s, a] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = f.x + (-t.z * s + t.x * a) * 0.75;
      const z = f.z + (t.x * s + t.z * a) * 0.75;
      out.pierPosts.push({ x, z, top: fy(f.id) - 0.3 });
    }
  }

  // ---- bridges: one straight deck per bridge field across all the water on its line
  for (const f of map.fields) {
    if (!f.tags?.includes('bridge')) continue;
    const dir = fieldTangent(map, f);
    // never reach under the neighbouring tiles (at a river mouth the water goes on and on)
    const near = (id: string | undefined) => (id ? Math.hypot(getField(map, id).x - f.x, getField(map, id).z - f.z) - TILE_R - 0.05 : 9);
    const back = Math.min(9, near(predecessors(map, f.id)[0]));
    const fwd = Math.min(9, near(f.next[0]));
    let lo = 0;
    let hi = 0;
    for (let t = -back; t <= fwd; t += 0.25) {
      if (T.height(f.x + dir.x * t, f.z + dir.z * t) < water.high + 0.3) {
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
    // a little bank on either side, at least 4 long, within the tile rims
    let a = Math.max(-back, lo - 1.2);
    let b = Math.min(fwd, hi + 1.2);
    const short = Math.max(0, 4 - (b - a)) / 2;
    a = Math.max(-back, a - short);
    b = Math.min(fwd, b + short);
    const mid = (a + b) / 2;
    const x = f.x + dir.x * mid;
    const z = f.z + dir.z * mid;
    out.bridges.push({ field: f.id, x, z, yaw: Math.atan2(dir.x, dir.z), a, b, span: b - a, y: fy(f.id) - 0.06 - BRIDGE_DECK, dir });
    keepOut.push({ x, z, r: (b - a) / 2, what: `bridge_${f.id}` });
  }

  // ---- landmarks reserve their ground before anything is built around them
  const decorDefs = map.decor ?? [];
  for (const [index, d] of decorDefs.entries()) {
    if (!LANDMARKS.has(d.kind)) continue;
    keepOut.push({ x: d.x, z: d.z, r: footprint(d.kind, d.s ?? 1), what: d.kind });
  }

  // ---- cable car: a station beside each end, chosen for room and a free cable
  const cc = map.fields.find((f) => f.type === 'cablecar');
  const target = map.gimmickParams?.cableCarTarget;
  if (cc && target) {
    const ends = [cc, getField(map, target)];
    const candidates = ends.map((f) => {
      const t = fieldTangent(map, f);
      const list: { x: number; z: number }[] = [];
      for (const dist of [3.9, 4.4, 5]) for (const along of [0, 1.5, -1.5, 3, -3]) for (const s of [1, -1]) list.push({ x: f.x - t.z * s * dist + t.x * along, z: f.z + t.x * s * dist + t.z * along });
      return list.filter((p) => isFree(p.x, p.z, 2.5, f.id));
    });
    let best: CablePlan | null = null;
    let bestScore = -Infinity;
    for (const pa of candidates[0]) {
      for (const pb of candidates[1]) {
        const ga = T.height(pa.x, pa.z);
        const gb = T.height(pb.x, pb.z);
        const c = { a: { x: pa.x, y: ga + CABLE_WHEEL, z: pa.z }, b: { x: pb.x, y: gb + CABLE_WHEEL, z: pb.z } };
        // lowest point of the gondola above the ground along the ride
        let clear = Infinity;
        for (let t = 0.08; t <= 0.92; t += 0.02) {
          const p = cablePoint(c, t);
          clear = Math.min(clear, p.y - GONDOLA_DROP - T.height(p.x, p.z));
        }
        const score = Math.min(clear, 1.5) * 10 - Math.hypot(pa.x - ends[0].x, pa.z - ends[0].z) - Math.hypot(pb.x - ends[1].x, pb.z - ends[1].z);
        if (score > bestScore) {
          bestScore = score;
          const st = (p: { x: number; z: number }, f: FieldDef, ground: number) => ({ prop: 'cablestation', field: f.id, x: p.x, z: p.z, yaw: Math.atan2(f.x - p.x, f.z - p.z), r: 2.5, ground });
          best = { ...c, stations: [st(pa, ends[0], ga), st(pb, ends[1], gb)] };
        }
      }
    }
    if (best) {
      out.cable = best;
      for (const s of best.stations) keepOut.push({ x: s.x, z: s.z, r: s.r, what: `cablestation_${s.field}` });
    } else out.missing.push({ field: cc.id, prop: 'cablestation' });
  }

  // ---- buildings next to the special fields
  const theme = map.theme;
  for (const f of map.fields) {
    const t = fieldTangent(map, f);
    const side = { x: -t.z, z: t.x };
    // buildings sit on the outside of loops first
    const order = side.x * f.x + side.z * f.z >= 0 ? [1, -1] : [-1, 1];
    const beside = (dist: number, r: number, along = 0): Spot | null => {
      for (const dd of [dist, dist + 0.6, dist + 1.2])
        for (const al of [along, along + 1.2, along - 1.2])
          for (const sgn of order) {
            const x = f.x + side.x * dd * sgn + t.x * al;
            const z = f.z + side.z * dd * sgn + t.z * al;
            if (isFree(x, z, r, f.id)) return { x, z, yaw: Math.atan2(f.x - x, f.z - z) + Math.PI };
          }
      return null;
    };
    const put = (prop: string, spot: Spot | null): Spot | null => {
      if (!spot) {
        out.missing.push({ field: f.id, prop });
        return null;
      }
      const r = footprint(prop);
      out.buildings.push({ ...spot, prop, field: f.id, r });
      keepOut.push({ x: spot.x, z: spot.z, r, what: `${prop}_${f.id}` });
      return spot;
    };
    if (f.type === 'start') {
      out.buildings.push({ prop: 'startgate', field: f.id, x: f.x, z: f.z, yaw: Math.atan2(t.x, t.z), r: 0 });
      continue;
    }
    // jetty, sandbank, ford and bridge fields stand in the water: no room beside them
    if (f.tags?.some((tag) => WATER_TAGS.includes(tag))) continue;
    switch (f.type) {
      case 'shop': {
        const main = theme === 'volcano' ? 'camp' : theme === 'city' ? 'cityshop' : 'stall';
        const shop = put(main, beside(4.2, footprint(main)));
        // the item hut next to the shop, on either side of it
        put('itemshop', beside(4.4, footprint('itemshop'), shop ? 4.2 : 0) ?? (shop ? beside(4.4, footprint('itemshop'), -4.2) : null));
        break;
      }
      case 'item':
        put('chest', beside(2.3, footprint('chest')));
        break;
      case 'lucky':
        put('luckysign', beside(2.2, footprint('luckysign')));
        break;
      case 'duel':
        put('duelring', beside(2.2, footprint('duelring')));
        break;
      case 'station':
        if (f.label) put('station', beside(5, footprint('station')));
        break;
    }
  }

  // ---- decor: landmarks are authored as is, the rest must keep clear of everything
  for (const [index, d] of decorDefs.entries()) {
    const r = footprint(d.kind, d.s ?? 1);
    // landmarks are authored as is; the cable car is built from its fields (planned above)
    if (LANDMARKS.has(d.kind) || d.kind === 'cablecar') {
      out.decor.push({ index, def: d, ok: true });
      continue;
    }
    let why: string | undefined;
    for (const f of map.fields) if (!why && Math.hypot(f.x - d.x, f.z - d.z) < r + TILE_R + 0.1) why = `tile ${f.id}`;
    if (!why && pathDist(map, d.x, d.z) < r + half + 0.1) why = 'path';
    for (const k of keepOut) if (!why && Math.hypot(k.x - d.x, k.z - d.z) < r + k.r) why = k.what;
    if (!why && !AFLOAT.has(d.kind) && T.minHeight(d.x, d.z, r * 0.7) < water.high + 0.05) why = 'water';
    out.decor.push({ index, def: d, ok: !why, why });
    if (!why) keepOut.push({ x: d.x, z: d.z, r, what: `${d.kind}#${index}` });
  }
  return out;
}

/** Distance from x/z to the nearest path centre line (optionally ignoring one field's paths). */
export function pathDist(map: MapDef, x: number, z: number, ignore?: string): number {
  let best = Infinity;
  for (const f of map.fields) {
    for (const n of f.next) {
      const g = getField(map, n);
      if (ignore && (f.id === ignore || g.id === ignore)) {
        // the field's own paths only count beyond its tile
        const s = distToSegment(x, z, f.x, f.z, g.x, g.z);
        const len = Math.hypot(g.x - f.x, g.z - f.z);
        const along = f.id === ignore ? s.t * len : (1 - s.t) * len;
        if (along < TILE_R + 0.6) continue;
        best = Math.min(best, s.d);
        continue;
      }
      best = Math.min(best, distToSegment(x, z, f.x, f.z, g.x, g.z).d);
    }
  }
  return best;
}

// ------------------------------------------------------------------ path ribbons

/** Ribbons start under the tile base (hidden there) and run to the next tile. */
export const RIBBON_FROM = 1.3;
/** Ribbon above the terrain, and the extra lift per layer (crossing ribbons never share a plane). */
export const RIBBON_LIFT = 0.05;
export const RIBBON_LAYER = 0.01;
export const RIBBON_BORDER = 0.22;
export const RIBBON_BORDER_CITY = 0.35;

export interface RibbonPlan {
  edge: number;
  layer: number;
  /** runs of distances along the edge (from its start field) that get a ribbon */
  runs: number[][];
}

/** Lift of a ribbon vertex above the terrain (border vertices sit 2 cm lower). */
export function ribbonLift(layer: number, border: boolean): number {
  return RIBBON_LIFT + layer * RIBBON_LAYER - (border ? 0.02 : 0);
}

/**
 * Which stretch of every path gets a ribbon (none on piers and bridge decks) and on which
 * layer: ribbons that meet at a tile or come close get different layers.
 */
export function planRibbons(map: MapDef, layout: BoardLayout): RibbonPlan[] {
  const T = layout.terrain;
  const half = ribbonHalf(map);
  const edges = T.edges;
  const step = 0.5;
  const runs = edges.map((e) => {
    if (e.kind === 'pier') return [];
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const dx = (e.bx - e.ax) / len;
    const dz = (e.bz - e.az) / len;
    const from = RIBBON_FROM;
    const to = len - RIBBON_FROM;
    if (to <= from) return [];
    const n = Math.max(2, Math.ceil((to - from) / step));
    const out: number[][] = [];
    let cur: number[] = [];
    for (let k = 0; k <= n; k++) {
      const d = from + ((to - from) * k) / n;
      const x = e.ax + dx * d;
      const z = e.az + dz * d;
      // the deck is the path on a bridge (the ribbon tucks 0.3 under its ends)
      const onDeck = e.kind === 'bridge' && layout.bridges.some((b) => {
        const f = getField(map, b.field);
        const rel = (x - f.x) * b.dir.x + (z - f.z) * b.dir.z;
        const lat = Math.abs(-(x - f.x) * b.dir.z + (z - f.z) * b.dir.x);
        return rel > b.a + 0.3 && rel < b.b - 0.3 && lat < 1.3;
      });
      if (onDeck) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      } else cur.push(d);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  });
  // layers: greedy colouring of edges that share a field or whose ribbons come close
  const layer: number[] = edges.map(() => -1);
  const close = (i: number, j: number) => {
    const a = edges[i];
    const b = edges[j];
    if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) return true;
    for (const run of runs[i])
      for (const d of run) {
        const len = Math.hypot(a.bx - a.ax, a.bz - a.az);
        const x = a.ax + ((a.bx - a.ax) * d) / len;
        const z = a.az + ((a.bz - a.az) * d) / len;
        if (distToSegment(x, z, b.ax, b.az, b.bx, b.bz).d < 2 * half + 0.05) return true;
      }
    return false;
  };
  for (let i = 0; i < edges.length; i++) {
    const used = new Set<number>();
    for (let j = 0; j < i; j++) if (close(i, j)) used.add(layer[j]);
    let l = 0;
    while (used.has(l)) l++;
    layer[i] = l;
  }
  return edges.map((_, i) => ({ edge: i, layer: layer[i], runs: runs[i] }));
}
