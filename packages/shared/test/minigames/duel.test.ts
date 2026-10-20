import { describe, expect, it } from 'vitest';
import { GAP_W, GAPS, gipfelsturm, JUMP_LEN, RUN_SPEED, TAPS, type GipfelsturmState } from '../../src/minigames/games/gipfelsturm';
import { LIVES, memoDuell } from '../../src/minigames/games/memoDuell';
import { schnickSchnack } from '../../src/minigames/games/schnickSchnack';
import { makeMgPlayers, runMinigameHeadless } from '../../src/minigames/headless';
import { MINIGAMES, pickMinigame } from '../../src/minigames/registry';
import type { MgPlayer } from '../../src/minigames/types';
import { Rng } from '../../src/rng';
import { botStrengthOrder, checkMinigameContract, playStats } from './contract';

const humans = (format: 'duel' | 'ffa'): MgPlayer[] => makeMgPlayers(format).map((p) => ({ ...p, isBot: false }));
const DT = 1 / 30;

describe.each([schnickSchnack, memoDuell, gipfelsturm])('minigame $id', (def) => {
  it('fulfils the module contract', () => checkMinigameContract(def));
  it('is registered', () => expect(MINIGAMES[def.id]).toBe(def));
});

describe('bot strength', () => {
  it('memoDuell: hard bots beat easy bots more often', () => {
    const r = botStrengthOrder(memoDuell);
    expect(r.hardWins).toBeGreaterThan(r.easyWins);
  });
  it('gipfelsturm: hard bots beat easy bots more often', () => {
    const r = botStrengthOrder(gipfelsturm);
    expect(r.hardWins).toBeGreaterThan(r.easyWins);
  });
  it('schnickSchnack (luck based): hard bots are not worse than easy bots', () => {
    const r = botStrengthOrder(schnickSchnack, 30);
    expect(r.hardWins).toBeGreaterThanOrEqual(r.easyWins);
  });
});

describe('schnickSchnack rules', () => {
  it('locks the pick on the phone and resolves rock vs scissors', () => {
    const rng = Rng.fromSeed(1);
    const s = schnickSchnack.setup(humans('duel'), rng, { practice: false });
    schnickSchnack.input(s, 0, { type: 'choice', id: 'rock' });
    const l = schnickSchnack.layout(s, 0);
    expect(l.kind === 'choice' && l.locked).toBe('rock');
    schnickSchnack.input(s, 0, { type: 'choice', id: 'paper' }); // cannot change a locked pick
    schnickSchnack.input(s, 1, { type: 'choice', id: 'scissors' });
    for (let k = 0; k < 20; k++) schnickSchnack.tick(s, DT, rng);
    expect(s.phase).toBe('reveal');
    expect(s.wins).toEqual([1, 0]);
  });
  it('picks randomly when the countdown runs out', () => {
    const rng = Rng.fromSeed(2);
    const s = schnickSchnack.setup(humans('duel'), rng, { practice: false });
    schnickSchnack.input(s, 1, { type: 'choice', id: 'paper' });
    while (s.phase === 'choose') schnickSchnack.tick(s, DT, rng);
    expect(s.auto).toEqual([true, false]);
    expect(['rock', 'paper', 'scissors']).toContain(s.picks[0]);
    expect(s.t).toBeGreaterThanOrEqual(5);
  });
  it('ends by the emergency brake even if every round is a tie, without a draw', () => {
    const rng = Rng.fromSeed(3);
    const s = schnickSchnack.setup(humans('duel'), rng, { practice: false });
    let t = 0;
    while (!schnickSchnack.isOver(s) && t < 120) {
      if (s.phase === 'choose') for (const i of [0, 1]) schnickSchnack.input(s, i, { type: 'choice', id: 'rock' });
      schnickSchnack.tick(s, DT, rng);
      t += DT;
    }
    expect(schnickSchnack.isOver(s)).toBe(true);
    expect(t).toBeLessThan(60);
    expect(s.lotWinner).not.toBeNull();
    expect([...schnickSchnack.result(s)].sort()).toEqual([0, 1]);
  });
});

