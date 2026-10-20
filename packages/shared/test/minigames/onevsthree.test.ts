import { describe, expect, it } from 'vitest';
import type { BotLevel } from '../../src/config';
import { de } from '../../src/i18n/de';
import { ballonBombardement } from '../../src/minigames/games/ballonBombardement';
import { ONE_VS_THREE_GAMES } from '../../src/minigames/games/group-1v3';
import { kokosKanonier } from '../../src/minigames/games/kokosKanonier';
import { laternenJagd } from '../../src/minigames/games/laternenJagd';
import { wandLabyrinth } from '../../src/minigames/games/wandLabyrinth';
import { makeMgPlayers, runMinigameHeadless } from '../../src/minigames/headless';
import type { MgPlayer, MinigameDef } from '../../src/minigames/types';
import { Rng } from '../../src/rng';
import { checkMinigameContract } from './contract';

const TEAMS = [
  [0, 1, 1, 1],
  [1, 0, 1, 1],
  [1, 1, 0, 1],
  [1, 1, 1, 0],
];

/** Share of games the solo wins (solo on a rotating seat). */
function soloWinRate(def: MinigameDef, soloLevel: BotLevel, trioLevel: BotLevel, seeds = 20): number {
  let wins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const teams = TEAMS[seed % 4];
    const players = makeMgPlayers('1v3', teams, 'medium');
    for (const p of players) p.botLevel = p.team === 0 ? soloLevel : trioLevel;
    const res = runMinigameHeadless(def, players, seed * 1013);
    if (res.ranks[teams.indexOf(0)] === 0) wins++;
  }
  return wins / seeds;
}

function humans(teams = TEAMS[0]): MgPlayer[] {
  return makeMgPlayers('1v3', teams).map((p) => ({ ...p, isBot: false }));
}

describe('1v3 group', () => {
  it('registers all four games with texts', () => {
    expect(ONE_VS_THREE_GAMES.map((g) => g.id)).toEqual(['kokosKanonier', 'wandLabyrinth', 'laternenJagd', 'ballonBombardement']);
    for (const g of ONE_VS_THREE_GAMES) {
      expect(g.format).toBe('1v3');
      for (const k of ['name', 'desc', 'controls']) expect(de[`mg.${g.id}.${k}`]).toBeTruthy();
    }
  });
});

describe.each(ONE_VS_THREE_GAMES)('1v3 minigame $id', (def) => {
  it('fulfils the module contract', () => checkMinigameContract(def));

  it('is balanced for equally strong bots (solo wins 20–80 %)', () => {
    const rate = soloWinRate(def, 'medium', 'medium');
    expect(rate).toBeGreaterThanOrEqual(0.2);
    expect(rate).toBeLessThanOrEqual(0.8);
  });

  it('bot strength matters: hard solo vs easy trio wins more than easy solo vs hard trio', () => {
    expect(soloWinRate(def, 'hard', 'easy')).toBeGreaterThan(soloWinRate(def, 'easy', 'hard'));
  });

  it('gives solo and trio different controller layouts', () => {
    for (const teams of TEAMS) {
      const players = makeMgPlayers('1v3', teams);
      const s = def.setup(players, Rng.fromSeed(3), { practice: false });
      const solo = teams.indexOf(0);
      const trioKinds = new Set(players.filter((p) => p.team === 1).map((p) => def.layout(s, p.idx).kind));
      expect(trioKinds.size).toBe(1);
      if (def.id !== 'laternenJagd') expect(trioKinds.has(def.layout(s, solo).kind)).toBe(false);
    }
  });
});

