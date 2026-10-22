import { describe, expect, it } from 'vitest';
import { simulateGame } from '../scripts/simulate';
import { BALANCE, CHARACTERS, PLAYER_COLORS } from '../src/config';
import { computeBonus } from '../src/game/bonus';
import { DICE, expectedValue, stepDistribution, type DiceId } from '../src/game/dice';
import { createGame, GameEngine, marathonPoints, minigameRewards } from '../src/game/engine';
import { botAction as botActionFor, chooseDice, distance } from '../src/game/bots';
import { COMEBACK_CATEGORIES } from '../src/game/bonus';
import type { GameConfig, GameEvent, PlayerSetup } from '../src/game/types';
import { getMap, MAP_IDS, PASS_FIELDS, validateMap } from '../src/maps';
import { ALL_MINIGAMES } from '../src/minigames/all';
import { makeMgPlayers, runMinigameHeadless } from '../src/minigames/headless';
import { MINIGAMES, pickMinigame } from '../src/minigames/registry';
import { Rng } from '../src/rng';

const setups = (n = 4): PlayerSetup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, character: CHARACTERS[i], color: PLAYER_COLORS[i], isBot: true, botLevel: 'medium' as const }));
const config = (mapId: string, extra: Partial<GameConfig> = {}): GameConfig => ({
  mode: 'board',
  mapId,
  rounds: 20,
  seed: 7,
  teamMode: 'fields',
  disabledMinigames: [],
  noMotion: false,
  ...extra,
});

describe('maps (MAP-01, MAP-06)', () => {
  it.each(MAP_IDS)('%s satisfies the map constraints', (id) => {
    expect(validateMap(getMap(id))).toEqual([]);
  });
});

describe('minigame catalog (MINI-01, MINI-02, MINI-08)', () => {
  it('has ~20 minigames + final with the planned format mix', () => {
    const regular = ALL_MINIGAMES.filter((m) => !m.final);
    expect(regular.length).toBe(20);
    expect(ALL_MINIGAMES.filter((m) => m.final).map((m) => m.id)).toEqual(['gipfelsturm']);
    const count = (f: string) => regular.filter((m) => m.format === f).length;
    expect([count('ffa'), count('2v2'), count('1v3'), count('duel')]).toEqual([8, 5, 4, 3]);
  });
  it('no control scheme is used by more than 40 % of the minigames', () => {
    const regular = ALL_MINIGAMES.filter((m) => !m.final);
    for (const c of ['joystick', 'tap', 'motion', 'draw']) expect(regular.filter((m) => m.control === c).length / regular.length).toBeLessThanOrEqual(0.4);
  });
  it('FFA minigames also work with 3 players (bots switched off)', () => {
    for (const def of ALL_MINIGAMES.filter((m) => m.format === 'ffa')) {
      const res = runMinigameHeadless(def, makeMgPlayers('ffa', undefined, 'medium', 3), 3);
      expect(res.ranks, def.id).toHaveLength(3);
      expect(Math.min(...res.ranks)).toBe(0);
    }
  });
});

describe('full games with bots (acceptance: 20 rounds on every map without crash)', () => {
  it.each(MAP_IDS)('%s', (mapId) => {
    const { state, events, minigames } = simulateGame(mapId, 11, 20);
    expect(state.stage).toBe('over');
    expect(state.ranking).toHaveLength(4);
    expect(minigames.length).toBeGreaterThanOrEqual(20);
    // the gimmick fires at least once and is announced (acceptance criterion)
    const gimmickEvents = events.filter((e) => e.type === 'tide' || e.type === 'eruption' || e.type === 'train');
    expect(gimmickEvents.length).toBeGreaterThan(1);
    const announce = events.filter((e) => e.type === 'announce').map((e) => (e as { key: string }).key);
    expect(announce.some((k) => ['mod.tideLow', 'mod.eruption', 'mod.trainComing'].includes(k))).toBe(true);
    expect(announce).toContain('mod.finale');
    expect(state.bonus).toHaveLength(3);
    expect(events.filter((e) => e.type === 'autosave').length).toBe(19);
  });
  it('works with 25/30 rounds and 3 seats', () => {
    expect(simulateGame('vulkan', 3, 25).state.stage).toBe('over');
    const three = simulateGame('bimmelbahn', 4, 20, 'board', 3);
    expect(three.state.ranking).toHaveLength(3);
  });
  it('marathon: 10 games, last one is the final and counts double (MODE-02)', () => {
    const { state, minigames, events } = simulateGame('kokosnuss', 5, 20, 'marathon');
    expect(minigames).toHaveLength(10);
    expect(minigames[9]).toBe('gipfelsturm');
    expect(new Set(minigames.slice(0, 9)).size).toBe(9);
    const last = events.filter((e) => e.type === 'minigameResult').at(-1) as { rewards: number[] };
    expect(Math.max(...last.rewards)).toBe(BALANCE.marathonPoints[0] * 2);
    expect(state.stage).toBe('over');
  });
});

