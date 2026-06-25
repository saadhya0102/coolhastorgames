/**
 * HexGrid — the abstract bubble board and all of its spatial logic.
 *
 * Coordinate model: pointy-top, odd-row-offset hex packing.
 *   - EVEN rows (row % 2 === 0) hold COLS bubbles, centers at x = R + col*2R.
 *   - ODD  rows (row % 2 === 1) hold COLS - 1 bubbles, shifted right by R,
 *     centers at x = 2R + col*2R.
 *
 * The grid stores ONLY cell-space data (independent of pixel size). Pixel
 * geometry is supplied per call so the same board renders at any resolution.
 */

import { COLS, MAX_ROWS } from "./config";
import type { Board, Cell, CellRef, Geometry } from "./types";

/** Number of columns valid for a given row (depends on parity). */
export function colsInRow(row: number): number {
  return row % 2 === 0 ? COLS : COLS - 1;
}

/** Make a fresh empty row of the correct width for its parity. */
export function emptyRow(row: number): (Cell | null)[] {
  return new Array<Cell | null>(colsInRow(row)).fill(null);
}

/** Construct a brand-new placed cell with spawn animation primed. */
export function makeCell(color: number, spawned = false): Cell {
  return {
    color,
    spawnT: spawned ? 1 : 0,
    wobble: 0,
    hitFlash: spawned ? 0 : 1,
  };
}

export class HexGrid {
  board: Board = [];

  constructor() {
    this.clear();
  }

  clear(): void {
    this.board = [];
  }

  rows(): number {
    return this.board.length;
  }

  /** True if (row,col) is a valid in-bounds cell for the current board. */
  inBounds(row: number, col: number): boolean {
    if (row < 0 || row >= this.board.length) return false;
    return col >= 0 && col < this.board[row].length;
  }

  /** True if a coordinate is a legal cell for its parity even if board is short. */
  isLegalCell(row: number, col: number): boolean {
    if (row < 0 || row >= MAX_ROWS) return false;
    return col >= 0 && col < colsInRow(row);
  }

  get(row: number, col: number): Cell | null {
    if (!this.inBounds(row, col)) return null;
    return this.board[row][col];
  }

  set(row: number, col: number, cell: Cell | null): void {
    this.ensureRow(row);
    if (col >= 0 && col < this.board[row].length) this.board[row][col] = cell;
  }

  /** Grow the jagged array (with correctly-sized empty rows) up to `row`. */
  ensureRow(row: number): void {
    while (this.board.length <= row && this.board.length < MAX_ROWS) {
      this.board.push(emptyRow(this.board.length));
    }
  }

  /** Insert a new row at the top (a ceiling descent). Shifts all rows down. */
  unshiftRow(cells: (Cell | null)[]): void {
    this.board.unshift(cells);
    if (this.board.length > MAX_ROWS) this.board.pop();
  }

  /** Total number of occupied cells. */
  count(): number {
    let n = 0;
    for (const row of this.board) for (const c of row) if (c) n++;
    return n;
  }

  /** True when no bubbles remain. */
  isEmpty(): boolean {
    return this.count() === 0;
  }

  /** All occupied cell refs. */
  occupied(): CellRef[] {
    const out: CellRef[] = [];
    for (let r = 0; r < this.board.length; r++)
      for (let c = 0; c < this.board[r].length; c++)
        if (this.board[r][c]) out.push({ row: r, col: c });
    return out;
  }

  /** Set of distinct colors currently on the board. */
  colorsPresent(): Set<number> {
    const s = new Set<number>();
    for (const row of this.board)
      for (const c of row) if (c) s.add(c.color);
    return s;
  }

