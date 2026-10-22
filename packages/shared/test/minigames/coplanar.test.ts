import { describe, expect, it } from 'vitest';
import { ALL_MINIGAMES } from '../../src/minigames/all';
import { makeMgPlayers, runMinigameHeadless } from '../../src/minigames/headless';
import type { MgEntity } from '../../src/minigames/types';

/**
 * No two flat surfaces at exactly the same height (v0.5): coplanar faces z-fight and
 * flicker depending on the camera angle. Checks the upward faces of boxes, cylinders,
 * planes and water in every minigame view over the whole game.
 */
const TOL = 0.003;

interface Top {
  id: string;
  y: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function topOf(e: MgEntity): Top | null {
  if (Math.abs(e.rx ?? 0) > 0.01 || Math.abs(e.rz ?? 0) > 0.01) return null;
  if ((e.alpha ?? 1) <= 0.02) return null;
  const sx = e.sx ?? 1;
  const sy = e.sy ?? 1;
  const sz = e.sz ?? 1;
  let y: number;
  if (e.kind === 'box' || e.kind === 'cylinder') y = e.y + sy / 2;
  else if (e.kind === 'plane' || e.kind === 'water') y = e.y;
  else return null;
  const c = Math.abs(Math.cos(e.ry ?? 0));
  const s = Math.abs(Math.sin(e.ry ?? 0));
  // cylinders are round: the rotation does not widen their footprint
  const hx = e.kind === 'cylinder' ? sx / 2 : (c * sx + s * sz) / 2;
  const hz = e.kind === 'cylinder' ? sz / 2 : (s * sx + c * sz) / 2;
  return { id: e.id, y, x0: e.x - hx, x1: e.x + hx, z0: e.z - hz, z1: e.z + hz };
}

/** Pairs of overlapping upward faces at the same height in one view. */
export function coplanarPairs(entities: MgEntity[]): string[] {
  const tops = entities.map(topOf).filter((t): t is Top => !!t);
  const out: string[] = [];
  for (let a = 0; a < tops.length; a++) {
    for (let b = a + 1; b < tops.length; b++) {
      const A = tops[a];
      const B = tops[b];
      if (Math.abs(A.y - B.y) > TOL) continue;
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      const oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
      if (ox > 0.02 && oz > 0.02) out.push(`${A.id} ↔ ${B.id} @ y ${A.y.toFixed(3)}`);
    }
  }
  return out;
}

describe('minigames: no coplanar surfaces (z-fighting)', () => {
  for (const def of ALL_MINIGAMES) {
    it(def.id, () => {
      const found = new Set<string>();
      let n = 0;
      runMinigameHeadless(def, makeMgPlayers(def.format, undefined, 'medium'), 4242, {
        maxSeconds: def.duration + 40,
        onTick: (s) => {
          if (n++ % 90 !== 0) return;
          for (const p of coplanarPairs(def.view(s as never).entities)) found.add(p);
        },
      });
      expect([...found]).toEqual([]);
    });
  }
});
