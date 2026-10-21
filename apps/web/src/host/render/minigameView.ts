import { Color3, Matrix, Mesh, MeshBuilder, PointLight, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import type { MgEntity, MgFx, MgPlayer, MgSet, MgSfx, MgView } from '@wb/shared/minigames/types';
import { t } from '@wb/shared/i18n/index';
import { CharacterRig } from './characters';
import { burst } from './mgFx';
import { SceneryBuilder } from './mgScenery';
import { box, coin, cone, cyl, labelPlane, palm, rock, sphere, starMesh } from './props';
import type { Stage } from './stage';
import { surfaceMat, worldUvs } from './surfaces';
import { copyTexture, lavaTexture, waterNormals } from './terrain';

/**
 * Generic renderer for minigame views (MINI-07): minigames only describe entities,
 * this class creates/updates/disposes meshes diffed by entity id. v0.4: a backdrop per
 * game (mgScenery), surfaces on primitives, library props, animated water, one-shot
 * effects with positional sound and a winner celebration.
 */
const ENV: Record<MgView['env'], { sky: [string, string]; fog: string; ground: string | null; emissive?: number }> = {
  water: { sky: ['#9fd3ec', '#e8f4fa'], fog: '#cfe8f2', ground: '#86c8e0' },
  lava: { sky: ['#f2b49b', '#fbe3d0'], fog: '#f3cdbd', ground: '#e8603a', emissive: 0.25 },
  grass: { sky: ['#a9d6ee', '#eef6e8'], fog: '#dbeee0', ground: '#b9d7a1' },
  night: { sky: ['#1d2140', '#2b3060'], fog: '#1d2140', ground: '#2d3a3a' },
  sky: { sky: ['#a9c8f0', '#eef3fb'], fog: '#dfe7f2', ground: null },
  city: { sky: ['#a9c8f0', '#eef3fb'], fog: '#dfe7f2', ground: '#c9d6b0' },
  sand: { sky: ['#f6d9a8', '#fdf1dc'], fog: '#f6e3c4', ground: '#e7cf9f' },
  ice: { sky: ['#bfe3f5', '#f2fbff'], fog: '#e0f2fb', ground: '#9fd0e8' },
};

/** Library models standing in for the classic entity kinds (fallback: procedural). */
const LIBRARY: Partial<Record<MgEntity['kind'], { id: string; scale: number; yaw?: number }>> = {
  palm: { id: 'palm', scale: 0.95 },
  // the library boat and loco point along z, minigames expect x
  boat: { id: 'boat', scale: 1, yaw: Math.PI / 2 },
  train: { id: 'loco', scale: 1, yaw: Math.PI / 2 },
};

interface Item {
  node: TransformNode;
  kind: string;
  key: string;
  rig?: CharacterRig;
  label?: Mesh;
  labelText?: string;
  light?: PointLight;
  /** size the geometry was built with (surface primitives): scaling = size / base */
  base?: [number, number, number];
  tex?: Texture;
}

export type FxSound = (sfx: MgSfx, pan: number, gain: number) => void;

export class MinigameView {
  readonly root: TransformNode;
  private items = new Map<string, Item>();
  private ground: Mesh | null = null;
  private env: MgView['env'] | null = null;
  private hemiBackup: number | null = null;
  private scenery: SceneryBuilder | null = null;
  private sceneryKey = '';
  private fxSeen = new Set<string>();
  private celebrate: number[] | null = null;
  private t = 0;
  onSound: FxSound = () => {};
  /** set to tune how fast the camera follows the game camera (intro fly-in) */
  cameraSpeed = 3;
  /** false = the camera stays where the host put it (winner close-up) */
  followCamera = true;

  constructor(
    private readonly stage: Stage,
    private readonly players: MgPlayer[],
  ) {
    this.root = new TransformNode('minigame', stage.scene);
  }

  get set(): string | null {
    return this.scenery?.sc.set ?? null;
  }

  dispose(): void {
    for (const it of this.items.values()) this.disposeItem(it);
    this.items.clear();
    this.ground?.dispose(false, false);
    this.scenery?.dispose();
    this.scenery = null;
    this.root.dispose(false, false);
    this.restoreLight();
  }

  /** Winners cheer, the others are sad (ranks per minigame player, null = game decides). */
  setCelebration(ranks: number[] | null): void {
    this.celebrate = ranks;
  }

  /** World position of a player entity (last rendered), for camera moves. */
  playerPos(idx: number): Vector3 | null {
    for (const it of this.items.values()) if (it.rig && it.kind === `player${idx}`) return it.node.position.clone();
    return null;
  }

  private setEnv(view: MgView) {
    const env = view.env;
    // dev: ?mgset=<set> previews another backdrop around any minigame
    const forced = import.meta.env.DEV ? (new URLSearchParams(location.search).get('mgset') as MgSet | null) : null;
    if (forced) view = { ...view, scenery: { ...(view.scenery ?? { clear: { r: 10 } }), set: forced } };
    if (view.scenery) {
      const key = JSON.stringify(view.scenery);
      if (key !== this.sceneryKey) {
        this.sceneryKey = key;
        this.scenery?.dispose();
        this.ground?.dispose(false, false);
        this.ground = null;
        this.restoreLight();
        this.scenery = new SceneryBuilder(this.stage, view.scenery);
        this.scenery.root.parent = this.root;
        this.env = env;
      }
      return;
    }
    if (env === this.env) return;
    this.env = env;
    const e = ENV[env];
    this.stage.setSky(e.sky[0], e.sky[1], e.fog);
    this.ground?.dispose(false, false);
    this.ground = null;
    if (e.ground) {
      const g = MeshBuilder.CreateGround('mgGround', { width: 400, height: 400 }, this.stage.scene);
      g.position.y = env === 'grass' || env === 'city' || env === 'sand' || env === 'night' ? -0.02 : -0.8;
      g.material = this.stage.mat(e.ground, { emissive: e.emissive });
      g.receiveShadows = true;
      g.parent = this.root;
      this.ground = g;
    }
    const hemi = this.stage.scene.lights.find((l) => l.name === 'hemi');
    if (env === 'night') {
      if (hemi && this.hemiBackup === null) this.hemiBackup = hemi.intensity;
      if (hemi) hemi.intensity = 0.18;
      this.stage.sun.intensity = 0.15;
    } else this.restoreLight();
  }

  private restoreLight() {
    const hemi = this.stage.scene.lights.find((l) => l.name === 'hemi');
    if (hemi && this.hemiBackup !== null) hemi.intensity = this.hemiBackup;
    this.hemiBackup = null;
    this.stage.sun.intensity = 0.72;
  }

  private keyOf(e: MgEntity): string {
    return `${e.kind}|${e.color ?? ''}|${e.player ?? ''}|${e.glow ? 1 : 0}|${e.alpha !== undefined && e.alpha < 1 ? 'a' : ''}|${e.mat ?? ''}|${e.prop ?? ''}|${e.taper ?? ''}`;
  }

  private create(e: MgEntity): Item {
    const s = this.stage;
    const color = e.color ?? '#d9d6ea';
    const key = this.keyOf(e);
    let node: TransformNode;
    let rig: CharacterRig | undefined;
    let light: PointLight | undefined;
    let base: Item['base'];
    let tex: Texture | undefined;
    const translucent = e.alpha !== undefined && e.alpha < 1;
    const mat = (c: string) =>
      e.mat ? surfaceMat(s, c, e.mat, { emissive: e.glow ? 0.3 : 0, alpha: translucent ? 0.55 : undefined }) : s.mat(c, { emissive: e.glow ? 0.8 : 0, alpha: translucent ? 0.55 : 1 });
    const lib = LIBRARY[e.kind];
    const libNode = lib && !translucent ? s.assets.prop(lib.id, e.id, undefined, e.kind === 'train' ? color : e.color) : null;
    if (libNode) {
      node = libNode;
      for (const c of node.getChildMeshes()) {
        c.scaling.setAll(lib!.scale);
        if (lib!.yaw) {
          c.rotation.y = lib!.yaw;
          c.position = Vector3.TransformCoordinates(c.position, Matrix.RotationY(lib!.yaw));
        }
      }
    } else if (e.mat && (e.kind === 'box' || e.kind === 'cylinder' || e.kind === 'plane' || e.kind === 'sphere' || e.kind === 'cone')) {
      // surface primitives are built at their real size so the texture keeps its scale
      const [w, h, d] = [Math.abs(e.sx ?? 1) || 1, Math.abs(e.sy ?? 1) || 1, Math.abs(e.sz ?? 1) || 1];
      base = [w, h, d];
      let m: Mesh;
      if (e.kind === 'box') m = MeshBuilder.CreateBox(e.id, { width: w, height: h, depth: d }, s.scene);
      else if (e.kind === 'plane') {
        m = MeshBuilder.CreateGround(e.id, { width: w, height: d }, s.scene);
        base = [w, 1, d];
      } else if (e.kind === 'sphere') {
        m = MeshBuilder.CreateSphere(e.id, { diameterX: w, diameterY: h, diameterZ: d, segments: 6 }, s.scene);
        m.convertToFlatShadedMesh();
      } else {
        const top = e.kind === 'cone' ? 0 : w * (e.taper ?? 1);
        m = MeshBuilder.CreateCylinder(e.id, { diameterTop: top, diameterBottom: w, height: h, tessellation: Math.max(10, Math.min(28, Math.round(w * 3))) }, s.scene);
        m.convertToFlatShadedMesh();
        m.scaling.z = d / w;
        base = [w, h, w];
        if (e.kind === 'cone') {
          // cone: base at y
          const wrap = new TransformNode(`${e.id}_w`, s.scene);
          m.parent = wrap;
          m.position.y = h / 2;
          m.scaling.z = 1;
          worldUvs(m, e.mat);
          m.material = mat(color);
          m.receiveShadows = true;
          node = wrap;
          node.parent = this.root;
          for (const c of [m]) s.castShadow(c, false);
          return { node, kind: e.kind, key, base };
        }
        m.scaling.z = 1;
      }
      if (e.mat === 'lava') {
        // lava blocks glow on their own
        m.material = surfaceMat(s, color, 'lava');
      } else {
        worldUvs(m, e.mat, e.kind !== 'plane');
        m.material = mat(color);
      }
      m.receiveShadows = true;
      node = m;
    } else {
      switch (e.kind) {
        case 'player': {
          const p = this.players[e.player ?? 0];
          rig = new CharacterRig(s, p?.character ?? 'rocco', p?.color ?? 'red', `mgp_${e.id}`);
          node = rig.root;
          break;
        }
        case 'box':
          node = box(s, e.id, 1, 1, 1, color);
          (node as Mesh).material = mat(color);
          break;
        case 'sphere':
          node = sphere(s, e.id, 1, color, 5);
          (node as Mesh).material = mat(color);
          break;
        case 'cylinder':
          node = cyl(s, e.id, { d: 1, h: 1, tess: 16 }, color);
          (node as Mesh).material = mat(color);
          break;
        case 'cone': {
          node = new TransformNode(e.id, s.scene);
          const c = cone(s, `${e.id}_c`, 1, 1, color, 9, node);
          c.position.y = 0.5;
          c.material = mat(color);
          break;
        }
        case 'torus': {
          const m = MeshBuilder.CreateTorus(e.id, { diameter: 1, thickness: 0.2, tessellation: 24 }, s.scene);
          m.material = mat(color);
          node = m;
          break;
        }
        case 'plane': {
          const m = MeshBuilder.CreateGround(e.id, { width: 1, height: 1 }, s.scene);
          m.material = mat(color);
          m.receiveShadows = true;
          node = m;
          break;
        }
        case 'coin':
          node = coin(s, e.id, 1);
          node.rotation.x = 0;
          break;
        case 'star':
          node = starMesh(s, e.id, 1, e.color ?? '#f2c94c');
          break;
        case 'rock':
          node = rock(s, e.id, 1, e.color ?? '#9b97a6');
          worldUvs(node as Mesh, 'stone');
          (node as Mesh).material = surfaceMat(s, e.color ?? '#9b97a6', 'stone');
          break;
        case 'coconut':
          node = sphere(s, e.id, 0.7, e.color ?? '#6b4a2b', 3);
          break;
        case 'palm':
          node = palm(s, e.id);
          break;
        case 'balloon': {
          node = new TransformNode(e.id, s.scene);
          const b = MeshBuilder.CreateSphere(`${e.id}_b`, { diameter: 1, segments: 8 }, s.scene);
          b.parent = node;
          b.scaling.y = 1.15;
          const bm = new StandardMaterial(`${e.id}_bm`, s.scene);
          const c = Color3.FromHexString(color);
          bm.diffuseColor = c;
          bm.specularColor = new Color3(0.5, 0.5, 0.5);
          bm.specularPower = 40;
          bm.emissiveColor = c.scale(e.glow ? 0.6 : 0.12);
          if (translucent) bm.alpha = 0.55;
          b.material = bm;
          b.onDisposeObservable.add(() => bm.dispose());
          const knot = cone(s, `${e.id}_k`, 0.14, 0.12, color, 5, node);
          knot.position.y = -0.62;
          const str = cyl(s, `${e.id}_s`, { d: 0.02, h: 1, tess: 3 }, '#ffffff', node);
          str.position.y = -1.15;
          break;
        }
        case 'boat': {
          node = new TransformNode(e.id, s.scene);
          const hull = box(s, `${e.id}_h`, 3, 0.5, 1.6, e.color ?? '#a0703f', node);
          hull.position.y = 0.25;
          for (let k = -1; k <= 1; k++) box(s, `${e.id}_p${k}`, 0.18, 0.55, 1.65, '#8a5a3c', node).position.set(k * 0.9, 0.3, 0);
          break;
        }
        case 'train': {
          node = new TransformNode(e.id, s.scene);
          const body = box(s, `${e.id}_b`, 4, 1.6, 1.6, color, node);
          body.position.y = 1;
          const cab = box(s, `${e.id}_c`, 1.2, 1, 1.6, '#3d3a55', node);
          cab.position.set(-1.3, 2.2, 0);
          const ch = cyl(s, `${e.id}_ch`, { d: 0.45, h: 0.9, tess: 6 }, '#3d3a55', node);
          ch.position.set(1.3, 2.1, 0);
          break;
        }
        case 'lantern': {
          node = new TransformNode(e.id, s.scene);
          const model = s.assets.prop('lantern', `${e.id}_m`, node);
          if (model) model.position.y = -1.1;
          else {
            const body = sphere(s, `${e.id}_l`, 0.5, '#ffe08a', 4, node);
            body.material = s.mat('#ffe08a', { emissive: 1 });
          }
          const halo = sphere(s, `${e.id}_h`, 0.55, '#ffe08a', 4, node);
          halo.material = s.mat('#ffe08a', { emissive: 1 });
          light = new PointLight(`${e.id}_light`, Vector3.Zero(), s.scene);
          light.diffuse = new Color3(1, 0.86, 0.55);
          light.intensity = 1.8;
          light.range = 10;
          light.parent = node;
          break;
        }
        case 'prop': {
          node = s.assets.prop(e.prop ?? 'crate', e.id, undefined, e.color) ?? box(s, e.id, 1, 1, 1, color);
          break;
        }
        case 'water': {
          const w = Math.abs(e.sx ?? 10);
          const d = Math.abs(e.sz ?? 10);
          const m = MeshBuilder.CreateGround(e.id, { width: w, height: d }, s.scene);
          const wm = new StandardMaterial(`${e.id}_wm`, s.scene);
          if (e.mat === 'lava') {
            tex = copyTexture(s.scene, lavaTexture(s.scene, true), `${e.id}_lava`);
            tex.uScale = w / 12;
            tex.vScale = d / 12;
            wm.emissiveTexture = tex;
            wm.diffuseColor = new Color3(0.12, 0.04, 0.03);
            wm.specularColor = Color3.Black();
          } else {
            wm.diffuseColor = Color3.FromHexString(e.color ?? '#3fb0d8');
            wm.alpha = translucent ? (e.alpha ?? 0.7) : 0.78;
            wm.specularColor = new Color3(0.6, 0.65, 0.7);
            wm.specularPower = 110;
            tex = copyTexture(s.scene, waterNormals(s.scene), `${e.id}_wn`);
            tex.uScale = w / 5;
            tex.vScale = d / 5;
            tex.level = 0.25;
            wm.bumpTexture = tex;
            wm.backFaceCulling = false;
          }
          m.material = wm;
          m.receiveShadows = true;
          m.onDisposeObservable.add(() => {
            wm.dispose();
            tex?.dispose();
          });
          node = m;
          base = [w, 1, d];
          break;
        }
        default:
          node = box(s, e.id, 1, 1, 1, '#ff00ff');
      }
    }
    node.parent = this.root;
    // parts hidden below the backdrop's ground would still darken it (soft-shadow bleeding)
    const sc = this.scenery;
    const buried = !!sc && !sc.def.water && e.y + Math.abs(e.sy ?? 1) / 2 < sc.g - 0.05 && e.kind !== 'player';
    if (e.kind !== 'plane' && e.kind !== 'water' && !buried) for (const m of [node, ...node.getChildMeshes()]) if (m instanceof Mesh) s.castShadow(m, false);
    for (const m of node.getChildMeshes()) m.receiveShadows = true;
    return { node, kind: e.kind === 'player' ? `player${e.player ?? 0}` : e.kind, key, rig, light, base, tex };
  }

  private disposeItem(it: Item) {
    it.label?.dispose();
    it.light?.dispose();
    if (it.rig) it.rig.dispose();
    else it.node.dispose(false, false);
  }

  render(view: MgView, dt: number): void {
    this.t += dt;
    this.setEnv(view);
    this.scenery?.update(dt);
    const seen = new Set<string>();
    for (const e of view.entities) {
      seen.add(e.id);
      let it = this.items.get(e.id);
      const key = this.keyOf(e);
      if (it && it.key !== key) {
        this.disposeItem(it);
        it = undefined;
      }
      if (!it) {
        it = this.create(e);
        this.items.set(e.id, it);
      }
      const n = it.node;
      n.position.set(e.x, e.y, e.z);
      n.rotation.set(e.rx ?? 0, e.ry ?? 0, e.rz ?? 0);
      if (e.kind === 'coin' || e.kind === 'star') n.rotation.y += performance.now() / 400;
      const sx = e.sx ?? 1;
      const sy = e.sy ?? 1;
      const sz = e.sz ?? 1;
      if (it.base) n.scaling.set(sx / it.base[0], it.kind === 'plane' || it.kind === 'water' ? 1 : sy / it.base[1], sz / it.base[2]);
      else if (e.kind === 'player' || e.kind === 'palm' || e.kind === 'lantern' || e.kind === 'prop' || e.kind === 'boat' || e.kind === 'train') n.scaling.setAll(sx);
      else n.scaling.set(sx, sy, sz);
      if (it.tex && e.kind === 'water') {
        if (e.mat === 'lava') {
          it.tex.uOffset = Math.sin(this.t * 0.05) * 0.4;
          it.tex.vOffset = this.t * 0.02;
        } else {
          it.tex.uOffset = this.t * 0.01;
          it.tex.vOffset = Math.sin(this.t * 0.25) * 0.03 + this.t * 0.006;
        }
      }
      if (it.rig) {
        const r = this.celebrate?.[e.player ?? 0];
        it.rig.setAnim(r === undefined ? (e.anim ?? 'idle') : r === 0 ? 'cheer' : e.anim === 'sad' || e.anim === 'hit' ? e.anim : 'sad');
        it.rig.update(dt);
      }
      n.setEnabled(e.alpha === undefined || e.alpha > 0.02);
      const text = e.label ?? (e.labelKey ? t(e.labelKey) : undefined);
      if (text !== it.labelText) {
        it.label?.dispose();
        it.label = undefined;
        it.labelText = text;
        if (text) {
          it.label = labelPlane(this.stage.scene, `${e.id}_label`, text, { size: 1.6, bg: 'rgba(255,255,255,0.85)', font: text.length > 3 ? 70 : 120 });
          it.label.parent = this.root;
          // white emissive labels would bloom into blobs in the glow layer
          this.stage.glow.addExcludedMesh(it.label);
        }
      }
      if (it.label) it.label.position.set(e.x, e.y + (e.kind === 'player' ? 2.6 : (sy || 1) / 2 + 1.1), e.z);
    }
    for (const [id, it] of this.items) {
      if (!seen.has(id)) {
        this.disposeItem(it);
        this.items.delete(id);
      }
    }
    this.fireFx(view.fx);
    const c = view.camera;
    if (this.followCamera) this.stage.setCamera({ alpha: c.alpha, beta: c.beta, radius: c.radius, target: new Vector3(...c.target) }, this.cameraSpeed);
  }

  /** Fires every effect once when its id appears (ids may repeat after a state reset). */
  private fireFx(list: MgFx[] | undefined) {
    const now = new Set<string>();
    for (const f of list ?? []) {
      now.add(f.id);
      if (this.fxSeen.has(f.id)) continue;
      const at = new Vector3(f.x, f.y, f.z);
      if (f.kind) burst(this.stage, f.kind, at, { color: f.color, scale: f.s });
      if (f.sfx) {
        const { pan, near } = this.screenPan(at);
        this.onSound(f.sfx, pan, near);
      }
      if (f.kind === 'boom') this.stage.shakeCamera(0.25 * (f.s ?? 1));
    }
    this.fxSeen = now;
  }

  /** Stereo position (-1..1) of a world point on screen and a distance gain. */
  private screenPan(p: Vector3): { pan: number; near: number } {
    const cam = this.stage.camera;
    const view = cam.getViewMatrix();
    const v = Vector3.TransformCoordinates(p, view);
    const x = v.z > 0.1 ? v.x / (v.z * Math.tan(cam.fov / 2) * this.stage.engine.getAspectRatio(cam)) : 0;
    const dist = v.length();
    return { pan: Math.max(-1, Math.min(1, x)) * 0.7, near: Math.max(0.45, Math.min(1, 26 / Math.max(1, dist))) };
  }
}
