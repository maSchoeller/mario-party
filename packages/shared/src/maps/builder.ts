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

export function lerp(a: { x: number; z: number }, b: { x: number; z: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
