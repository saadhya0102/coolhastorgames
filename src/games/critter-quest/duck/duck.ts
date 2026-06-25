import type { SaveData } from "./save";
import { equippedHat, growthStage } from "./save";
import type { HatKind } from "./save";
import { darken, lighten, rgba } from "./theme";

const TAU = Math.PI * 2;

export type DuckPose = "idle" | "run" | "swim" | "fly" | "cheer";

export interface DuckLook {
  body: string;
  bodyShade: string;
  belly: string;
  beak: string;
  beakShade: string;
  feet: string;
  cheek: string;
  hat: HatKind;
  hatColor: string;
  stage: number;
}

export interface DuckOpts {
  pose: DuckPose;
  /** ambient time accumulator (blink/bob/breathe) */
  t: number;
  /** gait phase (loops 0..1) for run/swim legs */
  phase?: number;
  /** 0..1 wing flap progress for fly */
  flap?: number;
  /** body pitch in radians (fly) */
  pitch?: number;
  /** face left */
  flip?: boolean;
  /** 0..1 beak open amount */
  beakOpen?: number;
  /** glance direction, -1 back .. +1 forward */
  glance?: number;
  /** draw soft ground shadow */
  shadow?: boolean;
  /** force blink amount 0..1 */
  blink?: number;
  /** squash/stretch multiplier on Y (e.g. landing) */
  squash?: number;
}

export function defaultLook(): DuckLook {
  return {
    body: "#ffd23f",
    bodyShade: "#f0b81e",
    belly: "#ffe487",
    beak: "#ff9f1c",
    beakShade: "#e87c0c",
    feet: "#ff9f1c",
    cheek: "#ff9a7a",
    hat: "none",
    hatColor: "#fff",
    stage: 0,
  };
}

const AI_COLORS: { body: string; shade: string; belly: string }[] = [
  { body: "#ffffff", shade: "#d8dde8", belly: "#f3f5fb" }, // white duck
  { body: "#b6e36a", shade: "#8fc043", belly: "#d6f0a4" }, // green
  { body: "#ff9ec4", shade: "#e873a3", belly: "#ffd0e3" }, // pink
  { body: "#8ec9ff", shade: "#5ba3e8", belly: "#c3e4ff" }, // blue
  { body: "#c8a2ff", shade: "#a276e0", belly: "#e4d2ff" }, // purple
  { body: "#ffc06a", shade: "#e89a3a", belly: "#ffdca6" }, // orange
];

/** Look for an AI rival (no hat) keyed by index. */
export function aiLook(index: number, stage = 2): DuckLook {
  const col = AI_COLORS[index % AI_COLORS.length];
  return {
    body: col.body,
    bodyShade: col.shade,
    belly: col.belly,
    beak: "#ff9f1c",
    beakShade: "#e87c0c",
    feet: "#ff9f1c",
    cheek: rgba("#ff7a7a", 0.5),
    hat: "none",
    hatColor: "#fff",
    stage,
  };
}

/** Build the player's look from the save (color saturates slightly with growth). */
export function lookFromSave(save: SaveData): DuckLook {
  const look = defaultLook();
  look.stage = growthStage(save);
  // mature ducks get a slightly richer plumage
  const sat = look.stage * 0.04;
  look.body = lighten("#ffce2e", sat);
  look.bodyShade = darken("#ffce2e", 0.14 + sat);
  look.belly = lighten("#ffce2e", 0.32);
  const hat = equippedHat(save);
  if (hat) {
    look.hat = hat.hat;
    look.hatColor = hat.color;
  }
  return look;
}

/** Scale factor that grows with stage (used by callers as a multiplier). */
export function growthScale(stage: number): number {
  return 0.82 + stage * 0.06;
}

function autoBlink(t: number): number {
  const cycle = 3.1;
  const p = t % cycle;
  if (p > cycle - 0.14) return Math.sin(((p - (cycle - 0.14)) / 0.14) * Math.PI);
  return 0;
}

