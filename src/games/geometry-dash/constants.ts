/**
 * Neon Dash — global tuning constants.
 * All simulation values are in CELLS and SECONDS. Pixel sizes are derived per
 * frame from the live canvas size (see render/projection), so the game is fully
 * resolution- and aspect-independent.
 */

// ---- Grid -----------------------------------------------------------------
export const GRID_ROWS = 14; // rows 0 (top) .. 13 (bottom)
export const CEIL_BOTTOM_ROW = 2; // rows 0,1 are solid ceiling; air starts at 2
export const FLOOR_TOP_ROW = 12; // rows 12,13 are solid floor; ground surface = 12
export const GROUND_CUBE_ROW = FLOOR_TOP_ROW - 1; // a grounded cube occupies row 11

// ---- Projection -----------------------------------------------------------
export const MIN_VISIBLE_COLS = 15; // guarantees look-ahead on narrow screens
export const PLAYER_SCREEN_FRAC = 0.3; // cube's fixed screen-x as fraction of width

// ---- Cube physics (cells / seconds) --------------------------------------
export const GRAVITY = 62;
export const JUMP_VEL = 18.7;
export const MAX_FALL = 34;
export const ORB_VEL = 19.5;
export const PAD_VEL = 26;

// ---- Ship / fly physics ---------------------------------------------------
export const SHIP_THRUST = 56;
export const SHIP_GRAV = 40;
export const SHIP_MAX_V = 19;

// ---- Feel -----------------------------------------------------------------
export const JUMP_BUFFER = 0.09; // seconds: press slightly before landing still jumps
export const COYOTE = 0.08; // seconds: jump shortly after leaving a ledge
export const ORB_COOLDOWN = 0.18; // seconds between orb activations

// ---- Beat / scroll --------------------------------------------------------
export const CELLS_PER_BEAT = 2; // 1 cell = an 8th note

// ---- Collision fairness ---------------------------------------------------
export const EPS = 0.02;
export const CUBE_INSET = 0.12; // cube hitbox shrink (each side)
export const SPIKE_INSET_X = 0.28; // spike hitbox shrink (x)
export const SPIKE_INSET_TOP = 0.34; // spike hitbox shrink (top only — point is forgiving)

// ---- Sub-stepping ---------------------------------------------------------
export const SUBSTEP_MAX_MOVE = 0.2; // max cells moved per sub-step
export const SUBSTEP_CAP = 8;

// ---- Death / retry --------------------------------------------------------
export const DEATH_HOLD = 0.36; // seconds of death anim before auto-retry
export const CHECKPOINT_INTERVAL = 3.5; // practice-mode auto-checkpoint cadence

// ---- Cell types -----------------------------------------------------------
export const Cell = {
  EMPTY: 0,
  BLOCK: 1,
  SPIKE_UP: 2,
  SPIKE_DOWN: 3,
  ORB: 4,
  PAD: 5,
  PORTAL_FLIP: 6,
  PORTAL_SHIP: 7,
  PORTAL_CUBE: 8,
} as const;
export type CellType = (typeof Cell)[keyof typeof Cell];

export const isSolid = (c: number): boolean => c === Cell.BLOCK;
export const isSpike = (c: number): boolean =>
  c === Cell.SPIKE_UP || c === Cell.SPIKE_DOWN;
export const isPortal = (c: number): boolean =>
  c === Cell.PORTAL_FLIP || c === Cell.PORTAL_SHIP || c === Cell.PORTAL_CUBE;