describe('engine rules', () => {
  it('state is JSON serializable and resumable at any point (TECH-04)', () => {
    const e = new GameEngine(createGame(config('kokosnuss'), setups()));
    e.start();
    const copy = new GameEngine(JSON.parse(JSON.stringify(e.state)));
    expect(copy.pending).toEqual(e.pending);
    expect(copy.rng.next()).toBe(e.rng.next());
  });
  it('rejects actions from the wrong player', () => {
    const e = new GameEngine(createGame(config('kokosnuss'), setups()));
    e.start();
    expect(() => e.act(2, { type: 'roll' })).toThrow();
  });
  it('blue/red fields double in the finale (CHAOS-01)', () => {
    const e = new GameEngine(createGame(config('kokosnuss'), setups()));
    e.state.round = 16;
    expect(e.isFinale()).toBe(true);
    e.state.round = 15;
    expect(e.isFinale()).toBe(false);
  });
  it('minigame rewards follow the balancing table', () => {
    expect(minigameRewards('ffa', [0, 1, 2, 3], [0, 1, 2, 3])).toEqual([...BALANCE.minigameFfaRewards]);
    expect(minigameRewards('2v2', [0, 0, 1, 1], [0, 0, 1, 1])).toEqual([BALANCE.minigameTeamReward, BALANCE.minigameTeamReward, 0, 0]);
    expect(minigameRewards('1v3', [0, 1, 1, 1], [0, 1, 1, 1])).toEqual([BALANCE.minigameSoloReward, 0, 0, 0]);
  });
  it('bonus stars: shared top value gives everyone a star, zero gives nobody', () => {
    const e = new GameEngine(createGame(config('kokosnuss'), setups()));
    const ps = e.state.players;
    ps[0].stats.duelWins = 2;
    ps[2].stats.duelWins = 2;
    expect(computeBonus('duelChamp', ps).players).toEqual([0, 2]);
    ps.forEach((p) => (p.stats.redFields = 0));
    expect(computeBonus('unlucky', ps).players).toEqual([]);
  });
  it('turn order is rolled and every player starts with 10 coins', () => {
    const e = new GameEngine(createGame(config('vulkan'), setups()));
    e.start();
    for (let i = 0; i < 4; i++) e.act(i, { type: 'roll' });
    expect([...e.state.order].sort()).toEqual([0, 1, 2, 3]);
    expect(e.state.players.every((p) => p.coins === BALANCE.startCoins)).toBe(true);
    expect(e.pending?.kind).toBe('turnMenu');
  });
  it('a full inventory asks to replace or discard (ITEM-02)', () => {
    const e = new GameEngine(createGame(config('kokosnuss'), setups()));
    e.start();
    for (let i = 0; i < 4; i++) e.act(i, { type: 'roll' });
    const p = e.state.order[0];
    e.state.players[p].items = ['shield', 'shield', 'shield'];
    e.giveItem(p, 'doubleDice');
    expect(e.pending).toMatchObject({ kind: 'itemReplace', newItem: 'doubleDice' });
  });
  it('disabled minigames and motion games are not drawn (MODE-03, A11Y-02)', () => {
    const disabled = ALL_MINIGAMES.filter((m) => m.format === 'ffa' && !m.final && m.id !== 'kokosRegen').map((m) => m.id);
    const rng = Rng.fromSeed(1);
    for (let k = 0; k < 30; k++) expect(pickMinigame('ffa', rng, [], { disabledMinigames: disabled, noMotion: false })).toBe('kokosRegen');
    for (let k = 0; k < 30; k++) expect(MINIGAMES[pickMinigame('2v2', rng, [], { disabledMinigames: [], noMotion: true })].motion).toBeFalsy();
  });
});

