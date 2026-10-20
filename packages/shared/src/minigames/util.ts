import type { BotLevel } from '../config';
import type { Rng } from '../rng';
import { BOT_SKILL, type MgCamera, type MgPlayer } from './types';

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
