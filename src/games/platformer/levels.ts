/**
 * Hand-authored levels for Mossbloom Run.
 *
 * Levels are stored as string-row tile maps (see `LevelDef.rows`). To guarantee
 * that every feature lines up with the floor (enemies never spawn over pits,
 * goals always sit on solid ground, gaps are always jumpable), the maps are
 * assembled from a tiny coordinate-based builder rather than typed by hand — but
 * the result is still a plain array of equal-length strings that the world
 * parser consumes.
 *
 * Legend:
 *   ' ' air   '#' ground   'D' dirt   'B' brick   '?' question   '=' one-way
 *   '^' spikes  '~' lava   'o' coin   'P' start   'C' checkpoint  'G' goal
 *   'g' grumbug 'f' flutter 's' snapper 'm' mushroom '*' star
 * Moving platforms live in each level's `movers` array.
 *
 * Difficulty ramps via gap width, hazard density and enemy variety. Every gap
 * is <= 6 tiles so the level is always completable on foot; moving platforms are
 * bonuses / shortcuts, not mandatory.
 */

import type { LevelDef, Palette } from "./types";

// ---- builder ----
type Grid = string[][];

const grid = (w: number, h: number): Grid =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => " "));

const put = (g: Grid, c: number, r: number, ch: string) => {
  if (r >= 0 && r < g.length && c >= 0 && c < g[0].length) g[r][c] = ch;
};
const hline = (g: Grid, r: number, c0: number, c1: number, ch: string) => {
  for (let c = c0; c <= c1; c++) put(g, c, r, ch);
};
const rect = (g: Grid, c0: number, r0: number, c1: number, r1: number, ch: string) => {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) put(g, c, r, ch);
};
const coins = (g: Grid, r: number, cs: number[]) => cs.forEach((c) => put(g, c, r, "o"));
const toRows = (g: Grid): string[] => g.map((r) => r.join(""));

// ---- palettes ----
const MEADOW: Palette = {
  skyTop: "#7ec8ff", skyBottom: "#cdeeff", far: "#9fd6a6", mid: "#6cc079", near: "#3f9b57",
  cloud: "#ffffff", groundTop: "#6cc24a", groundFace: "#7a5a3a", groundShade: "#5c4329",
  dirt: "#6b4a2c", brick: "#b9783f", brickMortar: "#7d4d27", accent: "#ffd23f", ambient: "clouds",
};
const BRAMBLE: Palette = {
  skyTop: "#3a2b6b", skyBottom: "#8a5fb0", far: "#5b4a8f", mid: "#46407e", near: "#2f2a5e",
  cloud: "#d9c7ff", groundTop: "#8e7bd6", groundFace: "#4b3b6e", groundShade: "#382a52",
  dirt: "#3c2f57", brick: "#7a5aa8", brickMortar: "#4a3670", accent: "#ff8bd0", ambient: "spores",
};
const EMBER: Palette = {
  skyTop: "#2a1410", skyBottom: "#8a2d1a", far: "#5e2018", mid: "#3f1712", near: "#24100c",
  cloud: "#ff8a3c", groundTop: "#b5532a", groundFace: "#5a2a1c", groundShade: "#3d1c12",
  dirt: "#3a1810", brick: "#8a4326", brickMortar: "#54271a", accent: "#ffb13c", ambient: "embers",
};

const H = 16;
const FLOOR = 14; // floor top row

/** lay the two-row floor then carve the given [start,end] pit columns. */
function floor(g: Grid, w: number, pits: [number, number][], fillPit = " ") {
  hline(g, FLOOR, 0, w - 1, "#");
  hline(g, FLOOR + 1, 0, w - 1, "D");
  for (const [a, b] of pits) {
    for (let c = a; c <= b; c++) {
      put(g, c, FLOOR, fillPit);
      put(g, c, FLOOR + 1, fillPit);
      if (fillPit === "~") put(g, c, FLOOR - 1, "~"); // lava surface
    }
  }
}

// ============================================================
// LEVEL 1 — Mossy Meadow
// ============================================================
function buildMeadow(): string[] {
  const w = 92;
  const g = grid(w, H);
  floor(g, w, [[12, 16], [24, 27], [39, 42], [49, 52], [63, 66], [76, 80]]);

  put(g, 3, 13, "P");
  // grumbugs on solid floor segments
  [8, 20, 33, 46, 58, 70].forEach((c) => put(g, c, 13, "g"));

  // one-way platforms
  hline(g, 9, 4, 8, "=");
  hline(g, 5, 11, 17, "=");
  hline(g, 6, 28, 33, "=");
  hline(g, 6, 46, 50, "="); // mushroom platform
  hline(g, 8, 53, 57, "=");
  hline(g, 7, 64, 68, "=");
  hline(g, 9, 69, 73, "=");
  hline(g, 12, 77, 81, "=");

  put(g, 40, 4, "?");        // question block (coin)
  put(g, 48, 5, "m");        // mushroom power-up (lands on platform)
  put(g, 85, 8, "C");        // checkpoint
  rect(g, 88, 12, 88, 13, "G"); // goal gate

  coins(g, 2, [28, 30, 32]);
  coins(g, 3, [58, 60, 62]);
  coins(g, 4, [13, 15, 17]);
  coins(g, 8, [24, 26]);
  coins(g, 6, [39, 41]);
  coins(g, 8, [50, 52]);
  coins(g, 7, [64, 66]);
  coins(g, 11, [9, 11]);
  coins(g, 11, [53, 55]);
  coins(g, 11, [77, 79]);
  coins(g, 10, [36, 38]);
  coins(g, 13, [25, 26]);
  return toRows(g);
}

