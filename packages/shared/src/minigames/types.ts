import type { BotLevel, CharacterId, PlayerColor } from '../config';
import type { Rng } from '../rng';

/**
 * Minigame module contract (MINI-07): setup, input, tick, result, bot AI, plus a
 * declarative view that the host renders generically and a controller layout that the
 * phone renders without any 3D engine (CTRL-07).
 */
export type MgFormat = 'ffa' | '2v2' | '1v3' | 'duel';

/** One clearly recognizable control scheme per game (MINI-05, SPEC 7.2). */
export type ControlKind = 'joystick' | 'tap' | 'motion' | 'draw';

export type MgTheme = 'island' | 'volcano' | 'city' | 'any';

export interface MgPlayer {
  /** index inside the minigame (0..n-1) */
  idx: number;
  /** player index in the game */
  gameIdx: number;
  /** team number. FFA: own index. 2v2: 0/1. 1v3: 0 = solo, 1 = trio. Duel: 0/1 */
  team: number;
  character: CharacterId;
  color: PlayerColor;
  isBot: boolean;
  botLevel: BotLevel;
  /**
   * Bot "Tagesform" within one minigame (v0.5): 0.9 = off day … 1.1 = great day, 1 = nominal.
   * Scales the human reference values (see `botRef`), so equal levels don't play identically.
   */
  form?: number;
}

/**
 * Mini map on the phone (v0.5) – only what this player may know anyway: the own position
 * and fixed landmarks, never other players. Coordinates −1..1, x to the right, y away from
 * the TV camera (= up on the TV picture).
 */
export interface MgRadar {
  x: number;
  y: number;
  shape: 'round' | 'rect';
  /** fixed landmarks (x, y, radius), e.g. hiding bushes */
  marks?: [number, number, number][];
  /** entry / gate marker on the edge */
  gate?: [number, number];
  /** the own figure is visible on the TV right now (e.g. caught in a lantern beam) */
  seen?: boolean;
}

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

export type ControllerLayout =
  | { kind: 'joystick'; buttons?: { id: string; labelKey: string }[]; radar?: MgRadar }
  | { kind: 'mash'; labelKey: string }
  | { kind: 'button'; labelKey: string }
  | { kind: 'tilt'; labelKey?: string }
  | { kind: 'shake'; labelKey?: string }
  | { kind: 'draw'; shape: [number, number][] }
  /** `color`: the item to swipe right now (e.g. parcel colour), `dirColors`: colour per direction */
  | { kind: 'swipe'; labelKey?: string; color?: string | null; dirColors?: Partial<Record<SwipeDir, string>> }
  | { kind: 'choice'; options: { id: string; labelKey: string; color?: string; icon?: string }[]; locked?: string | null }
  | { kind: 'number'; min: number; max: number; value?: number | null }
  | { kind: 'pads'; count: number; colors: string[]; active?: boolean }
  | { kind: 'wait'; labelKey: string };

export type MgInput =
  | { type: 'stick'; x: number; y: number }
  | { type: 'button'; id: string; down: boolean }
  | { type: 'tap' }
  /** t = minigame clock seconds, measured on the phone with synchronized clock (NET-05) */
  | { type: 'press'; t: number }
  | { type: 'tilt'; x: number; y: number }
  | { type: 'shake'; power: number }
  | { type: 'draw'; points: [number, number][]; duration: number }
  | { type: 'swipe'; dir: 'up' | 'down' | 'left' | 'right' }
  | { type: 'choice'; id: string }
  | { type: 'number'; value: number }
  | { type: 'pad'; idx: number };

export type EntityKind =
  | 'player'
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'coin'
  | 'star'
  | 'torus'
  | 'plane'
  | 'rock'
  | 'palm'
  | 'balloon'
  | 'coconut'
  | 'boat'
  | 'train'
  | 'lantern'
  /** a model from the prop library (`prop` = id, e.g. 'barrel', 'chest', 'torch'), base at y */
  | 'prop'
  /** animated water (or lava with mat 'lava') surface `sx × sz` at height y */
  | 'water';

/**
 * Surface of box/cylinder/plane/cone/sphere entities: a tiling detail texture plus a soft
 * vertical shading (like the baked AO of the props) multiplied over `color`.
 */