/**
 * Draw the duck centered at (x, y). `unit` is roughly the body half-height in px.
 * All sub-parts scale from `unit`, so the duck grows simply by passing a larger
 * unit. Faces right unless `opts.flip`.
 */
export function drawDuck(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  look: DuckLook,
  opts: DuckOpts,
): void {
  const {
    pose,
    t,
    phase = 0,
    flap = 0,
    pitch = 0,
    flip = false,
    beakOpen = 0,
    glance = 0,
    shadow = true,
    squash = 1,
  } = opts;
  const blink = opts.blink ?? autoBlink(t);

  // ambient vertical bob + breathing
  let bob = 0;
  let breathe = 1;
  if (pose === "idle") {
    bob = Math.sin(t * 2) * unit * 0.05;
    breathe = 1 + Math.sin(t * 2) * 0.02;
  } else if (pose === "run") {
    bob = -Math.abs(Math.sin(phase * TAU)) * unit * 0.12;
  } else if (pose === "swim") {
    bob = Math.sin(t * 3) * unit * 0.04;
  } else if (pose === "cheer") {
    bob = -Math.abs(Math.sin(t * 6)) * unit * 0.18;
  }

  // ground shadow (skip for swim/fly which sit on their own surface)
  if (shadow && pose !== "fly" && pose !== "swim") {
    const sw = unit * 1.5 * (pose === "run" ? 1 + Math.sin(phase * TAU) * 0.12 : 1);
    c.save();
    c.fillStyle = rgba("#1a2030", 0.18);
    c.beginPath();
    c.ellipse(x, y + unit * 1.18, sw, unit * 0.28, 0, 0, TAU);
    c.fill();
    c.restore();
  }

  c.save();
  c.translate(x, y + bob);
  if (flip) c.scale(-1, 1);
  if (pose === "fly") c.rotate(pitch);
  c.scale(1, squash * breathe);

  drawLegs(c, unit, look, pose, phase, t);
  drawTail(c, unit, look, t, pose);
  drawBackWing(c, unit, look, pose, flap, t);
  drawBody(c, unit, look);
  drawFrontWing(c, unit, look, pose, flap, t, phase);
  drawHead(c, unit, look, pose, t, blink, beakOpen, glance);
  drawHat(c, unit, look);

  c.restore();
}

function drawBody(c: CanvasRenderingContext2D, u: number, look: DuckLook): void {
  // main body
  c.fillStyle = look.body;
  c.beginPath();
  c.ellipse(0, u * 0.15, u * 0.95, u * 0.82, 0, 0, TAU);
  c.fill();
  // shaded underside
  c.fillStyle = look.bodyShade;
  c.beginPath();
  c.ellipse(-u * 0.05, u * 0.4, u * 0.85, u * 0.5, 0, 0, Math.PI);
  c.fill();
  // belly highlight
  c.fillStyle = look.belly;
  c.beginPath();
  c.ellipse(u * 0.18, u * 0.28, u * 0.55, u * 0.5, 0, 0, TAU);
  c.fill();
}

