/**
 * Procedural level generation for Bubble Pop Saga.
 *
 * Boards are generated with a seeded RNG (mulberry32) derived from the level
 * index plus a per-run salt, so a level is deterministic within a run but
 * varies between runs. Colors are drawn from the level's active subset with a
 * light clustering bias so there are satisfying pre-made groups without giant
 * trivial blobs.
 */

import { mulberry32 } from "@/engine";
import {
  COLORS_BY_LEVEL,
  INITIAL_ROWS,
  PALETTE,
  SHOTS_PER_DESCENT_BASE,
  SHOTS_PER_DESCENT_MIN,
} from "./config";
import { colsInRow, emptyRow, makeCell } from "./grid";
import type { Board, Cell } from "./types";

/** Active number of distinct colors for a level (capped at the palette size). */
export function colorsForLevel(level: number): number {
  const idx = Math.min(level - 1, COLORS_BY_LEVEL.length - 1);
  const want = COLORS_BY_LEVEL[Math.max(0, idx)];
  return Math.min(want, PALETTE.length);
}

/** Shots between ceiling descents for a level (gets faster as you climb). */
export function shotsPerDescent(level: number): number {
  return Math.max(SHOTS_PER_DESCENT_MIN, SHOTS_PER_DESCENT_BASE - (level - 1));
}

/** Number of pre-filled rows for a level (grows slowly, capped). */
export function rowsForLevel(level: number): number {
  return Math.min(INITIAL_ROWS + Math.floor((level - 1) / 2), 9);
}

interface RNG {
  (): number;
}

function pickColor(rng: RNG, colorCount: number): number {
  return Math.floor(rng() * colorCount);
}

/**
 * Build the starting board for a level. Returns a jagged Board with the top
 * rows densely filled and lower rows progressively gappier.
 */
export function generateBoard(level: number, salt: number): Board {
  const rng = mulberry32((level * 2654435761) ^ (salt * 40503) ^ 0x9e3779b9);
  const colorCount = colorsForLevel(level);
  const filledRows = rowsForLevel(level);
  const board: Board = [];

  for (let r = 0; r < filledRows; r++) {
    const row = emptyRow(r);
    const width = colsInRow(r);
    // Top rows are solid; lower rows leave more gaps for interesting overhangs.
    const depth = r / Math.max(1, filledRows - 1);
    const gapChance = depth * 0.32;
    for (let c = 0; c < width; c++) {
      if (r > 1 && rng() < gapChance) continue; // leave a gap
      const color = chooseClustered(board, row, r, c, rng, colorCount);
      row[c] = makeCell(color, true);
    }
    board.push(row);
  }
  return board;
}

/**
 * Pick a color for (r,c) biased to copy an already-placed neighbor sometimes,
 * forming small satisfying clusters. Looks only at cells placed so far
 * (left + the row above) to keep it cheap and deterministic.
 */
function chooseClustered(
  board: Board,
  currentRow: (Cell | null)[],
  r: number,
  c: number,
  rng: RNG,
  colorCount: number,
): number {
  const candidates: number[] = [];
  // left neighbor in the current row
  if (c > 0 && currentRow[c - 1]) candidates.push((currentRow[c - 1] as Cell).color);
  // up neighbors from the row above (parity aware)
  const above = board[r - 1];
  if (above) {
    const even = r % 2 === 0;
    const ups = even ? [c - 1, c] : [c, c + 1];
    for (const uc of ups) {
      if (uc >= 0 && uc < above.length && above[uc]) {
        candidates.push((above[uc] as Cell).color);
      }
    }
  }
  // 55% chance to echo a neighbor (clustering), else a fresh random color.
  if (candidates.length && rng() < 0.55) {
    return candidates[Math.floor(rng() * candidates.length)];
  }
  return pickColor(rng, colorCount);
}

/**
 * Generate a single fresh row to push onto the top of the board during a
 * ceiling descent. Colors are drawn from the active subset, lightly echoing the
 * row that is currently on top so the seam looks natural.
 */
export function generateDescentRow(
  topRow: (Cell | null)[] | undefined,
  newRowIndex: number,
  level: number,
  rng: RNG,
): (Cell | null)[] {
  const colorCount = colorsForLevel(level);
  const width = colsInRow(newRowIndex);
  const row = emptyRow(newRowIndex);
  for (let c = 0; c < width; c++) {
    // small chance of a gap so descent rows are not always a solid wall
    if (rng() < 0.08) continue;
    let color = Math.floor(rng() * colorCount);
    if (topRow && rng() < 0.4) {
      const sample = topRow[Math.min(c, topRow.length - 1)];
      if (sample) color = sample.color;
    }
    row[c] = makeCell(color, false);
  }
  // guarantee at least a few bubbles so descents always add pressure
  if (!row.some((x) => x)) {
    row[Math.floor(rng() * width)] = makeCell(
      Math.floor(rng() * colorCount),
      false,
    );
  }
  return row;
}
