import { ONE_VS_THREE_GAMES } from './games/group-1v3';
import { TEAM_GAMES } from './games/group-2v2';
import { DUEL_GAMES } from './games/group-duel';
import { FFA_GAMES } from './games/group-ffa';
import type { MinigameDef } from './types';

/** All minigame modules. New minigames only need to be added to their group file (MINI-07). */
export const ALL_MINIGAMES: MinigameDef[] = [...FFA_GAMES, ...TEAM_GAMES, ...ONE_VS_THREE_GAMES, ...DUEL_GAMES];
