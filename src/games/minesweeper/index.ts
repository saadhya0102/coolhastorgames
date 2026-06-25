import type { GameContext, GameInstance } from "@/engine";
import { dist, drawText, pointInRect, roundRect } from "@/engine";

type State = "menu" | "playing" | "won" | "lost";
interface Diff {
  label: string;
  cols: number;
  rows: number;
  mines: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DIFFS: Diff[] = [
  { label: "Easy", cols: 9, rows: 9, mines: 10 },
  { label: "Medium", cols: 16, rows: 16, mines: 40 },
];

const NUM_COLORS = [
  "",
  "#1976d2",
  "#388e3c",
  "#d32f2f",
  "#7b1fa2",
  "#ff8f00",
  "#0097a7",
  "#37474f",
  "#9e9e9e",
];

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  let state: State = "menu";
  let cols = 9;
  let rows = 9;
  let mineCount = 10;

  let mine: boolean[][] = [];
  let revealed: boolean[][] = [];
  let flagged: boolean[][] = [];
  let count: number[][] = [];
  let exploded: { r: number; c: number } | null = null;

  let minesPlaced = false;
  let revealedCount = 0;
  let flagsCount = 0;
  let flagMode = false;
  let startTime = 0;
  let elapsedMs = 0;
  let ended = false;
  let lastStatusSec = -1;

  // touch / mouse press tracking
  let pressStart = 0;
  let pressPos = { x: 0, y: 0 };
  let pressCell: { r: number; c: number } | null = null;
  let longHandled = false;
  let pressedButton = false;
  let ignoreUp = false;
  let pendingRightFlag: { x: number; y: number } | null = null;

  ctx.requestControls([]);
  ctx.setStatus("Minesweeper — choose a difficulty");

  // ---- custom listeners for right-click / context menu ----
  const listeners: Array<[EventTarget, string, EventListener]> = [];
  const addListener = (t: EventTarget, type: string, fn: EventListener) => {
    t.addEventListener(type, fn);
    listeners.push([t, type, fn]);
  };
  addListener(ctx.canvas, "contextmenu", ((e: Event) => e.preventDefault()) as EventListener);
  addListener(ctx.canvas, "pointerdown", ((e: Event) => {
    const pe = e as PointerEvent;
    if (pe.button === 2 && state === "playing") {
      pendingRightFlag = { x: input.pointer.x, y: input.pointer.y };
      ignoreUp = true;
    }
  }) as EventListener);

  const make2D = <T>(v: T): T[][] =>
    Array.from({ length: rows }, () => Array<T>(cols).fill(v));

  const startGame = (d: Diff) => {
    cols = d.cols;
    rows = d.rows;
    mineCount = d.mines;
    mine = make2D(false);
    revealed = make2D(false);
    flagged = make2D(false);
    count = make2D(0);
    exploded = null;
    minesPlaced = false;
    revealedCount = 0;
    flagsCount = 0;
    flagMode = false;
    elapsedMs = 0;
    ended = false;
    lastStatusSec = -1;
    state = "playing";
    audio.blip();
    updateStatus();
  };

  const updateStatus = () => {
    if (state === "menu") {
      ctx.setStatus("Minesweeper — choose a difficulty");
    } else {
      ctx.setStatus(`Mines left: ${mineCount - flagsCount}   Time: ${Math.floor(elapsedMs / 1000)}s`);
    }
  };

