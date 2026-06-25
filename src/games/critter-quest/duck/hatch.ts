import { clamp, drawText, roundRect } from "@/engine";
import type { ScreenEnv, Screen } from "./screen";
import { DT_CLAMP } from "./screen";
import { PALETTE, rgba } from "./theme";
import { sky, sun, clouds, hills, grass } from "./backdrop";
import { drawDuck } from "./duck";
import { Particles } from "./fx";
import { clicked, drawButton, drawPanel, hovering } from "./ui";

const TAPS_NEEDED = 6;

type Phase = "egg" | "burst" | "reveal";

export function createHatch(env: ScreenEnv, onDone: () => void): Screen {
  const { ctx, look } = env;
  const { input, audio } = ctx;
  const particles = new Particles();

  let phase: Phase = "egg";
  let taps = 0;
  let t = 0;
  let wobble = 0;
  let burstT = 0;
  let revealT = 0;
  let closed = false;
  // precomputed jagged crack polylines (normalized to egg radius)
  const cracks: { x: number; y: number }[][] = [];

  ctx.setStatus("Tap the egg to hatch your duckling!");

  const eggPos = () => ({ x: ctx.width / 2, y: ctx.height * 0.56 });
  const eggR = () => Math.min(ctx.width, ctx.height) * 0.16;

  const tap = () => {
    if (phase !== "egg") return;
    taps++;
    wobble = 1;
    audio.blip();
    audio.tone(300 + taps * 60, 0.07, "square", 0.3);
    const p = eggPos();
    const r = eggR();
    cracks.push(makeCrack());
    particles.burst(p.x, p.y - r * 0.3, 5, ["#fff8e0", "#ffe9a8"], { speed: 90, size: 4, life: 0.5 });
    if (taps >= TAPS_NEEDED) {
      phase = "burst";
      burstT = 0;
      audio.explosion();
      audio.win();
      particles.burst(p.x, p.y - r * 0.2, 36, ["#fff8e0", "#ffe9a8", "#ffd23f", "#ffffff"], {
        speed: 280,
        size: 7,
        life: 1.1,
        gravity: 520,
      });
      particles.confetti(p.x, p.y - r, 26);
    }
  };

  const btnRect = () => ({
    x: ctx.width / 2 - ctx.width * 0.22,
    y: ctx.height * 0.8,
    w: ctx.width * 0.44,
    h: ctx.height * 0.1,
  });

  return {
    update(dt) {
      const d = Math.min(dt, DT_CLAMP);
      t += d;
      particles.update(d);
      wobble = Math.max(0, wobble - d * 4);

      if (phase === "egg") {
        if (input.pointer.justDown || input.pressed("Space", "Enter")) tap();
      } else if (phase === "burst") {
        burstT += d;
        if (burstT > 0.7) {
          phase = "reveal";
          revealT = 0;
        }
      } else {
        revealT += d;
        const r = btnRect();
        if (!closed && revealT > 0.5 && (clicked(input, r) || input.pressed("Space", "Enter"))) {
          closed = true;
          onDone();
        }
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      sky(c, W, H, "#ffd9a0", "#bfe9ff");
      sun(c, W * 0.5, H * 0.22, Math.min(W, H) * 0.07, "#fff1c0");
      clouds(c, W, H, t, { speed: 8, count: 4, color: rgba("#ffffff", 0.85) });
      const groundY = H * 0.74;
      hills(c, W, H, t * 0.2, groundY, ["#bfe08a", "#a6d36c"]);
      grass(c, W, H, groundY, 0, "#8fd05a", "#5ba83c", "#7cc24a");

      // nest
      const p = eggPos();
      const r = eggR();
      drawNest(c, p.x, groundY + r * 0.2, r);

      if (phase === "egg" || phase === "burst") {
        const split = phase === "burst" ? clamp(burstT / 0.5, 0, 1) : 0;
        drawEgg(c, p.x, p.y, r, wobble, cracks, taps / TAPS_NEEDED, split, t);
      }

      if (phase === "egg") {
        // hatch meter
        const mx = W * 0.3;
        const mw = W * 0.4;
        const my = H * 0.86;
        const mh = H * 0.03;
        c.fillStyle = rgba("#000000", 0.18);
        roundRect(c, mx, my, mw, mh, mh / 2);
        c.fill();
        c.fillStyle = PALETTE.accent;
        const w = (taps / TAPS_NEEDED) * mw;
        if (w > 2) {
          roundRect(c, mx, my, w, mh, mh / 2);
          c.fill();
        }
        const pulse = 1 + Math.sin(t * 5) * 0.06;
        drawText(c, "TAP THE EGG!", W / 2, H * 0.8, H * 0.05 * pulse, PALETTE.ink, "center", "800");
      }

      if (phase === "reveal") {
        const e = clamp(revealT / 0.5, 0, 1);
        const u = r * 0.62 * e;
        drawDuck(c, p.x, p.y + r * 0.1, u, look, { pose: "cheer", t, beakOpen: 0.4 });
        if (revealT > 0.4) {
          c.save();
          c.globalAlpha = clamp((revealT - 0.4) / 0.4, 0, 1);
          const cardW = Math.min(W * 0.7, H * 0.9);
          drawPanel(c, { x: W / 2 - cardW / 2, y: H * 0.12, w: cardW, h: H * 0.16 }, "#ffffff", 18);
          drawText(c, "Meet your duckling!", W / 2, H * 0.18, H * 0.05, PALETTE.ink, "center", "800");
          drawText(c, "Train it to become a champion racer.", W / 2, H * 0.24, H * 0.03, PALETTE.inkSoft, "center");
          const br = btnRect();
          drawButton(c, br, "LET'S GO!", { fill: PALETTE.good, text: "#fff" }, {
            hover: hovering(input, br),
            fontScale: 0.42,
          });
          c.restore();
        }
      }

      particles.render(c);
    },
  };
}

function drawNest(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.fillStyle = "#8a5a2b";
  c.beginPath();
  c.ellipse(x, y, r * 1.5, r * 0.55, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#a06a34";
  c.lineWidth = r * 0.08;
  c.lineCap = "round";
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const sx = x + Math.cos(a) * r * 1.3;
    const sy = y + Math.sin(a) * r * 0.45;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(a + 1) * r * 0.4, sy + Math.sin(a + 1) * r * 0.15);
    c.stroke();
  }
}

