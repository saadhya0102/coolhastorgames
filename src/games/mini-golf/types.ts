/**
 * Putt Park — data types for the course / hole format and shared runtime enums.
 *
 * Holes are authored as pure data (see `courses.ts`). The physics and renderer
 * interpret this data. Keeping geometry declarative makes new holes trivial to
 * add and impossible to desync between collision and visuals (boundary walls are
 * generated from the same `green` polygon that is filled as felt).
 */

export interface Vec {
  x: number;
  y: number;
}

/** A straight collidable wall segment a -> b. */
export interface Wall {
  a: Vec;
  b: Vec;
  /** 0..1 bounciness. Defaults to WALL_RESTITUTION. */
  restitution?: number;
  /** purely a visual hint for the renderer */
  kind?: "rail" | "inner" | "post";
}

/** Region shapes used by hazards and zones. */
export type Shape =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "circle"; x: number; y: number; r: number }
  | { type: "poly"; points: Vec[] };

/** Circular elastic bumper (pinball style). */
export interface Bumper {
  x: number;
  y: number;
  r: number;
  /** Defaults to BUMPER_RESTITUTION (slightly > 1 for a boost). */
  restitution?: number;
}

/** Directional acceleration zone (ramp / slope / funnel). */
export interface Slope {
  shape: Shape;
  /** direction of the push (need not be normalized; normalized at load) */
  dir: Vec;
  /** acceleration magnitude in world units / s^2 */
  strength: number;
}

/** A rectangular block that patrols between waypoints and collides as a solid. */
export interface Mover {
  w: number;
  h: number;
  /** >= 2 center waypoints */
  path: Vec[];
  /** world units / sec travelled along the path */
  speed: number;
  /** 0..1 starting offset along the loop */
  phase?: number;
  /** ping-pong back and forth (default) vs wrap/loop */
  pingpong?: boolean;
}

/** A single hand-designed hole. */
export interface Hole {
  id: number;
  name: string;
  par: number;
  bounds: { w: number; h: number };
  tee: Vec;
  cup: Vec;
  cupRadius?: number;
  /**
   * Outline polygon of the playable green (clockwise; may be concave).
   * Boundary walls are auto-generated from this loop and the felt is filled
   * from it.
   */
  green: Vec[];
  walls?: Wall[];
  bumpers?: Bumper[];
  sand?: Shape[];
  water?: Shape[];
  slopes?: Slope[];
  movers?: Mover[];
  hint?: string;
}

export type Course = Hole[];

/** High-level game flow states. */
export type Phase =
  | "title"
  | "intro"
  | "aim"
  | "rolling"
  | "sinking"
  | "holeComplete"
  | "scorecard"
  | "done";

/** Per-hole scoring record. */
export interface HoleScore {
  strokes: number;
  par: number;
}

/** Tuning constants in world units & seconds. */
export const CONST = {
  BALL_R: 12,
  CUP_RADIUS: 18,
  WALL_RESTITUTION: 0.72,
  BUMPER_RESTITUTION: 1.12,
  GREEN_FRICTION: 520,
  SAND_FRICTION: 1900,
  VISCOUS: 0.25,
  STOP_SPEED: 7,
  MAX_BALL_SPEED: 1650,
  MAX_DRAG: 360,
  MIN_PUTT_SPEED: 120,
  CUP_CAPTURE_SPEED: 560,
  CUP_PULL_RANGE: 2.6,
  CUP_PULL_ACCEL: 2600,
  MAX_DT: 1 / 30,
  MAX_STEP_DIST: 5,
  MAX_SUBSTEPS: 16,
  RESOLVE_ITERS: 3,
  EPSILON: 0.01,
} as const;
