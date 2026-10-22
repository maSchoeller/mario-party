import type { BotLevel } from '../config';
import type { Rng } from '../rng';
import { BOT_SKILL, botRef, type HumanRef, type MgCamera, type MgFx, type MgPlayer } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2;
export const dist = (ax: number, az: number, bx: number, bz: number) => Math.sqrt(dist2(ax, az, bx, bz));

/**
 * Rotation (around y) so a character model – built facing -z (towards the default
 * camera) – looks in direction (dx, dz).
 */
export function faceAngle(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Ranks from scores (higher is better); equal scores share a rank (competition ranking). */
export function ranksFromScores(scores: number[], higherIsBetter = true): number[] {
  return scores.map((s) => scores.filter((o) => (higherIsBetter ? o > s : o < s)).length);
}

/** Team result: every member of the winning team(s) gets rank 0, the others rank 1. */
export function teamRanks(players: MgPlayer[], winningTeams: number[]): number[] {
  return players.map((p) => (winningTeams.includes(p.team) ? 0 : 1));
}

/** Ranks from per-team scores. */
export function teamRanksFromScores(players: MgPlayer[], teamScore: (team: number) => number): number[] {
  const teams = [...new Set(players.map((p) => p.team))];
  const best = Math.max(...teams.map(teamScore));
  const winners = teams.filter((t) => teamScore(t) === best);
  if (winners.length === teams.length) return players.map(() => 0);
  return teamRanks(players, winners);
}

export const CAM_TOP: MgCamera = { alpha: -Math.PI / 2, beta: 0.75, radius: 26, target: [0, 0, 0] };
export const CAM_SIDE: MgCamera = { alpha: -Math.PI / 2, beta: 1.2, radius: 22, target: [0, 1.5, 0] };

/** Spawn points on a circle. */
export function ringSpawn(n: number, r: number, i: number, offset = -Math.PI / 2): { x: number; z: number } {
  const a = offset + (i / n) * Math.PI * 2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/** Player spawn points in a row along x. */
export function rowSpawn(n: number, spacing: number, i: number): number {
  return (i - (n - 1) / 2) * spacing;
}

export function skill(level: BotLevel) {
  return BOT_SKILL[level];
}

/**
 * Small helper for bots that should act with a human-like reaction delay:
 * returns true once `delay` seconds have elapsed since `since`.
 */
export function botReady(now: number, since: number, level: BotLevel, rng: Rng): boolean {
  const s = BOT_SKILL[level];
  return now - since > s.reaction * (0.8 + rng.next() * 0.4);
}

/** Human reference values for bot `i` of a minigame (level + form, v0.5). */
export function refOf(players: MgPlayer[], i: number, level: BotLevel): HumanRef {
  return botRef(level, players[i]?.form ?? 1);
}

/**
 * One human-like reaction time: perception `lag` + reaction drawn around the reference
 * (never faster than the top-human cap baked into `ref`).
 */
export function reactTime(ref: HumanRef, rng: Rng, lag: number): number {
  return lag + Math.max(ref.reaction * 0.75, ref.reaction + rng.noise() * ref.reactionSd);
}

/** Chance per tick for an event with `rate` per second – independent of the tick length. */
export function chance(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Delayed perception for bots (v0.5): a small ring buffer of observed values (e.g. all
 * player positions), read back `delay` seconds late. JSON-serializable (plain arrays).
 */
export interface SeenBuf {
  t: number[];
  v: number[][];
}

export function seenBuf(): SeenBuf {
  return { t: [], v: [] };
}

/** Records a snapshot at time `t` and forgets everything older than `keep` seconds. */
export function seenPush(b: SeenBuf, t: number, v: number[], keep = 1): void {
  b.t.push(t);
  b.v.push(v);
  let drop = 0;
  while (drop < b.t.length - 1 && b.t[drop + 1] <= t - keep) drop++;
  if (drop) {
    b.t.splice(0, drop);
    b.v.splice(0, drop);
  }
}

/** The newest snapshot taken at or before `t` (the oldest one if `t` is earlier still). */
export function seenAt(b: SeenBuf, t: number): number[] | null {
  if (!b.t.length) return null;
  for (let k = b.t.length - 1; k >= 0; k--) if (b.t[k] <= t) return b.v[k];
  return b.v[0];
}

/**
 * Tap gate against two-thumb drumming: true if this tap counts (at least `minGap` after
 * the last counted one of the same player). `last` holds one time per player.
 */
export function tapCounts(last: number[], i: number, now: number, minGap: number): boolean {
  // small tolerance: taps exactly minGap apart on the 60 Hz clock may measure 0.09999 s
  if (now - (last[i] ?? -1e9) < minGap - 1e-6) return false;
  last[i] = now;
  return true;
}

/** Basic movement integration for joystick games. */
export function moveWithStick(
  p: { x: number; z: number; vx: number; vz: number },
  stick: { x: number; y: number },
  speed: number,
  dt: number,
  accel = 12,
): void {
  const len = Math.hypot(stick.x, stick.y);
  const sx = len > 1 ? stick.x / len : stick.x;
  const sy = len > 1 ? stick.y / len : stick.y;
  p.vx = lerp(p.vx, sx * speed, clamp(accel * dt, 0, 1));
  p.vz = lerp(p.vz, sy * speed, clamp(accel * dt, 0, 1));
  p.x += p.vx * dt;
  p.z += p.vz * dt;
}

/** Stick vector steering towards a target with accuracy noise. */
export function steerTo(fromX: number, fromZ: number, toX: number, toZ: number, rng: Rng, accuracy: number): { x: number; y: number } {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 0.15) return { x: 0, y: 0 };
  const noise = (1 - accuracy) * 0.9;
  const ang = Math.atan2(dz, dx) + rng.noise() * noise;
  const mag = clamp(len / 1.2, 0.3, 1);
  return { x: Math.cos(ang) * mag, y: Math.sin(ang) * mag };
}

export const TEAM_COLORS = ['#e8676b', '#5f8fe0'];

/**
 * One-shot effects (v0.4): games keep pending effects in their state (`fx`, `fxN`),
 * emit them on events and age them in tick(); view() hands them to the host, which fires
 * each id once when it appears.
 */
export interface FxState {
  fx: (MgFx & { ttl: number })[];
  fxN: number;
}

export function emitFx(s: FxState, fx: Omit<MgFx, 'id'>, ttl = 0.35): void {
  s.fx.push({ ...fx, id: `fx${s.fxN++}`, ttl });
}

export function ageFx(s: FxState, dt: number): void {
  if (s.fx.length) s.fx = s.fx.filter((f) => (f.ttl -= dt) > 0);
}

export function viewFx(s: FxState): MgFx[] {
  return s.fx.map(({ ttl: _ttl, ...f }) => f);
}
