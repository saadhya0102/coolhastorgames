import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, formatTime, roundRect } from "@/engine";

/**
 * Redline Drag — a quarter-mile drag racer about timing.
 * Launch off the tree, then shift 6 gears in the green RPM band for max power.
 * Score is elapsed time in milliseconds (lower is better).
 */

const QUARTER_MILE = 402.336; // metres
const REDLINE = 8200;
const IDLE = 1100;
const GREEN_LO = 0.84; // fraction of rev range = start of green band
const GREEN_HI = 1.0;
const PERFECT_LO = 0.9;

// speed (m/s) at which each gear reaches the redline
const GEAR_TOP = [16, 27, 39, 53, 69, 88];
// relative pulling force per gear (lower gears pull harder)
const GEAR_FORCE = [26, 21, 16.5, 13, 10.2, 8];
const DRAG = 0.00055;
const ROLL = 0.55;

// drag-tree timing (seconds from staged)
const AMBER = [0.55, 1.05, 1.55];
const GREEN_T = 2.05;

type Phase = "ready" | "tree" | "racing" | "done";

interface Blur {
  y: number;
  len: number;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  const best = storage.get<number | null>("best", null);

  let phase: Phase = "ready";
  let treeT = 0;
  let launched = false;
  let falseStart = false;
  let elapsed = 0; // seconds since green
  let reaction = 0;

  let gear = 0; // 0-based (gear 1)
  let speed = 0; // m/s
  let dist = 0; // m
  let rpm = IDLE;
  let powerMul = 1; // shift-quality multiplier, eases toward 1
  let limiter = false;
  let shiftFlash = 0; // >0 perfect, <0 bad
  let wheelie = 0;
  let finishTime = 0;
  let newBest = false;
  let t = 0;

  const blurs: Blur[] = [];
  for (let i = 0; i < 10; i++) blurs.push({ y: Math.random(), len: 0.4 + Math.random() * 0.6 });

  ctx.requestControls([{ type: "button", key: "Space", label: "SHIFT", id: "shift" }]);
  ctx.setStatus("Tap / Space to stage");

  const press = (): boolean =>
    input.pressed("Space", "Shift", "ArrowUp", "w", "Enter") || input.pointer.justDown;

  const revFraction = () => clamp((speed / GEAR_TOP[gear]), 0, 1.15);

  const doLaunch = () => {
    launched = true;
    phase = "racing";
    elapsed = Math.max(0, treeT - GREEN_T);
    if (treeT < GREEN_T) {
      // jumped the start
      falseStart = true;
      reaction = treeT - GREEN_T; // negative
      speed = 0;
      powerMul = 0.5;
      shiftFlash = -1;
      audio.lose();
      ctx.setStatus("Jumped the line! +1.0s");
    } else {
      reaction = treeT - GREEN_T;
      if (reaction < 0.18) {
        // holeshot!
        speed = 5.5;
        powerMul = 1.2;
        wheelie = 1;
        shiftFlash = 1;
        audio.win();
        ctx.setStatus(`HOLESHOT! React ${reaction.toFixed(3)}s`);
      } else {
        speed = 2.0;
        powerMul = 1;
        audio.coin();
        ctx.setStatus(`React ${reaction.toFixed(3)}s — shift in green!`);
      }
    }
  };

  const shift = () => {
    if (gear >= GEAR_FORCE.length - 1) {
      audio.blip();
      return;
    }
    const f = revFraction();
    gear += 1;
    if (f < 0.7) {
      // shifted way too early — bog
      powerMul = 0.5;
      shiftFlash = -1;
      audio.hit();
    } else if (f >= PERFECT_LO && f <= GREEN_HI) {
      powerMul = 1.18;
      shiftFlash = 1;
      audio.coin();
    } else if (f >= GREEN_LO) {
      powerMul = 1.05;
      shiftFlash = 0.5;
      audio.blip();
    } else {
      // a bit early
      powerMul = 0.8;
      shiftFlash = -0.5;
      audio.blip();
    }
    audio.sweep(140, 90, 0.12, "sawtooth", 0.18);
  };

  const torqueAt = (f: number) => clamp(1 - 3 * (f - 0.85) * (f - 0.85), 0.35, 1);

  const updateRacing = (dt: number) => {
    elapsed += dt;

    if (press()) shift();

    // rpm follows speed within the current gear
    const f = speed / GEAR_TOP[gear];
    rpm = IDLE + (REDLINE - IDLE) * clamp(f, 0, 1);
    limiter = f >= 1 && gear < GEAR_FORCE.length - 1;

    // power multiplier eases back to 1
    powerMul += (1 - powerMul) * Math.min(1, dt * 2.2);
    shiftFlash *= Math.max(0, 1 - dt * 3);
    wheelie = Math.max(0, wheelie - dt * 1.6);

    const torque = limiter ? 0.12 : torqueAt(f);
    let accel = GEAR_FORCE[gear] * torque * powerMul;
    accel -= DRAG * speed * speed + ROLL;
    speed = Math.max(0, speed + accel * dt);
    dist += speed * dt;

    ctx.reportScore(Math.round(elapsed * 1000));

    if (dist >= QUARTER_MILE) finish();
  };

