import type { GameContext, GameInstance } from "@/engine";
import { drawText, roundRect, clamp } from "@/engine";

const COLS = 10;
const ROWS = 20;

type Cell = number; // 0 = empty, 1..7 = piece color index

interface PieceDef {
  readonly color: string;
  readonly shadow: string;
  /** rotation states; each a list of [x,y] filled cells within a box */
  readonly cells: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

/** Build the 4 rotation states from a base matrix (clockwise). */
function makeStates(base: number[][]): Array<Array<[number, number]>> {
  const states: Array<Array<[number, number]>> = [];
  let m = base;
  for (let s = 0; s < 4; s++) {
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++)
        if (m[y][x]) cells.push([x, y]);
    states.push(cells);
    // rotate clockwise
    const n = m.length;
    const r: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) r[x][n - 1 - y] = m[y][x];
    m = r;
  }
  return states;
}

const PIECES: PieceDef[] = [
  // I (cyan)
  {
    color: "#31c7ef",
    shadow: "#1a7d96",
    cells: makeStates([
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]),
  },
  // J (blue)
  {
    color: "#5a65f0",
    shadow: "#343c9e",
    cells: makeStates([
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ]),
  },
  // L (orange)
  {
    color: "#ef9a31",
    shadow: "#9a601a",
    cells: makeStates([
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ]),
  },
  // O (yellow)
  {
    color: "#f2d231",
    shadow: "#9a861a",
    cells: makeStates([
      [1, 1],
      [1, 1],
    ]),
  },
  // S (green)
  {
    color: "#42d667",
    shadow: "#258a3e",
    cells: makeStates([
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ]),
  },
  // T (purple)
  {
    color: "#b14ff0",
    shadow: "#6d2c9e",
    cells: makeStates([
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ]),
  },
  // Z (red)
  {
    color: "#ef4747",
    shadow: "#9e2b2b",
    cells: makeStates([
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ]),
  },
];

interface Active {
  type: number; // index into PIECES
  rot: number;
  x: number;
  y: number;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  let board: Cell[][] = [];
  let active: Active = { type: 0, rot: 0, x: 0, y: 0 };
  let bag: number[] = [];
  let nextQueue: number[] = [];
  let hold: number | null = null;
  let holdUsed = false;

  let score = 0;
  let lines = 0;
  let level = 1;
  let dead = false;

  let best = ctx.storage.get("__best", 0);

  // timing
  let gravityT = 0;
  let lockT = 0;
  let onGround = false;
  const LOCK_DELAY = 0.5;
  // limit how many times the lock timer can be refreshed per piece so the
  // player can't stall forever by spinning / sliding on the ground.
  let lockResets = 0;
  const MAX_LOCK_RESETS = 15;
  const refreshLock = () => {
    if (lockResets < MAX_LOCK_RESETS) {
      lockT = 0;
      lockResets++;
    }
  };

  // auto-repeat for horizontal movement
  let dasDir = 0;
  let dasT = 0;
  const DAS = 0.16;
  const ARR = 0.045;

  // soft drop repeat
  let softT = 0;
  const SOFT_EVERY = 0.04;

  // line clear flash
  let clearRows: number[] = [];
  let clearT = 0;

  const gravityFor = (lvl: number) =>
    Math.max(0.05, 0.9 * Math.pow(0.82, lvl - 1));

