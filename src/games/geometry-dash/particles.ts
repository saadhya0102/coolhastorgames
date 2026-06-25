/** Neon Dash — pooled particles + cube trail. All sizes in pixels. */
import type { Particle, TrailDot } from "./types";

const MAX_PARTICLES = 320;
const MAX_TRAIL = 18;

export class Particles {
  list: Particle[] = [];
  trail: TrailDot[] = [];

  clear(): void {
    this.list.length = 0;
    this.trail.length = 0;
  }

  private push(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  pushTrail(x: number, y: number, rot: number): void {
    this.trail.push({ x, y, rot, life: 0 });
    if (this.trail.length > MAX_TRAIL) this.trail.shift();
  }

  burst(
    x: number,
    y: number,
    n: number,
    color: string,
    spread: number,
    opts?: { upBias?: number; grav?: number; size?: number },
  ): void {
    const upBias = opts?.upBias ?? 0;
    const grav = opts?.grav ?? 900;
    const baseSize = opts?.size ?? 4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread + spread * 0.2;
      this.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - upBias,
        life: 0,
        max: 0.35 + Math.random() * 0.5,
        size: baseSize * (0.6 + Math.random() * 0.9),
        color,
        kind: 0,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
        grav,
      });
    }
  }

  ring(x: number, y: number, color: string, size: number): void {
    this.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0,
      max: 0.35,
      size,
      color,
      kind: 1,
      rot: 0,
      vr: 0,
      grav: 0,
    });
  }

  shatter(x: number, y: number, color: string, size: number): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 140 + Math.random() * 420;
      this.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        life: 0,
        max: 0.5 + Math.random() * 0.6,
        size: size * (0.18 + Math.random() * 0.34),
        color,
        kind: 0,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 22,
        grav: 1100,
      });
    }
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life += dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.list = this.list.filter((p) => p.life < p.max);
    for (const t of this.trail) t.life += dt;
    this.trail = this.trail.filter((t) => t.life < 0.4);
  }

  render(c: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const t = 1 - p.life / p.max;
      if (p.kind === 1) {
        const r = p.size * (0.4 + (1 - t) * 1.6);
        c.globalAlpha = t * 0.8;
        c.strokeStyle = p.color;
        c.lineWidth = Math.max(1.5, p.size * 0.12 * t + 1);
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.stroke();
      } else {
        c.globalAlpha = t;
        c.fillStyle = p.color;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        const s = p.size;
        c.fillRect(-s / 2, -s / 2, s, s);
        c.restore();
      }
    }
    c.globalAlpha = 1;
  }
}
