import { clamp, pointInRect, roundRect } from "@/engine";
import type { AudioManager, InputManager, Rect } from "@/engine";
import { PALETTE } from "./config";

/** Was a tap completed inside this rect this frame? */
export function tapped(input: InputManager, r: Rect): boolean {
  return input.pointer.justUp && pointInRect(input.pointer.x, input.pointer.y, r);
}

export function hovering(input: InputManager, r: Rect): boolean {
  return pointInRect(input.pointer.x, input.pointer.y, r);
}

export function pressing(input: InputManager, r: Rect): boolean {
  return input.pointer.down && pointInRect(input.pointer.x, input.pointer.y, r);
}

export interface PanelOpts {
  fill?: string;
  edge?: string;
  radius?: number;
  shadow?: boolean;
  lineWidth?: number;
}

export function drawPanel(c: CanvasRenderingContext2D, r: Rect, opts: PanelOpts = {}): void {
  const radius = opts.radius ?? Math.min(r.w, r.h) * 0.12;
  if (opts.shadow !== false) {
    c.save();
    c.fillStyle = PALETTE.shadow;
    roundRect(c, r.x, r.y + 4, r.w, r.h, radius);
    c.fill();
    c.restore();
  }
  c.fillStyle = opts.fill ?? PALETTE.panel;
  roundRect(c, r.x, r.y, r.w, r.h, radius);
  c.fill();
  c.lineWidth = opts.lineWidth ?? 2;
  c.strokeStyle = opts.edge ?? PALETTE.panelEdge;
  roundRect(c, r.x, r.y, r.w, r.h, radius);
  c.stroke();
}

export type ButtonStyle = "primary" | "secondary" | "ghost" | "danger" | "gold";

export interface ButtonOpts {
  style?: ButtonStyle;
  disabled?: boolean;
  pressed?: boolean;
  size?: number;
  radius?: number;
}

const BTN_FILL: Record<ButtonStyle, [string, string]> = {
  primary: ["#ff8a4d", "#ef6a2f"],
  secondary: ["#ffe2bd", "#f0caa0"],
  ghost: ["#fff7ec", "#ecd9bc"],
  danger: ["#ef6a5a", "#d84436"],
  gold: ["#ffd95c", "#f3b62f"],
};

export function drawButton(
  c: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  opts: ButtonOpts = {},
): void {
  const style = opts.style ?? "primary";
  const [top, bot] = BTN_FILL[style];
  const radius = opts.radius ?? Math.min(r.w, r.h) * 0.28;
  const press = opts.pressed && !opts.disabled;
  const oy = press ? 2 : 0;

  if (!press && !opts.disabled) {
    c.fillStyle = "rgba(58,36,24,0.25)";
    roundRect(c, r.x, r.y + 4, r.w, r.h, radius);
    c.fill();
  }
  const g = c.createLinearGradient(0, r.y + oy, 0, r.y + r.h + oy);
  if (opts.disabled) {
    g.addColorStop(0, "#d8cdbb");
    g.addColorStop(1, "#c3b6a0");
  } else {
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
  }
  c.fillStyle = g;
  roundRect(c, r.x, r.y + oy, r.w, r.h, radius);
  c.fill();
  // top sheen
  c.fillStyle = "rgba(255,255,255,0.28)";
  roundRect(c, r.x + r.w * 0.08, r.y + oy + r.h * 0.12, r.w * 0.84, r.h * 0.3, radius * 0.6);
  c.fill();

  const fg =
    opts.disabled
      ? "#8a7e6c"
      : style === "secondary" || style === "ghost" || style === "gold"
        ? PALETTE.ink
        : "#fff";
  const size = opts.size ?? Math.min(r.h * 0.42, r.w * 0.22);
  c.fillStyle = fg;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `800 ${size}px "Baloo 2", system-ui, sans-serif`;
  c.fillText(label, r.x + r.w / 2, r.y + oy + r.h / 2 + size * 0.04);
}

