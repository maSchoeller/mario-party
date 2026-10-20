import type { MinigameDef } from '../types';
import { flossRumble } from './flossRumble';
import { paketKette } from './paketKette';
import { schatzTauziehen } from './schatzTauziehen';
import { tandemTretboot } from './tandemTretboot';
import { weichenChaos } from './weichenChaos';

/** 2 vs 2 minigames (target: 5). */
export const TEAM_GAMES: MinigameDef[] = [flossRumble, tandemTretboot, paketKette, weichenChaos, schatzTauziehen];
