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
}

export type ControllerLayout =
  | { kind: 'joystick'; buttons?: { id: string; labelKey: string }[] }
  | { kind: 'mash'; labelKey: string }
  | { kind: 'button'; labelKey: string }
  | { kind: 'tilt'; labelKey?: string }
  | { kind: 'shake'; labelKey?: string }
  | { kind: 'draw'; shape: [number, number][] }
  | { kind: 'swipe'; labelKey?: string }
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
  | 'lantern';

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

/** Helper: bot skill parameters by level. */
export const BOT_SKILL: Record<BotLevel, { reaction: number; accuracy: number; speed: number }> = {
  easy: { reaction: 0.45, accuracy: 0.6, speed: 0.68 },
  medium: { reaction: 0.35, accuracy: 0.75, speed: 0.8 },
  hard: { reaction: 0.28, accuracy: 0.88, speed: 0.92 },
};

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
