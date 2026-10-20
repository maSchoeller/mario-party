import { describe, expect, it } from 'vitest';
import { flossRumble } from '../../src/minigames/games/flossRumble';
import { TEAM_GAMES } from '../../src/minigames/games/group-2v2';
import { paketKette } from '../../src/minigames/games/paketKette';
import { schatzTauziehen } from '../../src/minigames/games/schatzTauziehen';
import { tandemTretboot } from '../../src/minigames/games/tandemTretboot';
import { weichenChaos } from '../../src/minigames/games/weichenChaos';
import { makeMgPlayers, runMinigameHeadless } from '../../src/minigames/headless';
import type { MgPlayer, MinigameDef } from '../../src/minigames/types';
import { Rng } from '../../src/rng';
import { checkMinigameContract } from './contract';

const VARIANTS = [[0, 0, 1, 1], [0, 1, 0, 1], [1, 0, 0, 1]];

/** Team of two hard bots vs team of two easy bots, alternating sides and team layouts. */
function teamStrength(def: MinigameDef, seeds = 12): { hardWins: number; easyWins: number } {
  let hardWins = 0;
  let easyWins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const players = makeMgPlayers('2v2', VARIANTS[seed % VARIANTS.length]);
    const hardTeam = seed % 2;
    for (const p of players) p.botLevel = p.team === hardTeam ? 'hard' : 'easy';
    const res = runMinigameHeadless(def, players, seed * 31);
    const h = players.find((p) => p.team === hardTeam)!.idx;
    const e = players.find((p) => p.team !== hardTeam)!.idx;
    if (res.ranks[h] < res.ranks[e]) hardWins++;
    if (res.ranks[e] < res.ranks[h]) easyWins++;
  }
  return { hardWins, easyWins };
}

function humans(teams = [0, 1, 0, 1]): MgPlayer[] {
  return makeMgPlayers('2v2', teams).map((p) => ({ ...p, isBot: false }));
}

describe('2v2 group', () => {
  it('registers all five team games', () => {
    expect(TEAM_GAMES.map((g) => g.id).sort()).toEqual(['flossRumble', 'paketKette', 'schatzTauziehen', 'tandemTretboot', 'weichenChaos']);
    for (const g of TEAM_GAMES) expect(g.format).toBe('2v2');
  });
});

describe.each(TEAM_GAMES)('team minigame $id', (def) => {
  it('fulfils the module contract', () => checkMinigameContract(def));
  it('a team of hard bots beats a team of easy bots more often', () => {
    const r = teamStrength(def);
    expect(r.hardWins).toBeGreaterThan(r.easyWins);
    expect(r.hardWins).toBeGreaterThanOrEqual(8);
  });
});

describe('flossRumble rules', () => {
  it('players in the water cannot climb back onto the raft', () => {
    const rng = Rng.fromSeed(1);
    const s = flossRumble.setup(humans(), rng, { practice: false });
    s.ps[0].x = s.half + 0.5; // shoved over the edge
    flossRumble.tick(s, 1 / 30, rng);
    expect(s.ps[0].state).not.toBe('raft');
    for (let k = 0; k < 30 * 6; k++) {
      flossRumble.input(s, 0, { type: 'stick', x: -1, y: 0 }); // swim back towards the raft
      flossRumble.tick(s, 1 / 30, rng);
    }
    expect(s.ps[0].state).toBe('swim');
    expect(Math.abs(s.ps[0].x) > s.half || Math.abs(s.ps[0].z) > s.half).toBe(true);
    expect(flossRumble.layout(s, 0).kind).toBe('wait');
  });
  it('pushing both opponents off ends the game for the pushing team', () => {
    const rng = Rng.fromSeed(2);
    const s = flossRumble.setup(humans([1, 0, 0, 1]), rng, { practice: false });
    // team 1 = players 0 and 3 fall off
    for (const i of [0, 3]) s.ps[i].z = s.half + 1;
    for (let k = 0; k < 60 && !flossRumble.isOver(s); k++) flossRumble.tick(s, 1 / 30, rng);
    expect(flossRumble.isOver(s)).toBe(true);
    expect(flossRumble.result(s)).toEqual([1, 0, 0, 1]);
  });
  it('a push knocks an opponent away, but not a teammate', () => {
    const rng = Rng.fromSeed(3);
    const s = flossRumble.setup(humans([0, 0, 1, 1]), rng, { practice: false });
    Object.assign(s.ps[0], { x: 0, z: 0 });
    Object.assign(s.ps[2], { x: 1.2, z: 0 });
    Object.assign(s.ps[1], { x: 0, z: -3 });
    Object.assign(s.ps[3], { x: -3, z: 3 });
    flossRumble.input(s, 0, { type: 'stick', x: 1, y: 0 });
    flossRumble.input(s, 0, { type: 'button', id: 'push', down: true });
    expect(s.ps[2].kx).toBeGreaterThan(5);
    expect(s.ps[1].kx).toBe(0);
  });
});

