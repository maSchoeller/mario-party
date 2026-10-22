import { describe, expect, it } from 'vitest';
import { lavaSeil } from '../../src/minigames/games/lavaSeil';
import { schubsScholle } from '../../src/minigames/games/schubsScholle';
import { SHAPES, strichKuenstler, strokePoints, strokeQuality } from '../../src/minigames/games/strichKuenstler';
import { wackelBruecke } from '../../src/minigames/games/wackelBruecke';
import { zaehlZoo } from '../../src/minigames/games/zaehlZoo';
import { zehnSekunden } from '../../src/minigames/games/zehnSekunden';
import { makeMgPlayers } from '../../src/minigames/headless';
import { Rng } from '../../src/rng';
import { botStrengthOrder, checkMinigameContract, playStats } from './contract';

const GAMES = [schubsScholle, wackelBruecke, zehnSekunden, strichKuenstler, zaehlZoo, lavaSeil];
const humans = () => makeMgPlayers('ffa').map((p) => ({ ...p, isBot: false }));

describe.each(GAMES)('minigame $id', (def) => {
  it('fulfils the module contract', () => checkMinigameContract(def));
  it('hard bots beat easy bots more often', () => {
    const r = botStrengthOrder(def);
    expect(r.hardWins).toBeGreaterThan(r.easyWins);
  });
  it('is an ffa game with the planned control', () => {
    expect(def.format).toBe('ffa');
    const planned = { schubsScholle: 'joystick', wackelBruecke: 'motion', zehnSekunden: 'tap', strichKuenstler: 'draw', zaehlZoo: 'draw', lavaSeil: 'tap' } as const;
    expect(def.control).toBe(planned[def.id as keyof typeof planned]);
  });
});

describe('schubsScholle', () => {
  it('ranks by elimination order, survivors share first place', () => {
    const rng = Rng.fromSeed(1);
    const s = schubsScholle.setup(humans(), rng, { practice: false });
    schubsScholle.tick(s, 1 / 30, rng);
    s.ps[1].x = 20; // off the floe
    schubsScholle.tick(s, 1 / 30, rng);
    expect(s.ps[1].out).not.toBeNull();
    expect(schubsScholle.layout(s, 1).kind).toBe('wait');
    for (let k = 0; k < 30; k++) schubsScholle.tick(s, 1 / 30, rng);
    s.ps[3].x = -20;
    schubsScholle.tick(s, 1 / 30, rng);
    expect(schubsScholle.isOver(s)).toBe(false);
    expect(schubsScholle.result(s)).toEqual([0, 3, 0, 2]);
  });
  it('a dash throws the other player away', () => {
    const rng = Rng.fromSeed(2);
    const s = schubsScholle.setup(humans(), rng, { practice: false });
    Object.assign(s.ps[0], { x: 0, z: 0, cd: 0 });
    Object.assign(s.ps[1], { x: 1.8, z: 0 });
    schubsScholle.input(s, 0, { type: 'stick', x: 1, y: 0 });
    schubsScholle.input(s, 0, { type: 'button', id: 'push', down: true });
    for (let k = 0; k < 6; k++) schubsScholle.tick(s, 1 / 30, rng);
    expect(s.ps[1].vx).toBeGreaterThan(5);
    expect(s.ps[0].cd).toBeGreaterThan(0);
  });
  it('practice: falling off respawns instead of eliminating', () => {
    const rng = Rng.fromSeed(3);
    const s = schubsScholle.setup(humans(), rng, { practice: true });
    s.ps[0].x = 20;
    for (let k = 0; k < 60; k++) schubsScholle.tick(s, 1 / 30, rng);
    expect(s.ps[0].out).toBeNull();
    expect(s.ps[0].fallT).toBeNull();
  });
});

