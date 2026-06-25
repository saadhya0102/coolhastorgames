import type { Camera } from "./camera";
import {
  COYOTE_T,
  GRAVITY,
  JUMP_BUFFER_T,
  JUMP_VY,
  Z_PLAYER,
} from "./config";
import type { Palette } from "./types";

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * The runner. The player never rotates in code — the *tunnel* rolls (Camera).
 * So the jump is a simple 1-D motion toward the tunnel centre ("up") and the
 * avatar is drawn glued to the active face, aligned to that face's radial.
 */
export class Player {
  /** continuous (unwrapped) active-face counter; +1 = roll right */
  active = 0;

  /** height above the floor toward the tunnel centre (tunnel units) */
  h = 0;
  vy = 0;
  grounded = true;
  falling = false;

  private coyote = COYOTE_T;
  private jumpBuffer = 0;
  private landingPending = false;

  /** animation */
  runPhase = 0;
  private squash = 0; // landing squash 0..1, decays
  rollFlash = 0; // brief glow on a roll, decays

  reset(startFace: number): void {
    this.active = startFace;
    this.h = 0;
    this.vy = 0;
    this.grounded = true;
    this.falling = false;
    this.coyote = COYOTE_T;
    this.jumpBuffer = 0;
    this.landingPending = false;
    this.runPhase = 0;
    this.squash = 0;
    this.rollFlash = 0;
  }

  faceId(n: number): number {
    return wrap(this.active, n);
  }

  /** radial angle (rolled) of the face the player stands on */
  faceDir(n: number, roll: number): number {
    return (Math.PI * 2 / n) * (this.active + 0.5) + roll;
  }

  /** the roll the camera should chase to put the active face at the bottom */
  rollTarget(n: number): number {
    return -Math.PI / 2 - (Math.PI * 2 / n) * (this.active + 0.5);
  }

  rollLeft(): void {
    this.active -= 1;
    this.rollFlash = 1;
  }
  rollRight(): void {
    this.active += 1;
    this.rollFlash = 1;
  }

  /** request a jump; honours coyote time, else buffers briefly */
  requestJump(): boolean {
    if (this.falling) return false;
    if (this.grounded || this.coyote > 0) {
      this.grounded = false;
      this.coyote = 0;
      this.vy = JUMP_VY;
      this.h = Math.max(this.h, 0.0001);
      this.landingPending = false;
      return true;
    }
    this.jumpBuffer = JUMP_BUFFER_T;
    return false;
  }

  /** integrate physics; returns true on the frame the runner wants to land */
  update(dt: number, speedRings: number): boolean {
    if (this.coyote > 0 && !this.grounded) this.coyote -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);
    if (this.rollFlash > 0) this.rollFlash = Math.max(0, this.rollFlash - dt * 4);

    // running cadence scales gently with speed
    this.runPhase += dt * (7 + speedRings * 0.55);

