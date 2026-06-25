import { CAM_LERP, CAM_LOOKAHEAD, SHAKE_DECAY, TILE, VIEW_ROWS } from "./constants";
import { clamp } from "@/engine";
import type { Viewport } from "./types";

/** Scrolling camera with look-ahead, smoothing, clamping and screen shake.
 *  All state is world-space; screen size is supplied each frame. */
export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  /** level bounds in world px */
  private levelW = 0;
  private levelH = 0;

  setLevelSize(wTiles: number, hTiles: number) {
    this.levelW = wTiles * TILE;
    this.levelH = hTiles * TILE;
  }

  /** Snap immediately to a target center (used on respawn / level start). */
  snapTo(cx: number, cy: number, screenW: number, screenH: number, facing: number) {
    this.recomputeScale(screenH);
    const view = this.viewSize(screenW, screenH);
    this.x = this.clampX(cx + facing * CAM_LOOKAHEAD - view.w / 2, view.w);
    this.y = this.clampY(cy - view.h / 2, view.h);
  }

  private recomputeScale(screenH: number) {
    this.scale = screenH / (VIEW_ROWS * TILE);
  }

  private viewSize(screenW: number, screenH: number) {
    return { w: screenW / this.scale, h: screenH / this.scale };
  }

  private clampX(x: number, viewW: number) {
    if (this.levelW <= viewW) return (this.levelW - viewW) / 2;
    return clamp(x, 0, this.levelW - viewW);
  }

  private clampY(y: number, viewH: number) {
    if (this.levelH <= viewH) return (this.levelH - viewH) / 2;
    return clamp(y, 0, this.levelH - viewH);
  }

  update(
    targetX: number,
    targetY: number,
    facing: number,
    screenW: number,
    screenH: number,
    dt: number,
  ) {
    this.recomputeScale(screenH);
    const view = this.viewSize(screenW, screenH);
    const goalX = this.clampX(targetX + facing * CAM_LOOKAHEAD - view.w / 2, view.w);
    const goalY = this.clampY(targetY - view.h * 0.55, view.h);
    // frame-rate independent exponential smoothing
    const t = 1 - Math.exp(-CAM_LERP * dt);
    this.x += (goalX - this.x) * t;
    this.y += (goalY - this.y) * t;

    if (this.shake > 0.01) {
      this.shake = Math.max(0, this.shake - SHAKE_DECAY * dt * this.shake);
      const mag = this.shake;
      this.shakeX = (Math.random() * 2 - 1) * mag;
      this.shakeY = (Math.random() * 2 - 1) * mag;
    } else {
      this.shake = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  addShake(amount: number) {
    this.shake = Math.min(28, this.shake + amount);
  }

  viewport(screenW: number, screenH: number): Viewport {
    const view = this.viewSize(screenW, screenH);
    return { x: this.x, y: this.y, w: view.w, h: view.h, scale: this.scale };
  }

  /** Apply the world transform to the context. Caller must restore(). */
  begin(c: CanvasRenderingContext2D) {
    c.save();
    c.translate(-(this.x + this.shakeX) * this.scale, -(this.y + this.shakeY) * this.scale);
    c.scale(this.scale, this.scale);
  }
}
