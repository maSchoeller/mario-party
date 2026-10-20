/** Balancing start values (SPEC 5.1) – tweakable via playtest/telemetry. */
export const BALANCE = {
  startCoins: 10,
  diceMax: 10,
  blueCoins: 3,
  redCoins: 3,
  finaleMultiplier: 2,
  finaleRounds: 5,
  starPrice: 20,
  starPriceDiscounted: 10,
  // flatter than the spec's start value (10 for 1st) so minigame skill doesn't decide alone
  minigameFfaRewards: [8, 5, 3, 1] as const,
  minigameTeamReward: 8,
  minigameSoloReward: 12,
  duelStake: 10,
  maxItems: 3,
  trapPenalty: 10,
  stealMin: 5,
  stealMax: 15,
  cableCarPrice: 5,
  ticketPrice: 4,
  trainPenalty: 5,
  boulderPenalty: 5,
  eruptionThreshold: 5,
  /** a 1:3 field-color split becomes a 1v3 game with this chance, otherwise FFA */
  oneVsThreeChance: 0.5,
  tideInterval: 2,
  marathonGames: 10,
  marathonPoints: [4, 2, 1, 0] as const,
  minigameReadyTimeoutSec: 30,
  roomCodeLength: 4,
  nicknameMaxLength: 12,
} as const;

export type RoundCount = 20 | 25 | 30;
export const ROUND_OPTIONS: RoundCount[] = [20, 25, 30];

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow';
export const PLAYER_COLORS: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];
/** Hex values used on TV & phone (ART-07: combined with a shape icon). */
export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  red: '#e8676b',
  blue: '#5f8fe0',
  green: '#5cc08a',
  yellow: '#f0c04a',
};
/** Shape per color so colors are distinguishable without color vision (ART-07, A11Y-01). */
export const PLAYER_SHAPE: Record<PlayerColor, string> = {
  red: '●',
  blue: '▲',
  green: '■',
  yellow: '◆',
};

export type CharacterId = 'rocco' | 'quaki' | 'pingo' | 'foxy';
export const CHARACTERS: CharacterId[] = ['rocco', 'quaki', 'pingo', 'foxy'];
