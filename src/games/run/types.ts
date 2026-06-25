/** Shared data shapes for NEON CONDUIT. */

/** One row of tunnel: a tile (or hole) per polygon face. */
export interface Ring {
  /** ring index; world depth of its near edge is r * SEG */
  r: number;
  /** length N; true = solid tile, false = hole (void) */
  solid: boolean[];
  /** palette/biome index captured when the ring was generated */
  biome: number;
}

export interface Palette {
  name: string;
  bgTop: string;
  bgBottom: string;
  nebula: string;
  /** base neon RGB (0..255) for floor-lit tiles */
  tile: [number, number, number];
  /** dimmer RGB for ceiling/back tiles */
  tileDim: [number, number, number];
  /** bright neon edge stroke (CSS color) */
  edge: string;
  player: string;
  playerGlow: string;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** 0 dust puff, 1 spark, 2 burst mote, 3 ring shock */
  kind: number;
  grav: number;
  drag: number;
}

export interface Star {
  /** normalized screen position 0..1 */
  x: number;
  y: number;
  /** parallax depth 0..1 (1 = nearest/fastest) */
  z: number;
  tw: number; // twinkle phase
}

export type GameState = "ready" | "playing" | "dying" | "gameover";
