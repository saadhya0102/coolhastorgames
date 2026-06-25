import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, roundRect, rng } from "@/engine";

type PType = "normal" | "moving" | "breakable" | "spring";

interface Plat {
  x: number;
  y: number;
  w: number;
  h: number;
  type: PType;
  vx: number;
  broken: boolean;
  fallV: number;
  wob: number;
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

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  let plats: Plat[] = [];
  let parts: Particle[] = [];
  let px = 0;
  let py = 0;
  let vx = 0;
  let vy = 0;
  let pr = 0;
  let scoreF = 0;
  let score = 0;
  let best = storage.get<number>("best", 0);
  let dead = false;
  let started = false;
  let t = 0;
  let facing = 1;
  let squash = 0;
  let lastType: PType = "normal";
  let lastW = Math.max(1, ctx.width);
  let lastH = Math.max(1, ctx.height);

  ctx.requestControls([{ type: "dpad" }]);
  ctx.setStatus("Arrows / drag to steer · auto-bounce up!");

  const spawnParts = (x: number, y: number, n: number, col: string) => {
    const H = ctx.height;
    const W = ctx.width;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = H * rng.range(0.08, 0.42);
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - H * 0.12,
        life: rng.range(0.3, 0.65),
        max: 0.65,
        col,
        r: W * rng.range(0.006, 0.018),
      });
    }
  };

  function pickType(): PType {
    const d = clamp(scoreF / 600, 0, 1);
    const roll = Math.random();
    let type: PType;
    if (roll < 0.06) type = "spring";
    else if (roll < 0.06 + 0.1 + 0.18 * d) type = "breakable";
    else if (roll < 0.06 + 0.1 + 0.18 * d + 0.08 + 0.24 * d) type = "moving";
    else type = "normal";
    if (type === "breakable" && lastType === "breakable") type = "normal";
    lastType = type;
    return type;
  }

  function spawnPlat(y: number) {
    const W = ctx.width;
    const H = ctx.height;
    const type = pickType();
    const w = W * rng.range(0.2, 0.3);
    const x = rng.range(0, W - w);
    const speed = W * rng.range(0.18, 0.36);
    plats.push({
      x,
      y,
      w,
      h: H * 0.024,
      type,
      vx: type === "moving" ? (Math.random() < 0.5 ? -speed : speed) : 0,
      broken: false,
      fallV: 0,
      wob: Math.random() * Math.PI * 2,
    });
  }

  function initWorld() {
    const W = ctx.width;
    const H = ctx.height;
    plats = [];
    parts = [];
    lastType = "normal";
    px = W / 2;
    py = H * 0.55;
    vx = 0;
    vy = 0;
    scoreF = 0;
    score = 0;
    dead = false;
    started = false;
    // guaranteed base under the player
    const baseW = W * 0.32;
    plats.push({
      x: W / 2 - baseW / 2,
      y: H * 0.72,
      w: baseW,
      h: H * 0.024,
      type: "normal",
      vx: 0,
      broken: false,
      fallV: 0,
      wob: 0,
    });
    let y = H * 0.72;
    while (y > -H * 0.1) {
      y -= H * 0.16;
      spawnPlat(y);
    }
  }
  initWorld();

  function die() {
    if (dead) return;
    dead = true;
    audio.lose();
    spawnParts(px, py, 22, "#ff6b8a");
    if (score > best) {
      best = score;
      storage.set("best", best);
    }
    setTimeout(() => ctx.gameOver(score), 700);
  }

  function topMostY(): number {
    let top = Infinity;
    for (const p of plats) if (p.y < top) top = p.y;
    return top;
  }

  return {
    update(dt) {
      t += dt;
      const W = ctx.width;
      const H = ctx.height;
      pr = W * 0.062;
      const grav = H * 2.3;
      const moveSpeed = W * 1.05;
      const bounceV = -Math.sqrt(2 * grav * H * 0.26);
      const springV = -Math.sqrt(2 * grav * H * 0.52);

      // ---- steering ----
      let dirX = 0;
      if (input.isDown("ArrowLeft", "a")) dirX -= 1;
      if (input.isDown("ArrowRight", "d")) dirX += 1;
      if (dirX !== 0) {
        vx = dirX * moveSpeed;
        facing = dirX > 0 ? 1 : -1;
        started = true;
      } else if (input.pointer.down) {
        let d = input.pointer.x - px;
        if (d > W / 2) d -= W;
        if (d < -W / 2) d += W;
        vx = clamp(d * 9, -moveSpeed, moveSpeed);
        if (Math.abs(d) > 2) facing = d > 0 ? 1 : -1;
        started = true;
      } else {
        vx *= Math.exp(-dt * 9);
      }

      if (!dead) {
        const oldFeet = py + pr;
        vy += grav * dt;
        py += vy * dt;
        px += vx * dt;
        if (px < 0) px += W;
        else if (px > W) px -= W;
        const newFeet = py + pr;

        for (const p of plats) {
          if (p.broken) {
            p.fallV += grav * dt;
            p.y += p.fallV * dt;
            p.wob += dt * 14;
            continue;
          }
          if (p.type === "moving") {
            p.x += p.vx * dt;
            if (p.x < 0) {
              p.x = 0;
              p.vx = Math.abs(p.vx);
            } else if (p.x + p.w > W) {
              p.x = W - p.w;
              p.vx = -Math.abs(p.vx);
            }
          }
          if (vy > 0) {
            const half = pr * 0.7;
            const overlaps = (cx: number) => cx + half > p.x && cx - half < p.x + p.w;
            const over = overlaps(px) || overlaps(px - W) || overlaps(px + W);
            if (over && oldFeet <= p.y + p.h && newFeet >= p.y) {
              py = p.y - pr;
              squash = 1;
              if (p.type === "spring") {
                vy = springV;
                audio.sweep(280, 1150, 0.26, "sine", 0.45);
                spawnParts(px, p.y, 18, "#ffd23f");
              } else if (p.type === "breakable") {
                vy = bounceV;
                p.broken = true;
                p.fallV = -H * 0.12;
                audio.tone(170, 0.18, "sawtooth", 0.3);
                spawnParts(px, p.y, 14, "#c98a5a");
              } else {
                vy = bounceV;
                audio.tone(520, 0.06, "square", 0.22);
                spawnParts(px, p.y, 7, "#8defa0");
              }
            }
          }
        }

        // ---- camera follow ----
        const thresh = H * 0.4;
        if (py < thresh) {
          const dy = thresh - py;
          py = thresh;
          for (const p of plats) p.y += dy;
          for (const pa of parts) pa.y += dy;
          scoreF += dy / (H * 0.08);
          const ns = Math.floor(scoreF);
          if (ns !== score) {
            score = ns;
            ctx.reportScore(score);
          }
        }

        // cull + refill
        plats = plats.filter((p) => p.y < H + p.h * 3 && !(p.broken && p.y > H));
        let top = topMostY();
        while (top > -H * 0.12) {
          const gap = H * (0.13 + Math.min(0.09, scoreF / 5000));
          top -= gap;
          spawnPlat(top);
        }

        if (py - pr > H) die();
      }

      // particles
      for (const pa of parts) {
        pa.life -= dt;
        pa.vy += H * 1.4 * dt;
        pa.x += pa.vx * dt;
        pa.y += pa.vy * dt;
      }
      parts = parts.filter((pa) => pa.life > 0);
      squash *= Math.exp(-dt * 9);
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      // sky gradient that shifts with height
      const hue = (200 + scoreF * 0.6) % 360;
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, `hsl(${hue}, 60%, 16%)`);
      sky.addColorStop(1, `hsl(${(hue + 40) % 360}, 55%, 32%)`);
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H);

      // parallax stars
      c.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97.3) % W;
        const sy = ((i * 53.7 + scoreF * 1.5) % H + H) % H;
        const r = (i % 3) * 0.4 + 0.6;
        c.globalAlpha = 0.25 + ((i * 7) % 10) / 20;
        c.fillRect(sx, sy, r, r);
      }
      c.globalAlpha = 1;

      // platforms
      for (const p of plats) {
        c.save();
        if (p.broken) {
          c.globalAlpha = clamp(1 - p.fallV / (H * 1.5), 0.1, 1);
          c.translate(p.x + p.w / 2, p.y + p.h / 2);
          c.rotate(Math.sin(p.wob) * 0.2);
          c.translate(-(p.x + p.w / 2), -(p.y + p.h / 2));
        }
        drawPlat(c, p, H);
        c.restore();
      }
      c.globalAlpha = 1;

      // particles
      for (const pa of parts) {
        c.globalAlpha = clamp(pa.life / pa.max, 0, 1);
        c.fillStyle = pa.col;
        c.beginPath();
        c.arc(pa.x, pa.y, pa.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      // player (with horizontal wrap copies)
      drawPlayer(c, px, W, H);
      if (px < pr * 2) drawPlayer(c, px + W, W, H);
      if (px > W - pr * 2) drawPlayer(c, px - W, W, H);

      // fall-danger telegraph: glow red as the player drops toward the bottom
      if (!dead && vy > 0) {
        const danger = clamp((py - H * 0.62) / (H * 0.36), 0, 1);
        if (danger > 0.01) {
          const dg = c.createLinearGradient(0, H, 0, H * 0.68);
          dg.addColorStop(0, `rgba(255,50,80,${danger * 0.5})`);
          dg.addColorStop(1, "rgba(255,50,80,0)");
          c.fillStyle = dg;
          c.fillRect(0, H * 0.68, W, H * 0.32);
        }
      }

      // HUD
      drawText(c, String(score), W * 0.5, H * 0.08, H * 0.07, "#fff");
      drawText(c, `BEST ${Math.max(best, score)}`, W * 0.5, H * 0.14, H * 0.028, "rgba(255,255,255,0.6)");
      if (!started && !dead) {
        c.fillStyle = "rgba(0,0,0,0.35)";
        roundRect(c, W * 0.12, H * 0.46, W * 0.76, H * 0.1, H * 0.02);
        c.fill();
        drawText(c, "STEER LEFT / RIGHT", W * 0.5, H * 0.51, H * 0.035, "#fff");
      }
    },

    resize(w, h) {
      const sx = w / lastW;
      const sy = h / lastH;
      px *= sx;
      py *= sy;
      for (const p of plats) {
        p.x *= sx;
        p.y *= sy;
        p.w *= sx;
        p.h *= sy;
      }
      for (const pa of parts) {
        pa.x *= sx;
        pa.y *= sy;
      }
      lastW = w;
      lastH = h;
    },
  };

  function drawPlat(c: CanvasRenderingContext2D, p: Plat, H: number) {
    const r = p.h * 0.5;
    let body = "#5dd66a";
    let edge = "#2f9c41";
    if (p.type === "moving") {
      body = "#5aa8ff";
      edge = "#2f6fd6";
    } else if (p.type === "breakable") {
      body = "#c98a5a";
      edge = "#8a5a34";
    }
    c.fillStyle = edge;
    roundRect(c, p.x, p.y + p.h * 0.35, p.w, p.h * 0.8, r);
    c.fill();
    c.fillStyle = body;
    roundRect(c, p.x, p.y, p.w, p.h, r);
    c.fill();
    if (p.type === "breakable") {
      c.strokeStyle = "rgba(0,0,0,0.25)";
      c.lineWidth = Math.max(1, p.h * 0.08);
      c.beginPath();
      c.moveTo(p.x + p.w * 0.5, p.y);
      c.lineTo(p.x + p.w * 0.45, p.y + p.h);
      c.stroke();
    }
    if (p.type === "spring") {
      const sx = p.x + p.w * 0.5;
      const sh = p.h * 1.4;
      c.strokeStyle = "#ffd23f";
      c.lineWidth = Math.max(2, p.h * 0.18);
      c.beginPath();
      for (let i = 0; i <= 6; i++) {
        const yy = p.y - (sh * i) / 6;
        const xx = sx + (i % 2 === 0 ? -p.w * 0.12 : p.w * 0.12);
        if (i === 0) c.moveTo(xx, yy);
        else c.lineTo(xx, yy);
      }
      c.stroke();
      c.fillStyle = "#ff8c2b";
      roundRect(c, sx - p.w * 0.16, p.y - sh - p.h * 0.4, p.w * 0.32, p.h * 0.5, p.h * 0.2);
      c.fill();
    }
  }

  function drawPlayer(c: CanvasRenderingContext2D, cx: number, W: number, H: number) {
    const stretch = clamp(-vy / (H * 1.6), -0.22, 0.32);
    let sy = (1 + stretch) * (1 - squash * 0.35);
    let sxc = (1 - stretch * 0.6) * (1 + squash * 0.35);
    sy = clamp(sy, 0.65, 1.45);
    sxc = clamp(sxc, 0.7, 1.4);
    c.save();
    c.translate(cx, py);
    // shadow squash glow
    c.scale(sxc, sy);
    // body
    c.fillStyle = "#7c5cff";
    c.beginPath();
    c.ellipse(0, 0, pr, pr * 1.05, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#9d83ff";
    c.beginPath();
    c.ellipse(0, -pr * 0.2, pr * 0.8, pr * 0.8, 0, 0, Math.PI * 2);
    c.fill();
    // feet
    c.fillStyle = "#5a3fd6";
    c.beginPath();
    c.ellipse(-pr * 0.45, pr * 0.85, pr * 0.32, pr * 0.2, 0, 0, Math.PI * 2);
    c.ellipse(pr * 0.45, pr * 0.85, pr * 0.32, pr * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    // eyes
    const ex = facing * pr * 0.28;
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(ex - pr * 0.22, -pr * 0.25, pr * 0.26, 0, Math.PI * 2);
    c.arc(ex + pr * 0.22, -pr * 0.25, pr * 0.26, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#1a1330";
    c.beginPath();
    c.arc(ex - pr * 0.18 + facing * pr * 0.06, -pr * 0.22, pr * 0.12, 0, Math.PI * 2);
    c.arc(ex + pr * 0.26 + facing * pr * 0.06, -pr * 0.22, pr * 0.12, 0, Math.PI * 2);
    c.fill();
    // smile
    c.strokeStyle = "#1a1330";
    c.lineWidth = pr * 0.1;
    c.beginPath();
    c.arc(ex, pr * 0.1, pr * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.restore();
  }
}