export type MgSurface = 'wood' | 'planks' | 'stone' | 'tiles' | 'metal' | 'ice' | 'snow' | 'sand' | 'grass' | 'cloth' | 'rope' | 'lava' | 'paper' | 'gold' | 'basalt';

/**
 * Backdrop around the play area (v0.4): landscape, water, vegetation, sky, light and
 * ambient particles/sound. Purely decorative – the game still draws its play area itself.
 */
export type MgSet =
  | 'lagoon'
  | 'beach'
  | 'volcano'
  | 'summit'
  | 'meadow'
  | 'garden'
  | 'city'
  | 'ice'
  | 'clouds'
  | 'studio'
  | 'desert'
  | 'nightwood';

export interface MgScenery {
  set: MgSet;
  /** play area that stays free of scenery: circle (r) or rectangle (w × d), centered at x/z */
  clear: { x?: number; z?: number; r?: number; w?: number; d?: number };
  /** ground height of the backdrop next to the play area (default 0) */
  ground?: number;
  /** water / lava level (default: just below the ground) */
  water?: number;
  /** variation seed for the scatter (default 1) */
  seed?: number;
}

/** Sound effects a minigame can trigger (host plays them, see MgFx). */
export type MgSfx =
  | 'coin'
  | 'splash'
  | 'whoosh'
  | 'boom'
  | 'buzz'
  | 'ding'
  | 'thud'
  | 'pop'
  | 'jump'
  | 'land'
  | 'cheer'
  | 'aww'
  | 'crack'
  | 'sizzle'
  | 'cannon'
  | 'catch'
  | 'correct'
  | 'click'
  | 'magic'
  | 'scribble'
  | 'creak'
  | 'paddle'
  | 'stomp'
  | 'train'
  | 'swing'
  | 'slide';

/** One-shot visual effect. */
export type MgFxKind = 'splash' | 'dust' | 'sparkle' | 'coins' | 'hit' | 'pop' | 'boom' | 'confetti' | 'smoke' | 'ice' | 'embers' | 'ring';

/**
 * One-shot effect + sound (v0.4). The host fires every id once (keep the event in the
 * view for a few frames, e.g. 0.3–0.6 s, with a unique, never reused id).
 */
export interface MgFx {
  id: string;
  kind?: MgFxKind;
  sfx?: MgSfx;
  x: number;
  y: number;
  z: number;
  color?: string;
  /** size / strength multiplier (default 1) */
  s?: number;
}

export interface MgEntity {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  color?: string;
  /** minigame player index (for kind 'player' and player-colored props) */
  player?: number;
  anim?: 'idle' | 'walk' | 'jump' | 'cheer' | 'sad' | 'hit' | 'roll';
  alpha?: number;
  glow?: boolean;
  /** text label floating above the entity (already localized params are not allowed – use key) */
  labelKey?: string;
  label?: string;
  /** surface detail for primitives (v0.4) */
  mat?: MgSurface;
  /** prop library id for kind 'prop' */
  prop?: string;
  /** cylinder with mat: top diameter relative to the bottom (e.g. 0.8 = sloped beach) */
  taper?: number;
}

export interface MgCamera {
  /** Babylon ArcRotate style: alpha (around y), beta (from top), radius, target */
  alpha: number;
  beta: number;
  radius: number;
  target: [number, number, number];
}

export interface MgHud {
  /** seconds remaining */
  timer?: number;
  /** per minigame player score text */
  scores?: { player: number; value: string }[];
  /** per team score text */
  teams?: { team: number; labelKey: string; value: string }[];
  /** progress bars 0..1 per player */
  bars?: { player: number; value: number }[];
  /** big center message */
  message?: { key: string; params?: Record<string, string | number> };
}

export interface MgView {
  env: 'water' | 'lava' | 'grass' | 'night' | 'sky' | 'city' | 'sand' | 'ice';
  camera: MgCamera;
  entities: MgEntity[];
  hud: MgHud;
  /** backdrop around the play area (v0.4) */
  scenery?: MgScenery;
  /** one-shot effects and sounds (v0.4) */
  fx?: MgFx[];
}

export interface MgSetupOptions {
  practice: boolean;
}

