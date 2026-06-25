/**
 * Tank Battle — level data.
 * Contains enemy archetype presets, hand-authored ASCII arenas, and a seeded
 * procedural generator for levels beyond the authored set.
 *
 * Layout legend (any unknown char is treated as empty floor):
 *   '#' wall (steel, indestructible)   'B' breakable crate
 *   'O' hole (pit)                     '.' / ' ' empty
 *   'P' player spawn
 *   't' Turret  'r' Roamer  'u' Rusher  's' Sapper  'p' Phantom  'w' Warden
 */

import { mulberry32, hashString } from "@/engine";
import type { ArchetypeDef, LevelDef } from "./types";

export const ARCHETYPES: Record<string, ArchetypeDef> = {
  t: {
    id: "t",
    name: "Turret",
    hull: "#7d6a52",
    tread: "#5c4d3b",
    trim: "#c9b48f",
    speed: 0,
    fireInterval: 2.1,
    reaction: 0.75,
    bounces: 1,
    maxShells: 1,
    aimError: 0.1,
    lead: 0,
    aggression: 0,
    banker: false,
    laysMines: false,
    awareness: 999,
    evasive: 0,
    score: 100,
  },
  r: {
    id: "r",
    name: "Roamer",
    hull: "#8c93a0",
    tread: "#5f636d",
    trim: "#d6dbe4",
    speed: 1.7,
    fireInterval: 2.0,
    reaction: 0.6,
    bounces: 1,
    maxShells: 1,
    aimError: 0.13,
    lead: 0.05,
    aggression: 0.2,
    banker: false,
    laysMines: false,
    awareness: 8.5,
    evasive: 0.12,
    score: 150,
  },
  u: {
    id: "u",
    name: "Rusher",
    hull: "#d4493f",
    tread: "#8f2c25",
    trim: "#ffb0a6",
    speed: 3.2,
    fireInterval: 1.15,
    reaction: 0.4,
    bounces: 0,
    maxShells: 2,
    aimError: 0.1,
    lead: 0.3,
    aggression: 0.95,
    banker: false,
    laysMines: false,
    awareness: 13,
    evasive: 0.1,
    score: 250,
  },
  s: {
    id: "s",
    name: "Sapper",
    hull: "#d9a531",
    tread: "#9c7414",
    trim: "#ffe39a",
    speed: 2.2,
    fireInterval: 1.9,
    reaction: 0.55,
    bounces: 1,
    maxShells: 1,
    aimError: 0.12,
    lead: 0.1,
    aggression: 0.4,
    banker: false,
    laysMines: true,
    awareness: 11,
    evasive: 0.25,
    score: 300,
  },
  p: {
    id: "p",
    name: "Phantom",
    hull: "#e7ecf2",
    tread: "#9aa3b2",
    trim: "#bfe9ff",
    speed: 3.9,
    fireInterval: 1.1,
    reaction: 0.38,
    bounces: 2,
    maxShells: 2,
    aimError: 0.08,
    lead: 0.4,
    aggression: 0.5,
    banker: true,
    laysMines: false,
    awareness: 15,
    evasive: 0.65,
    score: 400,
  },
  w: {
    id: "w",
    name: "Warden",
    hull: "#36b58a",
    tread: "#1f7a5c",
    trim: "#aef2d6",
    speed: 2.5,
    fireInterval: 1.0,
    reaction: 0.4,
    bounces: 2,
    maxShells: 2,
    aimError: 0.05,
    lead: 0.5,
    aggression: 0.45,
    banker: true,
    laysMines: false,
    awareness: 15,
    evasive: 0.4,
    score: 450,
  },
};

/** Player palette (kept here so it reads alongside the enemies). */
export const PLAYER_PALETTE = {
  hull: "#3d8bff",
  tread: "#22518f",
  trim: "#cfe4ff",
};

/* ------------------------------------------------------------------ */
/* Hand-authored arenas (escalating).                                  */
/* ------------------------------------------------------------------ */

