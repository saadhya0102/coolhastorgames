/**
 * Procedural card art for Klondike Solitaire.
 *
 * Every visual is drawn from scratch with canvas paths — no image assets and
 * nothing copied from any other product. Suit symbols (spade/heart/diamond/
 * club) are path-drawn so they stay crisp at any scale and on HiDPI displays.
 */

import { roundRect } from "@/engine";
import type { Card, Suit } from "./cards";
import { cardColor, rankLabel } from "./cards";

const TAU = Math.PI * 2;

export const RED = "#d12b3c";
export const BLACK = "#1d2030";

export const suitColor = (suit: Suit): string =>
  cardColor({ suit, rank: 1, faceUp: true, id: 0 }) === "red" ? RED : BLACK;

// ----------------------------------------------------------------------------
// Suit symbols — each draws a filled symbol of overall height ~`s` centered at
// (cx, cy). The current ctx.fillStyle is used.
// ----------------------------------------------------------------------------

function heartPath(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  dir: number,
) {
  const tipY = cy + dir * s * 0.44;
  c.beginPath();
  c.moveTo(cx, tipY);
  c.bezierCurveTo(
    cx - s * 0.56, cy - dir * s * 0.06,
    cx - s * 0.52, cy - dir * s * 0.5,
    cx - s * 0.22, cy - dir * s * 0.5,
  );
  c.bezierCurveTo(
    cx - s * 0.06, cy - dir * s * 0.5,
    cx, cy - dir * s * 0.32,
    cx, cy - dir * s * 0.24,
  );
  c.bezierCurveTo(
    cx, cy - dir * s * 0.32,
    cx + s * 0.06, cy - dir * s * 0.5,
    cx + s * 0.22, cy - dir * s * 0.5,
  );
  c.bezierCurveTo(
    cx + s * 0.52, cy - dir * s * 0.5,
    cx + s * 0.56, cy - dir * s * 0.06,
    cx, tipY,
  );
  c.closePath();
}

function drawHeart(c: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  heartPath(c, cx, cy, s, 1);
  c.fill();
}

function drawDiamond(c: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  c.beginPath();
  c.moveTo(cx, cy - s * 0.52);
  c.lineTo(cx + s * 0.37, cy);
  c.lineTo(cx, cy + s * 0.52);
  c.lineTo(cx - s * 0.37, cy);
  c.closePath();
  c.fill();
}

function drawSpade(c: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  // inverted heart for the leaf
  heartPath(c, cx, cy - s * 0.04, s, -1);
  c.fill();
  // stem
  c.beginPath();
  c.moveTo(cx, cy + s * 0.04);
  c.bezierCurveTo(
    cx + s * 0.04, cy + s * 0.28,
    cx + s * 0.16, cy + s * 0.4,
    cx + s * 0.22, cy + s * 0.46,
  );
  c.lineTo(cx - s * 0.22, cy + s * 0.46);
  c.bezierCurveTo(
    cx - s * 0.16, cy + s * 0.4,
    cx - s * 0.04, cy + s * 0.28,
    cx, cy + s * 0.04,
  );
  c.closePath();
  c.fill();
}

function drawClub(c: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const r = s * 0.2;
  c.beginPath();
  c.arc(cx, cy - s * 0.2, r, 0, TAU);
  c.fill();
  c.beginPath();
  c.arc(cx - s * 0.21, cy + s * 0.08, r, 0, TAU);
  c.fill();
  c.beginPath();
  c.arc(cx + s * 0.21, cy + s * 0.08, r, 0, TAU);
  c.fill();
  // stem
  c.beginPath();
  c.moveTo(cx, cy + s * 0.02);
  c.bezierCurveTo(
    cx + s * 0.04, cy + s * 0.28,
    cx + s * 0.16, cy + s * 0.4,
    cx + s * 0.22, cy + s * 0.46,
  );
  c.lineTo(cx - s * 0.22, cy + s * 0.46);
  c.bezierCurveTo(
    cx - s * 0.16, cy + s * 0.4,
    cx - s * 0.04, cy + s * 0.28,
    cx, cy + s * 0.02,
  );
  c.closePath();
  c.fill();
}

/** Draw any suit symbol of height ~`s` centered at (cx, cy). */
export function drawSuit(
  c: CanvasRenderingContext2D,
  suit: Suit,
  cx: number,
  cy: number,
  s: number,
) {
  switch (suit) {
    case "hearts":
      drawHeart(c, cx, cy, s);
      break;
    case "diamonds":
      drawDiamond(c, cx, cy, s);
      break;
    case "spades":
      drawSpade(c, cx, cy, s);
      break;
    case "clubs":
      drawClub(c, cx, cy, s);
      break;
  }
}

