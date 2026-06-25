import { clamp, drawText } from "@/engine";
import type { Screen, ScreenEnv } from "./screen";
import { DT_CLAMP } from "./screen";
import { PALETTE, rgba } from "./theme";
import { sky, clouds, hills, grass } from "./backdrop";
import { drawDuck } from "./duck";
import { Particles, Shake, FloatingText } from "./fx";
import { ResultCard, drawCountdown, drawMiniHud, type MiniResult } from "./common";

const RUN_TIME = 30;

type Phase = "count" | "play" | "done";

interface Obstacle {
  x: number;
  w: number;
  h: number;
  tall: boolean;
  hit: boolean;
}
interface Seed {
  x: number;
  y: number;
  got: boolean;
}

export function createRun(env: ScreenEnv, onDone: (xp: number) => void): Screen {
  const { ctx, look } = env;
  const { input, audio } = ctx;
  const particles = new Particles();
  const shake = new Shake();
  const floats = new FloatingText();

  let phase: Phase = "count";
  let countT = 3.6;
  let timeLeft = RUN_TIME;
  let t = 0;

  // duck physics (y relative to ground line, 0 = on ground; negative = up)
  let duckY = 0;
  let vy = 0;
  let onGround = true;
  let canFlutter = false;
  let runPhase = 0;
  let stumble = 0;

  let dist = 0;
  let seeds = 0;
  let combo = 1;
  let comboTimer = 0;
  let worldSpeed = 0;

  const obstacles: Obstacle[] = [];
  const seedList: Seed[] = [];
  let obTimer = 1.2;
  let seedTimer = 0.8;
  let earnedXp = 0;
  let closed = false;

  let result: ResultCard | null = null;

  ctx.requestControls([{ type: "button", key: "Space", label: "JUMP", id: "jump" }]);
  ctx.setStatus("Jump the rocks, grab the seeds!");

  const groundY = () => ctx.height * 0.8;
  const duckX = () => ctx.width * 0.26;
  const duckUnit = () => Math.min(ctx.width, ctx.height) * 0.07;

  const jump = () => {
    if (phase !== "play") return;
    if (onGround) {
      vy = -ctx.height * 0.95;
      onGround = false;
      canFlutter = true;
      audio.jump();
      particles.dust(duckX(), groundY(), 1);
    } else if (canFlutter && vy > -ctx.height * 0.2) {
      vy = -ctx.height * 0.62;
      canFlutter = false;
      audio.tone(520, 0.08, "sine", 0.3);
      particles.burst(duckX() - duckUnit() * 0.5, groundY() + duckY - duckUnit(), 4, [look.body, "#fff"], {
        speed: 80,
        size: 4,
        life: 0.4,
        gravity: 200,
      });
    }
  };

  const finish = () => {
    phase = "done";
    earnedXp = Math.round(dist * 0.012 + seeds * 1.0);
    audio.win();
    const r: MiniResult = {
      title: "Nice running!",
      lines: [
        { label: "Distance", value: `${Math.round(dist)} m`, color: PALETTE.ink },
        { label: "Seeds", value: `${seeds}`, color: PALETTE.accent },
        { label: "XP Earned", value: `+${earnedXp}`, color: PALETTE.run },
      ],
    };
    result = new ResultCard(r);
  };

  const spawnObstacle = (W: number) => {
    const tall = Math.random() < 0.4;
    const u = duckUnit();
    obstacles.push({
      x: W + u,
      w: u * (tall ? 0.7 : 1.1),
      h: tall ? u * 1.5 : u * 0.7,
      tall,
      hit: false,
    });
  };
  const spawnSeed = (W: number) => {
    const u = duckUnit();
    const baseY = groundY() - u * (1.2 + Math.random() * 2.2);
    const n = 1 + (Math.random() * 3) | 0;
    for (let i = 0; i < n; i++) {
      seedList.push({ x: W + u + i * u * 0.9, y: baseY - Math.sin(i * 0.8) * u * 0.6, got: false });
    }
  };

  return {
    update(dt) {
      const d = Math.min(dt, DT_CLAMP);
      t += d;
      particles.update(d);
      shake.update(d);
      floats.update(d);

      if (phase === "count") {
        countT -= d;
        if (countT <= 0) phase = "play";
        return;
      }

      if (phase === "done") {
        result?.update(d);
        if (!closed && result?.handle(ctx)) {
          closed = true;
          onDone(earnedXp);
        }
        return;
      }

      // play
      const W = ctx.width;
      const H = ctx.height;
      timeLeft -= d;
      const ramp = 1 - timeLeft / RUN_TIME;
      worldSpeed = W * (0.42 + ramp * 0.4) * (stumble > 0 ? 0.45 : 1);
      dist += worldSpeed * d * 0.06;

      if (input.pressed("Space", "ArrowUp", "w") || input.pointer.justDown) jump();

      // physics
      const grav = H * 2.6;
      const holding = input.isDown("Space", "ArrowUp", "w") || input.pointer.down;
      vy += grav * d * (holding && vy < 0 ? 0.55 : 1);
      duckY += vy * d;
      if (duckY >= 0) {
        if (!onGround) particles.dust(duckX(), groundY(), 1);
        duckY = 0;
        vy = 0;
        onGround = true;
      }
      if (onGround) runPhase += worldSpeed * d * 0.012;

      if (stumble > 0) stumble -= d;
      if (comboTimer > 0) {
        comboTimer -= d;
        if (comboTimer <= 0) combo = 1;
      }

      // spawn
      obTimer -= d;
      if (obTimer <= 0) {
        spawnObstacle(W);
        obTimer = (0.9 + Math.random() * 0.9) / (0.7 + ramp * 0.8);
      }
      seedTimer -= d;
      if (seedTimer <= 0) {
        spawnSeed(W);
        seedTimer = 1.1 + Math.random() * 1.2;
      }

      const dx = duckX();
      const u = duckUnit();
      const dyAbs = groundY() + duckY - u * 0.9; // duck center
      // obstacles
      for (const o of obstacles) {
        o.x -= worldSpeed * d;
        if (!o.hit) {
          const oy = groundY() - o.h;
          const overlapX = dx + u * 0.5 > o.x && dx - u * 0.6 < o.x + o.w;
          const overlapY = groundY() + duckY > oy;
          if (overlapX && overlapY) {
            o.hit = true;
            stumble = 0.7;
            combo = 1;
            audio.hit();
            shake.add(14);
            particles.burst(o.x, oy, 8, ["#caa15a", "#9c7536"], { speed: 120, size: 4, life: 0.5 });
            floats.add(dx, dyAbs - u, "Ouch!", PALETTE.bad, u * 0.6);
          }
        }
      }
      for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].x + obstacles[i].w < -u) obstacles.splice(i, 1);

      // seeds
      for (const s of seedList) {
        s.x -= worldSpeed * d;
        if (!s.got) {
          const dd = Math.hypot(s.x - dx, s.y - dyAbs);
          if (dd < u * 1.0) {
            s.got = true;
            seeds++;
            combo = Math.min(9, combo + 1);
            comboTimer = 2.2;
            audio.coin();
            particles.burst(s.x, s.y, 6, [PALETTE.coin, "#fff"], { speed: 110, size: 3, life: 0.45, gravity: 120 });
            floats.add(s.x, s.y, combo > 1 ? `+1 x${combo}` : "+1", PALETTE.accent, u * 0.55);
          }
        }
      }
      for (let i = seedList.length - 1; i >= 0; i--) if (seedList[i].x < -u) seedList.splice(i, 1);

      if (timeLeft <= 0) finish();
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const u = duckUnit();
      const gY = groundY();

      sky(c, W, H, "#9fd9ff", "#e8f7ff");
      clouds(c, W, H, t, { speed: 14, count: 4 });
      hills(c, W, H, t * 0.6, gY, ["#a7d977", "#7bc456"]);
      // tree line parallax
      drawTrees(c, W, gY, t);

      c.save();
      c.translate(shake.x, shake.y);

      grass(c, W, H, gY, t * 18 % 1000, "#86cf52", "#4f9a36", "#73bf45");

      // obstacles
      for (const o of obstacles) {
        const oy = gY - o.h;
        if (o.tall) {
          c.fillStyle = "#9a6a3a";
          c.fillRect(o.x, oy, o.w, o.h);
          c.fillStyle = "#7d542c";
          c.fillRect(o.x, oy, o.w * 0.3, o.h);
          c.fillStyle = "#caa15a";
          c.fillRect(o.x - o.w * 0.1, oy, o.w * 1.2, o.h * 0.16);
        } else {
          c.fillStyle = "#8b8f99";
          c.beginPath();
          c.ellipse(o.x + o.w / 2, gY, o.w * 0.7, o.h, 0, Math.PI, 0);
          c.fill();
          c.fillStyle = rgba("#ffffff", 0.25);
          c.beginPath();
          c.ellipse(o.x + o.w * 0.35, gY - o.h * 0.4, o.w * 0.25, o.h * 0.35, 0, 0, Math.PI * 2);
          c.fill();
        }
      }

      // seeds
      for (const s of seedList) {
        if (s.got) continue;
        c.fillStyle = PALETTE.coin;
        c.beginPath();
        c.ellipse(s.x, s.y + Math.sin(t * 6 + s.x) * 2, u * 0.16, u * 0.22, 0.4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#b8860b";
        c.beginPath();
        c.ellipse(s.x, s.y - u * 0.1, u * 0.06, u * 0.1, 0.4, 0, Math.PI * 2);
        c.fill();
      }

      // duck
      const airborne = !onGround;
      drawDuck(c, duckX(), gY + duckY - u * 0.9, u, look, {
        pose: "run",
        t,
        phase: runPhase,
        flip: false,
        squash: airborne ? 1.04 : 1,
        glance: 0.4,
      });

      // speed lines
      if (worldSpeed > W * 0.6) {
        c.strokeStyle = rgba("#ffffff", 0.4);
        c.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const ly = gY - u * (0.5 + i * 0.6) - ((t * 600 + i * 90) % 60);
          c.beginPath();
          c.moveTo(duckX() - u * 1.2, ly);
          c.lineTo(duckX() - u * 2.2, ly);
          c.stroke();
        }
      }

      particles.render(c);
      floats.render(c);
      c.restore();

      if (phase === "play" || phase === "done") {
        drawMiniHud(ctx, timeLeft, RUN_TIME, "Seeds", String(seeds), PALETTE.run);
        if (combo > 1) drawText(c, `Combo x${combo}`, W * 0.5, H * 0.09, H * 0.04, PALETTE.accent, "center", "800");
      }
      if (phase === "count") drawCountdown(c, W, H, Math.ceil(countT - 0.6), (countT - 0.6) - Math.floor(countT - 0.6));
      if (phase === "done") result?.render(ctx);
    },

    destroy() {
      ctx.requestControls([]);
    },
  };
}

function drawTrees(c: CanvasRenderingContext2D, W: number, gY: number, t: number): void {
  const spacing = W * 0.32;
  const off = (t * 30) % spacing;
  for (let x = -off; x < W + spacing; x += spacing) {
    const h = gY * 0.18;
    c.fillStyle = "#5d8a3a";
    c.beginPath();
    c.arc(x, gY - h, h * 0.9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#6ea344";
    c.beginPath();
    c.arc(x - h * 0.4, gY - h * 0.8, h * 0.6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#7a5230";
    c.fillRect(x - h * 0.1, gY - h * 0.6, h * 0.2, h * 0.6);
  }
}
