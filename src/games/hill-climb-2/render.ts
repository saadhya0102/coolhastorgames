/**
 * Hill Climb 2 — world renderer.
 * Stateless-ish draw helpers (one cached-gradient holder) that paint the sky,
 * parallax, terrain, decorations, pickups and the vehicle. All procedural.
 */
import { drawText, roundRect } from "@/engine";
import type { Car } from "./physics";
import type { Terrain } from "./terrain";
import type { StageDef, VehicleDef } from "./types";

export interface View {
  W: number;
  H: number;
  camX: number;
  camY: number;
  zoom: number;
  anchorX: number; // 0..1 horizontal anchor of camX on screen
  anchorY: number; // 0..1 vertical anchor of camY on screen
}

export const projX = (v: View, wx: number): number =>
  (wx - v.camX) * v.zoom + v.W * v.anchorX;
export const projY = (v: View, wy: number): number =>
  (wy - v.camY) * v.zoom + v.H * v.anchorY;
export const project = (v: View, wx: number, wy: number): { x: number; y: number } => ({
  x: projX(v, wx),
  y: projY(v, wy),
});
const worldXAt = (v: View, px: number): number =>
  v.camX + (px - v.W * v.anchorX) / v.zoom;

export class Renderer {
  private skyKey = "";
  private sky: CanvasGradient | null = null;

  /** Sky gradient + atmospheric flair (clouds/stars/haze/aurora). */
  drawSky(c: CanvasRenderingContext2D, v: View, stage: StageDef, t: number): void {
    const p = stage.palette;
    const key = `${v.W}x${v.H}:${stage.id}`;
    if (key !== this.skyKey || !this.sky) {
      const g = c.createLinearGradient(0, 0, 0, v.H);
      g.addColorStop(0, p.skyTop);
      g.addColorStop(1, p.skyBottom);
      this.sky = g;
      this.skyKey = key;
    }
    c.fillStyle = this.sky;
    c.fillRect(0, 0, v.W, v.H);

    if (p.flair === "stars") {
      c.fillStyle = "#fff";
      for (let i = 0; i < 70; i++) {
        const sx = (i * 9871) % v.W;
        const sy = ((i * 5417) % Math.floor(v.H * 0.7));
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
        c.globalAlpha = tw;
        c.fillRect(sx, sy, 2, 2);
      }
      c.globalAlpha = 1;
      // earth disc
      c.fillStyle = "#4f8cff";
      c.beginPath();
      c.arc(v.W * 0.8, v.H * 0.2, v.H * 0.07, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(120,220,140,0.6)";
      c.beginPath();
      c.arc(v.W * 0.8 - v.H * 0.02, v.H * 0.2, v.H * 0.04, 0, Math.PI * 2);
      c.fill();
    } else {
      // sun / moon disc
      c.fillStyle = p.sun;
      c.globalAlpha = 0.9;
      c.beginPath();
      c.arc(v.W * 0.78, v.H * 0.2, v.H * 0.08, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }

    if (p.flair === "clouds") {
      c.fillStyle = "rgba(255,255,255,0.75)";
      for (let i = 0; i < 5; i++) {
        const cx = ((i * 260 - v.camX * 0.15 - t * 6) % (v.W + 240) + v.W + 240) % (v.W + 240) - 120;
        const cy = v.H * (0.12 + (i % 3) * 0.1);
        cloud(c, cx, cy, v.H * 0.05);
      }
    } else if (p.flair === "aurora") {
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = 0.12;
        c.fillStyle = i === 0 ? "#5cffd0" : i === 1 ? "#8f9bff" : "#ff8fd0";
        c.beginPath();
        const yb = v.H * (0.18 + i * 0.06);
        c.moveTo(0, yb);
        for (let x = 0; x <= v.W; x += 40) {
          c.lineTo(x, yb + Math.sin(x * 0.01 + t * 0.6 + i) * v.H * 0.05);
        }
        c.lineTo(v.W, 0);
        c.lineTo(0, 0);
        c.closePath();
        c.fill();
      }
      c.globalAlpha = 1;
    } else if (p.flair === "haze") {
      c.globalAlpha = 0.18;
      c.fillStyle = "#fff";
      for (let i = 0; i < 4; i++) {
        const yb = v.H * (0.55 + i * 0.06);
        c.fillRect(0, yb + Math.sin(t * 2 + i) * 2, v.W, 2);
      }
      c.globalAlpha = 1;
    }
  }

  /** Two parallax silhouette bands behind the terrain. */
  drawParallax(c: CanvasRenderingContext2D, v: View, stage: StageDef): void {
    const p = stage.palette;
    this.parallaxBand(c, v, p.far, 0.15, v.H * 0.62, v.H * 0.14, 320, 7);
    this.parallaxBand(c, v, p.mid, 0.32, v.H * 0.7, v.H * 0.1, 210, 11);
  }

  private parallaxBand(
    c: CanvasRenderingContext2D,
    v: View,
    color: string,
    factor: number,
    baseY: number,
    amp: number,
    wl: number,
    seed: number,
  ): void {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, v.H);
    const off = v.camX * factor;
    for (let x = -20; x <= v.W + 20; x += 16) {
      const wx = x + off;
      const y =
        baseY +
        Math.sin(wx / wl + seed) * amp +
        Math.sin(wx / (wl * 0.4) + seed * 2) * amp * 0.3;
      c.lineTo(x, y);
    }
    c.lineTo(v.W + 20, v.H);
    c.closePath();
    c.fill();
  }

