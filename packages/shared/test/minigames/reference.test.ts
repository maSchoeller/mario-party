import { describe, expect, it } from 'vitest';
import { gipfelSprint } from '../../src/minigames/games/gipfelSprint';
import { kokosRegen } from '../../src/minigames/games/kokosRegen';
import { schnellzieher } from '../../src/minigames/games/schnellzieher';
import { Rng } from '../../src/rng';
import { makeMgPlayers } from '../../src/minigames/headless';
import { botStrengthOrder, checkMinigameContract, playStats } from './contract';

describe.each([kokosRegen, gipfelSprint, schnellzieher])('minigame $id', (def) => {
  it('fulfils the module contract', () => checkMinigameContract(def));
  it('hard bots beat easy bots more often', () => {
    const r = botStrengthOrder(def);
    expect(r.hardWins).toBeGreaterThan(r.easyWins);
  });
});

describe('kokosRegen tie-break', () => {
  it('same coconuts: fewer stone hits first, then whoever got there earlier', () => {
    const players = makeMgPlayers('ffa').map((p) => ({ ...p, isBot: false }));
    const s = kokosRegen.setup(players, Rng.fromSeed(4), { practice: false });
    const set = (i: number, score: number, hits: number, scoreAt: number) => Object.assign(s.ps[i], { score, hits, scoreAt });
    set(0, 8, 1, 20);
    set(1, 8, 0, 30);
    set(2, 8, 0, 25);
    set(3, 9, 3, 39);
    expect(kokosRegen.result(s)).toEqual([3, 2, 1, 0]);
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

describe('play time (MINI-03, medium bots)', () => {
  it.each([gipfelSprint, schnellzieher])('$id: median ≥ 25 s, never over before 15 s', (def) => {
    const { median, secs } = playStats(def, 10);
    expect(median).toBeGreaterThanOrEqual(25);
    expect(secs[0]).toBeGreaterThanOrEqual(15);
  });
});

describe('schnellzieher rules', () => {
  it('best of 5: the duel goes on after two round wins and ends with the third', () => {
    const players = makeMgPlayers('duel').map((p) => ({ ...p, isBot: false }));
    const rng = Rng.fromSeed(3);
    const s = schnellzieher.setup(players, rng, { practice: false });
    for (let round = 1; round <= 3; round++) {
      while (s.phase !== 'signal') schnellzieher.tick(s, 1 / 60, rng);
      schnellzieher.input(s, 0, { type: 'press', t: s.t });
      while (s.phase === 'signal' || (s.phase === 'resolved' && !schnellzieher.isOver(s) && s.round === round)) schnellzieher.tick(s, 1 / 60, rng);
      expect(s.wins[0]).toBe(round);
      expect(schnellzieher.isOver(s)).toBe(round === 3);
    }
    expect(schnellzieher.result(s)).toEqual([0, 1]);
  });
  it('bots react with the display lag of a human: hard ≥ 0.33 s on average', () => {
    const avg = (level: 'easy' | 'medium' | 'hard') => {
      let sum = 0;
      const n = 40;
      for (let k = 0; k < n; k++) {
        const rng = Rng.fromSeed(100 + k);
        const s = schnellzieher.setup(makeMgPlayers('duel', undefined, level), rng, { practice: false });
        while (s.phase !== 'signal') schnellzieher.tick(s, 1 / 60, rng);
        let pressed: number | null = null;
        while (pressed === null) {
          const out = schnellzieher.bot(s, 0, level, rng, 1 / 60);
          if (out.length && out[0].type === 'press') pressed = out[0].t;
          else s.t += 1 / 60;
        }
        sum += pressed - s.signalAt;
      }
      return sum / n;
    };
    const hard = avg('hard');
    expect(hard).toBeGreaterThanOrEqual(0.33);
    expect(avg('medium')).toBeGreaterThan(hard);
    expect(avg('easy')).toBeGreaterThan(avg('medium'));
  });
});

describe('gipfelSprint tap gate (v0.5)', () => {
  it('counts at most 10 taps per second – two-thumb drumming gives no edge', () => {
    const players = makeMgPlayers('ffa').map((p) => ({ ...p, isBot: false }));
    const rng = Rng.fromSeed(4);
    const s = gipfelSprint.setup(players, rng, { practice: false });
    for (let k = 0; k < 60; k++) {
      gipfelSprint.tick(s, 1 / 60, rng);
      // player 0 drums 120 taps/s, player 1 taps 6 times a second
      gipfelSprint.input(s, 0, { type: 'tap' });
      gipfelSprint.input(s, 0, { type: 'tap' });
      if (k % 10 === 0) gipfelSprint.input(s, 1, { type: 'tap' });
    }
    expect(s.ps[0].progress).toBeLessThanOrEqual(10);
    expect(s.ps[0].progress).toBeGreaterThanOrEqual(8);
    expect(s.ps[1].progress).toBe(6);
  });
});

describe('schnellzieher bot false starts (v0.5)', () => {
  it('are rolled once per round, independent of the tick rate', () => {
    const rate = (dt: number) => {
      let fs = 0;
      const n = 300;
      for (let k = 0; k < n; k++) {
        const rng = Rng.fromSeed(500 + k);
        const s = schnellzieher.setup(makeMgPlayers('duel', undefined, 'easy'), rng, { practice: false });
        let jumped = false;
        while (s.phase === 'wait' && !jumped) {
          for (const inp of schnellzieher.bot(s, 0, 'easy', rng, dt)) {
            schnellzieher.input(s, 0, inp);
            jumped = s.falseStart === 0;
          }
          schnellzieher.tick(s, dt, rng);
        }
        if (jumped) fs++;
      }
      return fs / n;
    };
    for (const dt of [1 / 60, 1 / 20]) {
      expect(rate(dt)).toBeGreaterThan(0.03);
      expect(rate(dt)).toBeLessThan(0.14);
    }
  });
});
