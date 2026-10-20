import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode, VertexData, type Scene } from '@babylonjs/core';
import type { FieldDef, MapDef, TerrainDef } from '@wb/shared/maps/index';
import { distToSegment, fbm, noise2, smoothstep, tileFbm } from './noise';
import type { Stage } from './stage';

/**
 * Landscape around the field graph (v0.3): a height field built from the map's terrain
 * description (land blobs, bays, hills, river/lava channels). Paths are flattened into
 * it, channels carved out, and the result is drawn as a faceted low-poly mesh with
 * per-face vertex colors on top of a tiling detail texture. Water (or lava) is a
 * separate animated plane whose level follows the tide.
 */
export type Ground = 'grass' | 'sand' | 'rock' | 'water' | 'path' | 'channel';

interface Edge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ya: number;
  yb: number;
  kind: 'normal' | 'bridge' | 'pier' | 'shallow';
}

const RES = 1.0;
/** clearance values beyond this are irrelevant (scatter / buildings only care about the near range) */
const CLEAR_CAP = 6;

export class Terrain {
  readonly fieldY = new Map<string, number>();
  readonly edges: Edge[] = [];
  readonly def: TerrainDef;
  readonly water: Mesh;
  private mesh: Mesh;
  private minX: number;
  private minZ: number;
  private nx: number;
  private nz: number;
  private h: Float32Array;
  private cls: Uint8Array;
  /** distance to the nearest path edge per grid vertex (capped), for fast scatter queries */
  private clear: Float32Array;
  private waterTarget: number;
  private waterTex: Texture | null = null;
  private t = 0;

  constructor(
    private readonly stage: Stage,
    readonly map: MapDef,
    parent: TransformNode,
  ) {
    this.def = map.terrain;
    const xs = map.fields.map((f) => f.x).concat((map.decor ?? []).map((d) => d.x));
    const zs = map.fields.map((f) => f.z).concat((map.decor ?? []).map((d) => d.z));
    const M = 22;
    this.minX = Math.floor(Math.min(...xs) - M);
    this.minZ = Math.floor(Math.min(...zs) - M);
    this.nx = Math.ceil((Math.max(...xs) + M - this.minX) / RES) + 1;
    this.nz = Math.ceil((Math.max(...zs) + M - this.minZ) / RES) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.cls = new Uint8Array(this.nx * this.nz);
    this.clear = new Float32Array(this.nx * this.nz);
    this.layoutFields();
    this.buildHeights();
    this.mesh = this.buildMesh(parent);
    this.waterTarget = this.def.water.high;
    this.water = this.buildWater(parent);
  }

  // ------------------------------------------------------------------ height model

  /** Signed land value in world units: > 0 on land, < 0 in the sea. */
  private land(x: number, z: number): number {
    const d = this.def;
    let L = -Infinity;
    for (const b of d.land) L = smax(L, ellipse(x, z, b), 4);
    for (const c of d.cuts ?? []) L = smin(L, -ellipse(x, z, c), 3);
    // ragged coastline
    return L + (fbm(x * 0.07, z * 0.07, 3, 11) - 0.5) * 5;
  }

  /** Natural height (land + hills), before paths and channels. */
  natural(x: number, z: number): { y: number; L: number } {
    const d = this.def;
    const L = this.land(x, z);
    const wl = d.water.low ?? d.water.high;
    let y: number;
    if (L < 0) {
      y = wl - 0.2 + Math.max(-6, L * 0.45);
      for (const s of d.shallows ?? []) y = Math.max(y, y + (s.y - y) * smoothstep(0, 3, ellipse(x, z, s)));
    } else y = d.water.high - 0.25 + (d.base - d.water.high + 0.25) * smoothstep(0, 4.5, L);
    const inland = smoothstep(1, 6, L);
    y += (fbm(x * 0.05, z * 0.05, 4, 3) - 0.5) * 0.9 * inland;
    for (const hl of d.hills ?? []) {
      const rz = hl.rz ?? hl.r;
      const q = ((x - hl.x) / hl.r) ** 2 + ((z - hl.z) / rz) ** 2;
      y += hl.h * Math.exp(-q * 1.6) * (hl.h > 0 ? inland : 1);
    }
    return { y, L };
  }

