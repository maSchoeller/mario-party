import { PLAYER_COLOR_HEX, PLAYER_SHAPE, type PlayerColor } from '@wb/shared/config';
import { t } from '@wb/shared/i18n/index';
import type { MapDef } from '@wb/shared/maps/index';
import { h } from '../common/dom';

/**
 * Compact board overview for the TV (v0.5): paths and fields as dots in the field colours
 * of the board, figures as colour + shape (A11Y), the star, shops and closed fields.
 * Pure SVG in world units, so it stays crisp at any size. Orientation matches the
 * default overview camera (looking from -z to +z): +x is right, +z is up.
 */

/** Same palette as the board tiles (render/board.ts FIELD_COLORS). */
const FIELD_COLORS: Record<string, string> = {
  blue: '#5f92e6',
  red: '#e8676f',
  event: '#56c08e',
  lucky: '#f2c23c',
  duel: '#9b7ddb',
  item: '#f49a4a',
  shop: '#fbf6ec',
  start: '#ffffff',
  station: '#e6e1f2',
  cablecar: '#d8d4e8',
};
const FIELD_ICON: Record<string, string> = { shop: '🛍️', station: '🚉', cablecar: '🚡' };

export interface MinimapState {
  players: { field: string; color: PlayerColor; active: boolean }[];
  star: string | null;
  /** fields closed by the map gimmick (high tide, lava) */
  blocked: string[];
  /** fields in danger next (the train's next route) */
  warn: string[];
}

const NS = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const FIELD_R = 1.5;
const TOKEN_R = 2.8;

export class Minimap {
  readonly el: HTMLElement;
  private readonly dyn: SVGElement;
  private readonly pos = new Map<string, { x: number; y: number }>();
  private key = '';

  constructor(private readonly map: MapDef) {
    for (const f of map.fields) this.pos.set(f.id, { x: f.x, y: -f.z });
    const xs = map.fields.map((f) => f.x);
    const ys = map.fields.map((f) => -f.z);
    const pad = 4;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const hgt = Math.max(...ys) - minY + pad;
    const paths = s('g', { class: 'mm-paths' });
    for (const f of map.fields) {
      const a = this.pos.get(f.id)!;
      for (const n of f.next) {
        const b = this.pos.get(n);
        if (b) paths.append(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      }
    }
    const fields = s('g', { class: 'mm-fields' });
    for (const f of map.fields) {
      const p = this.pos.get(f.id)!;
      fields.append(s('circle', { cx: p.x, cy: p.y, r: FIELD_ICON[f.type] ? FIELD_R * 1.3 : FIELD_R, fill: FIELD_COLORS[f.type] ?? '#fff' }));
    }
    const icons = s('g', { class: 'mm-icons' });
    for (const f of map.fields) {
      const icon = FIELD_ICON[f.type];
      if (!icon) continue;
      const p = this.pos.get(f.id)!;
      icons.append(s('text', { x: p.x, y: p.y + 0.1 }, icon));
    }
    this.dyn = s('g', { class: 'mm-dyn' });
    const svg = s('svg', { viewBox: `${minX} ${minY} ${w} ${hgt}`, role: 'img', 'aria-label': t('host.minimap') }, paths, fields, icons, this.dyn);
    (svg as SVGSVGElement).style.aspectRatio = `${w} / ${hgt}`;
    this.el = h('div', { class: 'minimap card', 'data-map': map.id });
    this.el.append(svg);
  }

  update(st: MinimapState): void {
    const key = JSON.stringify(st);
    if (key === this.key) return;
    this.key = key;
    const g = this.dyn;
    while (g.firstChild) g.removeChild(g.firstChild);
    const lava = this.map.terrain.water.kind === 'lava' || this.map.gimmick === 'eruption';
    for (const id of st.warn) {
      const p = this.pos.get(id);
      if (p) g.append(s('circle', { class: 'mm-warn', cx: p.x, cy: p.y, r: FIELD_R * 1.9 }));
    }
    for (const id of st.blocked) {
      const p = this.pos.get(id);
      if (!p) continue;
      const r = FIELD_R * 1.15;
      g.append(
        s(
          'g',
          { class: `mm-blocked ${lava ? 'lava' : 'water'}` },
          s('circle', { cx: p.x, cy: p.y, r: FIELD_R * 1.5 }),
          s('path', { d: `M${p.x - r * 0.6} ${p.y - r * 0.6}L${p.x + r * 0.6} ${p.y + r * 0.6}M${p.x + r * 0.6} ${p.y - r * 0.6}L${p.x - r * 0.6} ${p.y + r * 0.6}` }),
        ),
      );
    }
    const star = st.star ? this.pos.get(st.star) : undefined;
    if (star) g.append(s('path', { class: 'mm-star', d: starPath(star.x, star.y - 0.4, 3.1, 1.35) }));
    // figures on the same field fan out around it
    const byField = new Map<string, number[]>();
    st.players.forEach((pl, i) => byField.set(pl.field, [...(byField.get(pl.field) ?? []), i]));
    // the active figure is drawn last (on top)
    const order = st.players.map((_, i) => i).sort((a, b) => Number(st.players[a].active) - Number(st.players[b].active));
    for (const i of order) {
      const pl = st.players[i];
      const p = this.pos.get(pl.field);
      if (!p) continue;
      const group = byField.get(pl.field)!;
      const k = group.indexOf(i);
      const spread = group.length > 1 ? TOKEN_R * 0.95 : 0;
      const ang = (k / group.length) * Math.PI * 2 - Math.PI / 2;
      const x = p.x + Math.cos(ang) * spread;
      const y = p.y + Math.sin(ang) * spread;
      const r = pl.active ? TOKEN_R * 1.2 : TOKEN_R;
      if (pl.active) g.append(s('circle', { class: 'mm-active', cx: x, cy: y, r: r * 1.45, stroke: PLAYER_COLOR_HEX[pl.color] }));
      g.append(tokenShape(PLAYER_SHAPE[pl.color], x, y, r, PLAYER_COLOR_HEX[pl.color]));
    }
  }
}

/** ●▲■◆ as SVG with a white rim, so the shape reads even on a busy board. */
function tokenShape(shape: string, x: number, y: number, r: number, fill: string): SVGElement {
  const attrs = { class: 'mm-token', fill };
  switch (shape) {
    case '▲':
      return s('path', { ...attrs, d: `M${x} ${y - r * 1.1}L${x + r * 1.05} ${y + r * 0.75}L${x - r * 1.05} ${y + r * 0.75}Z` });
    case '■':
      return s('rect', { ...attrs, x: x - r * 0.85, y: y - r * 0.85, width: r * 1.7, height: r * 1.7, rx: r * 0.2 });
    case '◆':
      return s('path', { ...attrs, d: `M${x} ${y - r * 1.15}L${x + r * 1.15} ${y}L${x} ${y + r * 1.15}L${x - r * 1.15} ${y}Z` });
    default:
      return s('circle', { ...attrs, cx: x, cy: y, r });
  }
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? inner : outer;
    const a = (k * Math.PI) / 5 - Math.PI / 2;
    d += `${k ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}
