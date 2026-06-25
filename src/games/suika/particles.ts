/**
 * Pooled particle system for merge bursts, sparkles and ring shockwaves.
 * Particles live in world units; drawing maps them through the Layout.
 */
import { CONFIG, type Layout, type Particle } from "./types";

export class ParticleSystem {
  private pool: Particle[] = [];

  constructor() {
    for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        r: 0,
        color: "#fff",
        grav: 1,
        active: false,
        ring: false,
      });
    }
  }

  reset(): void {
    for (const p of this.pool) p.active = false;
  }

  private spawn(): Particle | null {
    for (const p of this.pool) {
      if (!p.active) return p;
    }
    return null;
  }

  /** A burst of bits flying outward from (x,y). */
  burst(x: number, y: number, color: string, count: number, speed: number, size: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - speed * 0.3;
      p.maxLife = 0.4 + Math.random() * 0.4;
      p.life = p.maxLife;
      p.r = size * (0.5 + Math.random() * 0.8);
      p.color = color;
      p.grav = 1;
      p.active = true;
      p.ring = false;
    }
  }

  /** An expanding ring shockwave centered at (x,y). */
  ring(x: number, y: number, color: string, startR: number): void {
    const p = this.spawn();
    if (!p) return;
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.maxLife = 0.4;
    p.life = p.maxLife;
    p.r = startR;
    p.color = color;
    p.grav = 0;
    p.active = true;
    p.ring = true;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (p.ring) {
        // grow outward
        p.r += dt * 1.6;
      } else {
        p.vy += CONFIG.GRAVITY * p.grav * dt * 1.2;
        p.vx *= 0.98;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  draw(c: CanvasRenderingContext2D, layout: Layout): void {
    const { scale, originX, originY } = layout;
    c.save();
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      const px = originX + p.x * scale;
      const py = originY + p.y * scale;
      if (p.ring) {
        c.globalAlpha = t * 0.6;
        c.strokeStyle = p.color;
        c.lineWidth = Math.max(1, 4 * t);
        c.beginPath();
        c.arc(px, py, p.r * scale, 0, Math.PI * 2);
        c.stroke();
      } else {
        c.globalAlpha = Math.min(1, t * 1.4);
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(px, py, Math.max(0.5, p.r * scale * (0.4 + t * 0.6)), 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }
}
