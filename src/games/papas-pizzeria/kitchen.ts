import { roundRect } from "@/engine";
import { PALETTE } from "./config";
import { mix } from "./ui";
import type { Station } from "./types";

/** Draw the ambient pizzeria backdrop. Content panels are drawn on top by the
 * game; this only sets the scene so each tab feels like a spot in the shop. */
export function drawKitchen(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  station: Station,
): void {
  // wall gradient
  const wg = c.createLinearGradient(0, 0, 0, H);
  wg.addColorStop(0, PALETTE.wall);
  wg.addColorStop(1, PALETTE.wallDark);
  c.fillStyle = wg;
  c.fillRect(0, 0, W, H);

  // subtle wall tiles
  const tile = Math.max(36, W * 0.07);
  c.strokeStyle = "rgba(120,80,40,0.06)";
  c.lineWidth = 1;
  for (let x = 0; x <= W; x += tile) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, H * 0.7);
    c.stroke();
  }
  for (let y = 0; y <= H * 0.7; y += tile) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
  }

  // floor (checker) at the bottom
  const floorY = H * 0.78;
  c.fillStyle = PALETTE.woodLight;
  c.fillRect(0, floorY, W, H - floorY);
  const fc = Math.max(28, W * 0.06);
  for (let x = 0; x < W; x += fc) {
    const i = Math.floor(x / fc);
    c.fillStyle = i % 2 === 0 ? mix(PALETTE.wood, "#000", 0.05) : PALETTE.wood;
    c.fillRect(x, floorY, fc, H - floorY);
  }
  c.fillStyle = "rgba(0,0,0,0.12)";
  c.fillRect(0, floorY, W, 3);

  // hanging warm lamp glow
  c.save();
  const lg = c.createRadialGradient(W * 0.5, H * 0.02, 10, W * 0.5, H * 0.02, H * 0.6);
  lg.addColorStop(0, "rgba(255,220,140,0.22)");
  lg.addColorStop(1, "rgba(255,220,140,0)");
  c.fillStyle = lg;
  c.fillRect(0, 0, W, H);
  c.restore();

  // station-specific accent decor along the back wall
  const accent = stationAccent(station);
  c.save();
  c.globalAlpha = 0.5;

  if (station === "oven") {
    drawBrickOven(c, W, H, t);
  } else {
    // a couple of framed pictures / shelf
    drawFrame(c, W * 0.12, H * 0.12, W * 0.12, H * 0.14, accent);
    drawFrame(c, W * 0.78, H * 0.1, W * 0.1, H * 0.12, accent);
    drawShelf(c, W * 0.36, H * 0.1, W * 0.28);
  }
  c.restore();

  // bottom counter band (where work happens)
  c.fillStyle = PALETTE.counter;
  c.fillRect(0, floorY - H * 0.02, W, H * 0.02);
}

function stationAccent(station: Station): string {
  switch (station) {
    case "orders":
      return PALETTE.tomato;
    case "build":
      return PALETTE.green;
    case "oven":
      return PALETTE.accent;
    case "serve":
      return PALETTE.accent2;
  }
}

function drawFrame(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string): void {
  c.fillStyle = PALETTE.woodDark;
  roundRect(c, x, y, w, h, 4);
  c.fill();
  c.fillStyle = mix(accent, "#fff", 0.5);
  roundRect(c, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8, 3);
  c.fill();
  // a tiny pizza icon inside
  c.fillStyle = accent;
  c.beginPath();
  c.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2);
  c.fill();
}

function drawShelf(c: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  c.fillStyle = PALETTE.woodDark;
  c.fillRect(x, y, w, Math.max(6, w * 0.02));
  const jars = 4;
  const jw = w / jars;
  for (let i = 0; i < jars; i++) {
    const jx = x + i * jw + jw * 0.2;
    const jh = w * 0.09;
    c.fillStyle = i % 2 === 0 ? "#cf4630" : "#6aa83a";
    roundRect(c, jx, y - jh, jw * 0.6, jh, jw * 0.12);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.25)";
    roundRect(c, jx + jw * 0.08, y - jh + jh * 0.1, jw * 0.14, jh * 0.5, jw * 0.05);
    c.fill();
  }
}

function drawBrickOven(c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const ox = W * 0.5;
  const oy = H * 0.26;
  const ow = Math.min(W * 0.5, H * 0.5);
  const oh = ow * 0.62;
  // dome
  c.fillStyle = PALETTE.brick;
  c.beginPath();
  c.arc(ox, oy + oh * 0.3, ow * 0.5, Math.PI, 0);
  c.lineTo(ox + ow * 0.5, oy + oh * 0.6);
  c.lineTo(ox - ow * 0.5, oy + oh * 0.6);
  c.closePath();
  c.fill();
  // bricks
  c.strokeStyle = PALETTE.brickDark;
  c.lineWidth = 2;
  for (let r = 0; r < 4; r++) {
    c.beginPath();
    c.arc(ox, oy + oh * 0.3, ow * 0.5 - r * (ow * 0.12), Math.PI, 0);
    c.stroke();
  }
  // mouth glow
  const flame = 0.5 + 0.5 * Math.sin(t * 8);
  const fg = c.createRadialGradient(ox, oy + oh * 0.2, 4, ox, oy + oh * 0.2, ow * 0.3);
  fg.addColorStop(0, mix(PALETTE.flameHot, "#fff", 0.2));
  fg.addColorStop(0.5, PALETTE.flame);
  fg.addColorStop(1, "rgba(255,120,20,0.1)");
  c.globalAlpha = 0.8 + 0.2 * flame;
  c.fillStyle = fg;
  c.beginPath();
  c.ellipse(ox, oy + oh * 0.22, ow * 0.26, oh * 0.22, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = PALETTE.ovenMouth;
  c.beginPath();
  c.ellipse(ox, oy + oh * 0.22, ow * 0.2, oh * 0.16, 0, 0, Math.PI * 2);
  c.fill();
}
