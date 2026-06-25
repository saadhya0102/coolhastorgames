import type { GameContext, GameInstance } from "@/engine";
import { drawText, roundRect } from "@/engine";

export function create(ctx: GameContext): GameInstance {
  const { input, audio } = ctx;

  interface Pipe {
    x: number;
    gapY: number;
    scored: boolean;
  }

  let birdY = 0;
  let birdV = 0;
  let rot = 0;
  let pipes: Pipe[] = [];
  let spawnT = 0;
  let score = 0;
  let started = false;
  let dead = false;
  let t = 0;

  const reset = () => {
    birdY = ctx.height * 0.4;
    birdV = 0;
    pipes = [];
    spawnT = 0;
    score = 0;
    started = false;
    dead = false;
  };
  reset();

  ctx.requestControls([{ type: "button", key: "Space", label: "FLAP", id: "flap" }]);
  ctx.setStatus("Tap / Space to flap");

  const flap = () => {
    if (dead) return;
    started = true;
    birdV = -ctx.height * 0.62;
    audio.jump();
  };

  return {
    update(dt) {
      t += dt;
      const W = ctx.width;
      const H = ctx.height;
      const grav = H * 1.85;
      const birdX = W * 0.28;
      const r = H * 0.035;

      if (input.pressed("Space", "ArrowUp", "w") || input.pointer.justDown) flap();

      if (!started || dead) return;

      birdV += grav * dt;
      birdY += birdV * dt;
      rot = Math.max(-0.5, Math.min(1.2, birdV / (H * 1.2)));

      const speed = W * 0.42;
      const gap = H * 0.3;
      const pipeW = W * 0.16;

      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = 1.35;
        const margin = H * 0.12;
        const gapY = margin + Math.random() * (H - gap - margin * 2);
        pipes.push({ x: W + pipeW, gapY, scored: false });
      }

      for (const p of pipes) {
        p.x -= speed * dt;
        if (!p.scored && p.x + pipeW < birdX) {
          p.scored = true;
          score++;
          ctx.reportScore(score);
          audio.coin();
        }
        // collision
        const inX = birdX + r > p.x && birdX - r < p.x + pipeW;
        if (inX && (birdY - r < p.gapY || birdY + r > p.gapY + gap)) {
          die();
        }
      }
      pipes = pipes.filter((p) => p.x + pipeW > -10);

      const ground = H * 0.92;
      if (birdY + r > ground || birdY - r < 0) die();
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      // sky
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#4ec0ff");
      sky.addColorStop(1, "#bde6ff");
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H);

      // clouds (parallax)
      c.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 220 - t * 18) % (W + 120)) + 60;
        const cy = H * (0.15 + i * 0.12);
        c.beginPath();
        c.ellipse(cx, cy, 40, 18, 0, 0, Math.PI * 2);
        c.fill();
      }

      const gap = H * 0.3;
      const pipeW = W * 0.16;
      // pipes
      for (const p of pipes) {
        c.fillStyle = "#37c14a";
        c.strokeStyle = "#1e7a2c";
        c.lineWidth = 3;
        roundRect(c, p.x, -10, pipeW, p.gapY + 10, 6);
        c.fill();
        c.stroke();
        roundRect(c, p.x, p.gapY + gap, pipeW, H - p.gapY - gap, 6);
        c.fill();
        c.stroke();
        // lips
        c.fillStyle = "#46d15c";
        c.fillRect(p.x - 4, p.gapY - 18, pipeW + 8, 18);
        c.fillRect(p.x - 4, p.gapY + gap, pipeW + 8, 18);
      }

      // ground
      const ground = H * 0.92;
      c.fillStyle = "#ded28a";
      c.fillRect(0, ground, W, H - ground);
      c.fillStyle = "#caa45a";
      c.fillRect(0, ground, W, 6);

      // bird
      const birdX = W * 0.28;
      const r = H * 0.035;
      c.save();
      c.translate(birdX, birdY);
      c.rotate(rot);
      c.fillStyle = "#ffd23f";
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ff9f1c";
      c.beginPath();
      c.moveTo(r * 0.6, 0);
      c.lineTo(r * 1.5, -r * 0.2);
      c.lineTo(r * 0.6, r * 0.4);
      c.fill();
      // wing
      c.fillStyle = "#ffb700";
      const wing = Math.sin(t * 18) * r * 0.4;
      c.beginPath();
      c.ellipse(-r * 0.2, wing, r * 0.55, r * 0.35, 0, 0, Math.PI * 2);
      c.fill();
      // eye
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(r * 0.35, -r * 0.35, r * 0.28, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#222";
      c.beginPath();
      c.arc(r * 0.45, -r * 0.35, r * 0.13, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // score
      drawText(c, String(score), W / 2, H * 0.16, H * 0.09, "#fff");
      c.lineWidth = 2;
      if (!started) {
        drawText(c, "TAP TO START", W / 2, H * 0.5, H * 0.05, "rgba(0,0,0,0.55)");
      }
    },

    resize() {
      if (!started) birdY = ctx.height * 0.4;
    },
  };

  function die() {
    if (dead) return;
    dead = true;
    audio.hit();
    setTimeout(() => ctx.gameOver(score), 350);
  }
}