describe('tandemTretboot rules', () => {
  const pedal = (pattern: number[], teams = [0, 0, 1, 1]) => {
    const rng = Rng.fromSeed(1);
    const s = tandemTretboot.setup(humans(teams), rng, { practice: false });
    for (const i of pattern) {
      for (let k = 0; k < 9; k++) tandemTretboot.tick(s, 1 / 30, rng); // 0.3 s
      tandemTretboot.input(s, i, { type: 'press', t: s.t });
    }
    for (let k = 0; k < 9; k++) tandemTretboot.tick(s, 1 / 30, rng);
    return s;
  };
  it('alternating taps are fast, tapping twice in a row stalls the boat', () => {
    const alt = pedal([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    const same = pedal([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(alt.boats[0].pos).toBeGreaterThan(same.boats[0].pos * 2);
    const s = pedal([0, 1, 1]);
    expect(s.boats[0].stall).toBeGreaterThan(0);
  });
  it('works with any team layout (members found via team, not index)', () => {
    // team 0 = players 1 and 2
    const s = pedal([1, 2, 1, 2, 1, 2], [1, 0, 0, 1]);
    const b = s.boats.find((x) => x.team === 0)!;
    expect(b.members).toEqual([1, 2]);
    expect(b.pos).toBeGreaterThan(2);
    expect(b.stall).toBe(0);
  });
});

describe('paketKette rules', () => {
  it('thrower passes parcels to the sorter; right chute scores, wrong chute costs', () => {
    const rng = Rng.fromSeed(4);
    const s = paketKette.setup(humans([0, 1, 0, 1]), rng, { practice: false });
    const ts = s.teams[0];
    expect([ts.thrower, ts.sorter]).toEqual([0, 2]);
    expect(paketKette.layout(s, 0)).toEqual({ kind: 'swipe', labelKey: 'ctrl.swipeThrow' });
    while (!(ts.belt[0] && ts.belt[0].pos >= 0.9)) paketKette.tick(s, 1 / 30, rng);
    const color = ts.belt[0].color;
    paketKette.input(s, 2, { type: 'swipe', dir: 'up' }); // sorter can't throw
    expect(ts.flying).toHaveLength(0);
    paketKette.input(s, 0, { type: 'swipe', dir: 'up' });
    expect(ts.flying).toHaveLength(1);
    for (let k = 0; k < 20; k++) paketKette.tick(s, 1 / 30, rng);
    expect(ts.hand[0].color).toBe(color);
    const dirs = ['left', 'up', 'right'] as const;
    paketKette.input(s, 2, { type: 'swipe', dir: dirs[color] });
    expect(ts.score).toBe(1);
    ts.hand.push({ id: 999, color: 0 });
    paketKette.input(s, 2, { type: 'swipe', dir: 'right' });
    expect(ts.score).toBe(0);
  });
});

describe('weichenChaos rules', () => {
  it('own trains into the own station score, foreign trains are sent to the siding', () => {
    const rng = Rng.fromSeed(5);
    const s = weichenChaos.setup(humans([0, 0, 1, 1]), rng, { practice: false });
    // one own train on player 0's line, switch to station → +1
    s.nextSpawn = [999, 999];
    s.trains.push({ id: 500, line: 0, color: 0, s: 0, branch: null, decidedAt: 0 });
    for (let k = 0; k < 30 * 6; k++) weichenChaos.tick(s, 1 / 30, rng);
    expect(s.scores).toEqual([1, 0]);
    // a foreign train: player 0 flips to the siding → no penalty
    s.trains.push({ id: 501, line: 0, color: 1, s: 0, branch: null, decidedAt: 0 });
    weichenChaos.input(s, 0, { type: 'press', t: s.t });
    expect(s.lines[0].state).toBe('siding');
    for (let k = 0; k < 30 * 6; k++) weichenChaos.tick(s, 1 / 30, rng);
    expect(s.scores).toEqual([1, 0]);
    // a foreign train into the own station costs a point
    weichenChaos.input(s, 0, { type: 'press', t: s.t });
    s.trains.push({ id: 502, line: 0, color: 1, s: 0, branch: null, decidedAt: 0 });
    for (let k = 0; k < 30 * 6; k++) weichenChaos.tick(s, 1 / 30, rng);
    expect(s.scores).toEqual([0, 0]);
  });
  it('uses the phone timestamp: a press just before the train reached the switch counts', () => {
    const rng = Rng.fromSeed(6);
    const s = weichenChaos.setup(humans([0, 0, 1, 1]), rng, { practice: false });
    s.nextSpawn = [999, 999];
    s.trains.push({ id: 600, line: 0, color: 1, s: 0, branch: null, decidedAt: 0 });
    while (s.trains[0].branch === null) weichenChaos.tick(s, 1 / 30, rng);
    expect(s.trains[0].branch).toBe('station');
    const pressedAt = s.trains[0].decidedAt - 0.05;
    weichenChaos.tick(s, 1 / 30, rng); // message arrives late
    weichenChaos.input(s, 0, { type: 'press', t: pressedAt });
    expect(s.trains[0].branch).toBe('siding');
  });
  it('every player owns exactly one switch of their own team', () => {
    const s = weichenChaos.setup(humans([1, 0, 0, 1]), Rng.fromSeed(7), { practice: false });
    expect(s.lines.map((l) => l.owner).sort()).toEqual([0, 1, 2, 3]);
    for (const l of s.lines) expect(s.players[l.owner].team).toBe(l.team);
  });
});

describe('schatzTauziehen rules', () => {
  it('the shaking team pulls the chest over its mark and wins early', () => {
    const rng = Rng.fromSeed(8);
    const s = schatzTauziehen.setup(humans([0, 1, 0, 1]), rng, { practice: false });
    let k = 0;
    for (; k < 30 * 40 && !schatzTauziehen.isOver(s); k++) {
      if (k % 5 === 0) for (const i of [1, 3]) schatzTauziehen.input(s, i, { type: 'shake', power: 0.8 });
      schatzTauziehen.tick(s, 1 / 30, rng);
    }
    expect(schatzTauziehen.isOver(s)).toBe(true);
    expect(k / 30).toBeLessThan(35);
    expect(schatzTauziehen.result(s)).toEqual([1, 0, 1, 0]);
  });
  it('power per player is capped: one frantic player cannot beat two steady ones', () => {
    const rng = Rng.fromSeed(9);
    const s = schatzTauziehen.setup(humans([0, 0, 1, 1]), rng, { practice: false });
    for (let k = 0; k < 30 * 12; k++) {
      for (let n = 0; n < 20; n++) schatzTauziehen.input(s, 0, { type: 'shake', power: 1 });
      if (k % 5 === 0) for (const i of [2, 3]) schatzTauziehen.input(s, i, { type: 'shake', power: 1 });
      schatzTauziehen.tick(s, 1 / 30, rng);
    }
    expect(s.rope).toBeGreaterThan(0);
  });
});