export interface MinigameDef<S = any> {
  id: string;
  /** i18n keys: mg.<id>.name / .desc / .controls */
  format: MgFormat;
  control: ControlKind;
  /** Uses gyro or shake (A11Y-02 filter) */
  motion?: boolean;
  theme: MgTheme;
  /** nominal play time in seconds (MINI-03: 30–60) */
  duration: number;
  /** Final minigame (Gipfelsturm) is not drawn randomly */
  final?: boolean;
  setup(players: MgPlayer[], rng: Rng, opts: MgSetupOptions): S;
  layout(state: S, playerIdx: number): ControllerLayout;
  input(state: S, playerIdx: number, input: MgInput): void;
  tick(state: S, dt: number, rng: Rng): void;
  isOver(state: S): boolean;
  /** rank per minigame player: 0 = best, ties allowed. */
  result(state: S): number[];
  /** Bot AI (BOT-03). Called every tick for bot players; returns inputs to apply. */
  bot(state: S, playerIdx: number, level: BotLevel, rng: Rng, dt: number): MgInput[];
  view(state: S): MgView;
}

/** Helper: bot skill parameters by level (legacy; new bot code uses `HUMAN_REF` / `botRef`). */
export const BOT_SKILL: Record<BotLevel, { reaction: number; accuracy: number; speed: number }> = {
  easy: { reaction: 0.45, accuracy: 0.6, speed: 0.68 },
  medium: { reaction: 0.35, accuracy: 0.75, speed: 0.8 },
  hard: { reaction: 0.28, accuracy: 0.88, speed: 0.92 },
};

/**
 * Human reference model (v0.5): what a person on the couch can do with a phone in front of
 * a TV. Bots are calibrated against it – easy ≈ child / first-timer, medium ≈ casual adult,
 * hard ≈ practised adult (top ~20 %) – and never beat `HUMAN_CAP` (top human).
 *
 * Two rules go with it:
 * - Information: a bot only uses what a human sees on the TV (no hidden wind, exact counts,
 *   maze search, future spawns), observed with `PERCEPTION` delay plus its reaction time.
 * - Variance: every bot plays each minigame with its own `form` (±10 %), so hard beats
 *   medium roughly 70:30 instead of 100:0.
 */
export interface HumanRef {
  /** simple reaction time to a visual signal, mean / sd in seconds (without perception delay) */
  reaction: number;
  reactionSd: number;
  /** choice reaction between 2–4 options (s) and the rate of wrong picks / colour mix-ups */
  choice: number;
  choiceError: number;
  /** timing on a predictable mover (jump over a rope, hit a beat): sd in seconds */
  timingSd: number;
  /** estimating a duration blind: coefficient of variation (0.08 = ±0.8 s on 10 s) */
  blindCv: number;
  /** sustained one-finger mashing (taps/s) and the slowdown after 15 s (0.1 = −10 %) */
  tapRate: number;
  fatigue: number;
  /** rhythm jitter when alternating presses (s) */
  rhythmSd: number;
  /** real shake impulses per second */
  shakeRate: number;
  /** joystick: deflection people actually use and their heading noise (rad) */
  stickMag: number;
  headingNoise: number;
  /** tilt control: steady-state error (−1..1 scale) and response lag (s) */
  tiltError: number;
  tiltLag: number;
  /** counting 10–20 moving objects: error sd, and chance to count a look-alike by mistake */
  countSd: number;
  lookAlike: number;
  /** memory span (sequence length with 50 % success) */
  memorySpan: number;
  /** tracing a shape: mean deviation (0..1 canvas) and time for one shape (s) */
  traceDev: number;
  traceTime: number;
}