    if (this.falling) {
      this.vy -= GRAVITY * 2.2 * dt;
      this.h += this.vy * dt; // plunges far negative -> off screen toward void
      return false;
    }

    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.h += this.vy * dt;
      if (this.h <= 0 && this.vy <= 0) {
        this.h = 0;
        this.landingPending = true;
        return true;
      }
    } else {
      this.coyote = COYOTE_T; // refresh while on ground
    }
    return false;
  }

  /** call when the tile under a landing is solid */
  confirmLand(): boolean {
    this.landingPending = false;
    this.grounded = true;
    this.h = 0;
    this.vy = 0;
    this.squash = 1;
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      return this.requestJump(); // chained hop
    }
    return false;
  }

  beginFall(): void {
    this.falling = true;
    this.grounded = false;
    this.vy = Math.min(this.vy, -2);
  }

  /** mark that the runner stepped off solid ground (start coyote countdown) */
  leaveGround(): void {
    if (this.grounded) {
      this.grounded = false;
      this.coyote = COYOTE_T;
    }
  }

  /** unbanked screen position of the floor contact point + the px scale */
  contactScreen(
    cam: Camera,
    n: number,
    ap: number,
  ): { x: number; y: number; scalePx: number; lift: number } {
    const dir = this.faceDir(n, cam.roll);
    const fp = cam.project(ap * Math.cos(dir), ap * Math.sin(dir), Z_PLAYER);
    const scalePx = cam.unit * fp.s;
    return { x: fp.sx, y: fp.sy, scalePx, lift: this.h * scalePx };
  }

  // --- rendering -----------------------------------------------------------

  /**
   * Draw the avatar glued to the active face. Must be called inside the
   * camera's bank transform so the runner leans with the world.
   */
  draw(c: CanvasRenderingContext2D, cam: Camera, n: number, ap: number, pal: Palette): void {
    const dir = this.faceDir(n, cam.roll);
    const fx = ap * Math.cos(dir);
    const fy = ap * Math.sin(dir);
    const fp = cam.project(fx, fy, Z_PLAYER);
    const scalePx = cam.unit * fp.s;

    const radial = Math.atan2(fp.sy - cam.cy, fp.sx - cam.cx);
    const lift = this.h * scalePx;

    c.save();
    c.translate(fp.sx, fp.sy);
    c.rotate(radial - Math.PI / 2); // local frame: +y outward (down), -y up

    // ground shadow (stays on the floor, shrinks as runner rises)
    const shadowK = Math.max(0.12, Math.min(1, 1 - this.h * 1.4));
    c.fillStyle = `rgba(0,0,0,${0.45 * shadowK})`;
    c.beginPath();
    c.ellipse(0, 0, scalePx * 0.26 * shadowK, scalePx * 0.1 * shadowK, 0, 0, Math.PI * 2);
    c.fill();

    // move up to the body root (negative y is "up" toward tunnel centre)
    c.translate(0, -lift);

    const S = scalePx * 0.37; // overall avatar height scale
    const squash = this.squash;
    const bodyScaleY = 1 - squash * 0.28;
    const bodyScaleX = 1 + squash * 0.22;

    // run cycle
    const airborne = !this.grounded && !this.falling;
    const swing = airborne ? 0.5 : Math.sin(this.runPhase) * 0.7;
    const swing2 = airborne ? -0.7 : Math.sin(this.runPhase + Math.PI) * 0.7;
    const bob = airborne ? 0 : Math.abs(Math.sin(this.runPhase)) * S * 0.05;

    const glow = pal.playerGlow;
    const flash = this.rollFlash;

    c.save();
    c.translate(0, -bob);
    c.scale(bodyScaleX, bodyScaleY);

    // neon glow setup
    c.shadowBlur = scalePx * (0.22 + flash * 0.25);
    c.shadowColor = glow;
    c.lineCap = "round";
    c.lineJoin = "round";

    const hipY = -S * 0.62;
    const headY = -S * 1.28;
    const legLen = S * 0.62;
    const armLen = S * 0.5;
    const lw = S * 0.16;

    // --- legs ---
    c.strokeStyle = pal.player;
    c.lineWidth = lw;
    // back leg
    drawLimb(c, 0, hipY, swing2, legLen, 0.6);
    // front leg
    drawLimb(c, 0, hipY, swing, legLen, 0.6);

    // --- torso ---
    c.beginPath();
    c.moveTo(0, hipY);
    c.lineTo(0, headY + S * 0.18);
    c.lineWidth = lw * 1.25;
    c.stroke();

    // --- arms ---
    const shoulderY = headY + S * 0.28;
    c.lineWidth = lw * 0.85;
    drawLimb(c, 0, shoulderY, -swing * 0.9, armLen, 0.55);
    drawLimb(c, 0, shoulderY, -swing2 * 0.9, armLen, 0.55);

    // --- head (glowing core) ---
    const headR = S * 0.2;
    const grd = c.createRadialGradient(0, headY, headR * 0.2, 0, headY, headR);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.55, pal.player);
    grd.addColorStop(1, glow);
    c.fillStyle = grd;
    c.beginPath();
    c.arc(0, headY, headR, 0, Math.PI * 2);
    c.fill();

    // bright core spark at chest
    c.shadowBlur = scalePx * 0.3;
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath();
    c.arc(0, hipY - S * 0.32, S * 0.12 * (1 + flash * 0.5), 0, Math.PI * 2);
    c.fill();

    c.restore();
    c.restore();
  }
}

/** draw a two-segment limb swinging by `ang` from a pivot */
function drawLimb(
  c: CanvasRenderingContext2D,
  px: number,
  py: number,
  ang: number,
  len: number,
  kneeBias: number,
) {
  const kneeX = px + Math.sin(ang) * len * kneeBias;
  const kneeY = py + Math.cos(ang) * len * kneeBias;
  const footX = kneeX + Math.sin(ang * 0.4) * len * (1 - kneeBias);
  const footY = kneeY + Math.cos(ang * 0.4) * len * (1 - kneeBias);
  c.beginPath();
  c.moveTo(px, py);
  c.lineTo(kneeX, kneeY);
  c.lineTo(footX, footY);
  c.stroke();
}
