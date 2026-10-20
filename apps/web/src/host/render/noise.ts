/** Small deterministic 2D value noise + fBm (terrain, scatter clustering, textures). */
function hash(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function noise2(x: number, z: number, seed = 1): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, seed);
  const b = hash(xi + 1, zi, seed);
  const c = hash(xi, zi + 1, seed);
  const d = hash(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fBm in [0, 1] */
export function fbm(x: number, z: number, octaves = 4, seed = 1): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * f, z * f, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Deterministic PRNG for placement (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

/** Value noise that repeats every `period` units (seamless tiling textures). */
export function pnoise2(x: number, z: number, period: number, seed = 1): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const w = (k: number) => ((k % period) + period) % period;
  const a = hash(w(xi), w(zi), seed);
  const b = hash(w(xi + 1), w(zi), seed);
  const c = hash(w(xi), w(zi + 1), seed);
  const d = hash(w(xi + 1), w(zi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Seamless fBm over a texture: (s, t) in [0,1), base lattice `period` cells across. */
export function tileFbm(s: number, t: number, period: number, octaves = 4, seed = 1): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += pnoise2(s * p, t * p, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}