function drawHead(
  c: CanvasRenderingContext2D,
  u: number,
  look: DuckLook,
  pose: DuckPose,
  t: number,
  blink: number,
  beakOpen: number,
  glance: number,
): void {
  const hx = u * 0.55;
  const hy = -u * 0.62 + (pose === "idle" ? Math.sin(t * 2 + 1) * u * 0.03 : 0);
  const hr = u * 0.62;

  // crest feather for grown ducks
  if (look.stage >= 2) {
    c.strokeStyle = look.bodyShade;
    c.lineWidth = u * 0.12;
    c.lineCap = "round";
    const sway = Math.sin(t * 3) * 0.2;
    c.beginPath();
    c.moveTo(hx - hr * 0.1, hy - hr * 0.85);
    c.quadraticCurveTo(hx - hr * 0.4, hy - hr * 1.5, hx - hr * 0.1 + sway * u, hy - hr * 1.7);
    c.stroke();
    if (look.stage >= 4) {
      c.beginPath();
      c.moveTo(hx + hr * 0.1, hy - hr * 0.85);
      c.quadraticCurveTo(hx + hr * 0.25, hy - hr * 1.4, hx + hr * 0.35 + sway * u, hy - hr * 1.55);
      c.stroke();
    }
  }

  // head
  c.fillStyle = look.body;
  c.beginPath();
  c.arc(hx, hy, hr, 0, TAU);
  c.fill();
  // cheek
  c.fillStyle = look.cheek;
  c.beginPath();
  c.arc(hx + hr * 0.35, hy + hr * 0.35, hr * 0.26, 0, TAU);
  c.fill();

  // beak (two parts)
  const bx = hx + hr * 0.72;
  const by = hy + hr * 0.12;
  const bw = hr * 0.85;
  const bh = hr * 0.4;
  c.fillStyle = look.beakShade;
  c.beginPath();
  c.ellipse(bx + bw * 0.18, by + bh * (0.4 + beakOpen * 0.5), bw * 0.6, bh * 0.45, 0, 0, TAU);
  c.fill();
  c.fillStyle = look.beak;
  c.beginPath();
  c.ellipse(bx, by - bh * beakOpen * 0.4, bw * 0.62, bh * 0.5, 0, 0, TAU);
  c.fill();

  // eye
  const ex = hx + hr * 0.34;
  const ey = hy - hr * 0.22;
  const er = hr * 0.3;
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.ellipse(ex, ey, er, er * (1 - blink * 0.9), 0, 0, TAU);
  c.fill();
  if (blink < 0.85) {
    const px = ex + glance * er * 0.5;
    c.fillStyle = "#222a3a";
    c.beginPath();
    c.arc(px, ey, er * 0.55, 0, TAU);
    c.fill();
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(px + er * 0.18, ey - er * 0.2, er * 0.22, 0, TAU);
    c.fill();
  } else {
    c.strokeStyle = look.bodyShade;
    c.lineWidth = u * 0.05;
    c.beginPath();
    c.moveTo(ex - er, ey);
    c.lineTo(ex + er, ey);
    c.stroke();
  }
}

function drawTail(
  c: CanvasRenderingContext2D,
  u: number,
  look: DuckLook,
  t: number,
  pose: DuckPose,
): void {
  const flick = pose === "swim" ? Math.sin(t * 6) * 0.18 : Math.sin(t * 2) * 0.06;
  c.save();
  c.translate(-u * 0.85, -u * 0.05);
  c.rotate(flick);
  c.fillStyle = look.bodyShade;
  c.beginPath();
  c.moveTo(0, u * 0.1);
  c.quadraticCurveTo(-u * 0.7, -u * 0.25, -u * 0.55, u * 0.05);
  c.quadraticCurveTo(-u * 0.75, u * 0.05, -u * 0.5, u * 0.32);
  c.quadraticCurveTo(-u * 0.3, u * 0.3, 0, u * 0.35);
  c.closePath();
  c.fill();
  c.restore();
}

function drawBackWing(
  c: CanvasRenderingContext2D,
  u: number,
  look: DuckLook,
  pose: DuckPose,
  flap: number,
  t: number,
): void {
  if (pose !== "fly") return;
  // far wing, behind body, opposite phase
  const ang = -0.5 + Math.sin(flap * TAU + Math.PI) * 0.9;
  c.save();
  c.translate(-u * 0.1, -u * 0.15);
  c.rotate(ang);
  c.fillStyle = darken(look.bodyShade, 0.12);
  wingShape(c, u * 0.95);
  c.fill();
  c.restore();
  void t;
}

