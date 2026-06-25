/** Shared types for Tap Cascade. */

/** Compiled note in a beatmap: hit time (s), lane, frequency (Hz), duration (s). */
export interface TileNote {
  time: number;
  lane: number;
  freq: number;
  dur: number;
}

/** A fully compiled, runtime-ready beatmap. */
export interface Beatmap {
  id: string;
  title: string;
  subtitle: string;
  notes: TileNote[];
  length: number;
  bpm: number;
  accent: string;
  /** true for the procedural endless map (notes generated on the fly). */
  endless: boolean;
}

/** Authoring step in a song's compact melody DSL. */
export type Step =
  | { n: string; d: number }
  | { n: string[]; d: number }
  | { rest: true; d: number };

/** A composed song before compilation. */
export interface SongDef {
  id: string;
  title: string;
  subtitle: string;
  bpm: number;
  accent: string;
  key: string;
  steps: Step[];
}

/** A live, falling tile on screen. */
export interface Tile {
  note: TileNote;
  /** current Y of the tile's BOTTOM edge, in CSS px. */
  y: number;
  height: number;
  state: "live" | "hit" | "missed";
  /** 0..1 fade used by the hit animation. */
  fade: number;
  /** judgment recorded when hit (for the pop color). */
  judge: Judgment | null;
  /** unique id for bookkeeping. */
  id: number;
}

export type Judgment = "perfect" | "great" | "good";

export type GameState =
  | "menu"
  | "countdown"
  | "playing"
  | "dying"
  | "complete"
  | "gameover";

/** A single particle (spark). */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  active: boolean;
}

/** An expanding ring ripple. */
export interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  active: boolean;
}

/** Floating judgment / combo text. */
export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
  active: boolean;
}

/** Per-lane transient visual state. */
export interface LaneFx {
  /** 0..1 glow level, decays over time. */
  glow: number;
  /** 0..1 red flash for wrong/miss. */
  danger: number;
  /** 0..1 key-pad press flash. */
  press: number;
}

/** Layout computed every frame from the live size getters. */
export interface Layout {
  W: number;
  H: number;
  fieldX: number;
  fieldW: number;
  laneW: number;
  hitLineY: number;
  tileH: number;
  deckY: number;
}