export const AUTHORED: LevelDef[] = [
  // 1 — gentle introduction: open room, two stationary turrets + a roamer.
  {
    cols: 21,
    rows: 13,
    layout: [
      "#####################",
      "#...................#",
      "#...t...........t...#",
      "#...................#",
      "#......B.....B......#",
      "#...................#",
      "#.........r.........#",
      "#...................#",
      "#......B.....B......#",
      "#...................#",
      "#........P..........#",
      "#...................#",
      "#####################",
    ],
  },
  // 2 — central pillar + crates; learn to use cover. Roamers.
  {
    cols: 21,
    rows: 13,
    layout: [
      "#####################",
      "#..t.............t..#",
      "#...................#",
      "#...BB.......BB......#",
      "#......#######.......#",
      "#......#.....#.......#",
      "#..r...#..O..#...r..#",
      "#......#.....#.......#",
      "#......#######.......#",
      "#...BB.......BB......#",
      "#.........P.........#",
      "#...................#",
      "#####################",
    ],
  },
  // 3 — corridors; introduce the Rusher.
  {
    cols: 23,
    rows: 13,
    layout: [
      "#######################",
      "#..t....#.......#....t.#",
      "#.......#.......#......#",
      "#...BBB..........BBB...#",
      "#.....................#",
      "##.###....u.....###.###",
      "#.......BB...BB........#",
      "##.###..........###.###",
      "#.....................#",
      "#...BBB..........BBB...#",
      "#.......#...P...#......#",
      "#..r....#.......#....r.#",
      "#######################",
    ],
  },
  // 4 — maze with holes; Sapper appears.
  {
    cols: 23,
    rows: 15,
    layout: [
      "#######################",
      "#...t...........t.....#",
      "#..###..BBB..###..###..#",
      "#..#.....O.....#....#..#",
      "#..#..s.....s..#.O..#..#",
      "#..###.......###....#..#",
      "#......BB...BB.........#",
      "#..O.............O....#",
      "#......BB...BB.........#",
      "#..###.......###....#..#",
      "#..#.O.........#.O..#..#",
      "#..#....r...r..#....#..#",
      "#..###..BBB..###..###..#",
      "#..........P..........#",
      "#######################",
    ],
  },
  // 5 — fortress; mixed mid-tier squad.
  {
    cols: 25,
    rows: 15,
    layout: [
      "#########################",
      "#..t..................t..#",
      "#...BBBBB.......BBBBB....#",
      "#...B...B.......B...B....#",
      "#...B.u.B...s...B.u.B....#",
      "#...B...B.......B...B....#",
      "#...BB#BB.......BB#BB....#",
      "#.....O...........O.....#",
      "#...BB#BB.......BB#BB....#",
      "#...B...B.......B...B....#",
      "#...B.r.B.......B.r.B....#",
      "#...B...B.......B...B....#",
      "#...BBBBB...P...BBBBB....#",
      "#.......................#",
      "#########################",
    ],
  },
  // 6 — open battlefield; Wardens enter.
  {
    cols: 25,
    rows: 15,
    layout: [
      "#########################",
      "#.w.......t...t.......w.#",
      "#.......................#",
      "#...##.....O.....##.....#",
      "#...##...BB.BB...##.....#",
      "#........B...B..........#",
      "#...O...B..u..B...O.....#",
      "#........B...B..........#",
      "#...##...BB.BB...##.....#",
      "#...##.....O.....##.....#",
      "#.......................#",
      "#...s...........s.......#",
      "#.......................#",
      "#...........P...........#",
      "#########################",
    ],
  },
  // 7 — spiral; trick angles, Phantom debut.
  {
    cols: 27,
    rows: 17,
    layout: [
      "###########################",
      "#..p.....................p.#",
      "#..#####.###########.####..#",
      "#..#...#.#.........#....#..#",
      "#..#.t.#.#.BB...BB.#..s.#..#",
      "#..#...#.#.#######.#....#..#",
      "#..#.###.#.#.....#.#.####..#",
      "#..#.#...O.#..O..#.O...#...#",
      "#..#.#.####.#####.####.#.#.#",
      "#..#.#.#......w......#.#.#.#",
      "#..#...#.###########.#...#.#",
      "#..#####.#.........#.#####.#",
      "#......u.#.BB...BB..#.u....#",
      "#..####..#.........#..####.#",
      "#..#.....###########.....#.#",
      "#............P.............#",
      "###########################",
    ],
  },
  // 8 — final authored gauntlet; full roster.
  {
    cols: 27,
    rows: 17,
    layout: [
      "###########################",
      "#.t..w...........w....t...#",
      "#...BBBB.......BBBB........#",
      "#...B..B...O...B..B........#",
      "#...B.uB.......Bu.B........#",
      "#...BBBB.......BBBB........#",
      "#....O.....p.......O......#",
      "#.........#####...........#",
      "#...s.....#.O.#......s....#",
      "#.........#####...........#",
      "#....O.....p.......O......#",
      "#...BBBB.......BBBB........#",
      "#...B.uB.......Bu.B........#",
      "#...B..B...O...B..B........#",
      "#...BBBB.......BBBB........#",
      "#.r..............r........#",
      "######........P........####",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Procedural generator (for levels beyond the authored set).          */
/* ------------------------------------------------------------------ */

type Grid = string[][];

const isSolidChar = (c: string) => c === "#" || c === "B" || c === "O";

/** Build the enemy composition for a generated level. */
function generatedSquad(level: number, rnd: () => number): string[] {
  const count = Math.min(3 + Math.floor(level / 2), 10);
  const pool: Array<{ id: string; weight: number }> = [
    { id: "t", weight: Math.max(1, 5 - level * 0.3) },
    { id: "r", weight: Math.max(1, 4 - level * 0.2) },
  ];
  if (level >= 3) pool.push({ id: "u", weight: 2 + level * 0.15 });
  if (level >= 4) pool.push({ id: "s", weight: 1.5 + level * 0.1 });
  if (level >= 6) pool.push({ id: "w", weight: 1 + level * 0.2 });
  if (level >= 8) pool.push({ id: "p", weight: 1 + level * 0.25 });

  const total = pool.reduce((s, p) => s + p.weight, 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let r = rnd() * total;
    let chosen = pool[0].id;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) {
        chosen = p.id;
        break;
      }
    }
    out.push(chosen);
  }
  // Guarantee at least one tougher unit at higher levels for spice.
  if (level >= 6 && !out.some((id) => id === "w" || id === "p")) {
    out[0] = level >= 8 ? "p" : "w";
  }
  return out;
}

/** Stamp a small symmetric blob of solids centred near (cx,cy), mirrored. */
function stampCluster(grid: Grid, cols: number, cx: number, cy: number, rnd: () => number) {
  const w = 1 + Math.floor(rnd() * 2);
  const h = 1 + Math.floor(rnd() * 2);
  const breakable = rnd() < 0.5;
  for (let dy = 0; dy <= h; dy++) {
    for (let dx = 0; dx <= w; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const mx = cols - 1 - x; // horizontal mirror
      const ch = breakable ? "B" : "#";
      if (grid[y] && grid[y][x] !== undefined) grid[y][x] = ch;
      if (grid[y] && grid[y][mx] !== undefined) grid[y][mx] = ch;
    }
  }
}

function floodReachable(grid: Grid, cols: number, rows: number, sx: number, sy: number): boolean[][] {
  const seen: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const stack: Array<[number, number]> = [[sx, sy]];
  seen[sy][sx] = true;
  while (stack.length) {
    const [x, y] = stack.pop() as [number, number];
    const nbrs: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nbrs) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen[ny][nx]) continue;
      // tanks cannot enter solids; treat holes as impassable for reachability
      if (isSolidChar(grid[ny][nx])) continue;
      seen[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export function generateLevel(level: number): LevelDef {
  const rnd = mulberry32(hashString(`tank-battle/${level}`));
  const cols = Math.min(19 + 2 * Math.floor(level / 3), 29);
  const rows = Math.min(13 + 2 * Math.floor(level / 4), 19);

  // Start empty with a steel border.
  const grid: Grid = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) =>
      x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? "#" : ".",
    ),
  );

  // Scatter symmetric clusters of cover.
  const clusters = 4 + Math.floor(level / 2) + Math.floor(rnd() * 3);
  for (let i = 0; i < clusters; i++) {
    const cx = 2 + Math.floor(rnd() * Math.max(1, Math.floor(cols / 2) - 2));
    const cy = 2 + Math.floor(rnd() * (rows - 4));
    stampCluster(grid, cols, cx, cy, rnd);
  }
  // A few holes for spice (avoid the very centre bottom where player spawns).
  const holes = Math.floor(rnd() * (2 + level / 3));
  for (let i = 0; i < holes; i++) {
    const hx = 2 + Math.floor(rnd() * (cols - 4));
    const hy = 2 + Math.floor(rnd() * (rows - 4));
    if (grid[hy][hx] === ".") grid[hy][hx] = "O";
  }

  // Player spawn: bottom centre, cleared with a little breathing room.
  const psx = Math.floor(cols / 2);
  const psy = rows - 2;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = psx + dx;
      const y = psy + dy;
      if (x > 0 && y > 0 && x < cols - 1 && y < rows - 1) grid[y][x] = ".";
    }
  grid[psy][psx] = "P";

  // Reachable cells from player spawn -> valid enemy placements.
  const reach = floodReachable(grid, cols, rows, psx, psy);
  const open: Array<[number, number]> = [];
  for (let y = 1; y < rows - 1; y++)
    for (let x = 1; x < cols - 1; x++) {
      if (reach[y][x] && grid[y][x] === ".") {
        // keep enemies away from the immediate player spawn
        const d = Math.hypot(x - psx, y - psy);
        if (d > 4) open.push([x, y]);
      }
    }

  // Shuffle reachable cells deterministically.
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = open[i];
    open[i] = open[j];
    open[j] = tmp;
  }

  const squad = generatedSquad(level, rnd);
  for (let i = 0; i < squad.length && i < open.length; i++) {
    const [x, y] = open[i];
    grid[y][x] = squad[i];
  }

  return { cols, rows, layout: grid.map((row) => row.join("")) };
}

/** Total number of authored levels (used to decide when to generate). */
export const AUTHORED_COUNT = AUTHORED.length;

/** Get the level definition for a 1-based level index. */
export function getLevel(level: number): LevelDef {
  if (level >= 1 && level <= AUTHORED.length) return AUTHORED[level - 1];
  return generateLevel(level);
}
