/**
 * Dice balancing (v0.3): equal medium bots, characters rotated through all seats, so the
 * only systematic difference is the character die. Reports per character the win rate,
 * stars, coins and fields walked, plus per map the average fields per turn and how often
 * players pass the star.
 *   npx tsx packages/shared/scripts/dice-balance.ts [gamesPerMap=48]
 */
import { CHARACTERS, PLAYER_COLORS, type CharacterId } from '../src/config';
import { botAction } from '../src/game/bots';
import { createGame, GameEngine } from '../src/game/engine';
import type { GameConfig, PlayerSetup } from '../src/game/types';
import { MAP_IDS } from '../src/maps';
import { makeMgPlayers, runMinigameHeadless } from '../src/minigames/headless';
import { getMinigame } from '../src/minigames/registry';
import { Rng } from '../src/rng';

const games = Number(process.argv[2] ?? 48);
type Acc = { games: number; wins: number; stars: number; coins: number; walked: number; place: number };
const per = new Map<CharacterId, Acc>(CHARACTERS.map((c) => [c, { games: 0, wins: 0, stars: 0, coins: 0, walked: 0, place: 0 }]));

for (const mapId of MAP_IDS) {
  let turns = 0;
  let steps = 0;
  let bought = 0;
  let backwards = 0;
  for (let g = 0; g < games; g++) {
    const seed = 5000 + g * 13 + mapId.length;
    // 8 characters, 4 seats: two disjoint groups alternate, seats rotate
    const group = g % 2 === 0 ? CHARACTERS.slice(0, 4) : CHARACTERS.slice(4);
    const rot = Math.floor(g / 2) % 4;
    const chars = group.map((_, i) => group[(i + rot) % 4]);
    const setups: PlayerSetup[] = chars.map((c, i) => ({ id: `p${i}`, name: `P${i}`, character: c, color: PLAYER_COLORS[i], isBot: true, botLevel: 'medium' }));
    const config: GameConfig = { mode: 'board', mapId, rounds: 20, seed, teamMode: 'fields', disabledMinigames: [], noMotion: false };
    const e = new GameEngine(createGame(config, setups));
    const rng = Rng.fromSeed(seed + 1);
    e.start();
    while (e.pending && e.pending.kind !== 'gameOver') {
      const p = e.pending;
      if (p.kind === 'minigame') {
        const players = makeMgPlayers(p.format, p.teams, 'medium', p.players.length);
        e.submitMinigame(runMinigameHeadless(getMinigame(p.game), players, seed + e.state.minigameHistory.length).ranks);
      } else {
        for (const ev of e.act(p.player, botAction(e, p, rng))) {
          if (ev.type === 'dice' && e.state.stage === 'turns') {
            turns++;
            steps += ev.total;
            if (ev.total < 0) backwards++;
          }
        }
      }
    }
    const s = e.state;
    s.players.forEach((pl, i) => {
      const a = per.get(pl.character)!;
      a.games++;
      if (s.ranking![0] === i) a.wins++;
      a.place += s.ranking!.indexOf(i) + 1;
      a.stars += pl.stars;
      a.coins += pl.coins;
      a.walked += pl.stats.fieldsWalked;
      bought += pl.stats.starsBought;
    });
  }
  console.log(`${mapId}: Ø ${(steps / turns).toFixed(2)} Felder/Zug, rückwärts ${((backwards / turns) * 100).toFixed(1)} % der Züge, gekaufte Sterne/Partie ${(bought / games).toFixed(2)}`);
}
console.log('\nFigur      Siege  Ø Platz  Ø Sterne  Ø Münzen  Ø Felder');
for (const [c, a] of per) {
  console.log(
    `${c.padEnd(9)} ${((a.wins / a.games) * 100).toFixed(1).padStart(5)} %  ${(a.place / a.games).toFixed(2).padStart(6)}  ${(a.stars / a.games).toFixed(2).padStart(8)}  ${(a.coins / a.games).toFixed(1).padStart(8)}  ${(a.walked / a.games).toFixed(0).padStart(8)}`,
  );
}