// ----------------------------------------------------------------------------
// Pip layouts for the number cards (2..10). Coordinates are fractions of the
// central pip panel; y in [0,1] top->bottom. Pips with y > 0.5 are drawn
// rotated 180° (as on real cards). x columns: L=0.5-col, C=center, R.
// ----------------------------------------------------------------------------

type Col = "L" | "C" | "R";
interface Pip {
  col: Col;
  y: number;
}

const PIP_LAYOUTS: Record<number, Pip[]> = {
  2: [
    { col: "C", y: 0 },
    { col: "C", y: 1 },
  ],
  3: [
    { col: "C", y: 0 },
    { col: "C", y: 0.5 },
    { col: "C", y: 1 },
  ],
  4: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
  5: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "C", y: 0.5 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
  6: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "L", y: 0.5 },
    { col: "R", y: 0.5 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
  7: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "C", y: 0.25 },
    { col: "L", y: 0.5 },
    { col: "R", y: 0.5 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
  8: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "C", y: 0.25 },
    { col: "L", y: 0.5 },
    { col: "R", y: 0.5 },
    { col: "C", y: 0.75 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
  9: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "L", y: 0.34 },
    { col: "R", y: 0.34 },
    { col: "C", y: 0.5 },
    { col: "L", y: 0.66 },
    { col: "R", y: 0.66 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
  10: [
    { col: "L", y: 0 },
    { col: "R", y: 0 },
    { col: "C", y: 0.16 },
    { col: "L", y: 0.34 },
    { col: "R", y: 0.34 },
    { col: "C", y: 0.84 },
    { col: "L", y: 0.66 },
    { col: "R", y: 0.66 },
    { col: "L", y: 1 },
    { col: "R", y: 1 },
  ],
};

function drawPips(
  c: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const layout = PIP_LAYOUTS[card.rank];
  if (!layout) return;
  // central panel inset
  const padX = w * 0.2;
  const padY = h * 0.16;
  const left = x + padX;
  const right = x + w - padX;
  const cx = x + w / 2;
  const top = y + padY;
  const bottom = y + h - padY;
  const pipSize = w * 0.26;
  c.fillStyle = suitColor(card.suit);
  for (const pip of layout) {
    const px = pip.col === "L" ? left : pip.col === "R" ? right : cx;
    const py = top + pip.y * (bottom - top);
    const flip = pip.y > 0.5;
    if (flip) {
      c.save();
      c.translate(px, py);
      c.rotate(Math.PI);
      drawSuit(c, card.suit, 0, 0, pipSize);
      c.restore();
    } else {
      drawSuit(c, card.suit, px, py, pipSize);
    }
  }
}

// ----------------------------------------------------------------------------
// Corner index (rank label + tiny suit) top-left and bottom-right (rotated).
// ----------------------------------------------------------------------------

function drawCornerIndex(
  c: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const color = suitColor(card.suit);
  const fs = w * 0.26;
  const label = rankLabel(card.rank);
  const margin = w * 0.1;
  c.fillStyle = color;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `800 ${fs}px "Baloo 2", system-ui, sans-serif`;

  const drawOne = (ox: number, oy: number) => {
    c.fillText(label, ox, oy);
    drawSuit(c, card.suit, ox, oy + fs * 0.85, fs * 0.62);
  };

  // top-left
  drawOne(x + margin + fs * 0.32, y + margin + fs * 0.5);
  // bottom-right (rotated 180)
  c.save();
  c.translate(x + w - margin - fs * 0.32, y + h - margin - fs * 0.5);
  c.rotate(Math.PI);
  c.fillStyle = color;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `800 ${fs}px "Baloo 2", system-ui, sans-serif`;
  c.fillText(label, 0, 0);
  drawSuit(c, card.suit, 0, fs * 0.85, fs * 0.62);
  c.restore();
}

// ----------------------------------------------------------------------------
// Face cards (J / Q / K): an original ornamental center panel.
// ----------------------------------------------------------------------------

