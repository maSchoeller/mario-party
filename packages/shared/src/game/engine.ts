import { BALANCE } from '../config';
import { getField, getMap, predecessors, PASS_FIELDS } from '../maps';
import type { FieldDef, MapDef } from '../maps/types';
import { MINIGAMES, pickMinigame } from '../minigames/registry';
import type { MgFormat } from '../minigames/types';
import { Rng } from '../rng';
import { BONUS_CATEGORIES, COMEBACK_CATEGORIES, computeBonus } from './bonus';
import { DICE, type DiceId } from './dice';
import { GIMMICKS, type Gimmick } from './gimmicks';
import { ITEMS, ITEM_IDS, type ItemId } from './items';
import type {
  Action,
  DiceRoll,
  GameConfig,
  GameEvent,
  GameState,
  Pending,
  PlayerSetup,
  PlayerState,
  WheelSegment,
} from './types';

export class ActionError extends Error {}

export const LUCKY_WHEEL: WheelSegment['id'][] = ['coins5', 'coins10', 'item', 'swapCoins', 'coinsMinus5', 'bonusDuel'];
export const FINALE_WHEEL: WheelSegment['id'][] = ['coins10', 'item', 'starDiscount', 'coins15', 'item', 'star'];
/**
 * Half-time comeback wheel for the last place (CHAOS-03: trailing players can still win).
 * v0.5: spins after 10 of 20 rounds; one star steal became coins so the last place after
 * round 10 wins ~17 % of bot games (target 15–18 %, see scripts/balance.ts).
 */
export const CATCHUP_WHEEL: WheelSegment['id'][] = ['stealStar', 'star', 'swapCoins', 'coins10', 'item', 'coins10'];

export function createGame(config: GameConfig, setups: PlayerSetup[]): GameState {
  // GAME-01: bots fill up to 4; with 3+ humans bots can be switched off -> 3 seats
  if (setups.length < 3 || setups.length > 4) throw new Error('a game has 3 or 4 seats');
  const map = getMap(config.mapId);
  const rng = Rng.fromSeed(config.seed);
  const players: PlayerState[] = setups.map((s) => ({
    ...s,
    coins: BALANCE.startCoins,
    stars: 0,
    items: [],
    field: map.start,
    tickets: 0,
    starDiscount: false,
    lastColor: 'neutral',
    points: 0,
    stats: {
      minigameWins: 0,
      coinsEarned: 0,
      maxCoins: BALANCE.startCoins,
      fieldsWalked: 0,
      redFields: 0,
      blueFields: 0,
      coinsSpent: 0,
      duelWins: 0,
      itemsUsed: 0,
      starsBought: 0,
    },
  }));
  const state: GameState = {
    version: 1,
    config,
    rng: rng.state,
    players,
    order: setups.map((_, i) => i),
    orderRolls: [],
    round: 1,
    turnIdx: 0,
    stage: 'intro',
    starField: map.starSpots[0],
    traps: [],
    coinBags: [],
    gimmick: {},
    pending: null,
    turn: null,
    minigameHistory: [],
    finaleStarted: false,
  };
  GIMMICKS[map.gimmick].init(state, map);
  // the first star must be reachable under the initial gimmick state (e.g. high tide)
  const spots = new GameEngine(state).reachableStarSpots();
  state.starField = rng.pick(spots.length ? spots : map.starSpots);
  return state;
}

/**
 * Board game rules engine. Pure logic, no rendering. The host drives it:
 * `start()` / `act()` / `submitMinigame()` each return the events that happened, and
 * `state.pending` says which decision is awaited from whom (player or minigame).
 */
export class GameEngine {
  readonly map: MapDef;
  readonly rng: Rng;
  private events: GameEvent[] = [];
  private gimmick: Gimmick;

  constructor(public state: GameState) {
    this.map = getMap(state.config.mapId);
    this.rng = new Rng(state.rng);
    this.gimmick = GIMMICKS[this.map.gimmick];
  }

