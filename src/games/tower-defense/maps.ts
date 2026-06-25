import type { GameMap, Vec } from "./types";

/**
 * Three hand-designed maps. All share a 16x11 grid so towers/enemies are sized
 * consistently. Waypoints are tile centers (col+0.5, row+0.5); the first and
 * last sit off-screen so enemies stream in and the keep can guard the exit.
 */

const COLS = 16;
const ROWS = 11;

export const MAPS: GameMap[] = [
  {
    name: "Greenway",
    theme: "Spring meadow",
    cols: COLS,
    rows: ROWS,
    waypoints: [
      { x: -1, y: 5.5 },
      { x: 3.5, y: 5.5 },
      { x: 3.5, y: 2.5 },
      { x: 8.5, y: 2.5 },
      { x: 8.5, y: 8.5 },
      { x: 12.5, y: 8.5 },
      { x: 12.5, y: 4.5 },
      { x: 16.5, y: 4.5 },
    ],
    decorations: [
      { x: 1, y: 1 },
      { x: 6, y: 6 },
      { x: 6, y: 7 },
      { x: 14, y: 9 },
      { x: 10, y: 0 },
    ],
    startGold: 210,
    startLives: 20,
    grass: "#6fae4a",
    grassAlt: "#67a544",
    road: "#caa86a",
    roadEdge: "#a3824c",
    accent: "#3f8f3a",
  },
  {
    name: "Crossfork",
    theme: "Autumn fields",
    cols: COLS,
    rows: ROWS,
    waypoints: [
      { x: -1, y: 1.5 },
      { x: 13.5, y: 1.5 },
      { x: 13.5, y: 4.5 },
      { x: 2.5, y: 4.5 },
      { x: 2.5, y: 7.5 },
      { x: 13.5, y: 7.5 },
      { x: 13.5, y: 9.5 },
      { x: -1, y: 9.5 },
    ],
    decorations: [
      { x: 7, y: 0 },
      { x: 8, y: 3 },
      { x: 7, y: 6 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
      { x: 15, y: 6 },
    ],
    startGold: 200,
    startLives: 20,
    grass: "#b58a44",
    grassAlt: "#ab8240",
    road: "#7c5c34",
    roadEdge: "#5d4426",
    accent: "#d2742a",
  },
  {
    name: "Serpent's Run",
    theme: "Volcanic basin",
    cols: COLS,
    rows: ROWS,
    waypoints: [
      { x: 2.5, y: -1 },
      { x: 2.5, y: 8.5 },
      { x: 5.5, y: 8.5 },
      { x: 5.5, y: 2.5 },
      { x: 8.5, y: 2.5 },
      { x: 8.5, y: 8.5 },
      { x: 11.5, y: 8.5 },
      { x: 11.5, y: 2.5 },
      { x: 13.5, y: 2.5 },
      { x: 13.5, y: 9.5 },
      { x: 16.5, y: 9.5 },
    ],
    decorations: [
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 7, y: 5 },
      { x: 10, y: 5 },
      { x: 0, y: 10 },
    ],
    startGold: 230,
    startLives: 18,
    grass: "#5c5048",
    grassAlt: "#554a43",
    road: "#3a322d",
    roadEdge: "#241f1b",
    accent: "#e0552b",
  },
];

export const tileKey = (col: number, row: number) => `${col},${row}`;

/** Rasterise axis-aligned path segments into the set of road tiles. */
export function buildRoadTiles(map: GameMap): Set<string> {
  const tiles = new Set<string>();
  const wp = map.waypoints;
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i];
    const b = wp[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len * 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx = a.x + dx * t;
      const gy = a.y + dy * t;
      const col = Math.floor(gx);
      const row = Math.floor(gy);
      if (col >= 0 && col < map.cols && row >= 0 && row < map.rows) {
        tiles.add(tileKey(col, row));
        // widen the road a touch so it reads as a proper lane, not a hairline
        if (Math.abs(dx) > Math.abs(dy)) {
          if (row - 0 >= 0) tiles.add(tileKey(col, row));
        }
      }
    }
  }
  return tiles;
}

/** Total path length in grid units. */
export function pathLength(wp: Vec[]): number {
  let total = 0;
  for (let i = 0; i < wp.length - 1; i++) {
    total += Math.hypot(wp[i + 1].x - wp[i].x, wp[i + 1].y - wp[i].y);
  }
  return total;
}

/** Position along the path at distance `dist` (grid units). */
export function positionAt(wp: Vec[], dist: number): Vec {
  if (dist <= 0) return { x: wp[0].x, y: wp[0].y };
  let d = dist;
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i];
    const b = wp[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= segLen) {
      const t = segLen === 0 ? 0 : d / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    d -= segLen;
  }
  const last = wp[wp.length - 1];
  return { x: last.x, y: last.y };
}

/** Travel direction (unit vector) at distance `dist`. */
export function directionAt(wp: Vec[], dist: number): Vec {
  let d = Math.max(0, dist);
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i];
    const b = wp[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= segLen || i === wp.length - 2) {
      const len = segLen || 1;
      return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    }
    d -= segLen;
  }
  return { x: 1, y: 0 };
}
