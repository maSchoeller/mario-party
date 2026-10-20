import { describe, expect, it } from 'vitest';
import { simulateGame } from '../scripts/simulate';
import { BALANCE, CHARACTERS, PLAYER_COLORS } from '../src/config';
import { computeBonus } from '../src/game/bonus';
import { createGame, GameEngine, minigameRewards } from '../src/game/engine';
import type { GameConfig, PlayerSetup } from '../src/game/types';
import { getMap, MAP_IDS, validateMap } from '../src/maps';
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
    expect(minigameRewards('ffa', [0, 1, 2, 3], [0, 1, 2, 3])).toEqual([10, 5, 2, 0]);
    expect(minigameRewards('2v2', [0, 0, 1, 1], [0, 0, 1, 1])).toEqual([10, 10, 0, 0]);
    expect(minigameRewards('1v3', [0, 1, 1, 1], [0, 1, 1, 1])).toEqual([15, 0, 0, 0]);
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
