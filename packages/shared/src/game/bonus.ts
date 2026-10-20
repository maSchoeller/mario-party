import type { BonusCategoryResult, PlayerState, PlayerStats } from './types';

/** Bonus star pool (CHAOS-02). Three are drawn at random at the end of a board game. */
export const BONUS_CATEGORIES = ['minigameAce', 'coinMagnet', 'wanderer', 'unlucky', 'shopaholic', 'duelChamp', 'itemFan'] as const;
export type BonusCategory = (typeof BONUS_CATEGORIES)[number];
/** Categories that tend to favour trailing players; one of them is always drawn. */
export const COMEBACK_CATEGORIES: BonusCategory[] = ['unlucky', 'wanderer', 'itemFan'];

const STAT: Record<BonusCategory, keyof PlayerStats> = {
  minigameAce: 'minigameWins',
  coinMagnet: 'maxCoins',
  wanderer: 'fieldsWalked',
  unlucky: 'redFields',
  shopaholic: 'coinsSpent',
  duelChamp: 'duelWins',
  itemFan: 'itemsUsed',
};

/** All players sharing the top value get a star; nobody gets one if the top value is 0. */
export function computeBonus(cat: BonusCategory, players: PlayerState[]): BonusCategoryResult {
  const key = STAT[cat];
  const values = players.map((p) => p.stats[key]);
  const max = Math.max(...values);
  const winners = max > 0 ? values.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0) : [];
  return { id: cat, players: winners, value: max };
}
