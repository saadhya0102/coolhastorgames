import type { GameContext, GameInstance } from "@/engine";
import { drawText, roundRect } from "@/engine";

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;
  const COLS = 20;
  const ROWS = 20;

  type P = { x: number; y: number };
  let snake: P[] = [];
  let dir: P = { x: 1, y: 0 };
  let nextDir: P = { x: 1, y: 0 };
  let food: P = { x: 0, y: 0 };
  let score = 0;
  let stepT = 0;
  let stepEvery = 0.13;
  let dead = false;
  let started = false;
  let startPos: { x: number; y: number } | null = null;

  let won = false;

  const placeFood = () => {
    // Gather free cells so a full board (a win) can't spin forever.
    const free: P[] = [];
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    if (free.length === 0) {
      won = true;
      audio.win();
      setTimeout(() => ctx.gameOver(score), 300);
      return;
    }
    food = free[(Math.random() * free.length) | 0];
  };

  const reset = () => {
    snake = [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    stepEvery = 0.13;
    dead = false;
    won = false;
    started = false;
    placeFood();
  };
  reset();
  ctx.setStatus("Arrow keys / swipe to move");
  ctx.requestControls([{ type: "dpad" }]);

  const turn = (x: number, y: number) => {
    if (dir.x === -x && dir.y === -y) return; // no 180
    nextDir = { x, y };
    started = true;
  };

  const step = () => {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) return die();
    if (snake.some((s) => s.x === head.x && s.y === head.y)) return die();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      ctx.reportScore(score);
      audio.coin();
      stepEvery = Math.max(0.06, stepEvery - 0.004);
      placeFood();
    } else {
      snake.pop();
    }
  };

  const die = () => {
    if (dead) return;
    dead = true;
    audio.hit();
    setTimeout(() => ctx.gameOver(score), 300);
  };

  return {
    update(dt) {
      if (input.pressed("ArrowLeft", "a")) turn(-1, 0);
      if (input.pressed("ArrowRight", "d")) turn(1, 0);
      if (input.pressed("ArrowUp", "w")) turn(0, -1);
      if (input.pressed("ArrowDown", "s")) turn(0, 1);

      if (input.pointer.justDown) startPos = { x: input.pointer.x, y: input.pointer.y };
      if (input.pointer.justUp && startPos) {
        const dx = input.pointer.x - startPos.x;
        const dy = input.pointer.y - startPos.y;
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
          if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
          else turn(0, dy > 0 ? 1 : -1);
        }
        startPos = null;
      }

      if (!started || dead || won) return;
      stepT += dt;
      while (stepT >= stepEvery) {
        stepT -= stepEvery;
        step();
        if (dead) break;
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      c.fillStyle = "#0c1019";
      c.fillRect(0, 0, W, H);

      const size = Math.min(W, H) * 0.94;
      const ox = (W - size) / 2;
      const oy = (H - size) / 2;
      const cell = size / COLS;

      // board
      c.fillStyle = "#0a1626";
      roundRect(c, ox, oy, size, cell * ROWS, 8);
      c.fill();
      // grid dots
      c.fillStyle = "rgba(255,255,255,0.03)";
      for (let x = 0; x < COLS; x++)
        for (let y = 0; y < ROWS; y++)
          if ((x + y) % 2 === 0) c.fillRect(ox + x * cell, oy + y * cell, cell, cell);

      // food
      c.fillStyle = "#ff5c8a";
      c.beginPath();
      c.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
      c.fill();

      // snake
      snake.forEach((s, i) => {
        const x = ox + s.x * cell;
        const y = oy + s.y * cell;
        const t = i / snake.length;
        c.fillStyle = i === 0 ? "#46e0a0" : `hsl(${155 - t * 30}, 70%, ${55 - t * 18}%)`;
        roundRect(c, x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.25);
        c.fill();
        if (i === 0) {
          c.fillStyle = "#0c1019";
          const ex = cell * 0.22;
          c.beginPath();
          c.arc(x + cell / 2 - ex * dir.y + dir.x * ex, y + cell / 2 - ex * dir.x + dir.y * ex, cell * 0.08, 0, 7);
          c.arc(x + cell / 2 + ex * dir.y + dir.x * ex, y + cell / 2 + ex * dir.x + dir.y * ex, cell * 0.08, 0, 7);
          c.fill();
        }
      });

      drawText(c, `Score ${score}`, ox + 4, oy - cell * 0.5, size * 0.05, "#fff", "left");
      if (!started) drawText(c, "Swipe / arrows to start", W / 2, H / 2, size * 0.05, "rgba(255,255,255,0.6)");
    },
  };
}