  const emptyBoard = () =>
    Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(0));

  const refillBag = () => {
    const order = [0, 1, 2, 3, 4, 5, 6];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    bag.push(...order);
  };

  const nextType = (): number => {
    if (bag.length === 0) refillBag();
    return bag.shift() as number;
  };

  const ensureQueue = () => {
    while (nextQueue.length < 4) nextQueue.push(nextType());
  };

  const cellsOf = (type: number, rot: number) =>
    PIECES[type].cells[rot % 4];

  const collides = (type: number, rot: number, px: number, py: number): boolean => {
    for (const [cx, cy] of cellsOf(type, rot)) {
      const x = px + cx;
      const y = py + cy;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y][x] !== 0) return true;
    }
    return false;
  };

  const spawnPiece = () => {
    ensureQueue();
    const type = nextQueue.shift() as number;
    ensureQueue();
    const boxW = type === 0 ? 4 : type === 3 ? 2 : 3;
    const startX = Math.floor((COLS - boxW) / 2);
    active = { type, rot: 0, x: startX, y: 0 };
    holdUsed = false;
    onGround = false;
    lockT = 0;
    lockResets = 0;
    if (collides(active.type, active.rot, active.x, active.y)) {
      die(); // top out
    }
  };

  const reset = () => {
    board = emptyBoard();
    bag = [];
    nextQueue = [];
    hold = null;
    holdUsed = false;
    score = 0;
    lines = 0;
    level = 1;
    dead = false;
    gravityT = 0;
    lockT = 0;
    onGround = false;
    clearRows = [];
    clearT = 0;
    ensureQueue();
    spawnPiece();
  };

  const die = () => {
    if (dead) return;
    dead = true;
    audio.lose();
    if (score > best) best = score;
    setTimeout(() => ctx.gameOver(score), 500);
  };

  const tryMove = (dx: number, dy: number): boolean => {
    if (collides(active.type, active.rot, active.x + dx, active.y + dy)) return false;
    active.x += dx;
    active.y += dy;
    return true;
  };

  const KICKS = [0, -1, 1, -2, 2];

  const rotate = (dir: number) => {
    const newRot = (active.rot + (dir > 0 ? 1 : 3)) % 4;
    for (const k of KICKS) {
      if (!collides(active.type, newRot, active.x + k, active.y)) {
        active.rot = newRot;
        active.x += k;
        audio.blip();
        onGround = collides(active.type, active.rot, active.x, active.y + 1);
        if (onGround) refreshLock();
        return;
      }
      // also try kicking up (useful for I near floor)
      if (!collides(active.type, newRot, active.x + k, active.y - 1)) {
        active.rot = newRot;
        active.x += k;
        active.y -= 1;
        audio.blip();
        return;
      }
    }
  };

  const ghostY = (): number => {
    let gy = active.y;
    while (!collides(active.type, active.rot, active.x, gy + 1)) gy++;
    return gy;
  };

  const lockPiece = () => {
    for (const [cx, cy] of cellsOf(active.type, active.rot)) {
      const x = active.x + cx;
      const y = active.y + cy;
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) board[y][x] = active.type + 1;
      if (y < 0) {
        die();
        return;
      }
    }
    // detect full rows
    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) {
      if (board[y].every((v) => v !== 0)) full.push(y);
    }
    if (full.length > 0) {
      clearRows = full;
      clearT = 0.18;
      const points = [0, 100, 300, 500, 800][full.length] ?? 800;
      score += points * level;
      lines += full.length;
      const newLevel = Math.floor(lines / 10) + 1;
      if (newLevel > level) {
        level = newLevel;
        audio.coin();
      }
      if (full.length >= 4) audio.win();
      else audio.tone(440 + full.length * 120, 0.1, "square", 0.4);
      ctx.reportScore(score);
      if (score > best) best = score;
    } else {
      audio.tone(220, 0.05, "square", 0.25);
    }
    if (!dead) spawnPiece();
  };

  const applyClears = () => {
    if (clearRows.length === 0) return;
    const set = new Set(clearRows);
    const kept = board.filter((_, y) => !set.has(y));
    const removed = clearRows.length;
    const fresh = Array.from({ length: removed }, () => Array<Cell>(COLS).fill(0));
    board = [...fresh, ...kept];
    clearRows = [];
  };

  const hardDrop = () => {
    const gy = ghostY();
    const dropped = gy - active.y;
    active.y = gy;
    score += dropped * 2;
    ctx.reportScore(score);
    audio.tone(160, 0.08, "square", 0.4);
    lockPiece();
  };

  const doHold = () => {
    if (holdUsed || dead) return;
    if (hold === null) {
      hold = active.type;
      spawnPiece();
    } else {
      const swap = hold;
      hold = active.type;
      const boxW = swap === 0 ? 4 : swap === 3 ? 2 : 3;
      active = { type: swap, rot: 0, x: Math.floor((COLS - boxW) / 2), y: 0 };
      onGround = false;
      lockT = 0;
      if (collides(active.type, active.rot, active.x, active.y)) die();
    }
    // Must be set AFTER spawnPiece(), which resets holdUsed to false.
    holdUsed = true;
    audio.blip();
  };

  reset();
  ctx.setStatus("← → move · ↑ rotate · ↓ soft · Space drop · C hold");
  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Space", label: "DROP", id: "drop" },
    { type: "button", key: "c", label: "HOLD", id: "hold" },
  ]);

  return {
    update(dt) {
      if (dead) return;

      // line clear animation pause
      if (clearRows.length > 0) {
        clearT -= dt;
        if (clearT <= 0) applyClears();
        return;
      }

      // rotation
      if (input.pressed("ArrowUp", "w", "x")) rotate(1);
      if (input.pressed("c", "Shift")) doHold();
      if (input.pressed("Space")) hardDrop();
      if (dead) return;

      // horizontal DAS
      const left = input.isDown("ArrowLeft", "a");
      const right = input.isDown("ArrowRight", "d");
      const dir = left && !right ? -1 : right && !left ? 1 : 0;
      let movedH = false;
      if (dir !== dasDir) {
        dasDir = dir;
        dasT = 0;
        if (dir !== 0) {
          if (tryMove(dir, 0)) {
            movedH = true;
            audio.tone(330, 0.03, "square", 0.18);
          }
        }
      } else if (dir !== 0) {
        dasT += dt;
        if (dasT >= DAS) {
          // auto repeat
          let steps = Math.floor((dasT - DAS) / ARR) + 1;
          while (steps-- > 0) {
            if (!tryMove(dir, 0)) break;
            movedH = true;
          }
          dasT = DAS + ((dasT - DAS) % ARR);
        }
      }

      // recompute ground state
      onGround = collides(active.type, active.rot, active.x, active.y + 1);
      // sliding on the ground refreshes the lock timer (capped), so a piece
      // settling on uneven terrain feels responsive without enabling stalling.
      if (movedH && onGround) refreshLock();

      // soft drop
      const soft = input.isDown("ArrowDown", "s");
      if (soft) {
        softT += dt;
        while (softT >= SOFT_EVERY) {
          softT -= SOFT_EVERY;
          if (tryMove(0, 1)) {
            score += 1;
            ctx.reportScore(score);
          } else break;
        }
      } else {
        softT = 0;
      }

      // gravity
      const g = gravityFor(level);
      gravityT += dt;
      if (!onGround) {
        while (gravityT >= g) {
          gravityT -= g;
          if (!tryMove(0, 1)) break;
        }
        lockT = 0;
      } else {
        gravityT = 0;
        lockT += dt;
        if (lockT >= LOCK_DELAY) {
          lockPiece();
        }
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      // background
      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0d1326");
      grad.addColorStop(1, "#070a15");
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      // layout: well + side panel
      const margin = Math.min(W, H) * 0.03;
      const panelCols = 4.6; // in cell units
      const availW = W - margin * 2;
      const availH = H - margin * 2;
      const cellByH = availH / ROWS;
      const cellByW = availW / (COLS + panelCols + 0.6);
      const cell = Math.max(6, Math.min(cellByH, cellByW));

      const wellW = cell * COLS;
      const wellH = cell * ROWS;
      const panelW = cell * panelCols;
      const totalW = wellW + cell * 0.6 + panelW;
      const ox = (W - totalW) / 2;
      const oy = (H - wellH) / 2;
      const px = ox + wellW + cell * 0.6;

      // well backdrop
      c.fillStyle = "#0a0f1f";
      roundRect(c, ox - 4, oy - 4, wellW + 8, wellH + 8, 8);
      c.fill();

      // grid lines
      c.strokeStyle = "rgba(255,255,255,0.04)";
      c.lineWidth = 1;
      for (let x = 0; x <= COLS; x++) {
        c.beginPath();
        c.moveTo(ox + x * cell, oy);
        c.lineTo(ox + x * cell, oy + wellH);
        c.stroke();
      }
      for (let y = 0; y <= ROWS; y++) {
        c.beginPath();
        c.moveTo(ox, oy + y * cell);
        c.lineTo(ox + wellW, oy + y * cell);
        c.stroke();
      }

      const drawCell = (gx: number, gy: number, color: string, shadow: string, inset = 0.06) => {
        if (gy < 0) return;
        const x = ox + gx * cell;
        const y = oy + gy * cell;
        const i = cell * inset;
        c.fillStyle = shadow;
        roundRect(c, x + 1, y + 1, cell - 2, cell - 2, cell * 0.18);
        c.fill();
        c.fillStyle = color;
        roundRect(c, x + 1 + i, y + 1 + i, cell - 2 - i * 2, cell - 2 - i * 2, cell * 0.16);
        c.fill();
        // gloss
        c.fillStyle = "rgba(255,255,255,0.16)";
        roundRect(c, x + 1 + i, y + 1 + i, cell - 2 - i * 2, (cell - 2 - i * 2) * 0.4, cell * 0.16);
        c.fill();
      };

      // settled cells
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) {
          const v = board[y][x];
          if (v !== 0) {
            const def = PIECES[v - 1];
            drawCell(x, y, def.color, def.shadow);
          }
        }

      // line clear flash
      if (clearRows.length > 0) {
        const a = clamp(clearT / 0.18, 0, 1);
        c.fillStyle = `rgba(255,255,255,${0.2 + 0.6 * a})`;
        for (const ry of clearRows) c.fillRect(ox, oy + ry * cell, wellW, cell);
      }

      if (!dead && clearRows.length === 0) {
        const def = PIECES[active.type];
        // ghost
        const gy = ghostY();
        for (const [cx, cy] of cellsOf(active.type, active.rot)) {
          const x = ox + (active.x + cx) * cell;
          const y = oy + (gy + cy) * cell;
          if (gy + cy < 0) continue;
          c.strokeStyle = def.color;
          c.globalAlpha = 0.35;
          c.lineWidth = 2;
          roundRect(c, x + 2, y + 2, cell - 4, cell - 4, cell * 0.16);
          c.stroke();
          c.globalAlpha = 1;
        }
        // active piece
        for (const [cx, cy] of cellsOf(active.type, active.rot)) {
          drawCell(active.x + cx, active.y + cy, def.color, def.shadow);
        }
      }

      // ---- side panel ----
      const fs = cell * 0.5;
      let py = oy;

      const miniBox = (label: string, type: number | null, boxY: number, boxH: number) => {
        drawText(c, label, px, boxY, fs * 0.8, "#8893c4", "left");
        const top = boxY + fs * 0.9;
        c.fillStyle = "#0a0f1f";
        roundRect(c, px, top, panelW, boxH, 8);
        c.fill();
        if (type !== null) {
          const def = PIECES[type];
          const cells = def.cells[0];
          let minX = 99, minY = 99, maxX = -99, maxY = -99;
          for (const [cx, cy] of cells) {
            minX = Math.min(minX, cx); minY = Math.min(minY, cy);
            maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy);
          }
          const pw = maxX - minX + 1;
          const ph = maxY - minY + 1;
          const mc = Math.min((panelW - 12) / pw, (boxH - 12) / ph, cell * 0.78);
          const startX = px + (panelW - pw * mc) / 2 - minX * mc;
          const startY = top + (boxH - ph * mc) / 2 - minY * mc;
          for (const [cx, cy] of cells) {
            const x = startX + cx * mc;
            const y = startY + cy * mc;
            c.fillStyle = def.shadow;
            roundRect(c, x + 1, y + 1, mc - 2, mc - 2, mc * 0.18);
            c.fill();
            c.fillStyle = def.color;
            roundRect(c, x + 2, y + 2, mc - 4, mc - 4, mc * 0.16);
            c.fill();
          }
        }
        return top + boxH + fs * 0.7;
      };

      const previewH = cell * 2.4;
      py = miniBox("HOLD", hold, py, previewH);
      py = miniBox("NEXT", nextQueue[0] ?? null, py, previewH);

      // stats
      drawText(c, "SCORE", px, py, fs * 0.8, "#8893c4", "left");
      drawText(c, String(score), px, py + fs * 0.95, fs, "#fff", "left");
      py += fs * 2.1;
      drawText(c, "BEST", px, py, fs * 0.8, "#8893c4", "left");
      drawText(c, String(best), px, py + fs * 0.95, fs * 0.9, "#cfe", "left");
      py += fs * 2.1;
      drawText(c, "LEVEL", px, py, fs * 0.8, "#8893c4", "left");
      drawText(c, String(level), px, py + fs * 0.95, fs * 0.9, "#fff", "left");
      py += fs * 2.1;
      drawText(c, "LINES", px, py, fs * 0.8, "#8893c4", "left");
      drawText(c, String(lines), px, py + fs * 0.95, fs * 0.9, "#fff", "left");

      if (dead) {
        c.fillStyle = "rgba(0,0,0,0.6)";
        c.fillRect(ox - 4, oy - 4, wellW + 8, wellH + 8);
        drawText(c, "GAME OVER", ox + wellW / 2, oy + wellH / 2, cell * 1.1, "#fff");
      }
    },
  };
}
