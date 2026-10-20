import type { Rng } from '../../rng';
import type { EntityKind, MgEntity, MgHud, MgPlayer, MinigameDef } from '../types';
import { clamp, ranksFromScores, rowSpawn } from '../util';

/**
 * #7 Zähl-Zoo (FFA, Quiz): animals run across the TV – count one kind (e.g. red crabs).
 * Afterwards everybody enters a number on the phone; the error |guess − count| is summed
 * over 3 rounds of rising difficulty (more animals, faster, look-alikes). Smallest total
 * error wins.
 */
export type SortId = 'crab' | 'hermit' | 'chick' | 'duck' | 'frog' | 'penguin' | 'sheep';

interface SortDef {
  kind: EntityKind;
  color: string;
  sx: number;
  sy: number;
  sz: number;
  /** y of the entity (sphere centre / cone base) */
  y: number;
  hop: number;
}

const SORTS: Record<SortId, SortDef> = {
  crab: { kind: 'sphere', color: '#e8483d', sx: 1.5, sy: 0.7, sz: 1.1, y: 0.35, hop: 0.1 },
  hermit: { kind: 'sphere', color: '#ff9a3c', sx: 1.5, sy: 0.7, sz: 1.1, y: 0.35, hop: 0.1 },
  chick: { kind: 'sphere', color: '#ffe14d', sx: 0.9, sy: 0.9, sz: 0.9, y: 0.45, hop: 0.6 },
  duck: { kind: 'sphere', color: '#f5b02e', sx: 1.2, sy: 1, sz: 1.2, y: 0.5, hop: 0.25 },
  frog: { kind: 'sphere', color: '#4fbf5a', sx: 1.2, sy: 0.85, sz: 1.2, y: 0.45, hop: 1 },
  penguin: { kind: 'cone', color: '#2f3b57', sx: 1, sy: 1.7, sz: 1, y: 0, hop: 0.15 },
  sheep: { kind: 'sphere', color: '#f7f7f2', sx: 1.4, sy: 1.1, sz: 1.1, y: 0.6, hop: 0.2 },
};

const LOOKALIKE: Partial<Record<SortId, SortId>> = { crab: 'hermit', hermit: 'crab', chick: 'duck', duck: 'chick' };
const BASIC: SortId[] = ['crab', 'chick', 'frog', 'penguin', 'sheep'];
const ALL: SortId[] = ['crab', 'hermit', 'chick', 'duck', 'frog', 'penguin', 'sheep'];

/** difficulty per round */
const ROUND_CFG = [
  { total: 10, targets: [4, 7], sorts: 2, speed: [5.5, 6.5], window: 4.5, both: false },
  { total: 15, targets: [6, 9], sorts: 3, speed: [6.5, 8], window: 4.5, both: false },
  { total: 20, targets: [7, 11], sorts: 4, speed: [7.5, 9.5], window: 5, both: true },
];
const LANES = [-1.5, 1.5, 4.5, 7.5];
const EDGE = 13;
const INTRO = 2;
const GUESS = 8;
const REVEAL = 2.5;
const MAX = 40;

interface Animal {
  id: number;
  sort: SortId;
  lane: number;
  spawnAt: number;
  speed: number;
  dir: 1 | -1;
}

export interface ZaehlZooState {
  t: number;
  practice: boolean;
  n: number;
  round: number;
  phase: 'intro' | 'parade' | 'guess' | 'reveal' | 'done';
  phaseAt: number;
  target: SortId;
  count: number;
  animals: Animal[];
  paradeEnd: number;
  nextId: number;
  guesses: (number | null)[];
  total: number[];
  botAt: (number | null)[];
}

