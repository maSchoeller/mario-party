import { LoadAssetContainerAsync, Mesh, TransformNode, VertexData, type AssetContainer, type Material } from '@babylonjs/core';
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
export const MODEL_FILES = ['rocco', 'quaki', 'pingo', 'foxy', 'moderator', 'props'] as const;
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
      const [group, material] = m.name.split('__');
      if (!group || !material) continue;
      // bake the glTF root conversion (right- to left-handed) into the vertices
      m.computeWorldMatrix(true);
      const vd = VertexData.ExtractFromMesh(m, true, true);
      vd.transform(m.getWorldMatrix());
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

  /** A prop from the library as its own node, or null (→ caller uses the fallback). */
  prop(id: string, name: string, parent?: TransformNode, tint?: string): TransformNode | null {
    if (!this.has('props', id)) return null;
    const root = new TransformNode(name, this.stage.scene);
    if (parent) root.parent = parent;
    for (const m of this.attach('props', id, root, { tint })) this.stage.castShadow(m, false);
    return root;
  }
}
