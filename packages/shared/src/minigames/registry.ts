import type { GameConfig } from '../game/types';
import type { Rng } from '../rng';
import { ALL_MINIGAMES } from './all';
import type { MgFormat, MinigameDef } from './types';

export const MINIGAMES: Record<string, MinigameDef> = Object.fromEntries(ALL_MINIGAMES.map((m) => [m.id, m]));
export const MINIGAME_IDS = ALL_MINIGAMES.map((m) => m.id);

export function getMinigame(id: string): MinigameDef {
  const m = MINIGAMES[id];
  if (!m) throw new Error(`unknown minigame ${id}`);
  return m;
}

/**
 * Picks a random minigame of a format. Avoids recently played games (marathon: no
 * repetition at all, MODE-03), respects the chief's deselection and the motion filter.
 */
export function pickMinigame(
  format: MgFormat,
  rng: Rng,
  history: string[],
  config: Pick<GameConfig, 'disabledMinigames' | 'noMotion'>,
  noRepeat = false,
): string {
  const all = ALL_MINIGAMES.filter((m) => m.format === format && !m.final);
  if (!all.length) throw new Error(`no minigame for format ${format}`);
  const allowed = all.filter((m) => !config.disabledMinigames.includes(m.id) && !(config.noMotion && m.motion));
  const pool = allowed.length ? allowed : all;
  const recentWindow = noRepeat ? history.length : Math.min(history.length, Math.floor(pool.length / 2) + 2);
  const recent = new Set(history.slice(history.length - recentWindow));
  const fresh = pool.filter((m) => !recent.has(m.id));
  return rng.pick(fresh.length ? fresh : pool).id;
}