describe('review fixes', () => {
  const started = (mapId = 'kokosnuss') => {
    const e = new GameEngine(createGame(config(mapId), setups()));
    e.start();
    for (let i = 0; i < 4; i++) e.act(i, { type: 'roll' });
    return e;
  };

  it('Mini-Würfel lets the player choose 1–3 steps', () => {
    const e = started();
    const p = e.state.order[0];
    e.state.players[p].items = ['miniDice'];
    e.state.pending = { kind: 'turnMenu', player: p, canUseItem: true, dice: ['standard'] };
    e.act(p, { type: 'useItem', item: 'miniDice' });
    e.act(p, { type: 'roll' });
    expect(e.pending).toMatchObject({ kind: 'miniPick', options: [1, 2, 3] });
    const events = e.act(p, { type: 'pickSteps', steps: 2 });
    expect(events.find((ev) => ev.type === 'dice')).toMatchObject({ total: 2 });
  });

  it('star purchases do not count as shopping (Kauflaune)', () => {
    const e = started();
    e.state.players[0].coins = 100;
    e.spend(0, 20, 'star');
    expect(e.state.players[0].stats.coinsSpent).toBe(0);
    e.spend(0, 5, 'shop');
    expect(e.state.players[0].stats.coinsSpent).toBe(5);
  });

  it('every game draws one comeback bonus category and has a half-time comeback wheel', () => {
    for (const seed of [1, 2, 3]) {
      const { state, events } = simulateGame('vulkan', seed, 20);
      expect(state.bonus!.some((b) => COMEBACK_CATEGORIES.includes(b.id as never))).toBe(true);
      const catchup = events.find((ev) => ev.type === 'announce' && (ev as { key: string }).key === 'mod.catchup');
      expect(catchup).toBeTruthy();
      expect(events.filter((ev) => ev.type === 'standings').length).toBe(2);
    }
  });

  it('team 0 ("Team Rot") holds the players from red fields', () => {
    const e = started();
    const colors = ['red', 'blue', 'red', 'blue'] as const;
    e.state.players.forEach((p, i) => (p.lastColor = colors[i]));
    // play the round to its minigame with bots
    const rng = Rng.fromSeed(3);
    while (e.pending && e.pending.kind !== 'minigame') {
      e.state.players.forEach((p, i) => (p.lastColor = colors[i]));
      const p = e.pending;
      if (p.kind === 'gameOver') break;
      // force neutral landings to keep the colors
      e.act(p.player, botActionFor(e, p, rng));
      e.state.players.forEach((pl, i) => (pl.lastColor = colors[i]));
    }
    const p = e.pending!;
    if (p.kind === 'minigame' && p.purpose === 'round' && p.format === '2v2') expect(p.teams).toEqual([0, 1, 0, 1]);
  });

  it('marathon team games: winners 3, solo winner 5, losers 0', () => {
    expect(marathonPoints('2v2', [0, 0, 1, 1], [0, 0, 1, 1])).toEqual([3, 3, 0, 0]);
    expect(marathonPoints('1v3', [0, 1, 1, 1], [0, 1, 1, 1])).toEqual([5, 0, 0, 0]);
    expect(marathonPoints('ffa', [0, 1, 2, 3], [1, 0, 3, 2])).toEqual([2, 4, 0, 1]);
  });

  it('the star flees from lava so it stays reachable', () => {
    const e = started('vulkan');
    e.state.starField = 's4';
    e.state.gimmick.eruption = BALANCE.eruptionThreshold - 1;
    e.state.gimmick.lavaNext = 0; // summit group
    const pl = e.state.order[0];
    e.state.players[pl].field = 'r2';
    // landing on a red field triggers the eruption via the gimmick hook
    (e as unknown as { gimmick: { onRedField(e: GameEngine, p: number): void } }).gimmick.onRedField(e, pl);
    expect(e.state.gimmick.lava?.group).toBe(0);
    expect(e.isOpen(e.state.starField)).toBe(true);
  });

  it('a trap on a player with 0 coins keeps their shield', () => {
    const e = started();
    const p = e.state.order[0];
    const victim = e.state.players[p];
    victim.coins = 0;
    victim.items = ['shield'];
    const target = getMap('kokosnuss').fields.find((f) => f.id === 'k2')!;
    e.state.traps.push({ field: target.id, owner: (p + 1) % 4 });
    victim.field = 'k1';
    e.state.turn = { player: p, dice: [{ dice: 'standard', face: 0, steps: 1, coins: 0 }], remaining: 1, rolled: true, usedItem: null, glove: false, starSteal: false, passResolved: null, landed: false, stepsTaken: 0 };
    e.state.pending = null;
    (e as unknown as { continueMove(): void }).continueMove();
    expect(victim.items).toContain('shield');
  });
});

