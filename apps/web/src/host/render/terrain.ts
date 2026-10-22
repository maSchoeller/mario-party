import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode, VertexData, type Scene } from '@babylonjs/core';
import type { MapDef, TerrainDef } from '@wb/shared/maps/index';
import { cellDiagonal, GROUNDS, TERRAIN_RES, TerrainModel, type Ground, type TerrainEdge } from '@wb/shared/maps/terrainModel';
import { fbm, noise2, smoothstep, tileFbm } from './noise';
import type { Stage } from './stage';

/**
 * Landscape around the field graph (v0.3): the height field of the shared TerrainModel
 * (land blobs, bays, hills, volcano, river/lava channels, paths and tile pads flattened
 * in) drawn as a faceted low-poly mesh with per-face vertex colors on top of a tiling
 * detail texture. Water (or lava) is a separate animated plane whose level follows the
 * tide; lava streams get a flowing ribbon of their own.
 */
export type { Ground };

/** Sea floor plane far below the deepest terrain (never coplanar with its flat bottom). */
const SEA_FLOOR = -7.6;
/** Lava ribbon above its groove. */
const FLOW_LIFT = 0.07;

export class Terrain {
  readonly model: TerrainModel;
  readonly water: Mesh;
  private mesh: Mesh;
  private flows: Mesh[] = [];
  private flowTex: Texture | null = null;
  private waterTarget: number;
  private waterTex: Texture | null = null;
  private t = 0;

  constructor(
    private readonly stage: Stage,
    readonly map: MapDef,
    parent: TransformNode,
  ) {
    this.model = new TerrainModel(map);
    this.mesh = this.buildMesh(parent);
    this.waterTarget = this.def.water.high;
    this.water = this.buildWater(parent);
    this.buildLavaFlows(parent);
  }

  get def(): TerrainDef {
    return this.model.def;
  }

  get fieldY(): Map<string, number> {
    return this.model.fieldY;
  }

  get edges(): TerrainEdge[] {
    return this.model.edges;
  }

  // ------------------------------------------------------------------ queries

  natural(x: number, z: number): { y: number; L: number } {
    return this.model.natural(x, z);
  }

  /** Height of the terrain mesh (the plane of the triangle under x/z). */
  height(x: number, z: number): number {
    return this.model.height(x, z);
  }

  ground(x: number, z: number): Ground {
    return this.model.ground(x, z);
  }

  /** Distance to the nearest path edge (for keeping scatter off the paths), capped. */
  clearance(x: number, z: number): number {
    return this.model.clearance(x, z);
  }

  get bounds() {
    return this.model.bounds;
  }

  // ------------------------------------------------------------------ mesh

