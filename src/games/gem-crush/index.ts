import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, rng, roundRect } from "@/engine";

const COLS = 8;
const ROWS = 8;
const TYPES = 6;
const START_MOVES = 30;

const GEM_COLORS = ["#ff4d6d", "#ff9f45", "#ffd84d", "#3ddc84", "#4d96ff", "#c061ff"];

type Cell = { r: number; c: number };
type State = "idle" | "swap" | "swapback" | "clear" | "fall" | "over";

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  const type: number[][] = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  const fall: number[][] = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  const clearMark: boolean[][] = Array.from({ length: ROWS }, () =>
    Array<boolean>(COLS).fill(false),
  );

  let state: State = "idle";
  let score = 0;
  let movesLeft = START_MOVES;
  let combo = 0;
  let ended = false;

  let selected: Cell | null = null;
  let dragStart: { x: number; y: number; r: number; c: number } | null = null;

  // transient feedback
  let comboShow = 0;
  let comboShowT = 0;
  let toast = "";
  let toastT = 0;

  // swap animation
  let swapA: Cell = { r: 0, c: 0 };
  let swapB: Cell = { r: 0, c: 0 };
  let swapValid = false;
  let swapProgress = 0;
  const SWAP_DUR = 0.13;

  // clear animation
  let clearProgress = 0;
  const CLEAR_DUR = 0.18;

  // fall animation
  let fallSpeed = 0;

  const inBounds = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const randGem = () => rng.int(0, TYPES - 1);

  const swapTypes = (a: Cell, b: Cell) => {
    const t = type[a.r][a.c];
    type[a.r][a.c] = type[b.r][b.c];
    type[b.r][b.c] = t;
  };

  const findMatches = (): boolean[][] => {
    const mark = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
    for (let r = 0; r < ROWS; r++) {
      let run = 1;
      for (let c = 1; c <= COLS; c++) {
        if (c < COLS && type[r][c] !== -1 && type[r][c] === type[r][c - 1]) run++;
        else {
          if (run >= 3) for (let k = c - run; k < c; k++) mark[r][k] = true;
          run = 1;
        }
      }
    }
    for (let c = 0; c < COLS; c++) {
      let run = 1;
      for (let r = 1; r <= ROWS; r++) {
        if (r < ROWS && type[r][c] !== -1 && type[r][c] === type[r - 1][c]) run++;
        else {
          if (run >= 3) for (let k = r - run; k < r; k++) mark[k][c] = true;
          run = 1;
        }
      }
    }
    return mark;
  };

  const anyTrue = (m: boolean[][]) => m.some((row) => row.some((v) => v));

  const hasMove = (): boolean => {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (c + 1 < COLS) {
          swapTypes({ r, c }, { r, c: c + 1 });
          const ok = anyTrue(findMatches());
          swapTypes({ r, c }, { r, c: c + 1 });
          if (ok) return true;
        }
        if (r + 1 < ROWS) {
          swapTypes({ r, c }, { r: r + 1, c });
          const ok = anyTrue(findMatches());
          swapTypes({ r, c }, { r: r + 1, c });
          if (ok) return true;
        }
      }
    return false;
  };

  const fillFresh = () => {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        let g = randGem();
        let guard = 0;
        while (
          guard++ < 40 &&
          ((c >= 2 && type[r][c - 1] === g && type[r][c - 2] === g) ||
            (r >= 2 && type[r - 1][c] === g && type[r - 2][c] === g))
        ) {
          g = randGem();
        }
        type[r][c] = g;
        fall[r][c] = 0;
      }
  };

  const buildBoard = () => {
    do {
      fillFresh();
    } while (anyTrue(findMatches()) || !hasMove());
  };

  buildBoard();

  ctx.requestControls([]);
  const updateStatus = () => ctx.setStatus(`Moves ${movesLeft}   Score ${score}`);
  updateStatus();

  // ---- geometry (recomputed every frame for responsive sizing) ----
  const geom = () => {
    const W = ctx.width;
    const H = ctx.height;
    const hud = Math.min(H * 0.12, 90);
    const avail = Math.min(W * 0.96, (H - hud) * 0.98);
    const cell = avail / COLS;
    const boardW = cell * COLS;
    const ox = (W - boardW) / 2;
    const oy = hud + (H - hud - boardW) / 2;
    return { ox, oy, cell, hud };
  };

  const cellAt = (x: number, y: number): Cell | null => {
    const { ox, oy, cell } = geom();
    const c = Math.floor((x - ox) / cell);
    const r = Math.floor((y - oy) / cell);
    if (!inBounds(r, c)) return null;
    return { r, c };
  };

  const adjacent = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  const beginSwap = (a: Cell, b: Cell) => {
    if (state !== "idle" || !inBounds(b.r, b.c)) return;
    swapTypes(a, b);
    swapValid = anyTrue(findMatches());
    swapTypes(a, b);
    swapA = a;
    swapB = b;
    swapProgress = 0;
    state = "swap";
    audio.blip();
  };

  const resolve = () => {
    const mark = findMatches();
    if (!anyTrue(mark)) {
      state = "idle";
      combo = 0;
      if (movesLeft <= 0) {
        finish();
        return;
      }
      if (!hasMove()) {
        // no moves left on the board: reshuffle
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) type[r][c] = randGem();
        if (anyTrue(findMatches()) || !hasMove()) buildBoard();
        toast = "No moves — shuffling!";
        toastT = 1.4;
        audio.tone(420, 0.12, "triangle", 0.3);
      }
      return;
    }
    combo++;
    if (combo >= 2) {
      comboShow = combo;
      comboShowT = 0.9;
    }
    let cleared = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        clearMark[r][c] = mark[r][c];
        if (mark[r][c]) cleared++;
      }
    score += cleared * 10 * combo;
    ctx.reportScore(score);
    if (combo > 1) audio.coin();
    else audio.blip();
    clearProgress = 0;
    state = "clear";
  };

  const collapse = () => {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (type[r][c] !== -1) {
          if (write !== r) {
            type[write][c] = type[r][c];
            fall[write][c] = write - r;
            type[r][c] = -1;
          }
          write--;
        }
      }
      const need = write + 1;
      for (let r = write; r >= 0; r--) {
        type[r][c] = randGem();
        fall[r][c] = need;
      }
    }
    fallSpeed = 9;
    state = "fall";
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    state = "over";
    audio.win();
    window.setTimeout(() => ctx.gameOver(score), 900);
  };

  const handleInput = () => {
    if (state !== "idle") return;
    if (input.pointer.justDown) {
      const cell = cellAt(input.pointer.x, input.pointer.y);
      dragStart = cell
        ? { x: input.pointer.x, y: input.pointer.y, r: cell.r, c: cell.c }
        : null;
    }
    if (input.pointer.justUp && dragStart) {
      const { cell } = geom();
      const dx = input.pointer.x - dragStart.x;
      const dy = input.pointer.y - dragStart.y;
      const start: Cell = { r: dragStart.r, c: dragStart.c };
      const thresh = cell * 0.4;
      if (Math.abs(dx) > thresh || Math.abs(dy) > thresh) {
        let target: Cell;
        if (Math.abs(dx) > Math.abs(dy)) target = { r: start.r, c: start.c + (dx > 0 ? 1 : -1) };
        else target = { r: start.r + (dy > 0 ? 1 : -1), c: start.c };
        selected = null;
        beginSwap(start, target);
      } else {
        // tap
        if (!selected) selected = start;
        else if (selected.r === start.r && selected.c === start.c) selected = null;
        else if (adjacent(selected, start)) {
          const a = selected;
          selected = null;
          beginSwap(a, start);
        } else selected = start;
      }
      dragStart = null;
    }
  };

  return {
    update(dt) {
      if (comboShowT > 0) comboShowT = Math.max(0, comboShowT - dt);
      if (toastT > 0) toastT = Math.max(0, toastT - dt);
      if (state === "over") return;
      handleInput();

      if (state === "swap" || state === "swapback") {
        swapProgress += dt / SWAP_DUR;
        if (swapProgress >= 1) {
          if (state === "swap") {
            if (swapValid) {
              swapTypes(swapA, swapB);
              combo = 0;
              movesLeft--;
              updateStatus();
              resolve();
            } else {
              swapProgress = 0;
              state = "swapback";
              audio.tone(180, 0.12, "sawtooth", 0.25);
            }
          } else {
            state = "idle";
          }
        }
      } else if (state === "clear") {
        clearProgress += dt / CLEAR_DUR;
        if (clearProgress >= 1) {
          for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) {
              if (clearMark[r][c]) {
                type[r][c] = -1;
                clearMark[r][c] = false;
              }
            }
          collapse();
        }
      } else if (state === "fall") {
        fallSpeed += 60 * dt;
        let moving = false;
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            if (fall[r][c] > 0) {
              fall[r][c] = Math.max(0, fall[r][c] - fallSpeed * dt);
              if (fall[r][c] > 0) moving = true;
            }
          }
        if (!moving) {
          audio.tone(330, 0.05, "square", 0.18);
          resolve();
        }
      } else if (state === "idle") {
        if (movesLeft <= 0) finish();
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#161029");
      grad.addColorStop(1, "#0c0a1a");
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      const { ox, oy, cell, hud } = geom();

      // HUD
      drawText(c, "GEM CRUSH", W / 2, hud * 0.32, Math.min(hud * 0.42, 32), "#e9defb");
      drawText(c, `Moves ${movesLeft}`, ox, hud * 0.78, Math.min(hud * 0.32, 24), "#ffd84d", "left");
      drawText(
        c,
        `Score ${score}`,
        ox + cell * COLS,
        hud * 0.78,
        Math.min(hud * 0.32, 24),
        "#7fd0ff",
        "right",
      );

      // board background
      c.fillStyle = "rgba(255,255,255,0.04)";
      roundRect(c, ox - 6, oy - 6, cell * COLS + 12, cell * ROWS + 12, 14);
      c.fill();

      // grid cells
      for (let r = 0; r < ROWS; r++)
        for (let col = 0; col < COLS; col++) {
          c.fillStyle = (r + col) % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.12)";
          c.fillRect(ox + col * cell, oy + r * cell, cell, cell);
        }

      // selection highlight
      if (selected) {
        c.strokeStyle = "#ffffff";
        c.lineWidth = Math.max(2, cell * 0.06);
        roundRect(
          c,
          ox + selected.c * cell + cell * 0.06,
          oy + selected.r * cell + cell * 0.06,
          cell * 0.88,
          cell * 0.88,
          cell * 0.18,
        );
        c.stroke();
      }

      const swapping = state === "swap" || state === "swapback";
      const f = clamp(swapProgress, 0, 1);

      for (let r = 0; r < ROWS; r++)
        for (let col = 0; col < COLS; col++) {
          const t = type[r][col];
          if (t === -1) continue;
          let cx = ox + col * cell + cell / 2;
          let cy = oy + (r - fall[r][col]) * cell + cell / 2;
          let s = 1;

          if (state === "clear" && clearMark[r][col]) s = 1 - clamp(clearProgress, 0, 1);

          if (swapping) {
            const isA = swapA.r === r && swapA.c === col;
            const isB = swapB.r === r && swapB.c === col;
            if (isA || isB) {
              const from = isA ? swapA : swapB;
              const to = isA ? swapB : swapA;
              const ax = ox + from.c * cell + cell / 2;
              const ay = oy + from.r * cell + cell / 2;
              const bxp = ox + to.c * cell + cell / 2;
              const byp = oy + to.r * cell + cell / 2;
              const ff = state === "swapback" ? 1 - f : f;
              cx = ax + (bxp - ax) * ff;
              cy = ay + (byp - ay) * ff;
            }
          }

          drawGem(c, t, cx, cy, cell * 0.4 * s);
        }

      // combo popup
      if (comboShowT > 0) {
        const p = comboShowT / 0.9;
        const fade = clamp(p, 0, 1);
        const rise = (1 - p) * cell * 0.6;
        c.globalAlpha = fade;
        drawText(
          c,
          `COMBO x${comboShow}`,
          ox + cell * COLS * 0.5,
          oy + cell * ROWS * 0.5 - rise,
          Math.min(cell * 0.9, 44),
          "#ffd84d",
        );
        c.globalAlpha = 1;
      }

      // transient toast (e.g. board shuffle)
      if (toastT > 0) {
        c.globalAlpha = clamp(toastT, 0, 1);
        const ty = oy + cell * ROWS + Math.min(28, (H - (oy + cell * ROWS)) * 0.5);
        drawText(c, toast, W / 2, ty, Math.min(cell * 0.45, 22), "#9be7ff");
        c.globalAlpha = 1;
      }

      if (state === "over") {
        c.fillStyle = "rgba(10,8,20,0.6)";
        c.fillRect(0, 0, W, H);
        drawText(c, "OUT OF MOVES", W / 2, H * 0.45, Math.min(H * 0.07, W * 0.09), "#ffd84d");
        drawText(c, `Score ${score}`, W / 2, H * 0.55, Math.min(H * 0.05, W * 0.07), "#fff");
      }
    },
  };
}

