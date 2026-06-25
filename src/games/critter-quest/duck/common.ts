import type { GameContext, Rect } from "@/engine";
import { drawText, roundRect } from "@/engine";
import { PALETTE, rgba } from "./theme";
import { clicked, drawButton, drawPanel, hovering } from "./ui";

/** Big centered 3-2-1-GO countdown. `value` <=0 means "GO". */
export function drawCountdown(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  value: number,
  frac: number,
): void {
  c.save();
  c.fillStyle = rgba("#000000", 0.18);
  c.fillRect(0, 0, W, H);
  const pop = 1 + (1 - frac) * 0.6;
  const txt = value <= 0 ? "GO!" : String(value);
  const size = Math.min(W, H) * 0.22 * pop;
  c.globalAlpha = Math.min(1, frac * 2.5);
  drawText(c, txt, W / 2, H / 2, size, value <= 0 ? PALETTE.good : "#ffffff", "center", "800");
  c.restore();
}

export interface MiniResult {
  title: string;
  lines: { label: string; value: string; color: string }[];
  banner?: string;
}

/** A reusable end-of-minigame result card with a CONTINUE button.
 * Returns true on the frame CONTINUE is pressed. */
export class ResultCard {
  private appear = 0;

  constructor(private result: MiniResult) {}

  update(dt: number): void {
    this.appear = Math.min(1, this.appear + dt * 3.2);
  }

  /** Returns true if continue was pressed this frame. */
  handle(ctx: GameContext): boolean {
    if (this.appear < 0.6) return false;
    const r = this.btnRect(ctx);
    if (clicked(ctx.input, r) || ctx.input.pressed("Space", "Enter")) return true;
    return false;
  }

  private btnRect(ctx: GameContext): Rect {
    const W = ctx.width;
    const H = ctx.height;
    return { x: W / 2 - W * 0.22, y: H * 0.74, w: W * 0.44, h: H * 0.1 };
  }

  render(ctx: GameContext): void {
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;
    const e = easeOut(this.appear);
    c.save();
    c.fillStyle = rgba("#0c1024", 0.45 * e);
    c.fillRect(0, 0, W, H);

    const pw = Math.min(W * 0.78, H * 1.0);
    const ph = H * 0.6;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2 - (1 - e) * H * 0.1 + H * 0.02;
    c.globalAlpha = e;
    drawPanel(c, { x: px, y: py, w: pw, h: ph }, "#ffffff", 22);

    drawText(c, this.result.title, W / 2, py + ph * 0.13, ph * 0.13, PALETTE.ink, "center", "800");

    if (this.result.banner) {
      const by = py + ph * 0.26;
      drawPanel(c, { x: px + pw * 0.12, y: by - ph * 0.05, w: pw * 0.76, h: ph * 0.1 }, PALETTE.accent, 12, false);
      drawText(c, this.result.banner, W / 2, by, ph * 0.07, "#ffffff", "center", "800");
    }

    const startY = py + ph * (this.result.banner ? 0.44 : 0.34);
    this.result.lines.forEach((ln, i) => {
      const y = startY + i * ph * 0.11;
      drawText(c, ln.label, px + pw * 0.18, y, ph * 0.075, PALETTE.inkSoft, "left");
      drawText(c, ln.value, px + pw * 0.82, y, ph * 0.085, ln.color, "right", "800");
    });

    const r = this.btnRect(ctx);
    drawButton(c, r, "CONTINUE", { fill: PALETTE.good, text: "#fff" }, {
      hover: hovering(ctx.input, r),
      fontScale: 0.42,
    });
    c.restore();
  }
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Live mini-game HUD: timer bar at top + a score readout. */
export function drawMiniHud(
  ctx: GameContext,
  timeLeft: number,
  timeMax: number,
  scoreLabel: string,
  scoreValue: string,
  color: string,
): void {
  const c = ctx.ctx;
  const W = ctx.width;
  const H = ctx.height;
  // timer bar
  const bx = W * 0.06;
  const bw = W * 0.5;
  const by = H * 0.05;
  const bh = H * 0.028;
  c.fillStyle = rgba("#000000", 0.25);
  roundRect(c, bx, by, bw, bh, bh / 2);
  c.fill();
  const frac = Math.max(0, timeLeft / timeMax);
  c.fillStyle = frac < 0.25 ? PALETTE.bad : color;
  if (frac > 0) {
    roundRect(c, bx, by, bw * frac, bh, bh / 2);
    c.fill();
  }
  drawText(c, `${Math.ceil(timeLeft)}s`, bx + bw + W * 0.02, by + bh / 2, H * 0.03, "#ffffff", "left", "800");
  // score chip
  drawText(c, `${scoreLabel}: ${scoreValue}`, W * 0.94, by + bh / 2, H * 0.036, "#ffffff", "right", "800");
}
