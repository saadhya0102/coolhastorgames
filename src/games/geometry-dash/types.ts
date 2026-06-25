/** Neon Dash — shared types. */
import type { CellType } from "./constants";

// ---- Level authoring DSL --------------------------------------------------
export type Segment =
  | { k: "flat"; n: number }
  | { k: "gap"; n: number }
  | { k: "spikes"; n: number }
  | { k: "platform"; h: number; n: number }
  | { k: "spikedPlatform"; h: number; n: number }
  | { k: "pillar"; h: number; n: number }
  | { k: "stairs"; h: number; dir: 1 | -1 }
  | { k: "pad"; h: number }
  | { k: "orb"; row: number }
  | { k: "gapOrb"; n: number; row: number }
  | { k: "padSpikes"; n: number }
  | { k: "flip" }
  | { k: "ship" }
  | { k: "cube" }
  | { k: "ceilSpikes"; n: number }
  | { k: "raw"; rows: string[] };

// ---- Music --------------------------------------------------------------
export interface SongSpec {
  bpm: number;
  /** 16-step (one bar of 16th notes) drum masks. 1 = hit. */
  kick: number[];
  snare: number[];
  hat: number[];
  /** semitone offsets from root, advanced one per 8th note (ring). */
  bass: number[];
  /** semitone offsets for the lead arpeggio, advanced per 16th (ring). */
  lead: number[];
  /** root frequency for the bass (Hz). */
  root: number;
  bassWave: OscillatorType;
  leadWave: OscillatorType;
}

// ---- Levels -------------------------------------------------------------
export interface LevelMeta {
  id: string;
  name: string;
  difficulty: 1 | 2 | 3;
  /** gradient + accent colors */
  c1: string;
  c2: string;
  accent: string;
  glow: string;
  song: SongSpec;
}

export interface Level {
  meta: LevelMeta;
  segments: Segment[];
}

export interface CompiledLevel {
  meta: LevelMeta;
  cols: number;
  floor: boolean[];
  /** flat [col * GRID_ROWS + row] -> CellType */
  cells: Uint8Array;
  /** full-height trigger portals (mode / gravity switches) */
  portals: { col: number; type: CellType }[];
}

// ---- Movement -----------------------------------------------------------
export type Mode = "cube" | "ship";

// ---- Particles ----------------------------------------------------------
export interface Particle {
  x: number; // pixels
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  /** 0 = square shard, 1 = ring */
  kind: number;
  rot: number;
  vr: number;
  grav: number;
}

export interface TrailDot {
  x: number;
  y: number;
  rot: number;
  life: number;
}

// ---- Snapshot (practice checkpoints) ------------------------------------
export interface Snapshot {
  scrollX: number;
  py: number;
  vy: number;
  gravDir: 1 | -1;
  mode: Mode;
  levelTime: number;
  rot: number;
}

// Re-export for convenience
export type { CellType };