  /** The terrain body fill + bright surface line. */
  drawTerrain(c: CanvasRenderingContext2D, v: View, terrain: Terrain): void {
    const p = terrain.stage.palette;
    const step = 6;
    c.beginPath();
    let first = true;
    for (let px = -step; px <= v.W + step; px += step) {
      const wx = worldXAt(v, px);
      const py = projY(v, terrain.height(wx));
      if (first) {
        c.moveTo(px, py);
        first = false;
      } else c.lineTo(px, py);
    }
    c.lineTo(v.W + step, v.H + step);
    c.lineTo(-step, v.H + step);
    c.closePath();
    const g = c.createLinearGradient(0, v.H * 0.25, 0, v.H);
    g.addColorStop(0, p.groundTop);
    g.addColorStop(0.12, p.groundTop);
    g.addColorStop(1, p.groundBottom);
    c.fillStyle = g;
    c.fill();

    // sub-surface band
    c.save();
    c.clip();
    c.fillStyle = "rgba(0,0,0,0.12)";
    first = true;
    c.beginPath();
    for (let px = -step; px <= v.W + step; px += step) {
      const wx = worldXAt(v, px);
      const py = projY(v, terrain.height(wx)) + 14 * v.zoom;
      if (first) {
        c.moveTo(px, py);
        first = false;
      } else c.lineTo(px, py);
    }
    c.lineTo(v.W + step, v.H + step);
    c.lineTo(-step, v.H + step);
    c.closePath();
    c.fill();
    c.restore();

    // bright surface line
    c.lineWidth = Math.max(2, v.zoom * 5);
    c.strokeStyle = p.surfaceLine;
    c.beginPath();
    first = true;
    for (let px = -step; px <= v.W + step; px += step) {
      const wx = worldXAt(v, px);
      const py = projY(v, terrain.height(wx));
      if (first) {
        c.moveTo(px, py);
        first = false;
      } else c.lineTo(px, py);
    }
    c.stroke();
  }

  /** Stage decorations sitting on the surface. */
  drawDecor(c: CanvasRenderingContext2D, v: View, terrain: Terrain): void {
    const p = terrain.stage.palette;
    const kind = terrain.stage.id;
    for (const d of terrain.decorations) {
      const sx = projX(v, d.x);
      if (sx < -60 || sx > v.W + 60) continue;
      const sy = projY(v, terrain.height(d.x));
      const s = d.scale * v.zoom;
      c.save();
      c.translate(sx, sy);
      if (kind === "country") drawTree(c, s, d.kind, p.decor);
      else if (kind === "desert") drawCactus(c, s, d.kind, p.decor);
      else if (kind === "moon") drawCrater(c, s, d.kind, p.surfaceLine);
      else drawPine(c, s, d.kind, p.decor);
      c.restore();
    }
  }