function startRound(s: ZaehlZooState, rng: Rng): void {
  const cfg = ROUND_CFG[(s.round - 1) % ROUND_CFG.length];
  const hard = cfg.both;
  s.target = hard ? rng.pick(['crab', 'hermit', 'chick', 'duck'] as SortId[]) : rng.pick(BASIC);
  const others = rng.shuffle(ALL.filter((x) => x !== s.target && x !== LOOKALIKE[s.target]));
  const distractors: SortId[] = hard ? [LOOKALIKE[s.target]!, ...others].slice(0, cfg.sorts - 1) : others.slice(0, cfg.sorts - 1);
  s.count = rng.int(cfg.targets[0], cfg.targets[1]);
  const sorts: SortId[] = Array.from({ length: cfg.total }, (_, k) => (k < s.count ? s.target : distractors[k % distractors.length]));
  rng.shuffle(sorts);
  const start = s.t + INTRO;
  s.animals = sorts.map((sort, k) => ({
    id: s.nextId++,
    sort,
    lane: rng.int(0, LANES.length - 1),
    spawnAt: start + (k / cfg.total) * cfg.window + rng.range(-0.2, 0.2),
    speed: rng.range(cfg.speed[0], cfg.speed[1]),
    dir: cfg.both && rng.chance(0.4) ? -1 : 1,
  }));
  s.paradeEnd = Math.max(...s.animals.map((a) => a.spawnAt + (EDGE * 2) / a.speed)) + 0.3;
  s.guesses = s.guesses.map(() => null);
  s.botAt = s.botAt.map(() => null);
  s.phase = 'intro';
  s.phaseAt = s.t;
}

function animalX(a: Animal, t: number): number {
  return a.dir * (-EDGE + a.speed * (t - a.spawnAt));
}

function finishGuess(s: ZaehlZooState): void {
  s.guesses = s.guesses.map((g) => (g === null ? 0 : g));
  s.guesses.forEach((g, i) => (s.total[i] += Math.abs(g! - s.count)));
  s.phase = 'reveal';
  s.phaseAt = s.t;
}

