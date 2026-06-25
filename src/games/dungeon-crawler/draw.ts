import {
  COLS,
  ROWS,
  COL,
  DOOR_HALF,
  DIRS,
  type Dir,
} from "./config";
import type { Enemy, RoomDef, RoomType } from "./types";

/** Screen transform: room tile-space -> CSS pixels. Recomputed each frame. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
  /** floor-theme hue shift index (per floor) */
  theme: number;
}

type C = CanvasRenderingContext2D;

export const sx = (v: View, x: number) => v.ox + x * v.scale;
export const sy = (v: View, y: number) => v.oy + y * v.scale;

/** Shift a hex color's lightness by mixing toward white/black. cheap. */
function mix(hex: string, target: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(target);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Per-floor theme tint for floor tiles. */
function themeTint(theme: number): number {
  return ((theme - 1) % 5) / 5;
}

export function drawRoom(
  c: C,
  v: View,
  room: RoomDef,
  t: number,
  doorOpen: boolean,
) {
  const scale = v.scale;
  const tint = themeTint(v.theme);
  const floorA = mix(COL.floorA, "#3a1f2c", tint * 0.7);
  const floorB = mix(COL.floorB, "#42283a", tint * 0.7);

  // outer letterbox backdrop
  // (caller paints full-canvas bg already)

  // floor tiles (interior + under walls for seamless look)
  for (let gx = 0; gx < COLS; gx++) {
    for (let gy = 0; gy < ROWS; gy++) {
      const px = sx(v, gx);
      const py = sy(v, gy);
      c.fillStyle = (gx + gy) % 2 === 0 ? floorA : floorB;
      c.fillRect(px, py, scale + 1, scale + 1);
    }
  }
  // speckle detail (deterministic by tile)
  c.fillStyle = COL.floorSpeck;
  for (let gx = 1; gx < COLS - 1; gx++) {
    for (let gy = 1; gy < ROWS - 1; gy++) {
      const h = (gx * 928371 + gy * 12389) % 7;
      if (h === 0) {
        c.globalAlpha = 0.5;
        c.fillRect(sx(v, gx + 0.3), sy(v, gy + 0.6), scale * 0.12, scale * 0.12);
      } else if (h === 3) {
        c.globalAlpha = 0.35;
        c.fillRect(sx(v, gx + 0.65), sy(v, gy + 0.25), scale * 0.1, scale * 0.1);
      }
    }
  }
  c.globalAlpha = 1;

  // walls
  drawWalls(c, v, room, doorOpen, t);
}

function drawWalls(c: C, v: View, room: RoomDef, doorOpen: boolean, t: number) {
  const scale = v.scale;
  const w = COLS * scale;
  const h = ROWS * scale;
  const th = scale; // wall thickness 1 tile

  c.fillStyle = COL.wall;
  // top, bottom, left, right bands
  c.fillRect(v.ox, v.oy, w, th);
  c.fillRect(v.ox, v.oy + h - th, w, th);
  c.fillRect(v.ox, v.oy, th, h);
  c.fillRect(v.ox + w - th, v.oy, th, h);

  // wall top highlight bevel
  c.fillStyle = COL.wallTop;
  c.fillRect(v.ox, v.oy, w, th * 0.18);
  c.fillStyle = COL.wallEdge;
  c.fillRect(v.ox, v.oy + th - th * 0.16, w, th * 0.16);
  c.fillRect(v.ox, v.oy + h - th, w, th * 0.16);

  // carve + draw doors
  for (const d of DIRS) {
    if (!room.doors[d]) continue;
    drawDoor(c, v, room, d, doorOpen);
  }

  // torch sconces near corners
  drawTorch(c, v.ox + th * 1.2, v.oy + th * 1.1, scale, t);
  drawTorch(c, v.ox + w - th * 1.2, v.oy + th * 1.1, scale, t + 1.3);
}

function doorColor(type: RoomType): string {
  switch (type) {
    case "boss":
      return COL.bossDoor;
    case "treasure":
      return COL.treasureDoor;
    case "shop":
      return COL.shopDoor;
    default:
      return COL.doorFrame;
  }
}

/** Draw a door opening on wall `d`. neighborType colors special doors. */
function drawDoor(
  c: C,
  v: View,
  room: RoomDef,
  d: Dir,
  open: boolean,
) {
  const scale = v.scale;
  const cx = COLS / 2;
  const cy = ROWS / 2;
  const half = DOOR_HALF;
  // door spans across the wall band
  let x = 0;
  let y = 0;
  let dw = 0;
  let dh = 0;
  if (d === "N") {
    x = sx(v, cx - half);
    y = v.oy;
    dw = half * 2 * scale;
    dh = scale;
  } else if (d === "S") {
    x = sx(v, cx - half);
    y = v.oy + (ROWS - 1) * scale;
    dw = half * 2 * scale;
    dh = scale;
  } else if (d === "W") {
    x = v.ox;
    y = sy(v, cy - half);
    dw = scale;
    dh = half * 2 * scale;
  } else {
    x = v.ox + (COLS - 1) * scale;
    y = sy(v, cy - half);
    dw = scale;
    dh = half * 2 * scale;
  }

  // opening (dark)
  c.fillStyle = COL.doorOpen;
  c.fillRect(x, y, dw, dh);
  // frame
  const col = doorColor(room.type);
  c.fillStyle = col;
  const fb = scale * 0.12;
  c.fillRect(x, y, dw, fb);
  c.fillRect(x, y + dh - fb, dw, fb);
  c.fillRect(x, y, fb, dh);
  c.fillRect(x + dw - fb, y, fb, dh);

  if (!open) {
    // locked bars
    c.fillStyle = COL.doorBar;
    if (d === "N" || d === "S") {
      for (let i = 0; i < 3; i++) {
        c.fillRect(x + dw * (0.2 + i * 0.3), y, dw * 0.08, dh);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        c.fillRect(x, y + dh * (0.2 + i * 0.3), dw, dh * 0.08);
      }
    }
  }
}

function drawTorch(c: C, x: number, y: number, scale: number, t: number) {
  c.fillStyle = "#2a1c12";
  c.fillRect(x - scale * 0.05, y, scale * 0.1, scale * 0.35);
  const flick = 0.7 + 0.3 * Math.sin(t * 12) + 0.15 * Math.sin(t * 27);
  const r = scale * 0.18 * flick;
  const g = c.createRadialGradient(x, y - r * 0.4, 0, x, y - r * 0.4, r * 2.4);
  g.addColorStop(0, "rgba(255,220,120,0.9)");
  g.addColorStop(0.5, "rgba(255,140,40,0.5)");
  g.addColorStop(1, "rgba(255,80,20,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y - r * 0.4, r * 2.4, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ffd66b";
  c.beginPath();
  c.ellipse(x, y - r * 0.5, r * 0.5, r, 0, 0, Math.PI * 2);
  c.fill();
}

/* ---------------------------------------------------------------- player */

export function drawPlayer(
  c: C,
  px: number,
  py: number,
  pr: number,
  face: number,
  bob: number,
  flash: number,
  invuln: boolean,
  t: number,
) {
  if (invuln && Math.floor(t * 18) % 2 === 0) return;
  c.save();
  c.translate(px, py + bob);

  // shadow
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath();
  c.ellipse(0, pr * 0.95, pr * 0.95, pr * 0.4, 0, 0, Math.PI * 2);
  c.fill();

  // body (hooded cloak)
  const body = flash > 0 ? COL.white : COL.player;
  c.fillStyle = body;
  c.beginPath();
  c.arc(0, 0, pr, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = flash > 0 ? COL.white : COL.playerDark;
  c.beginPath();
  c.arc(0, pr * 0.25, pr * 0.95, 0, Math.PI);
  c.fill();

  // hood opening / face direction
  const fx = Math.cos(face);
  const fy = Math.sin(face);
  c.fillStyle = "#0a1822";
  c.beginPath();
  c.arc(fx * pr * 0.35, fy * pr * 0.35 - pr * 0.1, pr * 0.5, 0, Math.PI * 2);
  c.fill();
  // glowing eyes
  c.fillStyle = COL.playerLantern;
  c.beginPath();
  c.arc(
    fx * pr * 0.45 - fy * pr * 0.18,
    fy * pr * 0.45 + fx * pr * 0.18 - pr * 0.12,
    pr * 0.12,
    0,
    Math.PI * 2,
  );
  c.arc(
    fx * pr * 0.45 + fy * pr * 0.18,
    fy * pr * 0.45 - fx * pr * 0.18 - pr * 0.12,
    pr * 0.12,
    0,
    Math.PI * 2,
  );
  c.fill();

  // lantern glow halo
  const g = c.createRadialGradient(0, 0, pr * 0.4, 0, 0, pr * 2.4);
  g.addColorStop(0, "rgba(255,214,107,0.18)");
  g.addColorStop(1, "rgba(255,214,107,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, pr * 2.4, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

/* ---------------------------------------------------------------- enemies */

export function drawEnemy(c: C, e: Enemy, px: number, py: number, pr: number, t: number) {
  switch (e.kind) {
    case "crawler":
      return drawCrawler(c, px, py, pr, e.flash, t);
    case "spitter":
      return drawSpitter(c, px, py, pr, e.flash, e.face, t);
    case "blob":
    case "blobSmall":
      return drawBlob(c, px, py, pr, e.flash, t);
    case "floater":
      return drawFloater(c, px, py, pr, e.flash, t);
    case "boss":
      return drawBoss(c, px, py, pr, e, t);
  }
}

function shadow(c: C, px: number, py: number, pr: number) {
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath();
  c.ellipse(px, py + pr * 0.9, pr * 0.9, pr * 0.36, 0, 0, Math.PI * 2);
  c.fill();
}

function drawCrawler(c: C, px: number, py: number, pr: number, flash: number, t: number) {
  shadow(c, px, py, pr);
  const wob = Math.sin(t * 10 + px) * pr * 0.12;
  const body = flash > 0 ? COL.white : COL.crawler;
  // 6 little legs
  c.strokeStyle = flash > 0 ? COL.white : COL.crawlerDark;
  c.lineWidth = Math.max(1.5, pr * 0.16);
  for (let i = 0; i < 3; i++) {
    const ly = py - pr * 0.3 + i * pr * 0.4;
    const sw = Math.sin(t * 12 + i) * pr * 0.3;
    c.beginPath();
    c.moveTo(px - pr * 0.7, ly);
    c.lineTo(px - pr * 1.15, ly + sw);
    c.moveTo(px + pr * 0.7, ly);
    c.lineTo(px + pr * 1.15, ly - sw);
    c.stroke();
  }
  c.fillStyle = body;
  c.beginPath();
  c.ellipse(px, py + wob, pr * 0.9, pr, 0, 0, Math.PI * 2);
  c.fill();
  // mandible eyes
  c.fillStyle = "#1a2a14";
  c.beginPath();
  c.arc(px - pr * 0.32, py - pr * 0.2 + wob, pr * 0.18, 0, Math.PI * 2);
  c.arc(px + pr * 0.32, py - pr * 0.2 + wob, pr * 0.18, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#d6ff8a";
  c.beginPath();
  c.arc(px - pr * 0.3, py - pr * 0.22 + wob, pr * 0.08, 0, Math.PI * 2);
  c.arc(px + pr * 0.34, py - pr * 0.22 + wob, pr * 0.08, 0, Math.PI * 2);
  c.fill();
}

function drawSpitter(c: C, px: number, py: number, pr: number, flash: number, face: number, t: number) {
  shadow(c, px, py, pr);
  const body = flash > 0 ? COL.white : COL.spitter;
  c.fillStyle = flash > 0 ? COL.white : COL.spitterDark;
  // tentacles
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + t * 0.5;
    const tl = pr * (0.9 + 0.2 * Math.sin(t * 6 + i));
    c.beginPath();
    c.moveTo(px, py + pr * 0.3);
    c.lineWidth = Math.max(1.5, pr * 0.18);
    c.strokeStyle = flash > 0 ? COL.white : COL.spitterDark;
    c.lineTo(px + Math.cos(a) * tl, py + pr * 0.3 + Math.abs(Math.sin(a)) * tl);
    c.stroke();
  }
  c.fillStyle = body;
  c.beginPath();
  c.arc(px, py, pr * 0.85, Math.PI, Math.PI * 2);
  c.arc(px, py, pr * 0.85, 0, Math.PI);
  c.fill();
  c.beginPath();
  c.ellipse(px, py - pr * 0.1, pr * 0.85, pr * 0.9, 0, 0, Math.PI * 2);
  c.fill();
  // single glowing eye aimed at target
  const ex = Math.cos(face) * pr * 0.35;
  const ey = Math.sin(face) * pr * 0.35;
  c.fillStyle = "#1a0f24";
  c.beginPath();
  c.arc(px, py - pr * 0.1, pr * 0.42, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ff5470";
  c.beginPath();
  c.arc(px + ex, py - pr * 0.1 + ey, pr * 0.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ffd0d8";
  c.beginPath();
  c.arc(px + ex, py - pr * 0.1 + ey, pr * 0.08, 0, Math.PI * 2);
  c.fill();
}

function drawBlob(c: C, px: number, py: number, pr: number, flash: number, t: number) {
  shadow(c, px, py, pr);
  const squish = 1 + Math.sin(t * 8 + px) * 0.12;
  const body = flash > 0 ? COL.white : COL.blob;
  c.fillStyle = body;
  c.beginPath();
  c.ellipse(px, py, pr / squish, pr * squish, 0, 0, Math.PI * 2);
  c.fill();
  // gloss
  c.fillStyle = "rgba(255,255,255,0.35)";
  c.beginPath();
  c.ellipse(px - pr * 0.3, py - pr * 0.35, pr * 0.22, pr * 0.14, -0.5, 0, Math.PI * 2);
  c.fill();
  // eyes
  c.fillStyle = "#3a1a06";
  c.beginPath();
  c.arc(px - pr * 0.28, py, pr * 0.14, 0, Math.PI * 2);
  c.arc(px + pr * 0.28, py, pr * 0.14, 0, Math.PI * 2);
  c.fill();
}

function drawFloater(c: C, px: number, py: number, pr: number, flash: number, t: number) {
  const body = flash > 0 ? COL.white : COL.floater;
  c.globalAlpha = 0.85;
  c.fillStyle = body;
  c.beginPath();
  c.arc(px, py, pr, Math.PI, 0);
  // wavy bottom
  const segs = 5;
  for (let i = 0; i <= segs; i++) {
    const x = px + pr - (i / segs) * pr * 2;
    const y = py + pr * 0.5 + (i % 2 === 0 ? pr * 0.3 : 0) + Math.sin(t * 6 + i) * pr * 0.1;
    c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = "#13314a";
  c.beginPath();
  c.arc(px - pr * 0.3, py - pr * 0.1, pr * 0.13, 0, Math.PI * 2);
  c.arc(px + pr * 0.3, py - pr * 0.1, pr * 0.13, 0, Math.PI * 2);
  c.fill();
}

function drawBoss(c: C, px: number, py: number, pr: number, e: Enemy, t: number) {
  shadow(c, px, py, pr);
  const charging = e.windup > 0;
  const body = e.flash > 0 ? COL.white : charging ? "#ff9a6a" : COL.boss;
  // crown spikes
  c.fillStyle = e.flash > 0 ? COL.white : COL.bossDark;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI + (i / 5) * Math.PI;
    const bx = px + Math.cos(a) * pr * 0.9;
    const by = py - pr * 0.4 + Math.sin(a) * pr * 0.4;
    c.beginPath();
    c.moveTo(bx - pr * 0.12, by);
    c.lineTo(bx, by - pr * 0.5);
    c.lineTo(bx + pr * 0.12, by);
    c.closePath();
    c.fill();
  }
  // body
  c.fillStyle = body;
  c.beginPath();
  c.ellipse(px, py, pr, pr * 1.05, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = e.flash > 0 ? COL.white : COL.bossDark;
  c.beginPath();
  c.arc(px, py + pr * 0.2, pr * 0.95, 0.1, Math.PI - 0.1);
  c.fill();
  // molten cracks
  c.strokeStyle = "rgba(255,180,60,0.8)";
  c.lineWidth = Math.max(1.5, pr * 0.06);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px + Math.cos(a) * pr * 0.8, py + Math.sin(a) * pr * 0.8);
    c.stroke();
  }
  // eyes
  const eo = pr * 0.32;
  c.fillStyle = "#1a0805";
  c.beginPath();
  c.arc(px - eo, py - pr * 0.2, pr * 0.26, 0, Math.PI * 2);
  c.arc(px + eo, py - pr * 0.2, pr * 0.26, 0, Math.PI * 2);
  c.fill();
  const glow = charging ? "#fff2a0" : COL.bossEye;
  c.fillStyle = glow;
  const blink = 0.7 + 0.3 * Math.sin(t * 5);
  c.beginPath();
  c.arc(px - eo, py - pr * 0.2, pr * 0.13 * blink, 0, Math.PI * 2);
  c.arc(px + eo, py - pr * 0.2, pr * 0.13 * blink, 0, Math.PI * 2);
  c.fill();
}

/* ---------------------------------------------------------------- bullets */

export function drawBullet(
  c: C,
  px: number,
  py: number,
  r: number,
  foe: boolean,
  fade: number,
) {
  c.globalAlpha = fade;
  const glow = foe ? COL.enemyBullet : COL.bullet;
  const core = foe ? COL.enemyBulletCore : COL.bulletCore;
  const g = c.createRadialGradient(px, py, 0, px, py, r * 2.2);
  g.addColorStop(0, glow);
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(px, py, r * 2.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = core;
  c.beginPath();
  c.arc(px, py, r * 0.7, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
}

/* ---------------------------------------------------------------- pickups */

export function drawHeart(c: C, x: number, y: number, s: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  const top = y - s * 0.2;
  c.moveTo(x, y + s * 0.55);
  c.bezierCurveTo(x - s, y - s * 0.1, x - s * 0.5, top - s * 0.55, x, top);
  c.bezierCurveTo(x + s * 0.5, top - s * 0.55, x + s, y - s * 0.1, x, y + s * 0.55);
  c.closePath();
  c.fill();
}

/** Draw a half heart by clipping the left side. */
export function drawHalfHeart(c: C, x: number, y: number, s: number, full: string, empty: string) {
  drawHeart(c, x, y, s, empty);
  c.save();
  c.beginPath();
  c.rect(x - s * 1.2, y - s * 1.2, s * 1.2, s * 2.4);
  c.clip();
  drawHeart(c, x, y, s, full);
  c.restore();
}

export function drawCoin(c: C, x: number, y: number, s: number, t: number) {
  const w = Math.abs(Math.cos(t * 3)) * s + s * 0.3;
  c.fillStyle = "#a87a16";
  c.beginPath();
  c.ellipse(x, y, w, s, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = COL.coin;
  c.beginPath();
  c.ellipse(x, y - s * 0.08, w * 0.92, s * 0.92, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff0b0";
  c.beginPath();
  c.ellipse(x - w * 0.3, y - s * 0.3, w * 0.25, s * 0.3, 0, 0, Math.PI * 2);
  c.fill();
}

export function drawPedestal(c: C, x: number, y: number, s: number, t: number) {
  // stone base
  c.fillStyle = "#2a2336";
  c.beginPath();
  c.ellipse(x, y + s * 0.7, s * 0.7, s * 0.28, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#3a3048";
  c.fillRect(x - s * 0.4, y - s * 0.1, s * 0.8, s * 0.8);
  // glow
  const float = Math.sin(t * 2) * s * 0.12;
  const g = c.createRadialGradient(x, y - s * 0.3 + float, 0, x, y - s * 0.3 + float, s * 1.6);
  g.addColorStop(0, "rgba(255,233,168,0.5)");
  g.addColorStop(1, "rgba(255,233,168,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y - s * 0.3 + float, s * 1.6, 0, Math.PI * 2);
  c.fill();
  return y - s * 0.3 + float;
}

/** A small generic "rune item" glyph used for item pickups. */
export function drawItemGlyph(c: C, x: number, y: number, s: number, id: string) {
  c.save();
  c.translate(x, y);
  // colored gem keyed by id hash
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  c.fillStyle = `hsl(${h},80%,60%)`;
  c.beginPath();
  c.moveTo(0, -s * 0.7);
  c.lineTo(s * 0.55, -s * 0.1);
  c.lineTo(s * 0.35, s * 0.6);
  c.lineTo(-s * 0.35, s * 0.6);
  c.lineTo(-s * 0.55, -s * 0.1);
  c.closePath();
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.7)";
  c.lineWidth = Math.max(1, s * 0.08);
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.5)";
  c.beginPath();
  c.moveTo(0, -s * 0.7);
  c.lineTo(s * 0.2, -s * 0.1);
  c.lineTo(-s * 0.2, -s * 0.1);
  c.closePath();
  c.fill();
  c.restore();
}

/** Trapdoor to descend. */
export function drawTrapdoor(c: C, x: number, y: number, s: number, open: boolean, t: number) {
  c.fillStyle = "#1a1018";
  c.beginPath();
  c.ellipse(x, y, s, s * 0.7, 0, 0, Math.PI * 2);
  c.fill();
  if (open) {
    const g = c.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, "rgba(120,200,255,0.8)");
    g.addColorStop(0.6, "rgba(60,120,200,0.4)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, s * (0.8 + 0.1 * Math.sin(t * 4)), s * 0.55, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(160,220,255,0.9)";
    c.lineWidth = Math.max(1.5, s * 0.08);
    c.beginPath();
    c.ellipse(x, y, s * 0.55, s * 0.38, 0, 0, Math.PI * 2);
    c.stroke();
  }
}
