// Top-down SVG of every map's field graph + terrain outline + what the board builds
// around it (decor, buildings, bridges, cable car; red = left out because it overlaps).
//   npx tsx packages/shared/scripts/map-svg.ts <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAPS, validateMap } from '../src/maps';
import { footprint, planBoard, ribbonHalf } from '../src/maps/boardLayout';

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
  const t = map.terrain;
  const layout = planBoard(map);
  for (const l of t.land) parts.push(`<ellipse cx="${X(l.x)}" cy="${Z(l.z)}" rx="${l.rx * S}" ry="${l.rz * S}" fill="#cfe6b0" opacity="0.6"/>`);
  for (const c of t.cuts ?? []) parts.push(`<ellipse cx="${X(c.x)}" cy="${Z(c.z)}" rx="${c.rx * S}" ry="${c.rz * S}" fill="#9fd3ec" opacity="0.7"/>`);
  for (const h of t.hills ?? []) parts.push(`<circle cx="${X(h.x)}" cy="${Z(h.z)}" r="${h.r * S}" fill="#8a7" opacity="${Math.min(0.5, Math.abs(h.h) / 6)}"/>`);
  if (t.volcano) {
    const v = t.volcano;
    parts.push(`<circle cx="${X(v.x)}" cy="${Z(v.z)}" r="${v.r * S}" fill="#a98" opacity="0.35"/>`);
    parts.push(`<circle cx="${X(v.x)}" cy="${Z(v.z)}" r="${v.top * S}" fill="#987" opacity="0.5"/>`);
  }
  for (const ch of t.channels ?? [])
    parts.push(`<polyline points="${ch.points.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="none" stroke="${ch.kind === 'lava' ? '#f73' : '#49c'}" stroke-width="${ch.width * S}" opacity="0.6" stroke-linecap="round"/>`);
  // path ribbons at their drawn width
  const idx = new Map(map.fields.map((f) => [f.id, f]));
  for (const f of map.fields)
    for (const n of f.next) {
      const g = idx.get(n)!;
      parts.push(`<line x1="${X(f.x)}" y1="${Z(f.z)}" x2="${X(g.x)}" y2="${Z(g.z)}" stroke="#e9dcc0" stroke-width="${2 * ribbonHalf(map) * S}" opacity="0.8"/>`);
    }
  for (const f of map.fields)
    for (const n of f.next) {
      const g = idx.get(n)!;
      parts.push(`<line x1="${X(f.x)}" y1="${Z(f.z)}" x2="${X(g.x)}" y2="${Z(g.z)}" stroke="#555" stroke-width="3" marker-end="url(#a)"/>`);
    }
  // structures the board builds
  for (const b of layout.bridges) {
    const f = idx.get(b.field)!;
    const p = (s: number) => `${X(f.x + b.dir.x * s)},${Z(f.z + b.dir.z * s)}`;
    parts.push(`<polyline points="${p(b.a)} ${p(b.b)}" stroke="#8a6a4a" stroke-width="${2.4 * S}" opacity="0.7"/>`);
  }
  for (const b of layout.buildings) if (b.r > 0) parts.push(`<circle cx="${X(b.x)}" cy="${Z(b.z)}" r="${b.r * S}" fill="#c9a" stroke="#735" opacity="0.6"><title>${b.prop} (${b.field})</title></circle>`);
  if (layout.cable) {
    const c = layout.cable;
    for (const s of c.stations) parts.push(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="${s.r * S}" fill="#c9a" stroke="#735" opacity="0.6"/>`);
    parts.push(`<line x1="${X(c.a.x)}" y1="${Z(c.a.z)}" x2="${X(c.b.x)}" y2="${Z(c.b.z)}" stroke="#3d3a55" stroke-width="2" stroke-dasharray="8 4"/>`);
  }
  for (const d of layout.decor) {
    if (d.def.kind === 'cablecar') continue;
    const r = footprint(d.def.kind, d.def.s ?? 1);
    parts.push(`<circle cx="${X(d.def.x)}" cy="${Z(d.def.z)}" r="${r * S}" fill="none" stroke="${d.ok ? '#a33' : '#f00'}" stroke-width="${d.ok ? 1.5 : 4}"><title>${d.def.kind}${d.ok ? '' : ' – left out: ' + d.why}</title></circle>`);
    parts.push(`<text x="${X(d.def.x)}" y="${Z(d.def.z) + 4}" font-size="10" fill="${d.ok ? '#a33' : '#f00'}" text-anchor="middle">${d.def.kind}</text>`);
  }
  for (const f of map.fields) {
    const star = map.starSpots.includes(f.id);
    parts.push(`<circle cx="${X(f.x)}" cy="${Z(f.z)}" r="${1.475 * S}" fill="${COLORS[f.type]}" stroke="${star ? '#d4a017' : '#333'}" stroke-width="${star ? 4 : 1.5}"/>`);
    parts.push(`<text x="${X(f.x)}" y="${Z(f.z) - 17}" font-size="10" text-anchor="middle" fill="#222">${f.id}${f.tags?.length ? ' ' + f.tags.join(',') : ''}${f.y !== undefined ? ' y' + f.y : ''}</text>`);
  }
  const errors = validateMap(map);
  const branches = map.fields.filter((f) => f.next.length > 1).length;
  const left = layout.decor.filter((d) => !d.ok).length;
  parts.push(`<text x="10" y="24" font-size="20">${map.id}: ${map.fields.length} Felder, ${branches} Abzweigungen ${errors.length ? '⚠ ' + errors.join('; ') : '✓'}${left ? ` · ${left} Deko weggelassen` : ''}${layout.missing.length ? ` · ${layout.missing.length} Gebäude ohne Platz` : ''}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * S} ${H * S}" width="100%" style="background:#9fd3ec"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="14" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="#555"/></marker></defs>${parts.join('')}</svg>`;
  writeFileSync(join(out, `${map.id}.svg`), svg);
  console.log(map.id, map.fields.length, 'fields', branches, 'branches', errors.length ? errors : 'ok', left ? `${left} decor left out` : '');
}
