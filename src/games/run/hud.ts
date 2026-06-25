import { drawText } from "@/engine";
import type { Palette } from "./types";

const setAlpha = (hsl: string, a: number): string =>
  hsl.startsWith("hsl(") ? `hsla(${hsl.slice(4, -1)}, ${a})` : hsl;

/** live distance + best while running */
export function drawPlayingHud(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  score: number,
  best: number,
  pal: Palette,
  milestoneFlash: number,
): void {
  const big = Math.max(22, H * 0.085);
  c.save();
  c.shadowBlur = H * 0.02 * (1 + milestoneFlash);
  c.shadowColor = pal.edge;
  drawText(c, String(score), W / 2, H * 0.11, big, "#eaf6ff", "center", "800");
  c.restore();
  drawText(
    c,
    `BEST ${Math.max(best, score)}`,
    W / 2,
    H * 0.11 + big * 0.78,
    Math.max(11, H * 0.03),
    setAlpha(pal.edge, 0.7),
    "center",
    "700",
  );
  if (milestoneFlash > 0.01) {
    drawText(
      c,
      "+",
      W / 2,
      H * 0.11,
      big * (1 + milestoneFlash),
      `rgba(255,255,255,${milestoneFlash * 0.25})`,
    );
  }
}

/** attract / start screen */
export function drawReady(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  pal: Palette,
  best: number,
  t: number,
  isTouch: boolean,
): void {
  // soft vignette so text reads over the moving tunnel
  const g = c.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, Math.max(W, H) * 0.7);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const titleSize = Math.min(W * 0.13, H * 0.12);
  c.save();
  c.shadowBlur = H * 0.04;
  c.shadowColor = pal.edge;
  drawText(c, "NEON", W / 2, H * 0.34, titleSize, "#ffffff", "center", "800");
  drawText(
    c,
    "CONDUIT",
    W / 2,
    H * 0.34 + titleSize * 0.92,
    titleSize,
    setAlpha(pal.edge, 1),
    "center",
    "800",
  );
  c.restore();

  const ctrl = isTouch
    ? "◀ ▶  roll the tunnel   ·   JUMP the gaps"
    : "◀ ▶ / A D  roll   ·   SPACE / ↑  jump";
  drawText(
    c,
    ctrl,
    W / 2,
    H * 0.58,
    Math.max(12, H * 0.032),
    "rgba(200,225,255,0.85)",
  );

  const pulse = 0.55 + 0.45 * Math.sin(t * 3.2);
  drawText(
    c,
    isTouch ? "TAP TO RUN" : "PRESS SPACE TO RUN",
    W / 2,
    H * 0.7,
    Math.max(15, H * 0.05),
    `rgba(255,255,255,${pulse})`,
    "center",
    "800",
  );

  if (best > 0) {
    drawText(
      c,
      `BEST ${best}`,
      W / 2,
      H * 0.82,
      Math.max(12, H * 0.035),
      setAlpha(pal.edge, 0.8),
    );
  }
}

/** in-canvas death flourish shown during the gameOver delay */
export function drawDying(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  pal: Palette,
  score: number,
  k: number, // 0..1 progress through the delay
): void {
  c.fillStyle = `rgba(2,2,12,${0.15 + k * 0.5})`;
  c.fillRect(0, 0, W, H);
  const size = Math.max(20, H * 0.09);
  c.save();
  c.shadowBlur = H * 0.03;
  c.shadowColor = pal.edge;
  drawText(c, "FELL!", W / 2, H * 0.4, size, "#ffffff", "center", "800");
  c.restore();
  drawText(
    c,
    `${score} m`,
    W / 2,
    H * 0.4 + size * 0.9,
    Math.max(14, H * 0.05),
    setAlpha(pal.edge, 0.9),
    "center",
    "800",
  );
}

/** brief full-screen flash (death / milestone) */
export function drawFlash(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0.001) return;
  c.fillStyle = setAlpha(color, alpha);
  c.fillRect(0, 0, W, H);
}