// ============================================================
// LEVEL 2 — Bramble Hollow
// ============================================================
function buildBramble(): string[] {
  const w = 112;
  const g = grid(w, H);
  floor(g, w, [[14, 18], [30, 34], [48, 52], [64, 68], [82, 86], [98, 101]]);

  put(g, 3, 13, "P");

  // ground spikes — must be jumped
  hline(g, 13, 24, 26, "^");
  hline(g, 13, 56, 58, "^");
  hline(g, 13, 92, 94, "^");

  // grumbugs + a snapper on solid ground
  [9, 40, 74, 105].forEach((c) => put(g, c, 13, "g"));
  put(g, 55, 13, "s");

  // flyers
  put(g, 20, 5, "f");
  put(g, 46, 4, "f");
  put(g, 78, 5, "f");

  // platforms
  hline(g, 9, 5, 9, "=");
  hline(g, 7, 22, 27, "=");
  hline(g, 9, 38, 43, "=");
  hline(g, 6, 54, 59, "=");
  hline(g, 9, 70, 75, "=");
  hline(g, 7, 88, 93, "=");
  hline(g, 3, 98, 103, "="); // star platform

  // brick cluster with a question block
  hline(g, 6, 44, 47, "B");
  put(g, 45, 4, "?");

  put(g, 100, 1, "*");        // star (risky high route)
  put(g, 38, 8, "C");
  put(g, 80, 8, "C");
  rect(g, 108, 12, 108, 13, "G");

  coins(g, 4, [6, 8]);
  coins(g, 5, [23, 25, 27]);
  coins(g, 7, [39, 41]);
  coins(g, 4, [54, 56, 58]);
  coins(g, 7, [71, 73]);
  coins(g, 5, [89, 91]);
  coins(g, 2, [98, 100, 102]);
  coins(g, 11, [16, 17]);
  coins(g, 11, [32, 33]);
  coins(g, 11, [66, 67]);
  coins(g, 11, [84, 85]);
  coins(g, 12, [50, 51]);
  return toRows(g);
}

// ============================================================
// LEVEL 3 — Emberdeep Caverns
// ============================================================
function buildEmber(): string[] {
  const w = 124;
  const g = grid(w, H);
  // lava-filled pits
  floor(g, w, [[12, 16], [26, 30], [42, 46], [58, 62], [74, 78], [90, 94], [106, 110]], "~");

  put(g, 3, 13, "P");

  // stepping platforms in the middle of some lava lakes
  hline(g, 12, 13, 15, "=");
  hline(g, 12, 59, 61, "=");
  hline(g, 12, 91, 93, "=");

  // spikes
  hline(g, 13, 35, 37, "^");
  hline(g, 13, 67, 69, "^");
  hline(g, 13, 99, 101, "^");

  // enemies: every type
  [22, 52, 86, 118].forEach((c) => put(g, c, 13, "g"));
  put(g, 38, 13, "s");
  put(g, 84, 13, "s");
  put(g, 19, 4, "f");
  put(g, 50, 4, "f");
  put(g, 82, 4, "f");
  put(g, 112, 5, "f");

  // platforms + bricks
  hline(g, 9, 5, 9, "=");
  hline(g, 7, 20, 24, "=");
  hline(g, 9, 33, 38, "=");
  hline(g, 6, 48, 52, "=");
  hline(g, 5, 48, 51, "B");
  hline(g, 9, 64, 69, "=");
  hline(g, 7, 80, 85, "=");
  hline(g, 9, 96, 101, "=");
  hline(g, 4, 110, 115, "="); // star platform

  put(g, 50, 3, "?");
  put(g, 113, 2, "*");
  put(g, 40, 8, "C");
  put(g, 88, 8, "C");
  rect(g, 120, 12, 120, 13, "G");

  coins(g, 4, [6, 8]);
  coins(g, 6, [21, 23]);
  coins(g, 8, [34, 36, 38]);
  coins(g, 5, [49, 51]);
  coins(g, 8, [65, 67]);
  coins(g, 6, [81, 83]);
  coins(g, 8, [97, 99]);
  coins(g, 3, [111, 113, 115]);
  coins(g, 11, [14, 15]);
  coins(g, 11, [60, 61]);
  coins(g, 11, [92, 93]);
  coins(g, 12, [28, 29]);
  coins(g, 12, [44, 45]);
  coins(g, 12, [76, 77]);
  return toRows(g);
}

export const LEVELS: LevelDef[] = [
  {
    name: "Mossy Meadow",
    palette: MEADOW,
    timeLimit: 150,
    rows: buildMeadow(),
    movers: [{ col: 64, row: 12, tiles: 3, axis: "h", range: 4, speed: 2.0, phase: 0 }],
  },
  {
    name: "Bramble Hollow",
    palette: BRAMBLE,
    timeLimit: 180,
    rows: buildBramble(),
    movers: [
      { col: 30, row: 11, tiles: 3, axis: "v", range: 3, speed: 1.6, phase: 0 },
      { col: 83, row: 12, tiles: 3, axis: "h", range: 4, speed: 2.4, phase: 0.3 },
    ],
  },
  {
    name: "Emberdeep Caverns",
    palette: EMBER,
    timeLimit: 210,
    rows: buildEmber(),
    movers: [
      { col: 27, row: 11, tiles: 2, axis: "h", range: 3, speed: 3.0, phase: 0 },
      { col: 75, row: 10, tiles: 2, axis: "v", range: 3, speed: 2.4, phase: 0.5 },
      { col: 106, row: 11, tiles: 3, axis: "h", range: 3, speed: 3.0, phase: 0.2 },
    ],
  },
];
