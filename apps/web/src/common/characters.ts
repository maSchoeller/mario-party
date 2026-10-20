import type { CharacterId } from '@wb/shared/config';

/** Lightweight character icons for the phone UI (no 3D on the phone). */
export const CHAR_EMOJI: Record<CharacterId, string> = {
  rocco: '🦝',
  quaki: '🐸',
  pingo: '🐧',
  foxy: '🦊',
};

export const ITEM_EMOJI: Record<string, string> = {
  doubleDice: '🎲',
  tripleDice: '🔥',
  miniDice: '🎯',
  warpShell: '🐚',
  stealGlove: '🧤',
  trapStone: '🪨',
  shield: '☂️',
  starTicket: '🎫',
};

export const WHEEL_EMOJI: Record<string, string> = {
  coins5: '🪙',
  coins10: '💰',
  coins15: '💎',
  coinsMinus5: '💸',
  item: '🎁',
  swapCoins: '🔄',
  bonusDuel: '⚔️',
  starDiscount: '🏷️',
  star: '⭐',
  stealStar: '🦹',
};
