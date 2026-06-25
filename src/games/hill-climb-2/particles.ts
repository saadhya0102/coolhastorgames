/**
 * Hill Climb 2 — pooled particle system.
 * Fixed capacity; oldest recycled when full. All positions are in world space;
 * the renderer projects them. Kept allocation-free in the hot path.
 */
import { clamp } from "@/engine";
import type { Particle } from "./types";

const CAP = 320;

export class ParticleSystem {
  list: Particle[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < CAP; i++) {
      this.list.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        max: 1,
        size: 1,
        rot: 0,
        vrot: 0,
        grav: 0,
        drag: 0,
        color: "#fff",
        kind: "dust",
        text: "",
      });
    }
  }

  private acquire(): Particle {
    // find a dead one starting from the rotating cursor; else recycle oldest
    for (let i = 0; i < CAP; i++) {
      const p = this.list[(this.next + i) % CAP];
      if (p.life <= 0) {
        this.next = (this.next + i + 1) % CAP;
        return p;
      }
    }
    const p = this.list[this.next];
    this.next = (this.next + 1) % CAP;
    return p;
  }

  clear(): void {
    for (const p of this.list) p.life = 0;
  }

  dust(x: number, y: number, vx: number, vy: number, color: string, size: number): void {
    const p = this.acquire();
    p.x = x;
    p.y = y;
    p.vx = vx + (Math.random() - 0.5) * 40;
    p.vy = vy - Math.random() * 40;
    p.max = 0.4 + Math.random() * 0.4;
    p.life = p.max;
    p.size = size * (0.7 + Math.random() * 0.6);
    p.grav = -60; // dust drifts up a little
    p.drag = 2.2;
    p.color = color;
    p.kind = "dust";
    p.rot = 0;
    p.vrot = 0;
    p.text = "";
  }

  exhaust(x: number, y: number, vx: number, vy: number): void {
    const p = this.acquire();
    p.x = x;
    p.y = y;
    p.vx = vx + (Math.random() - 0.5) * 30;
    p.vy = vy - 20 - Math.random() * 30;
    p.max = 0.5 + Math.random() * 0.3;
    p.life = p.max;
    p.size = 5 + Math.random() * 5;
    p.grav = -40;
    p.drag = 1.8;
    p.color = "rgba(60,60,60,0.5)";
    p.kind = "exhaust";
    p.text = "";
  }

  sparkle(x: number, y: number, color: string): void {
    const p = this.acquire();
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 220;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    p.max = 0.5 + Math.random() * 0.5;
    p.life = p.max;
    p.size = 3 + Math.random() * 4;
    p.grav = 120;
    p.drag = 1.2;
    p.color = color;
    p.kind = "sparkle";
    p.rot = Math.random() * Math.PI;
    p.vrot = (Math.random() - 0.5) * 12;
    p.text = "";
  }

  debris(x: number, y: number, color: string): void {
    const p = this.acquire();
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = 120 + Math.random() * 360;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    p.max = 0.8 + Math.random() * 0.8;
    p.life = p.max;
    p.size = 4 + Math.random() * 6;
    p.grav = 900;
    p.drag = 0.4;
    p.color = color;
    p.kind = "debris";
    p.rot = Math.random() * Math.PI * 2;
    p.vrot = (Math.random() - 0.5) * 18;
    p.text = "";
  }

  coinPop(x: number, y: number, text: string, color: string): void {
    const p = this.acquire();
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = -70;
    p.max = 0.9;
    p.life = p.max;
    p.size = 14;
    p.grav = 30;
    p.drag = 0.6;
    p.color = color;
    p.kind = "coin";
    p.text = text;
    p.rot = 0;
    p.vrot = 0;
  }

  burstDebris(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) this.debris(x, y, color);
  }

  burstSparkle(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) this.sparkle(x, y, color);
  }

  update(dt: number): void {
    const d = clamp(dt, 0, 0.05);
    for (const p of this.list) {
      if (p.life <= 0) continue;
      p.vx -= p.vx * p.drag * d;
      p.vy += p.grav * d - p.vy * p.drag * d;
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.rot += p.vrot * d;
      p.life -= d;
    }
  }

  /** Draw a pass. `front` selects sparkles/coin text vs ground fx. */
  draw(
    c: CanvasRenderingContext2D,
    project: (wx: number, wy: number) => { x: number; y: number },
    zoom: number,
    front: boolean,
  ): void {
    for (const p of this.list) {
      if (p.life <= 0) continue;
      const isFront = p.kind === "sparkle" || p.kind === "coin";
      if (isFront !== front) continue;
      const sp = project(p.x, p.y);
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === "coin") {
        c.globalAlpha = a;
        c.fillStyle = p.color;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.font = `800 ${Math.max(10, p.size * zoom)}px "Baloo 2", system-ui, sans-serif`;
        c.fillText(p.text, sp.x, sp.y);
        c.globalAlpha = 1;
        continue;
      }
      if (p.kind === "sparkle") {
        c.globalAlpha = a;
        c.fillStyle = p.color;
        drawStar(c, sp.x, sp.y, p.size * zoom * a + 1, p.rot);
        c.globalAlpha = 1;
        continue;
      }
      if (p.kind === "debris") {
        c.globalAlpha = a;
        c.fillStyle = p.color;
        c.save();
        c.translate(sp.x, sp.y);
        c.rotate(p.rot);
        const s = p.size * zoom;
        c.fillRect(-s / 2, -s / 2, s, s);
        c.restore();
        c.globalAlpha = 1;
        continue;
      }
      // dust / exhaust: soft circle
      c.globalAlpha = a * (p.kind === "exhaust" ? 0.5 : 0.7);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(sp.x, sp.y, Math.max(1, p.size * zoom * (1.4 - a * 0.4)), 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }
}

function drawStar(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    const a2 = a + Math.PI / 4;
    c.lineTo(Math.cos(a2) * r * 0.4, Math.sin(a2) * r * 0.4);
  }
  c.closePath();
  c.fill();
  c.restore();
}