function drawFrontWing(
  c: CanvasRenderingContext2D,
  u: number,
  look: DuckLook,
  pose: DuckPose,
  flap: number,
  t: number,
  phase: number,
): void {
  c.save();
  c.translate(u * 0.05, -u * 0.05);
  if (pose === "fly") {
    const ang = -0.5 + Math.sin(flap * TAU) * 0.95;
    c.rotate(ang);
    c.fillStyle = look.body;
    wingShape(c, u * 1.05);
    c.fill();
    c.fillStyle = rgba("#ffffff", 0.3);
    wingShape(c, u * 0.6);
    c.fill();
  } else if (pose === "run" || pose === "cheer") {
    const ang = pose === "cheer" ? -1.1 : Math.sin(phase * TAU) * 0.5 - 0.2;
    c.rotate(ang);
    c.fillStyle = look.body;
    wingShape(c, u * 0.7);
    c.fill();
  } else {
    // tucked wing on body
    const wob = Math.sin(t * 2) * 0.04;
    c.rotate(wob);
    c.fillStyle = look.bodyShade;
    c.beginPath();
    c.ellipse(u * 0.05, u * 0.2, u * 0.5, u * 0.42, 0.4, 0, TAU);
    c.fill();
    c.fillStyle = rgba("#ffffff", 0.18);
    c.beginPath();
    c.ellipse(u * 0.12, u * 0.12, u * 0.28, u * 0.22, 0.4, 0, TAU);
    c.fill();
  }
  c.restore();
}

function wingShape(c: CanvasRenderingContext2D, len: number): void {
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(len * 0.6, -len * 0.15, len, len * 0.05);
  c.quadraticCurveTo(len * 0.7, len * 0.3, len * 0.3, len * 0.4);
  c.quadraticCurveTo(len * 0.05, len * 0.3, 0, 0);
  c.closePath();
}

function drawLegs(
  c: CanvasRenderingContext2D,
  u: number,
  look: DuckLook,
  pose: DuckPose,
  phase: number,
  t: number,
): void {
  if (pose === "fly") {
    // tucked-back legs
    c.strokeStyle = look.feet;
    c.lineWidth = u * 0.14;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-u * 0.2, u * 0.7);
    c.lineTo(-u * 0.7, u * 0.95);
    c.stroke();
    drawFoot(c, -u * 0.7, u * 0.95, look.feet, u * 0.45, 0.6);
    return;
  }
  if (pose === "swim") {
    // paddling feet under the body, circular alternating
    for (let i = 0; i < 2; i++) {
      const pp = phase + i * 0.5;
      const cx = -u * 0.1 + i * u * 0.4;
      const px = cx + Math.cos(pp * TAU) * u * 0.3;
      const py = u * 0.95 + Math.sin(pp * TAU) * u * 0.18;
      c.strokeStyle = look.feet;
      c.lineWidth = u * 0.13;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(cx, u * 0.7);
      c.lineTo(px, py);
      c.stroke();
      drawFoot(c, px, py, look.feet, u * 0.4, -0.3 + Math.cos(pp * TAU) * 0.4);
    }
    return;
  }
  if (pose === "run") {
    for (let i = 0; i < 2; i++) {
      const pp = phase + i * 0.5;
      const swing = Math.sin(pp * TAU);
      const lift = Math.max(0, Math.cos(pp * TAU));
      drawLeg(c, u * 0.15 - i * u * 0.15, u * 0.65, swing, lift, look.feet, u);
    }
    return;
  }
  // idle / cheer: two little legs
  const wob = pose === "cheer" ? 0 : Math.sin(t * 2) * 0.04;
  for (let i = 0; i < 2; i++) {
    const lx = -u * 0.05 + i * u * 0.45;
    c.strokeStyle = look.feet;
    c.lineWidth = u * 0.14;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(lx, u * 0.8);
    c.lineTo(lx, u * 1.12);
    c.stroke();
    drawFoot(c, lx, u * 1.12, look.feet, u * 0.42, wob);
  }
}

function drawLeg(
  c: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  swing: number,
  lift: number,
  color: string,
  u: number,
): void {
  const footX = hipX + swing * u * 0.5;
  const footY = hipY + u * 0.5 - lift * u * 0.25;
  const kneeX = (hipX + footX) / 2 + u * 0.04;
  const kneeY = (hipY + footY) / 2;
  c.strokeStyle = color;
  c.lineWidth = u * 0.15;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(hipX, hipY);
  c.lineTo(kneeX, kneeY);
  c.lineTo(footX, footY);
  c.stroke();
  drawFoot(c, footX, footY, color, u * 0.42, swing * 0.5);
}