describe('wackelBruecke', () => {
  it('tilting forward rolls the marble towards the goal, falling restarts at the checkpoint', () => {
    const rng = Rng.fromSeed(4);
    const s = wackelBruecke.setup(humans(), rng, { practice: false });
    s.windTarget = 0;
    s.windIn = 99;
    wackelBruecke.input(s, 0, { type: 'tilt', x: 0, y: 1 });
    for (let k = 0; k < 30; k++) {
      s.ps[0].x = 0;
      s.ps[0].vx = 0;
      wackelBruecke.tick(s, 1 / 30, rng);
    }
    expect(s.ps[0].z).toBeGreaterThan(1);
    Object.assign(s.ps[0], { z: 20, best: 20, cp: 14, x: 1.5 });
    wackelBruecke.tick(s, 1 / 30, rng);
    expect(s.ps[0].fallT).not.toBeNull();
    for (let k = 0; k < 40; k++) wackelBruecke.tick(s, 1 / 30, rng);
    expect(s.ps[0].fallT).toBeNull();
    expect(s.ps[0].z).toBeCloseTo(14, 0);
    expect(s.ps[0].best).toBeCloseTo(20, 0);
  });
  it('finishers rank by time ahead of everybody else', () => {
    const rng = Rng.fromSeed(5);
    const s = wackelBruecke.setup(humans(), rng, { practice: false });
    s.ps[2].finishedAt = 30;
    s.ps[0].finishedAt = 25;
    s.ps[1].best = 60;
    s.ps[3].best = 10;
    expect(wackelBruecke.result(s)).toEqual([0, 2, 1, 3]);
  });
});

describe('zehnSekunden', () => {
  it('uses the phone timestamp, not the arrival time', () => {
    const rng = Rng.fromSeed(6);
    const s = zehnSekunden.setup(humans(), rng, { practice: false });
    zehnSekunden.input(s, 0, { type: 'press', t: 0.5 }); // during intro: ignored
    expect(s.presses[0]).toBeNull();
    while (s.phase !== 'run') zehnSekunden.tick(s, 1 / 60, rng);
    while (s.t < s.startAt + 10.4) zehnSekunden.tick(s, 1 / 60, rng);
    // pressed at exactly 10.00 s on the phone, message arrives 0.4 s later
    zehnSekunden.input(s, 0, { type: 'press', t: s.startAt + 10 });
    zehnSekunden.input(s, 0, { type: 'press', t: s.startAt + 10.3 }); // second press ignored
    zehnSekunden.input(s, 1, { type: 'press', t: s.t });
    expect(s.presses[0]).toBeCloseTo(10, 5);
    expect(s.presses[1]).toBeCloseTo(10.4, 1);
  });
  it('sums the deviations over 2 rounds, smaller wins', () => {
    const rng = Rng.fromSeed(7);
    const s = zehnSekunden.setup(humans(), rng, { practice: false });
    const want = [10, 9.5, 11, 10.1];
    for (let round = 0; round < 2; round++) {
      while (s.phase !== 'run') zehnSekunden.tick(s, 1 / 30, rng);
      while (s.phase === 'run') {
        zehnSekunden.tick(s, 1 / 30, rng);
        // each press arrives one tick after it was made on the phone
        want.forEach((v, i) => {
          if (s.phase === 'run' && s.presses[i] === null && s.t >= s.startAt + v) zehnSekunden.input(s, i, { type: 'press', t: s.startAt + v });
        });
      }
      expect(s.phase).toBe('reveal');
    }
    while (!zehnSekunden.isOver(s)) zehnSekunden.tick(s, 1 / 30, rng);
    expect(s.total.map((v) => Math.round(v * 100) / 100)).toEqual([0, 1, 2, 0.2]);
    expect(zehnSekunden.result(s)).toEqual([0, 2, 3, 1]);
  });
});

