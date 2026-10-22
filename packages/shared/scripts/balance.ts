/**
 * Balancing report with bots (review KPIs): comeback chance, bonus stars for the leader,
 * coin economy, star access, strength dominance.
 * Usage: npx tsx scripts/balance.ts [games=60] [strengthGames=games/3] [maps=all, comma separated]
 */
import type { BotLevel } from '../src/config';
import { createGame, GameEngine } from '../src/game/engine';
import { botAction } from '../src/game/bots';
import type { GameConfig, PlayerSetup } from '../src/game/types';
import { CHARACTERS, PLAYER_COLORS } from '../src/config';
import { MAP_IDS } from '../src/maps';
import { makeMgPlayers, runMinigameHeadless } from '../src/minigames/headless';
import { getMinigame } from '../src/minigames/registry';
import { minigameBotLevel } from '../src/minigames/types';
import { Rng } from '../src/rng';

function play(mapId: string, seed: number, levels: BotLevel[]) {
  const config: GameConfig = { mode: 'board', mapId, rounds: 20, seed, teamMode: 'fields', disabledMinigames: [], noMotion: false };
  const setups: PlayerSetup[] = levels.map((l, i) => ({ id: `p${i}`, name: `P${i}`, character: CHARACTERS[i], color: PLAYER_COLORS[i], isBot: true, botLevel: l }));
  const e = new GameEngine(createGame(config, setups));
  const rng = Rng.fromSeed(seed * 7 + 1);
  let lastAfter10 = -1;
  let leaderBeforeBonus = -1;
  let tooExpensive = 0;
  const formats: Record<string, number> = {};
  const count = (evs: { type: string; key?: string }[]) => evs.forEach((ev) => ev.type === 'announce' && ev.key === 'mod.starTooExpensive' && tooExpensive++);
  count(e.start());
  while (e.pending && e.pending.kind !== 'gameOver') {
    const p = e.pending;
    if (e.state.round === 11 && lastAfter10 < 0) lastAfter10 = e.standings()[3];
    if (p.kind === 'minigame') {
      formats[p.format] = (formats[p.format] ?? 0) + 1;
      if (e.state.round === e.state.config.rounds && p.purpose === 'round') leaderBeforeBonus = e.standings()[0];
      const players = makeMgPlayers(p.format, p.teams, 'medium', p.players.length).map((mp, k) => ({ ...mp, botLevel: minigameBotLevel(levels[p.players[k]], rng) }));
      const res = runMinigameHeadless(getMinigame(p.game), players, seed * 31 + e.state.minigameHistory.length);
      count(e.submitMinigame(res.ranks) as never);
    } else count(e.act(p.player, botAction(e, p, rng)) as never);
  }
  const s = e.state;
  return {
    winner: s.ranking![0],
    lastAfter10,
    leaderBeforeBonus,
    bonusToLeader: s.bonus!.filter((b) => b.players.includes(leaderBeforeBonus)).length,
    bonusTotal: s.bonus!.reduce((a, b) => a + (b.players.length ? 1 : 0), 0),
    coins: s.players.map((p) => p.coins),
    starsBought: s.players.reduce((a, p) => a + p.stats.starsBought, 0),
    tooExpensive,
    formats,
  };
}

const games = Number(process.argv[2] ?? 60);
const strength = Number(process.argv[3] ?? Math.max(10, Math.floor(games / 3)));
const maps = process.argv[4] ? process.argv[4].split(',') : MAP_IDS;
/** 95 % confidence half-width of a rate in percentage points */
const ci = (k: number, n: number) => (196 * Math.sqrt((k / n) * (1 - k / n) / n)).toFixed(0);
for (const mapId of maps) {
  let comeback = 0;
  let bonusLeader = 0;
  let bonusAll = 0;
  let coins = 0;
  let bought = 0;
  let expensive = 0;
  const fm: Record<string, number> = {};
  for (let g = 0; g < games; g++) {
    const r = play(mapId, 100 + g, ['medium', 'medium', 'medium', 'medium']);
    if (r.winner === r.lastAfter10) comeback++;
    bonusLeader += r.bonusToLeader;
    bonusAll += r.bonusTotal;
    coins += r.coins.reduce((a, b) => a + b, 0) / 4;
    bought += r.starsBought;
    expensive += r.tooExpensive;
    for (const [k, v] of Object.entries(r.formats)) fm[k] = (fm[k] ?? 0) + v;
  }
  let hardWins = 0;
  for (let g = 0; g < strength; g++) {
    const r = play(mapId, 500 + g, ['hard', 'easy', 'hard', 'easy']);
    if (r.winner === 0 || r.winner === 2) hardWins++;
  }
  const per = (v: number) => (v / games).toFixed(1);
  console.log(
    `${mapId}: comeback(last after R10 wins)=${((comeback / games) * 100).toFixed(0)}±${ci(comeback, games)}% bonusToLeader=${((bonusLeader / Math.max(1, bonusAll)) * 100).toFixed(0)}% ` +
      `avgEndCoins=${per(coins)} starsBought/game=${per(bought)} tooExpensive/game=${per(expensive)} ` +
      `formats/game=${Object.entries(fm).map(([k, v]) => `${k}:${per(v)}`).join(' ')} hardSeatsWin=${((hardWins / strength) * 100).toFixed(0)}±${ci(hardWins, strength)}%`,
  );
}
