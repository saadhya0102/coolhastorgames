/** Juice systems: particles (additive sparks), floating score popups and a
 * decaying screen-shake. All live in VIRTUAL coordinates and are rendered by the
 * Renderer. */
import { rng } from "@/engine";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
}

export class Effects {
  particles: Particle[] = [];
  popups: ScorePopup[] = [];
  shakeMag = 0;
  shakeX = 0;
  shakeY = 0;
  private shakeT = 0;

  burst(x: number, y: number, color: string, count: number, power = 380) {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = rng.range(power * 0.25, power);
      const life = rng.range(0.25, 0.6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: rng.range(2, 5),
        color,
      });
    }
  }

  ring(x: number, y: number, color: string, count = 14, power = 300) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const life = 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * power,
        vy: Math.sin(a) * power,
        life,
        maxLife: life,
        size: 3.5,
        color,
      });
    }
  }

  popup(x: number, y: number, text: string, color: string) {
    this.popups.push({ x, y, text, life: 0.9, maxLife: 0.9, color });
    if (this.popups.length > 24) this.popups.shift();
  }

  shake(mag: number) {
    this.shakeMag = Math.min(26, Math.max(this.shakeMag, mag));
  }

  update(dt: number) {
    // particles (with light gravity + drag)
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += 900 * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const s of this.popups) {
      s.life -= dt;
      s.y -= 60 * dt;
    }
    this.popups = this.popups.filter((s) => s.life > 0);

    // shake
    this.shakeT += dt;
    this.shakeMag *= 1 - Math.min(1, 9 * dt);
    if (this.shakeMag < 0.4) this.shakeMag = 0;
    const f = this.shakeT * 60;
    this.shakeX = Math.cos(f * 1.7) * this.shakeMag;
    this.shakeY = Math.sin(f * 2.3) * this.shakeMag;
  }

  clear() {
    this.particles.length = 0;
    this.popups.length = 0;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }
}
