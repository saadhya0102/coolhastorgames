/** Neon Dash — level compiler: Segment[] (+ ASCII) -> CompiledLevel. */
import {
  Cell,
  CEIL_BOTTOM_ROW,
  FLOOR_TOP_ROW,
  GRID_ROWS,
  GROUND_CUBE_ROW,
  type CellType,
} from "./constants";
import type { CompiledLevel, Level, Segment } from "./types";

const STAIR_STEP_W = 2;

/** ASCII legend used by `raw` segments. */
function charToCell(ch: string): CellType | null {
  switch (ch) {
    case "#":
      return Cell.BLOCK;
    case "^":
      return Cell.SPIKE_UP;
    case "v":
      return Cell.SPIKE_DOWN;
    case "o":
      return Cell.ORB;
    case "p":
      return Cell.PAD;
    default:
      return null;
  }
}

function portalChar(ch: string): CellType | null {
  switch (ch) {
    case "F":
      return Cell.PORTAL_FLIP;
    case "S":
      return Cell.PORTAL_SHIP;
    case "C":
      return Cell.PORTAL_CUBE;
    default:
      return null;
  }
}

function widthOf(seg: Segment): number {
  switch (seg.k) {
    case "flat":
    case "gap":
    case "spikes":
    case "platform":
    case "spikedPlatform":
    case "pillar":
    case "ceilSpikes":
    case "gapOrb":
      return seg.n;
    case "padSpikes":
      return seg.n + 1;
    case "stairs":
      return seg.h * STAIR_STEP_W;
    case "pad":
    case "orb":
    case "flip":
    case "ship":
    case "cube":
      return 1;
    case "raw":
      return seg.rows.reduce((m, r) => Math.max(m, r.length), 0);
  }
}

export function compileLevel(level: Level): CompiledLevel {
  const segments = level.segments;
  let cols = 0;
  for (const s of segments) cols += widthOf(s);
  // trailing safety runway so the finish line is reachable & framed
  cols += 6;

  const cells = new Uint8Array(cols * GRID_ROWS);
  const floor = new Array<boolean>(cols).fill(true);
  const portals: { col: number; type: CellType }[] = [];

  const set = (col: number, row: number, t: CellType) => {
    if (col < 0 || col >= cols || row < 0 || row >= GRID_ROWS) return;
    cells[col * GRID_ROWS + row] = t;
  };
  const block = (col: number, h: number) => {
    for (let r = FLOOR_TOP_ROW - h; r <= FLOOR_TOP_ROW - 1; r++) set(col, r, Cell.BLOCK);
  };

  let c = 0;
  for (const seg of segments) {
    switch (seg.k) {
      case "flat":
        c += seg.n;
        break;
      case "gap":
        for (let i = 0; i < seg.n; i++) floor[c + i] = false;
        c += seg.n;
        break;
      case "spikes":
        for (let i = 0; i < seg.n; i++) set(c + i, GROUND_CUBE_ROW, Cell.SPIKE_UP);
        c += seg.n;
        break;
      case "platform":
        for (let i = 0; i < seg.n; i++) block(c + i, seg.h);
        c += seg.n;
        break;
      case "pillar":
        for (let i = 0; i < seg.n; i++) block(c + i, seg.h);
        c += seg.n;
        break;
      case "spikedPlatform":
        for (let i = 0; i < seg.n; i++) {
          block(c + i, seg.h);
          set(c + i, FLOOR_TOP_ROW - seg.h - 1, Cell.SPIKE_UP);
        }
        c += seg.n;
        break;
      case "stairs": {
        for (let i = 0; i < seg.h; i++) {
          const stepH = seg.dir === 1 ? i + 1 : seg.h - i;
          for (let w = 0; w < STAIR_STEP_W; w++) block(c + i * STAIR_STEP_W + w, stepH);
        }
        c += seg.h * STAIR_STEP_W;
        break;
      }
      case "pad":
        set(c, GROUND_CUBE_ROW - seg.h, Cell.PAD);
        c += 1;
        break;
      case "orb":
        set(c, seg.row, Cell.ORB);
        c += 1;
        break;
      case "gapOrb":
        for (let i = 0; i < seg.n; i++) floor[c + i] = false;
        set(c + Math.floor(seg.n / 2), seg.row, Cell.ORB);
        c += seg.n;
        break;
      case "padSpikes":
        set(c, GROUND_CUBE_ROW, Cell.PAD);
        for (let i = 0; i < seg.n; i++) set(c + 1 + i, GROUND_CUBE_ROW, Cell.SPIKE_UP);
        c += seg.n + 1;
        break;
      case "flip":
        portals.push({ col: c, type: Cell.PORTAL_FLIP });
        c += 1;
        break;
      case "ship":
        portals.push({ col: c, type: Cell.PORTAL_SHIP });
        c += 1;
        break;
      case "cube":
        portals.push({ col: c, type: Cell.PORTAL_CUBE });
        c += 1;
        break;
      case "ceilSpikes":
        for (let i = 0; i < seg.n; i++) set(c + i, CEIL_BOTTOM_ROW, Cell.SPIKE_DOWN);
        c += seg.n;
        break;
      case "raw": {
        const w = widthOf(seg);
        for (let r = 0; r < seg.rows.length && r < GRID_ROWS; r++) {
          const line = seg.rows[r];
          for (let x = 0; x < line.length; x++) {
            const ch = line[x];
            const p = portalChar(ch);
            if (p !== null) {
              portals.push({ col: c + x, type: p });
              continue;
            }
            const t = charToCell(ch);
            if (t !== null && t !== Cell.EMPTY) set(c + x, r, t);
          }
        }
        c += w;
        break;
      }
    }
  }

  return { meta: level.meta, cols, floor, cells, portals };
}

/** Read a placed cell (blocks/spikes/orbs/pads) at a grid coordinate. */
export function cellAt(lvl: CompiledLevel, col: number, row: number): number {
  if (col < 0 || col >= lvl.cols || row < 0 || row >= GRID_ROWS) return Cell.EMPTY;
  return lvl.cells[col * GRID_ROWS + row];
}
