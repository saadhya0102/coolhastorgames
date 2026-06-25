import type { InputManager, Rect } from "@/engine";
import { clamp, drawText, pointInRect, roundRect } from "@/engine";
import { PALETTE, lighten, rgba } from "./theme";

export interface ButtonStyle {
  fill: string;
  text: string;
  border?: string;
}

export function clicked(input: InputManager, r: Rect): boolean {
  return input.pointer.justDown && pointInRect(input.pointer.x, input.pointer.y, r);
}

export function hovering(input: InputManager, r: Rect): boolean {
  return pointInRect(input.pointer.x, input.pointer.y, r);
}

export function drawButton(
  c: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  style: ButtonStyle,
  opts: { hover?: boolean; disabled?: boolean; fontScale?: number } = {},
): void {
  const { hover = false, disabled = false, fontScale = 0.4 } = opts;
  const rad = Math.min(r.h * 0.3, 18);
  c.save();
  if (disabled) c.globalAlpha = 0.45;
  c.fillStyle = PALETTE.shadow;
  roundRect(c, r.x, r.y + r.h * 0.08, r.w, r.h, rad);
  c.fill();

  const grad = c.createLinearGradient(0, r.y, 0, r.y + r.h);
  grad.addColorStop(0, lighten(style.fill, hover ? 0.22 : 0.12));
  grad.addColorStop(1, style.fill);
  c.fillStyle = grad;
  roundRect(c, r.x, r.y, r.w, r.h, rad);
  c.fill();

  // top gloss
  c.fillStyle = rgba("#ffffff", 0.18);
  roundRect(c, r.x + r.w * 0.06, r.y + r.h * 0.12, r.w * 0.88, r.h * 0.32, rad * 0.7);
  c.fill();

  if (style.border) {
    c.lineWidth = 2;
    c.strokeStyle = style.border;
    roundRect(c, r.x, r.y, r.w, r.h, rad);
    c.stroke();
  }
  drawText(c, label, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.02, r.h * fontScale, style.text, "center", "800");
  c.restore();
}

export function drawPanel(
  c: CanvasRenderingContext2D,
  r: Rect,
  fill = PALETTE.panel,
  radius = 18,
  shadow = true,
): void {
  c.save();
  if (shadow) {
    c.fillStyle = PALETTE.shadow;
    roundRect(c, r.x, r.y + 6, r.w, r.h, radius);
    c.fill();
  }
  c.fillStyle = fill;
  roundRect(c, r.x, r.y, r.w, r.h, radius);
  c.fill();
  c.restore();
}

export function drawStatBar(
  c: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  level: number,
  xpFrac: number,
  color: string,
): void {
  const barH = r.h * 0.4;
  const barY = r.y + r.h - barH;
  drawText(c, label, r.x, r.y + r.h * 0.22, r.h * 0.32, PALETTE.ink, "left");
  drawText(c, `Lv ${level}`, r.x + r.w, r.y + r.h * 0.22, r.h * 0.34, color, "right");
  c.fillStyle = rgba("#000000", 0.1);
  roundRect(c, r.x, barY, r.w, barH, barH / 2);
  c.fill();
  const w = clamp(xpFrac, 0, 1) * r.w;
  if (w > 2) {
    const g = c.createLinearGradient(r.x, 0, r.x + r.w, 0);
    g.addColorStop(0, lighten(color, 0.18));
    g.addColorStop(1, color);
    c.fillStyle = g;
    roundRect(c, r.x, barY, w, barH, barH / 2);
    c.fill();
  }
}

/** A coin icon. */
export function drawCoin(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.save();
  c.fillStyle = "#e8a91a";
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = PALETTE.coin;
  c.beginPath();
  c.arc(x, y, r * 0.82, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = rgba("#ffffff", 0.5);
  c.beginPath();
  c.ellipse(x - r * 0.25, y - r * 0.3, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** A five-point star icon. */
export function drawStar(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const a2 = a + Math.PI / 5;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    c.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
  }
  c.closePath();
  c.fill();
  c.restore();
}

/** A stat/coin chip with an icon drawn by `icon`. */
export function drawChip(
  c: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  icon: (cx: number, cy: number, rad: number) => void,
): void {
  drawPanel(c, r, rgba("#ffffff", 0.94), r.h / 2, false);
  const iconR = r.h * 0.3;
  icon(r.x + r.h * 0.55, r.y + r.h / 2, iconR);
  drawText(c, text, r.x + r.h, r.y + r.h / 2, r.h * 0.42, PALETTE.ink, "left");
}
