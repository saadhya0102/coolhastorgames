import { clamp } from "@/engine";
import type { Screen, ScreenEnv } from "./screen";
import { DT_CLAMP } from "./screen";
import { PALETTE, rgba } from "./theme";
import { sky, water, waterBubbles } from "./backdrop";
import { drawDuck } from "./duck";
import { Particles, Shake, FloatingText } from "./fx";
import { ResultCard, drawCountdown, drawMiniHud, type MiniResult } from "./common";

const RUN_TIME = 30;

type Phase = "count" | "play" | "done";

interface Pillar {
  x: number;
  gapY: number;
  gapH: number;
  fromTop: boolean;
  w: number;
}
interface Eddy {
  x: number;
  y: number;
  r: number;
  rot: number;
  hit: boolean;
}
interface Bubble {
  x: number;
  y: number;
  r: number;
  got: boolean;
  phase: number;
}

export function createSwim(env: ScreenEnv, onDone: (xp: number) => void): Screen {
  const { ctx, look } = env;
  const { input, audio } = ctx;
  const particles = new Particles();
  const shake = new Shake();
  const floats = new FloatingText();

  let phase: Phase = "count";
  let countT = 3.6;
  let timeLeft = RUN_TIME;
  let t = 0;

  let duckY = 0; // set on first frame
  let targetY = 0;
  let vy = 0;
  let swimPhase = 0;
  let slow = 0;

  let dist = 0;
  let bubbles = 0;
  let worldSpeed = 0;
  let earnedXp = 0;
  let closed = false;

  const pillars: Pillar[] = [];
  const eddies: Eddy[] = [];
  const bubbleList: Bubble[] = [];
  let pillarTimer = 1.4;
  let eddyTimer = 2.5;
  let bubbleTimer = 0.6;
  let inited = false;

  let result: ResultCard | null = null;

  ctx.requestControls([{ type: "dpad", id: "move" }]);
  ctx.setStatus("Swim! Up/Down or drag to dodge rocks and pop bubbles.");

  const surfaceY = () => ctx.height * 0.16;
  const duckX = () => ctx.width * 0.26;
  const duckUnit = () => Math.min(ctx.width, ctx.height) * 0.065;

  const bounds = () => {
    const u = duckUnit();
    return { top: surfaceY() + u * 0.4, bot: ctx.height - u * 1.2 };
  };

  const finish = () => {
    phase = "done";
    earnedXp = Math.round(dist * 0.011 + bubbles * 1.1);
    audio.win();
    const r: MiniResult = {
      title: "Great swim!",
      lines: [
        { label: "Distance", value: `${Math.round(dist)} m`, color: PALETTE.ink },
        { label: "Bubbles", value: `${bubbles}`, color: PALETTE.swim },
        { label: "XP Earned", value: `+${earnedXp}`, color: PALETTE.swim },
      ],
    };
    result = new ResultCard(r);
  };

  const spawnPillar = (W: number) => {
    const H = ctx.height;
    const b = bounds();
    const gapH = (b.bot - b.top) * (0.42 + Math.random() * 0.12);
    const gapY = b.top + Math.random() * (b.bot - b.top - gapH);
    pillars.push({ x: W + duckUnit(), gapY, gapH, fromTop: Math.random() < 0.5, w: duckUnit() * 1.2 });
    void H;
  };
  const spawnEddy = (W: number) => {
    const b = bounds();
    eddies.push({
      x: W + duckUnit() * 2,
      y: b.top + Math.random() * (b.bot - b.top),
      r: duckUnit() * (0.9 + Math.random() * 0.5),
      rot: 0,
      hit: false,
    });
  };
  const spawnBubbles = (W: number) => {
    const b = bounds();
    const baseY = b.top + Math.random() * (b.bot - b.top);
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      bubbleList.push({
        x: W + duckUnit() + i * duckUnit() * 0.9,
        y: baseY + Math.sin(i) * duckUnit() * 0.5,
        r: duckUnit() * 0.3,
        got: false,
        phase: Math.random() * 10,
      });
    }
  };

  return {
    update(dt) {
      const d = Math.min(dt, DT_CLAMP);
      t += d;
      particles.update(d);
      shake.update(d);
      floats.update(d);

      if (!inited) {
        duckY = ctx.height * 0.5;
        targetY = duckY;
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
      const u = duckUnit();
      const b = bounds();
      timeLeft -= d;
      const ramp = 1 - timeLeft / RUN_TIME;
      worldSpeed = W * (0.34 + ramp * 0.32) * (slow > 0 ? 0.5 : 1);
      dist += worldSpeed * d * 0.06;
      if (slow > 0) slow -= d;

      // input: keyboard accelerates; pointer drag eases toward the finger
      const accel = ctx.height * 3.4;
      let move = 0;
      if (input.isDown("ArrowUp", "w")) move -= 1;
      if (input.isDown("ArrowDown", "s")) move += 1;
      if (move !== 0) {
        vy += move * accel * d;
      } else if (input.pointer.down) {
        targetY = input.pointer.y;
        vy += (targetY - duckY) * 9 * d;
        vy *= Math.pow(0.05, d);
      } else {
        vy *= Math.pow(0.04, d);
      }
      vy = clamp(vy, -ctx.height * 1.1, ctx.height * 1.1);
      duckY += vy * d;
      if (duckY < b.top) {
        duckY = b.top;
        vy = Math.abs(vy) * 0.2;
      }
      if (duckY > b.bot) {
        duckY = b.bot;
        vy = -Math.abs(vy) * 0.2;
      }
      swimPhase += d * 2.2;

      // wake particles
      if (Math.random() < 0.4) {
        particles.spawn({
          x: duckX() - u * 0.8,
          y: duckY + u * 0.4,
          vx: -worldSpeed * 0.3,
          vy: (Math.random() - 0.5) * 30,
          life: 0.5,
          max: 0.5,
          size: u * 0.12,
          color: rgba("#ffffff", 0.5),
        });
      }

      // spawns
      pillarTimer -= d;
      if (pillarTimer <= 0) {
        spawnPillar(W);
        pillarTimer = (1.5 + Math.random()) / (0.7 + ramp * 0.7);
      }
      eddyTimer -= d;
      if (eddyTimer <= 0) {
        spawnEddy(W);
        eddyTimer = 2.2 + Math.random() * 1.6;
      }
      bubbleTimer -= d;
      if (bubbleTimer <= 0) {
        spawnBubbles(W);
        bubbleTimer = 1.0 + Math.random();
      }

      const dx = duckX();
      const dr = u * 0.8;
      // pillars
      for (const p of pillars) {
        p.x -= worldSpeed * d;
        const inX = dx + dr > p.x && dx - dr < p.x + p.w;
        if (inX) {
          const aboveGap = duckY - dr < p.gapY;
          const belowGap = duckY + dr > p.gapY + p.gapH;
          if (aboveGap || belowGap) {
            // collide
            slow = 0.6;
            audio.hit();
            shake.add(10);
            duckY = clamp(duckY, p.gapY + dr, p.gapY + p.gapH - dr);
            vy = 0;
          }
        }
      }
      for (let i = pillars.length - 1; i >= 0; i--) if (pillars[i].x + pillars[i].w < -u) pillars.splice(i, 1);

      // eddies
      for (const e of eddies) {
        e.x -= worldSpeed * d * 0.9;
        e.rot += d * 3;
        if (!e.hit) {
          const dd = Math.hypot(e.x - dx, e.y - duckY);
          if (dd < e.r + dr * 0.5) {
            e.hit = true;
            slow = 0.5;
            audio.hit();
            shake.add(8);
            // nudge the duck outward
            vy += (duckY - e.y) * 6;
            floats.add(dx, duckY - u, "Whirl!", PALETTE.bad, u * 0.55);
          }
        }
      }
      for (let i = eddies.length - 1; i >= 0; i--) if (eddies[i].x + eddies[i].r < -u) eddies.splice(i, 1);

      // bubbles
      for (const bb of bubbleList) {
        bb.x -= worldSpeed * d;
        bb.y -= 14 * d;
        if (!bb.got) {
          const dd = Math.hypot(bb.x - dx, bb.y - duckY);
          if (dd < dr + bb.r) {
            bb.got = true;
            bubbles++;
            audio.coin();
            particles.burst(bb.x, bb.y, 6, [rgba("#ffffff", 0.8), PALETTE.swim], { speed: 90, size: 3, life: 0.4, gravity: 0 });
            floats.add(bb.x, bb.y, "+1", PALETTE.swim, u * 0.5);
          }
        }
      }
      for (let i = bubbleList.length - 1; i >= 0; i--) if (bubbleList[i].x < -u || bubbleList[i].y < -u) bubbleList.splice(i, 1);

      if (timeLeft <= 0) finish();
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const u = duckUnit();
      const sY = surfaceY();

      sky(c, W, H, "#bfeaff", "#8fd4ff");
      water(c, W, H, t, sY, "#43b6e8", "#0d5a88");
      waterBubbles(c, W, H, t, sY);

      c.save();
      c.translate(shake.x, shake.y);

      // pillars (rock columns from top & bottom of gap)
      for (const p of pillars) {
        drawRock(c, p.x, sY, p.x, p.gapY, p.w, true);
        drawRock(c, p.x, p.gapY + p.gapH, p.x, H, p.w, false);
      }

      // eddies
      for (const e of eddies) {
        c.save();
        c.translate(e.x, e.y);
        c.rotate(e.rot);
        c.strokeStyle = rgba("#ffffff", 0.55);
        c.lineWidth = u * 0.12;
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.arc(0, 0, e.r * (0.5 + i * 0.25), i * 1.2, i * 1.2 + Math.PI * 1.3);
          c.stroke();
        }
        c.restore();
      }

      // bubbles
      for (const bb of bubbleList) {
        if (bb.got) continue;
        const wob = Math.sin(t * 4 + bb.phase) * 3;
        c.fillStyle = rgba("#ffffff", 0.35);
        c.beginPath();
        c.arc(bb.x + wob, bb.y, bb.r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = rgba("#ffffff", 0.8);
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = rgba("#ffffff", 0.9);
        c.beginPath();
        c.arc(bb.x + wob - bb.r * 0.3, bb.y - bb.r * 0.3, bb.r * 0.22, 0, Math.PI * 2);
        c.fill();
      }

      // duck swimming
      const pitch = clamp(vy / (ctx.height * 0.8), -0.5, 0.5);
      c.save();
      c.translate(duckX(), duckY);
      c.rotate(pitch * 0.5);
      drawDuck(c, 0, 0, u, look, { pose: "swim", t, phase: swimPhase, glance: 0.3, shadow: false });
      c.restore();

      particles.render(c);
      floats.render(c);
      c.restore();

      if (phase === "play" || phase === "done") drawMiniHud(ctx, timeLeft, RUN_TIME, "Bubbles", String(bubbles), PALETTE.swim);
      if (phase === "count") drawCountdown(c, W, H, Math.ceil(countT - 0.6), (countT - 0.6) - Math.floor(countT - 0.6));
      if (phase === "done") result?.render(ctx);
    },

    destroy() {
      ctx.requestControls([]);
    },
  };
}

function drawRock(
  c: CanvasRenderingContext2D,
  x: number,
  y0: number,
  _x2: number,
  y1: number,
  w: number,
  fromTop: boolean,
): void {
  c.fillStyle = "#5a6b78";
  c.beginPath();
  if (fromTop) {
    c.moveTo(x - w * 0.1, y0);
    c.lineTo(x + w * 1.1, y0);
    c.lineTo(x + w, y1);
    c.quadraticCurveTo(x + w / 2, y1 + w * 0.4, x, y1);
    c.closePath();
  } else {
    c.moveTo(x, y0);
    c.quadraticCurveTo(x + w / 2, y0 - w * 0.4, x + w, y0);
    c.lineTo(x + w * 1.1, y1);
    c.lineTo(x - w * 0.1, y1);
    c.closePath();
  }
  c.fill();
  c.fillStyle = rgba("#ffffff", 0.12);
  c.fillRect(x, Math.min(y0, y1), w * 0.25, Math.abs(y1 - y0));
  c.fillStyle = "#3f4d57";
  c.fillRect(x + w * 0.75, Math.min(y0, y1), w * 0.2, Math.abs(y1 - y0));
}
