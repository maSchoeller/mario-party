import { getField, MAP_IDS, getMap, predecessors, validateMap, type MapDef } from '../src/maps';
import {
  BRIDGE_DECK,
  BRIDGE_DECK_END,
  BRIDGE_LEN,
  cablePoint,
  footprint,
  GONDOLA_DROP,
  LANDMARKS,
  planBoard,
  planRibbons,
  ribbonHalf,
  ribbonLift,
  TILE_R,
  type BoardLayout,
} from '../src/maps/boardLayout';
import { distToSegment, GROUND_BELOW_TILE, TerrainModel } from '../src/maps/terrainModel';

/**
 * Board geometry audit (v0.5): what the renderer builds from the map data must be plausible –
 * no prop inside a tile, a path or another prop, no tile in the water without a bridge or
 * ford, no surfaces sharing a plane (z-fighting), readable junction arrows.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Tile layers relative to the field height (board.ts buildTiles). */
const TILE = { baseTop: -0.13, baseBottom: -0.6 };
const WATER_TAGS = ['bridge', 'ford', 'sandbank', 'pier'];
/** Rough height of the landmark props (props*.py). */
const LANDMARK_HEIGHT: Record<string, number> = { lighthouse: 10, cliff: 4, temple: 5 };

export interface Audit {
  layout: BoardLayout;
  problems: Record<string, string[]>;
}

