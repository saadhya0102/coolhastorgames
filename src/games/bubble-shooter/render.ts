/**
 * Drawing helpers for Bubble Pop Saga. Everything is procedural Canvas 2D:
 * glossy spheres, color-blind glyphs, background, the aim guide and launcher.
 */

import { roundRect } from "@/engine";
import {
  BG_BOT,
  BG_MID,
  BG_TOP,
  FRAME_COLOR,
  FRAME_GLOW,
  PALETTE,
  type GlyphKind,
} from "./config";

/** Cache one offscreen radial-ish look-up is overkill; we draw directly. */

/** Draw a single glossy candy bubble centered at (x,y) with radius r. */
export function drawBubble(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: number,
  opts: { flash?: number; alpha?: number; glyph?: boolean } = {},
): void {
  const pal = PALETTE[color] ?? PALETTE[0];
  const flash = opts.flash ?? 0;
  const alpha = opts.alpha ?? 1;
  if (r <= 0.5 || alpha <= 0) return;

  c.save();
  c.globalAlpha = alpha;

  // soft contact shadow
  c.fillStyle = "rgba(0,0,0,0.28)";
  c.beginPath();
  c.ellipse(x, y + r * 0.62, r * 0.86, r * 0.4, 0, 0, Math.PI * 2);
  c.fill();

  // body radial gradient — light from upper-left
  const g = c.createRadialGradient(
    x - r * 0.38,
    y - r * 0.42,
    r * 0.12,
    x,
    y,
    r * 1.05,
  );
  g.addColorStop(0, pal.light);
  g.addColorStop(0.45, pal.base);
  g.addColorStop(1, pal.deep);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();

  // inner glyph for color-blind readability
  if (opts.glyph !== false) {
    c.save();
    c.globalAlpha = alpha * 0.22;
    c.fillStyle = "#ffffff";
    c.strokeStyle = "#ffffff";
    c.lineWidth = r * 0.12;
    drawGlyph(c, x, y, r * 0.42, pal.glyph);
    c.restore();
  }

  // crescent rim light along the lower-right
  c.save();
  c.globalCompositeOperation = "lighter";
  c.globalAlpha = alpha * 0.35;
  const rim = c.createRadialGradient(
    x + r * 0.32,
    y + r * 0.34,
    r * 0.5,
    x + r * 0.2,
    y + r * 0.22,
    r,
  );
  rim.addColorStop(0, "rgba(255,255,255,0)");
  rim.addColorStop(0.82, "rgba(255,255,255,0)");
  rim.addColorStop(1, pal.light);
  c.fillStyle = rim;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // bright specular highlight
  c.save();
  c.globalAlpha = alpha * 0.9;
  const hg = c.createRadialGradient(
    x - r * 0.34,
    y - r * 0.4,
    0,
    x - r * 0.34,
    y - r * 0.4,
    r * 0.5,
  );
  hg.addColorStop(0, "rgba(255,255,255,0.95)");
  hg.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = hg;
  c.beginPath();
  c.ellipse(
    x - r * 0.3,
    y - r * 0.36,
    r * 0.34,
    r * 0.24,
    -0.5,
    0,
    Math.PI * 2,
  );
  c.fill();
  c.restore();

  // tiny sparkle dot
  c.globalAlpha = alpha * 0.85;
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.beginPath();
  c.arc(x + r * 0.34, y - r * 0.28, r * 0.07, 0, Math.PI * 2);
  c.fill();

  // hit flash overlay
  if (flash > 0) {
    c.globalAlpha = alpha * flash * 0.8;
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  c.restore();
}

/** Draw a faint inner glyph (already styled by the caller). */
function drawGlyph(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  kind: GlyphKind,
): void {
  c.beginPath();
  switch (kind) {
    case "dot":
      c.arc(x, y, s * 0.6, 0, Math.PI * 2);
      c.fill();
      break;
    case "ring":
      c.lineWidth = s * 0.32;
      c.arc(x, y, s * 0.62, 0, Math.PI * 2);
      c.stroke();
      break;
    case "star":
      starPath(c, x, y, s, 5);
      c.fill();
      break;
    case "diamond":
      c.moveTo(x, y - s);
      c.lineTo(x + s * 0.8, y);
      c.lineTo(x, y + s);
      c.lineTo(x - s * 0.8, y);
      c.closePath();
      c.fill();
      break;
    case "triangle":
      c.moveTo(x, y - s);
      c.lineTo(x + s * 0.92, y + s * 0.7);
      c.lineTo(x - s * 0.92, y + s * 0.7);
      c.closePath();
      c.fill();
      break;
    case "flower":
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        c.moveTo(x, y);
        c.arc(
          x + Math.cos(a) * s * 0.5,
          y + Math.sin(a) * s * 0.5,
          s * 0.34,
          0,
          Math.PI * 2,
        );
      }
      c.fill();
      break;
  }
}

function starPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  points: number,
): void {
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? s : s * 0.45;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

/** Full-screen candy background with drifting bokeh + vignette. */
export function drawBackground(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
): void {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, BG_TOP);
  g.addColorStop(0.55, BG_MID);
  g.addColorStop(1, BG_BOT);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // soft drifting bokeh blobs
  c.save();
  c.globalCompositeOperation = "lighter";
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const seed = i * 1.7;
    const bx = (0.15 + 0.7 * fract(Math.sin(seed) * 43.0 + t * 0.02 * (i % 3 + 1))) * W;
    const by =
      (0.2 + 0.6 * fract(Math.cos(seed * 1.3) * 17.0 + t * 0.015 * ((i % 2) + 1))) * H;
    const rad = (0.06 + 0.05 * ((i % 3) + 1)) * Math.min(W, H);
    const hue = [FRAME_GLOW, "#ff5c8a", "#36a9ff", "#3ed46b"][i % 4];
    const bg = c.createRadialGradient(bx, by, 0, bx, by, rad);
    bg.addColorStop(0, hexA(hue, 0.12));
    bg.addColorStop(1, hexA(hue, 0));
    c.fillStyle = bg;
    c.beginPath();
    c.arc(bx, by, rad, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  // vignette
  const v = c.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.3,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.75,
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}

/** Side rails + ceiling bar framing the play field. */
export function drawFrame(
  c: CanvasRenderingContext2D,
  boardLeft: number,
  boardRight: number,
  ceilingY: number,
  H: number,
  R: number,
): void {
  const railW = Math.max(4, R * 0.28);
  c.save();
  // ceiling bar
  const cg = c.createLinearGradient(0, ceilingY - R * 0.8, 0, ceilingY + R * 0.4);
  cg.addColorStop(0, FRAME_GLOW);
  cg.addColorStop(1, FRAME_COLOR);
  c.fillStyle = cg;
  roundRect(
    c,
    boardLeft - railW,
    ceilingY - R * 0.9,
    boardRight - boardLeft + railW * 2,
    R * 0.9,
    R * 0.3,
  );
  c.fill();
  // glossy line under ceiling
  c.fillStyle = "rgba(255,255,255,0.18)";
  c.fillRect(boardLeft - railW, ceilingY - R * 0.18, boardRight - boardLeft + railW * 2, R * 0.08);

  // side rails
  c.fillStyle = FRAME_COLOR;
  roundRect(c, boardLeft - railW, ceilingY - R * 0.9, railW, H, railW * 0.4);
  c.fill();
  roundRect(c, boardRight, ceilingY - R * 0.9, railW, H, railW * 0.4);
  c.fill();
  c.restore();
}

/** Draw the dashed death line. */
export function drawDeathLine(
  c: CanvasRenderingContext2D,
  boardLeft: number,
  boardRight: number,
  y: number,
  danger: number,
): void {
  c.save();
  c.setLineDash([10, 10]);
  c.lineWidth = 2;
  c.strokeStyle = `rgba(255,80,110,${0.35 + danger * 0.5})`;
  c.beginPath();
  c.moveTo(boardLeft, y);
  c.lineTo(boardRight, y);
  c.stroke();
  c.restore();
}

const fract = (n: number) => n - Math.floor(n);

/** Apply an alpha to a #rrggbb color. */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