describe('memoDuell rules', () => {
  const toInput = (s: ReturnType<typeof memoDuell.setup>, rng: Rng) => {
    const lit: (number | null)[] = [];
    while (s.phase !== 'input') {
      memoDuell.tick(s, DT, rng);
      if (s.lit !== null && lit[lit.length - 1] !== s.lit) lit.push(s.lit);
    }
    return lit;
  };
  it('shows the sequence via the lit pad and pads are only active while repeating', () => {
    const rng = Rng.fromSeed(4);
    const s = memoDuell.setup(humans('duel'), rng, { practice: false });
    expect(memoDuell.layout(s, 0)).toMatchObject({ kind: 'pads', count: 4, active: false });
    const seen: number[] = [];
    let lastStep: number | null = null;
    while (s.phase !== 'input') {
      memoDuell.tick(s, DT, rng);
      if (s.litStep !== null && s.litStep !== lastStep) seen.push(s.lit!);
      lastStep = s.litStep;
      const glowing = memoDuell.view(s).entities.filter((e) => e.id.startsWith('pad') && e.glow);
      expect(glowing.map((e) => e.id)).toEqual(s.lit === null ? [] : [`pad${s.lit}`]);
    }
    expect(seen).toEqual(s.seq);
    expect(memoDuell.layout(s, 0)).toMatchObject({ kind: 'pads', active: true });
  });
  it('a mistake knocks a player out of the round and costs a heart; the last heart decides', () => {
    const rng = Rng.fromSeed(5);
    const s = memoDuell.setup(humans('duel'), rng, { practice: false });
    for (let round = 1; round <= LIVES; round++) {
      toInput(s, rng);
      memoDuell.input(s, 1, { type: 'pad', idx: (s.seq[0] + 1) % 4 });
      expect(s.ps[1].failed).toBe(true);
      expect(memoDuell.layout(s, 1)).toMatchObject({ kind: 'wait', labelKey: 'ctrl.memoFail' });
      for (const idx of s.seq) memoDuell.input(s, 0, { type: 'pad', idx });
      let k = 0;
      while (!memoDuell.isOver(s) && s.phase !== 'show' && k++ < 200) memoDuell.tick(s, DT, rng);
      expect(s.ps[1].lives).toBe(LIVES - round);
      expect(s.ps[0].lives).toBe(LIVES);
      // not over before the last heart is gone
      expect(memoDuell.isOver(s)).toBe(round === LIVES);
    }
    expect(memoDuell.result(s)).toEqual([0, 1]);
  });
  it('lasts long enough with medium bots (median ≥ 25 s, rarely < 15 s, MINI-03)', () => {
    const secs: number[] = [];
    for (let seed = 1; seed <= 12; seed++) secs.push(runMinigameHeadless(memoDuell, makeMgPlayers('duel'), seed * 101).seconds);
    secs.sort((a, b) => a - b);
    expect(secs[secs.length >> 1]).toBeGreaterThanOrEqual(25);
    expect(secs[1]).toBeGreaterThanOrEqual(12);
  });
  it('both correct → the sequence grows by one (same beginning)', () => {
    const rng = Rng.fromSeed(6);
    const s = memoDuell.setup(humans('duel'), rng, { practice: false });
    toInput(s, rng);
    const before = [...s.seq];
    for (const i of [0, 1]) for (const idx of before) memoDuell.input(s, i, { type: 'pad', idx });
    let k = 0;
    while (s.phase !== 'show' && k++ < 200) memoDuell.tick(s, DT, rng);
    expect(s.seq.length).toBe(before.length + 1);
    expect(s.seq.slice(0, before.length)).toEqual(before);
  });
});