  /** Coins + fuel cans. */
  drawPickups(c: CanvasRenderingContext2D, v: View, terrain: Terrain, t: number): void {
    for (const it of terrain.pickups) {
      if (it.got) continue;
      const sx = projX(v, it.x);
      if (sx < -40 || sx > v.W + 40) continue;
      const sy = projY(v, it.y) + Math.sin(t * 4 + it.bob) * 4;
      if (it.kind === "coin") {
        const sw = Math.abs(Math.cos(t * 4 + it.bob)); // fake 3D spin
        c.fillStyle = "#ffd23f";
        c.strokeStyle = "#e0a000";
        c.lineWidth = Math.max(1, v.zoom * 1.5);
        c.beginPath();
        c.ellipse(sx, sy, 10 * v.zoom * (0.4 + sw * 0.6), 10 * v.zoom, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        if (sw > 0.4) drawText(c, "$", sx, sy, 11 * v.zoom * sw, "#a06b00");
      } else {
        c.fillStyle = "#e23b3b";
        c.strokeStyle = "#7a1f1f";
        c.lineWidth = Math.max(1, v.zoom);
        roundRect(c, sx - 9 * v.zoom, sy - 11 * v.zoom, 18 * v.zoom, 22 * v.zoom, 3 * v.zoom);
        c.fill();
        c.stroke();
        c.fillStyle = "#fff";
        roundRect(c, sx - 5 * v.zoom, sy - 13 * v.zoom, 10 * v.zoom, 4 * v.zoom, 1 * v.zoom);
        c.fill();
        drawText(c, "F", sx, sy + 1 * v.zoom, 12 * v.zoom, "#fff");
      }
    }
  }

  /** Draw the vehicle (wheels + chassis) at its physics transform. */
  drawCar(c: CanvasRenderingContext2D, v: View, car: Car, def: VehicleDef): void {
    const zoom = v.zoom;
    // wheels
    for (const w of car.wheels) {
      const wx = projX(v, w.x);
      const wy = projY(v, w.y);
      drawWheel(c, wx, wy, def.style === "truck" ? 24 * zoom : (def.id === "sports" ? 13 : (def.id === "bike" ? 15 : (def.id === "rover" ? 18 : 16))) * zoom, w.spin, def);
    }

    const cx = projX(v, car.cx);
    const cy = projY(v, car.cy);
    c.save();
    c.translate(cx, cy);
    c.rotate(car.ang);
    const bw = def.bodyW * zoom;
    const bh = def.bodyH * zoom;
    const ch = def.cabinH * zoom;
    drawChassis(c, bw, bh, ch, def);
    c.restore();
  }
}

/** Draw a static vehicle preview (for the garage) centred at (x,y). */
export function drawVehiclePreview(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  def: VehicleDef,
  bob: number,
): void {
  const r =
    (def.style === "truck" ? 24 : def.id === "sports" ? 13 : def.id === "bike" ? 15 : def.id === "rover" ? 18 : 16) *
    scale;
  const axleX = (def.wheelBase / 2) * scale;
  const axleY = def.axleY * scale + def.restLen * scale * 0.7;
  const yy = y + Math.sin(bob) * 3;
  drawWheel(c, x - axleX, yy + axleY, r, bob * 1.5, def);
  drawWheel(c, x + axleX, yy + axleY, r, bob * 1.5, def);
  c.save();
  c.translate(x, yy);
  drawChassis(c, def.bodyW * scale, def.bodyH * scale, def.cabinH * scale, def);
  c.restore();
}

// ---------------------------------------------------------------------------
// procedural shapes
// ---------------------------------------------------------------------------
function cloud(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
  c.ellipse(x + r * 1.3, y + r * 0.2, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
  c.ellipse(x - r * 1.3, y + r * 0.2, r, r * 0.7, 0, 0, Math.PI * 2);
  c.fill();
}

function drawTree(c: CanvasRenderingContext2D, s: number, kind: number, color: string): void {
  const h = 30 * s;
  c.fillStyle = "#6b4423";
  c.fillRect(-2 * s, -h * 0.4, 4 * s, h * 0.4);
  c.fillStyle = color;
  if (kind === 0) {
    c.beginPath();
    c.arc(0, -h * 0.6, h * 0.4, 0, Math.PI * 2);
    c.fill();
  } else if (kind === 1) {
    c.beginPath();
    c.moveTo(0, -h);
    c.lineTo(h * 0.35, -h * 0.35);
    c.lineTo(-h * 0.35, -h * 0.35);
    c.closePath();
    c.fill();
  } else {
    c.beginPath();
    c.ellipse(0, -h * 0.6, h * 0.45, h * 0.5, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function drawCactus(c: CanvasRenderingContext2D, s: number, kind: number, color: string): void {
  const h = 28 * s;
  c.fillStyle = color;
  if (kind === 2) {
    // a mesa rock
    c.fillStyle = "#b5763e";
    c.beginPath();
    c.moveTo(-20 * s, 0);
    c.lineTo(-16 * s, -24 * s);
    c.lineTo(16 * s, -24 * s);
    c.lineTo(20 * s, 0);
    c.closePath();
    c.fill();
    return;
  }
  roundRect(c, -3 * s, -h, 6 * s, h, 3 * s);
  c.fill();
  if (kind === 0) {
    roundRect(c, -3 * s, -h * 0.7, -10 * s, 5 * s, 2 * s);
    c.fill();
    roundRect(c, -13 * s, -h * 0.9, 5 * s, h * 0.4, 2 * s);
    c.fill();
  } else {
    roundRect(c, 3 * s, -h * 0.6, 10 * s, 5 * s, 2 * s);
    c.fill();
    roundRect(c, 8 * s, -h * 0.85, 5 * s, h * 0.35, 2 * s);
    c.fill();
  }
}

function drawCrater(c: CanvasRenderingContext2D, s: number, kind: number, line: string): void {
  c.strokeStyle = line;
  c.globalAlpha = 0.5;
  c.lineWidth = 2;
  const r = (10 + kind * 6) * s;
  c.beginPath();
  c.ellipse(0, -2 * s, r, r * 0.4, 0, Math.PI, 0);
  c.stroke();
  c.globalAlpha = 1;
}

function drawPine(c: CanvasRenderingContext2D, s: number, kind: number, color: string): void {
  const h = 34 * s;
  c.fillStyle = "#5a3b1e";
  c.fillRect(-2 * s, -h * 0.2, 4 * s, h * 0.2);
  c.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const yy = -h * 0.2 - i * h * 0.26;
    const ww = (16 - i * 4) * s;
    c.beginPath();
    c.moveTo(0, yy - h * 0.28);
    c.lineTo(ww, yy);
    c.lineTo(-ww, yy);
    c.closePath();
    c.fill();
  }
  // snow cap
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(0, -h * 0.95, 3 * s, 0, Math.PI * 2);
  c.fill();
  void kind;
}

function drawWheel(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  spin: number,
  def: VehicleDef,
): void {
  // tyre
  c.fillStyle = "#1a1a1a";
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  // tread ticks
  c.strokeStyle = "#000";
  c.lineWidth = Math.max(1, r * 0.12);
  for (let i = 0; i < 10; i++) {
    const a = spin + (i * Math.PI) / 5;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86);
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    c.stroke();
  }
  // hub
  c.fillStyle = def.accent;
  c.beginPath();
  c.arc(x, y, r * 0.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#cfd6e0";
  c.beginPath();
  c.arc(x, y, r * 0.5, 0, Math.PI * 2);
  c.lineWidth = Math.max(1, r * 0.08);
  c.strokeStyle = "#cfd6e0";
  c.stroke();
  // spokes
  c.strokeStyle = "#aab3c0";
  c.lineWidth = Math.max(1, r * 0.12);
  for (let i = 0; i < 5; i++) {
    const a = spin + (i * Math.PI * 2) / 5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42);
    c.stroke();
  }
  c.fillStyle = "#5a6472";
  c.beginPath();
  c.arc(x, y, r * 0.16, 0, Math.PI * 2);
  c.fill();
}

function drawChassis(
  c: CanvasRenderingContext2D,
  bw: number,
  bh: number,
  ch: number,
  def: VehicleDef,
): void {
  switch (def.style) {
    case "bike":
      drawBike(c, bw, bh, def);
      return;
    case "truck":
      drawTruck(c, bw, bh, ch, def);
      return;
    case "sports":
      drawSports(c, bw, bh, ch, def);
      return;
    case "rover":
      drawRover(c, bw, bh, ch, def);
      return;
    default:
      drawJeep(c, bw, bh, ch, def);
  }
}

function bodyShadow(c: CanvasRenderingContext2D, bw: number, bh: number): void {
  c.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(c, -bw / 2, bh * 0.3, bw, bh * 0.5, bh * 0.3);
  c.fill();
}

function driver(c: CanvasRenderingContext2D, x: number, y: number, r: number, helmet: string): void {
  c.fillStyle = helmet;
  c.beginPath();
  c.arc(x, y, r, Math.PI * 1.05, Math.PI * 2.1);
  c.fill();
  c.fillStyle = "#f1c27d";
  c.beginPath();
  c.arc(x, y, r * 0.78, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = helmet;
  c.beginPath();
  c.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95);
  c.fill();
}

function drawJeep(c: CanvasRenderingContext2D, bw: number, bh: number, ch: number, def: VehicleDef): void {
  bodyShadow(c, bw, bh);
  c.fillStyle = def.color;
  roundRect(c, -bw / 2, -bh / 2, bw, bh, bh * 0.35);
  c.fill();
  // cabin
  c.fillStyle = def.accent;
  roundRect(c, -bw * 0.08, -bh / 2 - ch, bw * 0.5, ch, bh * 0.22);
  c.fill();
  // window
  c.fillStyle = "#9fe0ff";
  roundRect(c, -bw * 0.02, -bh / 2 - ch * 0.8, bw * 0.34, ch * 0.6, bh * 0.18);
  c.fill();
  driver(c, bw * 0.16, -bh / 2 - ch * 0.5, bh * 0.32, "#2b6cff");
  // headlight + bumper
  c.fillStyle = "#fff6b0";
  c.beginPath();
  c.arc(bw / 2 - 3, -bh * 0.1, bh * 0.12, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#222";
  roundRect(c, bw / 2 - 4, -bh * 0.05, 6, bh * 0.5, 2);
  c.fill();
}

function drawSports(c: CanvasRenderingContext2D, bw: number, bh: number, ch: number, def: VehicleDef): void {
  bodyShadow(c, bw, bh);
  c.fillStyle = def.color;
  c.beginPath();
  c.moveTo(-bw / 2, bh * 0.4);
  c.lineTo(-bw / 2, -bh * 0.2);
  c.lineTo(-bw * 0.1, -bh * 0.5 - ch);
  c.lineTo(bw * 0.2, -bh * 0.5 - ch);
  c.lineTo(bw * 0.45, -bh * 0.3);
  c.lineTo(bw / 2, bh * 0.2);
  c.lineTo(bw / 2, bh * 0.4);
  c.closePath();
  c.fill();
  // windshield
  c.fillStyle = "#16324a";
  c.beginPath();
  c.moveTo(-bw * 0.05, -bh * 0.5 - ch * 0.9);
  c.lineTo(bw * 0.18, -bh * 0.5 - ch * 0.9);
  c.lineTo(bw * 0.32, -bh * 0.25);
  c.lineTo(-bw * 0.05, -bh * 0.25);
  c.closePath();
  c.fill();
  driver(c, bw * 0.05, -bh * 0.55 - ch * 0.3, bh * 0.34, "#ff3b3b");
  // spoiler
  c.fillStyle = def.accent;
  roundRect(c, -bw / 2 - 2, -bh * 0.4, bw * 0.12, bh * 0.12, 2);
  c.fill();
}

function drawTruck(c: CanvasRenderingContext2D, bw: number, bh: number, ch: number, def: VehicleDef): void {
  bodyShadow(c, bw, bh * 1.2);
  // chunky lifted body
  c.fillStyle = def.color;
  roundRect(c, -bw / 2, -bh / 2, bw, bh, bh * 0.25);
  c.fill();
  // roll cage cabin
  c.fillStyle = def.accent;
  roundRect(c, -bw * 0.05, -bh / 2 - ch, bw * 0.55, ch, bh * 0.2);
  c.fill();
  c.fillStyle = "#bfe6ff";
  roundRect(c, 0, -bh / 2 - ch * 0.78, bw * 0.4, ch * 0.55, bh * 0.15);
  c.fill();
  driver(c, bw * 0.2, -bh / 2 - ch * 0.5, bh * 0.3, "#ffd23f");
  // light bar
  c.fillStyle = "#fff6b0";
  roundRect(c, -bw * 0.05, -bh / 2 - ch - 4, bw * 0.55, 4, 2);
  c.fill();
  // exhaust stacks
  c.fillStyle = "#888";
  c.fillRect(-bw * 0.1, -bh / 2 - ch * 0.4, 4, ch * 0.4);
}

function drawBike(c: CanvasRenderingContext2D, bw: number, bh: number, def: VehicleDef): void {
  c.strokeStyle = def.color;
  c.lineWidth = Math.max(3, bh * 0.5);
  c.lineCap = "round";
  // frame from rear axle to front axle
  c.beginPath();
  c.moveTo(-bw / 2, bh * 0.4);
  c.lineTo(0, -bh * 0.2);
  c.lineTo(bw / 2, bh * 0.4);
  c.moveTo(0, -bh * 0.2);
  c.lineTo(bw * 0.2, -bh * 1.2);
  c.stroke();
  // seat
  c.fillStyle = def.accent;
  roundRect(c, -bw * 0.35, -bh * 0.6, bw * 0.4, bh * 0.4, bh * 0.2);
  c.fill();
  // rider
  driver(c, -bw * 0.05, -bh * 1.0, bh * 0.5, "#ff4d6d");
  c.lineCap = "butt";
}

function drawRover(c: CanvasRenderingContext2D, bw: number, bh: number, ch: number, def: VehicleDef): void {
  bodyShadow(c, bw, bh);
  c.fillStyle = def.color;
  roundRect(c, -bw / 2, -bh / 2, bw, bh, bh * 0.4);
  c.fill();
  // dome cockpit
  c.fillStyle = "#2b3242";
  c.beginPath();
  c.ellipse(bw * 0.18, -bh / 2, ch * 0.9, ch * 0.9, 0, Math.PI, 0);
  c.fill();
  c.fillStyle = "rgba(150,200,255,0.6)";
  c.beginPath();
  c.ellipse(bw * 0.18, -bh / 2, ch * 0.7, ch * 0.7, 0, Math.PI, 0);
  c.fill();
  driver(c, bw * 0.18, -bh / 2 - ch * 0.1, bh * 0.3, "#cfd6e0");
  // solar panel
  c.fillStyle = "#1a2a4a";
  roundRect(c, -bw * 0.5, -bh / 2 - ch * 0.4, bw * 0.4, ch * 0.3, 2);
  c.fill();
  c.strokeStyle = "#3a5a9a";
  c.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const xx = -bw * 0.5 + (bw * 0.4 * i) / 4;
    c.beginPath();
    c.moveTo(xx, -bh / 2 - ch * 0.4);
    c.lineTo(xx, -bh / 2 - ch * 0.1);
    c.stroke();
  }
}