function drawFacePanel(
  c: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const color = suitColor(card.suit);
  const panelX = x + w * 0.16;
  const panelY = y + h * 0.13;
  const panelW = w * 0.68;
  const panelH = h * 0.74;
  // ornamental frame
  const grad = c.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
  grad.addColorStop(0, "#fbf3df");
  grad.addColorStop(1, "#f3e6c4");
  c.fillStyle = grad;
  roundRect(c, panelX, panelY, panelW, panelH, w * 0.06);
  c.fill();
  c.lineWidth = Math.max(1, w * 0.02);
  c.strokeStyle = color;
  c.globalAlpha = 0.5;
  roundRect(c, panelX, panelY, panelW, panelH, w * 0.06);
  c.stroke();
  c.globalAlpha = 1;

  // big letter behind
  const letter = rankLabel(card.rank);
  c.fillStyle = color;
  c.globalAlpha = 0.16;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `900 ${h * 0.5}px "Baloo 2", system-ui, sans-serif`;
  c.fillText(letter, x + w / 2, y + h / 2);
  c.globalAlpha = 1;

  // crisp suit emblem
  drawSuit(c, card.suit, x + w / 2, y + h * 0.4, w * 0.34);
  // crown / collar flourish depending on rank
  c.fillStyle = color;
  c.globalAlpha = 0.85;
  const fcx = x + w / 2;
  const fy = y + h * 0.68;
  if (card.rank === 13) {
    // crown
    c.beginPath();
    c.moveTo(fcx - w * 0.18, fy + h * 0.06);
    c.lineTo(fcx - w * 0.18, fy - h * 0.04);
    c.lineTo(fcx - w * 0.09, fy + h * 0.01);
    c.lineTo(fcx, fy - h * 0.06);
    c.lineTo(fcx + w * 0.09, fy + h * 0.01);
    c.lineTo(fcx + w * 0.18, fy - h * 0.04);
    c.lineTo(fcx + w * 0.18, fy + h * 0.06);
    c.closePath();
    c.fill();
  } else if (card.rank === 12) {
    // tiara dots
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.arc(fcx + i * w * 0.08, fy, w * 0.025, 0, TAU);
      c.fill();
    }
  } else {
    // jack collar
    c.beginPath();
    c.moveTo(fcx - w * 0.16, fy + h * 0.05);
    c.lineTo(fcx, fy - h * 0.03);
    c.lineTo(fcx + w * 0.16, fy + h * 0.05);
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 1;
}

// ----------------------------------------------------------------------------
// Card face / back / placeholder
// ----------------------------------------------------------------------------

export interface CardDrawOpts {
  /** 0..1 horizontal scale for flip animation (1 = full width). */
  flipScale?: number;
  /** highlight glow color (e.g. valid target / hint / selected). */
  glow?: string;
  /** dim the card (e.g. unreachable). */
  dim?: boolean;
  shadow?: boolean;
}

function cardBody(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  shadow: boolean,
) {
  if (shadow) {
    c.save();
    c.shadowColor = "rgba(0,0,0,0.32)";
    c.shadowBlur = w * 0.16;
    c.shadowOffsetY = h * 0.03;
    c.fillStyle = "#ffffff";
    roundRect(c, x, y, w, h, radius);
    c.fill();
    c.restore();
  }
  const grad = c.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#eef1f8");
  c.fillStyle = grad;
  roundRect(c, x, y, w, h, radius);
  c.fill();
  c.lineWidth = Math.max(1, w * 0.012);
  c.strokeStyle = "rgba(20,24,46,0.18)";
  roundRect(c, x + c.lineWidth / 2, y + c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth, radius);
  c.stroke();
}

/** Draw a face-up or face-down card at (x,y) sized w×h. */
export function drawCard(
  c: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: CardDrawOpts = {},
) {
  const flip = opts.flipScale ?? 1;
  const radius = w * 0.1;

  if (flip < 1) {
    // flip animation: squeeze horizontally around the center
    const cx = x + w / 2;
    const nw = Math.max(0.001, w * flip);
    drawCard(c, card, cx - nw / 2, y, nw, h, { ...opts, flipScale: 1 });
    return;
  }

  c.save();
  if (card.faceUp) {
    cardBody(c, x, y, w, h, radius, opts.shadow ?? false);
    if (card.rank >= 11) {
      drawFacePanel(c, card, x, y, w, h);
    } else if (card.rank === 1) {
      // Ace: single large ornamental pip
      drawSuit(c, card.suit, x + w / 2, y + h / 2, w * 0.5);
    } else {
      drawPips(c, card, x, y, w, h);
    }
    drawCornerIndex(c, card, x, y, w, h);
  } else {
    drawCardBack(c, x, y, w, h, opts.shadow ?? false);
  }

  if (opts.dim) {
    c.fillStyle = "rgba(10,14,30,0.32)";
    roundRect(c, x, y, w, h, radius);
    c.fill();
  }
  if (opts.glow) {
    c.save();
    c.lineWidth = Math.max(2, w * 0.05);
    c.strokeStyle = opts.glow;
    c.shadowColor = opts.glow;
    c.shadowBlur = w * 0.3;
    roundRect(c, x + c.lineWidth / 2, y + c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth, radius);
    c.stroke();
    c.restore();
  }
  c.restore();
}