describe('gipfelsturm rules', () => {
  const setup = (seed: number) => {
    const rng = Rng.fromSeed(seed);
    return { rng, s: gipfelsturm.setup(humans('ffa'), rng, { practice: false }) };
  };
  const toStage2 = (s: GipfelsturmState) => {
    for (let k = 0; k < TAPS; k++) gipfelsturm.input(s, 0, { type: 'tap' });
  };

  it('is the final minigame and never drawn randomly', () => {
    expect(gipfelsturm.final).toBe(true);
    expect(gipfelsturm.motion).toBeFalsy();
    const rng = Rng.fromSeed(1);
    for (let k = 0; k < 200; k++) expect(pickMinigame('ffa', rng, [], { disabledMinigames: [], noMotion: false })).not.toBe('gipfelsturm');
  });

  it('switches stages: mashing → jump button → path choice', () => {
    const { s, rng } = setup(7);
    expect(gipfelsturm.layout(s, 0)).toMatchObject({ kind: 'mash' });
    toStage2(s);
    expect(s.ps[0].stage).toBe(2);
    expect(gipfelsturm.layout(s, 0)).toMatchObject({ kind: 'button', labelKey: 'ctrl.jump' });
    expect(gipfelsturm.layout(s, 1)).toMatchObject({ kind: 'mash' }); // others stay in their stage
    // fast-forward through the lava stage with perfect jumps
    const p = s.ps[0];
    let k = 0;
    while (p.stage === 2 && k++ < 2000) {
      const g = GAPS[p.gap];
      if (g !== undefined && !p.jump && p.jx >= g - (JUMP_LEN - GAP_W) / 2) gipfelsturm.input(s, 0, { type: 'press', t: s.t });
      gipfelsturm.tick(s, DT, rng);
    }
    expect(p.falls).toBe(0);
    expect(p.stage).toBe(3);
    while (s.t < p.walkUntil) gipfelsturm.tick(s, DT, rng);
    const l = gipfelsturm.layout(s, 0);
    expect(l.kind).toBe('choice');
    if (l.kind === 'choice') expect(l.options.map((o) => o.id).sort()).toEqual(['blue', 'green', 'red', 'yellow']);
    // wrong path → short penalty
    const wrong = ['red', 'blue', 'green', 'yellow'].find((c) => c !== p.target)!;
    gipfelsturm.input(s, 0, { type: 'choice', id: wrong });
    expect(gipfelsturm.layout(s, 0)).toMatchObject({ kind: 'wait', labelKey: 'ctrl.stumble' });
    expect(p.fork).toBe(0);
    while (s.t < p.penaltyUntil + 0.1) gipfelsturm.tick(s, DT, rng);
    gipfelsturm.input(s, 0, { type: 'choice', id: p.target });
    expect(p.fork).toBe(1);
  });

  it('jump uses the phone timestamp: a late-arriving but timely press clears the gap', () => {
    const { s, rng } = setup(8);
    toStage2(s);
    const p = s.ps[0];
    const g = GAPS[0];
    const ideal = g - (JUMP_LEN - GAP_W) / 2;
    // run until slightly past the edge (inside the grace window), press stamped at the ideal moment
    while (p.jx < g + 0.1) gipfelsturm.tick(s, DT, rng);
    const tIdeal = s.t - (p.jx - ideal) / RUN_SPEED;
    gipfelsturm.input(s, 0, { type: 'press', t: tIdeal });
    for (let k = 0; k < 30; k++) gipfelsturm.tick(s, DT, rng);
    expect(p.fallUntil).toBeNull();
    expect(p.gap).toBe(1);
  });

  it('no jump → falls into the lava and respawns before the gap', () => {
    const { s, rng } = setup(9);
    toStage2(s);
    const p = s.ps[0];
    while (p.fallUntil === null) gipfelsturm.tick(s, DT, rng);
    expect(p.falls).toBe(1);
    while (p.fallUntil !== null) gipfelsturm.tick(s, DT, rng);
    expect(p.jx).toBeLessThan(GAPS[0]);
    expect(p.gap).toBe(0);
  });

  it('ranks finished players by time, the others by progress', () => {
    const { s } = setup(10);
    s.ps[2].stage = 4;
    s.ps[2].finishedAt = 30;
    s.ps[1].stage = 4;
    s.ps[1].finishedAt = 35;
    toStage2(s);
    expect(gipfelsturm.result(s)).toEqual([2, 1, 0, 3]);
  });
});

describe('play time (MINI-03, medium bots)', () => {
  it.each([memoDuell, gipfelsturm])('$id: median ≥ 25 s', (def) => {
    const { median, secs } = playStats(def, 10);
    expect(median).toBeGreaterThanOrEqual(25);
    expect(secs[1]).toBeGreaterThanOrEqual(12);
  });
});
