/**
 * Putt Park — all rendering. Everything is procedural canvas drawing (PRD §10).
 *
 * The board (felt, hazards, walls, ball, aim) is drawn inside a scaled world
 * transform so authoring units map straight to pixels. The HUD and overlay
 * screens are drawn afterwards in screen space.
 */

import { clamp, drawText, mulberry32, roundRect } from "@/engine";
import type { Hole, HoleScore, Phase, Wall } from "./types";
import { CONST } from "./types";
import { moverCenter } from "./physics";
import type { Ball } from "./physics";
import { shapeCenter } from "./geometry";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** "drop" obeys gravity-ish fall, "puff" floats, "ring" expands */
  kind: "drop" | "puff" | "ring" | "spark";
}

export interface Transform {
  scale: number;
  offX: number;
  offY: number;
}

export interface Scene {
  phase: Phase;
  hole: Hole;
  holeIndex: number;
  walls: Wall[];
  ball: Ball;
  ballScale: number;
  ballVisible: boolean;
  time: number;

  aiming: boolean;
  aimDirX: number;
  aimDirY: number;
  power: number;
  preview: { x: number; y: number }[];

  strokes: number;
  totalStrokes: number;
  totalPar: number;
  /** strokes-minus-par through completed holes only */
  relScore: number;
  /** number of holes completed so far */
  holesDone: number;
  scores: (HoleScore | null)[];
  bestTotal: number | null;
  bestRelative: number | null;

  introT: number;
  resultLabel: string;
  resultStrokes: number;
  resultRelative: number;
  particles: Particle[];

  message: string;
  isTouch: boolean;
}

const COLORS = {
  bgTop: "#1f6b4a",
  bgBottom: "#15422f",
  feltA: "#3bb265",
  feltB: "#33a35c",
  feltDark: "#2c8f4f",
  feltEdge: "#1c6b39",
  rail: "#7a4f2c",
  railLight: "#9c6a3d",
  railDark: "#52351d",
  innerWall: "#b9763f",
  sand: "#e6d29a",
  sandDark: "#cdb877",
  water: "#3aa0d8",
  waterDark: "#2176a8",
  bumper: "#ff5d73",
  bumperLight: "#ff97a6",
  mover: "#5b6470",
  moverLight: "#7d8794",
  flag: "#ff3b54",
  ball: "#ffffff",
  text: "#ffffff",
};

export function computeTransform(W: number, H: number, hole: Hole): Transform {
  const m = Math.min(W, H);
  const hudH = clamp(H * 0.1, 46, 96);
  const margin = clamp(m * 0.03, 8, 28);
  const px = margin;
  const py = hudH;
  const pw = W - margin * 2;
  const ph = H - hudH - margin;
  const scale = Math.min(pw / hole.bounds.w, ph / hole.bounds.h);
  const offX = px + (pw - hole.bounds.w * scale) / 2;
  const offY = py + (ph - hole.bounds.h * scale) / 2;
  return { scale, offX, offY };
}

export class Renderer {
  private c: CanvasRenderingContext2D;
  private speckleCache = new Map<number, { x: number; y: number; r: number }[]>();

  constructor(ctx: CanvasRenderingContext2D) {
    this.c = ctx;
  }

  frame(W: number, H: number, s: Scene): void {
    const c = this.c;
    this.background(W, H);

    const t = computeTransform(W, H, s.hole);
    c.save();
    c.translate(t.offX, t.offY);
    c.scale(t.scale, t.scale);

    this.boardShadow(s.hole);
    this.felt(s.hole);
    this.slopes(s.hole);
    this.sand(s.hole);
    this.water(s.hole, s.time);
    this.cup(s.hole, s.time);
    this.walls(s.walls);
    this.bumpers(s.hole, s.time);
    this.movers(s.hole, s.time);
    this.particles(s.particles, "under");
    if (s.ballVisible) this.ball(s.ball, s.ballScale);
    this.particles(s.particles, "over");
    if (s.phase === "aim" && s.aiming) this.aim(s);

    c.restore();

    this.hud(W, H, s);
    this.overlays(W, H, s);
  }

