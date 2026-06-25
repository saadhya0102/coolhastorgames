import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, lerp, roundRect } from "@/engine";

type PowerKind = "multi" | "expand" | "slow" | "laser";

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  stuck: boolean;
}

interface Brick {
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  hue: number;
  power: PowerKind | null;
}

interface Drop {
  x: number;
  y: number;
  vy: number;
  kind: PowerKind;
}

interface Laser {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

const COLS = 9;

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  let score = 0;
  let lives = 3;
  let level = 1;
  let dead = false;

  let bricks: Brick[] = [];
  let balls: Ball[] = [];
  let drops: Drop[] = [];
  let lasers: Laser[] = [];
  let particles: Particle[] = [];

  // paddle stored in pixels; recomputed/clamped against current size each frame
  let paddleX = 0;
  let paddleW = 0;
  let baseHalfW = 0;
  let expandT = 0;
  let slowT = 0;
  let laserT = 0;
  let laserCd = 0;

  let speedScale = 1;
  let shakeT = 0;
  let shakeMag = 0;
  let lastPointerX = ctx.input.pointer.x;
  let t = 0;

  // ---- layout helpers (read size every frame) ----
  const margin = () => Math.min(ctx.width, ctx.height) * 0.04;
  const brickAreaTop = () => ctx.height * 0.14;
  const brickW = () => (ctx.width - margin() * 2) / COLS;
  const brickH = () => brickW() * 0.42;
  const paddleY = () => ctx.height * 0.9;
  const paddleH = () => Math.max(10, ctx.height * 0.022);

  const brickRect = (b: Brick) => {
    const bw = brickW();
    const bh = brickH();
    const gap = bw * 0.06;
    return {
      x: margin() + b.col * bw + gap * 0.5,
      y: brickAreaTop() + b.row * (bh * 1.15) + gap * 0.5,
      w: bw - gap,
      h: bh - gap,
    };
  };

  const ballSpeed = () =>
    ctx.height * (0.62 + Math.min(level, 8) * 0.04) * speedScale * (slowT > 0 ? 0.6 : 1);

