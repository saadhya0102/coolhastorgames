import type { Camera } from "./camera";
import { STAR_COUNT } from "./config";
import type { Palette, Star } from "./types";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Parallax starfield + space gradient + vanishing-point nebula glow. */
export class Starfield {
  private stars: Star[] = [];

  constructor() {
    this.reseed();
  }

  reseed(): void {
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        z: Math.random(),
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  /** stars stream radially out from the vanishing point to amplify warp */
  update(dt: number, speedRings: number, cam: Camera): void {
    const flow = (0.04 + speedRings * 0.013) * dt;
    const cxN = cam.cx / cam.W;
    const cyN = cam.cy / cam.H;
    for (const s of this.stars) {
      const dx = s.x - cxN;
      const dy = s.y - cyN;
      const d = Math.hypot(dx, dy) || 0.0001;
      // accelerate as stars near the edge (perspective warp)
      const push = flow * (0.4 + s.z * 1.6) * (0.3 + d * 2.2);
      s.x += (dx / d) * push;
      s.y += (dy / d) * push;
      s.tw += dt * (1 + s.z * 3);
      if (s.x < -0.05 || s.x > 1.05 || s.y < -0.05 || s.y > 1.05) {
        // respawn near the vanishing point
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.06;
        s.x = cxN + Math.cos(a) * r;
        s.y = cyN + Math.sin(a) * r;
        s.z = Math.random();
      }
    }
  }

  drawBackground(c: CanvasRenderingContext2D, cam: Camera, pal: Palette, t: number): void {
    const { W, H } = cam;
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, pal.bgTop);
    bg.addColorStop(0.55, pal.bgBottom);
    bg.addColorStop(1, "#01010a");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // stars
    for (const s of this.stars) {
      const sx = s.x * W;
      const sy = s.y * H;
      const sz = 0.4 + s.z * 2.1;
      const tw = 0.3 + s.z * 0.5 + Math.sin(s.tw) * 0.25;
      c.fillStyle = `rgba(255,255,255,${clamp(tw, 0.05, 1)})`;
      c.fillRect(sx, sy, sz, sz);
    }

    // nebula glow pulling toward the vanishing point
    const pulse = 0.5 + Math.sin(t * 0.8) * 0.12;
    const rad = Math.max(W, H) * (0.32 + pulse * 0.05);
    const g = c.createRadialGradient(cam.cx, cam.cy, 0, cam.cx, cam.cy, rad);
    g.addColorStop(0, withAlpha(pal.nebula, 0.32));
    g.addColorStop(0.4, withAlpha(pal.nebula, 0.12));
    g.addColorStop(1, withAlpha(pal.nebula, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
}

/** turn an `hsl(...)` color into an `hsla(...)` with the given alpha */
function withAlpha(hsl: string, a: number): string {
  if (hsl.startsWith("hsl(")) {
    return `hsla(${hsl.slice(4, -1)}, ${a})`;
  }
  return hsl;
}