  private channelDist(x: number, z: number): { d: number; w: number; kind: 'water' | 'lava' } | null {
    let best: { d: number; w: number; kind: 'water' | 'lava' } | null = null;
    let meander: number | null = null;
    for (const c of this.def.channels ?? []) {
      const reach = c.width / 2 + 3;
      for (let i = 0; i < c.points.length - 1; i++) {
        const [ax, az] = c.points[i];
        const [bx, bz] = c.points[i + 1];
        if (x < Math.min(ax, bx) - reach || x > Math.max(ax, bx) + reach || z < Math.min(az, bz) - reach || z > Math.max(az, bz) + reach) continue;
        // meander the banks a little (one noise lookup per point)
        meander ??= (noise2(x * 0.18, z * 0.18, 5) - 0.5) * 1.0;
        const dd = distToSegment(x, z, ax, az, bx, bz).d + meander;
        if (!best || dd - c.width / 2 < best.d - best.w / 2) best = { d: dd, w: c.width, kind: c.kind };
      }
    }
    return best;
  }

  private layoutFields() {
    const d = this.def;
    for (const f of this.map.fields) {
      const nat = this.natural(f.x, f.z).y;
      this.fieldY.set(f.id, f.y ?? Math.max(nat, d.water.high + 0.4));
    }
    const has = (f: FieldDef, t: string) => !!f.tags?.includes(t);
    const idx = new Map(this.map.fields.map((f) => [f.id, f]));
    for (const f of this.map.fields) {
      for (const n of f.next) {
        const g = idx.get(n)!;
        let kind: Edge['kind'] = 'normal';
        if (has(f, 'pier') || has(g, 'pier')) kind = 'pier';
        else if (has(f, 'bridge') || has(g, 'bridge')) kind = 'bridge';
        else if (has(f, 'sandbank') || has(g, 'sandbank') || has(f, 'ford') || has(g, 'ford')) kind = 'shallow';
        this.edges.push({ ax: f.x, az: f.z, bx: g.x, bz: g.z, ya: this.fieldY.get(f.id)!, yb: this.fieldY.get(g.id)!, kind });
      }
    }
  }

