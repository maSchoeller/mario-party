import type { Rng } from '../../rng';
import type { EntityKind, MgEntity, MgHud, MgPlayer, MinigameDef } from '../types';
import { ageFx, clamp, emitFx, ranksFromScores, rowSpawn, viewFx, type FxState } from '../util';

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

export interface ZaehlZooState extends FxState {
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
  // the animal to count appears on the pedestal
  emitFx(s, { kind: 'sparkle', sfx: 'magic', x: 0, y: 3, z: 4, s: 1.3 }, 0.5);
}

function animalX(a: Animal, t: number): number {
  return a.dir * (-EDGE + a.speed * (t - a.spawnAt));
}

function finishGuess(s: ZaehlZooState): void {
  s.guesses = s.guesses.map((g) => (g === null ? 0 : g));
  s.guesses.forEach((g, i) => (s.total[i] += Math.abs(g! - s.count)));
  s.phase = 'reveal';
  s.phaseAt = s.t;
  // reveal: the count pops up on the pedestal, exact guesses sparkle, far-off ones fizzle
  emitFx(s, { kind: 'ring', sfx: 'ding', x: 0, y: 2.2, z: 4, color: '#f2c14e', s: 1.4 }, 0.5);
  let cheered = false;
  s.guesses.forEach((g, i) => {
    const x = rowSpawn(s.n, 3.4, i);
    const off = Math.abs(g! - s.count);
    if (off === 0) {
      emitFx(s, { kind: 'confetti', sfx: cheered ? undefined : 'correct', x, y: 2.2, z: -5, s: 0.8 }, 0.5);
      cheered = true;
    } else if (off >= 3) emitFx(s, { kind: 'smoke', x, y: 1.8, z: -5, s: 0.6 }, 0.5);
  });
}

/**
 * Two cartoon eyes on the camera side of an animal (looking a little ahead), so the
 * primitives read as creatures. Same for every sort – the look-alikes stay look-alikes.
 */
