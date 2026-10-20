import { Animation, Mesh, MeshBuilder, PhysicsAggregate, PhysicsShapeType, TransformNode, Vector3, type AbstractMesh } from '@babylonjs/core';
import type { CharacterId, PlayerColor } from '@wb/shared/config';
import { PLAYER_COLOR_HEX } from '@wb/shared/config';
import { getField, type FieldDef, type MapDef } from '@wb/shared/maps/index';
import { CharacterRig, lookAtYaw } from './characters';
import { box, coin, cone, cyl, hut, labelPlane, palm, rock, sphere, starMesh, tree } from './props';
import type { Stage } from './stage';

/**
 * 3D board built from the data-driven map (MAP-06): ground, field tiles, path dots,
 * decoration, wandering star and the visual side of the map gimmicks (MAP-02).
 */
const FIELD_COLORS: Record<string, string> = {
  blue: '#6f9de6',
  red: '#e8767a',
  event: '#6cc69a',
  lucky: '#f2c94c',
  duel: '#a78bdb',
  item: '#f4a259',
  shop: '#f6efe2',
  start: '#ffffff',
  station: '#e6e1f2',
  cablecar: '#d8d4e8',
};
const FIELD_ICON: Record<string, string> = {
  event: '!',
  lucky: '?',
  duel: '⚔',
  item: '🎁',
  shop: '🦀',
  start: '🏁',
  station: '🚉',
  cablecar: '🚡',
};
const TILE_Y = 0.35;

export interface TokenInfo {
  character: CharacterId;
  color: PlayerColor;
}

export class BoardView {
  readonly root: TransformNode;
  readonly rigs: CharacterRig[] = [];
  private tiles = new Map<string, Mesh>();
  private star: TransformNode;
  private starField = '';
  private water: Mesh | null = null;
  private sandbanks: Mesh[] = [];
  private tide: 'high' | 'low' = 'high';
  private bags = new Map<string, TransformNode>();
  private traps = new Map<string, Mesh>();
  private arrows: Mesh[] = [];
  private rails: Mesh[] = [];
  private trainMesh: TransformNode | null = null;
  private positions: string[] = [];
  private updater: () => void;
  private t = 0;
  private lavaGroup: number | null = null;

  constructor(
    private readonly stage: Stage,
    readonly map: MapDef,
    tokens: TokenInfo[],
  ) {
    this.root = new TransformNode('board', stage.scene);
    const p = map.palette;
    stage.setSky(p.sky[0], p.sky[1], p.fog);
    this.buildGround();
    this.buildPaths();
    for (const f of map.fields) this.buildTile(f);
    this.buildDecor();
    this.buildGimmick();
    this.star = new TransformNode('star', stage.scene);
    this.star.parent = this.root;
    const sm = starMesh(stage, 'starMesh', 2.2, '#f2c94c', this.star);
    sm.position.y = 2.4;
    stage.castShadow(sm, false);
    tokens.forEach((tk, i) => {
      const rig = new CharacterRig(stage, tk.character, tk.color, `tok${i}`);
      rig.root.parent = this.root;
      this.rigs.push(rig);
      this.positions.push(map.start);
    });
    this.layoutTokens(true);
    this.updater = stage.onUpdate((dt) => this.update(dt));
  }

