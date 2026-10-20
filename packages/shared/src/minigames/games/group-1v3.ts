import type { MinigameDef } from '../types';
import { ballonBombardement } from './ballonBombardement';
import { kokosKanonier } from './kokosKanonier';
import { laternenJagd } from './laternenJagd';
import { wandLabyrinth } from './wandLabyrinth';

/** 1 vs 3 minigames (target: 4). */
export const ONE_VS_THREE_GAMES: MinigameDef[] = [kokosKanonier, wandLabyrinth, laternenJagd, ballonBombardement];
