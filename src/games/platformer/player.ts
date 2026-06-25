import {
  AIR_ACCEL,
  AIR_FRICTION,
  BOUNCE_V,
  COYOTE_TIME,
  FALL_GRAVITY_MULT,
  GRAVITY,
  GROUND_FRICTION,
  HURT_INVULN,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_V,
  MAX_FALL,
  MAX_RUN,
  MAX_WALK,
  PLAYER_H_BIG,
  PLAYER_H_SMALL,
  PLAYER_W,
  STAR_SPEED_MULT,
  STAR_TIME,
  TILE,
  TURN_BOOST,
  WALK_ACCEL,
} from "./constants";
import { collide, type Body } from "./physics";
import type { Box, Facing, Intent, PowerState } from "./types";
import type { Mover, World } from "./world";

export interface PlayerEvents {
  jumped: boolean;
  landed: boolean;
  hardLanding: boolean;
  footX: number;
  footY: number;
  questionHits: { x: number; y: number; content: "coin" | null }[];
  brickBreaks: { x: number; y: number }[];
  bumpedSolid: boolean;
}

type AnimState = "idle" | "run" | "jump" | "fall";

export class Player {
  x = 0;
  y = 0;
  w = PLAYER_W;
  h = PLAYER_H_SMALL;
  vx = 0;
  vy = 0;
  facing: Facing = 1;
  grounded = false;
  size: "small" | "big" = "small";
  starTimer = 0;
  invuln = 0;
  dead = false;

  // animation
  anim: AnimState = "idle";
  animT = 0;
  runPhase = 0;
  squash = 1;
  blinkT = Math.random() * 4;

  private coyote = 0;
  private buffer = 0;
  private onMover: Mover | null = null;
  private wasGrounded = false;

