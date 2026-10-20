import { BIMMELBAHN } from './bimmelbahn';
import { KOKOSNUSS } from './kokosnuss';
import type { FieldDef, MapDef } from './types';
import { VULKAN } from './vulkan';

export * from './types';

export const MAPS: Record<string, MapDef> = {
  kokosnuss: KOKOSNUSS,
  vulkan: VULKAN,
  bimmelbahn: BIMMELBAHN,
};
export const MAP_IDS = Object.keys(MAPS);

export function getMap(id: string): MapDef {
  const m = MAPS[id];
  if (!m) throw new Error(`unknown map ${id}`);
  return m;
}

const fieldIndexCache = new WeakMap<MapDef, Map<string, FieldDef>>();
export function fieldIndex(map: MapDef): Map<string, FieldDef> {
  let idx = fieldIndexCache.get(map);
  if (!idx) {
    idx = new Map(map.fields.map((f) => [f.id, f]));
    fieldIndexCache.set(map, idx);
  }
  return idx;
}

export function getField(map: MapDef, id: string): FieldDef {
  const f = fieldIndex(map).get(id);
  if (!f) throw new Error(`unknown field ${id} on ${map.id}`);
  return f;
}

/** Predecessors (reverse edges), used for "wash back" and safe-field search. */
export function predecessors(map: MapDef, id: string): string[] {
  return map.fields.filter((f) => f.next.includes(id)).map((f) => f.id);
}

/** Validates map constraints (MAP-01) – used in tests and at load time in dev. */
export function validateMap(map: MapDef): string[] {
  const errors: string[] = [];
  const idx = fieldIndex(map);
  const n = map.fields.length;
  if (n < 60 || n > 80) errors.push(`field count ${n} not in 60..80`);
  const branches = map.fields.filter((f) => f.next.length > 1).length;
  if (branches < 4 || branches > 6) errors.push(`branch count ${branches} not in 4..6`);
  const shops = map.fields.filter((f) => f.type === 'shop').length;
  if (shops < 1 || shops > 2) errors.push(`shop count ${shops} not in 1..2`);
  if (new Set(map.starSpots).size < 5) errors.push('fewer than 5 star spots');
  for (const f of map.fields) {
    if (f.next.length === 0) errors.push(`dead end at ${f.id}`);
    for (const t of f.next) if (!idx.has(t)) errors.push(`${f.id} -> unknown ${t}`);
  }
  for (const s of map.starSpots) {
    const f = idx.get(s);
    if (!f) errors.push(`star spot ${s} unknown`);
    else if (!['blue', 'red', 'event', 'lucky', 'duel', 'item'].includes(f.type)) errors.push(`star spot ${s} on ${f.type}`);
  }
  if (!idx.has(map.start)) errors.push('start unknown');
  // every field reachable from start
  const seen = new Set<string>([map.start]);
  const queue = [map.start];
  while (queue.length) {
    const cur = idx.get(queue.shift()!)!;
    for (const t of cur.next) if (!seen.has(t)) (seen.add(t), queue.push(t));
  }
  if (seen.size !== n) errors.push(`unreachable fields: ${map.fields.filter((f) => !seen.has(f.id)).map((f) => f.id).join(',')}`);
  return errors;
}
