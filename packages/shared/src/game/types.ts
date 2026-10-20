import type { BotLevel, CharacterId, PlayerColor, RoundCount } from '../config';
import type { MgFormat } from '../minigames/types';
import type { RngState } from '../rng';
import type { DiceId } from './dice';
import type { ItemId } from './items';

export type GameMode = 'board' | 'marathon';

export interface GameConfig {
  mode: GameMode;
  mapId: string;
  rounds: RoundCount;
  seed: number;
  /** Team assignment for round minigames: by field color (classic) or random (open point 17.7). */
  teamMode: 'fields' | 'random';
  disabledMinigames: string[];
  /** A11Y-02: filter gyro/shake games */
  noMotion: boolean;
}

export interface PlayerStats {
  minigameWins: number;
  coinsEarned: number;
  maxCoins: number;
  fieldsWalked: number;
  redFields: number;
  blueFields: number;
  coinsSpent: number;
  duelWins: number;
  itemsUsed: number;
  starsBought: number;
}

export interface PlayerSetup {
  id: string;
  name: string;
  character: CharacterId;
  color: PlayerColor;
  isBot: boolean;
  botLevel: BotLevel;
}

export interface PlayerState extends PlayerSetup {
  coins: number;
  stars: number;
  items: ItemId[];
  field: string;
  tickets: number;
  starDiscount: boolean;
  /** color of the last field the player stopped on – used for minigame teams */
  lastColor: 'blue' | 'red' | 'neutral';
  stats: PlayerStats;
  /** marathon points */
  points: number;
}

export interface WheelSegment {
  id: 'coins5' | 'coins10' | 'coinsMinus5' | 'item' | 'swapCoins' | 'bonusDuel' | 'starDiscount' | 'coins15' | 'star' | 'stealStar';
}

export type Pending =
  | { kind: 'orderRoll'; player: number }
  /** dice: options for the second die (the first one is always the standard die) */
  | { kind: 'turnMenu'; player: number; canUseItem: boolean; dice: DiceId[] }
  /** Mini-Würfel: the player chooses 1, 2 or 3 steps (precise landing) */
  | { kind: 'miniPick'; player: number; options: number[] }
  | { kind: 'branch'; player: number; options: string[]; backward?: boolean }
  | { kind: 'shop'; player: number; offer: ItemId[] }
  | { kind: 'buyStar'; player: number; price: number }
  | { kind: 'station'; player: number; destinations: string[]; ticketPrice: number; hasTicket: boolean }
  | { kind: 'cablecar'; player: number; price: number; target: string }
  | { kind: 'itemReplace'; player: number; newItem: ItemId }
  | { kind: 'duelPick'; player: number; options: number[]; stake: number }
  | { kind: 'wheel'; player: number; segments: WheelSegment['id'][]; reason: 'lucky' | 'finale' | 'catchup' }
  | {
      kind: 'minigame';
      game: string;
      format: MgFormat;
      /** participating game player indices, team per participant */
      players: number[];
      teams: number[];
      purpose: 'round' | 'duel' | 'marathon';
      stake?: number;
      double?: boolean;
    }
  | { kind: 'gameOver' };

export type Action =
  /** `dice` = choice for the second die (turn menu); ignored for the order roll */
  | { type: 'roll'; dice?: DiceId }
  | { type: 'pickSteps'; steps: number }
  | { type: 'useItem'; item: ItemId }
  | { type: 'branch'; to: string }
  | { type: 'buy'; item: ItemId | null; replace?: number }
  | { type: 'buyStar'; accept: boolean }
  | { type: 'station'; dest: string | null }
  | { type: 'cablecar'; accept: boolean }
  | { type: 'replaceItem'; index: number | null }
  | { type: 'duelPick'; target: number }
  | { type: 'stopWheel' };

export interface TurnState {
  player: number;
  dice: DiceRoll[];
  /** steps left; negative = walking backwards */
  remaining: number;
  rolled: boolean;
  usedItem: ItemId | null;
  glove: boolean;
  starSteal: boolean;
  /** pass trigger already resolved for this field visit */
  passResolved: string | null;
  /** after landing effects are done */
  landed: boolean;
  stepsTaken: number;
  /** after landing the turn may still wait for e.g. a duel */
  afterLanding?: 'duel' | null;
}

export interface DiceRoll {
  dice: DiceId;
  /** face index 0..5 */
  face: number;
  steps: number;
  coins: number;
}

export interface GimmickState {
  tide?: 'high' | 'low';
  eruption?: number;
  lava?: { group: number; until: number } | null;
  lavaNext?: number;
  trainIdx?: number;
}

export interface BonusCategoryResult {
  id: string;
  players: number[];
  value: number;
}

export interface GameState {
  version: 1;
  config: GameConfig;
  rng: RngState;
  players: PlayerState[];
  /** turn order (player indices) */
  order: number[];
  orderRolls: number[];
  round: number;
  /** index into order */
  turnIdx: number;
  stage: 'intro' | 'order' | 'turns' | 'minigame' | 'roundEnd' | 'bonus' | 'over' | 'marathon';
  starField: string;
  traps: { field: string; owner: number }[];
  coinBags: { field: string; amount: number }[];
  gimmick: GimmickState;
  pending: Pending | null;
  turn: TurnState | null;
  minigameHistory: string[];
  marathon?: { games: string[]; idx: number };
  bonus?: BonusCategoryResult[];
  ranking?: number[];
  finaleStarted: boolean;
  catchupDone?: boolean;
}

export type GameEvent =
  | { type: 'announce'; key: string; params?: Record<string, string | number>; player?: number }
  | { type: 'roundStart'; round: number; total: number }
  | { type: 'turnStart'; player: number }
  | { type: 'orderRoll'; player: number; value: number; roll: DiceRoll }
  | { type: 'order'; order: number[] }
  | { type: 'dice'; player: number; rolls: DiceRoll[]; total: number }
  | { type: 'move'; player: number; from: string; to: string; kind: 'walk' | 'back' | 'warp' | 'cannon' | 'wash' | 'ride' | 'cable' }
  | { type: 'land'; player: number; field: string; fieldType: string }
  | { type: 'coins'; player: number; delta: number; reason: string }
  | { type: 'stars'; player: number; delta: number; reason: string }
  | { type: 'item'; player: number; item: ItemId; gained: boolean }
  | { type: 'itemUse'; player: number; item: ItemId }
  | { type: 'starMoved'; from: string; to: string }
  | { type: 'trap'; field: string; owner: number; placed: boolean }
  | { type: 'wheel'; player: number; segments: string[]; result: number }
  | { type: 'tide'; tide: 'high' | 'low' }
  | { type: 'eruptionCounter'; value: number; max: number }
  | { type: 'eruption'; lavaGroup: number; bags: string[]; hits: number[] }
  | { type: 'lava'; group: number; active: boolean }
  | { type: 'train'; route: number; hits: number[] }
  | { type: 'timetable'; next: number[] }
  | { type: 'coinBag'; field: string; amount: number; placed: boolean; player?: number }
  | { type: 'finale' }
  | { type: 'standings'; ranking: number[] }
  | { type: 'minigameResult'; game: string; players: number[]; ranks: number[]; rewards: number[] }
  | { type: 'bonusStar'; category: string; players: number[]; value: number }
  | { type: 'gameOver'; ranking: number[] }
  | { type: 'autosave' };
