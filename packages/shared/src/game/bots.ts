import { BALANCE, type BotLevel } from '../config';
import { PASS_FIELDS } from '../maps/types';
import type { Rng } from '../rng';
import type { GameEngine } from './engine';
import { stepDistribution, type DiceId } from './dice';
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
  riskDice: 4,
  goldDice: 4,
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
      return { type: 'roll', dice: chooseDice(e, p.player, p.dice, level, rng) };
    }
    case 'miniPick':
      return { type: 'pickSteps', steps: bestMiniSteps(e, p.player).steps };
    case 'branch': {
      if (sloppy(level, rng)) return { type: 'branch', to: rng.pick(p.options) };
      const scored = p.options.map((o) => ({ o, d: distance(e, o, e.state.starField) }));
      scored.sort((a, b) => a.d - b.d);
      return { type: 'branch', to: scored[0].o };
    }
    case 'shop': {
      // keep enough for the next star (review finding: bots used to shop themselves poor)
      const reserve = me.coins >= e.starPrice(p.player) || me.items.length > 0 ? e.starPrice(p.player) : 4;
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

/**
 * Second die: with the star in reach and enough coins, maximize the chance to pass it;
 * otherwise the character die (same expectation, more fun). Easy bots pick at random.
 */
export function chooseDice(e: GameEngine, i: number, options: DiceId[], level: BotLevel, rng: Rng): DiceId {
  if (options.length === 1 || level === 'easy') return rng.pick(options);
  const me = e.player(i);
  const toStar = distance(e, me.field, e.state.starField);
  if (me.coins >= e.starPrice(i) && toStar <= 14) {
    const chance = (id: DiceId) => {
      let p = 0;
      // the star field itself costs no step: passing it needs more steps than `toStar`
      for (const [steps, q] of stepDistribution(['standard', id])) if (steps > toStar) p += q;
      return p;
    };
    return [...options].sort((a, b) => chance(b) - chance(a))[0];
  }
  return options[options.length - 1];
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
  // gold die pays 3–4 coins right after the roll; risk die (+ standard) reaches at most 14 steps
  if (has('goldDice') && !canAfford && me.coins + 4 >= e.starPrice(i)) return 'goldDice';
  if (has('riskDice') && canAfford && toStar >= 9 && toStar < 14) return 'riskDice';
  if (has('miniDice') && bestMiniSteps(e, i).value >= (canAfford ? 15 : 4)) return 'miniDice';
  if (canAfford && toStar > 20 && has('tripleDice')) return 'tripleDice';
  if (canAfford && toStar > 10 && has('doubleDice')) return 'doubleDice';
  if (has('warpShell') && canAfford) {
    // the swap partner is random: only worth it if the others are closer on average
    const avg = others.reduce((sum, o) => sum + distance(e, e.player(o).field, e.state.starField), 0) / others.length;
    if (avg + 6 < toStar) return 'warpShell';
  }
  if (has('stealGlove') && ahead((o) => e.player(o).coins >= 12)) return 'stealGlove';
  const here = e.field(me.field);
  const landable = !PASS_FIELDS.includes(here.type) && !e.state.traps.some((tr) => tr.field === me.field);
  if (has('trapStone') && landable && rng.chance(level === 'hard' ? 0.5 : 0.3)) return 'trapStone';
  if (has('tripleDice') && toStar > 15 && rng.chance(0.4)) return 'tripleDice';
  return null;
}

/**
 * Mini-Würfel: evaluates walking 1, 2 or 3 steps and returns the best choice. Passing the
 * star (which costs no step) is worth a lot; landing on item/lucky fields is nice, red
 * fields and foreign traps are bad.
 */
export function bestMiniSteps(e: GameEngine, i: number): { steps: number; value: number } {
  const me = e.player(i);
  let best = { steps: 1, value: -Infinity };
  for (const k of [1, 2, 3]) {
    let field = me.field;
    let remaining = k;
    let passedStar = false;
    let guard = 0;
    while (remaining > 0 && guard++ < 20) {
      const options = e.moveOptions(field);
      if (!options.length) break;
      const next = options.length > 1 ? [...options].sort((a, b) => distance(e, a, e.state.starField) - distance(e, b, e.state.starField))[0] : options[0];
      field = next;
      if (next === e.state.starField) passedStar = true;
      else if (!PASS_FIELDS.includes(e.field(next).type)) remaining--;
    }
    const type = e.field(field).type;
    let value = { blue: 3, red: -3, item: 5, lucky: 4, duel: 2, event: 1 }[type as string] ?? 0;
    if (passedStar && me.coins >= e.starPrice(i)) value += 20;
    if (e.state.traps.some((tr) => tr.field === field && tr.owner !== i)) value -= 8;
    if (value > best.value) best = { steps: k, value };
  }
  return best;
}
