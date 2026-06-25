/**
 * Particle systems for Bubble Pop Saga — pop shards, fizz sparkles, drop
 * splashes and floating score "pings". All procedural, drawn on the canvas.
 */

export interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number;
  maxLife: number;
  spin: number;
  spinV: number;
  /** 0 = round shard, 1 = triangular splinter */
  shape: number;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface Ping {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: string;
}

export class Particles {
  shards: Shard[] = [];
  sparks: Spark[] = [];
  pings: Ping[] = [];
  rings: Ring[] = [];

  clear(): void {
    this.shards = [];
    this.sparks = [];
    this.pings = [];
    this.rings = [];
  }

  /** Burst of colored shards + sparkles when a bubble pops. */
  pop(x: number, y: number, color: string, scale: number, intensity = 1): void {
    const n = Math.round(7 * intensity);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.2) * scale * 9;
      this.shards.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - scale * 2,
        r: scale * (1.6 + Math.random() * 2.4),
        color,
        life: 0.45 + Math.random() * 0.35,
        maxLife: 0.8,
        spin: Math.random() * Math.PI,
        spinV: (Math.random() - 0.5) * 14,
        shape: Math.random() < 0.5 ? 0 : 1,
      });
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.6) * scale * 11;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.25,
        maxLife: 0.55,
        color: "#ffffff",
      });
    }
    this.rings.push({
      x,
      y,
      r: scale * 2,
      maxR: scale * 16 * intensity,
      life: 0.32,
      maxLife: 0.32,
      color,
    });
  }

  /** Splash when a falling bubble leaves the bottom of the screen. */
  splash(x: number, y: number, color: string, scale: number): void {
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const sp = (0.5 + Math.random() * 1.3) * scale * 10;
      this.shards.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: scale * (1.4 + Math.random() * 2),
        color,
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        spin: 0,
        spinV: (Math.random() - 0.5) * 10,
        shape: 0,
      });
    }
  }

  /** A floating score number. */
  ping(x: number, y: number, text: string, color: string, size: number): void {
    this.pings.push({
      x,
      y,
      vy: -size * 1.4,
      life: 0.9,
      maxLife: 0.9,
      text,
      color,
      size,
    });
  }

  /** Expanding shock ring (used for big combos / descents). */
  shock(x: number, y: number, maxR: number, color: string): void {
    this.rings.push({
      x,
      y,
      r: maxR * 0.2,
      maxR,
      life: 0.5,
      maxLife: 0.5,
      color,
    });
  }

  update(dt: number, gravity: number): void {
    for (const s of this.shards) {
      s.life -= dt;
      s.vy += gravity * dt;
      s.x += s.vx * dt * 60;
      s.y += s.vy * dt * 60;
      s.spin += s.spinV * dt;
    }
    for (const s of this.sparks) {
      s.life -= dt;
      s.x += s.vx * dt * 60;
      s.y += s.vy * dt * 60;
      s.vx *= 0.92;
      s.vy *= 0.92;
    }
    for (const p of this.pings) {
      p.life -= dt;
      p.y += p.vy * dt * 60 * 0.5;
      p.vy *= 0.96;
    }
    for (const r of this.rings) {
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.r = r.maxR * 0.2 + (r.maxR - r.maxR * 0.2) * t;
    }
    this.shards = this.shards.filter((s) => s.life > 0);
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.pings = this.pings.filter((p) => p.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  render(c: CanvasRenderingContext2D): void {
    // expanding rings
    for (const r of this.rings) {
      const a = Math.max(0, r.life / r.maxLife);
      c.save();
      c.globalAlpha = a * 0.6;
      c.strokeStyle = r.color;
      c.lineWidth = Math.max(1, r.maxR * 0.06 * a);
      c.beginPath();
      c.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    // shards
    for (const s of this.shards) {
      const a = Math.max(0, Math.min(1, s.life / s.maxLife));
      c.save();
      c.globalAlpha = a;
      c.translate(s.x, s.y);
      c.rotate(s.spin);
      c.fillStyle = s.color;
      if (s.shape === 0) {
        c.beginPath();
        c.arc(0, 0, s.r * (0.5 + a * 0.5), 0, Math.PI * 2);
        c.fill();
      } else {
        const r = s.r * (0.6 + a * 0.6);
        c.beginPath();
        c.moveTo(0, -r);
        c.lineTo(r * 0.9, r * 0.7);
        c.lineTo(-r * 0.9, r * 0.7);
        c.closePath();
        c.fill();
      }
      c.restore();
    }
    // sparks
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const s of this.sparks) {
      const a = Math.max(0, s.life / s.maxLife);
      c.globalAlpha = a;
      c.fillStyle = s.color;
      c.beginPath();
      c.arc(s.x, s.y, 1.5 + a * 1.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // score pings
    for (const p of this.pings) {
      const a = Math.max(0, p.life / p.maxLife);
      c.save();
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.strokeStyle = "rgba(0,0,0,0.4)";
      c.lineWidth = Math.max(2, p.size * 0.12);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `800 ${p.size}px "Baloo 2", system-ui, sans-serif`;
      c.strokeText(p.text, p.x, p.y);
      c.fillText(p.text, p.x, p.y);
      c.restore();
    }
  }

  get count(): number {
    return (
      this.shards.length + this.sparks.length + this.pings.length + this.rings.length
    );
  }
}