function drawGem(c: CanvasRenderingContext2D, t: number, x: number, y: number, r: number) {
  if (r <= 0) return;
  const color = GEM_COLORS[t];
  c.save();
  c.translate(x, y);
  c.fillStyle = color;
  c.strokeStyle = "rgba(255,255,255,0.35)";
  c.lineWidth = Math.max(1, r * 0.08);
  c.beginPath();
  switch (t) {
    case 0: // circle
      c.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 1: // rounded square
      roundRect(c, -r * 0.85, -r * 0.85, r * 1.7, r * 1.7, r * 0.3);
      break;
    case 2: // triangle
      c.moveTo(0, -r);
      c.lineTo(r * 0.92, r * 0.7);
      c.lineTo(-r * 0.92, r * 0.7);
      c.closePath();
      break;
    case 3: // diamond
      c.moveTo(0, -r);
      c.lineTo(r, 0);
      c.lineTo(0, r);
      c.lineTo(-r, 0);
      c.closePath();
      break;
    case 4: // hexagon
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      break;
    default: {
      // 5: five-pointed star
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
    }
  }
  c.fill();
  c.stroke();
  // glossy highlight
  c.fillStyle = "rgba(255,255,255,0.4)";
  c.beginPath();
  c.ellipse(-r * 0.3, -r * 0.35, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
