import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, lerp, pointInRect, roundRect, rng } from "@/engine";

type Phase = "ready" | "play" | "over";
type HoleKind = "mole" | "bomb";

interface Hole {
  occupant: HoleKind | null;
  ph: number; // 0 hidden .. 1 fully up
  age: number;
  window: number; // seconds it stays up
  ducking: boolean;
  whacked: boolean;
  hitFlash: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
  r: number;
}

interface FloatText {
  x: number;
  y: number;
  life: number;
  text: string;
  col: string;
}

const GRID = 3;
const ROUND = 30;

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  const holes: Hole[] = [];
  for (let i = 0; i < GRID * GRID; i++) {
    holes.push({ occupant: null, ph: 0, age: 0, window: 1, ducking: false, whacked: false, hitFlash: 0 });
  }
  let parts: Particle[] = [];
  let floats: FloatText[] = [];

  let phase: Phase = "ready";
  let score = 0;
  let best = storage.get<number>("best", 0);
  let timeLeft = ROUND;
  let spawnTimer = 0.6;
  let shake = 0;
  let flash = 0;
  let t = 0;
  let hammerAngle = 0;

  // Whacking is positional: you tap the mole directly on the canvas, so an
  // on-screen button can't aim and would just be dead weight. Keyboard Space
  // still starts the round on desktop.
  ctx.requestControls([]);
  ctx.setStatus("Tap moles · avoid bombs!");

  function elapsed(): number {
    return ROUND - timeLeft;
  }

  function startGame() {
    phase = "play";
    score = 0;
    timeLeft = ROUND;
    spawnTimer = 0.5;
    for (const h of holes) {
      h.occupant = null;
      h.ph = 0;
      h.ducking = false;
      h.whacked = false;
    }
    ctx.reportScore(0);
    audio.blip();
  }

  // layout helpers (recomputed each frame for any size)
  function layout() {
    const W = ctx.width;
    const H = ctx.height;
    const boardTop = H * 0.16;
    const board = Math.min(W * 0.92, (H - boardTop) * 0.96);
    const ox = (W - board) / 2;
    const oy = boardTop + (H - boardTop - board) / 2;
    const cell = board / GRID;
    return { ox, oy, cell, board };
  }

  function holeRect(i: number) {
    const { ox, oy, cell } = layout();
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    const pad = cell * 0.12;
    return {
      x: ox + col * cell + pad,
      y: oy + row * cell + pad,
      w: cell - pad * 2,
      h: cell - pad * 2,
    };
  }

  function spawnParts(x: number, y: number, n: number, col: string, cell: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = cell * rng.range(0.5, 1.8);
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - cell * 0.5,
        life: rng.range(0.3, 0.6),
        max: 0.6,
        col,
        r: cell * rng.range(0.02, 0.06),
      });
    }
  }

  function spawn() {
    const empty: number[] = [];
    for (let i = 0; i < holes.length; i++) if (!holes[i].occupant) empty.push(i);
    if (empty.length === 0) return;
    const idx = empty[Math.floor(Math.random() * empty.length)];
    const h = holes[idx];
    const e = elapsed() / ROUND;
    const bombProb = 0.12 + 0.14 * e;
    h.occupant = Math.random() < bombProb ? "bomb" : "mole";
    h.ph = 0;
    h.age = 0;
    h.ducking = false;
    h.whacked = false;
    h.window = lerp(1.1, 0.55, e) * (h.occupant === "bomb" ? 1.3 : 1);
  }

  function whackAt(px: number, py: number) {
    const { cell } = layout();
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      if (!h.occupant || h.ph < 0.35 || h.ducking) continue;
      const r = holeRect(i);
      if (!pointInRect(px, py, r)) continue;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      hammerAngle = 1;
      if (h.occupant === "mole") {
        score++;
        ctx.reportScore(score);
        h.ducking = true;
        h.whacked = true;
        audio.coin();
        spawnParts(cx, cy, 14, "#ffd23f", cell);
        floats.push({ x: cx, y: cy, life: 0.7, text: "+1", col: "#ffe08a" });
      } else {
        score = Math.max(0, score - 2);
        ctx.reportScore(score);
        h.ducking = true;
        h.whacked = true;
        audio.explosion();
        shake = cell * 0.5;
        flash = 1;
        spawnParts(cx, cy, 22, "#ff5c5c", cell);
        floats.push({ x: cx, y: cy, life: 0.8, text: "-2", col: "#ff7a7a" });
      }
      return true;
    }
    return false;
  }

  function endGame() {
    phase = "over";
    if (score > best) {
      best = score;
      storage.set("best", best);
    }
    if (score > 0) audio.win();
    else audio.lose();
    setTimeout(() => ctx.gameOver(score), 600);
  }

  return {
    update(dt) {
      t += dt;
      const startInput = input.pressed("Space") || input.pointer.justDown;

      if (phase === "ready") {
        if (startInput) startGame();
        return;
      }
      if (phase === "over") return;

      // whack on tap (ignore the tap that starts handled above)
      if (input.pointer.justDown) whackAt(input.pointer.x, input.pointer.y);

      timeLeft -= dt;
      const e = elapsed() / ROUND;

      // spawning
      spawnTimer -= dt;
      const maxUp = 1 + Math.floor(elapsed() / 8);
      let upCount = 0;
      for (const h of holes) if (h.occupant && !h.ducking) upCount++;
      if (spawnTimer <= 0 && upCount < maxUp) {
        spawn();
        spawnTimer = lerp(0.85, 0.32, e) * rng.range(0.7, 1.2);
      }

      // hole animation
      for (const h of holes) {
        if (!h.occupant) continue;
        h.age += dt;
        h.hitFlash *= Math.exp(-dt * 8);
        if (!h.ducking) {
          h.ph = Math.min(1, h.ph + dt / 0.1);
          if (h.age >= h.window) h.ducking = true;
        } else {
          h.ph -= dt / (h.whacked ? 0.08 : 0.14);
          if (h.ph <= 0) {
            h.ph = 0;
            h.occupant = null;
          }
        }
      }

      // particles & floats
      const { cell } = layout();
      for (const pa of parts) {
        pa.life -= dt;
        pa.vy += cell * 6 * dt;
        pa.x += pa.vx * dt;
        pa.y += pa.vy * dt;
      }
      parts = parts.filter((pa) => pa.life > 0);
      for (const f of floats) {
        f.life -= dt;
        f.y -= cell * 0.8 * dt;
      }
      floats = floats.filter((f) => f.life > 0);

      shake *= Math.exp(-dt * 9);
      flash *= Math.exp(-dt * 6);
      hammerAngle *= Math.exp(-dt * 10);

      if (timeLeft <= 0) {
        timeLeft = 0;
        endGame();
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const { ox, oy, cell, board } = layout();

      // background
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#2a1840");
      bg.addColorStop(1, "#3a1f5c");
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);

      c.save();
      if (shake > 0.3) c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

      // board panel
      c.fillStyle = "#5a8f3c";
      roundRect(c, ox - cell * 0.1, oy - cell * 0.1, board + cell * 0.2, board + cell * 0.2, cell * 0.18);
      c.fill();

      for (let i = 0; i < holes.length; i++) {
        const r = holeRect(i);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const rad = r.w * 0.46;
        // dirt mound
        c.fillStyle = "#7a5a36";
        c.beginPath();
        c.ellipse(cx, cy + rad * 0.5, rad * 1.15, rad * 0.5, 0, 0, Math.PI * 2);
        c.fill();
        // hole
        c.fillStyle = "#241409";
        c.beginPath();
        c.ellipse(cx, cy + rad * 0.35, rad, rad * 0.62, 0, 0, Math.PI * 2);
        c.fill();

        const h = holes[i];
        if (h.occupant && h.ph > 0.01) {
          c.save();
          c.beginPath();
          c.rect(r.x - rad * 0.3, r.y - rad, r.w + rad * 0.6, r.h * 0.95);
          c.clip();
          const rise = (1 - h.ph) * rad * 1.2;
          if (h.occupant === "mole") drawMole(c, cx, cy + rad * 0.2 + rise, rad, h);
          else drawBomb(c, cx, cy + rad * 0.2 + rise, rad);
          c.restore();
        }
      }

      // particles
      for (const pa of parts) {
        c.globalAlpha = clamp(pa.life / pa.max, 0, 1);
        c.fillStyle = pa.col;
        c.beginPath();
        c.arc(pa.x, pa.y, pa.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      // float texts
      for (const f of floats) {
        c.globalAlpha = clamp(f.life / 0.8, 0, 1);
        drawText(c, f.text, f.x, f.y, cell * 0.4, f.col);
      }
      c.globalAlpha = 1;

      // hammer cursor (desktop)
      if (phase === "play" && input.pointer.down) {
        drawHammer(c, input.pointer.x, input.pointer.y, cell);
      }

      c.restore();

      // HUD
      drawText(c, `SCORE ${score}`, W * 0.5, H * 0.06, H * 0.04, "#fff");
      const tCol = timeLeft <= 5 ? (Math.floor(t * 6) % 2 === 0 ? "#ff5c5c" : "#fff") : "#fff";
      drawText(c, `${Math.ceil(timeLeft)}s`, W * 0.5, H * 0.11, H * 0.045, tCol);
      drawText(c, `BEST ${Math.max(best, score)}`, W * 0.94, H * 0.06, H * 0.026, "rgba(255,255,255,0.6)", "right");

      // hit flash
      if (flash > 0.02) {
        c.fillStyle = `rgba(255,60,60,${flash * 0.4})`;
        c.fillRect(0, 0, W, H);
      }

      if (phase === "ready") {
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.fillRect(0, 0, W, H);
        drawText(c, "REACTION LAB", W / 2, H * 0.4, H * 0.07, "#ffd23f");
        drawText(c, "Tap moles, dodge bombs", W / 2, H * 0.49, H * 0.034, "#fff");
        c.fillStyle = "#5fe08a";
        roundRect(c, W * 0.3, H * 0.56, W * 0.4, H * 0.08, H * 0.02);
        c.fill();
        drawText(c, "TAP TO START", W / 2, H * 0.6, H * 0.035, "#10331f");
      }
    },

    resize() {
      /* layout is derived each frame */
    },
  };

  function drawMole(c: CanvasRenderingContext2D, cx: number, cy: number, rad: number, h: Hole) {
    const wob = h.whacked ? 0 : Math.sin(t * 8 + cx) * rad * 0.04;
    c.save();
    c.translate(cx, cy + wob);
    // body
    c.fillStyle = "#9c6b43";
    c.beginPath();
    c.ellipse(0, 0, rad * 0.78, rad * 0.92, 0, 0, Math.PI * 2);
    c.fill();
    // muzzle
    c.fillStyle = "#e9c39a";
    c.beginPath();
    c.ellipse(0, rad * 0.22, rad * 0.5, rad * 0.4, 0, 0, Math.PI * 2);
    c.fill();
    // eyes
    if (h.whacked) {
      c.strokeStyle = "#1a1a1a";
      c.lineWidth = rad * 0.08;
      const ey = -rad * 0.2;
      c.beginPath();
      c.moveTo(-rad * 0.42, ey - rad * 0.1);
      c.lineTo(-rad * 0.18, ey + rad * 0.1);
      c.moveTo(-rad * 0.18, ey - rad * 0.1);
      c.lineTo(-rad * 0.42, ey + rad * 0.1);
      c.moveTo(rad * 0.18, ey - rad * 0.1);
      c.lineTo(rad * 0.42, ey + rad * 0.1);
      c.moveTo(rad * 0.42, ey - rad * 0.1);
      c.lineTo(rad * 0.18, ey + rad * 0.1);
      c.stroke();
    } else {
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(-rad * 0.28, -rad * 0.18, rad * 0.18, 0, Math.PI * 2);
      c.arc(rad * 0.28, -rad * 0.18, rad * 0.18, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#1a1a1a";
      c.beginPath();
      c.arc(-rad * 0.28, -rad * 0.16, rad * 0.09, 0, Math.PI * 2);
      c.arc(rad * 0.28, -rad * 0.16, rad * 0.09, 0, Math.PI * 2);
      c.fill();
    }
    // nose
    c.fillStyle = "#d6585c";
    c.beginPath();
    c.arc(0, rad * 0.1, rad * 0.12, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function drawBomb(c: CanvasRenderingContext2D, cx: number, cy: number, rad: number) {
    c.save();
    c.translate(cx, cy);
    c.fillStyle = "#22262b";
    c.beginPath();
    c.arc(0, rad * 0.05, rad * 0.7, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath();
    c.arc(-rad * 0.25, -rad * 0.2, rad * 0.18, 0, Math.PI * 2);
    c.fill();
    // fuse
    c.strokeStyle = "#a07a3c";
    c.lineWidth = rad * 0.08;
    c.beginPath();
    c.moveTo(0, -rad * 0.6);
    c.quadraticCurveTo(rad * 0.3, -rad * 0.85, rad * 0.18, -rad * 1.0);
    c.stroke();
    // spark
    const sp = 0.6 + Math.sin(t * 22) * 0.4;
    c.fillStyle = "#ffd23f";
    c.beginPath();
    c.arc(rad * 0.18, -rad * 1.0, rad * 0.14 * sp, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ff7a2b";
    c.beginPath();
    c.arc(rad * 0.18, -rad * 1.0, rad * 0.08 * sp, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function drawHammer(c: CanvasRenderingContext2D, x: number, y: number, cell: number) {
    c.save();
    c.translate(x, y);
    c.rotate(-0.5 - hammerAngle * 0.8);
    c.fillStyle = "#7a4a22";
    roundRect(c, -cell * 0.05, 0, cell * 0.1, cell * 0.55, cell * 0.04);
    c.fill();
    c.fillStyle = "#c94b4b";
    roundRect(c, -cell * 0.28, -cell * 0.18, cell * 0.56, cell * 0.26, cell * 0.06);
    c.fill();
    c.fillStyle = "#e06b6b";
    roundRect(c, -cell * 0.28, -cell * 0.18, cell * 0.56, cell * 0.08, cell * 0.04);
    c.fill();
    c.restore();
  }
}