  dispose(): void {
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

  // ------------------------------------------------------------------ building

  private bounds() {
    const xs = this.map.fields.map((f) => f.x);
    const zs = this.map.fields.map((f) => f.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }

  private buildGround() {
    const s = this.stage;
    const p = this.map.palette;
    const b = this.bounds();
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const theme = this.map.theme;
    // sea / lava plane
    const sea = MeshBuilder.CreateGround('sea', { width: 400, height: 400, subdivisions: 2 }, s.scene);
    sea.position.y = theme === 'island' ? -0.35 : -1.2;
    sea.material = s.mat(p.water, { emissive: theme === 'volcano' ? 0.5 : 0.05 });
    sea.parent = this.root;
    s.receiveShadow(sea);
    this.water = theme === 'island' ? sea : null;
    if (theme === 'city') {
      const g = box(s, 'ground', w + 16, 1.2, d + 14, p.ground, this.root);
      g.position.y = -0.6;
      s.receiveShadow(g);
      const rim = box(s, 'groundRim', w + 18, 1.0, d + 16, p.ground2, this.root);
      rim.position.y = -0.9;
    } else {
      const sand = cyl(s, 'sand', { top: 1, bottom: 1.06, h: 1.4, tess: 12 }, p.ground2, this.root);
      sand.scaling.set(w + 18, 1, d + 18);
      sand.position.y = -0.8;
      s.receiveShadow(sand);
      const grass = cyl(s, 'grass', { top: 1, bottom: 1, h: 0.4, tess: 12 }, p.ground, this.root);
      grass.scaling.set(w + 8, 1, d + 8);
      grass.position.y = -0.05;
      s.receiveShadow(grass);
    }
  }

  private buildPaths() {
    const s = this.stage;
    const pathColor = this.map.palette.path;
    for (const f of this.map.fields) {
      for (const n of f.next) {
        const to = getField(this.map, n);
        const a = this.fieldPos(f.id);
        const bb = this.fieldPos(to.id);
        const len = Vector3.Distance(a, bb);
        const dots = Math.max(1, Math.floor(len / 1.2) - 1);
        for (let k = 1; k <= dots; k++) {
          const p = Vector3.Lerp(a, bb, k / (dots + 1));
          const dot = cyl(s, `dot_${f.id}_${n}_${k}`, { d: 0.42, h: 0.12, tess: 6 }, pathColor, this.root);
          dot.position.set(p.x, p.y - 0.25, p.z);
          if (f.tags?.includes('sandbank') || to.tags?.includes('sandbank')) this.sandbanks.push(dot);
        }
      }
    }
  }

  private buildTile(f: FieldDef) {
    const s = this.stage;
    const pos = this.fieldPos(f.id);
    const rim = cyl(s, `rim_${f.id}`, { d: 2.5, h: 0.32, tess: 8 }, '#f7f4ee', this.root);
    rim.position.set(pos.x, pos.y - 0.2, pos.z);
    const tile = cyl(s, `tile_${f.id}`, { d: 2.1, h: 0.2, tess: 8 }, FIELD_COLORS[f.type], rim);
    tile.position.y = 0.1;
    s.receiveShadow(rim);
    s.receiveShadow(tile);
    this.tiles.set(f.id, tile);
    const icon = FIELD_ICON[f.type];
    if (icon) {
      const l = labelPlane(s.scene, `icon_${f.id}`, icon, { size: 1.2, color: '#ffffff', font: 140 });
      l.billboardMode = Mesh.BILLBOARDMODE_NONE;
      l.rotation.x = Math.PI / 2;
      l.parent = rim;
      l.position.y = 0.22;
    }
    if (f.type === 'shop') {
      const stall = hut(s, `shop_${f.id}`, this.map.palette.accent, this.root);
      stall.scaling.setAll(0.55);
      stall.position.set(pos.x * 1.12, 0, pos.z * 1.12);
    }
    if (f.type === 'station' && f.label) {
      const sign = labelPlane(s.scene, `sign_${f.id}`, '🚉', { size: 1.6, bg: '#ffffff' });
      sign.parent = this.root;
      sign.position.set(pos.x, 2.6, pos.z);
    }
    if (f.tags?.includes('sandbank')) {
      this.sandbanks.push(rim);
      const bar = box(s, `sandbar_${f.id}`, 3.2, 0.3, 3.2, this.map.palette.ground2, this.root);
      bar.position.set(pos.x, pos.y - 0.5, pos.z);
      this.sandbanks.push(bar);
    }
  }

  private buildDecor() {
    const s = this.stage;
    for (const [i, d] of (this.map.decor ?? []).entries()) {
      let node: TransformNode | Mesh;
      switch (d.kind) {
        case 'palm':
          node = palm(s, `palm${i}`, this.root, 1.1);
          break;
        case 'hut':
          node = hut(s, `hut${i}`, i % 2 ? '#e8767a' : '#6f9de6', this.root);
          break;
        case 'house':
          node = hut(s, `house${i}`, ['#e8767a', '#6f9de6', '#f4a259', '#6cc69a'][i % 4], this.root);
          node.scaling.setAll(1.3);
          break;
        case 'rock':
          node = rock(s, `rock${i}`, 1.6, '#b9b6c4', this.root);
          break;
        case 'tree':
          node = tree(s, `tree${i}`, this.root);
          break;
        case 'deadtree':
          node = cyl(s, `dtree${i}`, { top: 0.15, bottom: 0.5, h: 3, tess: 5 }, '#5a4a48', this.root);
          node.position.y = 1.5;
          break;
        case 'obsidian': {
          const n = new TransformNode(`obs${i}`, s.scene);
          n.parent = this.root;
          for (let k = 0; k < 3; k++) {
            const c = cone(s, `obs${i}_${k}`, 0.9, 2 + k * 0.6, '#3b3446', 5, n);
            c.position.set(k * 0.5 - 0.5, (2 + k * 0.6) / 2, (k % 2) * 0.4);
            c.rotation.z = (k - 1) * 0.2;
          }
          node = n;
          break;
        }
        case 'volcano': {
          const n = new TransformNode(`volcano${i}`, s.scene);
          n.parent = this.root;
          const v = cyl(s, 'volcanoCone', { top: 5, bottom: 22, h: 9, tess: 9 }, '#7a6a72', n);
          v.position.y = 4.4;
          const lava = cyl(s, 'volcanoLava', { d: 4.2, h: 0.4, tess: 9 }, '#ff7a3d', n);
          lava.material = s.mat('#ff7a3d', { emissive: 0.9 });
          lava.position.y = 8.85;
          s.castShadow(v, false);
          s.receiveShadow(v);
          node = n;
          break;
        }
        case 'cablecar': {
          // cable from the cable car station to the summit
          const from = this.map.fields.find((f) => f.type === 'cablecar');
          const target = this.map.gimmickParams?.cableCarTarget;
          if (!from || !target) continue;
          const a = this.fieldPos(from.id).add(new Vector3(0, 4, 0));
          const b = this.fieldPos(target).add(new Vector3(0, 4, 0));
          const line = MeshBuilder.CreateTube(`cable${i}`, { path: [a, Vector3.Lerp(a, b, 0.5).add(new Vector3(0, 1.5, 0)), b], radius: 0.06 }, s.scene);
          line.material = s.mat('#3d3a55');
          line.parent = this.root;
          for (const p of [a, b]) {
            const tower = cyl(s, `tower${i}`, { d: 0.4, h: 4, tess: 5 }, '#6c6a7a', this.root);
            tower.position.set(p.x, p.y - 2 + 0.3, p.z);
          }
          const gondola = box(s, `gondola${i}`, 1, 0.8, 1, '#e8767a', this.root);
          gondola.position = Vector3.Lerp(a, b, 0.3).add(new Vector3(0, -0.4, 0));
          continue;
        }
        case 'cannon': {
          const n = new TransformNode(`cannon${i}`, s.scene);
          n.parent = this.root;
          cyl(s, `cannonBase${i}`, { d: 1.6, h: 0.6, tess: 8 }, '#8a5a3c', n).position.y = 0.3;
          const barrel = cyl(s, `cannonBarrel${i}`, { top: 0.7, bottom: 0.9, h: 2.4, tess: 8 }, '#3d3a4a', n);
          barrel.position.y = 1.2;
          barrel.rotation.x = -0.7;
          for (let k = 0; k < 3; k++) sphere(s, `coco${i}_${k}`, 0.55, '#6b4a2b', 3, n).position.set(1 + k * 0.3, 0.3, 0.5 - k * 0.5);
          node = n;
          break;
        }
        case 'crab': {
          const n = new TransformNode(`crab${i}`, s.scene);
          n.parent = this.root;
          const body = sphere(s, `crabBody${i}`, 1.2, '#e8676b', 4, n);
          body.scaling.y = 0.55;
          body.position.y = 0.4;
          for (const side of [-1, 1]) sphere(s, `claw${i}${side}`, 0.5, '#e8676b', 3, n).position.set(side * 0.8, 0.5, -0.4);
          node = n;
          break;
        }
        case 'tower': {
          node = cyl(s, `clock${i}`, { d: 2, h: 7, tess: 6 }, '#f6efe2', this.root);
          node.position.y = 3.5;
          const roof = cone(s, `clockRoof${i}`, 2.6, 2, '#e8767a', 6, this.root);
          roof.position.set(d.x, 7, d.z);
          break;
        }
        case 'fountain': {
          node = cyl(s, `fountain${i}`, { d: 3, h: 0.6, tess: 10 }, '#d9d6ea', this.root);
          node.position.y = 0.3;
          const w = cyl(s, `fountainW${i}`, { d: 2.4, h: 0.1, tess: 10 }, '#86c8e0', this.root);
          w.position.set(d.x, 0.6, d.z);
          break;
        }
        default:
          continue;
      }
      node.position.x = d.x;
      node.position.z = d.z;
      if (d.r) node.rotation.y = d.r;
      if (d.s && d.kind !== 'volcano') node.scaling.setAll(d.s);
      for (const m of node.getChildMeshes()) s.castShadow(m, false);
    }
    // city: little shop buildings next to the star spots ("Stern liegt in wechselnden Läden")
    if (this.map.theme === 'city') {
      for (const id of this.map.starSpots) {
        const p = this.fieldPos(id);
        const shop = hut(s, `starShop_${id}`, '#f2c94c', this.root);
        shop.scaling.setAll(0.6);
        const out = new Vector3(p.x, 0, p.z).normalize().scale(3.2);
        shop.position.set(p.x + (Math.abs(p.z) > 12 ? 0 : out.x), 0, p.z + (Math.abs(p.z) > 12 ? Math.sign(p.z) * 3.2 : 0));
      }
    }
  }

  private buildGimmick() {
    const s = this.stage;
    const routes = this.map.gimmickParams?.trainRoutes;
    if (routes) {
      routes.forEach((r, ri) => {
        const pts = r.fields.map((id) => this.fieldPos(id));
        // extend the line beyond the first/last field
        const first = pts[0].subtract(pts[1].subtract(pts[0]).normalize().scale(6));
        const last = pts[pts.length - 1].add(pts[pts.length - 1].subtract(pts[pts.length - 2]).normalize().scale(6));
        const path = [first, ...pts, last].map((p) => new Vector3(p.x, -0.02, p.z));
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
    return new Vector3(f.x, TILE_Y + (f.y ?? 0), f.z);
  }

  tokenPos(i: number): Vector3 {
    return this.rigs[i].root.position.clone();
  }

  center(): Vector3 {
    const b = this.bounds();
    return new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  }

  overview(instant = false): void {
    const b = this.bounds();
    const size = Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) * 1.5);
    this.stage.setCamera({ alpha: -Math.PI / 2, beta: 0.78, radius: size * 1.15, target: this.center().add(new Vector3(0, 0, 2)) }, 1.6, instant);
  }

  focus(i: number, radius = 22): void {
    const p = this.tokenPos(i);
    this.stage.setCamera({ alpha: -Math.PI / 2 - p.x * 0.006, beta: 0.85, radius, target: p.add(new Vector3(0, 1, 0)) }, 2.4);
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
    return new Vector3(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
  }

  layoutTokens(instant = false): void {
    this.rigs.forEach((rig, i) => {
      const target = this.fieldPos(this.positions[i]).add(this.slotOffset(i, this.positions[i])).add(new Vector3(0, 0.15, 0));
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

  async move(i: number, from: string, to: string, kind: 'walk' | 'warp' | 'cannon' | 'wash' | 'ride' | 'cable'): Promise<void> {
    const rig = this.rigs[i];
    void from;
    this.positions[i] = to;
    const target = this.fieldPos(to).add(this.slotOffset(i, to)).add(new Vector3(0, 0.15, 0));
    rig.root.rotation.y = lookAtYaw(rig.root.position, target);
    if (kind === 'walk') {
      rig.setAnim('walk');
      await this.tween(rig.root, target, 0.32, 0.6);
    } else if (kind === 'cannon') {
      rig.setAnim('roll');
      await this.tween(rig.root, target, 1.4, 14);
    } else if (kind === 'warp') {
      rig.setAnim('jump');
      rig.root.scaling.setAll(0.1);
      rig.setPosition(target);
      await this.tween(rig.root, target, 0.2);
      rig.root.scaling.setAll(1);
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
    const key = field;
    if (placed) {
      this.traps.get(key)?.dispose(false, false);
      const r = rock(this.stage, `trap_${field}`, 0.7, PLAYER_COLOR_HEX[color], this.root);
      r.position.copyFrom(this.fieldPos(field).add(new Vector3(0.6, 0.3, 0.6)));
      this.traps.set(key, r);
    } else {
      this.traps.get(key)?.dispose(false, false);
      this.traps.delete(key);
    }
    void owner;
  }

  showArrows(from: string, options: string[]): void {
    this.clearArrows();
    const a = this.fieldPos(from);
    for (const o of options) {
      const b = this.fieldPos(o);
      const dir = b.subtract(a).normalize();
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

  // ------------------------------------------------------------------ gimmicks

  setTide(tide: 'high' | 'low', animate = true): void {
    this.tide = tide;
    if (!animate) this.applyTide(1);
  }

  private applyTide(k: number) {
    const low = this.tide === 'low';
    if (this.water) this.water.position.y += ((low ? -0.75 : -0.05) - this.water.position.y) * k;
    for (const m of this.sandbanks) {
      const baseY = (m.metadata?.baseY as number | undefined) ?? m.position.y;
      m.metadata = { baseY };
      const targetY = low ? baseY : baseY - 1.2;
      m.position.y += (targetY - m.position.y) * k;
    }
  }

  setLava(groups: string[][], group: number | null): void {
    this.lavaGroup = group;
    for (const [gi, g] of groups.entries()) {
      for (const id of g) {
        const tile = this.tiles.get(id);
        if (!tile) continue;
        const f = getField(this.map, id);
        tile.material = gi === group ? this.stage.mat('#ff7a3d', { emissive: 0.9 }) : this.stage.mat(FIELD_COLORS[f.type]);
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
    const loco = box(this.stage, 'loco', 1.8, 1.8, 3.6, '#e8767a', train);
    loco.position.y = 1.1;
    const cab = box(this.stage, 'cab', 1.8, 1, 1.4, '#3d3a55', train);
    cab.position.set(0, 2.4, 0.9);
    const chimney = cyl(this.stage, 'chimney', { d: 0.5, h: 1, tess: 6 }, '#3d3a55', train);
    chimney.position.set(0, 2.4, -1.2);
    for (const m of train.getChildMeshes()) this.stage.castShadow(m, false);
    this.trainMesh = train;
    const path = [start, ...pts, end];
    train.position.copyFrom(start);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      train.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      await this.tween(train, new Vector3(b.x, 0, b.z), Vector3.Distance(a, b) / 18);
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
      // invisible floor for the burst
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
    this.star.rotation.y += dt * 1.2;
    this.star.getChildMeshes()[0]?.position.set(0, 2.4 + Math.sin(this.t * 2) * 0.25, 0);
    for (const b of this.bags.values()) b.rotation.y += dt * 2;
    for (const a of this.arrows) a.position.y = 1.2 + Math.sin(this.t * 5) * 0.2;
    this.applyTide(Math.min(1, dt * 1.5));
    if (this.water && this.map.theme === 'island') this.water.position.y += Math.sin(this.t * 0.8) * 0.0015;
    void this.lavaGroup;
    void this.trainMesh;
  }
}
