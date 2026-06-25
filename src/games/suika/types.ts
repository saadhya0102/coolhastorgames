/**
 * Shared types + tunable configuration for the Mergemelon (suika) game.
 *
 * The physics lives in a fixed, resolution-independent "world" space where the
 * jar interior spans x in [0, WORLD_W] and y in [0, WORLD_H]. Pixels are derived
 * each frame via a Layout (see game.ts). Keeping the world fixed is what makes
 * resizing / rotating perfectly stable.
 */

/** A single fruit in the simulation. All units are world units / seconds. */
export interface Body {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  invMass: number;
  /** cosmetic rotation (rolling look) */
  angle: number;
  /** cosmetic angular velocity */
  spin: number;
  sleeping: boolean;
  sleepTimer: number;
  /** seconds since spawn (grace for overflow + merge) */
  age: number;
  /** 0..1 pop animation timer set when born from a merge */
  spawnPop: number;
  /** marked for removal (merged away) */
  dead: boolean;
}

/** Static description of a fruit tier. */
export interface FruitTier {
  name: string;
  /** radius in world units */
  r: number;
  /** main body color */
  color: string;
  /** darker rim / accent color */
  accent: string;
  /** lighter highlight tint */
  light: string;
  /** decoration style flags */
  leaf: boolean;
  stripes: boolean;
  net: boolean;
  dimples: boolean;
  face: boolean;
  /** whether this tier can be spawned as a droppable */
  spawnable: boolean;
}

/** A juice particle (merge bursts, sparkles). */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** remaining life, seconds */
  life: number;
  /** total life, seconds */
  maxLife: number;
  /** world-unit radius */
  r: number;
  color: string;
  /** gravity multiplier */
  grav: number;
  active: boolean;
  /** ring shockwaves expand instead of moving */
  ring: boolean;
}

/** Pixel-space mapping from world coordinates, recomputed every frame. */
export interface Layout {
  /** pixels per world unit */
  scale: number;
  /** pixel origin of world (0,0) */
  originX: number;
  originY: number;
  /** full stage size in CSS px */
  W: number;
  H: number;
  /** jar size in px */
  jarW: number;
  jarH: number;
  /** top UI band height in px */
  topUI: number;
}

export type GameState = "intro" | "playing" | "dying";

/** All tunable constants in one place (see PRD §17). */
export const CONFIG = {
  WORLD_W: 1.0,
  WORLD_H: 1.3,

  GRAVITY: 3.2,
  LINEAR_DAMP: 0.999,
  MAX_SPEED: 6.0,
  FIXED_DT: 1 / 120,
  MAX_STEPS: 5,
  SOLVER_ITERS: 6,
  SLOP: 0.0006,
  CORRECT_PERCENT: 0.4,
  MAX_CORRECTION: 0.05,
  RESTITUTION: 0.12,
  REST_THRESHOLD: 0.25,
  FRICTION: 0.4,
  SLEEP_LINEAR: 0.06,
  SLEEP_TIME: 0.5,
  WAKE_FACTOR: 6,

  DROP_Y: 0.06,
  DANGER_Y: 0.14,
  DROP_VY: 0.2,
  DROP_COOLDOWN: 0.36,
  MERGE_TOL: 0.004,
  MERGE_VEL_KEEP: 0.6,
  MERGE_POP_UP: 0.25,

  OVERFLOW_GRACE: 1.0,
  OVERFLOW_LIMIT: 2.5,
  GAMEOVER_DELAY: 1.1,
  JACKPOT_SCORE: 100,
  SPAWN_MAX_TIER: 4,
  MAX_PARTICLES: 400,
} as const;

export const MAX_TIER = 10;
