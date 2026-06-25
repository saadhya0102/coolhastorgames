/** Neon Dash — three hand-designed levels (stored as segment data). */
import { CEIL_BOTTOM_ROW, FLOOR_TOP_ROW, GRID_ROWS } from "./constants";
import type { Level, Segment, SongSpec } from "./types";

// ---------------------------------------------------------------------------
// Builder helpers — produce `raw` ASCII segments programmatically so bespoke
// fly / flip tunnels stay reliable and aligned (still pure data on output).
// ---------------------------------------------------------------------------

interface Pylon {
  c: number; // column within the section
  up?: number; // block cells rising from the floor
  down?: number; // block cells hanging from the ceiling
  su?: boolean; // spike pointing up at floor surface
  sd?: boolean; // spike pointing down at ceiling surface
}

/** A fly/flip tunnel: floor pylons (`up`), ceiling stalactites (`down`),
 *  and surface spikes. Guarantees the channel by construction. */
function caveSegment(n: number, pylons: Pylon[]): Segment {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<string>(n).fill(" "),
  );
  for (const p of pylons) {
    if (p.c < 0 || p.c >= n) continue;
    if (p.up) {
      for (let r = FLOOR_TOP_ROW - 1; r >= FLOOR_TOP_ROW - p.up && r >= 0; r--) grid[r][p.c] = "#";
    }
    if (p.down) {
      for (let r = CEIL_BOTTOM_ROW; r < CEIL_BOTTOM_ROW + p.down && r < GRID_ROWS; r++) grid[r][p.c] = "#";
    }
    if (p.su) grid[FLOOR_TOP_ROW - 1][p.c] = "^";
    if (p.sd) grid[CEIL_BOTTOM_ROW][p.c] = "v";
  }
  return { k: "raw", rows: grid.map((row) => row.join("")) };
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

const SONG_L1: SongSpec = {
  bpm: 130,
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  bass: [0, 0, 7, 5, 3, 5, 0, -5],
  lead: [12, 15, 19, 15, 12, 15, 19, 22, 12, 15, 19, 15, 24, 19, 15, 12],
  root: 130.81,
  bassWave: "sawtooth",
  leadWave: "triangle",
};

const SONG_L2: SongSpec = {
  bpm: 140,
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
  hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
  bass: [0, 7, 3, 5, -2, 3, 7, 5],
  lead: [12, 19, 24, 19, 15, 22, 27, 22, 12, 19, 24, 19, 17, 24, 28, 24],
  root: 146.83,
  bassWave: "square",
  leadWave: "triangle",
};

const SONG_L3: SongSpec = {
  bpm: 160,
  kick: [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0],
  hat: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1],
  bass: [0, 0, 12, 7, 3, 7, 10, 7, -2, -2, 10, 5, 0, 5, 7, 12],
  lead: [12, 24, 19, 24, 15, 27, 22, 27, 17, 29, 24, 29, 19, 31, 26, 24],
  root: 164.81,
  bassWave: "sawtooth",
  leadWave: "square",
};

// ---------------------------------------------------------------------------
// LEVEL 1 — STEREO STEPS (Easy)
// ---------------------------------------------------------------------------

const LEVEL_1_SEGMENTS: Segment[] = [
  { k: "flat", n: 10 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 6 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 6 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 8 },
  { k: "platform", h: 2, n: 4 },
  { k: "flat", n: 6 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 6 },
  { k: "gap", n: 2 },
  { k: "flat", n: 8 },
  { k: "stairs", h: 3, dir: 1 },
  { k: "platform", h: 3, n: 4 },
  { k: "flat", n: 8 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 6 },
  { k: "padSpikes", n: 2 },
  { k: "flat", n: 8 },
  { k: "gapOrb", n: 4, row: 8 },
  { k: "flat", n: 8 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 6 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 12 },
];

// ---------------------------------------------------------------------------
// LEVEL 2 — NEON PULSE (Medium) — adds ship + gravity flip
// ---------------------------------------------------------------------------

const CAVE_L2 = caveSegment(36, [
  { c: 6, down: 4 },
  { c: 11, up: 4 },
  { c: 16, down: 5 },
  { c: 21, up: 5 },
  { c: 26, down: 4 },
  { c: 31, up: 4 },
]);

const FLIP_L2 = caveSegment(26, [
  { c: 6, sd: true },
  { c: 11, down: 2 },
  { c: 16, sd: true },
  { c: 21, down: 2 },
]);

