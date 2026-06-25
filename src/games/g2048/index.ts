import type { GameContext, GameInstance } from "@/engine";
import { drawText, roundRect } from "@/engine";

const SIZE = 4;

const COLORS: Record<number, [string, string]> = {
  2: ["#eee4da", "#776e65"],
  4: ["#ede0c8", "#776e65"],
  8: ["#f2b179", "#fff"],
  16: ["#f59563", "#fff"],
  32: ["#f67c5f", "#fff"],
  64: ["#f65e3b", "#fff"],
  128: ["#edcf72", "#fff"],
  256: ["#edcc61", "#fff"],
  512: ["#edc850", "#fff"],
  1024: ["#edc53f", "#fff"],
  2048: ["#edc22e", "#fff"],
};

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;
  let grid: number[][] = [];
  let score = 0;
  let best = ctx.storage.get("__best", 0);
  let won = false;
  let dead = false;
  let pop: { r: number; col: number; t: number }[] = [];
  let startPos: { x: number; y: number } | null = null;

  const empty = () =>
    Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));

  const spawn = () => {
    const cells: [number, number][] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (grid[r][c] === 0) cells.push([r, c]);
    if (!cells.length) return;
    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    pop.push({ r, col: c, t: 0 });
  };

  const reset = () => {
    grid = empty();
    score = 0;
    won = false;
    dead = false;
    pop = [];
    spawn();
    spawn();
  };
  reset();
  ctx.setStatus("Arrow keys or swipe to merge tiles");
  ctx.requestControls([{ type: "dpad" }]);

  const slideRow = (row: number[]): { row: number[]; gained: number; moved: boolean } => {
    const nums = row.filter((n) => n !== 0);
    let gained = 0;
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] === nums[i + 1]) {
        nums[i] *= 2;
        gained += nums[i];
        if (nums[i] === 2048) won = true;
        nums.splice(i + 1, 1);
      }
    }
    while (nums.length < SIZE) nums.push(0);
    const moved = nums.some((n, i) => n !== row[i]);
    return { row: nums, gained, moved };
  };

  const move = (dir: "L" | "R" | "U" | "D") => {
    if (dead) return;
    let moved = false;
    let gained = 0;
    const rotate = (g: number[][]) => {
      const n = empty();
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) n[c][SIZE - 1 - r] = g[r][c];
      return n;
    };
    let g = grid.map((r) => [...r]);
    const turns = dir === "L" ? 0 : dir === "U" ? 3 : dir === "R" ? 2 : 1;
    for (let i = 0; i < turns; i++) g = rotate(g);
    for (let r = 0; r < SIZE; r++) {
      const res = slideRow(g[r]);
      g[r] = res.row;
      gained += res.gained;
      if (res.moved) moved = true;
    }
    for (let i = 0; i < (4 - turns) % 4; i++) g = rotate(g);
    if (moved) {
      grid = g;
      score += gained;
      if (gained) audio.blip();
      if (score > best) {
        best = score;
      }
      ctx.reportScore(score);
      spawn();
      if (isGameOver()) {
        dead = true;
        audio.lose();
        setTimeout(() => ctx.gameOver(score), 400);
      }
    }
  };

  const isGameOver = (): boolean => {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) return false;
        if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return false;
        if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return false;
      }
    return true;
  };

  return {
    update(dt) {
      if (input.pressed("ArrowLeft", "a")) move("L");
      if (input.pressed("ArrowRight", "d")) move("R");
      if (input.pressed("ArrowUp", "w")) move("U");
      if (input.pressed("ArrowDown", "s")) move("D");

      if (input.pointer.justDown) startPos = { x: input.pointer.x, y: input.pointer.y };
      if (input.pointer.justUp && startPos) {
        const dx = input.pointer.x - startPos.x;
        const dy = input.pointer.y - startPos.y;
        const min = ctx.width * 0.06;
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > min) move("R");
          else if (dx < -min) move("L");
        } else {
          if (dy > min) move("D");
          else if (dy < -min) move("U");
        }
        startPos = null;
      }

      for (const p of pop) p.t += dt * 6;
      pop = pop.filter((p) => p.t < 1);
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      c.fillStyle = "#0f1320";
      c.fillRect(0, 0, W, H);

      const pad = Math.min(W, H) * 0.04;
      const boardSize = Math.min(W, H) - pad * 2;
      const ox = (W - boardSize) / 2;
      const oy = (H - boardSize) / 2;
      const gap = boardSize * 0.025;
      const cell = (boardSize - gap * (SIZE + 1)) / SIZE;

      // header score
      drawText(c, `Score ${score}`, ox, oy - pad * 0.4, boardSize * 0.05, "#fff", "left");
      drawText(c, `Best ${best}`, ox + boardSize, oy - pad * 0.4, boardSize * 0.05, "#9aa4cf", "right");

      c.fillStyle = "#1b2233";
      roundRect(c, ox, oy, boardSize, boardSize, 10);
      c.fill();

      for (let r = 0; r < SIZE; r++)
        for (let col = 0; col < SIZE; col++) {
          const x = ox + gap + col * (cell + gap);
          const y = oy + gap + r * (cell + gap);
          const v = grid[r][col];
          if (v === 0) {
            c.fillStyle = "#252e44";
            roundRect(c, x, y, cell, cell, 8);
            c.fill();
            continue;
          }
          const [bg, fg] = COLORS[v] ?? ["#3c3a32", "#fff"];
          const popping = pop.find((p) => p.r === r && p.col === col);
          const s = popping ? 0.5 + 0.5 * Math.min(1, popping.t) : 1;
          const cs = cell * s;
          const off = (cell - cs) / 2;
          c.fillStyle = bg;
          roundRect(c, x + off, y + off, cs, cs, 8);
          c.fill();
          const fontSize = cell * (v >= 1024 ? 0.3 : v >= 128 ? 0.36 : 0.42);
          drawText(c, String(v), x + cell / 2, y + cell / 2, fontSize, fg);
        }
    },
  };
}