  // ---- background ----------------------------------------------------------
  private background(W: number, H: number): void {
    const c = this.c;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLORS.bgTop);
    g.addColorStop(1, COLORS.bgBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // subtle vignette
    const r = Math.hypot(W, H) * 0.7;
    const rg = c.createRadialGradient(W / 2, H / 2, r * 0.3, W / 2, H / 2, r);
    rg.addColorStop(0, "rgba(0,0,0,0)");
    rg.addColorStop(1, "rgba(0,0,0,0.35)");
    c.fillStyle = rg;
    c.fillRect(0, 0, W, H);
  }

  // ---- board ---------------------------------------------------------------
  private pathPoly(poly: { x: number; y: number }[]): void {
    const c = this.c;
    c.beginPath();
    c.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) c.lineTo(poly[i].x, poly[i].y);
    c.closePath();
  }

  private boardShadow(hole: Hole): void {
    const c = this.c;
    c.save();
    c.translate(10, 16);
    this.pathPoly(hole.green);
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fill();
    c.restore();
  }

  private speckles(hole: Hole): { x: number; y: number; r: number }[] {
    let cached = this.speckleCache.get(hole.id);
    if (cached) return cached;
    const rnd = mulberry32(0x9e37 ^ (hole.id * 2654435761));
    const out: { x: number; y: number; r: number }[] = [];
    const n = 90;
    for (let i = 0; i < n; i++) {
      out.push({
        x: rnd() * hole.bounds.w,
        y: rnd() * hole.bounds.h,
        r: 1 + rnd() * 2.2,
      });
    }
    cached = out;
    this.speckleCache.set(hole.id, cached);
    return cached;
  }

  private felt(hole: Hole): void {
    const c = this.c;
    c.save();
    this.pathPoly(hole.green);
    const g = c.createLinearGradient(0, 0, 0, hole.bounds.h);
    g.addColorStop(0, COLORS.feltA);
    g.addColorStop(1, COLORS.feltDark);
    c.fillStyle = g;
    c.fill();

    c.clip();
    // mow stripes (world-space horizontal bands)
    const band = 74;
    for (let y = 0; y < hole.bounds.h; y += band * 2) {
      c.fillStyle = "rgba(255,255,255,0.05)";
      c.fillRect(-20, y, hole.bounds.w + 40, band);
    }
    // diagonal sheen
    const sheen = c.createLinearGradient(0, 0, hole.bounds.w, hole.bounds.h);
    sheen.addColorStop(0, "rgba(255,255,255,0.10)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(0,0,0,0.10)");
    c.fillStyle = sheen;
    c.fillRect(0, 0, hole.bounds.w, hole.bounds.h);
    // speckle
    c.fillStyle = "rgba(0,0,0,0.06)";
    for (const sp of this.speckles(hole)) {
      c.beginPath();
      c.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      c.fill();
    }
    // inner edge shadow
    this.pathPoly(hole.green);
    c.lineWidth = 26;
    c.strokeStyle = "rgba(0,0,0,0.12)";
    c.stroke();
    c.restore();

    // wooden rail
    this.pathPoly(hole.green);
    c.lineJoin = "round";
    c.lineWidth = 16;
    c.strokeStyle = COLORS.railDark;
    c.stroke();
    c.lineWidth = 10;
    c.strokeStyle = COLORS.rail;
    c.stroke();
    c.lineWidth = 3;
    c.strokeStyle = COLORS.railLight;
    c.stroke();
  }

  // ---- hazards -------------------------------------------------------------
  private fillShape(s: import("./types").Shape): void {
    const c = this.c;
    c.beginPath();
    if (s.type === "rect") {
      c.rect(s.x, s.y, s.w, s.h);
    } else if (s.type === "circle") {
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    } else {
      c.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y);
      c.closePath();
    }
  }

  private sand(hole: Hole): void {
    if (!hole.sand) return;
    const c = this.c;
    for (const s of hole.sand) {
      c.save();
      this.fillShape(s);
      const ctr = shapeCenter(s);
      const g = c.createRadialGradient(ctr.x, ctr.y, 4, ctr.x, ctr.y, 200);
      g.addColorStop(0, COLORS.sand);
      g.addColorStop(1, COLORS.sandDark);
      c.fillStyle = g;
      c.fill();
      c.clip();
      // stipple
      const rnd = mulberry32(hole.id * 131 + Math.round(ctr.x));
      c.fillStyle = "rgba(150,120,60,0.35)";
      for (let i = 0; i < 80; i++) {
        const px = ctr.x + (rnd() - 0.5) * 420;
        const py = ctr.y + (rnd() - 0.5) * 420;
        c.beginPath();
        c.arc(px, py, 1.4, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      this.fillShape(s);
      c.lineWidth = 3;
      c.strokeStyle = "rgba(180,150,90,0.7)";
      c.stroke();
    }
  }

  private water(hole: Hole, time: number): void {
    if (!hole.water) return;
    const c = this.c;
    for (const s of hole.water) {
      c.save();
      this.fillShape(s);
      const g = c.createLinearGradient(0, 0, 0, hole.bounds.h);
      g.addColorStop(0, COLORS.water);
      g.addColorStop(1, COLORS.waterDark);
      c.fillStyle = g;
      c.fill();
      c.clip();
      // animated waves
      c.strokeStyle = "rgba(255,255,255,0.25)";
      c.lineWidth = 2;
      const b =
        s.type === "rect"
          ? { x: s.x, y: s.y, w: s.w, h: s.h }
          : s.type === "circle"
            ? { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 }
            : { x: 0, y: 0, w: hole.bounds.w, h: hole.bounds.h };
      for (let yy = b.y + 12; yy < b.y + b.h; yy += 22) {
        c.beginPath();
        for (let xx = b.x; xx <= b.x + b.w; xx += 10) {
          const yo = Math.sin(xx * 0.05 + time * 2 + yy) * 3;
          if (xx === b.x) c.moveTo(xx, yy + yo);
          else c.lineTo(xx, yy + yo);
        }
        c.stroke();
      }
      c.restore();
      this.fillShape(s);
      c.lineWidth = 4;
      c.strokeStyle = "rgba(120,200,235,0.8)";
      c.stroke();
    }
  }

  private slopes(hole: Hole): void {
    if (!hole.slopes) return;
    const c = this.c;
    for (const sl of hole.slopes) {
      c.save();
      this.fillShape(sl.shape);
      c.fillStyle = "rgba(255,255,255,0.06)";
      c.fill();
      c.clip();
      const ctr = shapeCenter(sl.shape);
      const ang = Math.atan2(sl.dir.y, sl.dir.x);
      c.strokeStyle = "rgba(255,255,255,0.30)";
      c.lineWidth = 5;
      for (let row = -3; row <= 3; row++) {
        for (let col = -3; col <= 3; col++) {
          const cx = ctr.x + col * 70;
          const cy = ctr.y + row * 70;
          c.save();
          c.translate(cx, cy);
          c.rotate(ang);
          c.beginPath();
          c.moveTo(-12, -10);
          c.lineTo(8, 0);
          c.lineTo(-12, 10);
          c.stroke();
          c.restore();
        }
      }
      c.restore();
    }
  }

  private cup(hole: Hole, time: number): void {
    const c = this.c;
    const r = hole.cupRadius ?? CONST.CUP_RADIUS;
    const { x, y } = hole.cup;
    // hole recess
    c.beginPath();
    c.arc(x, y, r + 3, 0, Math.PI * 2);
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.fill();
    const g = c.createRadialGradient(x, y - 2, 2, x, y, r);
    g.addColorStop(0, "#04140a");
    g.addColorStop(1, "#0c2a17");
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.stroke();

    // flag pole + waving flag
    const poleH = 120;
    const poleX = x;
    const poleTop = y - poleH;
    c.strokeStyle = "#e8e8ea";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(poleX, y);
    c.lineTo(poleX, poleTop);
    c.stroke();
    // flag
    c.fillStyle = COLORS.flag;
    c.beginPath();
    c.moveTo(poleX, poleTop);
    const wave = Math.sin(time * 4) * 6;
    c.quadraticCurveTo(poleX + 30, poleTop + 8 + wave, poleX + 56, poleTop + 16);
    c.quadraticCurveTo(poleX + 30, poleTop + 22 - wave, poleX, poleTop + 34);
    c.closePath();
    c.fill();
    c.fillStyle = "rgba(0,0,0,0.12)";
    c.fillRect(poleX - 2, poleTop, 4, 34);
  }

  // ---- walls / obstacles ---------------------------------------------------
  private walls(walls: Wall[]): void {
    const c = this.c;
    for (const w of walls) {
      if (w.kind === "rail") continue; // boundary drawn by felt()
      c.lineCap = "round";
      c.lineWidth = 22;
      c.strokeStyle = COLORS.railDark;
      c.beginPath();
      c.moveTo(w.a.x, w.a.y);
      c.lineTo(w.b.x, w.b.y);
      c.stroke();
      c.lineWidth = 15;
      c.strokeStyle = COLORS.innerWall;
      c.stroke();
      c.lineWidth = 4;
      c.strokeStyle = "rgba(255,255,255,0.25)";
      c.stroke();
    }
  }

  private bumpers(hole: Hole, time: number): void {
    if (!hole.bumpers) return;
    const c = this.c;
    for (const b of hole.bumpers) {
      c.beginPath();
      c.arc(b.x, b.y + 4, b.r, 0, Math.PI * 2);
      c.fillStyle = "rgba(0,0,0,0.25)";
      c.fill();
      const g = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      g.addColorStop(0, COLORS.bumperLight);
      g.addColorStop(1, COLORS.bumper);
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + b.x);
      c.lineWidth = 3;
      c.strokeStyle = `rgba(255,255,255,${0.3 + pulse * 0.4})`;
      c.stroke();
      c.beginPath();
      c.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
      c.fillStyle = "rgba(255,255,255,0.6)";
      c.fill();
    }
  }

  private movers(hole: Hole, time: number): void {
    if (!hole.movers) return;
    const c = this.c;
    for (const m of hole.movers) {
      const ctr = moverCenter(m, time);
      const x = ctr.x - m.w / 2;
      const y = ctr.y - m.h / 2;
      c.save();
      // shadow
      roundRect(c, x + 4, y + 6, m.w, m.h, 8);
      c.fillStyle = "rgba(0,0,0,0.3)";
      c.fill();
      // body
      const g = c.createLinearGradient(x, y, x, y + m.h);
      g.addColorStop(0, COLORS.moverLight);
      g.addColorStop(1, COLORS.mover);
      roundRect(c, x, y, m.w, m.h, 8);
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = "rgba(0,0,0,0.3)";
      c.stroke();
      // hazard stripes
      c.save();
      roundRect(c, x, y, m.w, m.h, 8);
      c.clip();
      c.strokeStyle = "rgba(255,210,60,0.8)";
      c.lineWidth = 7;
      for (let sx = -m.h; sx < m.w + m.h; sx += 22) {
        c.beginPath();
        c.moveTo(x + sx, y);
        c.lineTo(x + sx + m.h, y + m.h);
        c.stroke();
      }
      c.restore();
      c.restore();
    }
  }

  // ---- ball ----------------------------------------------------------------
  private ball(ball: Ball, scaleMul: number): void {
    const c = this.c;
    const r = CONST.BALL_R * scaleMul;
    if (r < 0.5) return;
    // shadow
    c.beginPath();
    c.ellipse(ball.x + 4, ball.y + 6, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
    c.fillStyle = "rgba(0,0,0,0.28)";
    c.fill();
    // body
    const g = c.createRadialGradient(ball.x - r * 0.35, ball.y - r * 0.4, r * 0.2, ball.x, ball.y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.7, "#eef1f4");
    g.addColorStop(1, "#c9d0d8");
    c.beginPath();
    c.arc(ball.x, ball.y, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    // rolling dimple marker
    const dx = Math.cos(ball.spin) * r * 0.45;
    const dy = Math.sin(ball.spin * 0.9) * r * 0.45;
    c.beginPath();
    c.arc(ball.x + dx, ball.y + dy, r * 0.18, 0, Math.PI * 2);
    c.fillStyle = "rgba(180,190,200,0.7)";
    c.fill();
    // highlight
    c.beginPath();
    c.arc(ball.x - r * 0.3, ball.y - r * 0.35, r * 0.22, 0, Math.PI * 2);
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.fill();
  }

  // ---- aim -----------------------------------------------------------------
  private aim(s: Scene): void {
    const c = this.c;
    const b = s.ball;
    const power = s.power;
    if (power <= 0.001) return;
    const dx = s.aimDirX;
    const dy = s.aimDirY;

    // predicted bounce path
    if (s.preview.length > 1) {
      c.save();
      c.setLineDash([10, 12]);
      c.lineWidth = 3;
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.beginPath();
      c.moveTo(s.preview[0].x, s.preview[0].y);
      for (let i = 1; i < s.preview.length; i++) c.lineTo(s.preview[i].x, s.preview[i].y);
      c.stroke();
      c.restore();
    }

    // aim arrow
    const len = 60 + power * 230;
    const ex = b.x + dx * len;
    const ey = b.y + dy * len;
    const col = power < 0.45 ? "#7CFF7C" : power < 0.78 ? "#ffd23f" : "#ff5d5d";
    c.lineCap = "round";
    c.lineWidth = 7;
    c.strokeStyle = col;
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(ex, ey);
    c.stroke();
    // arrowhead
    const ah = 16;
    const ang = Math.atan2(dy, dx);
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - Math.cos(ang - 0.4) * ah, ey - Math.sin(ang - 0.4) * ah);
    c.lineTo(ex - Math.cos(ang + 0.4) * ah, ey - Math.sin(ang + 0.4) * ah);
    c.closePath();
    c.fill();

    // power ring around ball
    c.lineWidth = 4;
    c.strokeStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.arc(b.x, b.y, CONST.BALL_R + 9, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = col;
    c.beginPath();
    c.arc(b.x, b.y, CONST.BALL_R + 9, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    c.stroke();
  }

  // ---- particles -----------------------------------------------------------
  private particles(ps: Particle[], layer: "under" | "over"): void {
    const c = this.c;
    for (const p of ps) {
      const isUnder = p.kind === "ring";
      if ((layer === "under") !== isUnder) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === "ring") {
        const grow = (1 - a) * p.size * 3 + p.size;
        c.lineWidth = 3;
        c.strokeStyle = p.color.replace("ALPHA", String(a * 0.7));
        c.beginPath();
        c.arc(p.x, p.y, grow, 0, Math.PI * 2);
        c.stroke();
      } else {
        c.globalAlpha = a;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }
    }
  }

  // ---- HUD -----------------------------------------------------------------
  private hud(W: number, H: number, s: Scene): void {
    const c = this.c;
    const m = Math.min(W, H);
    const hudH = clamp(H * 0.1, 46, 96);
    // band
    c.fillStyle = "rgba(0,0,0,0.28)";
    c.fillRect(0, 0, W, hudH);
    c.fillStyle = "rgba(255,255,255,0.08)";
    c.fillRect(0, hudH - 2, W, 2);

    const fs = clamp(m * 0.04, 14, 30);
    const cy = hudH * 0.36;
    const cy2 = hudH * 0.74;
    // left: hole
    drawText(c, `HOLE ${s.hole.id} / ${s.scores.length}`, W * 0.04, cy, fs, COLORS.text, "left");
    drawText(c, s.hole.name, W * 0.04, cy2, fs * 0.7, "rgba(255,255,255,0.75)", "left");

    // center: strokes / par
    drawText(c, `STROKES ${s.strokes}`, W * 0.5, cy, fs, COLORS.text, "center");
    drawText(c, `PAR ${s.hole.par}`, W * 0.5, cy2, fs * 0.7, "rgba(255,255,255,0.75)", "center");

    // right: total + relative (through completed holes)
    const rel = s.relScore;
    const relText = s.holesDone === 0 ? "" : rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;
    const relCol = rel < 0 ? "#9cff9c" : rel > 0 ? "#ff9c9c" : "#ffffff";
    drawText(c, `TOTAL ${s.totalStrokes}`, W * 0.96, cy, fs, COLORS.text, "right");
    if (relText) drawText(c, relText, W * 0.96, cy2, fs * 0.7, relCol, "right");
  }

  // ---- overlays ------------------------------------------------------------
  private panel(W: number, H: number, x: number, y: number, w: number, h: number): void {
    const c = this.c;
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(0, 0, W, H);
    roundRect(c, x, y, w, h, 18);
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(28,90,60,0.97)");
    g.addColorStop(1, "rgba(18,60,42,0.97)");
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "rgba(255,255,255,0.18)";
    c.stroke();
  }

  private overlays(W: number, H: number, s: Scene): void {
    const c = this.c;
    const m = Math.min(W, H);
    if (s.phase === "title") {
      this.titleScreen(W, H, s, m);
    } else if (s.phase === "intro") {
      this.introBanner(W, H, s, m);
    } else if (s.phase === "holeComplete") {
      this.holeCompleteCard(W, H, s, m);
    } else if (s.phase === "scorecard" || s.phase === "done") {
      this.scorecard(W, H, s, m);
    } else if (s.message) {
      drawText(c, s.message, W / 2, H - clamp(m * 0.06, 26, 60), clamp(m * 0.032, 12, 22), "rgba(255,255,255,0.85)");
    }
  }

  private titleScreen(W: number, H: number, s: Scene, m: number): void {
    const c = this.c;
    const pw = Math.min(W * 0.86, 560);
    const ph = Math.min(H * 0.7, 520);
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    this.panel(W, H, x, y, pw, ph);
    drawText(c, "PUTT PARK", W / 2, y + ph * 0.16, clamp(m * 0.085, 30, 64), "#ffe48a");
    drawText(c, "Mini-Golf", W / 2, y + ph * 0.27, clamp(m * 0.04, 16, 28), "rgba(255,255,255,0.8)");
    const lines = [
      `${s.scores.length} holes  •  Par ${s.totalPar}`,
      "Drag BACK from the ball to aim,",
      "release to putt. Lower score wins.",
    ];
    lines.forEach((ln, i) =>
      drawText(c, ln, W / 2, y + ph * 0.42 + i * clamp(m * 0.045, 20, 34), clamp(m * 0.033, 13, 22), "rgba(255,255,255,0.9)"),
    );
    if (s.bestTotal != null) {
      const rel = s.bestRelative;
      const relTxt = rel == null ? "" : rel === 0 ? " (E)" : rel > 0 ? ` (+${rel})` : ` (${rel})`;
      drawText(c, `Best round: ${s.bestTotal}${relTxt}`, W / 2, y + ph * 0.66, clamp(m * 0.036, 14, 24), "#9cff9c");
    }
    const pulse = 0.6 + 0.4 * Math.sin(s.time * 3);
    drawText(c, s.isTouch ? "Tap to start" : "Click or press Space", W / 2, y + ph * 0.85, clamp(m * 0.04, 16, 26), `rgba(255,255,255,${pulse})`);
  }

  private introBanner(W: number, H: number, s: Scene, m: number): void {
    const c = this.c;
    const a = clamp(s.introT, 0, 1);
    const slide = (1 - a) * 60;
    const bw = Math.min(W * 0.8, 520);
    const bh = clamp(H * 0.18, 90, 160);
    const x = (W - bw) / 2;
    const y = H * 0.3 - slide;
    c.globalAlpha = a;
    roundRect(c, x, y, bw, bh, 16);
    const g = c.createLinearGradient(x, y, x, y + bh);
    g.addColorStop(0, "rgba(20,80,52,0.95)");
    g.addColorStop(1, "rgba(14,55,38,0.95)");
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "rgba(255,255,255,0.2)";
    c.stroke();
    drawText(c, `HOLE ${s.hole.id} — PAR ${s.hole.par}`, W / 2, y + bh * 0.3, clamp(m * 0.05, 18, 32), "#ffe48a");
    drawText(c, s.hole.name, W / 2, y + bh * 0.56, clamp(m * 0.045, 16, 28), "#ffffff");
    if (s.hole.hint) {
      drawText(c, s.hole.hint, W / 2, y + bh * 0.82, clamp(m * 0.03, 11, 18), "rgba(255,255,255,0.8)");
    }
    c.globalAlpha = 1;
  }

  private holeCompleteCard(W: number, H: number, s: Scene, m: number): void {
    const c = this.c;
    const pw = Math.min(W * 0.8, 460);
    const ph = Math.min(H * 0.5, 360);
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    this.panel(W, H, x, y, pw, ph);
    const relCol = s.resultRelative < 0 ? "#9cff9c" : s.resultRelative > 0 ? "#ffc56b" : "#ffffff";
    drawText(c, s.resultLabel, W / 2, y + ph * 0.24, clamp(m * 0.075, 26, 50), relCol);
    drawText(c, `Hole ${s.hole.id}: ${s.resultStrokes} strokes  (Par ${s.hole.par})`, W / 2, y + ph * 0.46, clamp(m * 0.04, 15, 24), "#ffffff");
    const rel = s.relScore;
    const relText = rel === 0 ? "Even par" : rel > 0 ? `+${rel} overall` : `${rel} overall`;
    drawText(c, `Total ${s.totalStrokes}  •  ${relText}`, W / 2, y + ph * 0.62, clamp(m * 0.036, 13, 22), "rgba(255,255,255,0.85)");
    const pulse = 0.6 + 0.4 * Math.sin(s.time * 3);
    const last = s.hole.id >= s.scores.length;
    drawText(c, last ? "Tap for scorecard" : (s.isTouch ? "Tap for next hole" : "Tap or Space"), W / 2, y + ph * 0.85, clamp(m * 0.038, 15, 24), `rgba(255,255,255,${pulse})`);
  }

  private scorecard(W: number, H: number, s: Scene, m: number): void {
    const c = this.c;
    const pw = Math.min(W * 0.92, 620);
    const ph = Math.min(H * 0.9, 720);
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    this.panel(W, H, x, y, pw, ph);
    drawText(c, "SCORECARD", W / 2, y + ph * 0.07, clamp(m * 0.06, 22, 40), "#ffe48a");

    const n = s.scores.length;
    const rows = n;
    const tableTop = y + ph * 0.14;
    const tableBottom = y + ph * 0.8;
    const rowH = (tableBottom - tableTop) / (rows + 1);
    const colHole = x + pw * 0.1;
    const colPar = x + pw * 0.45;
    const colScore = x + pw * 0.68;
    const colRel = x + pw * 0.9;
    const fs = clamp(rowH * 0.5, 10, 20);

    drawText(c, "Hole", colHole, tableTop, fs, "rgba(255,255,255,0.6)", "left");
    drawText(c, "Par", colPar, tableTop, fs, "rgba(255,255,255,0.6)", "center");
    drawText(c, "You", colScore, tableTop, fs, "rgba(255,255,255,0.6)", "center");
    drawText(c, "+/-", colRel, tableTop, fs, "rgba(255,255,255,0.6)", "right");

    let totStrokes = 0;
    let totPar = 0;
    for (let i = 0; i < n; i++) {
      const ry = tableTop + (i + 1) * rowH;
      const sc = s.scores[i];
      const parVal = sc?.par ?? (i === s.holeIndex ? s.hole.par : 0);
      drawText(c, `${i + 1}`, colHole, ry, fs, "rgba(255,255,255,0.9)", "left");
      drawText(c, `${parVal}`, colPar, ry, fs, "rgba(255,255,255,0.8)", "center");
      if (sc) {
        totStrokes += sc.strokes;
        totPar += sc.par;
        const r = sc.strokes - sc.par;
        const col = r < 0 ? "#9cff9c" : r > 0 ? "#ffb0b0" : "#ffffff";
        drawText(c, `${sc.strokes}`, colScore, ry, fs, col, "center");
        drawText(c, r === 0 ? "E" : r > 0 ? `+${r}` : `${r}`, colRel, ry, fs, col, "right");
      } else {
        drawText(c, "-", colScore, ry, fs, "rgba(255,255,255,0.4)", "center");
        drawText(c, "-", colRel, ry, fs, "rgba(255,255,255,0.4)", "right");
      }
    }
    // totals
    const ty = tableBottom + rowH * 0.4;
    c.strokeStyle = "rgba(255,255,255,0.2)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + pw * 0.08, ty - rowH * 0.5);
    c.lineTo(x + pw * 0.92, ty - rowH * 0.5);
    c.stroke();
    const totRel = totStrokes - totPar;
    const totRelCol = totRel < 0 ? "#9cff9c" : totRel > 0 ? "#ffb0b0" : "#ffffff";
    drawText(c, "Total", colHole, ty, fs * 1.1, "#ffffff", "left");
    drawText(c, `${totPar}`, colPar, ty, fs * 1.1, "#ffffff", "center");
    drawText(c, `${totStrokes}`, colScore, ty, fs * 1.1, totRelCol, "center");
    drawText(c, totRel === 0 ? "E" : totRel > 0 ? `+${totRel}` : `${totRel}`, colRel, ty, fs * 1.1, totRelCol, "right");

    if (s.bestTotal != null) {
      drawText(c, `Best round: ${s.bestTotal}`, W / 2, y + ph * 0.88, clamp(m * 0.034, 13, 22), "#9cff9c");
    }
    const pulse = 0.6 + 0.4 * Math.sin(s.time * 3);
    drawText(c, s.phase === "done" ? "Saved!" : "Tap to finish", W / 2, y + ph * 0.95, clamp(m * 0.036, 14, 22), `rgba(255,255,255,${pulse})`);
  }
}
