import { Color3, DynamicTexture, Mesh, StandardMaterial, Texture, VertexBuffer, type Scene } from '@babylonjs/core';
import type { MgSurface } from '@wb/shared/minigames/types';
import { prng, smoothstep, tileFbm } from './noise';
import type { Stage } from './stage';
import { cached, lavaTexture } from './terrain';

/**
 * Surfaces for minigame primitives (v0.4): tiling grayscale detail textures (wood grain,
 * planks, cobbles, ice cracks …) multiplied over the palette color, world-space UVs so the
 * pattern keeps its scale on long boxes, and a soft vertical shading in the vertex colors
 * (the same "baked AO" look the Blender props have).
 */

/** Texture size in world units (one repeat). */
const REPEAT: Record<MgSurface, number> = {
  wood: 2,
  planks: 2.4,
  stone: 3,
  tiles: 2,
  metal: 2,
  ice: 4,
  snow: 3,
  sand: 3,
  grass: 3,
  cloth: 1.2,
  rope: 0.8,
  lava: 8,
  paper: 2,
  gold: 2,
  basalt: 3,
};

const SPEC: Partial<Record<MgSurface, [number, number]>> = {
  metal: [0.45, 48],
  gold: [0.7, 64],
  ice: [0.6, 96],
  tiles: [0.12, 32],
  planks: [0.05, 16],
};

const S = 256;

