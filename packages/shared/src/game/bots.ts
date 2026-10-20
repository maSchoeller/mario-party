import { BALANCE, type BotLevel } from '../config';
import { PASS_FIELDS } from '../maps/types';
import type { Rng } from '../rng';
import type { GameEngine } from './engine';
import { ITEMS, type ItemId } from './items';
import type { Action, Pending } from './types';

/**
 * Board bot (BOT-04): plausible decisions – walk towards the star, use dice items when
 * they help, buy useful items, pick rich duel opponents. Easy bots make more random
 * choices.
 */

/** Steps (0/1-weighted BFS, pass fields cost nothing) from `from` to `to` over open fields. */
export function distance(e: GameEngine, from: string, to: string): number {
  if (from === to) return 0;
  const dist = new Map<string, number>([[from, 0]]);
  const deque: string[] = [from];
  while (deque.length) {
    const cur = deque.shift()!;
    const d = dist.get(cur)!;
    for (const n of e.openNext(cur)) {
      const cost = PASS_FIELDS.includes(e.field(n).type) || n === e.state.starField ? 0 : 1;
      const nd = d + cost;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        if (cost === 0) deque.unshift(n);
        else deque.push(n);
      }
    }
  }
  return dist.get(to) ?? 999;
}

const ITEM_VALUE: Record<ItemId, number> = {
  tripleDice: 9,
  starTicket: 10,
  doubleDice: 7,
  stealGlove: 6,
  shield: 5,
  warpShell: 5,
  trapStone: 3,
  miniDice: 4,
};

function sloppy(level: BotLevel, rng: Rng): boolean {
  return rng.chance(level === 'easy' ? 0.4 : level === 'medium' ? 0.12 : 0);
}

export function botAction(e: GameEngine, p: Pending, rng: Rng): Action {
  if (p.kind === 'minigame' || p.kind === 'gameOver') throw new Error('not a player decision');
  const me = e.player(p.player);
  const level = me.botLevel;
  switch (p.kind) {
    case 'orderRoll':
      return { type: 'roll' };
    case 'turnMenu': {
      if (p.canUseItem) {
        const item = chooseItem(e, p.player, level, rng);
        if (item) return { type: 'useItem', item };
      }
      return { type: 'roll' };
    }
    case 'branch': {
      if (sloppy(level, rng)) return { type: 'branch', to: rng.pick(p.options) };
      const scored = p.options.map((o) => ({ o, d: distance(e, o, e.state.starField) }));
      scored.sort((a, b) => a.d - b.d);
      return { type: 'branch', to: scored[0].o };
    }
    case 'shop': {
      const reserve = me.coins >= e.starPrice(p.player) + 5 ? e.starPrice(p.player) : 4;
      const affordable = p.offer
        .filter((it) => ITEMS[it].price <= me.coins - (level === 'easy' ? 0 : reserve) || (it === 'starTicket' && me.coins >= 40))
        .filter((it) => ITEMS[it].price <= me.coins)
        .sort((a, b) => ITEM_VALUE[b] - ITEM_VALUE[a]);
      const pick = affordable[0];
      if (!pick || (level !== 'hard' && rng.chance(0.25))) return { type: 'buy', item: null };
      if (me.items.length >= BALANCE.maxItems) {
        const worst = worstItemIndex(me.items);
        if (ITEM_VALUE[me.items[worst]] >= ITEM_VALUE[pick]) return { type: 'buy', item: null };
        return { type: 'buy', item: pick, replace: worst };
      }
      return { type: 'buy', item: pick };
    }
    case 'buyStar':
      return { type: 'buyStar', accept: true };
    case 'station': {
      const here = distance(e, me.field, e.state.starField);
      const best = p.destinations
        .map((d) => ({ d, dist: distance(e, d, e.state.starField) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (best && best.dist + 3 < here && (p.hasTicket || me.coins >= p.ticketPrice + 10)) return { type: 'station', dest: best.d };
      return { type: 'station', dest: null };
    }
    case 'cablecar': {
      const here = distance(e, me.field, e.state.starField);
      const there = distance(e, p.target, e.state.starField);
      const accept = there + 4 < here && me.coins - p.price >= (level === 'easy' ? 0 : e.starPrice(p.player));
      return { type: 'cablecar', accept: accept || (level === 'easy' && rng.chance(0.3)) };
    }
    case 'itemReplace': {
      const worst = worstItemIndex(me.items);
      return { type: 'replaceItem', index: ITEM_VALUE[p.newItem] > ITEM_VALUE[me.items[worst]] ? worst : null };
    }
    case 'duelPick': {
      if (sloppy(level, rng)) return { type: 'duelPick', target: rng.pick(p.options) };
      const richest = [...p.options].sort((a, b) => e.player(b).coins - e.player(a).coins)[0];
      return { type: 'duelPick', target: richest };
    }
    case 'wheel':
      return { type: 'stopWheel' };
  }
}

function worstItemIndex(items: ItemId[]): number {
  let w = 0;
  items.forEach((it, i) => {
    if (ITEM_VALUE[it] < ITEM_VALUE[items[w]]) w = i;
  });
  return w;
}

function chooseItem(e: GameEngine, i: number, level: BotLevel, rng: Rng): ItemId | null {
  const me = e.player(i);
  const usable = me.items.filter((it) => ITEMS[it].usable);
  if (!usable.length) return null;
  if (level === 'easy') return rng.chance(0.35) ? rng.pick(usable) : null;
  const toStar = distance(e, me.field, e.state.starField);
  const canAfford = me.coins >= e.starPrice(i);
  const has = (it: ItemId) => usable.includes(it);
  const others = e.all().filter((o) => o !== i);
  const ahead = (pred: (o: number) => boolean) =>
    others.some((o) => pred(o) && distance(e, me.field, e.player(o).field) <= 9);
  if (has('starTicket') && ahead((o) => e.player(o).stars > 0)) return 'starTicket';
  if (canAfford && toStar <= 3 && has('miniDice')) return 'miniDice';
  if (canAfford && toStar > 20 && has('tripleDice')) return 'tripleDice';
  if (canAfford && toStar > 10 && has('doubleDice')) return 'doubleDice';
  if (has('warpShell')) {
    const better = others.some((o) => distance(e, e.player(o).field, e.state.starField) + 10 < toStar);
    if (better && canAfford) return 'warpShell';
  }
  if (has('stealGlove') && ahead((o) => e.player(o).coins >= 12)) return 'stealGlove';
  if (has('trapStone') && rng.chance(level === 'hard' ? 0.5 : 0.3)) return 'trapStone';
  if (has('tripleDice') && toStar > 15 && rng.chance(0.4)) return 'tripleDice';
  return null;
}
