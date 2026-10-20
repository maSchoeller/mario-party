import {
  Animation,
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
  type AbstractMesh,
} from '@babylonjs/core';
import type { CharacterId, PlayerColor } from '@wb/shared/config';
import { PLAYER_COLOR_HEX } from '@wb/shared/config';
import { getField, predecessors, type FieldDef, type MapDef } from '@wb/shared/maps/index';
import { CharacterRig, lookAtYaw } from './characters';
import { DiceRoller, type DieThrow } from './dice3d';
import { fbm, noise2, prng, smoothstep } from './noise';
import { box, coin, cone, cyl, hut, palm, rock, sphere, starMesh, tree } from './props';
import type { Stage } from './stage';
import { detailTexture, Terrain } from './terrain';

/**
 * 3D board built from the data-driven map (MAP-06): a landscape (terrain.ts) with the
 * field graph laid into it, paths, bridges and piers, buildings next to the special
 * fields, landmarks, instanced vegetation, the wandering star and the visual side of
 * the map gimmicks (MAP-02).
 */
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
const FIELD_ICON: Record<string, string> = {
  event: '!',
  lucky: '?',
  duel: '⚔',
  item: '🎁',
  shop: '🛒',
  start: '🏁',
  station: '🚉',
  cablecar: '🚡',
};
/** Tile top above the field height (where tokens stand). */
const TILE_TOP = 0.26;
/** Deck height of the bridge/pier props in their own space (see props.py). */
const BRIDGE_DECK = 0.45;
const PIER_DECK = 0.45;

export interface TokenInfo {
  character: CharacterId;
  color: PlayerColor;
}

interface KeepOut {
  x: number;
  z: number;
  r: number;
}

export class BoardView {
  readonly root: TransformNode;
  readonly rigs: CharacterRig[] = [];
  readonly terrain: Terrain;
  private tileTops: Mesh | null = null;
  private tileIndex = new Map<string, number>();
  private tileColors: Float32Array | null = null;
  private star: TransformNode;
  private starField = '';
  private bags = new Map<string, TransformNode>();
  private traps = new Map<string, Mesh>();
  private arrows: Mesh[] = [];
  private rails: Mesh[] = [];
  private floaters: TransformNode[] = [];
  private waterfall: { tex: Texture; foam: Mesh[] } | null = null;
  private positions: string[] = [];
  private keepOut: KeepOut[] = [];
  private updater: () => void;
  private t = 0;
  private trainMesh: TransformNode | null = null;
  private dice: DiceRoller;

  constructor(
    private readonly stage: Stage,
    readonly map: MapDef,
    tokens: TokenInfo[],
  ) {
    this.root = new TransformNode('board', stage.scene);
    const p = map.palette;
    stage.setSky(p.sky[0], p.sky[1], p.fog);
    this.terrain = new Terrain(stage, map, this.root);
    this.buildTiles();
    this.buildPaths();
    this.buildStructures();
    this.buildBridges();
    this.buildFieldBuildings();
    this.buildDecor();
    this.buildGimmick();
    this.buildScatter();
    this.star = new TransformNode('star', stage.scene);
    this.star.parent = this.root;
    const sm = starMesh(stage, 'starMesh', 2.2, '#f2c94c', this.star);
    sm.position.y = 2.4;
    stage.castShadow(sm, false);
    tokens.forEach((tk, i) => {
      const rig = new CharacterRig(stage, tk.character, tk.color, `tok${i}`);
      rig.root.scaling.setAll(1.5); // readable from the couch (ART-03)
      rig.root.parent = this.root;
      this.rigs.push(rig);
      this.positions.push(map.start);
    });
    this.layoutTokens(true);
    this.dice = new DiceRoller(stage, (x, z) => this.groundAt(x, z));
    this.updater = stage.onUpdate((dt) => this.update(dt));
  }

  dispose(): void {
    this.dice.clear();
    this.updater();
    this.root.dispose(false, false);
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
    if (on) {
      const p = this.map.palette;
      this.stage.setSky(p.sky[0], p.sky[1], p.fog);
    }
  }

  // ------------------------------------------------------------------ geometry helpers

  private fy(id: string): number {
    return this.terrain.fieldY.get(id) ?? 0;
  }

  /** Walking direction through a field (from its predecessor to its successor). */
  private tangent(f: FieldDef): Vector3 {
    const next = getField(this.map, f.next[0]);
    const prevId = predecessors(this.map, f.id)[0];
    const prev = prevId ? getField(this.map, prevId) : f;
    const d = new Vector3(next.x - prev.x, 0, next.z - prev.z);
    return d.lengthSquared() > 0 ? d.normalize() : new Vector3(0, 0, 1);
  }

  private isFree(x: number, z: number, r: number, ignore?: string): boolean {
    for (const f of this.map.fields) if (f.id !== ignore && Math.hypot(f.x - x, f.z - z) < r + 1.4) return false;
    for (const k of this.keepOut) if (Math.hypot(k.x - x, k.z - z) < r + k.r) return false;
    return this.terrain.clearance(x, z) > r + 0.6 && this.terrain.height(x, z) > this.terrain.def.water.high + 0.15;
  }

  private place(node: TransformNode, x: number, z: number, yaw: number, scale = 1, y?: number): TransformNode {
    node.position.set(x, y ?? this.terrain.height(x, z) - 0.04, z);
    node.rotation.y = yaw;
    node.scaling.setAll(scale);
    node.freezeWorldMatrix();
    for (const m of node.getChildMeshes()) {
      m.receiveShadows = true;
      m.freezeWorldMatrix();
    }
    return node;
  }

  // ------------------------------------------------------------------ tiles

