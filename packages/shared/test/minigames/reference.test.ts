import { describe, expect, it } from 'vitest';
import { gipfelSprint } from '../../src/minigames/games/gipfelSprint';
import { kokosRegen } from '../../src/minigames/games/kokosRegen';
import { schnellzieher } from '../../src/minigames/games/schnellzieher';
import { Rng } from '../../src/rng';
import { botStrengthOrder, checkMinigameContract } from './contract';

describe.each([kokosRegen, gipfelSprint, schnellzieher])('minigame $id', (def) => {
  it('fulfils the module contract', () => checkMinigameContract(def));
  it('hard bots beat easy bots more often', () => {
    const r = botStrengthOrder(def);
    expect(r.hardWins).toBeGreaterThan(r.easyWins);
  });
});

describe('schnellzieher timing', () => {
  it('uses phone timestamps, not arrival order', () => {
    const players = [0, 1].map((i) => ({ idx: i, gameIdx: i, team: i, character: 'rocco' as const, color: 'red' as const, isBot: false, botLevel: 'easy' as const }));
    const rng = Rng.fromSeed(1);
    const s = schnellzieher.setup(players, rng, { practice: false });
    while (s.phase !== 'signal') schnellzieher.tick(s, 1 / 60, rng);
    const sig = s.signalAt;
    // player 1 pressed earlier on the phone, but the message arrives later
    schnellzieher.tick(s, 0.1, rng);
    schnellzieher.input(s, 0, { type: 'press', t: sig + 0.09 });
    schnellzieher.input(s, 1, { type: 'press', t: sig + 0.05 });
    schnellzieher.tick(s, 0.5, rng);
    expect(s.roundWinner).toBe(1);
  });
  it('false start loses the round', () => {
    const players = [0, 1].map((i) => ({ idx: i, gameIdx: i, team: i, character: 'rocco' as const, color: 'red' as const, isBot: false, botLevel: 'easy' as const }));
    const rng = Rng.fromSeed(2);
    const s = schnellzieher.setup(players, rng, { practice: false });
    schnellzieher.tick(s, 0.5, rng);
    schnellzieher.input(s, 0, { type: 'press', t: 0.5 });
    expect(s.wins).toEqual([0, 1]);
  });
});
