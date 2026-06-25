/** Pooled particle system. World-space simulation, drawn under the camera. */

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  grav: number;
  /** 0 = circle, 1 = square (debris), 2 = star spark, 3 = ring */
  shape: number;
  spin: number;
  rot: number;
}

const MAX = 260;

export class ParticleSystem {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        active: false,
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 1,
        color: "#fff", grav: 0, shape: 0, spin: 0, rot: 0,
      });
    }
  }

  private spawn(): Particle {
    // find next inactive from cursor (round-robin reuse if full)
    for (let i = 0; i < MAX; i++) {
      const idx = (this.cursor + i) % MAX;
      if (!this.pool[idx].active) {
        this.cursor = (idx + 1) % MAX;
        return this.pool[idx];
      }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  private emit(
    x: number, y: number, vx: number, vy: number,
    life: number, size: number, color: string, grav: number,
    shape: number, spin: number,
  ) {
    const p = this.spawn();
    p.active = true;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.size = size; p.color = color;
    p.grav = grav; p.shape = shape; p.spin = spin; p.rot = Math.random() * Math.PI * 2;
  }

  dust(x: number, y: number, dir = 0) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 1.4 - dir * 0.4;
      const s = 40 + Math.random() * 90;
      this.emit(x, y, Math.cos(a) * s + dir * 30, -Math.abs(Math.sin(a)) * s - 20,
        0.35 + Math.random() * 0.2, 3 + Math.random() * 3, "rgba(225,220,200,0.9)", 240, 0, 0);
    }
  }

  landDust(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const a = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9;
      const s = 60 + Math.random() * 140;
      this.emit(x + (Math.random() - 0.5) * 14, y, Math.cos(a) * s, -Math.abs(Math.sin(a)) * s * 0.6,
        0.4 + Math.random() * 0.25, 3 + Math.random() * 4, "rgba(230,225,205,0.9)", 300, 0, 0);
    }
  }

  coinSparkle(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 120;
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s - 40,
        0.4 + Math.random() * 0.3, 2 + Math.random() * 3, color, 120, 2, (Math.random() - 0.5) * 12);
    }
  }

  poof(x: number, y: number, color: string) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 50 + Math.random() * 160;
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s,
        0.4 + Math.random() * 0.35, 3 + Math.random() * 4, color, 180, 0, (Math.random() - 0.5) * 8);
    }
    this.emit(x, y, 0, 0, 0.3, 26, "rgba(255,255,255,0.5)", 0, 3, 0);
  }

  debris(x: number, y: number, color: string) {
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
      const s = 120 + Math.random() * 220;
      this.emit(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20,
        Math.cos(a) * s, Math.sin(a) * s,
        0.5 + Math.random() * 0.4, 4 + Math.random() * 5, color, 900, 1, (Math.random() - 0.5) * 16);
    }
  }

  starTrail(x: number, y: number, color: string) {
    this.emit(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30 + 20,
      0.5, 4 + Math.random() * 4, color, -40, 2, (Math.random() - 0.5) * 10);
  }

  confetti(x: number, y: number) {
    const cols = ["#ff5c8a", "#ffd23f", "#46e0a0", "#19d3ff", "#9b5cff", "#ff9f1c"];
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const s = 180 + Math.random() * 320;
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s,
        1.0 + Math.random() * 0.8, 5 + Math.random() * 5,
        cols[(Math.random() * cols.length) | 0], 500, 1, (Math.random() - 0.5) * 18);
    }
  }

  burst(x: number, y: number, color: string, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s,
        0.4 + Math.random() * 0.3, 3 + Math.random() * 3, color, 200, 0, 0);
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  render(c: CanvasRenderingContext2D) {
    for (const p of this.pool) {
      if (!p.active) continue;
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      c.globalAlpha = a;
      if (p.shape === 1) {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        c.restore();
      } else if (p.shape === 2) {
        drawStar(c, p.x, p.y, p.size * 1.4, p.size * 0.55, p.rot, p.color);
      } else if (p.shape === 3) {
        c.strokeStyle = p.color;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1.4 - a), 0, Math.PI * 2);
        c.stroke();
      } else {
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  clear() {
    for (const p of this.pool) p.active = false;
  }
}

function drawStar(
  c: CanvasRenderingContext2D, x: number, y: number,
  outer: number, inner: number, rot: number, color: string,
) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
  c.fill();
  c.restore();
}