describe('strichKuenstler', () => {
  it('an exact trace scores near 100, a scribble scores low', () => {
    const star = SHAPES.star;
    const exact = strokeQuality(star, star);
    expect(exact.quality).toBeGreaterThan(0.97);
    expect(strokePoints(exact.quality, 2)).toBeGreaterThanOrEqual(97);
    const half = strokeQuality(star, star.slice(0, 6));
    expect(half.coverage).toBeLessThan(0.65);
    const line = strokeQuality(star, [[0.1, 0.9], [0.9, 0.1]]);
    expect(line.quality).toBeLessThan(0.45);
    expect(strokePoints(exact.quality, 2)).toBeGreaterThan(strokePoints(exact.quality, 11));
  });
  it('accepts one stroke per shape and ignores accidental taps', () => {
    const rng = Rng.fromSeed(8);
    const s = strichKuenstler.setup(humans(), rng, { practice: false });
    while (s.phase !== 'draw') strichKuenstler.tick(s, 1 / 30, rng);
    const shape = strichKuenstler.layout(s, 0);
    expect(shape.kind).toBe('draw');
    if (shape.kind !== 'draw') return;
    strichKuenstler.input(s, 0, { type: 'draw', points: [[0.5, 0.5], [0.51, 0.5], [0.5, 0.51]], duration: 0.1 });
    expect(s.ps[0].pts).toBeNull();
    strichKuenstler.input(s, 0, { type: 'draw', points: shape.shape, duration: 2 });
    expect(s.ps[0].pts).toBeGreaterThan(90);
    strichKuenstler.input(s, 0, { type: 'draw', points: [[0, 0], [1, 1], [0, 1]], duration: 1 });
    expect(s.ps[0].pts).toBeGreaterThan(90);
    expect(strichKuenstler.layout(s, 0).kind).toBe('wait');
  });
});

describe('zaehlZoo', () => {
  it('the parade contains exactly `count` animals of the wanted sort, closest guess wins', () => {
    const rng = Rng.fromSeed(9);
    const s = zaehlZoo.setup(humans(), rng, { practice: false });
    expect(s.animals.filter((a) => a.sort === s.target)).toHaveLength(s.count);
    while (s.phase !== 'guess') zaehlZoo.tick(s, 1 / 30, rng);
    expect(zaehlZoo.layout(s, 0).kind).toBe('number');
    zaehlZoo.input(s, 0, { type: 'number', value: s.count });
    zaehlZoo.input(s, 1, { type: 'number', value: s.count + 3 });
    zaehlZoo.input(s, 1, { type: 'number', value: s.count }); // only the first answer counts
    zaehlZoo.input(s, 2, { type: 'number', value: s.count - 1 });
    zaehlZoo.tick(s, 1 / 30, rng);
    expect(s.phase).toBe('guess');
    zaehlZoo.input(s, 3, { type: 'number', value: 999 });
    zaehlZoo.tick(s, 1 / 30, rng);
    expect(s.phase).toBe('reveal');
    expect(s.total.slice(0, 3)).toEqual([0, 3, 1]);
    expect(s.total[3]).toBe(40 - s.count);
    expect(zaehlZoo.result(s)).toEqual([0, 2, 1, 3]);
  });
  it('later rounds are harder (more animals, look-alikes)', () => {
    const rng = Rng.fromSeed(10);
    const s = zaehlZoo.setup(humans(), rng, { practice: false });
    const first = s.animals.length;
    while (s.round < 3) zaehlZoo.tick(s, 1 / 30, rng);
    expect(s.animals.length).toBeGreaterThan(first);
    expect(new Set(s.animals.map((a) => a.sort)).size).toBe(4);
  });
});

