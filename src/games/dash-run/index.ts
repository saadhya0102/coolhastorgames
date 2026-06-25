import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, mulberry32, rng } from "@/engine";

/**
 * dash-run — endless Canabalt-style auto-runner.
 * Vertical measurements are stored as fractions of the current height so the
 * world stays valid through resizes; horizontal measurements are in CSS px and
 * scaled on resize.
 */
export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  interface Block {
    x: number; // left, px
    w: number; // width, px
    fy: number; // top surface as fraction of H
    hue: number;
  }
  interface Dust {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    size: number;
  }

  const PW_FRAC = 0.045; // player width as fraction of W
  const PH_FRAC = 0.11; // player height as fraction of H
  const START_FY = 0.7;

  let blocks: Block[] = [];
  let dust: Dust[] = [];

  let py = START_FY; // feet position (fraction of H)
  let vy = 0; // fraction of H per second
  let grounded = true;
  let jumpCut = false;
  let sliding = false;
  let slideT = 0;
  let runT = 0; // animation timer
  let footstep = 0;

  let speed = 0; // px/s (set in reset relative to W)
  let distancePx = 0;
  let metersF = 0;
  let meters = 0;
  let hueBase = 200;

  let started = false;
  let dead = false;
  let shake = 0;
  let wasGrounded = true;
  let coyote = 0; // grace window to still jump just after leaving an edge
  let jumpBuffer = 0; // remembers a jump pressed slightly before landing
  let prevW = ctx.width;

  const best = ctx.storage.get<number>("dashrun.best", 0);

  function addBlock(W: number) {
    if (blocks.length === 0) {
      blocks.push({ x: -W * 0.25, w: W * 1.35, fy: START_FY, hue: hueBase });
      return;
    }
    const last = blocks[blocks.length - 1];
    let gap = rng.chance(0.72) ? rng.range(speed * 0.22, speed * 0.62) : 0;
    let fy = clamp(last.fy + rng.range(-0.2, 0.2), 0.42, 0.82);
    // limit up-steps so they remain jumpable, and always show a gap before one
    if (last.fy - fy > 0.2) fy = last.fy - 0.2;
    if (last.fy - fy > 0.03) gap = Math.max(gap, rng.range(speed * 0.32, speed * 0.6));
    const w = rng.range(W * 0.2, W * 0.55);
    hueBase = (hueBase + rng.range(6, 16)) % 360;
    blocks.push({ x: last.x + last.w + gap, w, fy, hue: hueBase });
  }

  function ensureBlocks(W: number) {
    let guard = 0;
    while (blocks.length === 0 || blocks[blocks.length - 1].x + blocks[blocks.length - 1].w < W * 1.7) {
      addBlock(W);
      if (++guard > 200) break;
    }
  }

  const reset = () => {
    const W = ctx.width;
    blocks = [];
    dust = [];
    py = START_FY;
    vy = 0;
    grounded = true;
    jumpCut = false;
    sliding = false;
    slideT = 0;
    speed = W * 0.42;
    distancePx = 0;
    metersF = 0;
    meters = 0;
    started = false;
    dead = false;
    shake = 0;
    hueBase = 200;
    ensureBlocks(W);
  };
  reset();

  ctx.requestControls([{ type: "button", key: "Space", label: "JUMP", id: "jump" }]);
  ctx.setStatus("Hold to jump higher · ↓ to slide");

  const die = () => {
    if (dead) return;
    dead = true;
    shake = 1;
    audio.hit();
    audio.lose();
    if (meters > best) ctx.storage.set("dashrun.best", meters);
    spawnBurst(ctx.width * 0.26, py * ctx.height, 24, 18, 50);
    setTimeout(() => ctx.gameOver(meters), 600);
  };

  function spawnBurst(x: number, y: number, n: number, hue: number, spread: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread + 10;
      dust.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0,
        max: rng.range(0.3, 0.7),
        size: rng.range(2, 5),
      });
    }
  }

  const doJump = () => {
    vy = -1.55;
    grounded = false;
    coyote = 0;
    jumpBuffer = 0;
    jumpCut = false;
    sliding = false;
    audio.jump();
    spawnBurst(ctx.width * 0.26, py * ctx.height, 8, 35, 26);
  };

  return {
    update(dt) {
      const W = ctx.width;
      const H = ctx.height;
      const playerX = W * 0.26;
      const pw = W * PW_FRAC;

      const jumpPressed = input.pressed("Space", "ArrowUp", "w") || input.pointer.justDown;
      const jumpHeld = input.isDown("Space", "ArrowUp", "w") || input.pointer.down;

      if (jumpPressed) {
        started = true;
        jumpBuffer = 0.13;
      }
      jumpBuffer = Math.max(0, jumpBuffer - dt);
      coyote = Math.max(0, coyote - dt);

      if (shake > 0) shake = Math.max(0, shake - dt * 2.2);

      // dust always animates
      for (const d of dust) {
        d.life += dt;
        d.vy += 60 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      dust = dust.filter((d) => d.life < d.max);

      if (!started || dead) {
        runT += dt;
        return;
      }

      runT += dt;

      // difficulty ramp
      speed = Math.min(W * 0.95, speed + W * 0.013 * dt);
      const move = speed * dt;
      distancePx += move;
      metersF += (speed / W) * dt * 10;
      const m = Math.floor(metersF);
      if (m !== meters) {
        meters = m;
        ctx.reportScore(meters);
      }

      for (const b of blocks) b.x -= move;
      blocks = blocks.filter((b) => b.x + b.w > -W * 0.4);
      ensureBlocks(W);

      // slide
      if (input.isDown("ArrowDown", "s") && grounded) {
        if (!sliding) {
          sliding = true;
          slideT = 0;
          audio.tone(180, 0.12, "sawtooth", 0.2);
        }
      }
      if (sliding) {
        slideT += dt;
        if (slideT > 0.5 || !input.isDown("ArrowDown", "s")) sliding = false;
        if (Math.random() < 0.6) {
          spawnBurst(playerX, py * H, 1, 30, 8);
        }
      }

      // physics (variable jump height)
      const grav = vy < 0 && jumpHeld ? 3.4 * 0.55 : 3.4;
      if (vy < 0 && !jumpHeld && !jumpCut) {
        vy *= 0.45;
        jumpCut = true;
      }
      vy += grav * dt;
      const prevFeet = py;
      py += vy * dt;

      // collision against blocks (solid columns from top to below screen)
      grounded = false;
      for (const b of blocks) {
        if (b.x < playerX + pw && b.x + b.w > playerX) {
          const top = b.fy;
          if (py >= top) {
            if (prevFeet <= top + 0.03 && vy >= 0) {
              py = top;
              vy = 0;
              grounded = true;
            } else {
              die();
              break;
            }
          }
        }
      }
      if (grounded && !wasGrounded) spawnBurst(playerX, py * H, 8, 30, 20);
      // running off an edge grants a brief window to still jump (coyote time)
      if (!grounded && wasGrounded && vy >= 0) coyote = 0.1;
      wasGrounded = grounded;

      // a buffered jump fires the instant we land or within the coyote window
      if (jumpBuffer > 0 && (grounded || coyote > 0) && !dead) doJump();

      // running dust
      if (grounded && !sliding) {
        footstep += dt;
        if (footstep > 0.09) {
          footstep = 0;
          dust.push({
            x: playerX,
            y: py * H,
            vx: -speed * 0.25 - rng.range(0, 30),
            vy: -rng.range(10, 40),
            life: 0,
            max: rng.range(0.2, 0.45),
            size: rng.range(2, 4),
          });
        }
      }

      // fell into a gap
      if (py > 1.18) die();
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const playerX = W * 0.26;
      const pw = W * PW_FRAC;

      c.save();
      if (shake > 0) {
        const s = shake * 10;
        c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }

      // sky gradient
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#1a1140");
      sky.addColorStop(0.5, "#3b2a6b");
      sky.addColorStop(1, "#ff7a59");
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H);

      // sun
      c.fillStyle = "rgba(255,220,120,0.9)";
      c.beginPath();
      c.arc(W * 0.78, H * 0.34, Math.min(W, H) * 0.13, 0, Math.PI * 2);
      c.fill();

      drawBuildings(c, W, H, distancePx * 0.12, 0.55, 130, "#241a4d", 7);
      drawBuildings(c, W, H, distancePx * 0.28, 0.68, 95, "#2e2160", 13);
      drawBuildings(c, W, H, distancePx * 0.5, 0.78, 70, "#3a2a78", 23);

      // blocks
      for (const b of blocks) {
        const top = b.fy * H;
        const grad = c.createLinearGradient(0, top, 0, H);
        grad.addColorStop(0, `hsl(${b.hue}, 65%, 58%)`);
        grad.addColorStop(1, `hsl(${b.hue}, 55%, 32%)`);
        c.fillStyle = grad;
        c.fillRect(b.x, top, b.w, H - top);
        c.fillStyle = `hsl(${b.hue}, 80%, 72%)`;
        c.fillRect(b.x, top, b.w, Math.max(3, H * 0.012));
        // window dots
        c.fillStyle = "rgba(255,255,255,0.12)";
        const ws = Math.max(10, W * 0.03);
        for (let wx = b.x + ws * 0.5; wx < b.x + b.w - ws * 0.4; wx += ws) {
          for (let wy = top + ws; wy < H - ws * 0.3; wy += ws) {
            c.fillRect(wx, wy, ws * 0.3, ws * 0.45);
          }
        }
      }

      // dust
      for (const d of dust) {
        const a = 1 - d.life / d.max;
        c.fillStyle = `rgba(255,235,200,${a * 0.7})`;
        c.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
      }

      // player
      const ph = (sliding ? PH_FRAC * 0.55 : PH_FRAC) * H;
      const feet = py * H;
      const bodyY = feet - ph;
      c.save();
      c.translate(playerX, bodyY);
      // trail
      c.fillStyle = "rgba(120,220,255,0.18)";
      c.fillRect(-pw * 1.6, 0, pw * 1.3, ph);
      // body
      const lean = clamp(vy * 6, -0.3, 0.3);
      c.translate(pw / 2, ph / 2);
      c.rotate(sliding ? -0.5 : lean);
      c.fillStyle = "#16e0c0";
      const bw = pw;
      const bh = ph;
      roundedRect(c, -bw / 2, -bh / 2, bw, bh, Math.min(bw, bh) * 0.3);
      c.fill();
      c.fillStyle = "#0a8f7c";
      roundedRect(c, -bw / 2, bh * 0.05, bw, bh * 0.45, bw * 0.25);
      c.fill();
      // head/eye
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(bw * 0.12, -bh * 0.28, bw * 0.16, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#08221f";
      c.beginPath();
      c.arc(bw * 0.18, -bh * 0.28, bw * 0.08, 0, Math.PI * 2);
      c.fill();
      // legs (running)
      if (grounded && !sliding) {
        const swing = Math.sin(runT * 26) * bh * 0.28;
        c.strokeStyle = "#0a8f7c";
        c.lineWidth = Math.max(2, bw * 0.22);
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(-bw * 0.1, bh * 0.4);
        c.lineTo(-bw * 0.1 + swing, bh * 0.62);
        c.moveTo(bw * 0.1, bh * 0.4);
        c.lineTo(bw * 0.1 - swing, bh * 0.62);
        c.stroke();
      }
      c.restore();
      c.restore(); // shake

      // HUD
      drawText(c, `${meters} m`, W / 2, H * 0.1, Math.min(W, H) * 0.08, "#fff");
      drawText(c, `BEST ${Math.max(best, meters)}`, W / 2, H * 0.17, Math.min(W, H) * 0.035, "rgba(255,255,255,0.7)");

      if (!started) {
        c.fillStyle = "rgba(10,8,30,0.45)";
        c.fillRect(0, 0, W, H);
        drawText(c, "DASH RUN", W / 2, H * 0.4, Math.min(W, H) * 0.1, "#ffd23f");
        drawText(c, "TAP / SPACE to start", W / 2, H * 0.52, Math.min(W, H) * 0.045, "#fff");
        drawText(c, "hold = jump higher · ↓ = slide", W / 2, H * 0.58, Math.min(W, H) * 0.032, "rgba(255,255,255,0.75)");
      }
    },

    resize(w) {
      // scale horizontal world quantities to the new width
      const r = prevW > 0 ? w / prevW : 1;
      for (const b of blocks) {
        b.x *= r;
        b.w *= r;
      }
      speed *= r;
      prevW = w;
    },
  };

  // helpers + mutable closure state declared after return for clarity
  function roundedRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawBuildings(
    c: CanvasRenderingContext2D,
    W: number,
    H: number,
    scroll: number,
    baseFy: number,
    spacing: number,
    color: string,
    seed: number,
  ) {
    c.fillStyle = color;
    const s = spacing;
    const first = Math.floor((scroll - s) / s);
    const last = Math.ceil((scroll + W + s) / s);
    for (let i = first; i <= last; i++) {
      const x = i * s - scroll;
      const rnd = mulberry32(((i % 100000) + 100000) * (seed + 1));
      const bw = s * (0.6 + rnd() * 0.4);
      const bh = H * (0.08 + rnd() * 0.18);
      const top = H * baseFy - bh;
      c.fillRect(x, top, bw, H - top);
    }
  }
}