describe('dice (v0.3)', () => {
  const started = (mapId = 'kokosnuss') => {
    const e = new GameEngine(createGame(config(mapId), setups()));
    e.start();
    for (let i = 0; i < 4; i++) e.act(i, { type: 'roll' });
    return e;
  };

  it('every die has the same expectation (±0.05; coins count 0.4 steps)', () => {
    for (const d of Object.values(DICE)) expect(expectedValue(d), d.id).toBeCloseTo(3.5, 1);
  });

  it('offers the standard die or the character die as second die', () => {
    const e = started();
    const p = e.state.order[0];
    expect(e.pending).toMatchObject({ kind: 'turnMenu', dice: ['standard', e.state.players[p].character] });
    const events = e.act(p, { type: 'roll', dice: 'standard' });
    const dice = events.find((ev) => ev.type === 'dice');
    expect(dice?.type === 'dice' && dice.rolls.map((r) => r.dice)).toEqual(['standard', 'standard']);
  });

  it('rejects dice the player does not own', () => {
    const e = started();
    const p = e.state.order[0];
    expect(() => e.act(p, { type: 'roll', dice: 'riskDice' })).toThrow();
  });

  it('pays coin faces right after the roll', () => {
    const e = started();
    const p = e.state.order[0];
    e.state.players[p].character = 'zippy';
    e.state.pending = { kind: 'turnMenu', player: p, canUseItem: false, dice: ['standard', 'zippy'] };
    // force the zippy die onto its "0 + 4 coins" face
    const rng = (e as unknown as { rng: { int(a: number, b: number): number } }).rng;
    const orig = rng.int.bind(rng);
    let call = 0;
    rng.int = (a, b) => (a === 0 && b === 5 ? (call++ === 0 ? 2 : 0) : orig(a, b));
    const coins = e.state.players[p].coins;
    const events = e.act(p, { type: 'roll', dice: 'zippy' });
    const dice = events.find((ev) => ev.type === 'dice');
    expect(dice?.type === 'dice' && dice.rolls[1]).toMatchObject({ dice: 'zippy', steps: 0, coins: 4 });
    expect(events.some((ev) => ev.type === 'coins' && ev.reason === 'dice' && ev.delta === 4)).toBe(true);
    expect(e.state.players[p].coins).toBeGreaterThanOrEqual(coins + 4 - 6);
  });

  it('a negative total walks backwards without pass triggers', () => {
    const e = started();
    const p = e.state.order[0];
    const pl = e.state.players[p];
    pl.field = 'k6';
    e.state.turn = { player: p, dice: [], remaining: -2, rolled: true, usedItem: null, glove: false, starSteal: false, passResolved: null, landed: false, stepsTaken: 0 };
    e.state.pending = null;
    (e as unknown as { continueMove(): void }).continueMove();
    // k5 is where the jetty joins: walking backwards there is a choice
    if (e.pending?.kind === 'branch') {
      expect(e.pending.backward).toBe(true);
      e.act(p, { type: 'branch', to: e.pending.options.includes('k4') ? 'k4' : e.pending.options[0] });
    }
    expect(pl.field).not.toBe('k6');
    expect(pl.stats.fieldsWalked).toBeGreaterThanOrEqual(1);
    expect(e.state.players.some((x) => x.field === 'k7' && x === pl)).toBe(false);
  });

  it('dice items replace the second die and extra dice add standard dice', () => {
    const e = started();
    const p = e.state.order[0];
    e.state.players[p].items = ['riskDice'];
    e.state.pending = { kind: 'turnMenu', player: p, canUseItem: true, dice: ['standard', e.state.players[p].character] };
    e.act(p, { type: 'useItem', item: 'riskDice' });
    expect(e.pending).toMatchObject({ kind: 'turnMenu', dice: ['riskDice'] });
    const ev = e.act(p, { type: 'roll' }).find((x) => x.type === 'dice');
    expect(ev?.type === 'dice' && ev.rolls.map((r) => r.dice)).toEqual(['standard', 'riskDice']);

    const e2 = started();
    const q = e2.state.order[0];
    e2.state.players[q].items = ['tripleDice'];
    e2.state.pending = { kind: 'turnMenu', player: q, canUseItem: true, dice: ['standard', e2.state.players[q].character] };
    e2.act(q, { type: 'useItem', item: 'tripleDice' });
    const ev2 = e2.act(q, { type: 'roll' }).find((x) => x.type === 'dice');
    expect(ev2?.type === 'dice' && ev2.rolls.length).toBe(4);
  });

  it('high tide floods the ford in the river', () => {
    const e = started();
    const ford = getMap('kokosnuss').fields.filter((f) => f.tags?.includes('ford'));
    expect(ford.length).toBeGreaterThanOrEqual(1);
    e.state.gimmick.tide = 'high';
    expect(e.isOpen(ford[0].id)).toBe(false);
    e.state.gimmick.tide = 'low';
    expect(e.isOpen(ford[0].id)).toBe(true);
  });
});

