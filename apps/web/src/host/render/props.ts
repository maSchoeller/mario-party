import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, VertexData, type Scene } from '@babylonjs/core';
import type { Stage } from './stage';

/**
 * Procedurally built low-poly props (placeholder assets in the stylized low-poly look,
 * ART-04). Every mesh is flat shaded and uses palette colors from the stage cache.
 */
export function flat<T extends Mesh>(m: T): T {
  m.convertToFlatShadedMesh();
  return m;
}

export function box(stage: Stage, name: string, w: number, h: number, d: number, color: string, parent?: TransformNode): Mesh {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, stage.scene);
  m.material = stage.mat(color);
  if (parent) m.parent = parent;
  return m;
}

export function sphere(stage: Stage, name: string, d: number, color: string, segments = 4, parent?: TransformNode): Mesh {
  const m = flat(MeshBuilder.CreateSphere(name, { diameter: d, segments }, stage.scene));
  m.material = stage.mat(color);
  if (parent) m.parent = parent;
  return m;
}

export function cyl(
  stage: Stage,
  name: string,
  opts: { top?: number; bottom?: number; d?: number; h: number; tess?: number },
  color: string,
  parent?: TransformNode,
): Mesh {
  const m = flat(
    MeshBuilder.CreateCylinder(
      name,
      {
        height: opts.h,
        diameterTop: opts.top ?? opts.d ?? 1,
        diameterBottom: opts.bottom ?? opts.d ?? 1,
        tessellation: opts.tess ?? 8,
      },
      stage.scene,
    ),
  );
  m.material = stage.mat(color);
  if (parent) m.parent = parent;
  return m;
}

export function cone(stage: Stage, name: string, d: number, h: number, color: string, tess = 6, parent?: TransformNode): Mesh {
  const m = cyl(stage, name, { top: 0, bottom: d, h, tess }, color, parent);
  return m;
}

/** Five pointed star (extruded), centered, facing -z. */
export function starMesh(stage: Stage, name: string, size: number, color: string, parent?: TransformNode): Mesh {
  const outer = size / 2;
  const inner = outer * 0.45;
  const depth = size * 0.28;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  // front/back center
  positions.push(0, 0, -depth / 2, 0, 0, depth / 2);
  for (const [x, y] of pts) positions.push(x, y, -depth * 0.12, x, y, depth * 0.12);
  for (let i = 0; i < 10; i++) {
    const a = 2 + i * 2;
    const b = 2 + ((i + 1) % 10) * 2;
    indices.push(0, b, a); // front
    indices.push(1, a + 1, b + 1); // back
    indices.push(a, b, b + 1, a, b + 1, a + 1); // side
  }
  const m = new Mesh(name, stage.scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(m);
  flat(m);
  m.material = stage.mat(color, { emissive: 0.35 });
  if (parent) m.parent = parent;
  return m;
}

export function coin(stage: Stage, name: string, d = 0.8, parent?: TransformNode): Mesh {
  const m = cyl(stage, name, { d, h: d * 0.18, tess: 10 }, '#f2c94c', parent);
  m.material = stage.mat('#f2c94c', { emissive: 0.25 });
  m.rotation.x = Math.PI / 2;
  return m;
}

export function palm(stage: Stage, name: string, parent?: TransformNode, scale = 1): TransformNode {
  const root = new TransformNode(name, stage.scene);
  if (parent) root.parent = parent;
  root.scaling.setAll(scale);
  let y = 0;
  let x = 0;
  for (let i = 0; i < 5; i++) {
    const seg = cyl(stage, `${name}_t${i}`, { top: 0.32 - i * 0.03, bottom: 0.38 - i * 0.03, h: 0.95, tess: 6 }, i % 2 ? '#a0703f' : '#b07d48', root);
    seg.position.set(x, y + 0.45, 0);
    seg.rotation.z = -0.06 * i;
    y += 0.9;
    x += 0.06 * i;
  }
  for (let i = 0; i < 6; i++) {
    const pivot = new TransformNode(`${name}_p${i}`, stage.scene);
    pivot.parent = root;
    pivot.position.set(x, y + 0.1, 0);
    pivot.rotation.y = (i / 6) * Math.PI * 2;
    pivot.rotation.z = -0.4;
    const leaf = box(stage, `${name}_l${i}`, 2.4, 0.08, 0.7, i % 2 ? '#7cbf6b' : '#8fcf78', pivot);
    leaf.position.x = 1.15;
  }
  sphere(stage, `${name}_c`, 0.45, '#6b4a2b', 3, root).position.set(x, y - 0.15, 0.2);
  for (const c of root.getChildMeshes()) stage.castShadow(c, false);
  return root;
}

export function rock(stage: Stage, name: string, size = 1, color = '#a7a5b3', parent?: TransformNode): Mesh {
  const m = flat(MeshBuilder.CreateIcoSphere(name, { radius: size / 2, subdivisions: 1 }, stage.scene));
  m.scaling.y = 0.7;
  m.material = stage.mat(color);
  if (parent) m.parent = parent;
  stage.castShadow(m, false);
  return m;
}

export function hut(stage: Stage, name: string, roof: string, parent?: TransformNode): TransformNode {
  const root = new TransformNode(name, stage.scene);
  if (parent) root.parent = parent;
  const body = box(stage, `${name}_b`, 3, 2, 2.6, '#f6efe2', root);
  body.position.y = 1;
  const r = cone(stage, `${name}_r`, 4.6, 1.8, roof, 4, root);
  r.position.y = 2.9;
  r.rotation.y = Math.PI / 4;
  const door = box(stage, `${name}_d`, 0.7, 1.1, 0.1, '#8a5a3c', root);
  door.position.set(0, 0.55, -1.31);
  for (const c of root.getChildMeshes()) stage.castShadow(c, false);
  return root;
}

export function tree(stage: Stage, name: string, parent?: TransformNode): TransformNode {
  const root = new TransformNode(name, stage.scene);
  if (parent) root.parent = parent;
  cyl(stage, `${name}_t`, { d: 0.4, h: 1.2, tess: 5 }, '#8a5a3c', root).position.y = 0.6;
  const c1 = cone(stage, `${name}_c1`, 2.4, 2, '#6fae6a', 7, root);
  c1.position.y = 2;
  const c2 = cone(stage, `${name}_c2`, 1.8, 1.6, '#82c27a', 7, root);
  c2.position.y = 3;
  for (const c of root.getChildMeshes()) stage.castShadow(c, false);
  return root;
}

/** Text/emoji billboard drawn into a dynamic texture (labels for 3 m readability). */
export function labelPlane(scene: Scene, name: string, text: string, opts: { size?: number; color?: string; bg?: string; font?: number } = {}): Mesh {
  const size = opts.size ?? 1;
  const tex = new DynamicTexture(`${name}_tex`, { width: 256, height: 256 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 256);
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? '#3d3a55';
  ctx.font = `900 ${opts.font ?? 150}px Nunito, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 138);
  tex.update();
  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane(name, { size }, scene);
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.onDisposeObservable.add(() => {
    mat.dispose();
    tex.dispose();
  });
  return plane;
}

export function disposeNode(node: TransformNode | Mesh | null | undefined): void {
  if (!node) return;
  // materials are shared via the stage cache – never dispose them here
  node.dispose(false, false);
}