function paint(scene: Scene, key: string, fn: (u: number, v: number, x: number, y: number) => number): Texture {
  return cached(scene, `surf_${key}`, () => {
    const tex = new DynamicTexture(`surf_${key}`, { width: S, height: S }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = Math.max(0, Math.min(1, fn(x / S, y / S, x, y)));
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255;
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

/** Grayscale detail texture (≈ 0.65–1.0) for a surface. */
export function surfaceTexture(scene: Scene, surface: MgSurface): Texture {
  switch (surface) {
    case 'wood':
      return paint(scene, surface, (u, v) => {
        const warp = tileFbm(u, v, 3, 3, 5) * 0.35;
        const grain = 0.5 + 0.5 * Math.sin((u * 18 + warp * 6) * Math.PI * 2);
        return 0.8 + grain * 0.12 + tileFbm(u, v, 24, 2, 9) * 0.08;
      });
    case 'planks': {
      // 4 boards across u, staggered butt joints along v
      const rnd = prng(17);
      const offs = Array.from({ length: 4 }, () => rnd());
      const tones = Array.from({ length: 8 }, () => 0.88 + rnd() * 0.12);
      return paint(scene, surface, (u, v) => {
        const b = Math.floor(u * 4);
        const fu = u * 4 - b;
        const vv = (v + offs[b]) % 1;
        const seg = vv < 0.5 ? 0 : 1;
        const fv = (vv * 2) % 1;
        const gap = Math.min(fu, 1 - fu) < 0.035 || Math.min(fv, 1 - fv) < 0.012;
        const warp = tileFbm(u, v, 4, 2, 31) * 0.4;
        const grain = 0.5 + 0.5 * Math.sin((fu * 7 + warp * 3 + b) * Math.PI * 2);
        const nail = (Math.hypot(fu - 0.5, (fv < 0.5 ? fv - 0.06 : fv - 0.94) * 2) < 0.06 ? -0.25 : 0);
        return gap ? 0.5 : tones[b * 2 + seg] * (0.88 + grain * 0.1) + nail;
      });
    }
    case 'stone':
    case 'basalt':
      return paint(scene, surface, (u, v) => {
        // cobbles: jittered cells, dark mortar between them
        const n = 5;
        let d1 = 9;
        let d2 = 9;
        let id = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const cx = Math.floor(u * n) + i;
            const cy = Math.floor(v * n) + j;
            const r = prng(((cx + n) % n) * 31 + ((cy + n) % n) * 977 + (surface === 'basalt' ? 5 : 1));
            const px = (cx + 0.2 + r() * 0.6) / n;
            const py = (cy + 0.2 + r() * 0.6) / n;
            const d = Math.hypot(u - px, v - py);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              id = r();
            } else if (d < d2) d2 = d;
          }
        }
        const edge = smoothstep(0.004, 0.022, d2 - d1);
        const base = surface === 'basalt' ? 0.72 : 0.84;
        return (base + id * 0.14 + tileFbm(u, v, 16, 2, 3) * 0.08) * (0.62 + edge * 0.38);
      });
    case 'tiles':
      return paint(scene, surface, (u, v) => {
        const n = 4;
        const fu = (u * n) % 1;
        const fv = (v * n) % 1;
        const grout = Math.min(fu, 1 - fu, fv, 1 - fv) < 0.03;
        const r = prng(Math.floor(u * n) * 7 + Math.floor(v * n) * 131)();
        return grout ? 0.8 : 0.9 + r * 0.08 + tileFbm(u, v, 32, 1, 4) * 0.04;
      });
    case 'metal':
    case 'gold':
      return paint(scene, surface, (u, v) => 0.86 + tileFbm(u * 0.05, v, 64, 2, 8) * 0.12 + tileFbm(u, v, 4, 2, 2) * 0.05);
    case 'ice':
      return paint(scene, surface, (u, v) => {
        const n = tileFbm(u, v, 4, 4, 23);
        const crack = 1 - smoothstep(0, 0.012, Math.abs(n - 0.5));
        const crack2 = 1 - smoothstep(0, 0.008, Math.abs(tileFbm(u, v, 8, 3, 61) - 0.5));
        return 0.88 + tileFbm(u, v, 16, 2, 7) * 0.08 + crack * 0.14 + crack2 * 0.07;
      });
    case 'snow':
      return paint(scene, surface, (u, v, x, y) => 0.9 + tileFbm(u, v, 8, 3, 12) * 0.08 + (prng(x * 997 + y)() > 0.985 ? 0.12 : 0));
    case 'sand':
      return paint(scene, surface, (u, v, x, y) => {
        const ripple = 0.5 + 0.5 * Math.sin((v * 10 + tileFbm(u, v, 3, 2, 4) * 2.5) * Math.PI * 2);
        return 0.86 + ripple * 0.06 + (prng(x * 131 + y * 7)() - 0.5) * 0.08;
      });
    case 'grass':
      return paint(scene, surface, (u, v, x, y) => {
        const blade = prng(x * 53 + y * 17)();
        return 0.84 + tileFbm(u, v, 6, 3, 14) * 0.12 + (blade > 0.9 ? 0.08 : blade < 0.08 ? -0.08 : 0);
      });
    case 'cloth':
      return paint(scene, surface, (u, v) => {
        const a = 0.5 + 0.5 * Math.sin(u * 48 * Math.PI * 2);
        const b = 0.5 + 0.5 * Math.sin(v * 48 * Math.PI * 2);
        return 0.85 + (Math.floor(u * 48) + Math.floor(v * 48)) % 2 * 0.04 + a * b * 0.06;
      });
    case 'rope':
      return paint(scene, surface, (u, v) => 0.78 + (0.5 + 0.5 * Math.sin((u + v) * 6 * Math.PI * 2)) * 0.2);
    case 'paper':
      return paint(scene, surface, (u, v) => 0.94 + tileFbm(u, v, 32, 3, 19) * 0.06);
    case 'lava':
      return lavaTexture(scene);
  }
}

/** Material for a palette color + surface (cached by the stage key). */
export function surfaceMat(stage: Stage, hex: string, surface: MgSurface, opts: { emissive?: number; alpha?: number } = {}): StandardMaterial {
  const scene = stage.scene;
  const key = `surfm_${hex}|${surface}|${opts.emissive ?? 0}|${opts.alpha ?? 1}`;
  let m = scene.getMaterialByName(key) as StandardMaterial | null;
  if (m) return m;
  m = new StandardMaterial(key, scene);
  const c = Color3.FromHexString(hex);
  if (surface === 'lava') {
    m.emissiveTexture = surfaceTexture(scene, 'lava');
    m.diffuseColor = new Color3(0.12, 0.04, 0.03);
    m.specularColor = Color3.Black();
  } else {
    m.diffuseTexture = surfaceTexture(scene, surface);
    m.diffuseColor = c;
    m.ambientColor = c.scale(0.3);
    const [spec, pow] = SPEC[surface] ?? [0.05, 16];
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = pow;
    if (opts.emissive) m.emissiveColor = c.scale(opts.emissive);
  }
  if (surface === 'ice' && opts.alpha === undefined) m.alpha = 0.92;
  if (opts.alpha !== undefined && opts.alpha < 1) m.alpha = opts.alpha;
  return m;
}

/**
 * Rewrites the UVs of a (flat shaded) mesh to world-space planar projection along the
 * dominant axis of each face normal, and bakes a vertical shading into the vertex colors.
 */
export function worldUvs(mesh: Mesh, surface: MgSurface, shade = true): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nrm) return;
  const rep = REPEAT[surface];
  const n = pos.length / 3;
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 4);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  const h = Math.max(0.001, maxY - minY);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const [ax, ay, az] = [Math.abs(nrm[i * 3]), Math.abs(nrm[i * 3 + 1]), Math.abs(nrm[i * 3 + 2])];
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) [u, v] = [x, z];
    else if (ax >= az) [u, v] = [z, y];
    else [u, v] = [x, y];
    uv[i * 2] = u / rep;
    uv[i * 2 + 1] = v / rep;
    // darker towards the bottom, top faces a touch brighter
    const k = shade ? 0.74 + 0.26 * smoothstep(0, 1, (y - minY) / Math.min(h, 2.5)) + (nrm[i * 3 + 1] > 0.7 ? 0.04 : 0) : 1;
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = Math.min(1, k);
    col[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
  mesh.setVerticesData(VertexBuffer.ColorKind, col);
  mesh.useVertexColors = true;
}
