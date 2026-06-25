/**
 * Particle, splat decal and floating-text systems for Fruit Frenzy.
 *
 * `Particles` owns three pools that share an update/render cadence:
 *   - particles : juice droplets, sparks, explosion rings, smoke, flashes
 *   - splats    : lingering translucent juice decals (capped, slow fade)
 *   - texts     : floating "+N" score numbers
 * All are pure-canvas and scale with the supplied radius/size values.
 */
import type { Particle, Splat, FloatingText } from "./types";
import { TAU, rand, randInt, seeded, withAlpha, MAX_SPLATS } from "./types";

type Ctx = CanvasRenderingContext2D;

export class Particles {
  private parts: Particle[] = [];
  private splats: Splat[] = [];
  private texts: FloatingText[] = [];

  clear(): void {
    this.parts.length = 0;
    this.splats.length = 0;
    this.texts.length = 0;
  }

  /** Spray of juice droplets + a couple of lingering splats along a cut. */
  juiceBurst(
    x: number,
    y: number,
    color: string,
    dir: number,
    scale: number,
    intensity = 1,
  ): void {
    const n = Math.round(randInt(14, 22) * intensity);
    for (let i = 0; i < n; i++) {
      // bias spray perpendicular to the cut for a "spurt" look
      const spread = rand(-1, 1);
      const a = dir + Math.PI / 2 + spread * 1.4 + (Math.random() < 0.5 ? Math.PI : 0);
      const sp = rand(0.6, 2.4) * scale * 60;
      const streaky = Math.random() < 0.35 ? rand(1.6, 3.2) : 0;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(0, 40) * scale,
        life: rand(0.4, 0.9),
        maxLife: 0.9,
        size: rand(0.06, 0.16) * scale * 50,
        color,
        gravity: 1400 * scale,
        kind: "juice",
        streak: streaky,
        spin: 0,
        angle: a,
      });
    }
    // lingering splats
    const sn = randInt(1, 3);
    for (let i = 0; i < sn; i++) {
      this.splats.push({
        x: x + rand(-1, 1) * scale * 20,
        y: y + rand(-1, 1) * scale * 20,
        r: rand(0.4, 1.1) * scale * 60,
        color,
        life: rand(5, 9),
        maxLife: 9,
        seed: (Math.random() * 1e9) | 0,
      });
    }
    if (this.splats.length > MAX_SPLATS) {
      this.splats.splice(0, this.splats.length - MAX_SPLATS);
    }
  }

  /** Big bomb explosion: shockwave ring + ember sparks + smoke + flash. */
  explosion(x: number, y: number, scale: number): void {
    this.parts.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.55,
      maxLife: 0.55,
      size: scale * 30,
      color: "#ffd27a",
      gravity: 0,
      kind: "ring",
      streak: 0,
      spin: 0,
      angle: 0,
    });
    this.parts.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.3,
      maxLife: 0.3,
      size: scale * 30,
      color: "#ffffff",
      gravity: 0,
      kind: "flash",
      streak: 0,
      spin: 0,
      angle: 0,
    });
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * TAU;
      const sp = rand(2, 7) * scale * 60;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.4, 0.9),
        maxLife: 0.9,
        size: rand(0.06, 0.18) * scale * 50,
        color: Math.random() < 0.5 ? "#ffae3a" : "#ff5a1a",
        gravity: 900 * scale,
        kind: "spark",
        streak: rand(1.5, 3),
        spin: 0,
        angle: a,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU;
      const sp = rand(0.5, 2) * scale * 60;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(20, 80) * scale,
        life: rand(0.8, 1.6),
        maxLife: 1.6,
        size: rand(0.4, 0.9) * scale * 50,
        color: "rgba(40,40,46,0.6)",
        gravity: -100 * scale,
        kind: "smoke",
        streak: 0,
        spin: rand(-1, 1),
        angle: a,
      });
    }
  }

  /** Light puff of skin/ash when a fruit is missed (optional flair). */
  poof(x: number, y: number, color: string, scale: number): void {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU;
      const sp = rand(0.3, 1.2) * scale * 40;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.3, 0.6),
        maxLife: 0.6,
        size: rand(0.1, 0.2) * scale * 40,
        color,
        gravity: 200 * scale,
        kind: "smoke",
        streak: 0,
        spin: 0,
        angle: a,
      });
    }
  }

  floatingText(x: number, y: number, text: string, color: string, size: number): void {
    this.texts.push({
      x,
      y,
      vy: -size * 1.6,
      text,
      color,
      size,
      life: 0.9,
      maxLife: 0.9,
    });
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      if (s.life <= 0) this.splats.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= 0.92;
    }
  }

  /** Splats render behind fruit; call this right after the background. */
  renderSplats(c: Ctx): void {
    for (const s of this.splats) {
      const a = Math.min(1, s.life / s.maxLife) * 0.4;
      c.fillStyle = withAlpha(s.color, a);
      // irregular blob from a few overlapping circles
      for (let i = 0; i < 5; i++) {
        const ang = seeded(s.seed, i) * TAU;
        const rr = seeded(s.seed, i + 9) * s.r * 0.6;
        const rad = s.r * (0.4 + seeded(s.seed, i + 18) * 0.5);
        c.beginPath();
        c.arc(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr, rad, 0, TAU);
        c.fill();
      }
    }
  }

  /** Particles + floating text render in front of fruit. */
  render(c: Ctx): void {
    for (const p of this.parts) {
      const a = Math.min(1, p.life / p.maxLife);
      if (p.kind === "ring") {
        const prog = 1 - p.life / p.maxLife;
        const rad = p.size * (1 + prog * 7);
        c.strokeStyle = withAlpha(p.color, (1 - prog) * 0.8);
        c.lineWidth = p.size * (1 - prog) * 0.8 + 1;
        c.beginPath();
        c.arc(p.x, p.y, rad, 0, TAU);
        c.stroke();
      } else if (p.kind === "flash") {
        const prog = 1 - p.life / p.maxLife;
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (3 + prog * 6));
        g.addColorStop(0, withAlpha("#ffffff", (1 - prog) * 0.9));
        g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (3 + prog * 6), 0, TAU);
        c.fill();
      } else if (p.kind === "smoke") {
        c.fillStyle =
          p.color.startsWith("rgba") || p.color.startsWith("rgb")
            ? p.color
            : withAlpha(p.color, a * 0.6);
        c.globalAlpha = a * 0.7;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1.3 - a * 0.3), 0, TAU);
        c.fill();
        c.globalAlpha = 1;
      } else {
        // juice / spark droplets
        c.fillStyle = p.color;
        c.globalAlpha = a;
        if (p.streak > 0) {
          const sp = Math.hypot(p.vx, p.vy);
          const ang = Math.atan2(p.vy, p.vx);
          c.save();
          c.translate(p.x, p.y);
          c.rotate(ang);
          c.beginPath();
          c.ellipse(0, 0, p.size * p.streak * (0.5 + sp / 600), p.size * 0.6, 0, 0, TAU);
          c.fill();
          c.restore();
        } else {
          c.beginPath();
          c.arc(p.x, p.y, p.size, 0, TAU);
          c.fill();
        }
        c.globalAlpha = 1;
      }
    }
  }

  renderText(c: Ctx): void {
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.maxLife);
      const pop = t.life > t.maxLife - 0.12 ? 1.4 - (t.maxLife - t.life) * 3 : 1;
      c.save();
      c.globalAlpha = a;
      c.font = `800 ${t.size * pop}px "Baloo 2", system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = t.size * 0.16;
      c.strokeStyle = "rgba(0,0,0,0.55)";
      c.strokeText(t.text, t.x, t.y);
      c.fillStyle = t.color;
      c.fillText(t.text, t.x, t.y);
      c.restore();
    }
  }
}
