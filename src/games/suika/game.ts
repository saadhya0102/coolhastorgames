/**
 * Mergemelon main game: orchestrates input, the circle-physics world, merge
 * detection + scoring, overflow/game-over, particles, audio and rendering.
 * Implements the engine GameInstance contract.
 */
import type { GameContext, GameInstance } from "@/engine";
import { clamp } from "@/engine";
import { CONFIG, MAX_TIER, type GameState, type Layout } from "./types";
import { TIERS, rollSpawnTier, radiusOf, scoreForTier } from "./fruits";
import { World } from "./physics";
import { ParticleSystem } from "./particles";
import { Sfx } from "./sfx";
import {
  drawBackground,
  drawJar,
  drawDangerLine,
  drawBody,
  drawGuide,
  drawCurrent,
  drawHud,
  drawOverlay,
} from "./render";

export class SuikaGame implements GameInstance {
  private world = new World();
  private particles = new ParticleSystem();
  private sfx: Sfx;

  private state: GameState = "intro";
  private score = 0;
  private best = 0;
  private highestTier = 0;

  private currentTier = 0;
  private nextTier = 0;
  private aimX = CONFIG.WORLD_W / 2;
  private dropCooldown = 0;
  private appear = 1;

  private overflowTimer = 0;
  private dyingTimer = 0;
  private acc = 0;
  private time = 0;
  private gameOverFired = false;

  constructor(private ctx: GameContext) {
    this.sfx = new Sfx(ctx.audio);
    this.best = ctx.storage.bestScore() ?? 0;
    this.highestTier = ctx.storage.get<number>("bestTier", 0);
    this.currentTier = rollSpawnTier();
    this.nextTier = rollSpawnTier();
    ctx.requestControls([]);
    ctx.reportScore(0);
    this.updateStatus();
  }

  private updateStatus(): void {
    this.ctx.setStatus(`Best ${this.best} • merge matching fruit to reach the Sunmelon`);
  }

  private layout(): Layout {
    const W = this.ctx.width;
    const H = this.ctx.height;
    const padX = W * 0.04;
    const topUI = H * 0.13;
    const padBottom = H * 0.04;
    const availW = W - padX * 2;
    const availH = H - topUI - padBottom;
    const scale = Math.min(availW / CONFIG.WORLD_W, availH / CONFIG.WORLD_H);
    const jarW = CONFIG.WORLD_W * scale;
    const jarH = CONFIG.WORLD_H * scale;
    const originX = (W - jarW) / 2;
    const originY = topUI + (availH - jarH) / 2;
    return { scale, originX, originY, W, H, jarW, jarH, topUI };
  }

  private pointerWorldX(layout: Layout): number {
    return (this.ctx.input.pointer.x - layout.originX) / layout.scale;
  }

  private clampAim(tier: number): void {
    const r = radiusOf(tier);
    this.aimX = clamp(this.aimX, r, CONFIG.WORLD_W - r);
  }

  update(dt: number): void {
    this.time += dt;
    this.sfx.tick(dt);
    const layout = this.layout();
    const input = this.ctx.input;

    // --- aim ---
    // Desktop follows the cursor (once it has moved over the stage); touch
    // follows only while a finger is down so "drag to aim, release to drop".
    const follow = this.ctx.isTouch ? input.pointer.down : input.pointer.x > 0;
    if (follow) {
      const wx = this.pointerWorldX(layout);
      if (Number.isFinite(wx)) this.aimX = wx;
    }
    if (input.isDown("ArrowLeft", "a")) this.aimX -= dt * 1.1;
    if (input.isDown("ArrowRight", "d")) this.aimX += dt * 1.1;
    this.clampAim(this.currentTier);

    if (this.dropCooldown > 0) this.dropCooldown -= dt;
    this.appear = clamp(this.appear + dt * 5, 0, 1);

    // --- drop trigger ---
    const wantDrop = this.ctx.isTouch
      ? input.pointer.justUp
      : input.pointer.justDown || input.pressed("Space", "ArrowDown", "s");
    if (wantDrop && this.state !== "dying" && this.dropCooldown <= 0) {
      this.drop();
    }

    // --- physics (fixed substeps) ---
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= CONFIG.FIXED_DT && steps < CONFIG.MAX_STEPS) {
      this.world.step(CONFIG.FIXED_DT);
      this.acc -= CONFIG.FIXED_DT;
      steps++;
    }
    if (steps === CONFIG.MAX_STEPS) this.acc = 0;

    this.resolveMerges();
    this.particles.update(dt);

    if (this.state !== "dying") this.checkOverflow(dt);
    else this.tickDying(dt);

