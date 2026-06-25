/**
 * Blade: pointer-trail tracking, slice-segment generation and the glowing
 * swoosh rendering.
 *
 * The primary pointer drives the main trail and combo scope. Additional active
 * pointers (multitouch) each get a lightweight last-position cache so two
 * fingers can slice at once and draw thinner secondary trails.
 *
 * Each frame we emit `Segment`s (A→B with a speed) for slice detection. To
 * avoid fast flicks "tunnelling" through small fruit, a long move between two
 * samples is subdivided into several sub-segments.
 */
import type { InputManager } from "@/engine";
import type { World, TrailPoint } from "./types";
import { TRAIL_LIFETIME, TRAIL_MAX, TAU, withAlpha } from "./types";

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** speed in px/s of the originating move */
  speed: number;
}

interface PointerTrack {
  x: number;
  y: number;
  trail: TrailPoint[];
}

export class Blade {
  /** primary pointer trail (used for rendering main swoosh) */
  private trail: TrailPoint[] = [];
  private primaryActive = false;
  private lastPrimary: { x: number; y: number } | null = null;
  /** secondary pointers keyed by id */
  private extra = new Map<number, PointerTrack>();
  /** segments produced this frame (cleared each update) */
  segments: Segment[] = [];
  /** fastest segment speed this frame (for whoosh sfx) */
  frameMaxSpeed = 0;

  reset(): void {
    this.trail.length = 0;
    this.extra.clear();
    this.lastPrimary = null;
    this.primaryActive = false;
    this.segments.length = 0;
    this.frameMaxSpeed = 0;
  }

  /** True while the primary pointer is held down and moving (blade visible). */
  get active(): boolean {
    return this.primaryActive;
  }

  /**
   * Advance the trail from the current input state and build this frame's
   * slice segments. `primaryId` lets us avoid double-counting the canonical
   * pointer when it also appears in the `pointers` map.
   */
  update(input: InputManager, world: World, dt: number): void {
    this.segments.length = 0;
    this.frameMaxSpeed = 0;
    const now = world.time;
    const safeDt = Math.max(dt, 1 / 240);

    // ---- primary pointer ----
    if (input.pointer.justDown) {
      // new swipe: start fresh so trail doesn't snap across the screen
      this.trail.length = 0;
      this.lastPrimary = null;
    }
    if (input.pointer.down) {
      this.primaryActive = true;
      const px = input.pointer.x;
      const py = input.pointer.y;
      if (this.lastPrimary) {
        this.addSegments(this.lastPrimary.x, this.lastPrimary.y, px, py, safeDt, world);
      }
      this.trail.push({ x: px, y: py, t: now });
      this.lastPrimary = { x: px, y: py };
    } else {
      this.primaryActive = false;
      this.lastPrimary = null;
    }

    // ---- secondary pointers (multitouch) ----
    // Identify the primary by matching coordinates to skip it.
    for (const [id, p] of input.pointers) {
      if (
        input.pointer.down &&
        Math.abs(p.x - input.pointer.x) < 0.5 &&
        Math.abs(p.y - input.pointer.y) < 0.5
      ) {
        continue; // this is the primary, already handled
      }
      let track = this.extra.get(id);
      if (!track) {
        track = { x: p.x, y: p.y, trail: [] };
        this.extra.set(id, track);
      } else {
        this.addSegments(track.x, track.y, p.x, p.y, safeDt, world);
      }
      track.x = p.x;
      track.y = p.y;
      track.trail.push({ x: p.x, y: p.y, t: now });
    }
    // drop secondary pointers no longer active
    for (const id of [...this.extra.keys()]) {
      if (!input.pointers.has(id)) this.extra.delete(id);
    }

    // ---- age out old trail points ----
    this.pruneTrail(this.trail, now);
    for (const t of this.extra.values()) this.pruneTrail(t.trail, now);
  }

  private addSegments(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    dt: number,
    world: World,
  ): void {
    const d = Math.hypot(bx - ax, by - ay);
    const speed = d / dt;
    if (speed > this.frameMaxSpeed) this.frameMaxSpeed = speed;
    // subdivide long moves so quick flicks can't tunnel through small fruit
    const step = world.min * 0.04;
    const n = Math.min(8, Math.max(1, Math.floor(d / step)));
    let px = ax;
    let py = ay;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      this.segments.push({ ax: px, ay: py, bx: nx, by: ny, speed });
      px = nx;
      py = ny;
    }
  }

  private pruneTrail(trail: TrailPoint[], now: number): void {
    while (trail.length > 0 && now - trail[0].t > TRAIL_LIFETIME) trail.shift();
    while (trail.length > TRAIL_MAX) trail.shift();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  render(c: CanvasRenderingContext2D, world: World): void {
    this.renderTrail(c, this.trail, world, 1);
    for (const t of this.extra.values()) this.renderTrail(c, t.trail, world, 0.6);
  }

  private renderTrail(
    c: CanvasRenderingContext2D,
    trail: TrailPoint[],
    world: World,
    scale: number,
  ): void {
    if (trail.length < 2) return;
    const now = world.time;
    const maxW = world.min * 0.045 * scale;

    // Build a tapered ribbon: offset each point perpendicular to local dir by a
    // width that grows toward the newest point and fades with age.
    const top: Array<{ x: number; y: number }> = [];
    const bot: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const age = (now - p.t) / TRAIL_LIFETIME;
      const prog = i / (trail.length - 1); // 0 oldest .. 1 newest
      const prev = trail[Math.max(0, i - 1)];
      const next = trail[Math.min(trail.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = maxW * prog * (1 - age * 0.4);
      top.push({ x: p.x - dy * w, y: p.y + dx * w });
      bot.push({ x: p.x + dy * w, y: p.y - dx * w });
    }

    const tracePath = (): void => {
      c.beginPath();
      c.moveTo(top[0].x, top[0].y);
      for (let i = 1; i < top.length; i++) c.lineTo(top[i].x, top[i].y);
      for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i].x, bot[i].y);
      c.closePath();
    };

    // glow pass
    c.save();
    c.globalCompositeOperation = "lighter";
    c.shadowBlur = world.min * 0.04;
    c.shadowColor = "rgba(120,200,255,0.8)";
    c.fillStyle = "rgba(90,170,255,0.35)";
    tracePath();
    c.fill();
    c.restore();

    // bright core
    c.save();
    const head = trail[trail.length - 1];
    const tail = trail[0];
    const grad = c.createLinearGradient(tail.x, tail.y, head.x, head.y);
    grad.addColorStop(0, withAlpha("#bfe6ff", 0));
    grad.addColorStop(0.6, withAlpha("#eaf6ff", 0.7));
    grad.addColorStop(1, "rgba(255,255,255,0.95)");
    c.fillStyle = grad;
    tracePath();
    c.fill();
    c.restore();

    // glint at the tip
    c.save();
    c.globalCompositeOperation = "lighter";
    const g = c.createRadialGradient(head.x, head.y, 0, head.x, head.y, maxW * 2.2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(head.x, head.y, maxW * 2.2, 0, TAU);
    c.fill();
    c.restore();
  }
}
