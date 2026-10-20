import type { MinigameDef } from '../types';
import { gipfelSprint } from './gipfelSprint';
import { kokosRegen } from './kokosRegen';
import { lavaSeil } from './lavaSeil';
import { schubsScholle } from './schubsScholle';
import { strichKuenstler } from './strichKuenstler';
import { wackelBruecke } from './wackelBruecke';
import { zaehlZoo } from './zaehlZoo';
import { zehnSekunden } from './zehnSekunden';

/** Free-for-all minigames (target: 8). */
export const FFA_GAMES: MinigameDef[] = [kokosRegen, schubsScholle, gipfelSprint, wackelBruecke, zehnSekunden, strichKuenstler, zaehlZoo, lavaSeil];