  const buildLevel = () => {
    bricks = [];
    const rows = Math.min(4 + level, 9);
    const seed = level * 2654435761;
    const rand = mulberry(seed >>> 0);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < COLS; col++) {
        // generated layouts: skip some cells in patterns
        const pattern = level % 4;
        let skip = false;
        if (pattern === 1 && (col === 0 || col === COLS - 1) && row % 2 === 0) skip = true;
        if (pattern === 2 && (row + col) % 3 === 0) skip = true;
        if (pattern === 3 && Math.abs(col - (COLS - 1) / 2) > rows - row) skip = true;
        if (skip) continue;
        const hp = row < Math.max(1, rows - 3) ? (rand() < 0.4 ? 2 : 1) : 1;
        const power: PowerKind | null = rand() < 0.16 ? pickPower(rand) : null;
        bricks.push({
          col,
          row,
          hp,
          maxHp: hp,
          hue: (row * 36 + col * 8) % 360,
          power,
        });
      }
    }
    drops = [];
    lasers = [];
    expandT = 0;
    slowT = 0;
    laserT = 0;
    resetBall();
  };

  const resetBall = () => {
    balls = [
      {
        x: paddleX,
        y: paddleY() - paddleH(),
        vx: 0,
        vy: 0,
        r: Math.max(5, ctx.height * 0.012),
        stuck: true,
      },
    ];
  };

  const initPaddle = () => {
    baseHalfW = ctx.width * 0.11;
    paddleW = baseHalfW * 2;
    paddleX = ctx.width / 2;
  };

  initPaddle();
  buildLevel();

  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Space", label: "GO", id: "fire" },
  ]);
  ctx.setStatus("Move: ◀ ▶ / mouse · Launch: Space / tap");

  const launch = () => {
    let launched = false;
    for (const b of balls) {
      if (b.stuck) {
        b.stuck = false;
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        const s = ballSpeed();
        b.vx = Math.cos(a) * s;
        b.vy = Math.sin(a) * s;
        launched = true;
      }
    }
    if (launched) audio.blip();
  };

  const fireLasers = () => {
    if (laserT <= 0 || laserCd > 0) return;
    laserCd = 0.22;
    lasers.push({ x: paddleX - paddleW * 0.42, y: paddleY() });
    lasers.push({ x: paddleX + paddleW * 0.42, y: paddleY() });
    audio.tone(900, 0.05, "square", 0.25);
  };

  const addParticles = (x: number, y: number, hue: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.2 + Math.random() * 0.8) * ctx.height * 0.5;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.3 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
        color: `hsl(${hue},90%,${55 + Math.random() * 20}%)`,
      });
    }
  };

  const shake = (m: number) => {
    shakeMag = Math.max(shakeMag, m);
    shakeT = Math.max(shakeT, 0.25);
  };

  const damageBrick = (b: Brick) => {
    b.hp--;
    const r = brickRect(b);
    addParticles(r.x + r.w / 2, r.y + r.h / 2, b.hue, b.hp <= 0 ? 14 : 5);
    if (b.hp <= 0) {
      score += 10 * b.maxHp;
      ctx.reportScore(score);
      audio.tone(440 + b.row * 20, 0.05, "square", 0.3);
      shake(4);
      if (b.power) {
        drops.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, vy: ctx.height * 0.28, kind: b.power });
      }
      bricks = bricks.filter((x) => x !== b);
      if (bricks.length === 0) nextLevel();
    } else {
      audio.tone(300, 0.03, "square", 0.2);
    }
  };

  const nextLevel = () => {
    level++;
    speedScale = Math.min(1.5, speedScale + 0.06);
    audio.win();
    buildLevel();
  };

  const loseBall = () => {
    lives--;
    audio.lose();
    shake(8);
    if (lives <= 0) {
      dead = true;
      setTimeout(() => ctx.gameOver(score), 600);
      return;
    }
    expandT = 0;
    slowT = 0;
    laserT = 0;
    paddleW = baseHalfW * 2;
    resetBall();
  };

  const applyPower = (kind: PowerKind) => {
    audio.coin();
    if (kind === "multi") {
      const extra: Ball[] = [];
      for (const b of balls) {
        if (b.stuck) continue;
        for (let k = 0; k < 2; k++) {
          const ang = Math.atan2(b.vy, b.vx) + (k === 0 ? 0.4 : -0.4);
          const s = ballSpeed();
          extra.push({ x: b.x, y: b.y, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, r: b.r, stuck: false });
        }
      }
      balls.push(...extra.slice(0, 6));
    } else if (kind === "expand") {
      expandT = 12;
      paddleW = baseHalfW * 3;
    } else if (kind === "slow") {
      slowT = 10;
    } else {
      laserT = 12;
    }
  };

  return {
    update(dt) {
      t += dt;
      const W = ctx.width;
      const H = ctx.height;
      const half = paddleW / 2;

      if (shakeT > 0) shakeT -= dt;
      if (expandT > 0 && (expandT -= dt) <= 0) paddleW = baseHalfW * 2;
      if (slowT > 0) slowT -= dt;
      if (laserT > 0) laserT -= dt;
      if (laserCd > 0) laserCd -= dt;

      if (dead) {
        stepParticles(dt);
        return;
      }

      // paddle movement: keyboard or pointer
      const left = input.isDown("ArrowLeft", "a");
      const right = input.isDown("ArrowRight", "d");
      const pSpeed = W * 1.3;
      if (left || right) {
        paddleX += ((right ? 1 : 0) - (left ? 1 : 0)) * pSpeed * dt;
      } else if (Math.abs(input.pointer.x - lastPointerX) > 0.01 && !ctx.isTouch) {
        // Desktop follows the mouse only after it actually moves (avoids the
        // paddle snapping to x=0 on the very first frame). Touch uses the dpad,
        // so a launch tap never yanks the paddle to the tap location.
        paddleX = lerp(paddleX, input.pointer.x, 0.5);
      }
      lastPointerX = input.pointer.x;
      paddleX = clamp(paddleX, half, W - half);

      if (input.pressed("Space", "ArrowUp", "w") || input.pointer.justDown) {
        launch();
        fireLasers();
      }
      if (input.isDown("Space") && laserT > 0) fireLasers();

      const pY = paddleY();
      const pH = paddleH();

      // balls
      const speed = ballSpeed();
      for (const b of balls) {
        if (b.stuck) {
          b.x = clamp(paddleX, half, W - half);
          b.y = pY - pH - b.r;
          continue;
        }
        // keep magnitude consistent (handles slow power changes)
        const mag = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / mag) * speed;
        b.vy = (b.vy / mag) * speed;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (b.x - b.r < 0) {
          b.x = b.r;
          b.vx = Math.abs(b.vx);
          audio.blip();
        } else if (b.x + b.r > W) {
          b.x = W - b.r;
          b.vx = -Math.abs(b.vx);
          audio.blip();
        }
        if (b.y - b.r < 0) {
          b.y = b.r;
          b.vy = Math.abs(b.vy);
          audio.blip();
        }

        // paddle collision
        if (
          b.vy > 0 &&
          b.y + b.r >= pY &&
          b.y - b.r <= pY + pH &&
          b.x >= paddleX - half - b.r &&
          b.x <= paddleX + half + b.r
        ) {
          const off = clamp((b.x - paddleX) / half, -1, 1);
          const ang = -Math.PI / 2 + off * (Math.PI * 0.36);
          b.vx = Math.cos(ang) * speed;
          b.vy = Math.sin(ang) * speed;
          b.y = pY - b.r - 1;
          audio.tone(520, 0.04, "square", 0.3);
        }

        // brick collisions
        for (const br of bricks) {
          const r = brickRect(br);
          if (
            b.x + b.r > r.x &&
            b.x - b.r < r.x + r.w &&
            b.y + b.r > r.y &&
            b.y - b.r < r.y + r.h
          ) {
            // resolve by smallest penetration axis
            const overL = b.x + b.r - r.x;
            const overR = r.x + r.w - (b.x - b.r);
            const overT = b.y + b.r - r.y;
            const overB = r.y + r.h - (b.y - b.r);
            const minX = Math.min(overL, overR);
            const minY = Math.min(overT, overB);
            if (minX < minY) b.vx = overL < overR ? -Math.abs(b.vx) : Math.abs(b.vx);
            else b.vy = overT < overB ? -Math.abs(b.vy) : Math.abs(b.vy);
            damageBrick(br);
            break;
          }
        }
      }

      // remove lost balls
      balls = balls.filter((b) => b.y - b.r < H + 40);
      if (balls.length === 0 && !dead) loseBall();

      // power drops
      for (const d of drops) {
        d.y += d.vy * dt;
        if (
          d.y > pY - pH &&
          d.y < pY + pH &&
          d.x > paddleX - half &&
          d.x < paddleX + half
        ) {
          applyPower(d.kind);
          d.y = H + 999;
        }
      }
      drops = drops.filter((d) => d.y < H + 30);

      // lasers
      for (const l of lasers) {
        l.y -= H * 1.4 * dt;
        for (const br of bricks) {
          const r = brickRect(br);
          if (l.x > r.x && l.x < r.x + r.w && l.y < r.y + r.h && l.y > r.y) {
            damageBrick(br);
            l.y = -999;
            break;
          }
        }
      }
      lasers = lasers.filter((l) => l.y > -20);

      stepParticles(dt);
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0b1026");
      bg.addColorStop(1, "#1a1140");
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);

      c.save();
      if (shakeT > 0) {
        const m = shakeMag * (shakeT / 0.25);
        c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      }

      // bricks
      for (const br of bricks) {
        const r = brickRect(br);
        const lightness = 40 + (br.hp / br.maxHp) * 22;
        c.fillStyle = `hsl(${br.hue},75%,${lightness}%)`;
        roundRect(c, r.x, r.y, r.w, r.h, Math.min(6, r.h * 0.3));
        c.fill();
        c.fillStyle = "rgba(255,255,255,0.18)";
        roundRect(c, r.x, r.y, r.w, r.h * 0.4, Math.min(6, r.h * 0.3));
        c.fill();
        if (br.power) {
          c.fillStyle = "rgba(255,255,255,0.9)";
          drawText(c, powerIcon(br.power), r.x + r.w / 2, r.y + r.h / 2, r.h * 0.55, "#fff");
        }
      }

      // particles
      for (const p of particles) {
        c.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
        c.fillStyle = p.color;
        c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      c.globalAlpha = 1;

      // drops
      for (const d of drops) {
        c.fillStyle = powerColor(d.kind);
        roundRect(c, d.x - 14, d.y - 9, 28, 18, 6);
        c.fill();
        drawText(c, powerIcon(d.kind), d.x, d.y, 13, "#08111f");
      }

      // lasers
      c.fillStyle = "#67e8ff";
      for (const l of lasers) c.fillRect(l.x - 2, l.y - 16, 4, 16);

      // paddle
      const pY = paddleY();
      const pH = paddleH();
      const half = paddleW / 2;
      const grad = c.createLinearGradient(0, pY, 0, pY + pH);
      grad.addColorStop(0, laserT > 0 ? "#9bf6ff" : "#67e8ff");
      grad.addColorStop(1, "#2c7be5");
      c.fillStyle = grad;
      roundRect(c, paddleX - half, pY, paddleW, pH, pH / 2);
      c.fill();
      if (laserT > 0) {
        c.fillStyle = "#bff7ff";
        c.fillRect(paddleX - half + 4, pY - 6, 4, 6);
        c.fillRect(paddleX + half - 8, pY - 6, 4, 6);
      }

      // balls
      for (const b of balls) {
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "rgba(103,232,255,0.5)";
        c.beginPath();
        c.arc(b.x, b.y, b.r * 1.5, 0, Math.PI * 2);
        c.fill();
      }

      c.restore();

      // HUD
      drawText(c, `SCORE ${score}`, margin(), H * 0.06, H * 0.032, "#fff", "left");
      drawText(c, `LVL ${level}`, W / 2, H * 0.06, H * 0.032, "#9bf6ff");
      drawText(c, "♥".repeat(Math.max(0, lives)), W - margin(), H * 0.06, H * 0.04, "#ff5c8a", "right");

      if (balls.some((b) => b.stuck) && !dead) {
        drawText(c, "PRESS SPACE / TAP TO LAUNCH", W / 2, H * 0.8, H * 0.03, "rgba(255,255,255,0.7)");
      }
    },

    resize(w, h) {
      const oldHalf = baseHalfW;
      baseHalfW = w * 0.11;
      const ratio = oldHalf > 0 ? baseHalfW / oldHalf : 1;
      paddleW *= ratio;
      paddleX = clamp(paddleX * ratio, paddleW / 2, w - paddleW / 2);
      void h;
    },
  };

  function stepParticles(dt: number) {
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += ctx.height * 0.6 * dt;
    }
    particles = particles.filter((p) => p.life < p.max);
  }
}

function pickPower(rand: () => number): PowerKind {
  const r = rand();
  if (r < 0.3) return "multi";
  if (r < 0.55) return "expand";
  if (r < 0.78) return "slow";
  return "laser";
}

function powerIcon(k: PowerKind): string {
  return k === "multi" ? "+" : k === "expand" ? "↔" : k === "slow" ? "S" : "L";
}

function powerColor(k: PowerKind): string {
  return k === "multi" ? "#ffd23f" : k === "expand" ? "#46e0a0" : k === "slow" ? "#67e8ff" : "#ff5c8a";
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
