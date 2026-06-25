/** Lightweight particle + floating-text system. All positions are in CSS px. */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  /** 0 = circle, 1 = square, 2 = star, 3 = ring */
  shape: number;
  rot: number;
  spin: number;
}

interface Floater {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

export class Particles {
  private items: Particle[] = [];
  private floaters: Floater[] = [];

  clear(): void {
    this.items.length = 0;
    this.floaters.length = 0;
  }

  spawn(p: Partial<Particle> & { x: number; y: number }): void {
    this.items.push({
      x: p.x,
      y: p.y,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      life: p.life ?? 0.6,
      maxLife: p.life ?? 0.6,
      size: p.size ?? 4,
      color: p.color ?? "#fff",
      gravity: p.gravity ?? 0,
      shape: p.shape ?? 0,
      rot: p.rot ?? 0,
      spin: p.spin ?? 0,
    });
  }

  burst(
    x: number,
    y: number,
    color: string,
    count: number,
    speed: number,
    opts?: { gravity?: number; size?: number; shape?: number; life?: number },
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        color,
        gravity: opts?.gravity ?? 600,
        size: (opts?.size ?? 5) * (0.6 + Math.random() * 0.8),
        shape: opts?.shape ?? 0,
        life: (opts?.life ?? 0.7) * (0.7 + Math.random() * 0.6),
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * Math.PI,
      });
    }
  }

  /** rising smoke/steam puff */
  puff(x: number, y: number, color: string, count = 1, spread = 8): void {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 18,
        vy: -28 - Math.random() * 26,
        color,
        gravity: -10,
        size: 6 + Math.random() * 8,
        shape: 0,
        life: 0.9 + Math.random() * 0.7,
        spin: 0,
      });
    }
  }

  floatText(x: number, y: number, text: string, color: string, size: number): void {
    this.floaters.push({ x, y, vy: -46, life: 1.1, maxLife: 1.1, text, color, size });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      f.vy *= 0.94;
      f.y += f.vy * dt;
    }
  }

  draw(c: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      c.globalAlpha = a;
      c.fillStyle = p.color;
      if (p.shape === 2) {
        this.star(c, p.x, p.y, p.size, p.rot);
      } else if (p.shape === 3) {
        c.lineWidth = Math.max(1, p.size * 0.35);
        c.strokeStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.stroke();
      } else if (p.shape === 1) {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        c.restore();
      } else {
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    for (const f of this.floaters) {
      const a = Math.max(0, Math.min(1, f.life / f.maxLife));
      const t = 1 - f.life / f.maxLife;
      c.globalAlpha = a;
      c.font = `800 ${f.size}px "Baloo 2", system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      const yy = f.y - t * 6;
      c.lineWidth = Math.max(2, f.size * 0.16);
      c.strokeStyle = "rgba(58,36,24,0.55)";
      c.strokeText(f.text, f.x, yy);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, yy);
    }
    c.globalAlpha = 1;
  }

  private star(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
    c.restore();
  }
}
