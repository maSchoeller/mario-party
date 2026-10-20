import type { BotLevel, CharacterId, PlayerColor } from '../config';
import { CHARACTERS, PLAYER_COLORS } from '../config';
import { Rng } from '../rng';
import type { MgFormat, MgPlayer, MinigameDef } from './types';

export function makeMgPlayers(format: MgFormat, teams?: number[], level: BotLevel = 'medium'): MgPlayer[] {
  const n = format === 'duel' ? 2 : 4;
  const defTeams = format === 'ffa' ? [0, 1, 2, 3] : format === '2v2' ? [0, 0, 1, 1] : format === '1v3' ? [0, 1, 1, 1] : [0, 1];
  return Array.from({ length: n }, (_, i) => ({
    idx: i,
    gameIdx: i,
    team: (teams ?? defTeams)[i],
    character: CHARACTERS[i] as CharacterId,
    color: PLAYER_COLORS[i] as PlayerColor,
    isBot: true,
    botLevel: level,
  }));
}

/** Runs a minigame with bots only (tests, simulations, balancing). */
export function runMinigameHeadless(
  def: MinigameDef,
  players: MgPlayer[],
  seed: number,
  opts: { maxSeconds?: number; dt?: number; practice?: boolean; onTick?: (state: unknown) => void } = {},
): { ranks: number[]; seconds: number; state: unknown } {
  const rng = Rng.fromSeed(seed);
  const botRng = Rng.fromSeed(seed ^ 0x9e3779b9);
  const dt = opts.dt ?? 1 / 30;
  const state = def.setup(players, rng, { practice: !!opts.practice });
  const max = opts.maxSeconds ?? def.duration + 120;
  let t = 0;
  while (!def.isOver(state) && t < max) {
    for (const p of players) {
      if (!p.isBot) continue;
      for (const input of def.bot(state, p.idx, p.botLevel, botRng, dt)) def.input(state, p.idx, input);
    }
    def.tick(state, dt, rng);
    opts.onTick?.(state);
    t += dt;
  }
  return { ranks: def.result(state), seconds: t, state };
}
