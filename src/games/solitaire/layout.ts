/**
 * Per-frame responsive geometry for the Solitaire board.
 *
 * Nothing here is cached between frames — `computeLayout` is called every frame
 * with the live `ctx.width` / `ctx.height` so the board reflows for any aspect
 * ratio (portrait phones through wide desktops) and on resize / rotation.
 */

import { clamp } from "@/engine";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonRect extends Rect {
  id: string;
}

export interface Layout {
  W: number;
  H: number;
  cardW: number;
  cardH: number;
  /** vertical step between stacked face-down tableau cards */
  faceDownStep: number;
  /** vertical step between stacked face-up tableau cards */
  faceUpStep: number;
  /** horizontal peek between fanned draw-3 waste cards */
  wasteFanStep: number;
  stock: Rect;
  waste: Rect;
  foundations: Rect[]; // 4
  tableau: Rect[]; // 7 (top-of-column origin)
  topBarH: number;
  buttonBarY: number;
  buttonBarH: number;
  buttons: ButtonRect[];
  playTop: number;
  playBottom: number;
}

const COLS = 7;
const CARD_ASPECT = 1.4; // height / width

export interface LayoutInput {
  /** number of cards in each tableau column */
  tableauCounts: number[];
  /** number of face-down cards in each tableau column */
  tableauFaceDown: number[];
  /** ordered button ids to lay out in the bottom bar */
  buttonIds: string[];
}

export function computeLayout(W: number, H: number, input: LayoutInput): Layout {
  const topBarH = clamp(H * 0.085, 34, 78);
  const buttonBarH = clamp(H * 0.09, 42, 84);
  const playTop = topBarH;
  const playBottom = H - buttonBarH;
  const playH = playBottom - playTop;

  // Derive card width from the horizontal budget (7 columns + gaps + margins).
  const sideMargin = clamp(W * 0.02, 6, 28);
  const usableW = W - sideMargin * 2;
  const gapRatio = 0.16; // gap = gapRatio * cardW
  // usableW = COLS*cardW + (COLS-1)*gap = cardW * (COLS + (COLS-1)*gapRatio)
  let cardW = usableW / (COLS + (COLS - 1) * gapRatio);
  let cardH = cardW * CARD_ASPECT;

  // Vertical cap: top row + a reasonable tableau must fit. Keep some headroom
  // so fanned columns have room. If too tall, shrink the card.
  const maxCardH = playH * 0.34;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = cardH / CARD_ASPECT;
  }

  const gap = cardW * gapRatio;
  const boardW = COLS * cardW + (COLS - 1) * gap;
  const boardLeft = (W - boardW) / 2;

  const colX = (i: number) => boardLeft + i * (cardW + gap);

  const topRowY = playTop + clamp(H * 0.012, 4, 16);
  const stock: Rect = { x: colX(0), y: topRowY, w: cardW, h: cardH };
  const waste: Rect = { x: colX(1), y: topRowY, w: cardW, h: cardH };
  const foundations: Rect[] = [];
  for (let i = 0; i < 4; i++) {
    foundations.push({ x: colX(3 + i), y: topRowY, w: cardW, h: cardH });
  }

  const tableauTopY = topRowY + cardH + clamp(cardH * 0.16, 8, 30);
  const tableau: Rect[] = [];
  for (let i = 0; i < COLS; i++) {
    tableau.push({ x: colX(i), y: tableauTopY, w: cardW, h: cardH });
  }

  // Adaptive fan steps so the tallest current column still fits.
  let faceDownStep = cardH * 0.18;
  let faceUpStep = cardH * 0.32;
  const availForColumn = playBottom - tableauTopY - cardH; // room beyond first card
  let maxOffset = 0;
  for (let i = 0; i < COLS; i++) {
    const total = input.tableauCounts[i] ?? 0;
    const down = Math.min(input.tableauFaceDown[i] ?? 0, total);
    const up = total - down;
    // offset of the last card = down*fdStep + (up-1 if up>0 else 0)*fuStep,
    // but the first card contributes no step regardless of its type.
    const steps = Math.max(0, total - 1);
    const downSteps = Math.min(down, steps);
    const upSteps = steps - downSteps;
    const off = downSteps * faceDownStep + upSteps * faceUpStep;
    if (off > maxOffset) maxOffset = off;
  }
  if (maxOffset > availForColumn && maxOffset > 0) {
    const scale = clamp(availForColumn / maxOffset, 0.28, 1);
    faceDownStep *= scale;
    faceUpStep *= scale;
  }

  const wasteFanStep = cardW * 0.26;

  // Bottom button bar.
  const n = Math.max(1, input.buttonIds.length);
  const barPad = clamp(W * 0.02, 6, 24);
  const barGap = clamp(W * 0.012, 4, 14);
  const maxBtnW = clamp(W * 0.16, 60, 150);
  const availBtnW = W - barPad * 2 - barGap * (n - 1);
  const btnW = Math.min(maxBtnW, availBtnW / n);
  const totalBtnW = btnW * n + barGap * (n - 1);
  const btnLeft = (W - totalBtnW) / 2;
  const btnH = clamp(buttonBarH * 0.72, 30, 60);
  const buttonBarY = playBottom + (buttonBarH - btnH) / 2;
  const buttons: ButtonRect[] = input.buttonIds.map((id, i) => ({
    id,
    x: btnLeft + i * (btnW + barGap),
    y: buttonBarY,
    w: btnW,
    h: btnH,
  }));

  return {
    W,
    H,
    cardW,
    cardH,
    faceDownStep,
    faceUpStep,
    wasteFanStep,
    stock,
    waste,
    foundations,
    tableau,
    topBarH,
    buttonBarY,
    buttonBarH,
    buttons,
    playTop,
    playBottom,
  };
}

/** Y offset (from the column's top origin) of card at `index` in a column. */
export function tableauCardOffset(
  layout: Layout,
  faceUpFlags: boolean[],
  index: number,
): number {
  let off = 0;
  for (let i = 0; i < index; i++) {
    off += faceUpFlags[i] ? layout.faceUpStep : layout.faceDownStep;
  }
  return off;
}