describe('lavaSeil', () => {
  function untilPass(s: ReturnType<typeof lavaSeil.setup>, i: number, rng: Rng): number {
    // tick until the beam has passed player i; returns the pass time
    for (let k = 0; k < 2000; k++) {
      lavaSeil.tick(s, 1 / 60, rng);
      const pend = s.pending.find((p) => p.p === i);
      if (pend) return pend.tc;
    }
    throw new Error('beam never passed');
  }
  it('a jump counts from the phone timestamp even if the message arrives late', () => {
    const rng = Rng.fromSeed(11);
    const s = lavaSeil.setup(humans(), rng, { practice: false });
    const tc = untilPass(s, 0, rng);
    // pressed 0.25 s before the pass, message arrives just after the pass
    lavaSeil.input(s, 0, { type: 'press', t: tc - 0.25 });
    for (let k = 0; k < 30; k++) lavaSeil.tick(s, 1 / 60, rng);
    expect(s.ps[0].out).toBeNull();
    // without jumping, the next pass knocks the player out
    const tc2 = untilPass(s, 0, rng);
    for (let k = 0; k < 30; k++) lavaSeil.tick(s, 1 / 60, rng);
    expect(s.ps[0].out).toBeCloseTo(tc2, 5);
    expect(lavaSeil.layout(s, 0).kind).toBe('wait');
  });
  it('a jump right before the pass is too late; no double jumps', () => {
    const rng = Rng.fromSeed(12);
    const s = lavaSeil.setup(humans(), rng, { practice: false });
    const tc = untilPass(s, 1, rng);
    lavaSeil.input(s, 1, { type: 'press', t: tc - 0.45 });
    lavaSeil.input(s, 1, { type: 'press', t: tc - 0.1 }); // still in the air: ignored
    expect(s.ps[1].jumps).toHaveLength(1);
    for (let k = 0; k < 30; k++) lavaSeil.tick(s, 1 / 60, rng);
    expect(s.ps[1].out).toBeNull(); // in the air at tc (0.45 < JUMP − SAFE = 0.72 − 0.06)

    const s2 = lavaSeil.setup(humans(), Rng.fromSeed(13), { practice: false });
    const r2 = Rng.fromSeed(13);
    const tc2 = untilPass(s2, 2, r2);
    lavaSeil.input(s2, 2, { type: 'press', t: tc2 - 0.02 }); // feet still on the ground at tc
    for (let k = 0; k < 30; k++) lavaSeil.tick(s2, 1 / 60, r2);
    expect(s2.ps[2].out).not.toBeNull();
  });
});

describe('lavaSeil play time', () => {
  it('lasts long enough with medium bots (bots jump with display lag, MINI-03)', () => {
    const { median, secs } = playStats(lavaSeil, 10);
    expect(median).toBeGreaterThanOrEqual(25);
    expect(secs[1]).toBeGreaterThanOrEqual(15);
  });
});

describe('tie-breaks (v0.5)', () => {
  it('zaehlZoo: equal total error → more exact rounds, then the faster answers', () => {
    const rng = Rng.fromSeed(21);
    const s = zaehlZoo.setup(humans(), rng, { practice: false });
    // errors per round: p0 0/2/0 (2 exact), p1 and p2 1/1/0 (p2 answers faster), p3 never answers
    const off = [
      [0, 2, 0],
      [1, 1, 0],
      [1, 1, 0],
    ];
    for (let round = 0; round < 3; round++) {
      while (s.phase !== 'guess') zaehlZoo.tick(s, 1 / 60, rng);
      zaehlZoo.input(s, 0, { type: 'number', value: s.count + off[0][round] });
      zaehlZoo.input(s, 2, { type: 'number', value: s.count + off[2][round] });
      for (let k = 0; k < 20; k++) zaehlZoo.tick(s, 1 / 60, rng);
      zaehlZoo.input(s, 1, { type: 'number', value: s.count + off[1][round] });
      while (s.phase === 'guess') zaehlZoo.tick(s, 1 / 60, rng);
    }
    while (!zaehlZoo.isOver(s)) zaehlZoo.tick(s, 1 / 60, rng);
    expect(s.total.slice(0, 3)).toEqual([2, 2, 2]);
    expect(zaehlZoo.result(s)).toEqual([0, 2, 1, 3]);
  });
  it('lavaSeil: several survivors are ranked by their cleanest jumps', () => {
    const s = lavaSeil.setup(humans(), Rng.fromSeed(22), { practice: false });
    Object.assign(s.ps[0], { cleared: 10, clean: 1.0 });
    Object.assign(s.ps[1], { cleared: 10, clean: 2.0 });
    Object.assign(s.ps[2], { out: 12 });
    Object.assign(s.ps[3], { out: 9 });
    expect(lavaSeil.result(s)).toEqual([1, 0, 2, 3]);
  });
});