describe('kokosKanonier rules', () => {
  it('two hits knock a trio member out; trio wins while one survives', () => {
    const rng = Rng.fromSeed(1);
    const s = kokosKanonier.setup(humans(), rng, { practice: false });
    const target = s.trio[0];
    // keep the crosshair on the target and let the cannon fire
    for (let k = 0; k < 30 * 8 && !s.ps[target].out; k++) {
      s.cross = { x: s.ps[target].x, z: s.ps[target].z };
      kokosKanonier.tick(s, 1 / 30, rng);
    }
    expect(s.ps[target].out).toBe(true);
    expect(s.ps[target].hits).toBe(2);
    expect(kokosKanonier.layout(s, target).kind).toBe('wait');
    // move the crosshair far away from the others and run out the clock
    while (!kokosKanonier.isOver(s)) {
      s.cross = { x: 7, z: 4.5 };
      kokosKanonier.tick(s, 1 / 30, rng);
    }
    const ranks = kokosKanonier.result(s);
    expect(ranks[s.solo]).toBe(1);
    for (const i of s.trio) expect(ranks[i]).toBe(0);
  });

  it('tilt moves the crosshair', () => {
    const rng = Rng.fromSeed(2);
    const s = kokosKanonier.setup(humans(TEAMS[2]), rng, { practice: false });
    kokosKanonier.input(s, 2, { type: 'tilt', x: 1, y: 0 });
    for (let k = 0; k < 15; k++) kokosKanonier.tick(s, 1 / 30, rng);
    expect(s.cross.x).toBeGreaterThan(2);
    // the trio cannot steer the cannon
    kokosKanonier.input(s, 0, { type: 'tilt', x: -1, y: 0 });
    expect(s.tilt.x).toBe(1);
  });
});

describe('wandLabyrinth rules', () => {
  it('every cell stays connected to the exit in all four wall positions', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const s = wandLabyrinth.setup(humans(), Rng.fromSeed(seed), { practice: false });
      expect(s.sliders.length).toBeGreaterThan(4);
      for (const h of [0, 1]) {
        for (const v of [0, 1]) {
          // flood fill over cells
          const cw = 11;
          const ch = 7;
          const tw = cw * 2 + 1;
          const blocked = (x: number, y: number) =>
            s.walls[y * tw + x] === 1 ||
            s.sliders.some((sl) => (sl.axis === 'h' ? sl.x + h * 2 === x && sl.y === y : sl.x === x && sl.y + v * 2 === y));
          const seen = new Set<number>([s.exit[1] * cw + s.exit[0]]);
          const q: [number, number][] = [s.exit];
          while (q.length) {
            const [x, y] = q.pop()!;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || seen.has(ny * cw + nx)) continue;
              if (blocked(x * 2 + 1 + dx, y * 2 + 1 + dy)) continue;
              seen.add(ny * cw + nx);
              q.push([nx, ny]);
            }
          }
          expect(seen.size).toBe(cw * ch);
        }
      }
    }
  });

  it('swipes move the wall groups with a cooldown; reaching the exit wins for the trio', () => {
    const rng = Rng.fromSeed(4);
    const s = wandLabyrinth.setup(humans(TEAMS[1]), rng, { practice: false });
    s.cooldown = 0;
    wandLabyrinth.input(s, 1, { type: 'swipe', dir: 'right' });
    expect(s.hPos).toBe(1);
    wandLabyrinth.input(s, 1, { type: 'swipe', dir: 'up' });
    expect(s.vPos).toBe(0); // still cooling down
    // a trio member walks the shortest route (bot logic) to the exit
    const p = s.ps[0];
    const [ex, ey] = s.exit;
    for (let k = 0; k < 30 * 30 && !wandLabyrinth.isOver(s); k++) {
      for (const inp of wandLabyrinth.bot(s, 0, 'hard', rng, 1 / 30)) wandLabyrinth.input(s, 0, inp);
      wandLabyrinth.tick(s, 1 / 30, rng);
    }
    expect(s.won).toBe(0);
    expect(p.cx === ex && p.cy === ey).toBe(true);
    const ranks = wandLabyrinth.result(s);
    expect(ranks).toEqual([0, 1, 0, 0]);
  });
});

