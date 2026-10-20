// Top-down SVG of every map's field graph + terrain outline (authoring aid).
//   npx tsx packages/shared/scripts/map-svg.ts <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAPS, validateMap } from '../src/maps';

const COLORS: Record<string, string> = {
  blue: '#6f9de6', red: '#e8767a', event: '#6cc69a', lucky: '#f2c94c', duel: '#a78bdb', item: '#f4a259',
  shop: '#ffffff', start: '#222', station: '#b9b0e0', cablecar: '#888',
};
const out = process.argv[2] ?? '.';
mkdirSync(out, { recursive: true });
for (const map of Object.values(MAPS)) {
  const S = 10;
  const W = 110;
  const H = 80;
  const X = (x: number) => (x + W / 2) * S;
  const Z = (z: number) => (H / 2 - z) * S; // +z is "up" on the TV
  const parts: string[] = [];
  const t = map.terrain ?? { land: [] };
  for (const l of t.land) parts.push(`<ellipse cx="${X(l.x)}" cy="${Z(l.z)}" rx="${l.rx * S}" ry="${l.rz * S}" fill="#cfe6b0" opacity="0.6"/>`);
  for (const c of t.cuts ?? []) parts.push(`<ellipse cx="${X(c.x)}" cy="${Z(c.z)}" rx="${c.rx * S}" ry="${c.rz * S}" fill="#9fd3ec" opacity="0.7"/>`);
  for (const h of t.hills ?? []) parts.push(`<circle cx="${X(h.x)}" cy="${Z(h.z)}" r="${h.r * S}" fill="#8a7" opacity="${Math.min(0.5, Math.abs(h.h) / 6)}"/>`);
  for (const ch of t.channels ?? [])
    parts.push(`<polyline points="${ch.points.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="none" stroke="${ch.kind === 'lava' ? '#f73' : '#49c'}" stroke-width="${ch.width * S}" opacity="0.6" stroke-linecap="round"/>`);
  const idx = new Map(map.fields.map((f) => [f.id, f]));
  for (const f of map.fields)
    for (const n of f.next) {
      const g = idx.get(n)!;
      parts.push(`<line x1="${X(f.x)}" y1="${Z(f.z)}" x2="${X(g.x)}" y2="${Z(g.z)}" stroke="#555" stroke-width="3" marker-end="url(#a)"/>`);
    }
  for (const f of map.fields) {
    const star = map.starSpots.includes(f.id);
    parts.push(`<circle cx="${X(f.x)}" cy="${Z(f.z)}" r="11" fill="${COLORS[f.type]}" stroke="${star ? '#d4a017' : '#333'}" stroke-width="${star ? 4 : 1.5}"/>`);
    parts.push(`<text x="${X(f.x)}" y="${Z(f.z) - 14}" font-size="10" text-anchor="middle" fill="#222">${f.id}${f.tags?.length ? ' ' + f.tags.join(',') : ''}${f.y !== undefined ? ' y' + f.y : ''}</text>`);
  }
  for (const d of map.decor ?? []) parts.push(`<text x="${X(d.x)}" y="${Z(d.z)}" font-size="11" fill="#a33" text-anchor="middle">◆${d.kind}</text>`);
  const errors = validateMap(map);
  const branches = map.fields.filter((f) => f.next.length > 1).length;
  parts.push(`<text x="10" y="24" font-size="20">${map.id}: ${map.fields.length} Felder, ${branches} Abzweigungen ${errors.length ? '⚠ ' + errors.join('; ') : '✓'}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * S} ${H * S}" width="100%" style="background:#9fd3ec"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="14" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="#555"/></marker></defs>${parts.join('')}</svg>`;
  writeFileSync(join(out, `${map.id}.svg`), svg);
  console.log(map.id, map.fields.length, 'fields', branches, 'branches', errors.length ? errors : 'ok');
}