export const HUMAN_REF: Record<BotLevel, HumanRef> = {
  easy: {
    reaction: 0.4, reactionSd: 0.08, choice: 0.85, choiceError: 0.08, timingSd: 0.07, blindCv: 0.15,
    tapRate: 5.0, fatigue: 0.15, rhythmSd: 0.06, shakeRate: 4.5, stickMag: 0.9, headingNoise: 0.25,
    tiltError: 0.15, tiltLag: 0.45, countSd: 2.2, lookAlike: 0.2, memorySpan: 5, traceDev: 0.05, traceTime: 7,
  },
  medium: {
    reaction: 0.28, reactionSd: 0.05, choice: 0.65, choiceError: 0.04, timingSd: 0.05, blindCv: 0.08,
    tapRate: 6.3, fatigue: 0.1, rhythmSd: 0.04, shakeRate: 5.5, stickMag: 1, headingNoise: 0.15,
    tiltError: 0.1, tiltLag: 0.38, countSd: 1.4, lookAlike: 0.12, memorySpan: 7, traceDev: 0.03, traceTime: 5,
  },
  hard: {
    reaction: 0.23, reactionSd: 0.035, choice: 0.52, choiceError: 0.02, timingSd: 0.035, blindCv: 0.045,
    tapRate: 7.5, fatigue: 0.05, rhythmSd: 0.025, shakeRate: 6.5, stickMag: 1, headingNoise: 0.09,
    tiltError: 0.06, tiltLag: 0.32, countSd: 0.9, lookAlike: 0.06, memorySpan: 9, traceDev: 0.02, traceTime: 3.5,
  },
};

/** Top-human limits: no bot may be better than this, whatever its form. */
export const HUMAN_CAP = {
  reaction: 0.18,
  choice: 0.42,
  choiceError: 0.01,
  timingSd: 0.025,
  blindCv: 0.025,
  tapRate: 9.5,
  rhythmSd: 0.015,
  shakeRate: 8,
  headingNoise: 0.05,
  countSd: 0.5,
  memorySpan: 11,
  traceDev: 0.012,
  traceTime: 2.5,
};

/**
 * Reference values for one bot in one minigame: `HUMAN_REF[level]` scaled by its form
 * (better form = faster, steadier, fewer mistakes) and clamped to `HUMAN_CAP`.
 */
export function botRef(level: BotLevel, form = 1): HumanRef {
  const r = HUMAN_REF[level];
  const better = form; // > 1 = better
  const worse = 2 - form; // < 1 = better
  return {
    reaction: Math.max(HUMAN_CAP.reaction, r.reaction * worse),
    reactionSd: r.reactionSd,
    choice: Math.max(HUMAN_CAP.choice, r.choice * worse),
    choiceError: Math.max(HUMAN_CAP.choiceError, r.choiceError * worse),
    timingSd: Math.max(HUMAN_CAP.timingSd, r.timingSd * worse),
    blindCv: Math.max(HUMAN_CAP.blindCv, r.blindCv * worse),
    tapRate: Math.min(HUMAN_CAP.tapRate, r.tapRate * better),
    fatigue: r.fatigue,
    rhythmSd: Math.max(HUMAN_CAP.rhythmSd, r.rhythmSd * worse),
    shakeRate: Math.min(HUMAN_CAP.shakeRate, r.shakeRate * better),
    stickMag: r.stickMag,
    headingNoise: Math.max(HUMAN_CAP.headingNoise, r.headingNoise * worse),
    tiltError: r.tiltError * worse,
    tiltLag: r.tiltLag * worse,
    countSd: Math.max(HUMAN_CAP.countSd, r.countSd * worse),
    lookAlike: r.lookAlike * worse,
    memorySpan: Math.min(HUMAN_CAP.memorySpan, r.memorySpan * better),
    traceDev: Math.max(HUMAN_CAP.traceDev, r.traceDev * worse),
    traceTime: Math.max(HUMAN_CAP.traceTime, r.traceTime * worse),
  };
}

/** Draws a bot's form for one minigame (uniform 0.9..1.1). */
export function rollBotForm(rng: Rng): number {
  return 0.9 + rng.next() * 0.2;
}

/**
 * "Tagesform": bots don't play every minigame at their nominal level, so a strong bot can
 * have an off day and a weak one a lucky run (couch chaos instead of esports).
 */
export function minigameBotLevel(base: BotLevel, rng: Rng): BotLevel {
  const r = rng.next();
  if (base === 'hard') return r < 0.6 ? 'hard' : r < 0.9 ? 'medium' : 'easy';
  if (base === 'easy') return r < 0.6 ? 'easy' : r < 0.9 ? 'medium' : 'hard';
  return r < 0.2 ? 'easy' : r < 0.8 ? 'medium' : 'hard';
}
