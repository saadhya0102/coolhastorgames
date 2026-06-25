/** Shared types for Bubble Pop Saga. */

/** Index into the PALETTE array. */
export type BubbleColor = number;

/** A bubble locked into the hex grid. */
export interface Cell {
  color: BubbleColor;
  /** 0..1 pop-in scale animation progress. */
  spawnT: number;
  /** settle wobble amount (decays to 0). */
  wobble: number;
  /** brief white flash when freshly placed (decays to 0). */
  hitFlash: number;
}

/** The board: jagged 2D array. board[row][col]; null = empty cell. */
export type Board = (Cell | null)[][];

/** Integer cell coordinate. */
export interface CellRef {
  row: number;
  col: number;
}

/** The bubble currently in flight. */
export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: BubbleColor;
  r: number;
}

/** A bubble that has been disconnected and is falling off the board. */
export interface FallingBubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: BubbleColor;
  spin: number;
  spinV: number;
  r: number;
  /** seconds remaining before despawn fade. */
  life: number;
}

/** High-level game state machine. */
export type GameState =
  | "aiming"
  | "firing"
  | "resolving"
  | "descending"
  | "win"
  | "lose";

/** Pixel-space board geometry, recomputed every frame from ctx size. */
export interface Geometry {
  W: number;
  H: number;
  /** bubble radius */
  R: number;
  /** vertical pitch between rows */
  rowH: number;
  /** left gutter pixel where board content begins */
  boardLeft: number;
  /** right edge pixel of board content */
  boardRight: number;
  /** pixel Y where the ceiling sits (top of row 0 region) */
  ceilingY: number;
  /** launcher pivot position */
  launcherX: number;
  launcherY: number;
  /** y of the lose line */
  deathY: number;
  /** top of the HUD-free play field */
  hudBottom: number;
}