function drawEgg(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  wobble: number,
  cracks: { x: number; y: number }[][],
  fill: number,
  split: number,
  t: number,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(Math.sin(t * 20) * wobble * 0.08);

  const ew = r * 0.82;
  const eh = r * 1.05;

  const drawHalf = (offX: number, offY: number) => {
    c.save();
    c.translate(offX, offY);
    // egg body
    c.fillStyle = "#fff7e6";
    c.beginPath();
    c.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2);
    c.fill();
    // shade
    c.fillStyle = rgba("#e9d4a8", 0.5);
    c.beginPath();
    c.ellipse(ew * 0.25, eh * 0.2, ew * 0.55, eh * 0.7, 0, 0, Math.PI * 2);
    c.fill();
    // speckles
    c.fillStyle = rgba("#c79a5a", 0.5);
    for (let i = 0; i < 10; i++) {
      const sa = i * 41.7;
      const sr = (Math.sin(sa) * 0.5 + 0.5) * ew * 0.7;
      const sang = sa;
      c.beginPath();
      c.arc(Math.cos(sang) * sr, Math.sin(sang) * sr * 1.2, ew * 0.06, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };

  if (split <= 0) {
    drawHalf(0, 0);
  } else {
    // top half lifts up & tilts, bottom half stays
    c.save();
    c.translate(0, -split * eh * 0.7);
    c.rotate(-split * 0.5);
    c.beginPath();
    c.rect(-ew * 1.2, -eh * 1.2, ew * 2.4, eh * 1.2);
    c.clip();
    drawHalf(0, split * eh * 0.7);
    c.restore();
    c.save();
    c.translate(split * eh * 0.3, 0);
    c.rotate(split * 0.3);
    c.beginPath();
    c.rect(-ew * 1.2, 0, ew * 2.4, eh * 1.4);
    c.clip();
    drawHalf(-split * eh * 0.3, 0);
    c.restore();
  }

  // cracks (precomputed, normalized to radius)
  if (split <= 0) {
    c.strokeStyle = rgba("#7a5a2a", 0.7);
    c.lineWidth = Math.max(1.5, r * 0.025);
    for (const pts of cracks) {
      c.beginPath();
      pts.forEach((pt, i) => {
        const px = pt.x * ew;
        const py = pt.y * eh;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      c.stroke();
    }
  }
  c.restore();
  void fill;
}

/** A jagged crack as a normalized polyline radiating from near center. */
function makeCrack(): { x: number; y: number }[] {
  const a = Math.random() * Math.PI * 2;
  const dx = Math.cos(a);
  const dy = Math.sin(a) * 1.1;
  const len = 0.45 + Math.random() * 0.5;
  const steps = 4;
  const pts: { x: number; y: number }[] = [{ x: dx * 0.18, y: dy * 0.18 }];
  let cx = dx * 0.18;
  let cy = dy * 0.18;
  for (let i = 1; i <= steps; i++) {
    cx += (dx * len) / steps + (Math.random() - 0.5) * 0.12;
    cy += (dy * len) / steps + (Math.random() - 0.5) * 0.12;
    pts.push({ x: cx, y: cy });
  }
  return pts;
}