  private buildMesh(parent: TransformNode): Mesh {
    const d = this.def;
    const M = this.model;
    const C = {
      grass: Color3.FromHexString(d.colors.grass),
      grass2: Color3.FromHexString(d.colors.grass2),
      sand: Color3.FromHexString(d.colors.sand),
      rock: Color3.FromHexString(d.colors.rock),
      path: Color3.FromHexString(d.colors.path),
      seabed: Color3.FromHexString(d.colors.seabed),
    };
    const tmp = new Color3();
    const nx = M.nx;
    const nz = M.nz;
    const H = M.h;
    const X = (k: number) => M.minX + (k % nx) * TERRAIN_RES;
    const Z = (k: number) => M.minZ + Math.floor(k / nx) * TERRAIN_RES;
    // colors per grid vertex (smooth transitions) – lighting stays faceted
    const n = nx * nz;
    let vc = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const x = X(k);
      const z = Z(k);
      const cy = H[k];
      const n1 = fbm(x * 0.09, z * 0.09, 3, 21);
      switch (GROUNDS[M.cls[k]]) {
        case 'grass':
          Color3.LerpToRef(C.grass, C.grass2, smoothstep(0.35, 0.7, n1), tmp);
          // hills get a little darker
          tmp.scaleToRef(1 - Math.max(0, cy - d.base) * 0.03, tmp);
          break;
        case 'path':
          Color3.LerpToRef(C.path, C.grass, 0.35 + n1 * 0.25, tmp);
          break;
        case 'sand':
          tmp.copyFrom(C.sand);
          if (cy < d.water.high + 0.15) tmp.scaleToRef(0.86, tmp); // wet sand
          break;
        case 'rock':
          Color3.LerpToRef(C.rock, C.grass, 0.15 * n1, tmp);
          break;
        default: {
          // under water / river bed: sand fading into the deep sea bed
          const depth = d.water.high - cy;
          Color3.LerpToRef(C.sand, C.seabed, smoothstep(0.1, 2.6, depth), tmp);
        }
      }
      vc[k * 3] = tmp.r;
      vc[k * 3 + 1] = tmp.g;
      vc[k * 3 + 2] = tmp.b;
    }
    // two blur passes soften the class borders (the grid is 0.5 m fine)
    for (let pass = 0; pass < 2; pass++) {
      const blur = new Float32Array(vc);
      for (let j = 1; j < nz - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          for (let c = 0; c < 3; c++) blur[k * 3 + c] = (vc[k * 3 + c] * 4 + vc[(k - 1) * 3 + c] + vc[(k + 1) * 3 + c] + vc[(k - nx) * 3 + c] + vc[(k + nx) * 3 + c]) / 8;
        }
      }
      vc = blur;
    }
    // flat-shaded: 3 own vertices per triangle, written straight into typed arrays
    const tris = (nx - 1) * (nz - 1) * 2;
    const pos = new Float32Array(tris * 9);
    const nrm = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 12);
    const uv = new Float32Array(tris * 6);
    const idx = new Uint32Array(tris * 3);
    let v = 0;
    const emit = (k: number, fx: number, fy: number, fz: number, jitter: number) => {
      const x = X(k);
      const z = Z(k);
      pos[v * 3] = x;
      pos[v * 3 + 1] = H[k];
      pos[v * 3 + 2] = z;
      nrm[v * 3] = fx;
      nrm[v * 3 + 1] = fy;
      nrm[v * 3 + 2] = fz;
      col[v * 4] = vc[k * 3] * jitter;
      col[v * 4 + 1] = vc[k * 3 + 1] * jitter;
      col[v * 4 + 2] = vc[k * 3 + 2] * jitter;
      col[v * 4 + 3] = 1;
      uv[v * 2] = x / 7;
      uv[v * 2 + 1] = z / 7;
      idx[v] = v;
      v++;
    };
    const tri = (a: number, b: number, c: number) => {
      const ax = X(a);
      const az = Z(a);
      const ux = X(b) - ax;
      const uz = Z(b) - az;
      const wx = X(c) - ax;
      const wz = Z(c) - az;
      // Babylon culls clockwise faces: order the corners so the triangle faces up
      if (ux * wz - uz * wx < 0) [b, c] = [c, b];
      // face normal from the (possibly swapped) edges a→b and a→c, always pointing up
      const uy = H[b] - H[a];
      const wy = H[c] - H[a];
      const bx = X(b) - ax;
      const bz = Z(b) - az;
      const cx = X(c) - ax;
      const cz = Z(c) - az;
      let fx = uy * cz - bz * wy;
      let fy = bz * cx - bx * cz;
      let fz = bx * wy - uy * cx;
      const l = Math.hypot(fx, fy, fz) || 1;
      const sgn = fy < 0 ? -1 : 1;
      fx = (fx / l) * sgn;
      fy = (fy / l) * sgn;
      fz = (fz / l) * sgn;
      // a whisper of per-face variation keeps the low-poly sparkle
      const jitter = 0.985 + noise2((ax + bx / 3 + cx / 3) * 0.9, (az + bz / 3 + cz / 3) * 0.9, 33) * 0.03;
      emit(a, fx, fy, fz, jitter);
      emit(b, fx, fy, fz, jitter);
      emit(c, fx, fy, fz, jitter);
    };
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k00 = j * nx + i;
        const k10 = k00 + 1;
        const k01 = k00 + nx;
        const k11 = k01 + 1;
        // same split as TerrainModel.height() samples
        if (cellDiagonal(i, j) === 0) {
          tri(k00, k01, k11);
          tri(k00, k11, k10);
        } else {
          tri(k00, k01, k10);
          tri(k10, k01, k11);
        }
      }
    }
    const m = new Mesh('terrain', this.stage.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.colors = col;
    vd.uvs = uv;
    vd.applyToMesh(m);
    m.parent = parent;
    const mat = new StandardMaterial('terrainMat', this.stage.scene);
    mat.diffuseTexture = detailTexture(this.stage.scene, this.map.theme);
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    mat.ambientColor = new Color3(0.35, 0.35, 0.35);
    m.material = mat;
    m.receiveShadows = true;
    m.isPickable = false;
    m.freezeWorldMatrix();
    mat.freeze();
    return m;
  }

  private buildWater(parent: TransformNode): Mesh {
    const s = this.stage;
    const d = this.def;
    const b = this.bounds;
    const w = MeshBuilder.CreateGround('water', { width: 900, height: 900, subdivisions: 1 }, s.scene);
    w.position.set((b.minX + b.maxX) / 2, d.water.high, (b.minZ + b.maxZ) / 2);
    w.parent = parent;
    w.isPickable = false;
    const mat = new StandardMaterial('waterMat', s.scene);
    if (d.water.kind === 'lava') {
      const tex = lavaTexture(s.scene);
      tex.uScale = tex.vScale = 900 / 34;
      mat.emissiveTexture = tex;
      mat.diffuseColor = new Color3(0.12, 0.04, 0.03);
      mat.specularColor = Color3.Black();
      this.waterTex = tex;
    } else {
      mat.diffuseColor = Color3.FromHexString(this.map.palette.water);
      mat.alpha = 0.72;
      mat.specularColor = new Color3(0.55, 0.6, 0.65);
      mat.specularPower = 96;
      const bump = waterNormals(s.scene);
      bump.uScale = bump.vScale = 900 / 5;
      bump.level = 0.22;
      mat.bumpTexture = bump;
      this.waterTex = bump;
      mat.backFaceCulling = false;
    }
    w.material = mat;
    w.receiveShadows = true;
    // dark floor far below so the horizon never shows the void
    const floor = MeshBuilder.CreateGround('seaFloor', { width: 900, height: 900 }, s.scene);
    floor.position.set(w.position.x, SEA_FLOOR, w.position.z);
    floor.parent = parent;
    // same look as the deep terrain so the edge of the height field disappears
    const fm = new StandardMaterial('seaFloorMat', s.scene);
    fm.diffuseColor = Color3.FromHexString(d.water.kind === 'lava' ? '#3a1a10' : this.def.colors.seabed).scale(0.93);
    fm.specularColor = new Color3(0.04, 0.04, 0.04);
    fm.ambientColor = new Color3(0.35, 0.35, 0.35);
    floor.material = fm;
    floor.receiveShadows = true;
    floor.isPickable = false;
    return w;
  }

  /**
   * Lava streams: a glowing ribbon lining their groove from the crater down to where it
   * pours into the lava sea (the flat plane takes over there).
   */
  private buildLavaFlows(parent: TransformNode) {
    const lavaLevel = this.def.water.high;
    for (const [ci, ch] of (this.def.channels ?? []).entries()) {
      if (ch.kind !== 'lava') continue;
      const pos: number[] = [];
      const uvs: number[] = [];
      const ind: number[] = [];
      const hw = ch.width / 2 - 0.25;
      const ACROSS = 7;
      let arc = 0;
      let open = false;
      let prev: [number, number] | null = null;
      const pts = ch.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / len;
        const dz = (bz - az) / len;
        for (let dd = 0; dd < len; dd += 0.4) {
          const cx = ax + dx * dd;
          const cz = az + dz * dd;
          if (prev) arc += Math.hypot(cx - prev[0], cz - prev[1]);
          prev = [cx, cz];
          const active = this.height(cx, cz) > lavaLevel + 0.06;
          // one row past the last active one lets the ribbon dive under the lava sea
          if (!active && !open) continue;
          const row = pos.length / 3;
          for (let a = 0; a < ACROSS; a++) {
            const o = -hw + (2 * hw * a) / (ACROSS - 1);
            const x = cx - dz * o;
            const z = cz + dx * o;
            pos.push(x, this.height(x, z) + FLOW_LIFT, z);
            uvs.push(a / (ACROSS - 1), arc / 3);
          }
          if (open) {
            const r0 = row - ACROSS;
            for (let a = 0; a < ACROSS - 1; a++) ind.push(r0 + a, row + a, r0 + a + 1, r0 + a + 1, row + a, row + a + 1);
          }
          open = active;
        }
      }
      if (!ind.length) continue;
      // Babylon culls clockwise faces: orient every triangle upwards
      for (let t = 0; t < ind.length; t += 3) {
        const [a, b, c] = [ind[t] * 3, ind[t + 1] * 3, ind[t + 2] * 3];
        const cross = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]);
        if (cross < 0) [ind[t + 1], ind[t + 2]] = [ind[t + 2], ind[t + 1]];
      }
      const m = new Mesh(`lavaFlow${ci}`, this.stage.scene);
      const nrm: number[] = [];
      VertexData.ComputeNormals(pos, ind, nrm);
      const vd = new VertexData();
      Object.assign(vd, { positions: pos, indices: ind, uvs, normals: nrm });
      vd.applyToMesh(m);
      m.parent = parent;
      m.isPickable = false;
      if (!this.flowTex) {
        this.flowTex = copyTexture(this.stage.scene, lavaTexture(this.stage.scene, true), 'lavaFlowTex');
        this.flowTex.uScale = 0.6;
        this.flowTex.vScale = 0.6;
      }
      const mat = new StandardMaterial(`lavaFlowMat${ci}`, this.stage.scene);
      mat.emissiveTexture = this.flowTex;
      mat.diffuseColor = new Color3(0.12, 0.04, 0.03);
      mat.specularColor = Color3.Black();
      m.material = mat;
      m.freezeWorldMatrix();
      this.flows.push(m);
    }
  }

  // ------------------------------------------------------------------ runtime

  setWaterLevel(y: number, instant = false): void {
    this.waterTarget = y;
    if (instant) this.water.position.y = y;
  }

  update(dt: number): void {
    this.t += dt;
    const w = this.water;
    w.position.y += (this.waterTarget - w.position.y) * Math.min(1, dt * 0.9);
    if (this.waterTex) {
      if (this.def.water.kind === 'lava') {
        this.waterTex.uOffset = Math.sin(this.t * 0.05) * 0.4;
        this.waterTex.vOffset = this.t * 0.012;
      } else {
        this.waterTex.uOffset = this.t * 0.006;
        this.waterTex.vOffset = Math.sin(this.t * 0.2) * 0.02 + this.t * 0.004;
      }
    }
    // the stream flows downhill (v grows along the channel)
    if (this.flowTex) this.flowTex.vOffset = -this.t * 0.05;
  }

  dispose(): void {
    this.mesh.dispose(false, true);
    for (const f of this.flows) f.dispose(false, true);
  }
}