  /**
   * The 6 hex neighbors of (row,col). Column offsets differ by row parity
   * because odd rows are shifted right by R (odd-r offset coordinates).
   */
  neighbors(row: number, col: number): CellRef[] {
    const even = row % 2 === 0;
    const deltas: ReadonlyArray<readonly [number, number]> = even
      ? [
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 0],
          [1, -1],
          [1, 0],
        ]
      : [
          [0, -1],
          [0, 1],
          [-1, 0],
          [-1, 1],
          [1, 0],
          [1, 1],
        ];
    const out: CellRef[] = [];
    for (const [dr, dc] of deltas) {
      const nr = row + dr;
      const nc = col + dc;
      if (this.isLegalCell(nr, nc)) out.push({ row: nr, col: nc });
    }
    return out;
  }

  /** Pixel center of a cell given current geometry. */
  cellCenter(row: number, col: number, geo: Geometry, descendAnim: number): {
    x: number;
    y: number;
  } {
    const offset = row % 2 === 0 ? geo.R : geo.R * 2;
    const x = geo.boardLeft + offset + col * geo.R * 2;
    const y = geo.ceilingY + geo.R + row * geo.rowH - descendAnim;
    return { x, y };
  }

  /** Nearest cell coordinate to a pixel point (may be occupied / illegal). */
  pixelToCell(
    px: number,
    py: number,
    geo: Geometry,
    descendAnim: number,
  ): CellRef {
    let row = Math.round(
      (py - geo.ceilingY - geo.R + descendAnim) / geo.rowH,
    );
    if (row < 0) row = 0;
    const offset = row % 2 === 0 ? geo.R : geo.R * 2;
    let col = Math.round((px - geo.boardLeft - offset) / (geo.R * 2));
    const maxCol = colsInRow(row) - 1;
    if (col < 0) col = 0;
    if (col > maxCol) col = maxCol;
    return { row, col };
  }

  /**
   * Flood fill from (row,col) collecting all connected cells of the SAME color.
   */
  matchCluster(row: number, col: number): CellRef[] {
    const origin = this.get(row, col);
    if (!origin) return [];
    const color = origin.color;
    const seen = new Set<string>();
    const stack: CellRef[] = [{ row, col }];
    const cluster: CellRef[] = [];
    while (stack.length) {
      const cur = stack.pop() as CellRef;
      const key = cur.row + "," + cur.col;
      if (seen.has(key)) continue;
      seen.add(key);
      const cell = this.get(cur.row, cur.col);
      if (!cell || cell.color !== color) continue;
      cluster.push(cur);
      for (const n of this.neighbors(cur.row, cur.col)) {
        if (!seen.has(n.row + "," + n.col)) stack.push(n);
      }
    }
    return cluster;
  }

  /**
   * Connectivity flood fill from the top row. Returns the set of cells that are
   * still anchored to the ceiling. Any occupied cell NOT in this set is
   * floating and should drop.
   */
  anchoredKeys(): Set<string> {
    const anchored = new Set<string>();
    const stack: CellRef[] = [];
    if (this.board.length > 0) {
      for (let c = 0; c < this.board[0].length; c++) {
        if (this.board[0][c]) stack.push({ row: 0, col: c });
      }
    }
    while (stack.length) {
      const cur = stack.pop() as CellRef;
      const key = cur.row + "," + cur.col;
      if (anchored.has(key)) continue;
      if (!this.get(cur.row, cur.col)) continue;
      anchored.add(key);
      for (const n of this.neighbors(cur.row, cur.col)) {
        const nk = n.row + "," + n.col;
        if (!anchored.has(nk) && this.get(n.row, n.col)) stack.push(n);
      }
    }
    return anchored;
  }

  /** All occupied cells not anchored to the ceiling (the floaters). */
  floatingCells(): CellRef[] {
    const anchored = this.anchoredKeys();
    const out: CellRef[] = [];
    for (let r = 0; r < this.board.length; r++)
      for (let c = 0; c < this.board[r].length; c++)
        if (this.board[r][c] && !anchored.has(r + "," + c))
          out.push({ row: r, col: c });
    return out;
  }

  /** True if an empty legal cell touches at least one occupied cell or row 0. */
  private isSupported(row: number, col: number): boolean {
    if (row === 0) return true;
    for (const n of this.neighbors(row, col)) {
      if (this.get(n.row, n.col)) return true;
    }
    return false;
  }

  /**
   * Choose the best empty cell to snap a shot into, given its pixel center.
   * Prefers supported, in-range cells, closest to the shot center.
   */
  findSnapCell(
    px: number,
    py: number,
    geo: Geometry,
    descendAnim: number,
  ): CellRef {
    const base = this.pixelToCell(px, py, geo, descendAnim);
    // Candidate pool: the base cell plus all of its neighbors.
    const candidates: CellRef[] = [base, ...this.neighbors(base.row, base.col)];
    // Also consider the row below the base in case we are arriving at the
    // bottom edge of the mass.
    for (const extra of this.neighbors(base.row, base.col)) {
      for (const n of this.neighbors(extra.row, extra.col)) candidates.push(n);
    }

    let bestSupported: CellRef | null = null;
    let bestSupportedD = Infinity;
    let bestAny: CellRef | null = null;
    let bestAnyD = Infinity;
    const seen = new Set<string>();

    for (const cand of candidates) {
      const key = cand.row + "," + cand.col;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.isLegalCell(cand.row, cand.col)) continue;
      if (this.get(cand.row, cand.col)) continue; // occupied
      const ctr = this.cellCenter(cand.row, cand.col, geo, descendAnim);
      const d = (ctr.x - px) ** 2 + (ctr.y - py) ** 2;
      if (d < bestAnyD) {
        bestAnyD = d;
        bestAny = cand;
      }
      if (this.isSupported(cand.row, cand.col) && d < bestSupportedD) {
        bestSupportedD = d;
        bestSupported = cand;
      }
    }

    if (bestSupported) return bestSupported;
    if (bestAny) return bestAny;
    // Absolute fallback: clamp the base into legality.
    const row = Math.max(0, base.row);
    const col = Math.max(0, Math.min(colsInRow(row) - 1, base.col));
    return { row, col };
  }

  /** Index of the lowest occupied row (-1 if empty). */
  lowestOccupiedRow(): number {
    for (let r = this.board.length - 1; r >= 0; r--) {
      if (this.board[r].some((c) => c)) return r;
    }
    return -1;
  }
}
