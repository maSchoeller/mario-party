import { BALANCE } from '../config';

export type ItemId =
  | 'doubleDice'
  | 'tripleDice'
  | 'miniDice'
  | 'warpShell'
  | 'stealGlove'
  | 'trapStone'
  | 'shield'
  | 'starTicket';

export interface ItemDef {
  id: ItemId;
  price: number;
  /** Item can be actively used before rolling (ITEM-01). Shield is passive. */
  usable: boolean;
  /** Only obtainable in shops (rare). */
  shopOnly?: boolean;
  /** Relative weight when found on item/lucky fields. */
  findWeight: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  doubleDice: { id: 'doubleDice', price: 5, usable: true, findWeight: 5 },
  tripleDice: { id: 'tripleDice', price: 10, usable: true, findWeight: 2 },
  miniDice: { id: 'miniDice', price: 3, usable: true, findWeight: 4 },
  warpShell: { id: 'warpShell', price: 8, usable: true, findWeight: 3 },
  stealGlove: { id: 'stealGlove', price: 7, usable: true, findWeight: 3 },
  trapStone: { id: 'trapStone', price: 6, usable: true, findWeight: 3 },
  shield: { id: 'shield', price: 5, usable: false, findWeight: 3 },
  starTicket: { id: 'starTicket', price: 30, usable: true, shopOnly: true, findWeight: 0 },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** Shop assortment: everything; star ticket appears only sometimes (rare). */
export const SHOP_ITEMS: ItemId[] = ITEM_IDS;

export function maxItems(): number {
  return BALANCE.maxItems;
}
