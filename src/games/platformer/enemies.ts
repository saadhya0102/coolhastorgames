import {
  ENEMY_GRAVITY,
  ENEMY_MAX_FALL,
  FLUTTER_AMP,
  FLUTTER_SPEED,
  GRUMBUG_SPEED,
  SHELL_SPEED,
  SNAPPER_SPEED,
  TILE,
} from "./constants";
import { collide, type Body } from "./physics";
import type { Box, EnemyKind } from "./types";
import type { Mover, World } from "./world";

export type EnemyState = "walk" | "shell" | "shellmove" | "dead";

export class Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  w: number;
  h: number;
  vx = 0;
  vy = 0;
  dir = -1;
  alive = true;
  state: EnemyState = "walk";
  grounded = false;
  animT = 0;
  bobBase: number;
  /** death animation timer (counts up once dead) */
  deadT = 0;
  /** shell idle timer before auto-waking (snapper) */
  shellIdle = 0;
  private onMover: Mover | null = null;

  constructor(kind: EnemyKind, cx: number, cy: number) {
    this.kind = kind;
    if (kind === "flutter") {
      this.w = TILE * 0.8;
      this.h = TILE * 0.7;
    } else {
      this.w = TILE * 0.82;
      this.h = kind === "snapper" ? TILE * 0.9 : TILE * 0.78;
    }
    this.x = cx - this.w / 2;
    this.y = cy - this.h / 2;
    this.bobBase = this.y;
    this.dir = -1;
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Is this enemy currently dangerous to touch from the side? */
  get harmful(): boolean {
    if (!this.alive || this.state === "dead") return false;
    if (this.state === "shell") return false; // idle shell is safe to touch
    return true;
  }

  /** Can the player stand-stomp this? Flutters can be stomped mid-air. */
  update(dt: number, world: World) {
    this.animT += dt;
    if (this.state === "dead") {
      this.deadT += dt;
      this.vy += ENEMY_GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return;
    }

    if (this.kind === "flutter") {
      this.updateFlutter(dt, world);
      return;
    }

    // carry on mover
    if (this.onMover) {
      this.x += this.onMover.dx;
      this.y += this.onMover.dy;
    }

    // horizontal intent
    if (this.state === "walk") {
      const sp = this.kind === "snapper" ? SNAPPER_SPEED : GRUMBUG_SPEED;
      this.vx = sp * this.dir;
    } else if (this.state === "shellmove") {
      this.vx = SHELL_SPEED * this.dir;
    } else {
      this.vx = 0; // idle shell
      this.shellIdle += dt;
      if (this.shellIdle > 6) {
        // wake back into a walker so it isn't a permanent platform
        this.state = "walk";
        this.shellIdle = 0;
        this.h = TILE * 0.9;
        this.dir = Math.random() < 0.5 ? -1 : 1;
      }
    }

    this.vy = Math.min(ENEMY_MAX_FALL, this.vy + ENEMY_GRAVITY * dt);

    const body: Body = { x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy };
    const prevBottom = body.y + body.h;
    const res = collide(body, dt, world);
    this.onMover = world.landOnMovers(body, prevBottom);
    this.x = body.x;
    this.y = body.y;
    this.vx = body.vx;
    this.vy = body.vy;
    this.grounded = res.grounded || this.onMover !== null;

    if (res.wallLeft || res.wallRight) this.dir = -this.dir;

    // ledge turning (walkers + idle shells stay put; moving shells keep going)
    if (this.grounded && this.state === "walk") {
      const aheadX = this.dir > 0 ? this.x + this.w + 2 : this.x - 2;
      const footRow = Math.floor((this.y + this.h + 4) / TILE);
      const aheadCol = Math.floor(aheadX / TILE);
      const overMover = world.movers.some(
        (m) => aheadX > m.x && aheadX < m.x + m.w && this.y + this.h <= m.y + 8 && this.y + this.h >= m.y - 8,
      );
      if (!world.solidAt(aheadCol, footRow) && !world.oneWayAt(aheadCol, footRow) && !overMover) {
        this.dir = -this.dir;
      }
    }
  }

  private updateFlutter(dt: number, world: World) {
    this.vx = FLUTTER_SPEED * this.dir;
    const body: Body = { x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: 0 };
    collide(body, dt, world, { useOneWay: false });
    if (body.vx === 0) this.dir = -this.dir; // hit a wall
    this.x = body.x;
    // sinusoidal hover around the fixed spawn altitude (bobBase)
    this.y = this.bobBase + Math.sin(this.animT * 3) * FLUTTER_AMP;
  }

  /** Player stomped this enemy. Returns a small result for fx/score. */
  stomp(): { killed: boolean; bounce: boolean; score: number } {
    if (this.kind === "snapper") {
      if (this.state === "walk") {
        this.state = "shell";
        this.shellIdle = 0;
        this.h = TILE * 0.55;
        this.y += TILE * 0.35;
        this.vx = 0;
        return { killed: false, bounce: true, score: 50 };
      }
      if (this.state === "shellmove") {
        this.state = "shell";
        this.shellIdle = 0;
        this.vx = 0;
        return { killed: false, bounce: true, score: 0 };
      }
      // idle shell stomped -> destroy
      this.die(0);
      return { killed: true, bounce: true, score: 100 };
    }
    this.die(0);
    return { killed: true, bounce: true, score: 100 };
  }

  /** Player touched an idle shell from the side -> kick it. */
  kick(fromX: number) {
    if (this.kind !== "snapper" || this.state !== "shell") return;
    this.dir = fromX < this.x + this.w / 2 ? 1 : -1;
    this.state = "shellmove";
  }

  /** Killed (by star touch, shell, or stomp). */
  die(dirX: number) {
    this.alive = false;
    this.state = "dead";
    this.deadT = 0;
    this.vy = -260;
    this.vx = dirX * 60;
  }

  /** Should be removed (faded out / fell away). */
  get gone(): boolean {
    return this.state === "dead" && this.deadT > 1.4;
  }
}
