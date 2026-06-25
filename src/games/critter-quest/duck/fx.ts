import { rgba } from "./theme";

export type ParticleShape = "circle" | "square" | "spark" | "ring";

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
  shape: ParticleShape;
  fade: boolean;
}

export class Particles {
  private items: Particle[] = [];

  get count(): number {
    return this.items.length;
  }

  spawn(p: Partial<Particle> & { x: number; y: number }): void {
    this.items.push({
      vx: 0,
      vy: 0,
      life: 0.6,
      max: 0.6,
      size: 4,
      color: "#fff",
      gravity: 0,
      spin: 0,
      rot: 0,
      shape: "circle",
      fade: true,
      ...p,
    });
  }

  burst(
    x: number,
    y: number,
    n: number,
    colors: string[],
    opts: { speed?: number; size?: number; gravity?: number; life?: number; shape?: ParticleShape } = {},
  ): void {
    const speed = opts.speed ?? 180;
    const size = opts.size ?? 5;
    const gravity = opts.gravity ?? 380;
    const life = opts.life ?? 0.8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.3,
        life: life * (0.7 + Math.random() * 0.6),
        max: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        gravity,
        spin: (Math.random() - 0.5) * 12,
        shape: opts.shape ?? "circle",
      });
    }
  }

  confetti(x: number, y: number, n: number): void {
    const cols = ["#ff6f5e", "#ffd24a", "#36b6ff", "#9b7bff", "#34c47a", "#ff8ac4"];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const s = 220 * (0.5 + Math.random());
      this.spawn({
        x: x + (Math.random() - 0.5) * 40,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1.4 + Math.random() * 0.8,
        max: 2.2,
        size: 5 + Math.random() * 5,
        color: cols[(Math.random() * cols.length) | 0],
        gravity: 320,
        spin: (Math.random() - 0.5) * 16,
        shape: "square",
      });
    }
  }

  splash(x: number, y: number, dir: number, color: string): void {
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4 + dir * 0.3;
      const s = 120 * (0.5 + Math.random());
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s + dir * 40,
        vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.3,
        max: 0.8,
        size: 3 + Math.random() * 3,
        color,
        gravity: 520,
        shape: "circle",
      });
    }
  }

  dust(x: number, y: number, dir: number): void {
    for (let i = 0; i < 4; i++) {
      this.spawn({
        x,
        y,
        vx: -dir * (40 + Math.random() * 60),
        vy: -(20 + Math.random() * 50),
        life: 0.4 + Math.random() * 0.25,
        max: 0.65,
        size: 4 + Math.random() * 4,
        color: rgba("#d9c9a3", 0.8),
        gravity: 120,
        shape: "circle",
      });
    }
  }

  ring(x: number, y: number, color: string): void {
    this.spawn({
      x,
      y,
      life: 0.45,
      max: 0.45,
      size: 6,
      color,
      shape: "ring",
      fade: true,
    });
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  render(c: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const a = p.fade ? Math.max(0, Math.min(1, p.life / p.max)) : 1;
      c.save();
      c.globalAlpha = a;
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.fillStyle = p.color;
      if (p.shape === "square") {
        c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else if (p.shape === "spark") {
        c.fillRect(-p.size / 2, -p.size * 0.15, p.size, p.size * 0.3);
        c.fillRect(-p.size * 0.15, -p.size / 2, p.size * 0.3, p.size);
      } else if (p.shape === "ring") {
        const r = p.size + (1 - p.life / p.max) * 26;
        c.strokeStyle = p.color;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        c.stroke();
      } else {
        c.beginPath();
        c.arc(0, 0, p.size, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
  }

  clear(): void {
    this.items = [];
  }
}

/** Decaying screen shake. */
export class Shake {
  private amt = 0;
  x = 0;
  y = 0;

  add(amount: number): void {
    this.amt = Math.min(this.amt + amount, 28);
  }

  update(dt: number): void {
    this.amt *= Math.pow(0.0008, dt);
    if (this.amt < 0.2) this.amt = 0;
    this.x = (Math.random() - 0.5) * this.amt;
    this.y = (Math.random() - 0.5) * this.amt;
  }
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

export class FloatingText {
  private items: FloatText[] = [];

  add(x: number, y: number, text: string, color: string, size: number, life = 1): void {
    this.items.push({ x, y, text, color, size, life, max: life });
  }

  update(dt: number): void {
    for (const f of this.items) {
      f.life -= dt;
      f.y -= 40 * dt;
    }
    this.items = this.items.filter((f) => f.life > 0);
  }

  render(c: CanvasRenderingContext2D): void {
    for (const f of this.items) {
      const a = Math.max(0, Math.min(1, f.life / f.max));
      c.save();
      c.globalAlpha = a;
      c.font = `800 ${f.size}px "Baloo 2", system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = Math.max(2, f.size * 0.14);
      c.strokeStyle = "rgba(20,28,55,0.55)";
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, f.y);
      c.restore();
    }
  }
}