/** A horizontal progress bar with optional highlighted target band. */
export function drawBar(
  c: CanvasRenderingContext2D,
  r: Rect,
  value: number,
  fill: string,
  opts?: { band?: [number, number]; bandColor?: string; bg?: string; radius?: number },
): void {
  const radius = opts?.radius ?? r.h / 2;
  c.fillStyle = opts?.bg ?? "rgba(58,36,24,0.18)";
  roundRect(c, r.x, r.y, r.w, r.h, radius);
  c.fill();
  if (opts?.band) {
    const [lo, hi] = opts.band;
    c.save();
    roundRect(c, r.x, r.y, r.w, r.h, radius);
    c.clip();
    c.fillStyle = opts.bandColor ?? "rgba(70,196,106,0.45)";
    c.fillRect(r.x + lo * r.w, r.y, (hi - lo) * r.w, r.h);
    c.restore();
  }
  const v = clamp(value, 0, 1);
  if (v > 0.001) {
    c.save();
    roundRect(c, r.x, r.y, r.w, r.h, radius);
    c.clip();
    c.fillStyle = fill;
    c.fillRect(r.x, r.y, v * r.w, r.h);
    c.fillStyle = "rgba(255,255,255,0.22)";
    c.fillRect(r.x, r.y, v * r.w, r.h * 0.4);
    c.restore();
  }
  c.lineWidth = 1.5;
  c.strokeStyle = "rgba(58,36,24,0.25)";
  roundRect(c, r.x, r.y, r.w, r.h, radius);
  c.stroke();
}

/** Draw a 0..5 (fractional) row of stars centered at cx. */
export function drawStars(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  value: number,
  r: number,
  gap: number,
): void {
  const total = 5;
  const fullW = total * (r * 2) + (total - 1) * gap;
  let x = cx - fullW / 2 + r;
  for (let i = 0; i < total; i++) {
    const fill = clamp(value - i, 0, 1);
    drawSingleStar(c, x, cy, r, "rgba(58,36,24,0.18)", 1);
    if (fill > 0) {
      c.save();
      c.beginPath();
      c.rect(x - r, cy - r, r * 2 * fill, r * 2);
      c.clip();
      drawSingleStar(c, x, cy, r, PALETTE.accent2, fill);
      c.restore();
    }
    x += r * 2 + gap;
  }
}

function drawSingleStar(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  _f: number,
): void {
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
  c.fill();
}

/** Small numeric/notification badge centered at (x,y). */
export function drawBadge(c: CanvasRenderingContext2D, x: number, y: number, n: number, r: number, color = PALETTE.red): void {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `800 ${r * 1.2}px "Baloo 2", system-ui, sans-serif`;
  c.fillText(String(n), x, y + r * 0.06);
}

export function text(
  c: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
  weight = "700",
): void {
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.font = `${weight} ${size}px "Baloo 2", system-ui, sans-serif`;
  c.fillText(s, x, y);
}

/** mix two hex colors (#rrggbb) by t */
export function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function parseHex(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Procedural sound effects bound to the engine AudioManager. */
export class Sfx {
  constructor(private a: AudioManager) {}

  tap(): void {
    this.a.tone(520, 0.04, "square", 0.18);
  }
  bell(): void {
    this.a.tone(880, 0.12, "sine", 0.3);
    setTimeout(() => this.a.tone(1320, 0.16, "sine", 0.28), 90);
  }
  pop(): void {
    this.a.tone(420 + Math.random() * 220, 0.05, "square", 0.22);
  }
  whoosh(): void {
    this.a.sweep(620, 180, 0.26, "sine", 0.3);
  }
  sizzle(quality: number): void {
    this.a.noise(0.22, 0.28);
    this.a.tone(300 + quality * 500, 0.12, "sine", 0.18);
  }
  slice(): void {
    this.a.noise(0.06, 0.3);
    this.a.tone(1400, 0.05, "sine", 0.18);
  }
  serve(stars: number): void {
    this.a.coin();
    if (stars >= 4) setTimeout(() => this.a.tone(1568, 0.12, "triangle", 0.3), 120);
  }
  cash(): void {
    [660, 880, 1320].forEach((f, i) => setTimeout(() => this.a.tone(f, 0.1, "square", 0.3), i * 70));
  }
  buy(): void {
    this.a.tone(740, 0.07, "square", 0.3);
    setTimeout(() => this.a.tone(990, 0.09, "square", 0.3), 70);
  }
  win(): void {
    this.a.win();
  }
  fail(): void {
    this.a.lose();
  }
  angry(): void {
    this.a.tone(160, 0.18, "sawtooth", 0.3);
    this.a.tone(120, 0.22, "sawtooth", 0.25);
  }
}
