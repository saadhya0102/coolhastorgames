/** Pooled particle / ripple / floating-text systems for Tap Cascade.
 *
 * Object pools avoid GC churn during dense passages. All rendering is procedural
 * canvas drawing. Coordinates are in CSS px (the same space as the renderer). */

import type { FloatText, Particle, Ripple } from "./types";
import { rgba } from "./theme";

const TAU = Math.PI * 2;

export class ParticleSystem {
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private texts: FloatText[] = [];

  constructor(
    particlePool = 280,
    ripplePool = 40,
    textPool = 24,
  ) {
    for (let i = 0; i < particlePool; i++) {
      this.particles.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
        size: 1, color: "#fff", gravity: 0, active: false,
      });
    }
    for (let i = 0; i < ripplePool; i++) {
      this.ripples.push({
        x: 0, y: 0, radius: 0, maxRadius: 1, life: 0, maxLife: 1,
        color: "#fff", active: false,
      });
    }
    for (let i = 0; i < textPool; i++) {
      this.texts.push({
        x: 0, y: 0, vy: 0, life: 0, maxLife: 1,
        text: "", color: "#fff", size: 16, active: false,
      });
    }
  }

  private freeParticle(): Particle | null {
    for (const p of this.particles) if (!p.active) return p;
    return null;
  }
  private freeRipple(): Ripple | null {
    for (const r of this.ripples) if (!r.active) return r;
    return null;
  }
  private freeText(): FloatText | null {
    for (const t of this.texts) if (!t.active) return t;
    return null;
  }

  /** Burst of sparks at a hit point. */
  burst(x: number, y: number, color: string, count: number, power: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.freeParticle();
      if (!p) break;
      const ang = Math.random() * TAU;
      const spd = power * (0.4 + Math.random() * 0.9);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd - power * 0.3;
      p.maxLife = 0.4 + Math.random() * 0.45;
      p.life = p.maxLife;
      p.size = 2 + Math.random() * 3.5;
      p.color = color;
      p.gravity = power * 2.2;
      p.active = true;
    }
  }

  /** Upward fountain (used for combo milestones / completion confetti). */
  fountain(x: number, y: number, color: string, count: number, power: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.freeParticle();
      if (!p) break;
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const spd = power * (0.6 + Math.random());
      p.x = x + (Math.random() - 0.5) * 30;
      p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.maxLife = 0.7 + Math.random() * 0.7;
      p.life = p.maxLife;
      p.size = 2.5 + Math.random() * 4;
      p.color = color;
      p.gravity = power * 1.5;
      p.active = true;
    }
  }

  /** Expanding ring at a hit point. */
  ripple(x: number, y: number, maxRadius: number, color: string): void {
    const r = this.freeRipple();
    if (!r) return;
    r.x = x;
    r.y = y;
    r.radius = maxRadius * 0.15;
    r.maxRadius = maxRadius;
    r.maxLife = 0.45;
    r.life = r.maxLife;
    r.color = color;
    r.active = true;
  }

  /** Floating text that rises and fades. */
  floatText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.freeText();
    if (!t) return;
    t.x = x;
    t.y = y;
    t.vy = -size * 1.6;
    t.maxLife = 0.7;
    t.life = t.maxLife;
    t.text = text;
    t.color = color;
    t.size = size;
    t.active = true;
  }

  update(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx *= 1 - 1.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const r of this.ripples) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        continue;
      }
      const k = 1 - r.life / r.maxLife;
      r.radius = r.maxRadius * (0.15 + 0.85 * easeOut(k));
    }
    for (const t of this.texts) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= 1 - 1.5 * dt;
    }
  }

  render(c: CanvasRenderingContext2D): void {
    // sparks
    c.save();
    for (const p of this.particles) {
      if (!p.active) continue;
      const a = clamp01(p.life / p.maxLife);
      c.fillStyle = rgba(p.color, a);
      c.beginPath();
      c.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, TAU);
      c.fill();
    }
    // ripples
    c.lineWidth = 2.5;
    for (const r of this.ripples) {
      if (!r.active) continue;
      const a = clamp01(r.life / r.maxLife);
      c.strokeStyle = rgba(r.color, a * 0.7);
      c.beginPath();
      c.arc(r.x, r.y, r.radius, 0, TAU);
      c.stroke();
    }
    c.restore();
  }

  /** Floating texts are drawn after the HUD so they sit on top. */
  renderTexts(c: CanvasRenderingContext2D): void {
    c.save();
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const t of this.texts) {
      if (!t.active) continue;
      const k = t.life / t.maxLife;
      const a = clamp01(k);
      const scale = 1.1 - 0.2 * k;
      c.font = `800 ${t.size * scale}px "Baloo 2", system-ui, sans-serif`;
      c.fillStyle = rgba(t.color, a);
      c.fillText(t.text, t.x, t.y);
    }
    c.restore();
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
    for (const r of this.ripples) r.active = false;
    for (const t of this.texts) t.active = false;
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
