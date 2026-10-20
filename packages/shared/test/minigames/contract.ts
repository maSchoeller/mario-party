import { expect } from 'vitest';
import { BOT_LEVELS } from '../../src/config';
import { de } from '../../src/i18n/de';
import { makeMgPlayers, runMinigameHeadless } from '../../src/minigames/headless';
import type { MgFormat, MinigameDef } from '../../src/minigames/types';
import { Rng } from '../../src/rng';

const ENTITY_KINDS = new Set([
  'player', 'box', 'sphere', 'cylinder', 'cone', 'coin', 'star', 'torus', 'plane', 'rock', 'palm', 'balloon', 'coconut', 'boat', 'train', 'lantern',
]);

function teamVariants(format: MgFormat): number[][] {
  if (format === '2v2') return [[0, 0, 1, 1], [0, 1, 0, 1], [1, 0, 0, 1]];
  if (format === '1v3') return [[0, 1, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]];
  if (format === 'duel') return [[0, 1]];
  return [[0, 1, 2, 3]];
}

/**
 * Generic contract every minigame module must fulfil (MINI-03/06/07, BOT-03):
 * bots finish the game in time, ranks are valid, view/layouts are serializable and
 * reference known entity kinds and existing i18n keys, practice mode never ends.
 */
export function checkMinigameContract(def: MinigameDef): void {
  expect(def.duration).toBeGreaterThanOrEqual(30);
  expect(def.duration).toBeLessThanOrEqual(60);
  for (const k of ['name', 'desc', 'controls']) expect(de[`mg.${def.id}.${k}`], `mg.${def.id}.${k}`).toBeTruthy();
  const n = def.format === 'duel' ? 2 : 4;
  for (const teams of teamVariants(def.format)) {
    for (const level of BOT_LEVELS) {
      for (let seed = 1; seed <= 3; seed++) {
        const players = makeMgPlayers(def.format, teams, level);
        let views = 0;
        const res = runMinigameHeadless(def, players, seed * 7919, {
          maxSeconds: def.duration + 40,
          onTick: (s) => {
            if (views++ % 45 !== 0) return;
            const v = def.view(s as never);
            JSON.stringify(v);
            for (const e of v.entities) {
              expect(ENTITY_KINDS.has(e.kind), `entity kind ${e.kind}`).toBe(true);
              for (const c of ['x', 'y', 'z'] as const) expect(Number.isFinite(e[c]), `${e.id}.${c}`).toBe(true);
            }
            if (v.hud.message) expect(de[v.hud.message.key], v.hud.message.key).toBeTruthy();
            for (const t of v.hud.teams ?? []) expect(de[t.labelKey], t.labelKey).toBeTruthy();
            for (let i = 0; i < n; i++) {
              const l = def.layout(s as never, i);
              JSON.stringify(l);
              if ('labelKey' in l && l.labelKey) expect(de[l.labelKey], l.labelKey).toBeTruthy();
              if (l.kind === 'joystick') for (const b of l.buttons ?? []) expect(de[b.labelKey], b.labelKey).toBeTruthy();
              if (l.kind === 'choice') for (const o of l.options) expect(de[o.labelKey], o.labelKey).toBeTruthy();
            }
          },
        });
        expect(res.seconds, `${def.id} must end (level ${level})`).toBeLessThan(def.duration + 40);
        expect(res.ranks).toHaveLength(n);
        for (const r of res.ranks) expect(r).toBeGreaterThanOrEqual(0);
        expect(Math.min(...res.ranks)).toBe(0);
        // team members share their rank in team formats
        if (def.format === '2v2' || def.format === '1v3') {
          for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (teams[a] === teams[b]) expect(res.ranks[a]).toBe(res.ranks[b]);
        }
        JSON.parse(JSON.stringify(res.state));
      }
    }
  }
  // practice mode: runs forever (host stops it), must not crash
  const players = makeMgPlayers(def.format, teamVariants(def.format)[0], 'medium');
  const practice = runMinigameHeadless(def, players, 99, { practice: true, maxSeconds: def.duration + 20 });
  expect(def.isOver(practice.state as never)).toBe(false);
  // human input without any bots must not crash: feed random inputs
  const rng = Rng.fromSeed(5);
  const s = def.setup(players.map((p) => ({ ...p, isBot: false })), rng, { practice: false });
  for (let k = 0; k < 600; k++) {
    for (let i = 0; i < n; i++) {
      const pick = rng.int(0, 8);
      const input = [
        { type: 'stick', x: rng.range(-1, 1), y: rng.range(-1, 1) },
        { type: 'button', id: 'a', down: rng.chance(0.5) },
        { type: 'tap' },
        { type: 'press', t: k / 30 },
        { type: 'tilt', x: rng.range(-1, 1), y: rng.range(-1, 1) },
        { type: 'shake', power: rng.next() },
        { type: 'swipe', dir: rng.pick(['up', 'down', 'left', 'right']) },
        { type: 'choice', id: 'x' },
        { type: 'pad', idx: rng.int(0, 3) },
      ][pick] as never;
      def.input(s, i, input);
    }
    def.tick(s, 1 / 30, rng);
    if (def.isOver(s)) break;
  }
}

/** Bots of higher level should on average beat weaker bots (sanity check for bot AI). */
export function botStrengthOrder(def: MinigameDef, seeds = 12): { hardWins: number; easyWins: number } {
  let hardWins = 0;
  let easyWins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const players = makeMgPlayers(def.format, undefined, 'medium');
    players[0].botLevel = 'hard';
    players[1].botLevel = 'easy';
    const res = runMinigameHeadless(def, players, seed * 31);
    if (res.ranks[0] < res.ranks[1]) hardWins++;
    if (res.ranks[1] < res.ranks[0]) easyWins++;
  }
  return { hardWins, easyWins };
}

/** Team layouts that rotate through the seats (so no seat is favoured). */
const ROTATE: Record<MgFormat, (number[] | undefined)[]> = {
  ffa: [undefined],
  duel: [undefined],
  '2v2': [[0, 0, 1, 1], [0, 1, 0, 1], [1, 0, 0, 1], [1, 1, 0, 0]],
  '1v3': [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]],
};

/**
 * Play time with medium bots (MINI-03: typical game ≥ 25–30 s, hardly ever over before ~15 s).
 * Returns the sorted durations, their median and the results (for balance/tie checks).
 */
export function playStats(def: MinigameDef, seeds = 10): { secs: number[]; median: number; runs: { ranks: number[]; teams: number[] }[] } {
  const runs: { ranks: number[]; teams: number[] }[] = [];
  const secs: number[] = [];
  const layouts = ROTATE[def.format];
  for (let seed = 1; seed <= seeds; seed++) {
    const players = makeMgPlayers(def.format, layouts[seed % layouts.length], 'medium');
    const res = runMinigameHeadless(def, players, seed * 7717 + 3);
    secs.push(res.seconds);
    runs.push({ ranks: res.ranks, teams: players.map((p) => p.team) });
  }
  secs.sort((a, b) => a - b);
  return { secs, median: secs[secs.length >> 1], runs };
}

/** Share of games in which everybody shares first place (a draw). */
export function drawRate(runs: { ranks: number[] }[]): number {
  return runs.filter((r) => r.ranks.every((x) => x === 0)).length / runs.length;
}