  private buildTiles() {
    const s = this.stage;
    const fields = this.map.fields;
    const rimT = flatCyl(s, 'tileRim', 2.6, 0.5, 20, '#f2ece0', this.root);
    const baseT = flatCyl(s, 'tileBase', 2.95, 0.22, 20, '#cfc6b5', this.root);
    const topT = MeshBuilder.CreateCylinder('tileTop', { diameterTop: 2.08, diameterBottom: 2.2, height: 0.12, tessellation: 20 }, s.scene);
    topT.convertToFlatShadedMesh();
    topT.parent = this.root;
    const topMat = new StandardMaterial('tileTopMat', s.scene);
    topMat.diffuseColor = Color3.White();
    topMat.specularColor = new Color3(0.18, 0.18, 0.18);
    topMat.specularPower = 40;
    topT.material = topMat;
    const rim: number[] = [];
    const base: number[] = [];
    const top: number[] = [];
    const colors: number[] = [];
    const tmp = Matrix.Identity();
    fields.forEach((f, i) => {
      const y = this.fy(f.id);
      Matrix.TranslationToRef(f.x, y - 0.03, f.z, tmp);
      rim.push(...tmp.asArray());
      Matrix.TranslationToRef(f.x, y - 0.24, f.z, tmp);
      base.push(...tmp.asArray());
      Matrix.TranslationToRef(f.x, y + TILE_TOP - 0.06, f.z, tmp);
      top.push(...tmp.asArray());
      const c = Color3.FromHexString(FIELD_COLORS[f.type]);
      colors.push(c.r, c.g, c.b, 1);
      this.tileIndex.set(f.id, i);
    });
    rimT.thinInstanceSetBuffer('matrix', new Float32Array(rim), 16, true);
    baseT.thinInstanceSetBuffer('matrix', new Float32Array(base), 16, true);
    topT.thinInstanceSetBuffer('matrix', new Float32Array(top), 16, true);
    this.tileColors = new Float32Array(colors);
    topT.thinInstanceSetBuffer('color', this.tileColors, 4, false);
    for (const m of [rimT, baseT, topT]) {
      m.thinInstanceRefreshBoundingInfo(false);
      m.receiveShadows = true;
      m.isPickable = false;
    }
    s.castShadow(rimT, false);
    this.tileTops = topT;
    // icons: one textured quad per icon type, instanced over all fields of that type
    const byIcon = new Map<string, FieldDef[]>();
    for (const f of fields) if (FIELD_ICON[f.type]) byIcon.set(f.type, [...(byIcon.get(f.type) ?? []), f]);
    for (const [type, list] of byIcon) {
      const q = iconQuad(s, `icon_${type}`, FIELD_ICON[type], type === 'shop' || type === 'start' || type === 'station' || type === 'cablecar' ? '#3d3a55' : '#ffffff');
      q.parent = this.root;
      const mats: number[] = [];
      for (const f of list) {
        const t = this.tangent(f);
        const yaw = Math.atan2(t.x, t.z);
        Matrix.ComposeToRef(new Vector3(1.25, 1.25, 1.25), Quaternion.FromEulerAngles(Math.PI / 2, yaw, 0), new Vector3(f.x, this.fy(f.id) + TILE_TOP + 0.012, f.z), tmp);
        mats.push(...tmp.asArray());
      }
      q.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
      q.thinInstanceRefreshBoundingInfo(false);
    }
  }

  private setTileColor(id: string, hex: string, glow = 0) {
    const i = this.tileIndex.get(id);
    if (i === undefined || !this.tileColors || !this.tileTops) return;
    const c = Color3.FromHexString(hex).scale(1 + glow);
    this.tileColors.set([c.r, c.g, c.b, 1], i * 4);
    this.tileTops.thinInstanceBufferUpdated('color');
  }

  // ------------------------------------------------------------------ paths