// ------------------------------------------------------------------ procedural textures

const texCache = new WeakMap<Scene, Map<string, Texture>>();
export function cached(scene: Scene, key: string, make: () => Texture): Texture {
  let m = texCache.get(scene);
  if (!m) texCache.set(scene, (m = new Map()));
  let t = m.get(key);
  if (!t || t.getScene() !== scene) m.set(key, (t = make()));
  return t;
}

/**
 * Independent copy of a cached procedural texture (own offsets for animation). A plain
 * clone() of a DynamicTexture comes out empty, so the canvas is copied over.
 */
export function copyTexture(scene: Scene, src: Texture, name: string): Texture {
  const s = src as DynamicTexture;
  const size = s.getSize();
  const tex = new DynamicTexture(name, { width: size.width, height: size.height }, scene, true);
  (tex.getContext() as unknown as CanvasRenderingContext2D).drawImage(s.getContext().canvas as CanvasImageSource, 0, 0);
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.hasAlpha = src.hasAlpha;
  return tex;
}

/** Light grain multiplied over the vertex colors (grass blades / sand grains / pebbles). */
export function detailTexture(scene: Scene, theme: string): Texture {
  return cached(scene, `detail_${theme}`, () => {
    const S = 256;
    const tex = new DynamicTexture(`detail_${theme}`, { width: S, height: S }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = tileFbm(x / S, y / S, 6, 4, 7);
        const g = tileFbm(x / S, y / S, 64, 1, 3);
        const v = 0.86 + n * 0.12 + (g > 0.82 ? 0.06 : g < 0.12 ? -0.07 : 0);
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, v * 255);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update();
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    return tex;
  });
}