describe('laternenJagd rules', () => {
  it('the solo is hidden on the TV unless lit or sparkling, and light catches him', () => {
    const rng = Rng.fromSeed(5);
    const s = laternenJagd.setup(humans(), rng, { practice: false });
    // skip the first sparkle
    s.sparkIn = 99;
    laternenJagd.tick(s, 1 / 30, rng);
    expect(laternenJagd.view(s).entities.some((e) => e.id === `p${s.solo}`)).toBe(false);
    // move the solo right in front of a seeker's lantern (out of any bush)
    s.bushes = [];
    const seeker = s.ps[s.trio[0]];
    const sp = s.ps[s.solo];
    sp.x = seeker.x - Math.sin(seeker.ry) * 2.5;
    sp.z = seeker.z - Math.cos(seeker.ry) * 2.5;
    laternenJagd.tick(s, 1 / 30, rng);
    expect(s.litBy).toBeGreaterThan(0);
    expect(laternenJagd.view(s).entities.some((e) => e.id === `p${s.solo}`)).toBe(true);
    for (let k = 0; k < 30 * 3 && !laternenJagd.isOver(s); k++) laternenJagd.tick(s, 1 / 30, rng);
    expect(laternenJagd.isOver(s)).toBe(true);
    expect(laternenJagd.result(s)).toEqual([1, 0, 0, 0]);
  });

  it('sneaking leaves no footprints, running does', () => {
    const rng = Rng.fromSeed(6);
    const s = laternenJagd.setup(humans(), rng, { practice: true });
    s.bushes = [];
    const sp = s.ps[s.solo];
    sp.x = 0;
    sp.z = 0;
    for (const i of s.trio) s.ps[i].x = 50; // seekers far away (no light)
    laternenJagd.input(s, s.solo, { type: 'stick', x: 0.45, y: 0 });
    for (let k = 0; k < 30; k++) laternenJagd.tick(s, 1 / 30, rng);
    expect(s.steps.length).toBe(0);
    sp.x = -5;
    laternenJagd.input(s, s.solo, { type: 'stick', x: 1, y: 0 });
    for (let k = 0; k < 30; k++) laternenJagd.tick(s, 1 / 30, rng);
    expect(s.steps.length).toBeGreaterThan(2);
  });
});

describe('ballonBombardement rules', () => {
  it('shaking fills the balloon, a full balloon counts, darts pop and need a cooldown', () => {
    const rng = Rng.fromSeed(7);
    const s = ballonBombardement.setup(humans(TEAMS[3]), rng, { practice: false });
    expect(s.solo).toBe(3);
    const slot = 0;
    const pi = s.trio[slot];
    let t = 0;
    while (s.done === 0 && t < 20) {
      ballonBombardement.input(s, pi, { type: 'shake', power: 1 });
      ballonBombardement.tick(s, 0.15, rng);
      t += 0.15;
    }
    expect(s.done).toBe(1);
    // spamming shakes faster than the limit doesn't help
    ballonBombardement.tick(s, 1, rng);
    const before = s.balloons[slot].fill;
    for (let k = 0; k < 20; k++) ballonBombardement.input(s, pi, { type: 'shake', power: 1 });
    expect(s.balloons[slot].fill - before).toBeLessThan(0.06);
    // dart at a big balloon
    s.balloons[1].fill = 0.99;
    s.cooldown = 0;
    ballonBombardement.input(s, 3, { type: 'pad', idx: 1 });
    expect(s.cooldown).toBeGreaterThan(0);
    ballonBombardement.input(s, 3, { type: 'pad', idx: 2 }); // still cooling down
    expect(s.darts.length).toBe(1);
    expect(ballonBombardement.layout(s, 3)).toMatchObject({ kind: 'pads', count: 3, active: false });
    ballonBombardement.tick(s, 0.6, rng);
    expect(s.pops).toBe(1);
    expect(s.balloons[1].phase).toBe('popped');
  });

  it('trio wins with enough balloons, solo when time runs out', () => {
    const rng = Rng.fromSeed(8);
    const s = ballonBombardement.setup(humans(), rng, { practice: false });
    while (!ballonBombardement.isOver(s)) ballonBombardement.tick(s, 0.1, rng);
    expect(ballonBombardement.result(s)).toEqual([0, 1, 1, 1]);
    const s2 = ballonBombardement.setup(humans(), rng, { practice: false });
    for (let k = 0; k < 400 && !ballonBombardement.isOver(s2); k++) {
      for (const i of s2.trio) ballonBombardement.input(s2, i, { type: 'shake', power: 1 });
      ballonBombardement.tick(s2, 0.14, rng);
    }
    expect(ballonBombardement.result(s2)).toEqual([1, 0, 0, 0]);
  });
});

describe('1v3 practice mode', () => {
  it.each([kokosKanonier, wandLabyrinth, laternenJagd, ballonBombardement] as MinigameDef[])('$id never ends in practice', (def) => {
    const res = runMinigameHeadless(def, makeMgPlayers('1v3', TEAMS[0], 'hard'), 11, { practice: true, maxSeconds: 90 });
    expect(def.isOver(res.state as never)).toBe(false);
  });
});
