import type { Particle } from "./types";

/** A small pooled particle system (screen-space, CSS px). */
export class Particles {
  private pool: Particle[] = [];
  private max: number;

  constructor(max = 320) {
    this.max = max;
    for (let i = 0; i < max; i++) {
      this.pool.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        max: 1,
        size: 1,
        r: 255,
        g: 255,
        b: 255,
        kind: 0,
        grav: 0,
        drag: 0,
      });
    }
  }

  private take(): Particle | null {
    for (const p of this.pool) if (!p.active) return p;
    return null;
  }

  /** landing dust: puffs that spread sideways along the floor */
  landingDust(x: number, y: number, scale: number, color: [number, number, number]): void {
    const count = 10;
    for (let i = 0; i < count; i++) {
      const p = this.take();
      if (!p) return;
      const ang = (Math.random() - 0.5) * Math.PI;
      const sp = scale * (0.6 + Math.random() * 1.6);
      p.active = true;
      p.x = x + (Math.random() - 0.5) * scale * 0.4;
      p.y = y;
      p.vx = Math.cos(ang) * sp * (Math.random() < 0.5 ? -1 : 1);
      p.vy = -Math.abs(Math.sin(ang)) * sp * 0.6 - scale * 0.4;
      p.max = p.life = 0.3 + Math.random() * 0.25;
      p.size = scale * (0.06 + Math.random() * 0.06);
      const [r, g, b] = color;
      p.r = r;
      p.g = g;
      p.b = b;
      p.kind = 0;
      p.grav = scale * 5;
      p.drag = 2.5;
    }
  }

  /** running contrail sparks behind the runner */
  trail(x: number, y: number, scale: number, color: [number, number, number]): void {
    const p = this.take();
    if (!p) return;
    p.active = true;
    p.x = x + (Math.random() - 0.5) * scale * 0.2;
    p.y = y + (Math.random() - 0.5) * scale * 0.2;
    p.vx = (Math.random() - 0.5) * scale * 0.6;
    p.vy = (Math.random() - 0.5) * scale * 0.6 - scale * 0.2;
    p.max = p.life = 0.25 + Math.random() * 0.3;
    p.size = scale * (0.03 + Math.random() * 0.04);
    const [r, g, b] = color;
    p.r = r;
    p.g = g;
    p.b = b;
    p.kind = 1;
    p.grav = 0;
    p.drag = 1.5;
  }

  /** death/explosion burst of motes */
  burst(x: number, y: number, scale: number, color: [number, number, number], count = 26): void {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      if (!p) return;
      const ang = Math.random() * Math.PI * 2;
      const sp = scale * (1 + Math.random() * 4);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.max = p.life = 0.4 + Math.random() * 0.5;
      p.size = scale * (0.04 + Math.random() * 0.08);
      const [r, g, b] = color;
      p.r = r;
      p.g = g;
      p.b = b;
      p.kind = 2;
      p.grav = 0;
      p.drag = 1.2;
    }
  }

  /** roll whoosh: a short arc of motes following the spin */
  rollPuff(x: number, y: number, scale: number, dir: number, color: [number, number, number]): void {
    for (let i = 0; i < 7; i++) {
      const p = this.take();
      if (!p) return;
      const sp = scale * (1.2 + Math.random() * 2);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = dir * sp * (0.6 + Math.random() * 0.8);
      p.vy = (Math.random() - 0.5) * sp * 0.5;
      p.max = p.life = 0.22 + Math.random() * 0.22;
      p.size = scale * (0.03 + Math.random() * 0.05);
      const [r, g, b] = color;
      p.r = r;
      p.g = g;
      p.b = b;
      p.kind = 1;
      p.grav = 0;
      p.drag = 2;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      const d = 1 - Math.min(1, p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(c: CanvasRenderingContext2D): void {
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const p of this.pool) {
      if (!p.active) continue;
      const k = p.life / p.max;
      const a = k * k;
      if (p.kind === 0) {
        // dust puff (softer)
        c.fillStyle = `rgba(${p.r},${p.g},${p.b},${0.4 * a})`;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1.4 - k * 0.4), 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillStyle = `rgba(${p.r},${p.g},${p.b},${a})`;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
  }
}