  private buildPaths() {
    const s = this.stage;
    const city = this.map.theme === 'city';
    const pathC = Color3.FromHexString(this.terrain.def.colors.path);
    const edgeC = pathC.scale(0.8);
    const halfW = city ? 1.15 : 0.62;
    const border = city ? 0.35 : 0.22;
    const pos: number[] = [];
    const col: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const dots: number[] = [];
    const tmp = Matrix.Identity();
    for (const e of this.terrain.edges) {
      if (e.kind === 'pier') continue;
      const a = new Vector3(e.ax, 0, e.az);
      const b = new Vector3(e.bx, 0, e.bz);
      const dir = b.subtract(a);
      const len = dir.length();
      dir.normalize();
      const side = new Vector3(-dir.z, 0, dir.x);
      const from = 1.3;
      const to = len - 1.3;
      if (to <= from) continue;
      const n = Math.max(2, Math.ceil((to - from) / 0.5));
      const yAt = (d: number) => {
        const p = a.add(dir.scale(d));
        if (e.kind === 'bridge') {
          const k = d / len;
          const deck = e.ya + (e.yb - e.ya) * k - 0.05;
          return Math.max(deck, this.terrain.height(p.x, p.z) + 0.05);
        }
        return this.terrain.height(p.x, p.z) + 0.05;
      };
      const offs = [-halfW - border, -halfW, halfW, halfW + border];
      const base = pos.length / 3;
      for (let k = 0; k <= n; k++) {
        const d = from + ((to - from) * k) / n;
        const c = a.add(dir.scale(d));
        const y = yAt(d);
        for (let o = 0; o < 4; o++) {
          const p = c.add(side.scale(offs[o]));
          pos.push(p.x, y + (o === 0 || o === 3 ? -0.02 : 0), p.z);
          nrm.push(0, 1, 0);
          const cc = o === 0 || o === 3 ? edgeC : pathC;
          const j = 0.95 + noise2(p.x * 0.7, p.z * 0.7, 8) * 0.1;
          col.push(cc.r * j, cc.g * j, cc.b * j, 1);
          uv.push(p.x / 4, p.z / 4);
        }
        if (k > 0) {
          const r0 = base + (k - 1) * 4;
          const r1 = base + k * 4;
          for (let o = 0; o < 3; o++) idx.push(r0 + o, r1 + o, r0 + o + 1, r0 + o + 1, r1 + o, r1 + o + 1);
        }
      }
      // stepping dots, like on a printed board
      if (!city) {
        const count = Math.max(1, Math.floor((to - from) / 1.25));
        for (let k = 1; k <= count; k++) {
          const d = from + ((to - from) * k) / (count + 1);
          const c = a.add(dir.scale(d));
          Matrix.TranslationToRef(c.x, yAt(d) + 0.03, c.z, tmp);
          dots.push(...tmp.asArray());
        }
      }
    }
    // Babylon culls clockwise faces: orient every triangle upwards
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const cross = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]);
      if (cross < 0) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    }
    const m = new Mesh('paths', s.scene);
    const vd = new VertexData();
    Object.assign(vd, { positions: pos, colors: col, normals: nrm, uvs: uv, indices: idx });
    vd.applyToMesh(m);
    m.parent = this.root;
    const mat = new StandardMaterial('pathMat', s.scene);
    mat.diffuseTexture = detailTexture(s.scene, this.map.theme);
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    m.material = mat;
    m.receiveShadows = true;
    m.isPickable = false;
    m.freezeWorldMatrix();
    if (dots.length) {
      const dot = flatCyl(s, 'pathDot', 0.36, 0.06, 8, '#fffaf0', this.root);
      dot.thinInstanceSetBuffer('matrix', new Float32Array(dots), 16, true);
      dot.thinInstanceRefreshBoundingInfo(false);
      dot.receiveShadows = true;
    }
  }

  // ------------------------------------------------------------------ piers

  private buildStructures() {
    const s = this.stage;
    const lib = s.assets;
    let k = 0;
    for (const e of this.terrain.edges) {
      const a = new Vector3(e.ax, 0, e.az);
      const b = new Vector3(e.bx, 0, e.bz);
      const dir = b.subtract(a);
      const len = dir.length();
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      if (e.kind === 'pier') {
        const segs = Math.max(1, Math.round(len / 3));
        for (let i = 0; i < segs; i++) {
          const t = (i + 0.5) / segs;
          const p = a.add(dir.scale(len * t));
          const deck = Math.min(e.ya, e.yb) - 0.04;
          const node = lib.prop('pier', `pier${k++}`, this.root) ?? fallbackPier(s, `pier${k}`, this.root);
          this.place(node, p.x, p.z, yaw, 1, deck - PIER_DECK);
          node.scaling.set(1, 1, len / segs / 3 + 0.05);
          this.keepOut.push({ x: p.x, z: p.z, r: 2 });
        }
      }
    }
  }

  /** One straight bridge per bridge field, spanning all the water along the walking line. */
  private buildBridges() {
    const s = this.stage;
    const water = this.terrain.def.water.high;
    const bridgeId = this.map.theme === 'volcano' ? 'stonebridge' : this.map.theme === 'city' ? 'bridgestone' : 'bridge';
    for (const f of this.map.fields) {
      if (!f.tags?.includes('bridge')) continue;
      const dir = this.tangent(f);
      let lo = 0;
      let hi = 0;
      for (let t = -9; t <= 9; t += 0.25) {
        const x = f.x + dir.x * t;
        const z = f.z + dir.z * t;
        if (this.terrain.height(x, z) < water + 0.3) {
          lo = Math.min(lo, t);
          hi = Math.max(hi, t);
        }
      }
      const mid = (lo + hi) / 2;
      const span = Math.max(4, hi - lo + 2.4);
      const node = s.assets.prop(bridgeId, `bridge_${f.id}`, this.root) ?? fallbackBridge(s, `bridge_${f.id}`, this.root);
      const x = f.x + dir.x * mid;
      const z = f.z + dir.z * mid;
      this.place(node, x, z, Math.atan2(dir.x, dir.z), 1, this.fy(f.id) - 0.06 - BRIDGE_DECK);
      node.scaling.set(1, 1, span / 7);
      this.keepOut.push({ x, z, r: span / 2 });
    }
  }

  // ------------------------------------------------------------------ buildings next to fields

  private buildFieldBuildings() {
    const s = this.stage;
    const theme = this.map.theme;
    const accent = this.map.palette.accent;
    for (const f of this.map.fields) {
      const t = this.tangent(f);
      const side = new Vector3(-t.z, 0, t.x);
      const yaw = Math.atan2(t.x, t.z);
      /** spot left/right of the path with the most room */
      const beside = (dist: number, r: number, along = 0): { x: number; z: number; face: number } | null => {
        for (const sgn of sideOrder(f, side)) {
          const x = f.x + side.x * dist * sgn + t.x * along;
          const z = f.z + side.z * dist * sgn + t.z * along;
          if (this.isFree(x, z, r, f.id)) return { x, z, face: Math.atan2(f.x - x, f.z - z) + Math.PI };
        }
        return null;
      };
      const put = (id: string, spot: { x: number; z: number; face: number } | null, r: number, scale = 1, tint?: string) => {
        if (!spot) return;
        const node = s.assets.prop(id, `${id}_${f.id}`, this.root, tint);
        if (!node) return;
        this.place(node, spot.x, spot.z, spot.face, scale);
        this.keepOut.push({ x: spot.x, z: spot.z, r });
      };
      switch (f.type) {
        case 'shop': {
          const main = theme === 'volcano' ? 'camp' : theme === 'city' ? 'cityshop' : 'stall';
          const shop = beside(4.4, 2.2);
          if (shop && !s.assets.hasProp(main)) {
            const h = hut(s, `shop_${f.id}`, accent, this.root);
            this.place(h, shop.x, shop.z, shop.face, 0.7);
            this.keepOut.push({ x: shop.x, z: shop.z, r: 2.2 });
          } else put(main, shop, 2.2, 1, accent);
          put('itemshop', beside(4.6, 2, shop ? 4.2 : 0), 2, 1, theme === 'city' ? '#6f9de6' : '#e8767a');
          break;
        }
        case 'item':
          put('chest', beside(2.3, 0.7), 0.8);
          break;
        case 'lucky':
          put('luckysign', beside(2.2, 0.6), 0.7);
          break;
        case 'duel':
          put('duelring', beside(2.2, 0.6), 0.7);
          break;
        case 'start': {
          const gate = s.assets.prop('startgate', `startgate`, this.root, accent);
          if (gate) this.place(gate, f.x, f.z, yaw, 1, this.fy(f.id) - 0.05);
          break;
        }
        case 'station':
          if (f.label) put('station', beside(5, 3), 3);
          break;
      }
    }
  }

  // ------------------------------------------------------------------ landmarks

  private buildDecor() {
    const s = this.stage;
    const lib = s.assets;
    const water = this.terrain.def.water;
    for (const [i, d] of (this.map.decor ?? []).entries()) {
      const yaw = d.r ?? 0;
      const sc = d.s ?? 1;
      switch (d.kind) {
        case 'waterfall':
          this.buildWaterfall(d.x, d.z);
          continue;
        case 'boat': {
          const node = lib.prop('boat', `boat${i}`, this.root) ?? box(s, `boat${i}`, 1.2, 0.5, 3, '#a0703f', this.root);
          node.position.set(d.x, water.high, d.z);
          node.rotation.y = yaw;
          this.floaters.push(node);
          this.keepOut.push({ x: d.x, z: d.z, r: 2 });
          continue;
        }
        case 'cablecar': {
          this.buildCableCar(i);
          continue;
        }
      }
      let node: TransformNode | null = lib.prop(d.kind, `${d.kind}${i}`, this.root, d.tint);
      if (!node) node = this.fallbackDecor(d.kind, `${d.kind}${i}`, d.tint);
      if (!node) continue;
      this.place(node, d.x, d.z, yaw, sc);
      this.keepOut.push({ x: d.x, z: d.z, r: decorRadius(d.kind) * sc });
    }
  }

  private fallbackDecor(kind: string, name: string, tint?: string): TransformNode | null {
    const s = this.stage;
    switch (kind) {
      case 'palm':
      case 'palm2':
        return palm(s, name, this.root, 1.1);
      case 'hut':
      case 'stilthut':
      case 'house':
      case 'house2':
      case 'house3':
        return hut(s, name, tint ?? '#e8767a', this.root);
      case 'rock':
      case 'cliff':
      case 'lavarock':
        return rock(s, name, kind === 'cliff' ? 5 : 1.6, '#b9b6c4', this.root);
      case 'tree':
      case 'treeround':
        return tree(s, name, this.root);
      case 'volcano': {
        const n = new TransformNode(name, s.scene);
        n.parent = this.root;
        const v = cyl(s, 'volcanoCone', { top: 6, bottom: 20, h: 10, tess: 9 }, '#7a6a72', n);
        v.position.y = 5;
        const lava = cyl(s, 'volcanoLava', { d: 5, h: 0.4, tess: 9 }, '#ff7a3d', n);
        lava.material = s.mat('#ff7a3d', { emissive: 0.9 });
        lava.position.y = 10.05;
        return n;
      }
      case 'cannon': {
        const n = new TransformNode(name, s.scene);
        n.parent = this.root;
        cyl(s, `${name}b`, { d: 1.6, h: 0.6, tess: 8 }, '#8a5a3c', n).position.y = 0.3;
        const barrel = cyl(s, `${name}r`, { top: 0.7, bottom: 0.9, h: 2.4, tess: 8 }, '#3d3a4a', n);
        barrel.position.y = 1.2;
        barrel.rotation.x = -0.7;
        return n;
      }
      case 'crab': {
        const n = new TransformNode(name, s.scene);
        n.parent = this.root;
        const body = sphere(s, `${name}b`, 1.2, '#e8676b', 4, n);
        body.scaling.y = 0.55;
        body.position.y = 0.4;
        return n;
      }
      case 'tower': {
        const n = new TransformNode(name, s.scene);
        n.parent = this.root;
        cyl(s, `${name}t`, { d: 2, h: 7, tess: 6 }, '#f6efe2', n).position.y = 3.5;
        cone(s, `${name}r`, 2.6, 2, '#e8767a', 6, n).position.y = 8;
        return n;
      }
      case 'fountain': {
        const n = new TransformNode(name, s.scene);
        n.parent = this.root;
        cyl(s, `${name}f`, { d: 3, h: 0.6, tess: 10 }, '#d9d6ea', n).position.y = 0.3;
        return n;
      }
      default:
        return null;
    }
  }

  private buildWaterfall(x: number, z: number) {
    const s = this.stage;
    const ch = this.terrain.def.channels?.[0];
    if (!ch) return;
    // falls from the hill top into the head of the river, facing downstream
    const [sx, sz] = ch.points[0];
    const [nx, nz] = ch.points[1];
    const dir = new Vector3(nx - sx, 0, nz - sz).normalize();
    const topY = this.terrain.natural(x - dir.x * 3, z - dir.z * 3).y + 0.2;
    const bottom = this.terrain.def.water.low ?? this.terrain.def.water.high;
    const h = Math.max(1.5, topY - bottom);
    const tex = new DynamicTexture('fallTex', { width: 64, height: 256 }, s.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    for (let y = 0; y < 256; y++) {
      for (let xx = 0; xx < 64; xx++) {
        const n = fbm(xx * 0.12, y * 0.03, 3, 77);
        const v = 0.55 + n * 0.45;
        ctx.fillStyle = `rgba(${200 + 55 * v | 0},${235 + 20 * v | 0},255,${0.55 + 0.4 * v})`;
        ctx.fillRect(xx, y, 1, 1);
      }
    }
    tex.update();
    tex.hasAlpha = true;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.vScale = 2;
    const mat = new StandardMaterial('fallMat', s.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new Color3(0.45, 0.55, 0.6);
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.specularColor = Color3.Black();
    const fall = MeshBuilder.CreatePlane('waterfall', { width: 3.2, height: h }, s.scene);
    fall.material = mat;
    fall.parent = this.root;
    fall.position.set(x - dir.x * 1.6, bottom + h / 2, z - dir.z * 1.6);
    fall.rotation.y = Math.atan2(dir.x, dir.z);
    fall.rotation.x = -0.12;
    fall.isPickable = false;
    const foam: Mesh[] = [];
    for (let k = 0; k < 6; k++) {
      const f = sphere(s, `foam${k}`, 0.9 + (k % 3) * 0.3, '#ffffff', 3, this.root);
      f.material = s.mat('#ffffff', { alpha: 0.85 });
      f.position.set(x + (k - 2.5) * 0.5, bottom + 0.15, z + dir.z * 0.4 + (k % 2) * 0.4);
      foam.push(f);
    }
    this.waterfall = { tex, foam };
    this.keepOut.push({ x, z, r: 3 });
  }

  private buildCableCar(i: number) {
    const s = this.stage;
    const from = this.map.fields.find((f) => f.type === 'cablecar');
    const target = this.map.gimmickParams?.cableCarTarget;
    if (!from || !target) return;
    const a = this.fieldPos(from.id).add(new Vector3(0, 4.5, 0));
    const b = this.fieldPos(target).add(new Vector3(0, 4.5, 0));
    const line = MeshBuilder.CreateTube(`cable${i}`, { path: [a, Vector3.Lerp(a, b, 0.5).add(new Vector3(0, -0.8, 0)), b], radius: 0.06 }, s.scene);
    line.material = s.mat('#3d3a55');
    line.parent = this.root;
    for (const [p, id] of [
      [a, from.id],
      [b, target],
    ] as const) {
      const st = s.assets.prop('cablestation', `cablest${id}`, this.root);
      if (st) {
        const f = getField(this.map, id);
        const out = new Vector3(f.x, 0, f.z).normalize().scale(3);
        this.place(st, f.x + out.x, f.z + out.z, Math.atan2(-out.x, -out.z));
      } else {
        const tower = cyl(s, `tower${id}`, { d: 0.4, h: 4.5, tess: 5 }, '#6c6a7a', this.root);
        tower.position.set(p.x, p.y - 2.25, p.z);
      }
    }
    const g = s.assets.prop('gondola', `gondola${i}`, this.root, '#e8767a') ?? box(s, `gondola${i}`, 1, 0.8, 1, '#e8767a', this.root);
    g.position = Vector3.Lerp(a, b, 0.35).add(new Vector3(0, -1.2, 0));
  }

  // ------------------------------------------------------------------ vegetation

  private buildScatter() {
    const s = this.stage;
    const tr = this.terrain;
    const b = tr.bounds;
    const lowQ = s.qualityLevel === 0;
    tr.def.scatter.forEach((rule, ri) => {
      if (!s.assets.hasProp(rule.kind)) return;
      const rnd = prng(1000 + ri * 7919);
      const cell = Math.sqrt(100 / (rule.density * (lowQ ? 0.35 : 1)));
      const big = /palm|tree|cliff|bush|mushroom|crystal/.test(rule.kind);
      const mats: Matrix[] = [];
      for (let z = b.minZ; z < b.maxZ; z += cell) {
        for (let x = b.minX; x < b.maxX; x += cell) {
          const px = x + rnd() * cell;
          const pz = z + rnd() * cell;
          const roll = rnd();
          const yawR = rnd();
          const scR = rnd();
          if (tr.ground(px, pz) !== rule.on) continue;
          // clustered, organic distribution
          if (roll > smoothstep(0.3, 0.68, fbm(px * 0.06 + ri, pz * 0.06, 3, 50 + ri))) continue;
          const clear = tr.clearance(px, pz);
          if (clear < (big ? 2.8 : 1.6)) continue;
          if (this.map.fields.some((f) => Math.hypot(f.x - px, f.z - pz) < (big ? 3 : 2))) continue;
          if (this.keepOut.some((k) => Math.hypot(k.x - px, k.z - pz) < k.r + (big ? 1.2 : 0.3))) continue;
          const [lo, hi] = rule.scale ?? [0.8, 1.2];
          const sc = lo + (hi - lo) * scR;
          const y = tr.height(px, pz) - 0.05;
          mats.push(Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.FromEulerAngles(0, yawR * Math.PI * 2, 0), new Vector3(px, y, pz)));
          if (big) this.keepOut.push({ x: px, z: pz, r: 0.9 * sc });
        }
      }
      const small = /grass|shell|fern|flowers|rocksmall/.test(rule.kind);
      s.assets.instances(rule.kind, `scatter_${rule.kind}_${ri}`, this.root, mats, { shadows: !small, tint: rule.tint?.[0] });
    });
  }

  // ------------------------------------------------------------------ gimmicks

  private buildGimmick() {
    const s = this.stage;
    const routes = this.map.gimmickParams?.trainRoutes;
    if (routes) {
      routes.forEach((r, ri) => {
        const pts = r.fields.map((id) => this.fieldPos(id));
        const first = pts[0].subtract(pts[1].subtract(pts[0]).normalize().scale(6));
        const last = pts[pts.length - 1].add(pts[pts.length - 1].subtract(pts[pts.length - 2]).normalize().scale(6));
        const path = [first, ...pts, last].map((p) => new Vector3(p.x, this.terrain.height(p.x, p.z) + 0.08, p.z));
        for (const off of [-0.7, 0.7]) {
          const shifted = path.map((p, k) => {
            const a = path[Math.max(0, k - 1)];
            const b = path[Math.min(path.length - 1, k + 1)];
            const dir = b.subtract(a).normalize();
            return p.add(new Vector3(-dir.z, 0, dir.x).scale(off));
          });
          const rail = MeshBuilder.CreateTube(`rail${ri}_${off}`, { path: shifted, radius: 0.1, tessellation: 4 }, s.scene);
          rail.material = s.mat('#7a7486');
          rail.parent = this.root;
          this.rails.push(rail);
        }
      });
    }
  }

  // ------------------------------------------------------------------ queries

  fieldPos(id: string): Vector3 {
    const f = getField(this.map, id);
    return new Vector3(f.x, this.fy(id) + TILE_TOP, f.z);
  }

  /** Height of whatever is walkable at x/z: tile tops, else terrain (never below water). */
  groundAt(x: number, z: number): number {
    for (const f of this.map.fields) if (Math.hypot(f.x - x, f.z - z) < 1.35) return this.fy(f.id) + TILE_TOP;
    return Math.max(this.terrain.height(x, z), this.terrain.water.position.y);
  }

  /** Throws 3D dice next to player i; resolves when they rest (top faces = result). */
  rollDice(i: number, throws: DieThrow[], speed = 1, onBounce?: (strength: number) => void): Promise<void> {
    return this.dice.roll(this.tokenPos(i), throws, speed, onBounce);
  }

  celebrateDice(speed = 1): Promise<void> {
    return this.dice.celebrate(speed);
  }

  clearDice(speed = 1): Promise<void> {
    return this.dice.vanish(speed);
  }

  tokenPos(i: number): Vector3 {
    return this.rigs[i].root.position.clone();
  }

  private bounds() {
    const xs = this.map.fields.map((f) => f.x);
    const zs = this.map.fields.map((f) => f.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }

  center(): Vector3 {
    const b = this.bounds();
    return new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  }

  overview(instant = false): void {
    const b = this.bounds();
    const size = Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) * 1.5);
    this.stage.setCamera({ alpha: -Math.PI / 2, beta: 0.78, radius: size * 1.0, target: this.center().add(new Vector3(0, 0, -3)) }, 1.6, instant);
  }

  focus(i: number, radius = 22): void {
    const p = this.tokenPos(i);
    this.stage.setCamera({ alpha: -Math.PI / 2 - p.x * 0.005, beta: 0.86, radius, target: p.add(new Vector3(0, 1, 0)) }, 2.4);
  }

  focusField(id: string, radius = 20): void {
    this.stage.setCamera({ target: this.fieldPos(id), radius, beta: 0.85 }, 2.2);
  }

  // ------------------------------------------------------------------ token movement

  private slotOffset(i: number, field: string): Vector3 {
    const same = this.positions.map((p, k) => (p === field ? k : -1)).filter((k) => k >= 0);
    if (same.length <= 1) return Vector3.Zero();
    const idx = same.indexOf(i);
    const a = (idx / same.length) * Math.PI * 2 + Math.PI / 4;
    return new Vector3(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1);
  }

  layoutTokens(instant = false): void {
    this.rigs.forEach((rig, i) => {
      const target = this.fieldPos(this.positions[i]).add(this.slotOffset(i, this.positions[i]));
      if (instant) rig.setPosition(target);
      else this.tween(rig.root, target, 0.25);
    });
  }

  setPositions(fields: string[]): void {
    this.positions = [...fields];
    this.layoutTokens(true);
  }

  private tween(node: TransformNode, to: Vector3, seconds: number, arc = 0): Promise<void> {
    return new Promise((resolve) => {
      const from = node.position.clone();
      let t = 0;
      const stop = this.stage.onUpdate((dt) => {
        t += dt / Math.max(0.01, seconds);
        const k = Math.min(1, t);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const p = Vector3.Lerp(from, to, e);
        p.y += Math.sin(k * Math.PI) * arc;
        node.position.copyFrom(p);
        if (k >= 1) {
          stop();
          resolve();
        }
      });
    });
  }

  async move(i: number, from: string, to: string, kind: 'walk' | 'back' | 'warp' | 'cannon' | 'wash' | 'ride' | 'cable'): Promise<void> {
    const rig = this.rigs[i];
    void from;
    this.positions[i] = to;
    const target = this.fieldPos(to).add(this.slotOffset(i, to));
    rig.root.rotation.y = lookAtYaw(rig.root.position, target);
    if (kind === 'walk') {
      rig.setAnim('walk');
      await this.tween(rig.root, target, 0.32, 0.6);
    } else if (kind === 'back') {
      // stumbling backwards: face forward, hop back
      rig.root.rotation.y += Math.PI;
      rig.setAnim('hit');
      await this.tween(rig.root, target, 0.42, 0.35);
    } else if (kind === 'cannon') {
      rig.setAnim('roll');
      await this.tween(rig.root, target, 1.4, 14);
    } else if (kind === 'warp') {
      rig.setAnim('jump');
      rig.root.scaling.setAll(0.1);
      rig.setPosition(target);
      await this.tween(rig.root, target, 0.2);
      rig.root.scaling.setAll(1.5);
    } else if (kind === 'cable') {
      rig.setAnim('idle');
      await this.tween(rig.root, target, 1.6, 4);
    } else if (kind === 'ride') {
      rig.setAnim('idle');
      await this.tween(rig.root, target, 1.4, 2);
    } else {
      rig.setAnim('hit');
      await this.tween(rig.root, target, 0.9, 2);
    }
    rig.setAnim('idle');
    rig.root.rotation.y = 0;
    this.layoutTokens();
  }

  // ------------------------------------------------------------------ star, bags, traps, arrows

  setStar(field: string, animate = false): Promise<void> {
    this.starField = field;
    const p = this.fieldPos(field);
    if (!animate) {
      this.star.position.copyFrom(p);
      return Promise.resolve();
    }
    return this.tween(this.star, p, 1.6, 10);
  }

  setBag(field: string, placed: boolean): void {
    if (placed && !this.bags.has(field)) {
      const n = new TransformNode(`bag_${field}`, this.stage.scene);
      n.parent = this.root;
      for (let k = 0; k < 3; k++) {
        const c = coin(this.stage, `bag_${field}_${k}`, 0.7, n);
        c.rotation.x = 0;
        c.position.y = 0.15 + k * 0.14;
      }
      n.position.copyFrom(this.fieldPos(field));
      this.bags.set(field, n);
    } else if (!placed) {
      this.bags.get(field)?.dispose(false, false);
      this.bags.delete(field);
    }
  }

  setTrap(field: string, owner: number, color: PlayerColor, placed: boolean): void {
    if (placed) {
      this.traps.get(field)?.dispose(false, false);
      const r = rock(this.stage, `trap_${field}`, 0.7, PLAYER_COLOR_HEX[color], this.root);
      r.position.copyFrom(this.fieldPos(field).add(new Vector3(0.6, 0.1, 0.6)));
      this.traps.set(field, r);
    } else {
      this.traps.get(field)?.dispose(false, false);
      this.traps.delete(field);
    }
    void owner;
  }

  showArrows(from: string, options: string[]): void {
    this.clearArrows();
    const a = this.fieldPos(from);
    for (const o of options) {
      const b = this.fieldPos(o);
      const dir = b.subtract(a);
      dir.y = 0;
      dir.normalize();
      const arrow = cone(this.stage, `arrow_${o}`, 1.1, 1.6, '#ffffff', 3, this.root);
      arrow.material = this.stage.mat('#ffffff', { emissive: 0.5 });
      arrow.position = a.add(dir.scale(1.9)).add(new Vector3(0, 1.2, 0));
      arrow.rotation.x = Math.PI / 2;
      arrow.rotation.y = Math.atan2(dir.x, dir.z);
      this.arrows.push(arrow);
    }
  }

  clearArrows(): void {
    for (const a of this.arrows) a.dispose(false, false);
    this.arrows = [];
  }

  // ------------------------------------------------------------------ gimmicks (runtime)

  setTide(tide: 'high' | 'low', animate = true): void {
    const w = this.terrain.def.water;
    this.terrain.setWaterLevel(tide === 'low' ? (w.low ?? w.high) : w.high, !animate);
  }

  setLava(groups: string[][], group: number | null): void {
    for (const [gi, g] of groups.entries()) {
      for (const id of g) {
        const f = getField(this.map, id);
        if (gi === group) this.setTileColor(id, '#ff7a3d', 0.4);
        else this.setTileColor(id, FIELD_COLORS[f.type]);
      }
    }
  }

  highlightRoute(route: number | null): void {
    this.rails.forEach((r, k) => {
      const ri = Math.floor(k / 2);
      r.material = this.stage.mat(ri === route ? '#e8767a' : '#7a7486', { emissive: ri === route ? 0.4 : 0 });
    });
  }

  async runTrain(route: number): Promise<void> {
    const r = this.map.gimmickParams?.trainRoutes?.[route];
    if (!r) return;
    const pts = r.fields.map((id) => this.fieldPos(id));
    const start = pts[0].subtract(pts[1].subtract(pts[0]).normalize().scale(14));
    const end = pts[pts.length - 1].add(pts[pts.length - 1].subtract(pts[pts.length - 2]).normalize().scale(14));
    const train = new TransformNode('train', this.stage.scene);
    train.parent = this.root;
    const model = this.stage.assets.prop('loco', 'locoModel', train, '#e8767a');
    if (!model) {
      const loco = box(this.stage, 'loco', 1.8, 1.8, 3.6, '#e8767a', train);
      loco.position.y = 1.1;
      const cab = box(this.stage, 'cab', 1.8, 1, 1.4, '#3d3a55', train);
      cab.position.set(0, 2.4, 0.9);
    }
    const wagon = this.stage.assets.prop('wagon', 'wagonModel', train, '#6f9de6');
    if (wagon) wagon.position.z = 4.2;
    for (const m of train.getChildMeshes()) this.stage.castShadow(m, false);
    this.trainMesh = train;
    const path = [start, ...pts, end];
    train.position.copyFrom(start);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      train.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI;
      await this.tween(train, new Vector3(b.x, this.terrain.height(b.x, b.z) + 0.05, b.z), Vector3.Distance(a, b) / 18);
    }
    train.dispose(false, false);
    this.trainMesh = null;
  }

  /** Visual-only physics burst (Havok): coins or rocks popping out (e.g. eruption). */
  burst(at: Vector3, kind: 'coins' | 'rocks', count = 8): void {
    const s = this.stage;
    const meshes: AbstractMesh[] = [];
    for (let k = 0; k < count; k++) {
      const m = kind === 'coins' ? coin(s, `burst${k}`, 0.6, this.root) : rock(s, `burst${k}`, 0.8, '#5a4a48', this.root);
      m.position = at.add(new Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5));
      meshes.push(m);
      if (s.physics) {
        const agg = new PhysicsAggregate(m, kind === 'coins' ? PhysicsShapeType.CYLINDER : PhysicsShapeType.SPHERE, { mass: 0.2, restitution: 0.4 }, s.scene);
        agg.body.applyImpulse(new Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2), m.position);
        m.onDisposeObservable.add(() => agg.dispose());
      } else {
        Animation.CreateAndStartAnimation(`fall${k}`, m, 'position.y', 30, 30, m.position.y + 3, 0, Animation.ANIMATIONLOOPMODE_CONSTANT);
      }
    }
    if (s.physics) {
      const floor = MeshBuilder.CreateBox('burstFloor', { width: 12, depth: 12, height: 0.2 }, s.scene);
      floor.position.set(at.x, at.y - 0.1, at.z);
      floor.isVisible = false;
      const fa = new PhysicsAggregate(floor, PhysicsShapeType.BOX, { mass: 0 }, s.scene);
      setTimeout(() => {
        fa.dispose();
        floor.dispose();
      }, 2600);
    }
    setTimeout(() => meshes.forEach((m) => m.dispose(false, false)), 2500);
  }

  private update(dt: number) {
    this.t += dt;
    for (const r of this.rigs) r.update(dt);
    this.terrain.update(dt);
    this.star.rotation.y += dt * 1.2;
    this.star.getChildMeshes()[0]?.position.set(0, 2.4 + Math.sin(this.t * 2) * 0.25, 0);
    for (const b of this.bags.values()) b.rotation.y += dt * 2;
    for (const a of this.arrows) a.position.y = this.arrowBase(a) + Math.sin(this.t * 5) * 0.2;
    const wy = this.terrain.water.position.y;
    this.floaters.forEach((f, k) => {
      f.position.y = wy - 0.12 + Math.sin(this.t * 1.3 + k) * 0.05;
      f.rotation.z = Math.sin(this.t * 0.9 + k * 2) * 0.04;
    });
    if (this.waterfall) {
      this.waterfall.tex.vOffset = -this.t * 0.9;
      this.waterfall.foam.forEach((f, k) => f.scaling.setAll(0.9 + Math.sin(this.t * 4 + k * 1.7) * 0.15));
    }
    void this.trainMesh;
    void this.starField;
  }

  private arrowBase(a: Mesh): number {
    a.metadata ??= { y: a.position.y };
    return (a.metadata as { y: number }).y;
  }
}