export function waterNormals(scene: Scene): Texture {
  return cached(scene, 'waterN', () => {
    const S = 128;
    const tex = new DynamicTexture('waterN', { width: S, height: S }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(S, S);
    const hgt = (x: number, y: number) => tileFbm((((x % S) + S) % S) / S, (((y % S) + S) % S) / S, 6, 3, 41);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = hgt(x + 1, y) - hgt(x - 1, y);
        const dy = hgt(x, y + 1) - hgt(x, y - 1);
        const nx = -dx * 6;
        const ny = -dy * 6;
        const l = Math.hypot(nx, ny, 1);
        const o = (y * S + x) * 4;
        img.data[o] = ((nx / l) * 0.5 + 0.5) * 255;
        img.data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        img.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update();
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  });
}

/** Lava: cooled crust plates with glowing seams; `molten` (minigames) has far more open, glowing lava. */
export function lavaTexture(scene: Scene, molten = false): Texture {
  return cached(scene, molten ? 'lavaMolten' : 'lava', () => {
    const S = 256;
    const tex = new DynamicTexture(molten ? 'lavaMolten' : 'lava', { width: S, height: S }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = tileFbm(x / S, y / S, 4, 4, 13);
        const fine = tileFbm(x / S, y / S, 16, 2, 29);
        // mostly cooled crust plates; glowing seams between them and a few molten pools
        const pool = molten ? 1 - smoothstep(0.44, 0.52, n) : 1 - smoothstep(0.3, 0.38, n);
        const seam = 1 - smoothstep(0.0, molten ? 0.06 : 0.03, Math.abs(n - (molten ? 0.6 : 0.52) - (fine - 0.5) * 0.12));
        const glow = Math.min(1, pool + seam * 0.9);
        const crust = 0.75 + fine * 0.5;
        const o = (y * S + x) * 4;
        img.data[o] = 62 * crust + (255 - 62 * crust) * glow;
        img.data[o + 1] = 26 * crust + (150 - 26 * crust) * glow * (0.75 + 0.25 * pool);
        img.data[o + 2] = 22 * crust + (40 - 22 * crust) * glow;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update();
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  });
}
