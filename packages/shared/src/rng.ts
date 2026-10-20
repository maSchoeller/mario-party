/**
 * Seeded, serializable PRNG (mulberry32). The whole game randomness flows through
 * an Rng whose state lives inside the serializable game state (TECH-04).
 */
export interface RngState {
  s: number;
}

export class Rng {
  constructor(public state: RngState) {}

  static fromSeed(seed: number): Rng {
    return new Rng({ s: seed >>> 0 });
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state.s = (this.state.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Gaussian-ish noise (sum of uniforms), mean 0, roughly unit std. */
  noise(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