  const neighbors = (r: number, c: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push([nr, nc]);
      }
    return out;
  };

  const placeMines = (safeR: number, safeC: number) => {
    const banned = new Set<number>();
    banned.add(safeR * cols + safeC);
    for (const [nr, nc] of neighbors(safeR, safeC)) banned.add(nr * cols + nc);
    let placed = 0;
    const maxMines = Math.min(mineCount, rows * cols - banned.size);
    while (placed < maxMines) {
      const idx = Math.floor(Math.random() * rows * cols);
      if (banned.has(idx)) continue;
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      if (mine[r][c]) continue;
      mine[r][c] = true;
      placed++;
    }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let n = 0;
        for (const [nr, nc] of neighbors(r, c)) if (mine[nr][nc]) n++;
        count[r][c] = n;
      }
    minesPlaced = true;
    startTime = performance.now();
  };

  const reveal = (r: number, c: number) => {
    if (revealed[r][c] || flagged[r][c]) return;
    if (!minesPlaced) placeMines(r, c);
    if (mine[r][c]) {
      revealed[r][c] = true;
      exploded = { r, c };
      lose();
      return;
    }
    const stack: Array<[number, number]> = [[r, c]];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) break;
      const [cr, cc] = cur;
      if (revealed[cr][cc] || flagged[cr][cc] || mine[cr][cc]) continue;
      revealed[cr][cc] = true;
      revealedCount++;
      if (count[cr][cc] === 0) {
        for (const [nr, nc] of neighbors(cr, cc)) {
          if (!revealed[nr][nc] && !flagged[nr][nc]) stack.push([nr, nc]);
        }
      }
    }
    audio.tone(520, 0.04, "square", 0.18);
    if (revealedCount === rows * cols - mineCount) win();
  };

  const toggleFlag = (r: number, c: number) => {
    if (revealed[r][c]) return;
    flagged[r][c] = !flagged[r][c];
    flagsCount += flagged[r][c] ? 1 : -1;
    audio.blip();
    updateStatus();
  };

  const lose = () => {
    if (ended) return;
    ended = true;
    state = "lost";
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (mine[r][c]) revealed[r][c] = true;
    audio.explosion();
    window.setTimeout(() => ctx.gameOver(), 1200);
  };

  const win = () => {
    if (ended) return;
    ended = true;
    state = "won";
    elapsedMs = performance.now() - startTime;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (mine[r][c] && !flagged[r][c]) {
          flagged[r][c] = true;
          flagsCount++;
        }
    updateStatus();
    audio.win();
    const ms = Math.round(elapsedMs);
    window.setTimeout(() => ctx.gameOver(ms), 1200);
  };

  // ---- geometry ----
  const hudH = () => Math.min(ctx.height * 0.1, 70);
  const boardGeom = () => {
    const W = ctx.width;
    const H = ctx.height;
    const hud = hudH();
    const cell = Math.min((W * 0.98) / cols, ((H - hud) * 0.98) / rows);
    const boardW = cell * cols;
    const boardH = cell * rows;
    const ox = (W - boardW) / 2;
    const oy = hud + (H - hud - boardH) / 2;
    return { ox, oy, cell, hud };
  };

  const flagBtnRect = (): Rect => {
    const W = ctx.width;
    const hud = hudH();
    const w = Math.min(W * 0.32, 170);
    const h = hud * 0.72;
    return { x: W / 2 - w / 2, y: (hud - h) / 2, w, h };
  };

  const cellAt = (x: number, y: number): { r: number; c: number } | null => {
    const { ox, oy, cell } = boardGeom();
    const c = Math.floor((x - ox) / cell);
    const r = Math.floor((y - oy) / cell);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    return { r, c };
  };

  const menuButtons = (): Array<Rect & { diff: Diff }> => {
    const W = ctx.width;
    const H = ctx.height;
    const bw = Math.min(W * 0.6, 320);
    const bh = Math.min(H * 0.13, 80);
    const gap = bh * 0.4;
    return DIFFS.map((d, i) => ({
      x: W / 2 - bw / 2,
      y: H * 0.42 + i * (bh + gap),
      w: bw,
      h: bh,
      diff: d,
    }));
  };

  const handlePlayingInput = () => {
    const { cell } = boardGeom();
    const btn = flagBtnRect();

    if (pendingRightFlag) {
      const cAt = cellAt(pendingRightFlag.x, pendingRightFlag.y);
      if (cAt) toggleFlag(cAt.r, cAt.c);
      pendingRightFlag = null;
    }

    if (input.pointer.justDown) {
      if (pointInRect(input.pointer.x, input.pointer.y, btn)) {
        pressedButton = true;
      } else {
        pressedButton = false;
        pressStart = performance.now();
        pressPos = { x: input.pointer.x, y: input.pointer.y };
        pressCell = cellAt(input.pointer.x, input.pointer.y);
        longHandled = false;
      }
    }

    // long-press to flag (touch)
    if (input.pointer.down && !pressedButton && !longHandled && pressCell) {
      const moved = dist(input.pointer.x, input.pointer.y, pressPos.x, pressPos.y);
      if (performance.now() - pressStart > 450 && moved < cell * 0.5) {
        toggleFlag(pressCell.r, pressCell.c);
        longHandled = true;
        ignoreUp = true;
      }
    }

    if (input.pointer.justUp) {
      if (pressedButton) {
        pressedButton = false;
        if (pointInRect(input.pointer.x, input.pointer.y, btn)) {
          flagMode = !flagMode;
          audio.blip();
        }
        return;
      }
      if (ignoreUp) {
        ignoreUp = false;
        return;
      }
      const cAt = cellAt(input.pointer.x, input.pointer.y);
      if (!cAt) return;
      if (flagMode) toggleFlag(cAt.r, cAt.c);
      else if (!flagged[cAt.r][cAt.c]) reveal(cAt.r, cAt.c);
    }

    // keyboard: F toggles flag mode
    if (input.pressed("f")) {
      flagMode = !flagMode;
      audio.blip();
    }
  };

  return {
    update() {
      if (state === "menu") {
        if (input.pointer.justDown) {
          for (const b of menuButtons()) {
            if (pointInRect(input.pointer.x, input.pointer.y, b)) {
              startGame(b.diff);
              return;
            }
          }
        }
        if (input.pressed("1")) startGame(DIFFS[0]);
        if (input.pressed("2")) startGame(DIFFS[1]);
        return;
      }

      if (state === "playing") {
        handlePlayingInput();
        if (minesPlaced) {
          elapsedMs = performance.now() - startTime;
          // Only push HUD text when the visible second (or flag count) changes
          // to avoid re-rendering the surrounding portal every frame.
          const sec = Math.floor(elapsedMs / 1000);
          if (sec !== lastStatusSec) {
            lastStatusSec = sec;
            updateStatus();
          }
        }
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      c.fillStyle = "#1a2230";
      c.fillRect(0, 0, W, H);

      if (state === "menu") {
        drawText(c, "MINESWEEPER", W / 2, H * 0.26, Math.min(H * 0.08, W * 0.1), "#e8eef7");
        drawText(
          c,
          "Choose a difficulty",
          W / 2,
          H * 0.34,
          Math.min(H * 0.035, 22),
          "rgba(200,215,235,0.7)",
        );
        for (const b of menuButtons()) {
          c.fillStyle = b.diff.label === "Easy" ? "#3ddc84" : "#ff8f45";
          roundRect(c, b.x, b.y, b.w, b.h, 12);
          c.fill();
          drawText(
            c,
            `${b.diff.label}  (${b.diff.cols}\u00d7${b.diff.rows}, ${b.diff.mines})`,
            b.x + b.w / 2,
            b.y + b.h / 2,
            Math.min(b.h * 0.3, 24),
            "#0c141f",
          );
        }
        return;
      }

      const { ox, oy, cell, hud } = boardGeom();

      // HUD: mines remaining (left), timer (right), flag toggle (center)
      drawText(
        c,
        `\u{1F6A9} ${mineCount - flagsCount}`,
        ox,
        hud / 2,
        Math.min(hud * 0.4, 26),
        "#ff6b6b",
        "left",
      );
      drawText(
        c,
        `\u23F1 ${Math.floor(elapsedMs / 1000)}`,
        ox + cell * cols,
        hud / 2,
        Math.min(hud * 0.4, 26),
        "#ffe27a",
        "right",
      );
      const btn = flagBtnRect();
      c.fillStyle = flagMode ? "#ff6b6b" : "#33415c";
      roundRect(c, btn.x, btn.y, btn.w, btn.h, 10);
      c.fill();
      drawText(
        c,
        flagMode ? "\u{1F6A9} FLAG: ON" : "\u{1F6A9} FLAG: OFF",
        btn.x + btn.w / 2,
        btn.y + btn.h / 2,
        Math.min(btn.h * 0.4, 20),
        "#fff",
      );

      // board
      for (let r = 0; r < rows; r++)
        for (let col = 0; col < cols; col++) {
          const x = ox + col * cell;
          const y = oy + r * cell;
          const pad = Math.max(1, cell * 0.04);
          if (revealed[r][col]) {
            const isBoom = exploded && exploded.r === r && exploded.c === col;
            c.fillStyle = isBoom ? "#c0392b" : "#2c3850";
            c.fillRect(x, y, cell, cell);
            c.strokeStyle = "rgba(0,0,0,0.25)";
            c.lineWidth = 1;
            c.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
            if (mine[r][col]) {
              c.fillStyle = "#11161f";
              c.beginPath();
              c.arc(x + cell / 2, y + cell / 2, cell * 0.26, 0, Math.PI * 2);
              c.fill();
              c.fillStyle = "#fff";
              c.beginPath();
              c.arc(x + cell * 0.4, y + cell * 0.4, cell * 0.07, 0, Math.PI * 2);
              c.fill();
            } else if (count[r][col] > 0) {
              drawText(
                c,
                String(count[r][col]),
                x + cell / 2,
                y + cell / 2 + cell * 0.02,
                cell * 0.55,
                NUM_COLORS[count[r][col]],
              );
            }
          } else {
            // raised tile
            c.fillStyle = "#43546f";
            roundRect(c, x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.12);
            c.fill();
            c.fillStyle = "rgba(255,255,255,0.12)";
            roundRect(c, x + pad, y + pad, cell - pad * 2, (cell - pad * 2) * 0.45, cell * 0.12);
            c.fill();
            if (flagged[r][col]) {
              c.strokeStyle = "#cdd6e6";
              c.lineWidth = Math.max(1.5, cell * 0.06);
              c.beginPath();
              c.moveTo(x + cell * 0.5, y + cell * 0.22);
              c.lineTo(x + cell * 0.5, y + cell * 0.74);
              c.stroke();
              c.fillStyle = "#ff5252";
              c.beginPath();
              c.moveTo(x + cell * 0.5, y + cell * 0.24);
              c.lineTo(x + cell * 0.74, y + cell * 0.36);
              c.lineTo(x + cell * 0.5, y + cell * 0.48);
              c.closePath();
              c.fill();
            }
          }
        }

      if (state === "won" || state === "lost") {
        c.fillStyle = "rgba(15,20,30,0.55)";
        c.fillRect(0, 0, W, H);
        const msg = state === "won" ? "CLEARED!" : "BOOM!";
        const col = state === "won" ? "#3ddc84" : "#ff6b6b";
        drawText(c, msg, W / 2, H * 0.46, Math.min(H * 0.1, W * 0.12), col);
        if (state === "won") {
          drawText(
            c,
            `Time ${(elapsedMs / 1000).toFixed(2)}s`,
            W / 2,
            H * 0.56,
            Math.min(H * 0.05, W * 0.07),
            "#fff",
          );
        }
      }
    },

    destroy() {
      for (const [t, type, fn] of listeners) t.removeEventListener(type, fn);
      listeners.length = 0;
    },
  };
}