  const finish = () => {
    phase = "done";
    finishTime = elapsed + (falseStart ? 1.0 : 0); // false-start penalty
    finishTime *= 1000;
    newBest = storage.submitScore(Math.round(finishTime), true);
    storage.set("best", Math.round(finishTime));
    audio.win();
    window.setTimeout(() => ctx.gameOver(Math.round(finishTime)), 1400);
  };

  // ---------------------------------------------------------------- render
  const drawBackdrop = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a1030");
    g.addColorStop(0.6, "#2a1d4a");
    g.addColorStop(1, "#0e0a1c");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    const horizon = H * 0.6;
    // track
    c.fillStyle = "#2b2b33";
    c.fillRect(0, horizon, W, H - horizon);
    // lane stripes scrolling with speed
    c.fillStyle = "#d8d24a";
    const scroll = (dist * 18) % 80;
    for (let x = -80; x < W + 80; x += 80) {
      const sxp = x - scroll;
      c.fillRect(sxp, horizon + (H - horizon) * 0.46, 44, Math.max(4, H * 0.012));
    }
    // crowd / wall
    c.fillStyle = "#15131f";
    c.fillRect(0, horizon - H * 0.04, W, H * 0.04);
  };

  const drawCar = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const cxp = W * 0.32;
    const baseY = H * 0.74;
    const carW = Math.min(W * 0.2, 200);
    const carH = carW * 0.34;
    const tilt = wheelie * 0.4;

    // motion blur lines
    if (speed > 4) {
      c.strokeStyle = "rgba(255,255,255,0.25)";
      c.lineWidth = 2;
      for (const b of blurs) {
        const ly = baseY - carH * 1.2 + b.y * carH * 1.6;
        const len = b.len * speed * 2.2;
        const ox = ((t * speed * 30 + b.y * 400) % (W + 200)) - 100;
        c.beginPath();
        c.moveTo(cxp - ox, ly);
        c.lineTo(cxp - ox - len, ly);
        c.stroke();
      }
    }

    c.save();
    c.translate(cxp, baseY);
    c.rotate(-tilt);

    // wheels
    const wr = carH * 0.5;
    c.fillStyle = "#111";
    for (const wx of [-carW * 0.3, carW * 0.32]) {
      c.beginPath();
      c.arc(wx, 0, wr, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#555";
    for (const wx of [-carW * 0.3, carW * 0.32]) {
      c.beginPath();
      c.arc(wx, 0, wr * 0.45, 0, Math.PI * 2);
      c.fill();
    }

    // body
    c.fillStyle = "#36c0e0";
    roundRect(c, -carW * 0.5, -carH * 0.7, carW, carH * 0.7, carH * 0.18);
    c.fill();
    // cabin
    c.fillStyle = "#1b3b55";
    roundRect(c, -carW * 0.16, -carH * 1.25, carW * 0.5, carH * 0.6, carH * 0.16);
    c.fill();
    // spoiler
    c.fillStyle = "#26414f";
    c.fillRect(-carW * 0.54, -carH * 0.9, carW * 0.1, carH * 0.45);
    // exhaust flame on power
    if (shiftFlash > 0.2 || wheelie > 0.2) {
      c.fillStyle = "#ffae3b";
      c.beginPath();
      c.moveTo(-carW * 0.5, -carH * 0.25);
      c.lineTo(-carW * 0.5 - carW * 0.18 * (0.5 + shiftFlash + wheelie), -carH * 0.1);
      c.lineTo(-carW * 0.5, carH * 0.02);
      c.fill();
    }
    c.restore();
  };

  const drawTacho = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const r = Math.min(W * 0.13, H * 0.2);
    const ox = W - r - 28;
    const oy = r + 28;
    const start = Math.PI * 0.8;
    const end = Math.PI * 2.2;

    c.fillStyle = "rgba(0,0,0,0.5)";
    c.beginPath();
    c.arc(ox, oy, r + 10, 0, Math.PI * 2);
    c.fill();

    // green band arc
    const fToAng = (f: number) => start + (end - start) * clamp(f, 0, 1);
    c.lineWidth = r * 0.16;
    c.strokeStyle = "rgba(67,209,122,0.85)";
    c.beginPath();
    c.arc(ox, oy, r, fToAng(GREEN_LO), fToAng(PERFECT_LO));
    c.stroke();
    c.strokeStyle = "rgba(120,255,150,1)";
    c.beginPath();
    c.arc(ox, oy, r, fToAng(PERFECT_LO), fToAng(GREEN_HI));
    c.stroke();
    // red zone
    c.strokeStyle = "rgba(226,59,59,0.9)";
    c.beginPath();
    c.arc(ox, oy, r, fToAng(GREEN_HI), end);
    c.stroke();
    // base track
    c.strokeStyle = "rgba(255,255,255,0.12)";
    c.beginPath();
    c.arc(ox, oy, r, start, fToAng(GREEN_LO));
    c.stroke();

    // needle
    const f = phase === "racing" ? speed / GEAR_TOP[gear] : 0;
    const ang = fToAng(clamp(f, 0, 1));
    c.strokeStyle = limiter ? "#ff5555" : "#fff";
    c.lineWidth = Math.max(3, r * 0.06);
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ox + Math.cos(ang) * r * 0.92, oy + Math.sin(ang) * r * 0.92);
    c.stroke();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(ox, oy, r * 0.1, 0, Math.PI * 2);
    c.fill();

    drawText(c, `${Math.round(rpm)}`, ox, oy + r * 0.55, r * 0.22, "#fff");
    drawText(c, "RPM", ox, oy + r * 0.78, r * 0.16, "#9f91c9");
    drawText(c, `${gear + 1}`, ox, oy - r * 0.35, r * 0.5, limiter ? "#ff5555" : "#ffd23f");
  };

  const drawTree = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const cxp = W * 0.5;
    const r = Math.min(W * 0.03, H * 0.045);
    const gap = r * 2.6;
    const top = H * 0.16;
    const lit = (on: boolean, color: string, y: number) => {
      c.fillStyle = on ? color : "rgba(255,255,255,0.12)";
      c.beginPath();
      c.arc(cxp, y, r, 0, Math.PI * 2);
      c.fill();
    };
    for (let i = 0; i < 3; i++) {
      const on = phase === "tree" && treeT >= AMBER[i] && treeT < GREEN_T;
      lit(on, "#ffae3b", top + i * gap);
    }
    const greenOn = (phase === "tree" && treeT >= GREEN_T) || phase === "racing";
    lit(greenOn && !falseStart, "#43d17a", top + 3 * gap);
    if (falseStart) {
      lit(true, "#e23b3b", top + 4 * gap);
    }
  };

  const drawHud = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const mph = speed * 2.23694;
    const ft = dist * 3.28084;
    drawText(c, `${formatTime(elapsed * 1000)}`, 20, 30, Math.min(36, H * 0.07), "#fff", "left");
    drawText(c, `${Math.round(mph)} mph`, 20, 30 + Math.min(34, H * 0.07), Math.min(24, H * 0.05), "#36c0e0", "left");
    drawText(
      c,
      `${Math.round(ft)} / 1320 ft`,
      20,
      30 + Math.min(34, H * 0.07) * 2,
      Math.min(20, H * 0.04),
      "#9f91c9",
      "left",
    );
    if (best != null) {
      drawText(c, `Best ${formatTime(best)}`, W / 2, H - 22, Math.min(20, H * 0.04), "#ffd23f");
    }
  };

  return {
    update(dt: number) {
      t += dt;
      const dtc = Math.min(dt, 1 / 30);
      if (phase === "ready") {
        if (press()) {
          phase = "tree";
          treeT = 0;
          ctx.setStatus("Launch on GREEN — Space / tap");
        }
      } else if (phase === "tree") {
        treeT += dtc;
        if (press()) {
          doLaunch();
        } else if (treeT > GREEN_T + 2.5) {
          // auto-launch with a poor reaction if the player freezes
          doLaunch();
        }
      } else if (phase === "racing") {
        updateRacing(dtc);
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      drawBackdrop(c, W, H);
      drawCar(c, W, H);
      drawTacho(c, W, H);
      drawHud(c, W, H);

      if (phase === "ready") {
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.fillRect(0, 0, W, H);
        drawText(c, "REDLINE DRAG", W / 2, H * 0.4, Math.min(54, W * 0.08), "#ffd23f");
        drawText(c, "Tap / Space to stage", W / 2, H * 0.52, Math.min(26, W * 0.045), "#fff");
        drawText(c, "Shift in the GREEN band!", W / 2, H * 0.6, Math.min(22, W * 0.04), "#43d17a");
      } else {
        drawTree(c, W, H);
      }

      if (phase === "racing" && falseStart) {
        drawText(c, "FOUL START  +1.0s", W / 2, H * 0.3, Math.min(30, W * 0.05), "#e23b3b");
      }

      if (phase === "done") {
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.fillRect(0, 0, W, H);
        drawText(c, "FINISH!", W / 2, H * 0.36, Math.min(56, W * 0.09), "#ffd23f");
        drawText(c, formatTime(finishTime), W / 2, H * 0.5, Math.min(48, W * 0.08), "#fff");
        drawText(
          c,
          newBest ? "NEW BEST TIME!" : `${Math.round(speed * 2.23694)} mph trap`,
          W / 2,
          H * 0.6,
          Math.min(26, W * 0.045),
          newBest ? "#43d17a" : "#9f91c9",
        );
      }
    },
  };
}
