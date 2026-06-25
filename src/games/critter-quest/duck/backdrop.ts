import { rgba } from "./theme";

const TAU = Math.PI * 2;

/** Full-frame vertical sky gradient. */
export function sky(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  top: string,
  bottom: string,
): void {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

/** Soft glowing sun/moon. */
export function sun(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  const g = c.createRadialGradient(x, y, r * 0.3, x, y, r * 2.4);
  g.addColorStop(0, rgba(color, 0.85));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r * 2.4, 0, TAU);
  c.fill();
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

/** A fluffy cloud centered at (x,y). */
export function cloud(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, s, s * 0.62, 0, 0, TAU);
  c.ellipse(x - s * 0.8, y + s * 0.15, s * 0.6, s * 0.45, 0, 0, TAU);
  c.ellipse(x + s * 0.85, y + s * 0.12, s * 0.66, s * 0.5, 0, 0, TAU);
  c.ellipse(x + s * 0.1, y + s * 0.3, s * 0.95, s * 0.5, 0, 0, TAU);
  c.fill();
}

/** Scrolling cloud layer. */
export function clouds(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  opts: { speed?: number; count?: number; band?: number; size?: number; color?: string } = {},
): void {
  const speed = opts.speed ?? 16;
  const count = opts.count ?? 4;
  const band = opts.band ?? 0.32;
  const size = opts.size ?? 0.07;
  const color = opts.color ?? rgba("#ffffff", 0.85);
  const span = W + 240;
  for (let i = 0; i < count; i++) {
    const seed = i * 137.5;
    const x = ((i * (span / count) - t * speed) % span + span) % span - 120;
    const y = H * (0.08 + band * ((Math.sin(seed) * 0.5 + 0.5)));
    cloud(c, x, y, Math.min(W, H) * size * (0.7 + (i % 3) * 0.25), color);
  }
}

/** Overlapping rounded hill bands (back to front). */
export function hills(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  baseY: number,
  colors: string[],
): void {
  colors.forEach((color, i) => {
    const depth = i + 1;
    const amp = H * (0.06 + i * 0.03);
    const y = baseY - (colors.length - i) * H * 0.05;
    const off = (t * (4 + i * 3)) % (W * 0.5);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, H);
    c.lineTo(0, y);
    const step = W / 6;
    for (let x = -off; x <= W + step; x += step) {
      const yy = y + Math.sin((x / W) * Math.PI * depth + i) * amp;
      c.lineTo(x, yy);
    }
    c.lineTo(W, H);
    c.closePath();
    c.fill();
  });
}

/** Animated water band starting at waterY going to bottom. */
export function water(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  waterY: number,
  top: string,
  bottom: string,
): void {
  const g = c.createLinearGradient(0, waterY, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, waterY, W, H - waterY);

  // surface wavelets
  c.strokeStyle = rgba("#ffffff", 0.35);
  c.lineWidth = 3;
  c.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const y = waterY + Math.sin(x * 0.03 + t * 3) * 4;
    if (x === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();

  // light shafts
  c.save();
  c.globalAlpha = 0.08;
  c.fillStyle = "#ffffff";
  for (let i = 0; i < 4; i++) {
    const x = ((i * W) / 4 + Math.sin(t * 0.3 + i) * 30) % W;
    c.beginPath();
    c.moveTo(x, waterY);
    c.lineTo(x + 40, waterY);
    c.lineTo(x + 90, H);
    c.lineTo(x + 10, H);
    c.closePath();
    c.fill();
  }
  c.restore();
}

/** Rising bubbles inside the water area (decorative). */
export function waterBubbles(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  waterY: number,
): void {
  c.fillStyle = rgba("#ffffff", 0.25);
  for (let i = 0; i < 14; i++) {
    const seed = i * 53.13;
    const x = (Math.sin(seed) * 0.5 + 0.5) * W;
    const span = H - waterY;
    const y = H - (((t * (10 + (i % 5) * 6) + seed * 30) % span));
    const r = 2 + (i % 4);
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }
}

/** Ground band with grass blade tufts; scrolls with `off`. */
export function grass(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  groundY: number,
  off: number,
  top: string,
  bottom: string,
  bladeColor: string,
): void {
  const g = c.createLinearGradient(0, groundY, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, groundY, W, H - groundY);
  // top rim
  c.fillStyle = bladeColor;
  c.fillRect(0, groundY, W, Math.max(3, H * 0.01));
  // blades
  c.strokeStyle = bladeColor;
  c.lineWidth = 3;
  const spacing = Math.max(18, W * 0.03);
  c.beginPath();
  for (let x = -((off) % spacing); x < W; x += spacing) {
    c.moveTo(x, groundY);
    c.lineTo(x + 4, groundY - 9);
    c.moveTo(x + spacing * 0.4, groundY);
    c.lineTo(x + spacing * 0.4 - 3, groundY - 6);
  }
  c.stroke();
}

/** Twinkling stars for night/high leagues. */
export function stars(c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  for (let i = 0; i < 40; i++) {
    const seed = i * 97.13;
    const x = (Math.sin(seed) * 0.5 + 0.5) * W;
    const y = (Math.cos(seed * 1.7) * 0.5 + 0.5) * H * 0.6;
    const tw = 0.4 + 0.6 * (Math.sin(t * 2 + seed) * 0.5 + 0.5);
    c.fillStyle = rgba("#ffffff", tw);
    c.fillRect(x, y, 2, 2);
  }
}