  get power(): PowerState {
    return this.starTimer > 0 ? "star" : this.size;
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get cx(): number {
    return this.x + this.w / 2;
  }

  get cy(): number {
    return this.y + this.h / 2;
  }

  reset(spawnX: number, spawnY: number, keepPower = false) {
    if (!keepPower) {
      this.size = "small";
    }
    this.h = this.size === "big" ? PLAYER_H_BIG : PLAYER_H_SMALL;
    this.x = spawnX;
    this.y = spawnY - this.h;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.starTimer = 0;
    this.invuln = 0;
    this.dead = false;
    this.coyote = 0;
    this.buffer = 0;
    this.onMover = null;
    this.anim = "idle";
    this.squash = 1;
  }

  grow() {
    if (this.size === "small") {
      this.size = "big";
      this.y -= PLAYER_H_BIG - PLAYER_H_SMALL;
      this.h = PLAYER_H_BIG;
      this.squash = 1.35;
    }
  }

  giveStar() {
    this.starTimer = STAR_TIME;
  }

  /** Returns 'die' | 'shrink' | 'none'. */
  takeDamage(): "die" | "shrink" | "none" {
    if (this.starTimer > 0 || this.invuln > 0 || this.dead) return "none";
    if (this.size === "big") {
      this.size = "small";
      this.y += PLAYER_H_BIG - PLAYER_H_SMALL;
      this.h = PLAYER_H_SMALL;
      this.invuln = HURT_INVULN;
      this.vy = -260;
      return "shrink";
    }
    this.dead = true;
    return "die";
  }

  bounce() {
    this.vy = -BOUNCE_V;
    this.grounded = false;
    this.squash = 0.7;
  }

  update(dt: number, intent: Intent, world: World): PlayerEvents {
    const ev: PlayerEvents = {
      jumped: false,
      landed: false,
      hardLanding: false,
      footX: this.cx,
      footY: this.y + this.h,
      questionHits: [],
      brickBreaks: [],
      bumpedSolid: false,
    };
    if (this.dead) return ev;

    this.animT += dt;
    if (this.starTimer > 0) this.starTimer = Math.max(0, this.starTimer - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;

    // carry on moving platform
    if (this.onMover && this.grounded) {
      this.x += this.onMover.dx;
      this.y += this.onMover.dy;
    }

    // ---- horizontal ----
    const starMul = this.starTimer > 0 ? STAR_SPEED_MULT : 1;
    const maxSpeed = (intent.run ? MAX_RUN : MAX_WALK) * starMul;
    let target = 0;
    if (intent.left && !intent.right) { target = -maxSpeed; this.facing = -1; }
    else if (intent.right && !intent.left) { target = maxSpeed; this.facing = 1; }

    const accelBase = this.grounded ? WALK_ACCEL : AIR_ACCEL;
    if (target !== 0) {
      // extra accel when reversing for snappy turns
      const reversing = Math.sign(target) !== Math.sign(this.vx) && this.vx !== 0;
      const accel = accelBase * (reversing ? TURN_BOOST : 1);
      if (this.vx < target) this.vx = Math.min(target, this.vx + accel * dt);
      else if (this.vx > target) this.vx = Math.max(target, this.vx - accel * dt);
    } else {
      const fric = this.grounded ? GROUND_FRICTION : AIR_FRICTION;
      if (this.vx > 0) this.vx = Math.max(0, this.vx - fric * dt);
      else if (this.vx < 0) this.vx = Math.min(0, this.vx + fric * dt);
    }

    // ---- jump (coyote + buffer + variable height) ----
    if (this.grounded) this.coyote = COYOTE_TIME;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (intent.jumpPressed) this.buffer = JUMP_BUFFER;
    else this.buffer = Math.max(0, this.buffer - dt);

    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = -JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.squash = 1.3;
      ev.jumped = true;
    }
    if (intent.jumpReleased && this.vy < 0) this.vy *= JUMP_CUT;

    // ---- gravity ----
    const g = GRAVITY * (this.vy > 0 ? FALL_GRAVITY_MULT : 1);
    this.vy = Math.min(MAX_FALL, this.vy + g * dt);

    // ---- collide ----
    const fallSpeed = this.vy;
    const body: Body = { x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy };
    const prevBottom = body.y + body.h;
    const res = collide(body, dt, world, { dropThrough: intent.down });
    this.onMover = world.landOnMovers(body, prevBottom);
    this.x = body.x;
    this.y = body.y;
    this.vx = body.vx;
    this.vy = body.vy;
    const nowGrounded = res.grounded || this.onMover !== null;

    // landing
    if (nowGrounded && !this.wasGrounded) {
      ev.landed = true;
      ev.footX = this.cx;
      ev.footY = this.y + this.h;
      if (fallSpeed > 620) {
        ev.hardLanding = true;
        this.squash = 0.7;
      }
    }
    this.grounded = nowGrounded;
    this.wasGrounded = nowGrounded;

    // ceiling bumps -> bricks / question blocks
    for (const b of res.bumped) {
      if (b.type === "question") {
        const content = world.bumpQuestion(b.col, b.row);
        ev.questionHits.push({ x: b.col * TILE + TILE / 2, y: b.row * TILE, content });
      } else if (b.type === "brick") {
        if (this.size === "big" || this.starTimer > 0) {
          if (world.breakBrick(b.col, b.row)) ev.brickBreaks.push({ x: b.col * TILE + TILE / 2, y: b.row * TILE + TILE / 2 });
        } else {
          ev.bumpedSolid = true;
        }
      } else {
        ev.bumpedSolid = true;
      }
    }

    // squash recovery
    this.squash += (1 - this.squash) * Math.min(1, dt * 12);

    // animation state
    if (!this.grounded) this.anim = this.vy < 0 ? "jump" : "fall";
    else if (Math.abs(this.vx) > 18) this.anim = "run";
    else this.anim = "idle";
    if (this.anim === "run") this.runPhase += Math.abs(this.vx) * dt * 0.045;

    return ev;
  }
}