/** Draw an original face-down card back (lattice pattern). */
export function drawCardBack(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shadow = false,
) {
  const radius = w * 0.1;
  if (shadow) {
    c.save();
    c.shadowColor = "rgba(0,0,0,0.32)";
    c.shadowBlur = w * 0.16;
    c.shadowOffsetY = h * 0.03;
    c.fillStyle = "#13314f";
    roundRect(c, x, y, w, h, radius);
    c.fill();
    c.restore();
  }
  const grad = c.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, "#1b4a73");
  grad.addColorStop(0.5, "#15608a");
  grad.addColorStop(1, "#123b5c");
  c.fillStyle = grad;
  roundRect(c, x, y, w, h, radius);
  c.fill();

  // inner border
  const m = w * 0.08;
  c.save();
  roundRect(c, x, y, w, h, radius);
  c.clip();
  // diagonal lattice
  c.strokeStyle = "rgba(120,200,235,0.35)";
  c.lineWidth = Math.max(0.5, w * 0.02);
  const step = w * 0.22;
  c.beginPath();
  for (let d = -h; d < w + h; d += step) {
    c.moveTo(x + d, y);
    c.lineTo(x + d + h, y + h);
    c.moveTo(x + d, y + h);
    c.lineTo(x + d + h, y);
  }
  c.stroke();
  c.restore();

  // border frame
  c.lineWidth = Math.max(1, w * 0.03);
  c.strokeStyle = "rgba(230,240,255,0.55)";
  roundRect(c, x + m, y + m, w - m * 2, h - m * 2, radius * 0.6);
  c.stroke();
  // center emblem
  c.fillStyle = "rgba(230,240,255,0.5)";
  drawSuit(c, "spades", x + w / 2, y + h / 2, w * 0.28);
}

/** Draw an empty pile placeholder outline with an optional marker. */
export function drawPlaceholder(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  marker?: { kind: "recycle" } | { kind: "suit"; suit: Suit } | { kind: "ace" },
) {
  const radius = w * 0.1;
  c.save();
  c.fillStyle = "rgba(0,0,0,0.16)";
  roundRect(c, x, y, w, h, radius);
  c.fill();
  c.lineWidth = Math.max(1, w * 0.02);
  c.strokeStyle = "rgba(255,255,255,0.28)";
  c.setLineDash([w * 0.08, w * 0.06]);
  roundRect(c, x + 1, y + 1, w - 2, h - 2, radius);
  c.stroke();
  c.setLineDash([]);

  if (marker) {
    c.fillStyle = "rgba(255,255,255,0.32)";
    if (marker.kind === "recycle") {
      drawRecycle(c, x + w / 2, y + h / 2, w * 0.34);
    } else if (marker.kind === "suit") {
      drawSuit(c, marker.suit, x + w / 2, y + h / 2, w * 0.42);
    } else {
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `800 ${w * 0.4}px "Baloo 2", system-ui, sans-serif`;
      c.fillText("A", x + w / 2, y + h / 2);
    }
  }
  c.restore();
}

function drawRecycle(c: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  c.save();
  c.strokeStyle = "rgba(255,255,255,0.4)";
  c.lineWidth = Math.max(1.5, s * 0.12);
  c.beginPath();
  c.arc(cx, cy, s * 0.5, Math.PI * 0.25, Math.PI * 1.7);
  c.stroke();
  // arrow head
  const a = Math.PI * 1.7;
  const ax = cx + Math.cos(a) * s * 0.5;
  const ay = cy + Math.sin(a) * s * 0.5;
  c.fillStyle = "rgba(255,255,255,0.4)";
  c.beginPath();
  c.moveTo(ax, ay);
  c.lineTo(ax - s * 0.18, ay - s * 0.02);
  c.lineTo(ax + s * 0.02, ay + s * 0.2);
  c.closePath();
  c.fill();
  c.restore();
}