export const zaehlZoo: MinigameDef<ZaehlZooState> = {
  id: 'zaehlZoo',
  format: 'ffa',
  control: 'draw',
  theme: 'island',
  duration: 55,
  setup(players: MgPlayer[], rng, opts) {
    const n = players.length;
    const s: ZaehlZooState = {
      t: 0,
      practice: opts.practice,
      n,
      round: 1,
      phase: 'intro',
      phaseAt: 0,
      target: 'crab',
      count: 0,
      animals: [],
      paradeEnd: 0,
      nextId: 1,
      guesses: Array(n).fill(null),
      total: Array(n).fill(0),
      botAt: Array(n).fill(null),
    };
    startRound(s, rng);
    return s;
  },
  layout(s, i) {
    if (s.phase === 'guess' && s.guesses[i] === null) return { kind: 'number', min: 0, max: MAX, value: null };
    if (s.phase === 'guess') return { kind: 'wait', labelKey: 'mg.zaehlZoo.sent' };
    if (s.phase === 'intro' || s.phase === 'parade') return { kind: 'wait', labelKey: 'mg.zaehlZoo.watch' };
    return { kind: 'wait', labelKey: 'ctrl.watch' };
  },
  input(s, i, input) {
    if (input.type !== 'number' || s.phase !== 'guess' || s.guesses[i] !== null) return;
    if (!Number.isFinite(input.value)) return;
    s.guesses[i] = clamp(Math.round(input.value), 0, MAX);
  },
  tick(s, dt, rng) {
    s.t += dt;
    if (s.phase === 'intro' && s.t >= s.phaseAt + INTRO) {
      s.phase = 'parade';
      s.phaseAt = s.t;
    } else if (s.phase === 'parade' && s.t >= s.paradeEnd) {
      s.phase = 'guess';
      s.phaseAt = s.t;
    } else if (s.phase === 'guess') {
      if (s.guesses.every((g) => g !== null) || s.t >= s.phaseAt + GUESS) finishGuess(s);
    } else if (s.phase === 'reveal' && s.t >= s.phaseAt + REVEAL) {
      if (s.round >= ROUND_CFG.length) {
        if (!s.practice) {
          s.phase = 'done';
          return;
        }
        s.round = 0;
        s.total = s.total.map(() => 0);
      }
      s.round++;
      startRound(s, rng);
    }
  },
  isOver: (s) => s.phase === 'done',
  result: (s) => ranksFromScores(s.total, false),
  bot(s, i, level, rng) {
    if (s.phase !== 'guess' || s.guesses[i] !== null) return [];
    if (s.botAt[i] === null) s.botAt[i] = s.phaseAt + rng.range(1, { easy: 4, medium: 3, hard: 2.5 }[level]);
    if (s.t < s.botAt[i]!) return [];
    const sigma = { easy: 2.1, medium: 1.1, hard: 0.45 }[level] * (0.8 + 0.2 * s.round);
    return [{ type: 'number', value: clamp(Math.round(s.count + rng.noise() * sigma), 0, MAX) }];
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'meadow', kind: 'box', x: 0, y: -0.25, z: 3, sx: EDGE * 2 + 4, sy: 0.5, sz: 12, color: '#8fd16a' },
      { id: 'path', kind: 'box', x: 0, y: 0.01, z: 3, sx: EDGE * 2 + 4, sy: 0.02, sz: 10.5, color: '#e3cf9b' },
      { id: 'palmL', kind: 'palm', x: -EDGE - 1, y: 0, z: 10 },
      { id: 'palmR', kind: 'palm', x: EDGE + 1, y: 0, z: 10 },
      { id: 'bushL', kind: 'sphere', x: -EDGE - 0.5, y: 1, z: 3, sx: 3, sy: 2.4, sz: 11, color: '#3f9e4a' },
      { id: 'bushR', kind: 'sphere', x: EDGE + 0.5, y: 1, z: 3, sx: 3, sy: 2.4, sz: 11, color: '#3f9e4a' },
    ];
    const sd = SORTS[s.target];
    // the animal to count, shown on a pedestal (big during intro/reveal, small during the parade)
    const big = s.phase === 'intro' || s.phase === 'reveal' || s.phase === 'done';
    const sc = big ? 2 : 1;
    entities.push({ id: 'pedestal', kind: 'cylinder', x: 0, y: big ? 1 : 0.4, z: big ? 4 : 12, sx: 2.6, sy: big ? 2 : 0.8, sz: 2.6, color: '#f0c04a' });
    entities.push({
      id: 'sample',
      kind: sd.kind,
      x: 0,
      y: (big ? 2 : 0.8) + sd.y * sc,
      z: big ? 4 : 12,
      sx: sd.sx * sc,
      sy: sd.sy * sc,
      sz: sd.sz * sc,
      color: sd.color,
      glow: true,
      label: s.phase === 'reveal' || s.phase === 'done' ? String(s.count) : '?',
    });
    if (s.phase === 'parade') {
      for (const a of s.animals) {
        if (s.t < a.spawnAt) continue;
        const x = animalX(a, s.t);
        if (Math.abs(x) > EDGE) continue;
        const d = SORTS[a.sort];
        const hop = Math.abs(Math.sin((s.t - a.spawnAt) * a.speed * 1.4)) * d.hop;
        entities.push({ id: `a${a.id}`, kind: d.kind, x, y: d.y + hop, z: LANES[a.lane], sx: d.sx, sy: d.sy, sz: d.sz, color: d.color, ry: a.dir > 0 ? 0 : Math.PI });
      }
    }
    for (let i = 0; i < s.n; i++) {
      const g = s.guesses[i];
      const reveal = s.phase === 'reveal' || s.phase === 'done';
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: rowSpawn(s.n, 3.4, i),
        y: 0,
        z: -5,
        anim: reveal && g !== null ? (g === s.count ? 'cheer' : Math.abs(g - s.count) >= 3 ? 'sad' : 'idle') : s.phase === 'guess' && g !== null ? 'jump' : 'idle',
        label: reveal && g !== null ? String(g) : undefined,
      });
    }
    const hud: MgHud = {};
    if (s.phase === 'intro') hud.message = { key: 'mg.zaehlZoo.find', params: { animal: `mg.zaehlZoo.sort.${s.target}` } };
    else if (s.phase === 'guess') {
      hud.message = { key: 'mg.zaehlZoo.guess', params: { animal: `mg.zaehlZoo.sort.${s.target}` } };
      hud.timer = Math.max(0, s.phaseAt + GUESS - s.t);
    } else if (s.phase === 'reveal' || s.phase === 'done') hud.message = { key: 'mg.zaehlZoo.answer', params: { n: s.count } };
    if (s.phase === 'guess') hud.scores = s.guesses.map((g, i) => ({ player: i, value: g !== null ? '✔' : '…' }));
    else if (s.phase === 'reveal' || s.phase === 'done')
      hud.scores = s.guesses.map((g, i) => ({ player: i, value: `${g ?? 0} (±${Math.abs((g ?? 0) - s.count)})` }));
    else hud.scores = s.total.map((v, i) => ({ player: i, value: `±${v}` }));
    return {
      env: 'grass',
      camera: { alpha: -Math.PI / 2, beta: 0.95, radius: 27, target: [0, 0, 2.5] },
      entities,
      hud,
    };
  },
};
