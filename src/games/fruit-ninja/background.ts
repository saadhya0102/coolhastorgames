/**
 * Dusk-dojo background. Fully repainted every frame (cheap: a few gradients +
 * cached silhouette shapes). Atmospheric and original — a warm sunset sky with
 * layered hills, a glowing sun, drifting dust motes and an edge vignette.
 */
import type { World } from "./types";
import { TAU, seeded } from "./types";

interface Mote {
  x: number;
  y: number;
  r: number;
  sp: number;
  ph: number;
}

export class Background {
  private motes: Mote[] = [];
  private w = 0;
  private h = 0;
  /** ambient tint overlay (e.g. blue when freeze power-up active) 0..1 */
  freezeTint = 0;

  ensure(world: World): void {
    if (world.w === this.w && world.h === this.h && this.motes.length) return;
    this.w = world.w;
    this.h = world.h;
    const n = 26;
    this.motes = [];
    for (let i = 0; i < n; i++) {
      this.motes.push({
        x: Math.random() * world.w,
        y: Math.random() * world.h,
        r: (0.002 + Math.random() * 0.004) * world.min,
        sp: (0.2 + Math.random() * 0.6) * world.min * 0.02,
        ph: Math.random() * TAU,
      });
    }
  }

  render(c: CanvasRenderingContext2D, world: World): void {
    this.ensure(world);
    const { w, h } = world;
    const t = world.time;

    // sky gradient: deep indigo -> warm plum -> ember near horizon
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#241046");
    sky.addColorStop(0.45, "#4a1f5e");
    sky.addColorStop(0.72, "#8c3b5a");
    sky.addColorStop(0.88, "#d8743f");
    sky.addColorStop(1, "#f0a55a");
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);

    // sun glow low in the sky
    const sunX = w * 0.5;
    const sunY = h * 0.78;
    const sunR = world.min * 0.16;
    const glow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 4);
    glow.addColorStop(0, "rgba(255,220,150,0.85)");
    glow.addColorStop(0.4, "rgba(255,170,90,0.35)");
    glow.addColorStop(1, "rgba(255,150,80,0)");
    c.fillStyle = glow;
    c.beginPath();
    c.arc(sunX, sunY, sunR * 4, 0, TAU);
    c.fill();
    c.fillStyle = "rgba(255,236,190,0.9)";
    c.beginPath();
    c.arc(sunX, sunY, sunR, 0, TAU);
    c.fill();

    // layered hill silhouettes
    this.hills(c, world, 0.7, "#3a1740", 1.0, t);
    this.hills(c, world, 0.8, "#2a0f30", 0.7, t * 0.7);
    this.hills(c, world, 0.9, "#190a22", 0.5, t * 0.5);

    // dust motes
    c.fillStyle = "rgba(255,235,200,0.5)";
    for (const m of this.motes) {
      m.y -= m.sp * (1 / 60);
      if (m.y < -10) m.y = h + 10;
      const a = 0.3 + 0.3 * Math.sin(t * 2 + m.ph);
      c.globalAlpha = a;
      c.beginPath();
      c.arc(m.x, m.y, m.r, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;

    // optional freeze tint
    if (this.freezeTint > 0.01) {
      c.fillStyle = `rgba(120,200,255,${0.18 * this.freezeTint})`;
      c.fillRect(0, 0, w, h);
    }

    // vignette
    const vg = c.createRadialGradient(
      w * 0.5,
      h * 0.45,
      world.min * 0.2,
      w * 0.5,
      h * 0.5,
      world.min * 0.9,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }

  private hills(
    c: CanvasRenderingContext2D,
    world: World,
    baseY: number,
    color: string,
    amp: number,
    drift: number,
  ): void {
    const { w, h } = world;
    const y0 = h * baseY;
    const a = h * 0.06 * amp;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, y0);
    const seed = Math.floor(baseY * 1000);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const n =
        Math.sin(i * 1.3 + seeded(seed, i) * 6 + drift * 0.1) * a +
        Math.sin(i * 0.6 + drift * 0.05) * a * 0.5;
      c.lineTo(x, y0 + n);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fill();
  }
}
