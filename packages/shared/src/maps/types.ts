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
  /**
   * Map specific tags used by gimmicks and the renderer, e.g. 'sandbank' / 'ford'
   * (flooded at high tide), 'bridge', 'pier', 'track', 'summit'.
   */
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
  decor?: DecorDef[];
  /** Landscape the renderer builds around the field graph (v0.3). */
  terrain: TerrainDef;
  musicKey: string;
}

export interface DecorDef {
  kind: string;
  x: number;
  z: number;
  /** uniform scale */
  s?: number;
  /** yaw in radians */
  r?: number;
  /** optional runtime tint for props with a `tint` material */
  tint?: string;
  /** vertical offset from the ground (e.g. the crater prop sunk into the volcano terrain) */
  dy?: number;
}

/**
 * Landscape description (renderer only, the rules never look at it). Heights in world
 * units; the board's field graph is laid into this terrain and paths are flattened.
 */
export interface TerrainDef {
  /** height of the flat land */
  base: number;
  /** water surface (y) at high and low tide; maps without tide use `high` only */
  water: { high: number; low?: number; kind: 'sea' | 'lava' };
  /** land blobs; their smooth union defines the coastline */
  land: { x: number; z: number; rx: number; rz: number; rot?: number }[];
  /** carved out of the land again (bays) */
  cuts?: { x: number; z: number; rx: number; rz: number; rot?: number }[];
  /** additive hills (gaussian), h may be negative for basins */
  hills?: { x: number; z: number; r: number; h: number; rz?: number }[];
  /**
   * Volcano cone (terrain): rises by `h` from the foot radius `r` to a level plateau of
   * radius `top` around the crater, where the crater prop sits. Paths climb its flanks.
   */
  volcano?: { x: number; z: number; r: number; h: number; top: number };
  /** shallow lagoons: the sea floor rises to `y` inside (stilt huts, wading boats) */
  shallows?: { x: number; z: number; rx: number; rz: number; rot?: number; y: number }[];
  /** width of the sand strip along the coast (default 3.2) */
  beach?: number;
  /**
   * channels (river, lava stream, canal): water channels are carved below the water level;
   * lava streams cut a groove following the ground (down the volcano, across the land) that
   * the renderer fills with a flowing lava ribbon until it pours into the lava sea.
   */
  channels?: { points: [number, number][]; width: number; kind: 'water' | 'lava' }[];
  /** ground colors */
  colors: { grass: string; grass2: string; sand: string; rock: string; path: string; seabed: string };
  /** procedural vegetation / detail scatter, density per 100 m² of matching ground */
  scatter: { kind: string; on: 'grass' | 'sand' | 'rock'; density: number; scale?: [number, number]; tint?: string[] }[];
}