  get pending(): Pending | null {
    return this.state.pending;
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  private flush(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- lifecycle

  start(): GameEvent[] {
    const s = this.state;
    if (s.stage !== 'intro') return [];
    if (s.config.mode === 'marathon') {
      this.startMarathon();
      return this.flush();
    }
    this.emit({ type: 'announce', key: 'mod.intro', params: { map: this.map.nameKey } });
    this.emit({ type: 'announce', key: `mod.gimmick.${this.map.gimmick}` });
    this.gimmick.announce?.(this);
    s.stage = 'order';
    s.orderRolls = [];
    s.pending = { kind: 'orderRoll', player: 0 };
    this.emit({ type: 'announce', key: 'mod.orderRoll' });
    return this.flush();
  }

  act(player: number, action: Action): GameEvent[] {
    const p = this.state.pending;
    if (!p || p.kind === 'minigame' || p.kind === 'gameOver') throw new ActionError('no player decision pending');
    if (p.player !== player) throw new ActionError(`not player ${player}'s decision`);
    this.handle(p, action);
    return this.flush();
  }

  /** ranks: rank per participant (same order as pending.players), 0 = best. */
  submitMinigame(ranks: number[]): GameEvent[] {
    const p = this.state.pending;
    if (!p || p.kind !== 'minigame') throw new ActionError('no minigame pending');
    if (ranks.length !== p.players.length) throw new ActionError('rank count mismatch');
    this.state.minigameHistory.push(p.game);
    if (p.purpose === 'marathon') this.finishMarathonGame(p, ranks);
    else if (p.purpose === 'duel') this.finishDuel(p, ranks);
    else this.finishRoundMinigame(p, ranks);
    return this.flush();
  }

  // ---------------------------------------------------------------- helpers

  /** number of seats (3 or 4) */
  get n(): number {
    return this.state.players.length;
  }

  all(): number[] {
    return this.state.players.map((_, i) => i);
  }

  player(i: number): PlayerState {
    return this.state.players[i];
  }

  field(id: string): FieldDef {
    return getField(this.map, id);
  }

  isFinale(): boolean {
    return this.state.config.mode === 'board' && this.state.round > this.state.config.rounds - BALANCE.finaleRounds;
  }

  changeCoins(i: number, delta: number, reason: string): number {
    const p = this.player(i);
    const before = p.coins;
    p.coins = Math.max(0, p.coins + delta);
    const real = p.coins - before;
    if (real !== 0) {
      if (real > 0) p.stats.coinsEarned += real;
      p.stats.maxCoins = Math.max(p.stats.maxCoins, p.coins);
      this.emit({ type: 'coins', player: i, delta: real, reason });
    }
    return real;
  }

  spend(i: number, amount: number, reason: string): void {
    const real = -this.changeCoins(i, -amount, reason);
    // star purchases do not count for the "Kauflaune" bonus – it would reward the leader
    if (reason !== 'star') this.player(i).stats.coinsSpent += real;
  }

  changeStars(i: number, delta: number, reason: string): void {
    const p = this.player(i);
    const before = p.stars;
    p.stars = Math.max(0, p.stars + delta);
    if (p.stars !== before) this.emit({ type: 'stars', player: i, delta: p.stars - before, reason });
  }

  /** Field is currently passable (gimmicks may block it, e.g. flood or lava). */
  isOpen(fieldId: string): boolean {
    return !this.gimmick.isBlocked?.(this, fieldId);
  }

  /** Open successors. Blocked fields are never entered (may be empty: the walk stops). */
  openNext(fieldId: string): string[] {
    return this.field(fieldId).next.filter((n) => this.isOpen(n));
  }

  private liveCache: { sig: string; live: Set<string> } | null = null;

  /**
   * Open fields from which a player can keep walking forever over open fields, i.e. that
   * do not lead into a blocked dead end (flooded ford, lava). Cached per blocking state.
   */
  liveFields(): Set<string> {
    const open = this.map.fields.filter((f) => this.isOpen(f.id)).map((f) => f.id);
    const sig = open.join(',');
    if (this.liveCache?.sig === sig) return this.liveCache.live;
    const live = new Set(open);
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of live) {
        if (!this.field(id).next.some((n) => live.has(n))) {
          live.delete(id);
          changed = true;
        }
      }
    }
    this.liveCache = { sig, live };
    return live;
  }

  isLive(fieldId: string): boolean {
    return this.liveFields().has(fieldId);
  }

  /**
   * Ways forward a walking player may choose: open successors without the ones that only
   * lead into blocked dead ends (look-ahead). Inside a dead end all open ways are offered.
   */
  moveOptions(fieldId: string): string[] {
    const open = this.openNext(fieldId);
    if (open.length <= 1) return open;
    const live = open.filter((n) => this.isLive(n));
    return live.length ? live : open;
  }

