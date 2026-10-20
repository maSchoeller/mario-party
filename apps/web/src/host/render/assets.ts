import { LoadAssetContainerAsync, Mesh, MeshoptCompression, TransformNode, VertexData, type AssetContainer, type Material, type Matrix } from '@babylonjs/core';
// meshopt decoder shipped with the app (no CDN): the GLBs are meshopt-compressed (scripts/assets/compress.mjs)
import meshoptDecoderUrl from 'meshoptimizer/meshopt_decoder.js?url';
import type { Stage } from './stage';

/**
 * GLB asset library (ASSET-02/03): figures and props built in Blender
 * (scripts/assets/blender/*.py → public/media/models). Meshes are named
 * "<group>__<material>"; the group is a rig part (body/head/armL/armR) or a prop id.
 * Material names map onto the shared flat palette materials of the stage (ART-05):
 *   c_<hex> fixed color · glow_<hex> emissive · tint caller-defined color.
 * Every lookup returns null when a file is missing, so the procedural placeholders
 * remain as fallback.
 */
export const MODEL_FILES = [
  'rocco',
  'quaki',
  'pingo',
  'foxy',
  'bruno',
  'hoppla',
  'schildi',
  'zippy',
  'moderator',
  'props',
  'props_island',
  'props_volcano',
  'props_city',
] as const;
const PROP_FILES = ['props', 'props_island', 'props_volcano', 'props_city'];
const BASE = `${import.meta.env.BASE_URL}media/models/`;

interface Part {
  mesh: Mesh;
  material: string;
}

export class AssetLibrary {
  /** file -> group -> parts (geometry baked into Babylon space, hidden templates) */
  private groups = new Map<string, Map<string, Part[]>>();

  constructor(private readonly stage: Stage) {}

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    MeshoptCompression.Configuration = { decoder: { url: meshoptDecoderUrl } };
    await import('@babylonjs/loaders/glTF/2.0');
    let done = 0;
    await Promise.all(
      MODEL_FILES.map(async (file) => {
        try {
          const c = await LoadAssetContainerAsync(`${BASE}${file}.glb`, this.stage.scene, { pluginExtension: '.glb' });
          this.groups.set(file, this.extract(c));
        } catch (err) {
          console.warn(`model ${file} unavailable – using procedural placeholder`, err);
        }
        onProgress?.(++done, MODEL_FILES.length);
      }),
    );
  }

  private extract(c: AssetContainer): Map<string, Part[]> {
    const out = new Map<string, Part[]>();
    for (const m of c.meshes) {
      if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
      // meshopt-packed files keep the name on the parent node; the mesh hangs below it
      // with an unnamed dequantization transform (baked below via the world matrix)
      let named: { name: string; parent: unknown } | null = m;
      while (named && !named.name.includes('__')) named = named.parent as typeof named;
      if (!named) continue;
      const [group, material] = named.name.split('__');
      if (!group || !material) continue;
      // bake the glTF root conversion (right- to left-handed) into the vertices
      m.computeWorldMatrix(true);
      const vd = VertexData.ExtractFromMesh(m, true, true);
      vd.transform(m.getWorldMatrix());
      // the dequantization scale shrinks the normals: re-normalize them
      if (vd.normals) {
        const n = vd.normals;
        for (let i = 0; i < n.length; i += 3) {
          const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
          n[i] /= l;
          n[i + 1] /= l;
          n[i + 2] /= l;
        }
      }
      const mesh = new Mesh(`tpl_${m.name}`, this.stage.scene);
      vd.applyToMesh(mesh);
      // the glTF handedness flip mirrors the triangles – flip the winding back
      mesh.flipFaces(false);
      mesh.setEnabled(false);
      mesh.isPickable = false;
      const list = out.get(group) ?? [];
      list.push({ mesh, material: material.replace(/\.\d+$/, '') });
      out.set(group, list);
    }
    c.dispose();
    return out;
  }

  has(file: string, group: string): boolean {
    return !!this.groups.get(file)?.get(group)?.length;
  }

  material(name: string, tint?: string): Material {
    if (name === 'tint') return this.stage.mat(tint ?? '#f6efe2');
    const [kind, hex] = name.split('_');
    return this.stage.mat(`#${hex}`, kind === 'glow' ? { emissive: 0.8 } : {});
  }

  /**
   * Clones the meshes of a group under `parent`. `offset` is subtracted from the
   * (rig-space) vertices, i.e. the pivot of the node the part hangs on.
   */
  attach(file: string, group: string, parent: TransformNode, opts: { tint?: string; offset?: { x: number; y: number; z: number } } = {}): Mesh[] {
    const parts = this.groups.get(file)?.get(group);
    if (!parts) return [];
    return parts.map((p) => {
      const m = p.mesh.clone(`${parent.name}_${group}_${p.material}`, parent);
      m.setEnabled(true);
      m.material = this.material(p.material, opts.tint);
      if (opts.offset) m.position.set(-opts.offset.x, -opts.offset.y, -opts.offset.z);
      return m;
    });
  }

  /** File that holds prop `id` (props are split by theme), or null. */
  propFile(id: string): string | null {
    return PROP_FILES.find((f) => this.has(f, id)) ?? null;
  }

  hasProp(id: string): boolean {
    return this.propFile(id) !== null;
  }

  /** A prop from the library as its own node, or null (→ caller uses the fallback). */
  prop(id: string, name: string, parent?: TransformNode, tint?: string): TransformNode | null {
    const file = this.propFile(id);
    if (!file) return null;
    const root = new TransformNode(name, this.stage.scene);
    if (parent) root.parent = parent;
    for (const m of this.attach(file, id, root, { tint })) this.stage.castShadow(m, false);
    return root;
  }

  /**
   * Many copies of a prop as GPU thin instances (one draw call per material part) –
   * vegetation and other scatter. Returns the part meshes, or null if the prop is missing.
   */
  instances(id: string, name: string, parent: TransformNode, matrices: Matrix[], opts: { tint?: string; shadows?: boolean } = {}): Mesh[] | null {
    const file = this.propFile(id);
    if (!file || !matrices.length) return null;
    const buf = new Float32Array(matrices.length * 16);
    matrices.forEach((mt, i) => mt.copyToArray(buf, i * 16));
    return this.groups.get(file)!.get(id)!.map((p) => {
      const m = p.mesh.clone(`${name}_${p.material}`, parent);
      m.setEnabled(true);
      m.material = this.material(p.material, opts.tint);
      m.thinInstanceSetBuffer('matrix', buf, 16, true);
      m.isPickable = false;
      m.thinInstanceRefreshBoundingInfo(false);
      if (opts.shadows !== false) this.stage.castShadow(m, false);
      m.receiveShadows = true;
      return m;
    });
  }
}
