import type { MinigameDef } from '../types';
import { gipfelsturm } from './gipfelsturm';
import { memoDuell } from './memoDuell';
import { schnellzieher } from './schnellzieher';
import { schnickSchnack } from './schnickSchnack';

/** Duel minigames (target: 3) plus the final minigame Gipfelsturm (format ffa, final: true). */
export const DUEL_GAMES: MinigameDef[] = [schnellzieher, schnickSchnack, memoDuell, gipfelsturm];