    input.endFrame();
  }

  private drop(): void {
    if (this.state === "intro") this.state = "playing";
    this.clampAim(this.currentTier);
    const b = this.world.addBody(this.currentTier, this.aimX, CONFIG.DROP_Y, 0, CONFIG.DROP_VY);
    b.age = 0;
    this.sfx.drop();
    this.currentTier = this.nextTier;
    this.nextTier = rollSpawnTier();
    this.dropCooldown = CONFIG.DROP_COOLDOWN;
    this.appear = 0;
  }

  private resolveMerges(): void {
    const bs = this.world.bodies;
    let changed = false;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.dead) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.dead || b.tier !== a.tier) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= a.r + b.r + CONFIG.MERGE_TOL) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          a.dead = true;
          b.dead = true;
          changed = true;
          if (a.tier >= MAX_TIER) {
            this.jackpot(mx, my);
          } else {
            this.mergeInto(a.tier + 1, a, b, mx, my);
          }
          break;
        }
      }
    }
    if (changed) {
      this.world.bodies = bs.filter((x) => !x.dead);
    }
  }

  private mergeInto(
    newTier: number,
    a: { vx: number; vy: number; mass: number },
    b: { vx: number; vy: number; mass: number },
    mx: number,
    my: number,
  ): void {
    const m = a.mass + b.mass;
    let vx = ((a.vx * a.mass + b.vx * b.mass) / m) * CONFIG.MERGE_VEL_KEEP;
    let vy = ((a.vy * a.mass + b.vy * b.mass) / m) * CONFIG.MERGE_VEL_KEEP - CONFIG.MERGE_POP_UP;
    if (!Number.isFinite(vx)) vx = 0;
    if (!Number.isFinite(vy)) vy = 0;
    this.world.addBody(newTier, mx, my, vx, vy, true);

    this.score += scoreForTier(newTier);
    this.ctx.reportScore(this.score);
    if (newTier > this.highestTier) {
      this.highestTier = newTier;
      this.ctx.storage.set("bestTier", this.highestTier);
    }

    const f = TIERS[newTier];
    this.particles.burst(mx, my, f.light, 10 + newTier, 0.7 + newTier * 0.05, radiusOf(newTier) * 0.32);
    this.particles.ring(mx, my, f.color, radiusOf(newTier) * 0.6);
    this.sfx.merge(newTier);
  }

  private jackpot(mx: number, my: number): void {
    this.score += CONFIG.JACKPOT_SCORE;
    this.ctx.reportScore(this.score);
    const f = TIERS[MAX_TIER];
    this.particles.burst(mx, my, f.light, 60, 1.6, radiusOf(MAX_TIER) * 0.22);
    this.particles.burst(mx, my, "#ffe14d", 30, 1.2, radiusOf(MAX_TIER) * 0.18);
    this.particles.ring(mx, my, f.color, radiusOf(MAX_TIER) * 0.4);
    this.sfx.jackpot();
  }

  private checkOverflow(dt: number): void {
    let overflowing = false;
    for (const b of this.world.bodies) {
      if (b.age > CONFIG.OVERFLOW_GRACE && b.y < CONFIG.DANGER_Y) {
        overflowing = true;
        break;
      }
    }
    if (overflowing) {
      this.overflowTimer += dt;
      this.sfx.warn();
      if (this.overflowTimer >= CONFIG.OVERFLOW_LIMIT) this.startDying();
    } else {
      this.overflowTimer = Math.max(0, this.overflowTimer - dt * 2);
    }
  }

  private startDying(): void {
    this.state = "dying";
    this.dyingTimer = 0;
    this.best = Math.max(this.best, this.score);
    this.ctx.storage.submitScore(this.score);
    this.sfx.gameOver();
  }

  private tickDying(dt: number): void {
    this.dyingTimer += dt;
    if (this.dyingTimer >= CONFIG.GAMEOVER_DELAY && !this.gameOverFired) {
      this.gameOverFired = true;
      this.ctx.gameOver(this.score);
    }
  }

  render(): void {
    const c = this.ctx.ctx;
    const layout = this.layout();

    drawBackground(c, layout, this.time);
    drawJar(c, layout);

    const overflowRatio = this.overflowTimer / CONFIG.OVERFLOW_LIMIT;
    drawDangerLine(c, layout, overflowRatio, this.state);

    // aim guide + waiting fruit (only while playable)
    if (this.state !== "dying" && this.dropCooldown <= 0) {
      drawGuide(c, layout, this.aimX, this.currentTier);
    }
    if (this.state !== "dying") {
      drawCurrent(c, layout, this.aimX, this.currentTier, this.appear, this.time);
    }

    for (const b of this.world.bodies) drawBody(c, layout, b, this.time);

    this.particles.draw(c, layout);

    drawHud(c, layout, this.score, Math.max(this.best, this.score), this.nextTier, this.time);
    drawOverlay(c, layout, this.state, this.score, this.best, this.highestTier);
  }

  resize(): void {
    // Layout is recomputed every frame from getters; nothing to cache.
  }

  destroy(): void {
    this.world.reset();
    this.particles.reset();
  }
}