const LEVEL_2_SEGMENTS: Segment[] = [
  { k: "flat", n: 8 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 5 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 6 },
  { k: "platform", h: 2, n: 3 },
  { k: "flat", n: 3 },
  { k: "platform", h: 3, n: 3 },
  { k: "flat", n: 6 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 4 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 8 },
  // ---- ship section ----
  { k: "flat", n: 4 },
  { k: "ship" },
  CAVE_L2,
  { k: "cube" },
  { k: "flat", n: 8 },
  // ---- pad / orb bounce lane ----
  { k: "padSpikes", n: 2 },
  { k: "flat", n: 6 },
  { k: "gapOrb", n: 5, row: 8 },
  { k: "flat", n: 6 },
  { k: "padSpikes", n: 2 },
  { k: "flat", n: 8 },
  // ---- gravity flip section ----
  { k: "flat", n: 3 },
  { k: "flip" },
  FLIP_L2,
  { k: "flip" },
  { k: "flat", n: 8 },
  // ---- staircase finale ----
  { k: "stairs", h: 3, dir: 1 },
  { k: "platform", h: 3, n: 3 },
  { k: "flat", n: 6 },
  { k: "gap", n: 2 },
  { k: "flat", n: 3 },
  { k: "gap", n: 2 },
  { k: "flat", n: 6 },
  { k: "padSpikes", n: 2 },
  { k: "flat", n: 12 },
];

// ---------------------------------------------------------------------------
// LEVEL 3 — HYPERDRIVE (Hard) — dense + fast mode switching
// ---------------------------------------------------------------------------

const CAVE_L3 = caveSegment(32, [
  { c: 5, down: 5 },
  { c: 9, up: 6 },
  { c: 14, down: 6 },
  { c: 18, up: 6 },
  { c: 23, down: 6 },
  { c: 27, up: 5 },
]);

const LEVEL_3_SEGMENTS: Segment[] = [
  { k: "flat", n: 8 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 4 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 4 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 6 },
  // pillar parkour
  { k: "pillar", h: 2, n: 2 },
  { k: "flat", n: 3 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 3 },
  { k: "platform", h: 3, n: 3 },
  { k: "flat", n: 3 },
  { k: "pillar", h: 2, n: 2 },
  { k: "flat", n: 7 },
  // ship pinch
  { k: "flat", n: 4 },
  { k: "ship" },
  CAVE_L3,
  { k: "cube" },
  { k: "flat", n: 8 },
  // double flip over spike fields
  { k: "spikes", n: 2 },
  { k: "flat", n: 5 },
  { k: "flip" },
  { k: "flat", n: 5 },
  { k: "ceilSpikes", n: 2 },
  { k: "flat", n: 5 },
  { k: "ceilSpikes", n: 2 },
  { k: "flat", n: 4 },
  { k: "flip" },
  { k: "flat", n: 7 },
  // orb air-chain across a long gap
  { k: "flat", n: 2 },
  { k: "gapOrb", n: 4, row: 8 },
  { k: "gapOrb", n: 4, row: 9 },
  { k: "flat", n: 8 },
  // brutal finish
  { k: "spikes", n: 2 },
  { k: "flat", n: 3 },
  { k: "gap", n: 2 },
  { k: "flat", n: 4 },
  { k: "spikes", n: 1 },
  { k: "flat", n: 3 },
  { k: "padSpikes", n: 2 },
  { k: "flat", n: 3 },
  { k: "spikes", n: 2 },
  { k: "flat", n: 14 },
];

// ---------------------------------------------------------------------------

export const LEVELS: Level[] = [
  {
    meta: {
      id: "stereo-steps",
      name: "Stereo Steps",
      difficulty: 1,
      c1: "#0a1a3a",
      c2: "#1d3a8a",
      accent: "#21e6ff",
      glow: "#7cf3ff",
      song: SONG_L1,
    },
    segments: LEVEL_1_SEGMENTS,
  },
  {
    meta: {
      id: "neon-pulse",
      name: "Neon Pulse",
      difficulty: 2,
      c1: "#2a0833",
      c2: "#7a1547",
      accent: "#ff3ea5",
      glow: "#ffa14a",
      song: SONG_L2,
    },
    segments: LEVEL_2_SEGMENTS,
  },
  {
    meta: {
      id: "hyperdrive",
      name: "Hyperdrive",
      difficulty: 3,
      c1: "#04122a",
      c2: "#0a3b7a",
      accent: "#3ea0ff",
      glow: "#ff4fd8",
      song: SONG_L3,
    },
    segments: LEVEL_3_SEGMENTS,
  },
];
