import type { BonusCategoryResult, PlayerState, PlayerStats } from './types';

/** Bonus star pool (CHAOS-02). Three are drawn at random at the end of a board game. */
export const BONUS_CATEGORIES = ['minigameAce', 'coinMagnet', 'wanderer', 'unlucky', 'shopaholic', 'duelChamp'] as const;
export type BonusCategory = (typeof BONUS_CATEGORIES)[number];

const STAT: Record<BonusCategory, keyof PlayerStats> = {
  minigameAce: 'minigameWins',
  coinMagnet: 'maxCoins',
  wanderer: 'fieldsWalked',
  unlucky: 'redFields',
  shopaholic: 'coinsSpent',
  duelChamp: 'duelWins',
};

/** All players sharing the top value get a star; nobody gets one if the top value is 0. */
export function computeBonus(cat: BonusCategory, players: PlayerState[]): BonusCategoryResult {
  const key = STAT[cat];
  const values = players.map((p) => p.stats[key]);
  const max = Math.max(...values);
  const winners = max > 0 ? values.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0) : [];
  return { id: cat, players: winners, value: max };
}
