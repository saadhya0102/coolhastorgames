import type { Camera } from "./camera";
import { FAR, GLOW_RINGS, LIGHT_DIR, NEAR, RC, SEG } from "./config";
import type { Level } from "./level";
import type { Palette } from "./types";

interface Pt {
  sx: number;
  sy: number;
}

const TWO_PI = Math.PI * 2;

/**
 * Renders the polygon-prism tunnel with painter's-algorithm depth, neon edges,
 * per-face lighting and depth fog. Holes are simply not drawn (the starfield
 * shows through = the void).
 */
export class TunnelRenderer {
  private n: number;
  // reusable boundary-polygon buffers (one ring of n vertices per depth slice)
  private bufA: Pt[] = [];
  private bufB: Pt[] = [];

  constructor(n: number) {
    this.n = n;
    for (let i = 0; i < n; i++) {
      this.bufA.push({ sx: 0, sy: 0 });
      this.bufB.push({ sx: 0, sy: 0 });
    }
  }

  /** project the polygon ring at depth dz into `out` */
  private projectRing(cam: Camera, dz: number, out: Pt[]): void {
    const n = this.n;
    for (let k = 0; k < n; k++) {
      const a = (TWO_PI / n) * k + cam.roll;
      const p = cam.project(RC * Math.cos(a), RC * Math.sin(a), dz);
      out[k].sx = p.sx;
      out[k].sy = p.sy;
    }
  }

  draw(
    c: CanvasRenderingContext2D,
    cam: Camera,
    level: Level,
    camZ: number,
    pal: Palette,
    t: number,
  ): void {
    const n = this.n;
    const rMin = Math.max(0, Math.floor((camZ + NEAR) / SEG));
    const rMax = Math.floor((camZ + FAR) / SEG);

    const [tr, tg, tb] = pal.tile;
    const [dr, dg, db] = pal.tileDim;

    // We iterate far -> near. `far` boundary belongs to ring r+1, `near` to r.
    // Reuse two buffers, swapping each step to avoid reprojecting twice.
    let near = this.bufA;
    let far = this.bufB;

    // seed `far` with the far boundary of the farthest ring
    this.projectRing(cam, (rMax + 1) * SEG - camZ, far);

    for (let r = rMax; r >= rMin; r--) {
      const dzNear = r * SEG - camZ;
      this.projectRing(cam, Math.max(NEAR, dzNear), near);

      const dzMid = (r + 0.5) * SEG - camZ;
      const fog = cam.fog(dzMid);
      const ring = level.ring(r);
      const glow = dzMid < GLOW_RINGS;

      // scrolling brightness pulse travelling down the tube ("data flow")
      const pulse = 0.5 + 0.5 * Math.sin(dzMid * 0.45 - t * 2.2);
      const pulseBoost = 0.12 * pulse;

      const edgeAlpha = Math.min(1, fog * 0.85 + 0.1);
      const lineW = Math.max(0.6, fog * 2.4);

      for (let f = 0; f < n; f++) {
        if (ring && !ring.solid[f]) continue; // hole -> void

        const f2 = (f + 1) % n;
        const nL = near[f];
        const nR = near[f2];
        const fR = far[f2];
        const fL = far[f];

        // centroid for grout inset
        const cxq = (nL.sx + nR.sx + fR.sx + fL.sx) * 0.25;
        const cyq = (nL.sy + nR.sy + fR.sy + fL.sy) * 0.25;
        const ins = 0.09;
        const ax = nL.sx + (cxq - nL.sx) * ins;
        const ay = nL.sy + (cyq - nL.sy) * ins;
        const bx = nR.sx + (cxq - nR.sx) * ins;
        const by = nR.sy + (cyq - nR.sy) * ins;
        const ex = fR.sx + (cxq - fR.sx) * ins;
        const ey = fR.sy + (cyq - fR.sy) * ins;
        const gx = fL.sx + (cxq - fL.sx) * ins;
        const gy = fL.sy + (cyq - fL.sy) * ins;

        // per-face lighting from the displayed face angle
        const disp = (TWO_PI / n) * (f + 0.5) + cam.roll;
        const lit = 0.4 + 0.6 * Math.max(0, Math.cos(disp - LIGHT_DIR));
        const bright = (0.32 + 0.68 * fog) * (lit + pulseBoost);

        const rr = Math.round((dr + (tr - dr) * lit) * bright);
        const gg = Math.round((dg + (tg - dg) * lit) * bright);
        const bb = Math.round((db + (tb - db) * lit) * bright);
        const fill = `rgba(${clampByte(rr)},${clampByte(gg)},${clampByte(bb)},${0.5 * fog + 0.34})`;

        c.beginPath();
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
        c.lineTo(ex, ey);
        c.lineTo(gx, gy);
        c.closePath();
        c.fillStyle = fill;
        c.fill();

        c.strokeStyle = setAlpha(pal.edge, edgeAlpha * (0.7 + lit * 0.5));
        c.lineWidth = lineW;
        if (glow) {
          c.shadowBlur = 12 * fog;
          c.shadowColor = pal.edge;
        } else {
          c.shadowBlur = 0;
        }
        c.stroke();
      }
      c.shadowBlur = 0;

      // swap buffers: this ring's near becomes the next (closer) ring's far
      const tmp = far;
      far = near;
      near = tmp;
    }
  }
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** add/override alpha on an `hsl(...)` color */
function setAlpha(hsl: string, a: number): string {
  if (hsl.startsWith("hsl(")) return `hsla(${hsl.slice(4, -1)}, ${a})`;
  return hsl;
}
