import type { CharacterId } from '../config';

/**
 * Dice (v0.3): every turn a player rolls two six-sided dice – the standard die plus a
 * second die of their choice (standard again, their character die or a dice item). All
 * dice are balanced to the same expectation (≈ 3.5 steps, coins count ≈ 0.4 steps) but
 * spread very differently: safe, all-or-nothing, risky with negative faces, coin faces.
 */
export type DiceId =
  | 'standard'
  | CharacterId
  /** dice items (one use, bought in the shop or found) */
  | 'riskDice'
  | 'goldDice';

export interface DiceFace {
  /** steps, may be negative (walk backwards) */
  steps: number;
  /** coins paid out right after the roll */
  coins?: number;
}

export interface DiceDef {
  id: DiceId;
  kind: 'standard' | 'character' | 'item';
  faces: [DiceFace, DiceFace, DiceFace, DiceFace, DiceFace, DiceFace];
  /** body + pip/number color of the 3D die */
  color: string;
  ink: string;
}

const f = (...faces: (number | [number, number])[]): DiceDef['faces'] =>
  faces.map((x) => (Array.isArray(x) ? { steps: x[0], coins: x[1] } : { steps: x })) as DiceDef['faces'];

export const DICE: Record<DiceId, DiceDef> = {
  standard: { id: 'standard', kind: 'standard', faces: f(1, 2, 3, 4, 5, 6), color: '#fbf7ee', ink: '#3d3a55' },
  // characters (name keys: dice.<id>.name / .desc)
  rocco: { id: 'rocco', kind: 'character', faces: f([1, 2], [2, 2], [3, 2], 3, 4, [5, 1]), color: '#a3a1b0', ink: '#ffffff' },
  quaki: { id: 'quaki', kind: 'character', faces: f([0, 2], 2, 3, 4, 5, 6), color: '#7cc56f', ink: '#ffffff' },
  pingo: { id: 'pingo', kind: 'character', faces: f(1, 1, 4, 4, 5, 6), color: '#2f3552', ink: '#ffffff' },
  foxy: { id: 'foxy', kind: 'character', faces: f(-1, 2, 4, 4, 5, 7), color: '#f0a050', ink: '#ffffff' },
  bruno: { id: 'bruno', kind: 'character', faces: f(0, 0, 5, 5, 5, 6), color: '#9a6440', ink: '#ffffff' },
  hoppla: { id: 'hoppla', kind: 'character', faces: f(1, 1, 1, 6, 6, 6), color: '#dcc39b', ink: '#3d3a55' },
  schildi: { id: 'schildi', kind: 'character', faces: f(3, 3, 3, 4, 4, 4), color: '#8fb85a', ink: '#ffffff' },
  zippy: { id: 'zippy', kind: 'character', faces: f([0, 4], [1, 3], 3, 4, 5, 5), color: '#c8643b', ink: '#ffffff' },
  // items
  riskDice: { id: 'riskDice', kind: 'item', faces: f(-2, -1, 3, 6, 7, 8), color: '#3d3a55', ink: '#ff7a7a' },
  goldDice: { id: 'goldDice', kind: 'item', faces: f([1, 4], [2, 3], [3, 4], [1, 4], [2, 3], [3, 4]), color: '#f2c94c', ink: '#7a5a12' },
};

/** Value of one coin in steps (bot simulations: coins are worth a bit less than half a step). */
export const COIN_STEP_VALUE = 0.4;

export function expectedValue(d: DiceDef): number {
  return d.faces.reduce((s, x) => s + x.steps + (x.coins ?? 0) * COIN_STEP_VALUE, 0) / 6;
}

/** Distribution of the summed steps of several dice: steps -> probability. */
export function stepDistribution(ids: DiceId[]): Map<number, number> {
  let dist = new Map<number, number>([[0, 1]]);
  for (const id of ids) {
    const next = new Map<number, number>();
    for (const [s, p] of dist) for (const face of DICE[id].faces) next.set(s + face.steps, (next.get(s + face.steps) ?? 0) + p / 6);
    dist = next;
  }
  return dist;
}

/** Short face label for UIs: "5", "-2", "1+2●". */
export function faceLabel(face: DiceFace): string {
  return face.coins ? `${face.steps}+${face.coins}●` : String(face.steps);
}