  /** Fields reachable from `from` over live fields. */
  private reachable(from: string): Set<string> {
    const live = this.liveFields();
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length) {
      for (const n of this.field(queue.shift()!).next) {
        if (live.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  }

  /**
   * Star spots everybody can walk to right now: reachable over open, not cut-off fields
   * from the start and from every player's field (a spot behind the flooded ford is not).
   */
  reachableStarSpots(exclude?: string): string[] {
    const sources = [this.map.start, ...this.state.players.map((p) => p.field)].filter((f) => this.isLive(f));
    const sets = [...new Set(sources)].map((f) => this.reachable(f));
    return this.map.starSpots.filter((s) => s !== exclude && this.isLive(s) && sets.every((r) => r.has(s)));
  }

  /**
   * A gimmick changed which fields are blocked: players on blocked or cut-off fields are
   * moved to the nearest safe field behind them, and the star flees if nobody can reach it.
   */
  refreshBlocking(washKey: string, starKey: string): void {
    this.state.players.forEach((p, i) => {
      if (this.isLive(p.field)) return;
      const safe = this.safeFieldBehind(p.field);
      this.emit({ type: 'announce', key: washKey, player: i });
      this.teleport(i, safe, 'wash');
    });
    if (!this.reachableStarSpots().includes(this.state.starField)) {
      this.emit({ type: 'announce', key: starKey });
      this.moveStar();
    }
  }

  /** Moves a player directly (no walking), e.g. cannon/warp/wash. */
  teleport(i: number, to: string, kind: 'warp' | 'cannon' | 'wash' | 'ride' | 'cable'): void {
    const p = this.player(i);
    const from = p.field;
    p.field = to;
    this.emit({ type: 'move', player: i, from, to, kind });
  }

  /** Nearest field (walking backwards) that is open and not cut off – used to wash players back. */
  safeFieldBehind(fieldId: string): string {
    const seen = new Set<string>([fieldId]);
    let frontier = [fieldId];
    while (frontier.length) {
      const nextFrontier: string[] = [];
      for (const f of frontier) {
        for (const pr of predecessors(this.map, f)) {
          if (seen.has(pr)) continue;
          seen.add(pr);
          if (this.isLive(pr) && !PASS_FIELDS.includes(this.field(pr).type)) return pr;
          nextFrontier.push(pr);
        }
      }
      frontier = nextFrontier;
    }
    return this.map.start;
  }

  giveItem(i: number, item: ItemId): void {
    const p = this.player(i);
    if (p.items.length < BALANCE.maxItems) {
      p.items.push(item);
      this.emit({ type: 'item', player: i, item, gained: true });
    } else {
      this.state.pending = { kind: 'itemReplace', player: i, newItem: item };
    }
  }

  randomFindItem(): ItemId {
    const pool: ItemId[] = [];
    for (const id of ITEM_IDS) for (let k = 0; k < ITEMS[id].findWeight; k++) pool.push(id);
    return this.rng.pick(pool);
  }

  starPrice(i: number): number {
    return this.player(i).starDiscount ? BALANCE.starPriceDiscounted : BALANCE.starPrice;
  }

  /** Placement order: stars, coins; equal stays equal (rank sharing). */
  standings(): number[] {
    return this.all().sort((a, b) => this.compare(a, b));
  }

  private compare(a: number, b: number): number {
    const pa = this.player(a);
    const pb = this.player(b);
    return pb.stars - pa.stars || pb.coins - pa.coins;
  }

  /** Last place for the comeback wheels: fewest stars, then fewest coins, a tie is drawn by lot. */
  lastPlace(): number {
    const st = this.standings();
    const worst = st[st.length - 1];
    const tied = st.filter((i) => this.compare(i, worst) === 0);
    return tied.length > 1 ? this.rng.pick(tied) : worst;
  }

  /** Standings with the drawn last place shown last (it may share the rank with others). */
  private standingsWithLast(last: number): number[] {
    return [...this.standings().filter((i) => i !== last), last];
  }

  // ---------------------------------------------------------------- decisions

  private handle(p: Exclude<Pending, { kind: 'minigame' } | { kind: 'gameOver' }>, a: Action): void {
    switch (p.kind) {
      case 'orderRoll': {
        if (a.type !== 'roll') throw new ActionError('expected roll');
        const roll = this.rollDie('standard');
        const value = roll.steps;
        this.state.orderRolls[p.player] = value;
        this.emit({ type: 'orderRoll', player: p.player, value, roll });
        if (p.player < this.n - 1) {
          this.state.pending = { kind: 'orderRoll', player: p.player + 1 };
        } else {
          const tiebreak = this.all().map(() => this.rng.next());
          this.state.order = this.all().sort(
            (x, y) => this.state.orderRolls[y] - this.state.orderRolls[x] || tiebreak[y] - tiebreak[x],
          );
          this.emit({ type: 'order', order: [...this.state.order] });
          this.state.stage = 'turns';
          this.state.turnIdx = 0;
          this.emit({ type: 'roundStart', round: 1, total: this.state.config.rounds });
          this.beginTurn();
        }
        return;
      }
      case 'turnMenu': {
        if (a.type === 'useItem') {
          if (!p.canUseItem) throw new ActionError('item already used');
          this.useItem(p.player, a.item);
          return;
        }
        if (a.type !== 'roll') throw new ActionError('expected roll or useItem');
        if (this.state.turn?.usedItem === 'miniDice') {
          this.state.pending = { kind: 'miniPick', player: p.player, options: [1, 2, 3] };
          return;
        }
        const second = a.dice ?? p.dice[p.dice.length - 1];
        if (!p.dice.includes(second)) throw new ActionError('die not available');
        this.roll(p.player, second);
        return;
      }
      case 'miniPick': {
        if (a.type !== 'pickSteps' || !p.options.includes(a.steps)) throw new ActionError('expected pickSteps 1..3');
        this.roll(p.player, 'standard', a.steps);
        return;
      }
      case 'branch': {
        if (a.type !== 'branch' || !p.options.includes(a.to)) throw new ActionError('invalid branch');
        this.state.pending = null;
        this.step(p.player, a.to, p.backward);
        this.continueMove();
        return;
      }
      // invalid actions throw before `pending` is cleared, so a bad message cannot stall the game
      case 'shop': {
        if (a.type !== 'buy') throw new ActionError('expected buy');
        if (a.item) {
          if (!p.offer.includes(a.item)) throw new ActionError('item not offered');
          const price = ITEMS[a.item].price;
          const pl = this.player(p.player);
          if (pl.coins < price) throw new ActionError('not enough coins');
          const full = pl.items.length >= BALANCE.maxItems;
          if (full && (a.replace === undefined || a.replace < 0 || a.replace >= pl.items.length)) throw new ActionError('inventory full');
          this.state.pending = null;
          if (full) {
            const old = pl.items.splice(a.replace!, 1)[0];
            this.emit({ type: 'item', player: p.player, item: old, gained: false });
          }
          this.spend(p.player, price, 'shop');
          pl.items.push(a.item);
          this.emit({ type: 'item', player: p.player, item: a.item, gained: true });
          this.emit({ type: 'announce', key: 'mod.shopBought', params: { item: `item.${a.item}.name` }, player: p.player });
        }
        this.state.pending = null;
        this.continueMove();
        return;
      }
      case 'buyStar': {
        if (a.type !== 'buyStar') throw new ActionError('expected buyStar');
        if (a.accept && this.player(p.player).coins < p.price) throw new ActionError('not enough coins');
        this.state.pending = null;
        if (a.accept) this.buyStar(p.player, p.price);
        this.continueMove();
        return;
      }
      case 'station': {
        if (a.type !== 'station') throw new ActionError('expected station');
        if (a.dest) {
          if (!p.destinations.includes(a.dest)) throw new ActionError('invalid station');
          const pl = this.player(p.player);
          if (pl.tickets <= 0 && pl.coins < p.ticketPrice) throw new ActionError('no ticket');
          this.state.pending = null;
          if (pl.tickets > 0) pl.tickets--;
          else this.spend(p.player, p.ticketPrice, 'ticket');
          this.emit({ type: 'announce', key: 'mod.trainRide', params: { station: this.field(a.dest).label ?? '' }, player: p.player });
          this.teleport(p.player, a.dest, 'ride');
          this.state.turn!.passResolved = a.dest;
        }
        this.state.pending = null;
        this.continueMove();
        return;
      }
      case 'cablecar': {
        if (a.type !== 'cablecar') throw new ActionError('expected cablecar');
        if (a.accept && this.player(p.player).coins < p.price) throw new ActionError('not enough coins');
        this.state.pending = null;
        if (a.accept) {
          this.spend(p.player, p.price, 'cablecar');
          this.emit({ type: 'announce', key: 'mod.cablecar', player: p.player });
          this.teleport(p.player, p.target, 'cable');
          this.afterArrive(p.player, p.target);
        }
        this.continueMove();
        return;
      }
      case 'itemReplace': {
        if (a.type !== 'replaceItem') throw new ActionError('expected replaceItem');
        const pl = this.player(p.player);
        if (a.index !== null && (a.index < 0 || a.index >= pl.items.length)) throw new ActionError('invalid index');
        this.state.pending = null;
        if (a.index !== null) {
          const old = pl.items[a.index];
          pl.items[a.index] = p.newItem;
          this.emit({ type: 'item', player: p.player, item: old, gained: false });
          this.emit({ type: 'item', player: p.player, item: p.newItem, gained: true });
        }
        this.resume();
        return;
      }
      case 'duelPick': {
        if (a.type !== 'duelPick' || !p.options.includes(a.target)) throw new ActionError('invalid duel target');
        this.startDuel(p.player, a.target, p.stake);
        return;
      }
      case 'wheel': {
        if (a.type !== 'stopWheel') throw new ActionError('expected stopWheel');
        this.state.pending = null;
        const result = this.rng.int(0, p.segments.length - 1);
        this.emit({ type: 'wheel', player: p.player, segments: p.segments, result });
        this.applyWheel(p.player, p.segments[result], p.reason);
        if (!this.state.pending) this.resume();
        return;
      }
    }
  }

  /** Continue whatever flow was interrupted by a decision (turn end, round end, ...). */
  private resume(): void {
    if (this.state.pending) return;
    if (this.state.stage === 'turns') {
      const t = this.state.turn;
      if (!t) return this.beginTurn();
      if (!t.rolled) {
        this.state.pending = { kind: 'turnMenu', player: t.player, canUseItem: false, dice: this.diceOptions(t.player) };
        return;
      }
      if (!t.landed) return this.continueMove();
      return this.endTurn();
    }
    if (this.state.stage === 'roundEnd') return this.nextRound();
  }

  // ---------------------------------------------------------------- turn flow

  private beginTurn(): void {
    const i = this.state.order[this.state.turnIdx];
    this.state.turn = {
      player: i,
      dice: [],
      remaining: 0,
      rolled: false,
      usedItem: null,
      glove: false,
      starSteal: false,
      passResolved: null,
      landed: false,
      stepsTaken: 0,
      starBought: false,
    };
    this.emit({ type: 'turnStart', player: i });
    this.state.pending = { kind: 'turnMenu', player: i, canUseItem: this.player(i).items.some((it) => ITEMS[it].usable), dice: this.diceOptions(i) };
  }

  /** Choices for the second die: a dice item in use replaces them, else standard or the character die. */
  diceOptions(i: number): DiceId[] {
    const used = this.state.turn?.usedItem;
    if (used === 'riskDice' || used === 'goldDice') return [used];
    return ['standard', this.player(i).character];
  }

  private rollDie(id: DiceId): DiceRoll {
    const face = this.rng.int(0, 5);
    const f = DICE[id].faces[face];
    return { dice: id, face, steps: f.steps, coins: f.coins ?? 0 };
  }

  private useItem(i: number, item: ItemId): void {
    const pl = this.player(i);
    const idx = pl.items.indexOf(item);
    if (idx < 0) throw new ActionError('item not in inventory');
    if (!ITEMS[item].usable) throw new ActionError('item is passive');
    const t = this.state.turn!;
    pl.items.splice(idx, 1);
    pl.stats.itemsUsed++;
    t.usedItem = item;
    this.emit({ type: 'itemUse', player: i, item });
    this.emit({ type: 'announce', key: `mod.item.${item}`, player: i });
    switch (item) {
      case 'warpShell': {
        const others = this.all().filter((o) => o !== i);
        const o = this.rng.pick(others);
        const mine = pl.field;
        const theirs = this.player(o).field;
        this.teleport(i, theirs, 'warp');
        this.teleport(o, mine, 'warp');
        break;
      }
      case 'stealGlove':
        t.glove = true;
        break;
      case 'starTicket':
        t.starSteal = true;
        break;
      case 'trapStone': {
        const field = this.trapField(pl.field);
        this.state.traps = this.state.traps.filter((tr) => tr.field !== field);
        this.state.traps.push({ field, owner: i });
        this.emit({ type: 'trap', field, owner: i, placed: true });
        break;
      }
      default:
        break; // dice items modify the roll
    }
    this.state.pending = { kind: 'turnMenu', player: i, canUseItem: false, dice: this.diceOptions(i) };
  }

  /**
   * Traps only fire when someone stops on the field. On a pass field (start, shop, ...) or
   * under the star nobody ever stops, so the trap goes onto the next field ahead instead.
   */
  trapField(from: string): string {
    const ok = (id: string) => !PASS_FIELDS.includes(this.field(id).type) && id !== this.state.starField;
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (ok(cur)) return cur;
      for (const n of this.moveOptions(cur)) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    return from;
  }

  private roll(i: number, second: DiceId, fixed?: number): void {
    const t = this.state.turn!;
    let rolls: DiceRoll[];
    if (t.usedItem === 'miniDice') {
      const steps = fixed ?? this.rng.int(1, 3);
      rolls = [{ dice: 'standard', face: steps - 1, steps, coins: 0 }];
    } else {
      rolls = [this.rollDie('standard'), this.rollDie(second)];
      // dice items add standard dice on top (Doppelwürfel +1, Turbo-Würfel +2)
      const extra = t.usedItem === 'doubleDice' ? 1 : t.usedItem === 'tripleDice' ? 2 : 0;
      for (let k = 0; k < extra; k++) rolls.push(this.rollDie('standard'));
    }
    const total = rolls.reduce((a, r) => a + r.steps, 0);
    const coins = rolls.reduce((a, r) => a + r.coins, 0);
    t.dice = rolls;
    t.remaining = total;
    t.rolled = true;
    this.state.pending = null;
    this.emit({ type: 'dice', player: i, rolls, total });
    if (coins) this.changeCoins(i, coins, 'dice');
    this.continueMove();
  }

  /** Walks until a decision is needed or the dice steps are used up. */
  private continueMove(): void {
    const t = this.state.turn!;
    const i = t.player;
    while (!this.state.pending) {
      const pl = this.player(i);
      // pass triggers on the field we currently stand on (star / shop / station / cablecar)
      if (t.passResolved !== pl.field && t.stepsTaken > 0 && t.remaining >= 0) {
        t.passResolved = pl.field;
        if (this.passTrigger(i, pl.field)) return;
      }
      if (t.remaining === 0) {
        this.land(i);
        return;
      }
      const backward = t.remaining < 0;
      const options = backward ? this.openPrev(pl.field) : this.moveOptions(pl.field);
      if (!options.length) {
        // every way on is blocked: the move ends here (never walk into a blocked field)
        this.emit({ type: 'announce', key: 'mod.blocked', player: i });
        t.remaining = 0;
        continue;
      }
      if (options.length > 1) {
        this.state.pending = { kind: 'branch', player: i, options, backward: backward || undefined };
        return;
      }
      this.step(i, options[0], backward);
    }
  }

  /** Open predecessors that can be walked to backwards (negative dice totals). */
  openPrev(fieldId: string): string[] {
    return predecessors(this.map, fieldId).filter((n) => this.isOpen(n));
  }

  private step(i: number, to: string, backward = false): void {
    const t = this.state.turn!;
    const pl = this.player(i);
    const from = pl.field;
    pl.field = to;
    t.stepsTaken++;
    const f = this.field(to);
    const counts = !PASS_FIELDS.includes(f.type) && this.state.starField !== to;
    if (counts) {
      t.remaining += backward ? 1 : -1;
      pl.stats.fieldsWalked++;
    }
    // walking backwards does not trigger star/shop/station on the way
    if (backward) t.passResolved = to;
    this.emit({ type: 'move', player: i, from, to, kind: backward ? 'back' : 'walk' });
    this.passOthers(i, to);
    this.collectBag(i, to);
  }

  private passOthers(i: number, field: string): void {
    const t = this.state.turn!;
    if (!t.glove && !t.starSteal) return;
    for (const o of this.all()) {
      if (o === i || this.player(o).field !== field) continue;
      if (t.glove && this.player(o).coins > 0) {
        t.glove = false;
        if (this.blockedByShield(o)) continue;
        const amount = this.rng.int(BALANCE.stealMin, BALANCE.stealMax);
        const taken = -this.changeCoins(o, -amount, 'steal');
        this.changeCoins(i, taken, 'steal');
        this.emit({ type: 'announce', key: 'mod.steal', params: { coins: taken }, player: i });
      } else if (!t.glove && t.starSteal && this.player(o).stars > 0) {
        t.starSteal = false;
        if (this.blockedByShield(o)) continue;
        this.changeStars(o, -1, 'steal');
        this.changeStars(i, 1, 'steal');
        this.emit({ type: 'announce', key: 'mod.starSteal', player: i });
      }
    }
  }

  blockedByShield(i: number): boolean {
    const pl = this.player(i);
    const idx = pl.items.indexOf('shield');
    if (idx < 0) return false;
    pl.items.splice(idx, 1);
    this.emit({ type: 'item', player: i, item: 'shield', gained: false });
    this.emit({ type: 'announce', key: 'mod.shield', player: i });
    return true;
  }

  private collectBag(i: number, field: string): void {
    const bagIdx = this.state.coinBags.findIndex((b) => b.field === field);
    if (bagIdx < 0) return;
    const bag = this.state.coinBags.splice(bagIdx, 1)[0];
    this.changeCoins(i, bag.amount, 'bag');
    this.emit({ type: 'coinBag', field, amount: bag.amount, placed: false, player: i });
  }

  /** Returns true when a decision is now pending. */
  private passTrigger(i: number, fieldId: string): boolean {
    const pl = this.player(i);
    if (this.state.starField === fieldId) {
      // one star per turn: the star may move further along the same path after a purchase
      if (this.state.turn?.starBought) {
        this.emit({ type: 'announce', key: 'mod.starLimit', player: i });
        return false;
      }
      const price = this.starPrice(i);
      if (pl.coins >= price) {
        this.state.pending = { kind: 'buyStar', player: i, price };
        return true;
      }
      this.emit({ type: 'announce', key: 'mod.starTooExpensive', params: { price }, player: i });
      return false;
    }
    const f = this.field(fieldId);
    if (f.type === 'shop') {
      const offer = this.shopOffer();
      if (offer.some((it) => ITEMS[it].price <= pl.coins)) {
        this.state.pending = { kind: 'shop', player: i, offer };
        return true;
      }
      this.emit({ type: 'announce', key: 'mod.shopNoMoney', player: i });
      return false;
    }
    if (this.gimmick.passTrigger?.(this, i, f)) return true;
    return false;
  }

  /** Called when a player arrives somewhere by teleport during a move (cable car). */
  private afterArrive(i: number, fieldId: string): void {
    this.collectBag(i, fieldId);
  }

  private shopOffer(): ItemId[] {
    const base: ItemId[] = ['doubleDice', 'tripleDice', 'miniDice', 'riskDice', 'goldDice', 'warpShell', 'stealGlove', 'trapStone', 'shield'];
    const offer = this.rng.shuffle([...base]).slice(0, 4);
    if (this.rng.chance(0.3)) offer.push('starTicket');
    return offer;
  }

  private buyStar(i: number, price: number): void {
    const pl = this.player(i);
    if (pl.coins < price) throw new ActionError('not enough coins');
    this.spend(i, price, 'star');
    pl.starDiscount = false;
    pl.stats.starsBought++;
    if (this.state.turn) this.state.turn.starBought = true;
    this.changeStars(i, 1, 'buy');
    this.emit({ type: 'announce', key: 'mod.starBought', player: i });
    this.moveStar();
  }

  /** Moves the star to another spot that players can walk to under the current blocking. */
  moveStar(): void {
    const from = this.state.starField;
    const reachable = this.reachableStarSpots(from);
    const open = this.map.starSpots.filter((s) => s !== from && this.isOpen(s));
    const candidates = reachable.length ? reachable : open.length ? open : this.map.starSpots.filter((s) => s !== from);
    const to = this.rng.pick(candidates);
    this.state.starField = to;
    this.emit({ type: 'starMoved', from, to });
  }

  private land(i: number): void {
    const t = this.state.turn!;
    t.landed = true;
    const pl = this.player(i);
    const f = this.field(pl.field);
    this.emit({ type: 'land', player: i, field: f.id, fieldType: f.type });
    // trap
    const trapIdx = this.state.traps.findIndex((tr) => tr.field === f.id && tr.owner !== i);
    if (trapIdx >= 0) {
      const trap = this.state.traps.splice(trapIdx, 1)[0];
      this.emit({ type: 'trap', field: f.id, owner: trap.owner, placed: false });
      if (this.player(i).coins === 0) {
        // nothing to lose – the trap is used up, the shield is kept
      } else if (!this.blockedByShield(i)) {
        const paid = -this.changeCoins(i, -BALANCE.trapPenalty, 'trap');
        this.changeCoins(trap.owner, paid, 'trap');
        this.emit({ type: 'announce', key: 'mod.trap', params: { coins: paid }, player: i });
      }
    }
    const mult = this.isFinale() ? BALANCE.finaleMultiplier : 1;
    switch (f.type) {
      case 'blue':
        pl.lastColor = 'blue';
        pl.stats.blueFields++;
        this.changeCoins(i, BALANCE.blueCoins * mult, 'blue');
        break;
      case 'red':
        pl.lastColor = 'red';
        pl.stats.redFields++;
        this.changeCoins(i, -BALANCE.redCoins * mult, 'red');
        this.gimmick.onRedField?.(this, i);
        break;
      case 'event':
        pl.lastColor = 'neutral';
        this.gimmick.onEventField(this, i);
        break;
      case 'lucky':
        pl.lastColor = 'neutral';
        this.emit({ type: 'announce', key: 'mod.lucky', player: i });
        this.state.pending = { kind: 'wheel', player: i, segments: LUCKY_WHEEL, reason: 'lucky' };
        break;
      case 'item':
        pl.lastColor = 'neutral';
        {
          const item = this.randomFindItem();
          this.emit({ type: 'announce', key: 'mod.itemField', params: { item: `item.${item}.name` }, player: i });
          this.giveItem(i, item);
        }
        break;
      case 'duel': {
        pl.lastColor = 'neutral';
        // the challenger cannot risk more than they own; without coins on either side there is
        // nothing to win, so no duel (a 0-coin stake used to start a pointless minigame)
        const stake = Math.min(BALANCE.duelStake, pl.coins);
        const options = this.all().filter((o) => o !== i && this.player(o).coins > 0);
        if (stake <= 0 || !options.length) {
          this.emit({ type: 'announce', key: 'mod.duelNoCoins', player: i });
          break;
        }
        this.emit({ type: 'announce', key: 'mod.duel', player: i });
        this.state.pending = { kind: 'duelPick', player: i, options, stake };
        break;
      }
      default:
        pl.lastColor = 'neutral';
    }
    if (!this.state.pending) this.endTurn();
  }

  private applyWheel(i: number, seg: WheelSegment['id'], reason: 'lucky' | 'finale' | 'catchup'): void {
    this.emit({ type: 'announce', key: `mod.wheel.${seg}`, player: i });
    switch (seg) {
      case 'coins5':
        this.changeCoins(i, 5, 'wheel');
        break;
      case 'coins10':
        this.changeCoins(i, 10, 'wheel');
        break;
      case 'coins15':
        this.changeCoins(i, 15, 'wheel');
        break;
      case 'coinsMinus5':
        this.changeCoins(i, -5, 'wheel');
        break;
      case 'item':
        this.giveItem(i, this.randomFindItem());
        break;
      case 'starDiscount':
        this.player(i).starDiscount = true;
        break;
      case 'star':
        this.changeStars(i, 1, 'wheel');
        break;
      case 'stealStar': {
        // take a star from the leader – or 10 coins if nobody else has a star
        const leader = this.standings().find((o) => o !== i && this.player(o).stars > 0);
        if (leader === undefined) {
          this.changeCoins(i, 10, 'wheel');
        } else {
          this.changeStars(leader, -1, 'steal');
          this.changeStars(i, 1, 'steal');
          this.emit({ type: 'announce', key: 'mod.starSteal', player: i });
        }
        break;
      }
      case 'swapCoins': {
        const o = this.rng.pick(this.all().filter((x) => x !== i));
        const a = this.player(i).coins;
        const b = this.player(o).coins;
        this.changeCoins(i, b - a, 'swap');
        this.changeCoins(o, a - b, 'swap');
        break;
      }
      case 'bonusDuel': {
        const o = this.rng.pick(this.all().filter((x) => x !== i));
        this.startDuel(i, o, 0, true);
        break;
      }
    }
    void reason;
  }

  private startDuel(a: number, b: number, stake: number, bonus = false): void {
    const game = pickMinigame('duel', this.rng, this.state.minigameHistory, this.state.config);
    this.state.pending = {
      kind: 'minigame',
      game,
      format: 'duel',
      players: [a, b],
      teams: [0, 1],
      purpose: 'duel',
      stake: bonus ? -BALANCE.duelStake : stake,
    };
  }

  private finishDuel(p: Extract<Pending, { kind: 'minigame' }>, ranks: number[]): void {
    const [a, b] = p.players;
    const stake = p.stake ?? BALANCE.duelStake;
    let rewards = [0, 0];
    if (ranks[0] !== ranks[1]) {
      const winner = ranks[0] < ranks[1] ? 0 : 1;
      const w = p.players[winner];
      const l = p.players[1 - winner];
      this.player(w).stats.duelWins++;
      if (stake < 0) {
        // bonus duel from the lucky wheel: winner gets coins from the bank
        this.changeCoins(w, -stake, 'duel');
        rewards[winner] = -stake;
      } else {
        const taken = -this.changeCoins(l, -stake, 'duel');
        this.changeCoins(w, taken, 'duel');
        rewards = winner === 0 ? [taken, -taken] : [-taken, taken];
      }
      this.emit({ type: 'announce', key: 'mod.duelWin', player: w });
    } else {
      this.emit({ type: 'announce', key: 'mod.draw' });
    }
    this.emit({ type: 'minigameResult', game: p.game, players: [a, b], ranks, rewards });
    this.state.pending = null;
    this.resume();
  }

  private endTurn(): void {
    this.state.pending = null;
    this.state.turn = null;
    this.state.turnIdx++;
    if (this.state.turnIdx < this.n) {
      this.beginTurn();
      return;
    }
    // round minigame
    this.state.turnIdx = 0;
    this.state.stage = 'minigame';
    this.startRoundMinigame();
  }

  private startRoundMinigame(): void {
    const s = this.state;
    const colors = s.players.map((p) => {
      if (s.config.teamMode === 'random' || p.lastColor === 'neutral') return this.rng.chance(0.5) ? 'blue' : 'red';
      return p.lastColor;
    });
    const blue = this.all().filter((i) => colors[i] === 'blue');
    let format: MgFormat;
    let teams: number[];
    const split = blue.length === 1 || blue.length === this.n - 1;
    if (this.n < 4 || blue.length === 0 || blue.length === this.n || (split && !this.rng.chance(BALANCE.oneVsThreeChance))) {
      // 3 seats (bots off): team formats need 4 players, so every round game is FFA.
      // A 1:3 split only sometimes becomes a 1v3 game – otherwise 1v3 would be half of all games.
      format = 'ffa';
      teams = this.all();
    } else if (blue.length === 2) {
      format = '2v2';
      // team 0 is shown as "Team Rot" in the minigames, so it holds the red-field players
      teams = this.all().map((i) => (colors[i] === 'red' ? 0 : 1));
    } else {
      format = '1v3';
      const soloColor = blue.length === 1 ? 'blue' : 'red';
      teams = this.all().map((i) => (colors[i] === soloColor ? 0 : 1));
    }
    const game = pickMinigame(format, this.rng, s.minigameHistory, s.config);
    s.pending = { kind: 'minigame', game, format, players: this.all(), teams, purpose: 'round' };
    this.emit({ type: 'announce', key: 'mod.minigameTime', params: { format: `format.${format}` } });
  }

  private finishRoundMinigame(p: Extract<Pending, { kind: 'minigame' }>, ranks: number[]): void {
    const rewards = minigameRewards(p.format, p.teams, ranks);
    p.players.forEach((pi, k) => {
      if (ranks[k] === 0) this.player(pi).stats.minigameWins++;
      if (rewards[k]) this.changeCoins(pi, rewards[k], 'minigame');
    });
    this.emit({ type: 'minigameResult', game: p.game, players: p.players, ranks, rewards });
    this.state.pending = null;
    this.state.stage = 'roundEnd';
    this.gimmick.onRoundEnd?.(this);
    if (this.state.pending) return; // gimmick may ask something (not used yet)
    this.nextRound();
  }

  private nextRound(): void {
    const s = this.state;
    if (s.round >= s.config.rounds) {
      this.finishGame();
      return;
    }
    s.round++;
    s.stage = 'turns';
    s.turnIdx = 0;
    this.emit({ type: 'roundStart', round: s.round, total: s.config.rounds });
    this.gimmick.onRoundStart?.(this);
    this.emit({ type: 'autosave' });
    if (s.config.mode === 'board' && !s.catchupDone && s.round === halftimeRound(s.config.rounds)) {
      // half time: the last place gets a comeback spin (CHAOS-03)
      s.catchupDone = true;
      const last = this.lastPlace();
      this.emit({ type: 'standings', ranking: this.standingsWithLast(last) });
      s.turn = null;
      s.pending = { kind: 'wheel', player: last, segments: CATCHUP_WHEEL, reason: 'catchup' };
      this.emit({ type: 'announce', key: 'mod.catchup', player: last });
      return;
    }
    if (this.isFinale() && !s.finaleStarted) {
      s.finaleStarted = true;
      this.emit({ type: 'finale' });
      const last = this.lastPlace();
      const st = this.standingsWithLast(last);
      this.emit({ type: 'standings', ranking: st });
      this.emit({ type: 'announce', key: 'mod.finale', params: { leader: st[0], stars: this.player(st[0]).stars } });
      // last place spins the finale wheel (CHAOS-01)
      s.turn = null;
      s.pending = { kind: 'wheel', player: last, segments: FINALE_WHEEL, reason: 'finale' };
      this.emit({ type: 'announce', key: 'mod.finaleWheel', player: last });
      return;
    }
    this.beginTurn();
  }

  private finishGame(): void {
    const s = this.state;
    s.stage = 'bonus';
    s.pending = null;
    this.emit({ type: 'announce', key: 'mod.bonusIntro' });
    // CHAOS-02/03: one category always comes from the comeback pool so the bonus does not
    // simply reward the leader (review finding)
    const comeback = this.rng.pick(COMEBACK_CATEGORIES);
    const rest = this.rng.shuffle(BONUS_CATEGORIES.filter((c) => c !== comeback)).slice(0, 2);
    const cats = this.rng.shuffle([comeback, ...rest]);
    s.bonus = [];
    for (const c of cats) {
      const res = computeBonus(c, s.players);
      s.bonus.push(res);
      this.emit({ type: 'bonusStar', category: res.id, players: res.players, value: res.value });
      for (const w of res.players) this.changeStars(w, 1, 'bonus');
    }
    // final ranking: stars, coins, then dice decision (5.1)
    const dice = this.all().map(() => this.rng.next());
    s.ranking = this.all().sort((a, b) => this.compare(a, b) || dice[b] - dice[a]);
    s.stage = 'over';
    s.pending = { kind: 'gameOver' };
    this.emit({ type: 'announce', key: 'mod.winner', player: s.ranking[0] });
    this.emit({ type: 'gameOver', ranking: [...s.ranking] });
  }

  // ---------------------------------------------------------------- marathon (MODE-02)

  private startMarathon(): void {
    const s = this.state;
    s.stage = 'marathon';
    const games: string[] = [];
    const formats: MgFormat[] = this.n < 4 ? Array(9).fill('ffa') : ['ffa', 'ffa', 'ffa', 'ffa', '2v2', '2v2', '1v3', '1v3', 'ffa'];
    this.rng.shuffle(formats);
    for (const f of formats) games.push(pickMinigame(f, this.rng, games, s.config, true));
    games.push('gipfelsturm');
    s.marathon = { games, idx: 0 };
    this.emit({ type: 'announce', key: 'mod.marathonIntro', params: { count: games.length } });
    this.queueMarathonGame();
  }

  private queueMarathonGame(): void {
    const s = this.state;
    const m = s.marathon!;
    const game = m.games[m.idx];
    const format = formatOf(game);
    let teams = this.all();
    if (format === '2v2') {
      const shuffled = this.rng.shuffle(this.all());
      teams = [0, 0, 0, 0];
      teams[shuffled[2]] = 1;
      teams[shuffled[3]] = 1;
    } else if (format === '1v3') {
      const solo = this.rng.int(0, 3);
      teams = this.all().map((i) => (i === solo ? 0 : 1));
    }
    s.pending = {
      kind: 'minigame',
      game,
      format,
      players: this.all(),
      teams,
      purpose: 'marathon',
      double: m.idx === m.games.length - 1,
    };
  }

  private finishMarathonGame(p: Extract<Pending, { kind: 'minigame' }>, ranks: number[]): void {
    const s = this.state;
    const mult = p.double ? 2 : 1;
    const rewards = marathonPoints(p.format, p.teams, ranks).map((v) => v * mult);
    p.players.forEach((pi, k) => {
      this.player(pi).points += rewards[k];
      if (ranks[k] === 0) this.player(pi).stats.minigameWins++;
    });
    this.emit({ type: 'minigameResult', game: p.game, players: p.players, ranks, rewards });
    const m = s.marathon!;
    m.idx++;
    s.pending = null;
    if (m.idx < m.games.length) {
      this.emit({ type: 'autosave' });
      this.queueMarathonGame();
      return;
    }
    const dice = this.all().map(() => this.rng.next());
    s.ranking = this.all().sort((a, b) => this.player(b).points - this.player(a).points || dice[b] - dice[a]);
    s.stage = 'over';
    s.pending = { kind: 'gameOver' };
    this.emit({ type: 'announce', key: 'mod.winner', player: s.ranking[0] });
    this.emit({ type: 'gameOver', ranking: [...s.ranking] });
  }
}

/**
 * Round at whose start the half-time comeback wheel spins: after half of the rounds have
 * been played (20 rounds: before round 11; it used to spin after only 9 rounds).
 */
export function halftimeRound(rounds: number): number {
  return Math.floor(rounds / 2) + 1;
}

function formatOf(game: string): MgFormat {
  const def = MINIGAMES[game];
  if (!def) throw new Error(`unknown minigame ${game}`);
  return def.format;
}

/** Marathon points: FFA by placement, team games winners take it all (review finding). */
export function marathonPoints(format: MgFormat, teams: number[], ranks: number[]): number[] {
  if (format === 'ffa' || format === 'duel') return ranks.map((r) => BALANCE.marathonPoints[r] ?? 0);
  return ranks.map((r, k) => (r === 0 ? (format === '1v3' && teams[k] === 0 ? 5 : 3) : 0));
}

/** Coins per participant for a round minigame (5.1). */
export function minigameRewards(format: MgFormat, teams: number[], ranks: number[]): number[] {
  if (format === 'ffa') return ranks.map((r) => BALANCE.minigameFfaRewards[r] ?? 0);
  if (format === '1v3') {
    return ranks.map((r, k) => (r === 0 ? (teams[k] === 0 ? BALANCE.minigameSoloReward : BALANCE.minigameTeamReward) : 0));
  }
  return ranks.map((r) => (r === 0 ? BALANCE.minigameTeamReward : 0));
}