  private buildHeights() {
    const d = this.def;
    const tilted = this.map.fields.filter((f) => !f.tags?.some((t) => t === 'pier' || t === 'bridge'));
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.minX + i * RES;
        const z = this.minZ + j * RES;
        const nat = this.natural(x, z);
        let y = nat.y;
        let cls: Ground = 'grass';
        // 1) paths and tiles are flattened into the land
        let w = 0;
        let target = y;
        let nearest = CLEAR_CAP;
        for (const e of this.edges) {
          // cheap bounding-box reject before the exact distance
          if (x < Math.min(e.ax, e.bx) - CLEAR_CAP || x > Math.max(e.ax, e.bx) + CLEAR_CAP || z < Math.min(e.az, e.bz) - CLEAR_CAP || z > Math.max(e.az, e.bz) + CLEAR_CAP) continue;
          const s = distToSegment(x, z, e.ax, e.az, e.bx, e.bz);
          if (s.d < nearest) nearest = s.d;
          if (e.kind === 'pier' || e.kind === 'shallow') continue;
          const k = smoothstep(3.4, 1.3, s.d);
          if (k > w) {
            w = k;
            target = e.ya + (e.yb - e.ya) * s.t - 0.18;
          }
        }
        this.clear[j * this.nx + i] = nearest;
        for (const f of tilted) {
          if (Math.abs(x - f.x) > 2.6 || Math.abs(z - f.z) > 2.6) continue;
          const k = smoothstep(2.6, 1.5, Math.hypot(x - f.x, z - f.z));
          if (k > w) {
            w = k;
            target = this.fieldY.get(f.id)! - 0.18;
          }
        }
        if (w > 0) {
          y = y + (target - y) * w;
          if (w > 0.55) cls = 'path';
        }
        // 2) channels (river / lava) are carved below the water
        const ch = this.channelDist(x, z);
        if (ch) {
          const half = ch.w / 2;
          const bed = (ch.kind === 'lava' ? d.water.high : (d.water.low ?? d.water.high)) - 0.7;
          const k = smoothstep(half + 2.1, half - 0.4, ch.d);
          if (k > 0) {
            y = y + (Math.min(y, bed) - y) * k;
            if (k > 0.5) cls = 'channel';
          }
        }
        // 3) sandbank / ford bars rise from the water just below their fields
        for (const e of this.edges) {
          if (e.kind !== 'shallow' || nearest > 2.4) continue;
          const s = distToSegment(x, z, e.ax, e.az, e.bx, e.bz);
          const k = smoothstep(2.4, 1.0, s.d);
          if (k > 0) {
            const bar = Math.min(e.ya, e.yb) - 0.16 + (noise2(x * 0.8, z * 0.8, 9) - 0.5) * 0.1;
            if (y < bar || cls === 'channel') y = y + (bar - y) * k;
            if (k > 0.5) cls = 'sand';
          }
        }
        if (cls === 'grass') cls = this.classify(x, z, y, nat.L);
        this.h[j * this.nx + i] = y;
        this.cls[j * this.nx + i] = GROUND_ID[cls];
      }
    }
    // slope based rock after the heights exist
    for (let j = 1; j < this.nz - 1; j++) {
      for (let i = 1; i < this.nx - 1; i++) {
        const k = j * this.nx + i;
        if (this.cls[k] !== GROUND_ID.grass) continue;
        const gx = (this.h[k + 1] - this.h[k - 1]) / (2 * RES);
        const gz = (this.h[k + this.nx] - this.h[k - this.nx]) / (2 * RES);
        if (Math.hypot(gx, gz) > 0.75) this.cls[k] = GROUND_ID.rock;
      }
    }
  }

  private classify(x: number, z: number, y: number, L: number): Ground {
    const d = this.def;
    if (y < d.water.high - 0.02) return 'water';
    if (L < (d.beach ?? 3.2) + (noise2(x * 0.2, z * 0.2, 4) - 0.5) * 2 && y < d.base + 0.5) return 'sand';
    return 'grass';
  }

  // ------------------------------------------------------------------ queries

  /** Bilinear height of the built terrain. */
  height(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.minX) / RES));
    const fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.minZ) / RES));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * this.nx + i;
    const a = this.h[k];
    const b = this.h[k + 1];
    const c = this.h[k + this.nx];
    const e = this.h[k + this.nx + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }

  ground(x: number, z: number): Ground {
    const i = Math.round((x - this.minX) / RES);
    const j = Math.round((z - this.minZ) / RES);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 'water';
    return GROUNDS[this.cls[j * this.nx + i]];
  }

  /** Distance to the nearest path edge (for keeping scatter off the paths), capped at CLEAR_CAP. */
  clearance(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.minX) / RES));
    const fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.minZ) / RES));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * this.nx + i;
    const c = this.clear;
    // bilinear interpolation underestimates near the path, which is the safe side
    return c[k] * (1 - u) * (1 - v) + c[k + 1] * u * (1 - v) + c[k + this.nx] * (1 - u) * v + c[k + this.nx + 1] * u * v;
  }

  get bounds() {
    return { minX: this.minX, minZ: this.minZ, maxX: this.minX + (this.nx - 1) * RES, maxZ: this.minZ + (this.nz - 1) * RES };
  }

  // ------------------------------------------------------------------ mesh

  private buildMesh(parent: TransformNode): Mesh {
    const d = this.def;
    const C = {
      grass: Color3.FromHexString(d.colors.grass),
      grass2: Color3.FromHexString(d.colors.grass2),
      sand: Color3.FromHexString(d.colors.sand),
      rock: Color3.FromHexString(d.colors.rock),
      path: Color3.FromHexString(d.colors.path),
      seabed: Color3.FromHexString(d.colors.seabed),
    };
    const tmp = new Color3();
    const nx = this.nx;
    // colors per grid vertex (smooth transitions) – lighting stays faceted
    const n = nx * this.nz;
    let vc = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const x = this.minX + (k % nx) * RES;
      const z = this.minZ + Math.floor(k / nx) * RES;
      const cy = this.h[k];
      const n1 = fbm(x * 0.09, z * 0.09, 3, 21);
      switch (GROUNDS[this.cls[k]]) {
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
    // one blur pass softens the class borders
    const blur = new Float32Array(vc);
    for (let j = 1; j < this.nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        for (let c = 0; c < 3; c++) blur[k * 3 + c] = (vc[k * 3 + c] * 4 + vc[(k - 1) * 3 + c] + vc[(k + 1) * 3 + c] + vc[(k - nx) * 3 + c] + vc[(k + nx) * 3 + c]) / 8;
      }
    }
    vc = blur;
    // flat-shaded: 3 own vertices per triangle, written straight into typed arrays
    const tris = (nx - 1) * (this.nz - 1) * 2;
    const pos = new Float32Array(tris * 9);
    const nrm = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 12);
    const uv = new Float32Array(tris * 6);
    const idx = new Uint32Array(tris * 3);
    let v = 0;
    const emit = (k: number, fx: number, fy: number, fz: number, jitter: number) => {
      const x = this.minX + (k % nx) * RES;
      const z = this.minZ + Math.floor(k / nx) * RES;
      pos[v * 3] = x;
      pos[v * 3 + 1] = this.h[k];
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
      const ax = this.minX + (a % nx) * RES;
      const az = this.minZ + Math.floor(a / nx) * RES;
      const ux = this.minX + (b % nx) * RES - ax;
      const uz = this.minZ + Math.floor(b / nx) * RES - az;
      const wx = this.minX + (c % nx) * RES - ax;
      const wz = this.minZ + Math.floor(c / nx) * RES - az;
      // Babylon culls clockwise faces: order the corners so the triangle faces up
      if (ux * wz - uz * wx < 0) [b, c] = [c, b];
      // face normal from the (possibly swapped) edges a→b and a→c, always pointing up
      const uy = this.h[b] - this.h[a];
      const wy = this.h[c] - this.h[a];
      const bx = this.minX + (b % nx) * RES - ax;
      const bz = this.minZ + Math.floor(b / nx) * RES - az;
      const cx = this.minX + (c % nx) * RES - ax;
      const cz = this.minZ + Math.floor(c / nx) * RES - az;
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
    for (let j = 0; j < this.nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k00 = j * nx + i;
        const k10 = k00 + 1;
        const k01 = k00 + nx;
        const k11 = k01 + 1;
        if ((i + j) % 2 === 0) {
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
    floor.position.set(w.position.x, -7, w.position.z);
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
  }

  dispose(): void {
    this.mesh.dispose(false, true);
  }
}

const GROUNDS: Ground[] = ['grass', 'sand', 'rock', 'water', 'path', 'channel'];
const GROUND_ID = Object.fromEntries(GROUNDS.map((g, i) => [g, i])) as Record<Ground, number>;

function ellipse(x: number, z: number, e: { x: number; z: number; rx: number; rz: number; rot?: number }): number {
  let dx = x - e.x;
  let dz = z - e.z;
  if (e.rot) {
    const c = Math.cos(e.rot);
    const s = Math.sin(e.rot);
    [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
  }
  const q = Math.hypot(dx / e.rx, dz / e.rz);
  return (1 - q) * Math.min(e.rx, e.rz);
}

function smax(a: number, b: number, k: number): number {
  if (!Number.isFinite(a)) return b;
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
}

function smin(a: number, b: number, k: number): number {
  return -smax(-a, -b, k);
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
