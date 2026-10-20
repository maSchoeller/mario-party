import { Mesh, MeshBuilder, PointLight, TransformNode, Vector3, Color3 } from '@babylonjs/core';
import type { MgEntity, MgPlayer, MgView } from '@wb/shared/minigames/types';
import { t } from '@wb/shared/i18n/index';
import { CharacterRig } from './characters';
import { box, coin, cone, cyl, labelPlane, palm, rock, sphere, starMesh } from './props';
import type { Stage } from './stage';

/**
 * Generic renderer for minigame views (MINI-07): minigames only describe entities,
 * this class creates/updates/disposes meshes diffed by entity id.
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

interface Item {
  node: TransformNode;
  kind: string;
  key: string;
  rig?: CharacterRig;
  label?: Mesh;
  labelText?: string;
  light?: PointLight;
}

export class MinigameView {
  readonly root: TransformNode;
  private items = new Map<string, Item>();
  private ground: Mesh | null = null;
  private env: MgView['env'] | null = null;
  private hemiBackup: number | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly players: MgPlayer[],
  ) {
    this.root = new TransformNode('minigame', stage.scene);
  }

  dispose(): void {
    for (const it of this.items.values()) this.disposeItem(it);
    this.items.clear();
    this.ground?.dispose(false, false);
    this.root.dispose(false, false);
    this.restoreLight();
  }

  private setEnv(env: MgView['env']) {
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

  private create(e: MgEntity): Item {
    const s = this.stage;
    const color = e.color ?? '#d9d6ea';
    const key = `${e.kind}|${e.color ?? ''}|${e.player ?? ''}|${e.glow ? 1 : 0}|${e.alpha !== undefined && e.alpha < 1 ? 'a' : ''}`;
    let node: TransformNode;
    let rig: CharacterRig | undefined;
    let light: PointLight | undefined;
    const mat = (c: string) => s.mat(c, { emissive: e.glow ? 0.8 : 0, alpha: e.alpha !== undefined && e.alpha < 1 ? 0.55 : 1 });
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
        node = cyl(s, e.id, { d: 1, h: 1, tess: 12 }, color);
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
        const m = MeshBuilder.CreateTorus(e.id, { diameter: 1, thickness: 0.2, tessellation: 16 }, s.scene);
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
        break;
      case 'coconut':
        node = sphere(s, e.id, 0.7, e.color ?? '#6b4a2b', 3);
        break;
      case 'palm':
        node = palm(s, e.id);
        break;
      case 'balloon': {
        node = new TransformNode(e.id, s.scene);
        const b = sphere(s, `${e.id}_b`, 1, color, 6, node);
        b.scaling.y = 1.15;
        b.material = mat(color);
        const str = cyl(s, `${e.id}_s`, { d: 0.03, h: 1, tess: 3 }, '#ffffff', node);
        str.position.y = -1.05;
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
        const body = sphere(s, `${e.id}_l`, 0.5, '#ffe08a', 4, node);
        body.material = s.mat('#ffe08a', { emissive: 1 });
        light = new PointLight(`${e.id}_light`, Vector3.Zero(), s.scene);
        light.diffuse = new Color3(1, 0.88, 0.55);
        light.intensity = 1.6;
        light.range = 9;
        light.parent = node;
        break;
      }
      default:
        node = box(s, e.id, 1, 1, 1, '#ff00ff');
    }
    node.parent = this.root;
    if (e.kind !== 'plane') for (const m of [node, ...node.getChildMeshes()]) if (m instanceof Mesh) s.castShadow(m, false);
    return { node, kind: e.kind, key, rig, light };
  }

  private disposeItem(it: Item) {
    it.label?.dispose();
    it.light?.dispose();
    if (it.rig) it.rig.dispose();
    else it.node.dispose(false, false);
  }

  render(view: MgView, dt: number): void {
    this.setEnv(view.env);
    const seen = new Set<string>();
    for (const e of view.entities) {
      seen.add(e.id);
      let it = this.items.get(e.id);
      const key = `${e.kind}|${e.color ?? ''}|${e.player ?? ''}|${e.glow ? 1 : 0}|${e.alpha !== undefined && e.alpha < 1 ? 'a' : ''}`;
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
      if (e.kind === 'player' || e.kind === 'palm' || e.kind === 'lantern') n.scaling.setAll(sx);
      else n.scaling.set(sx, sy, sz);
      if (it.rig) {
        it.rig.setAnim(e.anim ?? 'idle');
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
    const c = view.camera;
    this.stage.setCamera({ alpha: c.alpha, beta: c.beta, radius: c.radius, target: new Vector3(...c.target) }, 3);
  }
}