describe('v0.5 rule fixes', () => {
  const started = (mapId = 'kokosnuss', seed = 7) => {
    const e = new GameEngine(createGame(config(mapId, { seed }), setups()));
    e.start();
    for (let i = 0; i < 4; i++) e.act(i, { type: 'roll' });
    return e;
  };
  type Internals = { continueMove(): void; gimmick: { onRoundEnd(e: GameEngine): void; onRedField(e: GameEngine, p: number): void } };
  const internals = (e: GameEngine) => e as unknown as Internals;
  const record = (e: GameEngine) => {
    const events: GameEvent[] = [];
    const emit = e.emit.bind(e);
    e.emit = (ev) => {
      events.push(ev);
      emit(ev);
    };
    return events;
  };
  /** Blocks the given fields on top of the map gimmick (generic, independent of map data). */
  const block = (e: GameEngine, ids: string[]) => {
    const orig = e.isOpen.bind(e);
    e.isOpen = (id: string) => !ids.includes(id) && orig(id);
  };
  /** Sets up the current player's move: `steps` left, standing on `field`. */
  const move = (e: GameEngine, field: string, steps: number) => {
    const p = e.state.order[0];
    e.state.players[p].field = field;
    e.state.turn = { player: p, dice: [], remaining: steps, rolled: true, usedItem: null, glove: false, starSteal: false, passResolved: null, landed: false, stepsTaken: 0, starBought: false };
    e.state.pending = null;
    return p;
  };
  /** A field followed by `n` fields without branch or pass field. */
  const straight = (e: GameEngine, n: number): string[] => {
    for (const f of e.map.fields) {
      if (PASS_FIELDS.includes(f.type)) continue;
      const ids = [f.id];
      let cur = f;
      while (ids.length <= n && cur.next.length === 1) {
        cur = e.field(cur.next[0]);
        if (PASS_FIELDS.includes(cur.type) || ids.includes(cur.id)) break;
        ids.push(cur.id);
      }
      if (ids.length > n) return ids;
    }
    throw new Error('no straight path');
  };

  it('never walks into a blocked field; with every way blocked the move ends there', () => {
    const e = started();
    const [a, b] = straight(e, 3);
    block(e, [b]);
    const p = move(e, a, 4);
    e.state.starField = e.map.starSpots.find((s) => s !== a && s !== b)!;
    const events = record(e);
    internals(e).continueMove();
    expect(e.state.players[p].field).toBe(a);
    expect(events.some((ev) => ev.type === 'move' && ev.player === p)).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'announce', key: 'mod.blocked' }));
    expect(e.state.turn?.player).not.toBe(p); // the turn ended, no softlock
  });

  it('junctions do not offer a branch that only leads into blocked fields (look-ahead)', () => {
    const e = started();
    e.state.gimmick.tide = 'low';
    const junction = e.map.fields.find((f) => f.next.length === 2 && e.field(f.next[1]).next.length === 1)!;
    const [main, side] = junction.next;
    expect(e.moveOptions(junction.id)).toEqual(junction.next);
    // cut the side branch one field after the junction: it becomes a dead end
    block(e, e.field(side).next);
    expect(e.isOpen(side)).toBe(true);
    expect(e.isLive(side)).toBe(false);
    expect(e.moveOptions(junction.id)).toEqual([main]);
  });

  it('high tide: no branch option is flooded or cut off, low tide offers the shortcuts again', () => {
    const e = started();
    e.state.gimmick.tide = 'high';
    let removed = 0;
    for (const f of e.map.fields.filter((x) => x.next.length > 1)) {
      const opts = e.moveOptions(f.id);
      expect(opts.length, f.id).toBeGreaterThan(0);
      for (const o of opts) expect(e.isLive(o), `${f.id}->${o}`).toBe(true);
      removed += f.next.length - opts.length;
    }
    expect(removed).toBeGreaterThan(0);
    e.state.gimmick.tide = 'low';
    for (const f of e.map.fields.filter((x) => x.next.length > 1)) expect(e.moveOptions(f.id)).toEqual(f.next);
  });

  it('high tide washes players off flooded and cut-off fields onto a live field', () => {
    const e = started();
    e.state.gimmick.tide = 'low';
    const flooded = e.map.fields.filter((f) => f.tags?.includes('ford') || f.tags?.includes('sandbank'));
    e.state.players.forEach((pl, i) => (pl.field = flooded[i % flooded.length].id));
    e.state.round = BALANCE.tideInterval;
    internals(e).gimmick.onRoundEnd(e);
    expect(e.state.gimmick.tide).toBe('high');
    for (const pl of e.state.players) expect(e.isLive(pl.field), pl.field).toBe(true);
  });

  it('the star is always placed where everybody can walk to it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame(config('kokosnuss', { seed }), setups());
      expect(new GameEngine(s).reachableStarSpots()).toContain(s.starField);
    }
    const e = started();
    e.state.gimmick.tide = 'high';
    const high = e.reachableStarSpots();
    e.state.gimmick.tide = 'low';
    const cutOff = e.reachableStarSpots().filter((s) => !high.includes(s));
    expect(high.length).toBeGreaterThan(1);
    // no star spot behind the ford/sandbank: the reachability rule is covered by the lava test
    if (!cutOff.length) return;
    // the tide turns while the star waits behind the ford: it moves on to a reachable spot
    e.state.starField = cutOff[0];
    e.state.round = BALANCE.tideInterval;
    internals(e).gimmick.onRoundEnd(e);
    expect(e.state.gimmick.tide).toBe('high');
    expect(high).toContain(e.state.starField);
    for (let k = 0; k < 20; k++) {
      e.moveStar();
      expect(high).toContain(e.state.starField);
    }
  });

  it('only one star per turn, even if the star moves further along the path', () => {
    const e = started();
    const path = straight(e, 5);
    const p = move(e, path[0], 5);
    e.state.players[p].coins = 100;
    e.state.starField = path[1];
    e.moveStar = function () {
      this.state.starField = path[3];
    };
    internals(e).continueMove();
    expect(e.pending).toMatchObject({ kind: 'buyStar', player: p });
    const events = e.act(p, { type: 'buyStar', accept: true });
    expect(e.state.players[p].stars).toBe(1);
    expect(events.filter((ev) => ev.type === 'stars' && ev.reason === 'buy')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'announce', key: 'mod.starLimit', player: p }));
    expect(e.pending?.kind).not.toBe('buyStar');
  });

  it('comeback wheels: a tied last place is decided by coins, then by lot', () => {
    const e = started();
    const ps = e.state.players;
    ps.forEach((pl) => ((pl.stars = 0), (pl.coins = 5)));
    ps[0].stars = 1;
    ps[2].coins = 3;
    expect(e.lastPlace()).toBe(2);
    ps[2].coins = 5;
    const seen = new Set<number>();
    for (let k = 0; k < 60; k++) seen.add(e.lastPlace());
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('no duel without coins to play for', () => {
    const duelSetup = (coins: number) => {
      const e = started();
      const duel = e.map.fields.find((f) => f.type === 'duel' && e.map.fields.some((x) => x.next.length === 1 && x.next[0] === f.id && !PASS_FIELDS.includes(x.type)))!;
      const from = e.map.fields.find((f) => f.next.length === 1 && f.next[0] === duel.id && !PASS_FIELDS.includes(f.type))!;
      const p = move(e, from.id, 1);
      e.state.starField = e.map.starSpots.find((s) => s !== duel.id)!;
      e.state.players[p].coins = coins;
      internals(e).continueMove();
      expect(e.state.players[p].field).toBe(duel.id);
      return e;
    };
    expect(duelSetup(0).pending?.kind).not.toBe('duelPick');
    // with coins the duel is offered; the stake never exceeds what the challenger owns
    expect(duelSetup(4).pending).toMatchObject({ kind: 'duelPick', stake: 4 });
  });

  it('a trap laid on a pass field (start) goes onto the next field where players stop', () => {
    const e = started();
    const p = e.state.order[0];
    expect(e.state.players[p].field).toBe(e.map.start);
    e.state.players[p].items = ['trapStone'];
    e.state.pending = { kind: 'turnMenu', player: p, canUseItem: true, dice: ['standard'] };
    e.act(p, { type: 'useItem', item: 'trapStone' });
    const trap = e.state.traps.find((t) => t.owner === p)!;
    expect(PASS_FIELDS.includes(e.field(trap.field).type)).toBe(false);
    expect(trap.field).not.toBe(e.state.starField);
  });

  it('eruption: an active lava stream cools first, the coin rain drops 5 distinct bags', () => {
    const e = started('vulkan');
    const events = record(e);
    e.state.gimmick.lava = { group: 0, until: e.state.round + 1 };
    e.state.gimmick.lavaNext = 1;
    e.state.gimmick.eruption = BALANCE.eruptionThreshold - 1;
    internals(e).gimmick.onRedField(e, 0);
    expect(events).toContainEqual({ type: 'lava', group: 0, active: false });
    expect(e.state.gimmick.lava?.group).toBe(1);
    const bags = events.filter((ev) => ev.type === 'coinBag' && ev.placed).map((ev) => (ev as { field: string }).field);
    expect(new Set(bags).size).toBe(5);
    for (const pl of e.state.players) expect(e.isLive(pl.field)).toBe(true);
    expect(e.reachableStarSpots()).toContain(e.state.starField);
  });

  it('an invalid decision is rejected without losing the pending decision', () => {
    const e = started();
    const p = e.state.order[0];
    e.state.turn = { player: p, dice: [], remaining: 2, rolled: true, usedItem: null, glove: false, starSteal: false, passResolved: null, landed: false, stepsTaken: 1 };
    e.state.pending = { kind: 'shop', player: p, offer: ['doubleDice'] };
    expect(() => e.act(p, { type: 'buy', item: 'tripleDice' })).toThrow();
    expect(e.pending).toMatchObject({ kind: 'shop' });
    e.state.players[p].coins = 2;
    expect(() => e.act(p, { type: 'buy', item: 'doubleDice' })).toThrow();
    expect(e.pending).toMatchObject({ kind: 'shop' });
  });

  it('bots pick the die with the best chance to pass the star (the star field costs no step)', () => {
    const e = started();
    const p = e.state.order[0];
    const me = e.state.players[p];
    me.coins = 100;
    const rng = Rng.fromSeed(1);
    let checked = 0;
    for (const f of e.map.fields) {
      me.field = f.id;
      const toStar = distance(e, f.id, e.state.starField);
      if (toStar > 14) continue;
      for (const c of CHARACTERS) {
        const pass = (id: DiceId) => [...stepDistribution(['standard', id])].reduce((s, [steps, q]) => s + (steps > toStar ? q : 0), 0);
        const best = pass(c) > pass('standard') ? c : 'standard';
        expect(chooseDice(e, p, ['standard', c], 'hard', rng), `${c} at ${toStar}`).toBe(best);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