// ------------------------------------------------------------------ helpers

function flatCyl(stage: Stage, name: string, d: number, h: number, tess: number, color: string, parent: TransformNode): Mesh {
  const m = MeshBuilder.CreateCylinder(name, { diameter: d, height: h, tessellation: tess }, stage.scene);
  m.convertToFlatShadedMesh();
  m.material = stage.mat(color);
  m.parent = parent;
  m.isPickable = false;
  return m;
}

function iconQuad(stage: Stage, name: string, text: string, color: string): Mesh {
  const scene = stage.scene;
  const tex = new DynamicTexture(`${name}_tex`, { width: 256, height: 256 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = `900 150px Nunito, "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.strokeText(text, 128, 140);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 138);
  tex.update();
  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.emissiveColor = new Color3(0.55, 0.55, 0.55);
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
  plane.material = mat;
  plane.isPickable = false;
  return plane;
}

/** Left side first if there is more open land there (away from other fields). */
function sideOrder(f: FieldDef, side: Vector3): number[] {
  // prefer the side facing away from the map center: buildings sit on the outside of loops
  const out = side.x * f.x + side.z * f.z;
  return out >= 0 ? [1, -1] : [-1, 1];
}

function decorRadius(kind: string): number {
  return (
    { lighthouse: 3, cliff: 4.5, volcano: 14, temple: 4, station: 4, stilthut: 2.6, hut: 2.2, house: 2.4, house2: 2, house3: 2.4, tower: 2, ruin: 1.6, cannon: 1.4, fountain: 2, crab: 1 }[kind] ??
    1.2
  );
}

function fallbackBridge(stage: Stage, name: string, parent: TransformNode): TransformNode {
  const n = new TransformNode(name, stage.scene);
  n.parent = parent;
  const deck = box(stage, `${name}d`, 2.4, 0.2, 7, '#a0703f', n);
  deck.position.y = BRIDGE_DECK - 0.1;
  for (const sx of [-1.15, 1.15]) {
    const rail = box(stage, `${name}r${sx}`, 0.12, 0.12, 7, '#7a5232', n);
    rail.position.set(sx, BRIDGE_DECK + 0.6, 0);
  }
  return n;
}

function fallbackPier(stage: Stage, name: string, parent: TransformNode): TransformNode {
  const n = new TransformNode(name, stage.scene);
  n.parent = parent;
  const deck = box(stage, `${name}d`, 2.4, 0.18, 3, '#b07d48', n);
  deck.position.y = PIER_DECK - 0.09;
  for (const sx of [-1, 1]) {
    const post = cyl(stage, `${name}p${sx}`, { d: 0.25, h: 2.6, tess: 6 }, '#7a5232', n);
    post.position.set(sx, PIER_DECK - 1.3, 0);
  }
  return n;
}