const cache = new Map<string, Audit>();
export function audit(map: MapDef): Audit {
  const hit = cache.get(map.id);
  if (hit) return hit;
  const layout = planBoard(map);
  const T = layout.terrain;
  const W = map.terrain.water;
  const half = ribbonHalf(map);
  const fy = (id: string) => T.fieldY.get(id)!;
  const p: Record<string, string[]> = {
    decor: [],
    landmarks: [],
    buildings: [],
    fields: [],
    edges: [],
    ribbons: [],
    junctions: [],
    bridges: [],
    volcano: [],
    lava: [],
    cable: [],
    tide: [],
  };

  // ---- decor and buildings
  for (const d of layout.decor) if (!d.ok) p.decor.push(`${d.def.kind}#${d.index} @(${d.def.x},${d.def.z}) blocked by ${d.why}`);
  for (const d of layout.decor) {
    if (!LANDMARKS.has(d.def.kind) || d.def.kind === 'waterfall') continue;
    const r = footprint(d.def.kind, d.def.s ?? 1);
    for (const f of map.fields) if (Math.hypot(f.x - d.def.x, f.z - d.def.z) < r + TILE_R) p.landmarks.push(`${d.def.kind} covers tile ${f.id}`);
    for (const e of T.edges) {
      const s = distToSegment(d.def.x, d.def.z, e.ax, e.az, e.bx, e.bz);
      if (s.d < r + half) p.landmarks.push(`${d.def.kind} covers path ${e.from}->${e.to} (${r2(s.d)})`);
    }
    // landmarks stand on land; a rock formation may rise from shallow water
    const floor = d.def.kind === 'cliff' ? (W.low ?? W.high) - 1 : W.high + 0.3;
    if (T.height(d.def.x, d.def.z) < floor) p.landmarks.push(`${d.def.kind} stands in the ${W.kind}`);
    // tall landmarks south of a tile hide it from the TV camera (it looks north at ~45°)
    if (d.def.kind !== 'volcano') {
      const top = T.height(d.def.x, d.def.z) + LANDMARK_HEIGHT[d.def.kind] * (d.def.s ?? 1);
      for (const f of map.fields) {
        const dz = f.z - d.def.z;
        if (dz > 0 && Math.abs(f.x - d.def.x) < r + 0.5 && dz < r + top - fy(f.id)) p.landmarks.push(`${d.def.kind} hides tile ${f.id} from the camera`);
      }
    }
  }
  for (const m of layout.missing) p.buildings.push(`${m.field}: no room for ${m.prop}`);
  for (const b of layout.buildings) if (b.r > 0 && T.minHeight(b.x, b.z, b.r * 0.85) < W.high + 0.05) p.buildings.push(`${b.prop}_${b.field} reaches into the ${W.kind}`);
  for (const d of layout.decor) {
    if (d.def.kind !== 'boat') continue;
    const floor = T.minHeight(d.def.x, d.def.z, 1.2);
    if (floor > (W.low ?? W.high) - 0.45) p.decor.push(`boat#${d.index} runs aground (floor ${r2(floor)})`);
  }

  // ---- tiles
  for (const f of map.fields) {
    const y = fy(f.id);
    const wet = f.tags?.some((t) => WATER_TAGS.includes(t));
    if (!wet) {
      const nat = T.natural(f.x, f.z).y;
      // sea maps have beaches: a tile on the wet sand is fine, one out in the water is not
      if (nat < W.high + (W.kind === 'lava' ? 0.05 : -0.3)) p.fields.push(`${f.id} stands in the ${W.kind} (natural ground ${r2(nat)})`);
      const ch = T.channelDist(f.x, f.z);
      if (ch && ch.d < ch.w / 2 + 0.6) p.fields.push(`${f.id} stands in a ${ch.kind} channel without bridge/ford`);
    }
    if (f.tags?.includes('pier') || f.tags?.includes('bridge')) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let r = 0; r <= TILE_R; r += 0.245)
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const h = T.height(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r);
        hi = Math.max(hi, h);
        lo = Math.min(lo, h);
      }
    if (hi > y + TILE.baseTop - 0.02) p.fields.push(`${f.id}: terrain pokes through the tile base (${r2(hi - y)})`);
    if (lo < y + TILE.baseBottom + 0.02) p.fields.push(`${f.id}: tile floats (${r2(lo - y)})`);
  }

  // ---- edges: dry paths, spacing, other tiles
  for (const e of T.edges) {
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    if (len > 7.5) p.edges.push(`${e.from}->${e.to} is ${r2(len)} long`);
    if (len < 3.2) p.edges.push(`${e.from}->${e.to} is only ${r2(len)} long (tiles touch)`);
    const climb = Math.abs(e.yb - e.ya) / Math.max(0.5, len - 3.3);
    // wading out of a ford / off a sandbank climbs the river bank
    if (climb > (e.kind === 'shallow' ? 0.8 : 0.6)) p.edges.push(`${e.from}->${e.to} climbs ${r2(e.yb - e.ya)} over ${r2(len)}`);
    if (e.kind === 'normal') {
      for (let t = 0.1; t <= 0.9; t += 0.05) {
        const x = e.ax + (e.bx - e.ax) * t;
        const z = e.az + (e.bz - e.az) * t;
        if (T.height(x, z) < W.high + 0.02) {
          p.edges.push(`${e.from}->${e.to} runs through the ${W.kind}`);
          break;
        }
      }
    }
    for (const g of map.fields) {
      if (g.id === e.from || g.id === e.to) continue;
      const s = distToSegment(g.x, g.z, e.ax, e.az, e.bx, e.bz);
      if (s.d < TILE_R + half) p.edges.push(`${e.from}->${e.to} passes ${r2(s.d)} from tile ${g.id}`);
    }
  }

  // ---- ribbons: above the terrain, under the tile bases, never two on one plane where they overlap
  const ribbons = planRibbons(map, layout);
  for (const rb of ribbons) {
    const e = T.edges[rb.edge];
    if (rb.layer > 3) p.ribbons.push(`${e.from}->${e.to} needs layer ${rb.layer}`);
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const dx = (e.bx - e.ax) / len;
    const dz = (e.bz - e.az) / len;
    let worst = 0;
    for (const run of rb.runs) {
      for (let k = 0; k < run.length; k++) {
        for (const d of k + 1 < run.length ? [run[k], (run[k] + run[k + 1]) / 2] : [run[k]]) {
          for (const o of [-half, -half / 2, 0, half / 2, half]) {
            const x = e.ax + dx * d - dz * o;
            const z = e.az + dz * d + dx * o;
            // the ribbon surface between its vertices is linear: compare with the terrain under it
            const yv = (ox: number, oz: number) => T.height(ox, oz) + ribbonLift(rb.layer, Math.abs(o) >= half);
            const y = yv(x, z);
            worst = Math.max(worst, T.height(x, z) + 0.01 - y);
            // under a tile base the ribbon must stay below the base top
            for (const id of [e.from, e.to]) {
              const f = getField(map, id);
              if (Math.hypot(x - f.x, z - f.z) < TILE_R && !f.tags?.includes('bridge') && y > fy(id) + TILE.baseTop - 0.01 + 1e-4) p.ribbons.push(`${e.from}->${e.to} reaches the base top of ${id}`);
            }
          }
        }
      }
    }
    if (worst > 0.001) p.ribbons.push(`${e.from}->${e.to} dips ${r2(worst)} into the terrain`);
  }
  // no field's pad may sit at exactly ribbon height of a neighbouring pad either (sanity of constants)
  if (ribbonLift(3, false) > GROUND_BELOW_TILE + TILE.baseTop - 0.01 + 1e-9) p.ribbons.push('ribbon layers reach the tile base top');

  // ---- non-adjacent ribbons must not overlap
  for (let i = 0; i < T.edges.length; i++)
    for (let j = i + 1; j < T.edges.length; j++) {
      const a = T.edges[i];
      const b = T.edges[j];
      if ([a.from, a.to].some((x) => x === b.from || x === b.to)) continue;
      if (a.from === b.to && a.to === b.from) continue;
      let dmin = Infinity;
      const len = Math.hypot(a.bx - a.ax, a.bz - a.az);
      for (let d = 1.3; d <= len - 1.3; d += 0.25) {
        const x = a.ax + ((a.bx - a.ax) * d) / len;
        const z = a.az + ((a.bz - a.az) * d) / len;
        const s = distToSegment(x, z, b.ax, b.az, b.bx, b.bz);
        const lb = Math.hypot(b.bx - b.ax, b.bz - b.az);
        if (s.t * lb < 1.3 || s.t * lb > lb - 1.3) continue;
        dmin = Math.min(dmin, s.d);
      }
      if (dmin < 2 * half + 0.1) p.ribbons.push(`${a.from}->${a.to} overlaps ${b.from}->${b.to} (${r2(dmin)})`);
    }

  // ---- junction arrows (branch) and backwards choices (merge)
  const angle = (f: { x: number; z: number }, ids: string[]) => {
    const angs = ids.map((n) => {
      const g = getField(map, n);
      return Math.atan2(g.x - f.x, g.z - f.z);
    });
    let minA = Infinity;
    for (let i = 0; i < angs.length; i++)
      for (let j = i + 1; j < angs.length; j++) {
        let d = Math.abs(angs[i] - angs[j]) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        minA = Math.min(minA, d);
      }
    return (minA * 180) / Math.PI;
  };
  for (const f of map.fields) {
    if (f.next.length > 1 && angle(f, f.next) < 44) p.junctions.push(`branch ${f.id} -> ${f.next.join('/')} only ${Math.round(angle(f, f.next))}° apart`);
    const pr = predecessors(map, f.id);
    if (pr.length > 1 && angle(f, pr) < 44) p.junctions.push(`merge ${f.id} <- ${pr.join('/')} only ${Math.round(angle(f, pr))}° apart`);
  }

  // ---- bridges: deck ends meet the path
  const deckTop = (b: BoardLayout['bridges'][number], rel: number) => {
    const zl = ((rel - (b.a + b.b) / 2) * BRIDGE_LEN) / b.span;
    return b.y + BRIDGE_DECK_END + (BRIDGE_DECK - BRIDGE_DECK_END) * Math.cos((Math.PI * zl) / BRIDGE_LEN);
  };
  for (const b of layout.bridges) {
    const f = getField(map, b.field);
    for (const rel of [b.a + 0.3, b.b - 0.3]) {
      const x = f.x + b.dir.x * rel;
      const z = f.z + b.dir.z * rel;
      const path = T.height(x, z) + ribbonLift(0, false);
      const step = deckTop(b, rel) - path;
      if (step < 0.02 || step > 0.3) p.bridges.push(`${b.field}: deck end ${r2(step)} above the path`);
    }
    const top = deckTop(b, 0);
    if (top < fy(b.field) + TILE.baseBottom || top > fy(b.field) - 0.02) p.bridges.push(`${b.field}: tile does not rest on the deck (${r2(top - fy(b.field))})`);
    if (b.y + BRIDGE_DECK_END < W.high + 0.3) p.bridges.push(`${b.field}: deck too low over the ${W.kind}`);
  }

  // ---- volcano: crater path on the cone, everything else around it
  const v = map.terrain.volcano;
  if (v) {
    const crater = map.gimmickParams?.lavaGroups?.[0] ?? [];
    for (const f of map.fields) {
      const d = Math.hypot(f.x - v.x, f.z - v.z);
      if (crater.includes(f.id)) continue;
      if (d < v.r + 0.5) p.volcano.push(`${f.id} is on the volcano cone (${r2(d)} from the crater)`);
    }
    const rim = crater.filter((id) => {
      const f = getField(map, id);
      return Math.hypot(f.x - v.x, f.z - v.z) < v.top + 3.5;
    });
    if (rim.length < 3) p.volcano.push(`only ${rim.length} crater path fields on the rim`);
    if (!rim.includes(map.gimmickParams!.cableCarTarget!)) p.volcano.push('cable car does not arrive on the rim');
    const lava = map.terrain.channels?.find((c) => c.kind === 'lava');
    if (lava && Math.hypot(lava.points[0][0] - v.x, lava.points[0][1] - v.z) > v.top + 1) p.volcano.push('the lava stream does not start at the crater');
    for (const d of map.decor ?? []) if (d.kind === 'volcano' && Math.hypot(d.x - v.x, d.z - v.z) > 0.5) p.volcano.push('crater prop is not on the cone');
  }

  // ---- lava: fields next to the stream close in an eruption (or are bridges over it)
  if (map.gimmick === 'eruption') {
    const groups = map.gimmickParams?.lavaGroups ?? [];
    const all = new Set(groups.flat());
    for (const f of map.fields) {
      const c = T.channelDist(f.x, f.z);
      // bridge heads stand on the bank right next to the stream, the bridge carries the road over it
      const head = [...f.next, ...predecessors(map, f.id)].some((id) => getField(map, id).tags?.includes('bridge'));
      if (c && c.kind === 'lava' && c.d < 4.5 && !all.has(f.id) && !f.tags?.includes('bridge') && !head) p.lava.push(`${f.id} is ${r2(c.d)} from the lava stream but never closed`);
    }
    const ash = groups[1] ?? [];
    const near = ash.filter((id) => {
      const f = getField(map, id);
      const c = T.channelDist(f.x, f.z);
      return c && c.d < 7;
    });
    if (near.length < ash.length / 2) p.lava.push(`only ${near.length}/${ash.length} ash road fields run along the lava stream`);
  }

  // ---- cable car: the gondola never scrapes the ground
  if (layout.cable) {
    for (let t = 0.1; t <= 0.9; t += 0.02) {
      const c = cablePoint(layout.cable, t);
      const clear = c.y - GONDOLA_DROP - T.height(c.x, c.z);
      if (clear < 0.4) {
        p.cable.push(`gondola only ${r2(clear)} above the ground at t=${r2(t)}`);
        break;
      }
    }
  }

  // ---- tide: every field the flood reaches is a ford / sandbank (blocked at high tide)
  if (W.low !== undefined) {
    for (const f of map.fields) {
      if (f.tags?.some((t) => WATER_TAGS.includes(t))) continue;
      if (fy(f.id) + 0.26 < W.high + 0.1) p.tide.push(`${f.id} is flooded at high tide`);
    }
    for (const f of map.fields) {
      const tide = f.tags?.includes('ford') || f.tags?.includes('sandbank');
      if (tide && fy(f.id) + 0.26 > W.high - 0.02) p.tide.push(`${f.id} is tide-blocked but stays dry at high tide`);
      if (tide && fy(f.id) + 0.26 < (W.low ?? W.high) + 0.2) p.tide.push(`${f.id} is under water even at low tide`);
    }
  }

  const res = { layout, problems: p };
  cache.set(map.id, res);
  return res;
}

