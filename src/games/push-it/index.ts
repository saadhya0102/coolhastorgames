import type { GameContext, GameInstance } from "@/engine";
import { drawText, roundRect, clamp } from "@/engine";
import { LEVELS } from "./levels";

type Dir = "L" | "R" | "U" | "D";
interface Pt {
  x: number;
  y: number;
}

interface Snapshot {
  crates: string[];
  player: Pt;
  moves: number;
}

const k = (x: number, y: number) => `${x},${y}`;

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  let levelIndex = 0;
  let solvedCount = 0;
  let furthest = ctx.storage.get("furthest", 0);

  let gw = 0;
  let gh = 0;
  let walls: boolean[][] = [];
  let interior: boolean[][] = [];
  let targets = new Set<string>();
  let crates = new Set<string>();
  let player: Pt = { x: 0, y: 0 };
  let moves = 0;

  let undoStack: Snapshot[] = [];

  // animation
  const MOVE_TIME = 0.085;
  let animT = 0;
  let playerFrom: Pt = { x: 0, y: 0 };
  let crateAnim: { from: Pt; to: Pt } | null = null;

  // win transition
  let solved = false;
  let solveT = 0;
  let finished = false;

  // input repeat
  let heldDir: Dir | null = null;
  let repeatT = 0;
  const DAS = 0.17;
  const ARR = 0.085;
  let swipeStart: Pt | null = null;

  const loadLevel = (idx: number) => {
    const rows = LEVELS[idx];
    gh = rows.length;
    gw = Math.max(...rows.map((r) => r.length));
    walls = [];
    targets = new Set();
    crates = new Set();
    for (let y = 0; y < gh; y++) {
      walls[y] = [];
      const row = rows[y].padEnd(gw, " ");
      for (let x = 0; x < gw; x++) {
        const ch = row[x];
        walls[y][x] = ch === "#";
        if (ch === "." || ch === "*" || ch === "+") targets.add(k(x, y));
        if (ch === "$" || ch === "*") crates.add(k(x, y));
        if (ch === "@" || ch === "+") player = { x, y };
      }
    }
    computeInterior();
    moves = 0;
    undoStack = [];
    animT = 0;
    crateAnim = null;
    solved = false;
    solveT = 0;
    heldDir = null;
    playerFrom = { ...player };
    ctx.setStatus(
      `Level ${idx + 1}/${LEVELS.length} · arrows/swipe to push · Z undo · R restart`,
    );
  };

  const computeInterior = () => {
    interior = Array.from({ length: gh }, () => Array<boolean>(gw).fill(false));
    const q: Pt[] = [{ ...player }];
    interior[player.y][player.x] = true;
    while (q.length) {
      const p = q.pop() as Pt;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        if (walls[ny][nx] || interior[ny][nx]) continue;
        interior[ny][nx] = true;
        q.push({ x: nx, y: ny });
      }
    }
  };

  const snapshot = (): Snapshot => ({
    crates: [...crates],
    player: { ...player },
    moves,
  });

  const isComplete = () => {
    for (const t of targets) if (!crates.has(t)) return false;
    return true;
  };

  const advance = () => {
    if (finished) return;
    solvedCount += 1;
    if (levelIndex + 1 > furthest) {
      furthest = levelIndex + 1;
      ctx.storage.set("furthest", furthest);
    }
    ctx.reportScore(solvedCount);
    if (levelIndex + 1 >= LEVELS.length) {
      finished = true;
      audio.win();
      setTimeout(() => ctx.gameOver(solvedCount), 600);
      return;
    }
    levelIndex += 1;
    loadLevel(levelIndex);
  };

  const tryStep = (dir: Dir) => {
    if (animT > 0 || solved) return;
    const dx = dir === "L" ? -1 : dir === "R" ? 1 : 0;
    const dy = dir === "U" ? -1 : dir === "D" ? 1 : 0;
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || walls[ny][nx]) return;

    if (crates.has(k(nx, ny))) {
      const bx = nx + dx;
      const by = ny + dy;
      if (bx < 0 || by < 0 || bx >= gw || by >= gh) return;
      if (walls[by][bx] || crates.has(k(bx, by))) return;
      undoStack.push(snapshot());
      if (undoStack.length > 300) undoStack.shift();
      crates.delete(k(nx, ny));
      crates.add(k(bx, by));
      crateAnim = { from: { x: nx, y: ny }, to: { x: bx, y: by } };
      const ontarget = targets.has(k(bx, by));
      audio.tone(ontarget ? 520 : 200, 0.07, "square", 0.3);
    } else {
      undoStack.push(snapshot());
      if (undoStack.length > 300) undoStack.shift();
      crateAnim = null;
      audio.tone(330, 0.025, "sine", 0.12);
    }
    playerFrom = { x: player.x, y: player.y };
    player = { x: nx, y: ny };
    moves += 1;
    animT = MOVE_TIME;

    if (isComplete()) {
      solved = true;
      solveT = 0.55;
      audio.coin();
    }
  };

  const undo = () => {
    if (animT > 0 || solved) return;
    const s = undoStack.pop();
    if (!s) return;
    crates = new Set(s.crates);
    player = { ...s.player };
    moves = s.moves;
    playerFrom = { ...player };
    crateAnim = null;
    audio.tone(180, 0.05, "sine", 0.2);
  };

  const restart = () => {
    if (solved) return;
    loadLevel(levelIndex);
    audio.tone(150, 0.08, "sine", 0.2);
  };

  loadLevel(0);
  ctx.reportScore(0);
  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "z", label: "UNDO", id: "undo" },
    { type: "button", key: "r", label: "RESTART", id: "restart" },
  ]);

  const dirFromInput = (): Dir | null => {
    if (input.isDown("ArrowLeft", "a")) return "L";
    if (input.isDown("ArrowRight", "d")) return "R";
    if (input.isDown("ArrowUp", "w")) return "U";
    if (input.isDown("ArrowDown", "s")) return "D";
    return null;
  };

  return {
    update(dt) {
      if (animT > 0) animT = Math.max(0, animT - dt);

      if (solved) {
        solveT -= dt;
        if (solveT <= 0) advance();
        return;
      }

      if (input.pressed("z")) undo();
      if (input.pressed("r")) restart();

      const d = dirFromInput();
      if (d === null) {
        heldDir = null;
        repeatT = 0;
      } else if (d !== heldDir) {
        heldDir = d;
        repeatT = 0;
        tryStep(d);
      } else {
        repeatT += dt;
        if (repeatT >= DAS) {
          repeatT = DAS - ARR;
          tryStep(d);
        }
      }

      // swipe
      if (input.pointer.justDown) swipeStart = { x: input.pointer.x, y: input.pointer.y };
      if (input.pointer.justUp && swipeStart) {
        const dx = input.pointer.x - swipeStart.x;
        const dy = input.pointer.y - swipeStart.y;
        const min = Math.min(ctx.width, ctx.height) * 0.05;
        if (Math.abs(dx) > min || Math.abs(dy) > min) {
          if (Math.abs(dx) > Math.abs(dy)) tryStep(dx > 0 ? "R" : "L");
          else tryStep(dy > 0 ? "D" : "U");
        }
        swipeStart = null;
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#1a1410");
      grad.addColorStop(1, "#0d0a08");
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      const topPad = Math.min(H * 0.08, 54);
      const margin = Math.min(W, H) * 0.04;
      const availW = W - margin * 2;
      const availH = H - margin * 2 - topPad;
      const cell = Math.max(8, Math.min(availW / gw, availH / gh));
      const boardW = cell * gw;
      const boardH = cell * gh;
      const ox = (W - boardW) / 2;
      const oy = topPad + (H - topPad - boardH) / 2;

      // header
      drawText(c, `LEVEL ${levelIndex + 1}/${LEVELS.length}`, ox, oy - topPad * 0.55, Math.min(cell * 0.7, 24), "#f0c987", "left");
      drawText(c, `Moves ${moves}`, ox + boardW, oy - topPad * 0.55, Math.min(cell * 0.6, 20), "#b9a890", "right");

      const cx = (gx: number) => ox + gx * cell;
      const cy = (gy: number) => oy + gy * cell;

      // floor
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          if (!interior[y][x] || walls[y][x]) continue;
          c.fillStyle = (x + y) % 2 === 0 ? "#2a2018" : "#241c15";
          c.fillRect(cx(x), cy(y), cell, cell);
        }

      // targets
      for (const t of targets) {
        const [tx, ty] = t.split(",").map(Number);
        const px = cx(tx) + cell / 2;
        const py = cy(ty) + cell / 2;
        c.strokeStyle = "#e8b84b";
        c.lineWidth = Math.max(1.5, cell * 0.06);
        c.beginPath();
        c.arc(px, py, cell * 0.18, 0, Math.PI * 2);
        c.stroke();
      }

      // walls
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          if (!walls[y][x]) continue;
          c.fillStyle = "#4a3d2e";
          roundRect(c, cx(x) + 1, cy(y) + 1, cell - 2, cell - 2, cell * 0.12);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.06)";
          roundRect(c, cx(x) + 1, cy(y) + 1, cell - 2, (cell - 2) * 0.35, cell * 0.12);
          c.fill();
        }

      const anim = animT > 0 ? 1 - animT / MOVE_TIME : 1;

      // crates
      for (const cr of crates) {
        const [crx, cry] = cr.split(",").map(Number);
        let dx = crx;
        let dy = cry;
        if (crateAnim && crateAnim.to.x === crx && crateAnim.to.y === cry) {
          dx = crateAnim.from.x + (crateAnim.to.x - crateAnim.from.x) * anim;
          dy = crateAnim.from.y + (crateAnim.to.y - crateAnim.from.y) * anim;
        }
        const x = cx(dx);
        const y = cy(dy);
        const on = targets.has(cr);
        const i = cell * 0.12;
        c.fillStyle = on ? "#3f7d3a" : "#a9712f";
        roundRect(c, x + i, y + i, cell - i * 2, cell - i * 2, cell * 0.14);
        c.fill();
        c.fillStyle = on ? "#5cb054" : "#c98c43";
        const i2 = cell * 0.22;
        roundRect(c, x + i2, y + i2, cell - i2 * 2, cell - i2 * 2, cell * 0.1);
        c.fill();
        c.strokeStyle = on ? "#2c5a28" : "#7a4f1f";
        c.lineWidth = Math.max(1, cell * 0.04);
        c.beginPath();
        c.moveTo(x + i, y + i);
        c.lineTo(x + cell - i, y + cell - i);
        c.moveTo(x + cell - i, y + i);
        c.lineTo(x + i, y + cell - i);
        c.stroke();
      }

      // player
      {
        const dx = playerFrom.x + (player.x - playerFrom.x) * anim;
        const dy = playerFrom.y + (player.y - playerFrom.y) * anim;
        const px = cx(dx) + cell / 2;
        const py = cy(dy) + cell / 2;
        c.fillStyle = "#ffce54";
        c.beginPath();
        c.arc(px, py, cell * 0.32, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#2a1d0c";
        const ee = cell * 0.1;
        c.beginPath();
        c.arc(px - cell * 0.11, py - cell * 0.05, ee, 0, Math.PI * 2);
        c.arc(px + cell * 0.11, py - cell * 0.05, ee, 0, Math.PI * 2);
        c.fill();
        c.lineWidth = Math.max(1, cell * 0.04);
        c.strokeStyle = "#2a1d0c";
        c.beginPath();
        c.arc(px, py + cell * 0.06, cell * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
        c.stroke();
      }

      if (solved) {
        const a = clamp(1 - solveT / 0.55, 0, 1);
        c.fillStyle = `rgba(60,180,90,${0.25 * a})`;
        c.fillRect(ox, oy, boardW, boardH);
        drawText(c, "SOLVED!", ox + boardW / 2, oy + boardH / 2, Math.min(cell * 1.2, 48), "#ffffff");
      }
    },
  };
}
