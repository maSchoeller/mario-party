/**
 * Headless full-game simulation with 4 bots (acceptance: complete 20-round games on
 * every map without crash). Usage: npm run simulate -- [games=3] [rounds=20]
 */
import { CHARACTERS, PLAYER_COLORS, type RoundCount } from '../src/config';
import { botAction } from '../src/game/bots';
import { createGame, GameEngine } from '../src/game/engine';
import type { GameConfig, GameEvent, GameState, PlayerSetup } from '../src/game/types';
import { MAP_IDS } from '../src/maps';
import { makeMgPlayers, runMinigameHeadless } from '../src/minigames/headless';
import { getMinigame } from '../src/minigames/registry';
import { Rng } from '../src/rng';

export function simulateGame(mapId: string, seed: number, rounds: RoundCount = 20, mode: 'board' | 'marathon' = 'board') {
  const config: GameConfig = { mode, mapId, rounds, seed, teamMode: 'fields', disabledMinigames: [], noMotion: false };
  const setups: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({
    id: `p${i}`,
    name: `Bot ${i}`,
    character: CHARACTERS[i],
    color: PLAYER_COLORS[i],
    isBot: true,
    botLevel: (['easy', 'medium', 'hard', 'hard'] as const)[i],
  }));
  let state: GameState = createGame(config, setups);
  let engine = new GameEngine(state);
  const botRng = Rng.fromSeed(seed + 1);
  const events: GameEvent[] = [];
  events.push(...engine.start());
  let guard = 0;
  const minigames: string[] = [];
  while (engine.pending && engine.pending.kind !== 'gameOver') {
    if (++guard > 100000) throw new Error('no progress');
    const p = engine.pending;
    if (p.kind === 'minigame') {
      const def = getMinigame(p.game);
      const players = makeMgPlayers(p.format, p.teams);
      const res = runMinigameHeadless(def, players, seed + guard);
      minigames.push(p.game);
      events.push(...engine.submitMinigame(res.ranks));
    } else {
      events.push(...engine.act(p.player, botAction(engine, p, botRng)));
    }
    // serialization round trip at every step (TECH-04)
    if (guard % 7 === 0) {
      state = JSON.parse(JSON.stringify(engine.state));
      engine = new GameEngine(state);
    }
  }
  return { state: engine.state, events, minigames };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = Number(process.argv[2] ?? 3);
  const rounds = Number(process.argv[3] ?? 20) as RoundCount;
  for (const mapId of MAP_IDS) {
    for (let g = 0; g < games; g++) {
      const t0 = Date.now();
      const { state, events, minigames } = simulateGame(mapId, 1000 + g, rounds);
      const count = (type: string) => events.filter((e) => e.type === type).length;
      const gimmick = count('tide') + count('eruption') + count('train');
      console.log(
        `${mapId} #${g}: ${Date.now() - t0}ms winner=${state.ranking?.[0]} stars=${state.players.map((p) => p.stars)} coins=${state.players.map((p) => p.coins)} starsBought=${state.players.map((p) => p.stats.starsBought)} minigames=${minigames.length} gimmickEvents=${gimmick} duels=${events.filter((e) => e.type === 'minigameResult').length - minigames.length + minigames.length}`,
      );
    }
  }
}
