/** Shared types for Mossbloom Run. No `any`, ever. */

export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Static collision tiles stored in the world grid. */
export type TileType =
  | "empty"
  | "ground"
  | "dirt"
  | "brick"
  | "question"
  | "oneway"
  | "spike"
  | "lava"
  | "checkpoint"
  | "goal";

/** Per-frame distilled player intent (from keyboard + touch). */
export interface Intent {
  left: boolean;
  right: boolean;
  down: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  jumpReleased: boolean;
  run: boolean;
}

export type PowerState = "small" | "big" | "star";

export type GameState =
  | "title"
  | "intro"
  | "playing"
  | "levelclear"
  | "gameover"
  | "victory";

export type Facing = -1 | 1;

export type EnemyKind = "grumbug" | "flutter" | "snapper";

export type PickupKind = "coin" | "mushroom" | "star" | "oneup";

export type MoverAxis = "h" | "v";

/** A moving-platform definition authored per level. */
export interface MoverDef {
  /** anchor tile column / row (the platform's home position) */
  col: number;
  row: number;
  /** platform width in tiles (height is a thin slab) */
  tiles: number;
  axis: MoverAxis;
  /** travel range in tiles from the anchor */
  range: number;
  /** travel speed in tiles per second */
  speed: number;
  /** phase offset 0..1 so platforms aren't synchronized */
  phase: number;
}

/** Biome color palette + parallax theme. */
export interface Palette {
  skyTop: string;
  skyBottom: string;
  far: string;
  mid: string;
  near: string;
  cloud: string;
  /** tile fills */
  groundTop: string;
  groundFace: string;
  groundShade: string;
  dirt: string;
  brick: string;
  brickMortar: string;
  /** accent glow used for goal, question blocks, particles */
  accent: string;
  /** background flavor: clouds vs spores vs embers */
  ambient: "clouds" | "spores" | "embers";
}

export interface LevelDef {
  name: string;
  rows: string[];
  palette: Palette;
  /** generous soft time limit (seconds) for the time bonus */
  timeLimit: number;
  movers: MoverDef[];
}

/** Result handed to the orchestrator when a player update finishes. */
export interface Viewport {
  /** world-space rect currently visible */
  x: number;
  y: number;
  w: number;
  h: number;
  /** world->screen scale */
  scale: number;
}
