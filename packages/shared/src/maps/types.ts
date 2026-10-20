/**
 * Data-driven map format (MAP-06). A map is a directed field graph plus metadata;
 * gimmick behavior is referenced by id and implemented in game/gimmicks.ts.
 */
export type FieldType =
  | 'blue'
  | 'red'
  | 'event'
  | 'lucky'
  | 'duel'
  | 'item'
  | 'shop'
  | 'start'
  | 'station'
  | 'cablecar';

/** Pass-trigger fields do not consume a step and fire while walking past (BOARD-02). */
export const PASS_FIELDS: FieldType[] = ['shop', 'station', 'start', 'cablecar'];

export interface FieldDef {
  id: string;
  type: FieldType;
  /** World position on the board (x/z ground plane, y height). */
  x: number;
  z: number;
  y?: number;
  /** Outgoing connections. >1 = branch (BOARD-01). */
  next: string[];
  /** Map specific tags used by gimmicks, e.g. 'sandbank', 'lava', 'track', 'summit'. */
  tags?: string[];
  /** Station name key (Bimmelbahn) */
  label?: string;
}

export type GimmickId = 'tides' | 'eruption' | 'train';

export interface MapPalette {
  sky: [string, string];
  ground: string;
  ground2: string;
  water: string;
  accent: string;
  path: string;
  fog: string;
}

export interface TrainRoute {
  /** Track field ids the train passes on that route. */
  fields: string[];
}

export interface MapDef {
  id: string;
  nameKey: string;
  descKey: string;
  difficulty: 1 | 2 | 3;
  theme: 'island' | 'volcano' | 'city';
  start: string;
  fields: FieldDef[];
  starSpots: string[];
  gimmick: GimmickId;
  palette: MapPalette;
  /** Map specific parameters for the gimmick. */
  gimmickParams?: {
    /** Bimmelbahn: routes the train cycles through (visible timetable). */
    trainRoutes?: TrainRoute[];
    /** Vulkan: groups of lava field ids, one group closes per eruption. */
    lavaGroups?: string[][];
    /** Vulkan: cable car destination field id. */
    cableCarTarget?: string;
  };
  /** Decoration hints for the renderer (positions of landmarks). */
  decor?: { kind: string; x: number; z: number; s?: number; r?: number }[];
  musicKey: string;
}
