import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText } from "@/engine";

/**
 * stacker — drop a sliding block onto the tower. Overhang is sliced off and
 * shrinks the next block; a perfect drop grows a combo and regrows a sliver.
 * The view scrolls up as the tower climbs and the slider speeds up.
 *
 * Block x / width are stored in CSS px and rescaled on resize; the vertical
 * layout is derived from the current height every frame.
 */
export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  interface Block {
    x: number;
    w: number;
    hue: number;
  }
  interface Debris {
    x: number;
    y: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
    rot: number;
    vr: number;
    life: number;
    hue: number;
  }

  let blocks: Block[] = [];
  let movingX = 0;
  let movingW = 0;
  let dir = 1;
  let speed = 0;
  let score = 0;
  let combo = 0;
  let scroll = 0;
  let started = false;
  let dead = false;
  let flash = 0;
  let perfectPop = 0;
  let shake = 0;
  let debris: Debris[] = [];
  let prevW = ctx.width;
  let initialW = 0;

  const best = ctx.storage.get<number>("stacker.best", 0);

  const reset = () => {
    const W = ctx.width;
    initialW = W * 0.62;
    blocks = [{ x: (W - initialW) / 2, w: initialW, hue: 200 }];
    movingW = initialW;
    movingX = 0;
    dir = 1;
    speed = W * 0.55;
    score = 0;
    combo = 0;
    scroll = 0;
    started = false;
    dead = false;
    flash = 0;
    perfectPop = 0;
    shake = 0;
    debris = [];
  };
  reset();

  ctx.requestControls([{ type: "button", key: "Space", label: "DROP", id: "drop" }]);
  ctx.setStatus("Tap / Space to drop");

  const hueFor = (level: number) => (200 + level * 18) % 360;

  function spawnDebris(x: number, w: number, topY: number, hue: number, blockH: number) {
    debris.push({
      x,
      y: topY,
      w,
      h: blockH,
      vx: (x < ctx.width / 2 ? -1 : 1) * (40 + Math.random() * 60),
      vy: -30 - Math.random() * 40,
      rot: 0,
      vr: (Math.random() - 0.5) * 6,
      life: 0,
      hue,
    });
  }

  const drop = (blockH: number, baseY: number) => {
    if (dead) return;
    started = true;
    const top = blocks[blocks.length - 1];
    const left = Math.max(movingX, top.x);
    const right = Math.min(movingX + movingW, top.x + top.w);
    const overlap = right - left;
    const level = blocks.length;
    const topY = baseY - level * blockH + scroll;

    if (overlap <= 0) {
      // missed entirely
      spawnDebris(movingX, movingW, topY, hueFor(level), blockH);
      audio.lose();
      shake = 1;
      dead = true;
      if (score > best) ctx.storage.set("stacker.best", score);
      setTimeout(() => ctx.gameOver(score), 600);
      return;
    }

    // slice overhang into debris
    if (movingX < left) spawnDebris(movingX, left - movingX, topY, hueFor(level), blockH);
    if (movingX + movingW > right) spawnDebris(right, movingX + movingW - right, topY, hueFor(level), blockH);

    const perfect = Math.abs(movingX - top.x) < ctx.width * 0.012 && Math.abs(movingW - top.w) < ctx.width * 0.04;
    let placedX = left;
    let placedW = overlap;

    if (perfect) {
      combo++;
      const grow = ctx.width * 0.02;
      placedW = Math.min(initialW, overlap + grow);
      placedX = clamp(top.x - (placedW - overlap) / 2, 0, ctx.width - placedW);
      audio.tone(520 + Math.min(combo, 12) * 45, 0.1, "triangle", 0.4);
      audio.tone(780 + Math.min(combo, 12) * 45, 0.08, "triangle", 0.25);
      flash = 1;
      perfectPop = 1;
    } else {
      combo = 0;
      audio.tone(220, 0.08, "square", 0.3);
      audio.tone(160, 0.1, "sawtooth", 0.2);
    }

    blocks.push({ x: placedX, w: placedW, hue: hueFor(level) });
    score++;
    ctx.reportScore(score);

    // next slider
    movingW = placedW;
    movingX = blocks.length % 2 === 0 ? 0 : ctx.width - movingW;
    dir = movingX <= 0 ? 1 : -1;
    speed = Math.min(ctx.width * 1.5, speed + ctx.width * 0.018);
  };

  return {
    update(dt) {
      const W = ctx.width;
      const H = ctx.height;
      const blockH = H * 0.055;
      const baseY = H * 0.86;

      const dropPressed = input.pressed("Space", "ArrowDown", "w", "ArrowUp") || input.pointer.justDown;

      if (flash > 0) flash = Math.max(0, flash - dt * 3);
      if (perfectPop > 0) perfectPop = Math.max(0, perfectPop - dt * 1.6);
      if (shake > 0) shake = Math.max(0, shake - dt * 2.5);

      // debris physics
      for (const d of debris) {
        d.life += dt;
        d.vy += 700 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.rot += d.vr * dt;
      }
      debris = debris.filter((d) => d.y < H + 200 && d.life < 3);

      if (dropPressed) drop(blockH, baseY);

      if (!dead) {
        movingX += dir * speed * dt;
        if (movingX <= 0) {
          movingX = 0;
          dir = 1;
        } else if (movingX + movingW >= W) {
          movingX = W - movingW;
          dir = -1;
        }
      }

      // camera scroll so the slider stays near the top
      const desired = Math.max(0, blocks.length * blockH - (baseY - H * 0.2));
      scroll += (desired - scroll) * Math.min(1, dt * 6);
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const blockH = H * 0.055;
      const baseY = H * 0.86;

      // background shifts colour as the tower grows
      const topHue = (210 + blocks.length * 4) % 360;
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, `hsl(${topHue}, 45%, 16%)`);
      bg.addColorStop(1, `hsl(${(topHue + 40) % 360}, 50%, 8%)`);
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);

      c.save();
      if (shake > 0) {
        const s = shake * Math.min(W, H) * 0.018;
        c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }

      const drawBlock = (x: number, w: number, topY: number, hue: number) => {
        if (topY > H + blockH || topY < -blockH * 2) return;
        c.fillStyle = `hsl(${hue}, 60%, 30%)`;
        c.fillRect(x, topY, w, blockH);
        const face = c.createLinearGradient(x, topY, x, topY + blockH);
        face.addColorStop(0, `hsl(${hue}, 70%, 60%)`);
        face.addColorStop(1, `hsl(${hue}, 65%, 45%)`);
        c.fillStyle = face;
        c.fillRect(x, topY, w, blockH * 0.82);
        c.fillStyle = `hsl(${hue}, 85%, 72%)`;
        c.fillRect(x, topY, w, Math.max(2, blockH * 0.14));
      };

      // placed blocks
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const topY = baseY - i * blockH + scroll;
        drawBlock(b.x, b.w, topY, b.hue);
      }

      // moving slider
      if (!dead) {
        const level = blocks.length;
        const topY = baseY - level * blockH + scroll;
        drawBlock(movingX, movingW, topY, hueFor(level));
        // guide line down to the stack top
        c.strokeStyle = "rgba(255,255,255,0.12)";
        c.lineWidth = 1;
        c.setLineDash([4, 6]);
        c.beginPath();
        c.moveTo(movingX + movingW / 2, topY + blockH);
        c.lineTo(movingX + movingW / 2, baseY - (level - 1) * blockH + scroll);
        c.stroke();
        c.setLineDash([]);
      }

      // debris
      for (const d of debris) {
        const a = clamp(1 - d.life / 2.5, 0, 1);
        c.save();
        c.globalAlpha = a;
        c.translate(d.x + d.w / 2, d.y + d.h / 2);
        c.rotate(d.rot);
        c.fillStyle = `hsl(${d.hue}, 65%, 52%)`;
        c.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        c.restore();
      }
      c.globalAlpha = 1;

      c.restore(); // shake

      // perfect flash
      if (flash > 0) {
        c.fillStyle = `rgba(255,255,255,${flash * 0.25})`;
        c.fillRect(0, 0, W, H);
      }

      // HUD
      drawText(c, String(score), W / 2, H * 0.1, Math.min(W, H) * 0.1, "#fff");
      drawText(c, `BEST ${Math.max(best, score)}`, W / 2, H * 0.17, Math.min(W, H) * 0.035, "rgba(255,255,255,0.7)");
      if (combo > 1) {
        const s = Math.min(W, H) * (0.045 + perfectPop * 0.03);
        drawText(c, `PERFECT x${combo}`, W / 2, H * 0.24, s, "#ffe066");
      }

      if (!started) {
        c.fillStyle = "rgba(8,10,24,0.5)";
        c.fillRect(0, 0, W, H);
        drawText(c, "STACKER", W / 2, H * 0.4, Math.min(W, H) * 0.1, "#ffd23f");
        drawText(c, "TAP / SPACE to drop", W / 2, H * 0.5, Math.min(W, H) * 0.04, "#fff");
        drawText(c, "line it up · perfect = combo", W / 2, H * 0.55, Math.min(W, H) * 0.032, "rgba(255,255,255,0.75)");
      }
    },

    resize(w) {
      const r = prevW > 0 ? w / prevW : 1;
      for (const b of blocks) {
        b.x *= r;
        b.w *= r;
      }
      for (const d of debris) {
        d.x *= r;
        d.w *= r;
      }
      movingX *= r;
      movingW *= r;
      speed *= r;
      initialW *= r;
      prevW = w;
    },
  };
}
