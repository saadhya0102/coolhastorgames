import { clamp } from "@/engine";
import type { Vec } from "./types";

/** All effect coordinates are in GRID units so they survive resize; the render
 * pass converts them to screen space via the supplied transform. */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  spin: number;
  rot: number;
  shape: "dot" | "shard";
}

interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
}

type ToScreen = (x: number, y: number) => Vec;

export class Effects {
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
  }

  burst(x: number, y: number, color: string, count: number, power = 2.4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = power * (0.3 + Math.random() * 0.9);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.35 + Math.random() * 0.4,
        size: 0.06 + Math.random() * 0.08,
        color,
        gravity: 3.5,
        spin: 0,
        rot: 0,
        shape: "dot",
      });
    }
  }

  shards(x: number, y: number, color: string, count: number, power = 3) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = power * (0.4 + Math.random() * 0.9);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.4 + Math.random() * 0.5,
        size: 0.08 + Math.random() * 0.1,
        color,
        gravity: 1.2,
        spin: (Math.random() - 0.5) * 14,
        rot: Math.random() * Math.PI,
        shape: "shard",
      });
    }
  }

  spark(x: number, y: number, color: string) {
    this.burst(x, y, color, 5, 1.8);
  }

  ring(x: number, y: number, maxR: number, color: string, width = 0.1) {
    this.rings.push({ x, y, r: maxR * 0.2, maxR, life: 0, max: 0.45, color, width });
  }

  text(x: number, y: number, text: string, color: string, size = 0.5) {
    this.texts.push({ x, y, vy: -1.4, life: 0, max: 0.8, text, color, size });
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.96;
      p.rot += p.spin * dt;
    }
    if (this.parts.length) this.parts = this.parts.filter((p) => p.life < p.max);

    for (const r of this.rings) {
      r.life += dt;
      r.r = r.maxR * (0.2 + 0.8 * (r.life / r.max));
    }
    if (this.rings.length) this.rings = this.rings.filter((r) => r.life < r.max);

    for (const t of this.texts) {
      t.life += dt;
      t.y += t.vy * dt;
      t.vy *= 0.92;
    }
    if (this.texts.length) this.texts = this.texts.filter((t) => t.life < t.max);
  }

  render(c: CanvasRenderingContext2D, toScreen: ToScreen, cell: number) {
    for (const p of this.parts) {
      const s = toScreen(p.x, p.y);
      const alpha = clamp(1 - p.life / p.max, 0, 1);
      c.globalAlpha = alpha;
      c.fillStyle = p.color;
      const sz = p.size * cell;
      if (p.shape === "shard") {
        c.save();
        c.translate(s.x, s.y);
        c.rotate(p.rot);
        c.fillRect(-sz * 0.4, -sz, sz * 0.8, sz * 2);
        c.restore();
      } else {
        c.beginPath();
        c.arc(s.x, s.y, sz, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    for (const r of this.rings) {
      const s = toScreen(r.x, r.y);
      const alpha = clamp(1 - r.life / r.max, 0, 1);
      c.globalAlpha = alpha * 0.8;
      c.strokeStyle = r.color;
      c.lineWidth = r.width * cell;
      c.beginPath();
      c.arc(s.x, s.y, r.r * cell, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;

    for (const t of this.texts) {
      const s = toScreen(t.x, t.y);
      const alpha = clamp(1 - t.life / t.max, 0, 1);
      const px = t.size * cell;
      c.globalAlpha = alpha;
      c.font = `800 ${px}px "Baloo 2", system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = Math.max(2, px * 0.12);
      c.strokeStyle = "rgba(0,0,0,0.55)";
      c.strokeText(t.text, s.x, s.y);
      c.fillStyle = t.color;
      c.fillText(t.text, s.x, s.y);
    }
    c.globalAlpha = 1;
  }
}