function drawFoot(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
  tilt: number,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(tilt);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(-size * 0.1, 0);
  c.lineTo(size, -size * 0.18);
  c.lineTo(size, size * 0.18);
  c.closePath();
  c.fill();
  c.restore();
}

function drawHat(c: CanvasRenderingContext2D, u: number, look: DuckLook): void {
  if (look.hat === "none") return;
  const hx = u * 0.55;
  const hy = -u * 0.62;
  const hr = u * 0.62;
  const col = look.hatColor;
  c.save();
  if (look.hat === "cap") {
    c.fillStyle = col;
    c.beginPath();
    c.arc(hx, hy - hr * 0.55, hr * 0.78, Math.PI, TAU);
    c.fill();
    c.fillRect(hx - hr * 0.78, hy - hr * 0.58, hr * 1.56, hr * 0.12);
    // brim forward
    c.beginPath();
    c.ellipse(hx + hr * 0.7, hy - hr * 0.5, hr * 0.5, hr * 0.16, 0, 0, TAU);
    c.fill();
  } else if (look.hat === "goggles") {
    c.strokeStyle = darken(col, 0.2);
    c.lineWidth = u * 0.1;
    c.beginPath();
    c.moveTo(hx - hr * 0.5, hy - hr * 0.2);
    c.lineTo(hx + hr * 0.7, hy - hr * 0.2);
    c.stroke();
    c.fillStyle = rgba("#ffffff", 0.55);
    c.strokeStyle = col;
    c.lineWidth = u * 0.08;
    for (const dx of [0.0, 0.62]) {
      c.beginPath();
      c.arc(hx + hr * (0.05 + dx), hy - hr * 0.18, hr * 0.3, 0, TAU);
      c.fill();
      c.stroke();
    }
  } else if (look.hat === "aviator") {
    c.fillStyle = col;
    c.beginPath();
    c.arc(hx, hy - hr * 0.15, hr * 0.95, Math.PI * 1.05, TAU * 1.02);
    c.fill();
    c.fillRect(hx - hr * 0.95, hy - hr * 0.25, hr * 1.9, hr * 0.5);
    // ear flaps
    c.beginPath();
    c.arc(hx - hr * 0.85, hy + hr * 0.1, hr * 0.28, 0, TAU);
    c.arc(hx + hr * 0.85, hy + hr * 0.1, hr * 0.28, 0, TAU);
    c.fill();
    c.fillStyle = rgba("#ffffff", 0.6);
    c.beginPath();
    c.arc(hx - hr * 0.1, hy - hr * 0.35, hr * 0.22, 0, TAU);
    c.fill();
  } else if (look.hat === "visor") {
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(hx + hr * 0.55, hy - hr * 0.35, hr * 0.7, hr * 0.2, 0, 0, TAU);
    c.fill();
    c.fillRect(hx - hr * 0.6, hy - hr * 0.45, hr * 1.2, hr * 0.16);
  } else if (look.hat === "crown") {
    c.fillStyle = col;
    const cw = hr * 1.1;
    const cy = hy - hr * 0.6;
    c.beginPath();
    c.moveTo(hx - cw / 2, cy + hr * 0.35);
    c.lineTo(hx - cw / 2, cy);
    c.lineTo(hx - cw * 0.25, cy + hr * 0.18);
    c.lineTo(hx, cy - hr * 0.18);
    c.lineTo(hx + cw * 0.25, cy + hr * 0.18);
    c.lineTo(hx + cw / 2, cy);
    c.lineTo(hx + cw / 2, cy + hr * 0.35);
    c.closePath();
    c.fill();
    c.fillStyle = "#ff5b6e";
    c.beginPath();
    c.arc(hx, cy + hr * 0.12, hr * 0.1, 0, TAU);
    c.fill();
  }
  c.restore();
}
