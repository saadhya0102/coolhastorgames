import { clamp } from "@/engine";
import type { Screen, ScreenEnv } from "./screen";
import { DT_CLAMP } from "./screen";
import { PALETTE, rgba } from "./theme";
import { sky, sun, clouds } from "./backdrop";
import { drawDuck } from "./duck";
import { Particles, Shake, FloatingText } from "./fx";
import { ResultCard, drawCountdown, drawMiniHud, type MiniResult } from "./common";

const RUN_TIME = 30;

type Phase = "count" | "play" | "done";

interface Ring {
  x: number;
  y: number;
  r: number;
  golden: boolean;
  got: boolean;
}
interface Bird {
  x: number;
  y: number;
  baseY: number;
  amp: number;
  speed: number;
  phase: number;
  hit: boolean;
}

export function createFly(env: ScreenEnv, onDone: (xp: number) => void): Screen {
  const { ctx, look } = env;
  const { input, audio } = ctx;
  const particles = new Particles();
  const shake = new Shake();
  const floats = new FloatingText();

  let phase: Phase = "count";
  let countT = 3.6;
  let timeLeft = RUN_TIME;
  let t = 0;

  let duckWorldY = 0;
  let vy = 0;
  let camY = 0;
  let flapCooldown = 0;
  let flapPhase = 0;
  let flapRate = 0.6;
  let bonk = 0;
  let inited = false;

  let dist = 0;
  let rings = 0;
  let worldSpeed = 0;
  let earnedXp = 0;
  let closed = false;

  const ringList: Ring[] = [];
  const birds: Bird[] = [];
  let ringTimer = 0.8;
  let birdTimer = 2.2;

  let result: ResultCard | null = null;

  ctx.requestControls([{ type: "button", key: "Space", label: "FLAP", id: "flap" }]);
  ctx.setStatus("Flap to stay aloft! Fly through rings, dodge birds.");

  const worldH = () => ctx.height * 2.0;
  const duckX = () => ctx.width * 0.28;
  const duckUnit = () => Math.min(ctx.width, ctx.height) * 0.065;
  const bandTop = () => duckUnit() * 1.2;
  const bandBot = () => worldH() - duckUnit() * 1.6;

  const flap = () => {
    if (phase !== "play" || flapCooldown > 0) return;
    vy = -ctx.height * 0.78;
    flapCooldown = 0.16;
    flapRate = 2.6;
    flapPhase = 0;
    audio.jump();
    particles.burst(duckX() - duckUnit() * 0.6, duckWorldY - camY + duckUnit() * 0.2, 5, [look.body, "#fff"], {
      speed: 90,
      size: 4,
      life: 0.45,
      gravity: 220,
    });
  };

  const finish = () => {
    phase = "done";
    earnedXp = Math.round(dist * 0.01 + rings * 1.4);
    audio.win();
    const r: MiniResult = {
      title: "Sky high!",
      lines: [
        { label: "Distance", value: `${Math.round(dist)} m`, color: PALETTE.ink },
        { label: "Rings", value: `${rings}`, color: PALETTE.fly },
        { label: "XP Earned", value: `+${earnedXp}`, color: PALETTE.fly },
      ],
    };
    result = new ResultCard(r);
  };

  const spawnRing = (W: number) => {
    const golden = Math.random() < 0.18;
    ringList.push({
      x: W + duckUnit() * 2,
      y: bandTop() + Math.random() * (bandBot() - bandTop()),
      r: duckUnit() * (golden ? 1.0 : 1.25),
      golden,
      got: false,
    });
  };
  const spawnBird = (W: number) => {
    const baseY = bandTop() + Math.random() * (bandBot() - bandTop());
    birds.push({
      x: W + duckUnit() * 2,
      y: baseY,
      baseY,
      amp: duckUnit() * (1 + Math.random() * 2),
      speed: 1 + Math.random() * 1.5,
      phase: Math.random() * 10,
      hit: false,
    });
  };

  return {
    update(dt) {
      const d = Math.min(dt, DT_CLAMP);
      t += d;
      particles.update(d);
      shake.update(d);
      floats.update(d);
      flapPhase += d * flapRate;
      flapRate = Math.max(0.6, flapRate - d * 4);

      if (!inited) {
        duckWorldY = worldH() * 0.4;
        camY = clamp(duckWorldY - ctx.height / 2, 0, worldH() - ctx.height);
        inited = true;
      }

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

      const W = ctx.width;
      timeLeft -= d;
      const ramp = 1 - timeLeft / RUN_TIME;
      worldSpeed = W * (0.4 + ramp * 0.34);
      dist += worldSpeed * d * 0.06;
      if (flapCooldown > 0) flapCooldown -= d;
      if (bonk > 0) bonk -= d;

      if (input.pressed("Space", "ArrowUp", "w") || input.pointer.justDown) flap();

      // physics
      vy += ctx.height * 1.7 * d;
      vy = clamp(vy, -ctx.height * 1.2, ctx.height * 1.1);
      duckWorldY += vy * d;
      // bonk ceiling / floor
      if (duckWorldY < bandTop()) {
        duckWorldY = bandTop();
        if (vy < 0) {
          vy = 0;
          if (bonk <= 0) {
            bonk = 0.4;
            audio.hit();
            shake.add(8);
          }
        }
      }
      if (duckWorldY > bandBot()) {
        duckWorldY = bandBot();
        vy = -Math.abs(vy) * 0.3;
        if (bonk <= 0) {
          bonk = 0.4;
          audio.hit();
          shake.add(10);
        }
      }
      // camera ease
      const targetCam = clamp(duckWorldY - ctx.height * 0.46, 0, worldH() - ctx.height);
      camY += (targetCam - camY) * Math.min(1, d * 6);

      // spawns
      ringTimer -= d;
      if (ringTimer <= 0) {
        spawnRing(W);
        ringTimer = 1.0 + Math.random() * 0.8;
      }
      birdTimer -= d;
      if (birdTimer <= 0) {
        spawnBird(W);
        birdTimer = (1.8 + Math.random() * 1.4) / (0.7 + ramp * 0.7);
      }

      const dx = duckX();
      const dr = duckUnit() * 0.8;
      // rings
      for (const ring of ringList) {
        ring.x -= worldSpeed * d;
        if (!ring.got) {
          const dd = Math.hypot(ring.x - dx, ring.y - duckWorldY);
          if (dd < ring.r * 0.7) {
            ring.got = true;
            const val = ring.golden ? 3 : 1;
            rings += val;
            audio.coin();
            if (ring.golden) audio.tone(1100, 0.12, "triangle", 0.4);
            particles.ring(ring.x, ring.y - camY, ring.golden ? PALETTE.coin : PALETTE.fly);
            particles.burst(ring.x, ring.y - camY, 8, [ring.golden ? PALETTE.coin : PALETTE.fly, "#fff"], {
              speed: 120,
              size: 4,
              life: 0.5,
              gravity: 0,
            });
            floats.add(dx, duckWorldY - camY - dr, `+${val}`, ring.golden ? PALETTE.coin : PALETTE.fly, dr * 0.9);
          }
        }
      }
      for (let i = ringList.length - 1; i >= 0; i--) if (ringList[i].x < -dr * 3) ringList.splice(i, 1);

      // birds
      for (const b of birds) {
        b.x -= (worldSpeed + b.speed * 30) * d;
        b.y = b.baseY + Math.sin(t * b.speed + b.phase) * b.amp;
        if (!b.hit) {
          const dd = Math.hypot(b.x - dx, b.y - duckWorldY);
          if (dd < dr + duckUnit() * 0.6) {
            b.hit = true;
            bonk = 0.5;
            audio.hit();
            shake.add(12);
            vy += ctx.height * 0.3;
            floats.add(dx, duckWorldY - camY - dr, "Bonk!", PALETTE.bad, dr);
          }
        }
      }
      for (let i = birds.length - 1; i >= 0; i--) if (birds[i].x < -dr * 4) birds.splice(i, 1);

      if (timeLeft <= 0) finish();
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const u = duckUnit();

      sky(c, W, H, "#7fb8ff", "#cdeeff");
      sun(c, W * 0.78, H * 0.2, Math.min(W, H) * 0.07, "#fff3c8");
      // parallax cloud layers (use camera for depth)
      clouds(c, W, H, t * 0.6 + camY * 0.05, { speed: 8, count: 3, color: rgba("#ffffff", 0.55), size: 0.12 });
      clouds(c, W, H, t + camY * 0.12, { speed: 18, count: 4, color: rgba("#ffffff", 0.85) });

      c.save();
      c.translate(shake.x, shake.y);

      // rings
      for (const ring of ringList) {
        if (ring.got) continue;
        const ry = ring.y - camY;
        c.save();
        c.translate(ring.x, ry);
        const col = ring.golden ? PALETTE.coin : "#c5a3ff";
        c.strokeStyle = col;
        c.lineWidth = u * 0.28;
        c.beginPath();
        c.ellipse(0, 0, ring.r, ring.r * 1.15, 0, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = rgba("#ffffff", 0.6);
        c.lineWidth = u * 0.1;
        c.beginPath();
        c.ellipse(0, 0, ring.r, ring.r * 1.15, 0, -0.6, 0.8);
        c.stroke();
        c.restore();
      }

      // birds
      for (const b of birds) {
        if (b.hit) continue;
        drawBird(c, b.x, b.y - camY, u * 0.8, t * 8 + b.phase);
      }

      // duck
      const pitch = clamp(vy / (ctx.height * 0.9), -0.6, 0.7);
      const flap01 = (Math.sin(flapPhase * Math.PI * 2) * 0.5 + 0.5);
      drawDuck(c, duckX(), duckWorldY - camY, u, look, {
        pose: "fly",
        t,
        flap: flap01 * 0.5,
        pitch,
        glance: 0.4,
        shadow: false,
      });

      particles.render(c);
      floats.render(c);
      c.restore();

      // altitude indicator
      drawAltimeter(c, W, H, duckWorldY, bandTop(), bandBot());

      if (phase === "play" || phase === "done") drawMiniHud(ctx, timeLeft, RUN_TIME, "Rings", String(rings), PALETTE.fly);
      if (phase === "count") drawCountdown(c, W, H, Math.ceil(countT - 0.6), (countT - 0.6) - Math.floor(countT - 0.6));
      if (phase === "done") result?.render(ctx);
    },

    destroy() {
      ctx.requestControls([]);
    },
  };
}

function drawBird(c: CanvasRenderingContext2D, x: number, y: number, s: number, flapT: number): void {
  const wing = Math.sin(flapT) * 0.7;
  c.save();
  c.translate(x, y);
  // body
  c.fillStyle = "#5a6577";
  c.beginPath();
  c.ellipse(0, 0, s * 0.5, s * 0.34, 0, 0, Math.PI * 2);
  c.fill();
  // head
  c.beginPath();
  c.arc(-s * 0.45, -s * 0.08, s * 0.26, 0, Math.PI * 2);
  c.fill();
  // beak (facing left, moving left)
  c.fillStyle = "#ff9f1c";
  c.beginPath();
  c.moveTo(-s * 0.65, -s * 0.08);
  c.lineTo(-s * 0.95, -s * 0.02);
  c.lineTo(-s * 0.65, s * 0.08);
  c.fill();
  // wings
  c.fillStyle = "#485061";
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(s * 0.4, -s * (0.5 + wing), s * 0.9, -s * 0.2 - wing * s * 0.3);
  c.quadraticCurveTo(s * 0.4, -s * 0.1, 0, 0);
  c.fill();
  // eye
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(-s * 0.5, -s * 0.1, s * 0.07, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawAltimeter(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  worldY: number,
  top: number,
  bot: number,
): void {
  const x = W * 0.96;
  const y0 = H * 0.18;
  const y1 = H * 0.7;
  c.strokeStyle = rgba("#ffffff", 0.5);
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(x, y0);
  c.lineTo(x, y1);
  c.stroke();
  const frac = clamp((worldY - top) / (bot - top), 0, 1);
  const my = y0 + (y1 - y0) * frac;
  c.fillStyle = PALETTE.fly;
  c.beginPath();
  c.moveTo(x - 10, my);
  c.lineTo(x - 2, my - 6);
  c.lineTo(x - 2, my + 6);
  c.fill();
}