function eyes(out: MgEntity[], id: string, sort: SortId, x: number, y: number, z: number, dir: number, sc: number): void {
  const d = SORTS[sort];
  const [ax, ay, az] = [(d.sx * sc) / 2, (d.sy * sc) / 2, (d.sz * sc) / 2];
  const size = 0.24 * Math.sqrt(sc);
  for (const side of [-1, 1]) {
    let ex: number;
    let ey: number;
    let ez: number;
    if (d.kind === 'cone') {
      // penguin: cone with its base at y
      const h = d.sy * sc * 0.62;
      const r = ax * (1 - 0.62) + size * 0.15;
      const ang = dir * 0.3 + side * 0.32;
      ex = x + Math.sin(ang) * r;
      ey = y + h;
      ez = z - Math.cos(ang) * r;
    } else {
      const ox = dir * ax * 0.32 + side * ax * 0.22;
      const oy = ay * 0.32;
      const f = Math.max(0.05, 1 - (ox / ax) ** 2 - (oy / ay) ** 2);
      ex = x + ox;
      ey = y + oy;
      ez = z - az * Math.sqrt(f);
    }
    out.push({ id: `${id}e${side}`, kind: 'sphere', x: ex, y: ey, z: ez, sx: size, sy: size, sz: size * 0.7, color: '#ffffff' });
    out.push({ id: `${id}p${side}`, kind: 'sphere', x: ex + dir * size * 0.12, y: ey, z: ez - size * 0.3, sx: size * 0.5, sy: size * 0.55, sz: size * 0.4, color: '#24222e' });
  }
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
      fx: [],
      fxN: 0,
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
    emitFx(s, { kind: 'pop', sfx: 'click', x: rowSpawn(s.n, 3.4, i), y: 2.8, z: -5, s: 0.7 });
  },
  tick(s, dt, rng) {
    const prevT = s.t;
    s.t += dt;
    ageFx(s, dt);
    // animals burst out of the bushes (silent: sounds must not give away the count)
    if (s.phase === 'intro' || s.phase === 'parade') {
      for (const a of s.animals) if (a.spawnAt > prevT && a.spawnAt <= s.t) emitFx(s, { kind: 'dust', x: -a.dir * (EDGE - 0.6), y: 0.3, z: LANES[a.lane], s: 0.6 });
    }
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
      // parade ground: a meadow with a trodden sand track, bushes hide both ends
      { id: 'meadow', kind: 'box', x: 0, y: -0.25, z: 2.5, sx: EDGE * 2 + 4, sy: 0.5, sz: 13, color: '#8fcb6e', mat: 'grass' },
      { id: 'path', kind: 'box', x: 0, y: 0.01, z: 3, sx: EDGE * 2 + 4, sy: 0.04, sz: 10.5, color: '#efd9a8', mat: 'sand' },
      { id: 'bushL', kind: 'sphere', x: -EDGE - 0.6, y: 0.8, z: 3, sx: 2.8, sy: 2.2, sz: 11, color: '#5aa654', mat: 'grass' },
      { id: 'bushR', kind: 'sphere', x: EDGE + 0.6, y: 0.8, z: 3, sx: 2.8, sy: 2.2, sz: 11, color: '#5aa654', mat: 'grass' },
      // visitors' boardwalk with a low fence towards the parade
      { id: 'deck', kind: 'box', x: 0, y: -0.12, z: -5.2, sx: Math.max(10, s.n * 3.4 + 3), sy: 0.3, sz: 2.6, color: '#c99a66', mat: 'planks' },
      { id: 'palmL', kind: 'palm', x: -EDGE - 1, y: 0, z: 10 },
      { id: 'palmR', kind: 'palm', x: EDGE + 1, y: 0, z: 10, ry: 2 },
      { id: 'palmL2', kind: 'prop', prop: 'palm2', x: -EDGE - 2.6, y: 0, z: -1.5, ry: 0.8 },
      { id: 'palmR2', kind: 'prop', prop: 'palm2', x: EDGE + 2.8, y: 0, z: 0.5, ry: 3.6 },
      { id: 'bushL1', kind: 'prop', prop: 'bush', x: -EDGE + 1.1, y: 0, z: -2.8, sx: 1.2 },
      { id: 'bushL2', kind: 'prop', prop: 'bush', x: -EDGE + 1.3, y: 0, z: 8.9, sx: 1.1, ry: 1 },
      { id: 'bushR1', kind: 'prop', prop: 'bush', x: EDGE - 1.1, y: 0, z: -2.8, sx: 1.2, ry: 2 },
      { id: 'bushR2', kind: 'prop', prop: 'bush', x: EDGE - 1.3, y: 0, z: 8.9, sx: 1.1 },
      { id: 'fernL', kind: 'prop', prop: 'fern', x: -EDGE + 0.4, y: 0, z: -1.6, sx: 1.3 },
      { id: 'fernR', kind: 'prop', prop: 'fern', x: EDGE - 0.4, y: 0, z: 7.6, sx: 1.3 },
      { id: 'flowersL', kind: 'prop', prop: 'flowers', x: -EDGE + 2, y: 0, z: 8.7 },
      { id: 'flowersR', kind: 'prop', prop: 'flowers', x: EDGE - 2.2, y: 0, z: -2.5 },
      { id: 'flowersM', kind: 'prop', prop: 'flowers', x: 5.2, y: 0, z: 8.65 },
      { id: 'grassM', kind: 'prop', prop: 'grass', x: -5.4, y: 0, z: 8.65, sx: 1.3 },
      { id: 'zooSign', kind: 'prop', prop: 'signpost', x: -EDGE - 1.2, y: 0, z: -5.6, ry: 0.4 },
      { id: 'hay1', kind: 'prop', prop: 'haybale', x: EDGE + 1.6, y: 0, z: -5.2, ry: 0.3 },
      { id: 'crate1', kind: 'prop', prop: 'crate', x: EDGE + 0.4, y: 0, z: -6.4, ry: 0.5 },
      { id: 'shellF1', kind: 'prop', prop: 'shell', x: -7.4, y: -0.1, z: -8.2, ry: 0.6, sx: 1.3 },
      { id: 'shellF2', kind: 'prop', prop: 'shell', x: 4.6, y: -0.1, z: -7.6, ry: 2.2, sx: 1.2 },
      { id: 'rockF1', kind: 'prop', prop: 'rocksmall', x: 9.4, y: -0.12, z: -8.4, ry: 1.4, sx: 1.5 },
      { id: 'rockF2', kind: 'prop', prop: 'rocksmall', x: 10.2, y: -0.12, z: -8, ry: 0.2, sx: 0.9 },
      { id: 'grassF1', kind: 'prop', prop: 'grass', x: -11.2, y: -0.1, z: -7.8, sx: 1.4 },
      { id: 'grassF2', kind: 'prop', prop: 'grass', x: -10.6, y: -0.1, z: -8.3, sx: 1.1 },
      { id: 'driftF', kind: 'prop', prop: 'driftwood', x: -1.6, y: -0.1, z: -8.6, ry: 0.3 },
      { id: 'flagL', kind: 'prop', prop: 'flag', x: -3.2, y: 0, z: 8.6, sx: 0.8, color: '#f2c14e' },
      { id: 'flagR', kind: 'prop', prop: 'flag', x: 3.2, y: 0, z: 8.6, sx: 0.8, color: '#e8676b' },
    ];
    // lumpy hedges on both ends (the animals come out of them)
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        entities.push({ id: `hedge${side}_${k}`, kind: 'prop', prop: 'bushround', x: side * (EDGE + 0.3 + (k % 2) * 0.5), y: 0.2 + (k % 2) * 0.25, z: -1.4 + k * 2.2, ry: k * 1.7 + side, sx: 2.3 + (k % 3) * 0.25 });
      }
    }
    const fenceW = 2.1 * 0.7;
    for (let k = 0; k < 18; k++) entities.push({ id: `fence${k}`, kind: 'prop', prop: 'fence', x: (k - 8.5) * fenceW, y: 0, z: -3.45, sx: 0.7 });
    const sd = SORTS[s.target];
    // the animal to count, shown on a pedestal (big during intro/reveal, small during the parade)
    const big = s.phase === 'intro' || s.phase === 'reveal' || s.phase === 'done';
    const sc = big ? 2 : 1;
    entities.push({ id: 'pedestal', kind: 'cylinder', x: 0, y: big ? 1 : 0.3, z: big ? 4 : 12, sx: 2.6, sy: big ? 2 : 1, sz: 2.6, color: '#f0c04a', mat: 'gold', taper: 0.86 });
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
    eyes(entities, 'sample', s.target, 0, (big ? 2 : 0.8) + sd.y * sc, big ? 4 : 12, 1, sc);
    if (s.phase === 'parade') {
      for (const a of s.animals) {
        if (s.t < a.spawnAt) continue;
        const x = animalX(a, s.t);
        if (Math.abs(x) > EDGE) continue;
        const d = SORTS[a.sort];
        const hop = Math.abs(Math.sin((s.t - a.spawnAt) * a.speed * 1.4)) * d.hop;
        entities.push({ id: `a${a.id}`, kind: d.kind, x, y: d.y + hop, z: LANES[a.lane], sx: d.sx, sy: d.sy, sz: d.sz, color: d.color, ry: a.dir > 0 ? 0 : Math.PI });
        eyes(entities, `a${a.id}`, a.sort, x, d.y + hop, LANES[a.lane], a.dir, 1);
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
      scenery: { set: 'beach', clear: { w: EDGE * 2 + 8, d: 22, z: 2.5 } },
      camera: { alpha: -Math.PI / 2, beta: 0.95, radius: 27, target: [0, 0, 2.5] },
      entities,
      hud,
      fx: viewFx(s),
    };
  },
};
