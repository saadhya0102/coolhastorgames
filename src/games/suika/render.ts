/**
 * All procedural rendering for Mergemelon. Canvas 2D only, no assets.
 * Functions take the per-frame Layout and primitive game data.
 */
import { drawText, roundRect, clamp } from "@/engine";
import { CONFIG, type Body, type Layout, type GameState } from "./types";
import { TIERS } from "./fruits";

function worldToPxX(layout: Layout, x: number): number {
  return layout.originX + x * layout.scale;
}
function worldToPxY(layout: Layout, y: number): number {
  return layout.originY + y * layout.scale;
}

export function drawBackground(c: CanvasRenderingContext2D, layout: Layout, time: number): void {
  const { W, H } = layout;
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#fff3e6");
  g.addColorStop(0.55, "#ffe3cf");
  g.addColorStop(1, "#ffc9a8");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // soft bokeh blobs for depth
  c.save();
  const blobs = [
    { x: 0.18, y: 0.22, r: 0.22, a: 0.1 },
    { x: 0.82, y: 0.16, r: 0.16, a: 0.08 },
    { x: 0.7, y: 0.8, r: 0.26, a: 0.07 },
  ];
  for (const b of blobs) {
    const bx = W * b.x + Math.sin(time * 0.3 + b.x * 10) * 6;
    const by = H * b.y + Math.cos(time * 0.25 + b.y * 8) * 6;
    const rr = Math.min(W, H) * b.r;
    const rg = c.createRadialGradient(bx, by, 0, bx, by, rr);
    rg.addColorStop(0, `rgba(255,255,255,${b.a})`);
    rg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = rg;
    c.beginPath();
    c.arc(bx, by, rr, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

export function drawJar(c: CanvasRenderingContext2D, layout: Layout): void {
  const { originX, originY, jarW, jarH } = layout;
  const r = Math.min(jarW, jarH) * 0.06;
  const wallW = Math.max(3, jarW * 0.016);

  // glass body (translucent), rounded mostly at the bottom
  c.save();
  roundRect(c, originX, originY, jarW, jarH, r);
  const g = c.createLinearGradient(originX, originY, originX, originY + jarH);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(120,180,200,0.18)");
  c.fillStyle = g;
  c.fill();

  // inner shadow at the bottom for depth
  const ig = c.createLinearGradient(0, originY + jarH * 0.7, 0, originY + jarH);
  ig.addColorStop(0, "rgba(60,90,110,0)");
  ig.addColorStop(1, "rgba(40,70,90,0.16)");
  c.fillStyle = ig;
  roundRect(c, originX, originY, jarW, jarH, r);
  c.fill();
  c.restore();

  // glossy highlight band on the left
  c.save();
  c.globalAlpha = 0.5;
  c.fillStyle = "rgba(255,255,255,0.55)";
  roundRect(c, originX + jarW * 0.05, originY + jarH * 0.08, jarW * 0.05, jarH * 0.82, jarW * 0.025);
  c.fill();
  c.restore();

  // walls + base
  c.lineJoin = "round";
  c.strokeStyle = "rgba(110,150,170,0.55)";
  c.lineWidth = wallW;
  // left wall
  c.beginPath();
  c.moveTo(originX + wallW / 2, originY);
  c.lineTo(originX + wallW / 2, originY + jarH - r);
  c.quadraticCurveTo(originX + wallW / 2, originY + jarH, originX + r, originY + jarH - wallW / 2);
  c.stroke();
  // right wall
  c.beginPath();
  c.moveTo(originX + jarW - wallW / 2, originY);
  c.lineTo(originX + jarW - wallW / 2, originY + jarH - r);
  c.quadraticCurveTo(originX + jarW - wallW / 2, originY + jarH, originX + jarW - r, originY + jarH - wallW / 2);
  c.stroke();
  // floor
  c.beginPath();
  c.moveTo(originX + r, originY + jarH - wallW / 2);
  c.lineTo(originX + jarW - r, originY + jarH - wallW / 2);
  c.stroke();

  // wooden shelf under the jar
  c.fillStyle = "#c8945a";
  c.fillRect(originX - jarW * 0.04, originY + jarH, jarW * 1.08, Math.max(5, jarH * 0.02));
  c.fillStyle = "rgba(0,0,0,0.12)";
  c.fillRect(originX - jarW * 0.04, originY + jarH + Math.max(5, jarH * 0.02), jarW * 1.08, Math.max(2, jarH * 0.008));
}

export function drawDangerLine(
  c: CanvasRenderingContext2D,
  layout: Layout,
  overflowRatio: number,
  state: GameState,
): void {
  const { originX, jarW } = layout;
  const y = worldToPxY(layout, CONFIG.DANGER_Y);
  const alarm = clamp(overflowRatio, 0, 1);
  const flash = state === "dying" ? 0.5 + 0.5 * Math.sin(Date.now() * 0.02) : 1;
  const col = `rgba(${Math.round(60 + alarm * 195)}, ${Math.round(190 - alarm * 150)}, ${Math.round(170 - alarm * 140)}, ${(0.45 + alarm * 0.45) * flash})`;
  c.save();
  c.strokeStyle = col;
  c.lineWidth = Math.max(2, jarW * 0.01);
  c.setLineDash([jarW * 0.04, jarW * 0.03]);
  c.beginPath();
  c.moveTo(originX + jarW * 0.02, y);
  c.lineTo(originX + jarW * 0.98, y);
  c.stroke();
  c.setLineDash([]);
  if (alarm > 0.05) {
    c.fillStyle = col;
    drawText(c, "!", originX + jarW * 0.5, y - jarW * 0.05, jarW * 0.06 * (0.8 + alarm * 0.6), col);
  }
  c.restore();
}

/** Draw a fruit centered at pixel (cx,cy) with pixel radius rpx. */
export function drawFruit(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rpx: number,
  tier: number,
  angle: number,
  pop: number,
  time: number,
  shadow = true,
): void {
  const f = TIERS[tier];
  if (rpx <= 0) return;

  // contact shadow
  if (shadow) {
    c.save();
    c.globalAlpha = 0.16;
    c.fillStyle = "#5a3a2a";
    c.beginPath();
    c.ellipse(cx, cy + rpx * 0.92, rpx * 0.95, rpx * 0.32, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // squash/stretch from spawn pop
  const e = pop > 0 ? Math.sin(pop * Math.PI) : 0;
  const sx = 1 + e * 0.2;
  const sy = 1 - e * 0.12;

  c.save();
  c.translate(cx, cy);
  c.scale(sx, sy);

  // body radial gradient (light top-left -> color -> accent rim)
  const grd = c.createRadialGradient(-rpx * 0.35, -rpx * 0.4, rpx * 0.1, 0, 0, rpx);
  grd.addColorStop(0, f.light);
  grd.addColorStop(0.55, f.color);
  grd.addColorStop(1, f.accent);
  c.fillStyle = grd;
  c.beginPath();
  c.arc(0, 0, rpx, 0, Math.PI * 2);
  c.fill();

  // textured decorations clipped inside the circle, rotated by angle
  c.save();
  c.beginPath();
  c.arc(0, 0, rpx, 0, Math.PI * 2);
  c.clip();
  c.rotate(angle);

  if (f.stripes) {
    c.fillStyle = "rgba(20,90,40,0.55)";
    for (let i = -3; i <= 3; i++) {
      const w = rpx * 0.12;
      c.save();
      c.translate(i * rpx * 0.32, 0);
      c.beginPath();
      c.ellipse(0, 0, w, rpx * 1.1, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }
  if (f.net) {
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = Math.max(1, rpx * 0.03);
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(-rpx, i * rpx * 0.35);
      c.lineTo(rpx, i * rpx * 0.35 + rpx * 0.4);
      c.stroke();
      c.beginPath();
      c.moveTo(i * rpx * 0.35, -rpx);
      c.lineTo(i * rpx * 0.35 + rpx * 0.4, rpx);
      c.stroke();
    }
  }
  if (f.dimples) {
    c.fillStyle = "rgba(0,0,0,0.10)";
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const dr = rpx * 0.55;
      c.beginPath();
      c.arc(Math.cos(a) * dr, Math.sin(a) * dr, rpx * 0.06, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();

  // rim shading at the bottom for roundness
  c.strokeStyle = "rgba(0,0,0,0.12)";
  c.lineWidth = Math.max(1, rpx * 0.06);
  c.beginPath();
  c.arc(0, 0, rpx * 0.92, Math.PI * 0.15, Math.PI * 0.85);
  c.stroke();

  // specular highlight
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.beginPath();
  c.ellipse(-rpx * 0.35, -rpx * 0.4, rpx * 0.26, rpx * 0.16, -0.6, 0, Math.PI * 2);
  c.fill();

  c.restore(); // undo scale/translate for upright decorations below

  // upright decorations (leaf/stem + face) so they always read right-side-up
  c.save();
  c.translate(cx, cy);
  c.scale(sx, sy);

  if (f.leaf) {
    // stem
    c.strokeStyle = "#7a4a25";
    c.lineWidth = Math.max(1.5, rpx * 0.07);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(0, -rpx * 0.9);
    c.quadraticCurveTo(rpx * 0.06, -rpx * 1.12, rpx * 0.12, -rpx * 1.15);
    c.stroke();
    // leaf
    c.fillStyle = "#4fb45e";
    c.save();
    c.translate(rpx * 0.12, -rpx * 1.05);
    c.rotate(-0.5);
    c.beginPath();
    c.ellipse(rpx * 0.18, 0, rpx * 0.22, rpx * 0.1, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.12)";
    c.lineWidth = Math.max(1, rpx * 0.02);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(rpx * 0.36, 0);
    c.stroke();
    c.restore();
  }

  if (f.face) {
    const blink = (Math.sin(time * 1.3 + cx) > 0.97) ? 0.2 : 1;
    const eyeX = rpx * 0.32;
    const eyeY = rpx * 0.02;
    const eyeR = rpx * 0.16;
    for (const sgn of [-1, 1]) {
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.ellipse(sgn * eyeX, eyeY, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#23202a";
      c.beginPath();
      c.ellipse(sgn * eyeX + sgn * eyeR * 0.15, eyeY + eyeR * 0.1, eyeR * 0.5, eyeR * 0.5 * blink, 0, 0, Math.PI * 2);
      c.fill();
    }
    // cheeks
    c.fillStyle = "rgba(255,120,140,0.4)";
    for (const sgn of [-1, 1]) {
      c.beginPath();
      c.arc(sgn * rpx * 0.5, rpx * 0.28, rpx * 0.12, 0, Math.PI * 2);
      c.fill();
    }
    // smile
    c.strokeStyle = "rgba(40,30,40,0.6)";
    c.lineWidth = Math.max(1, rpx * 0.05);
    c.lineCap = "round";
    c.beginPath();
    c.arc(0, rpx * 0.22, rpx * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
  }

  c.restore();
}

export function drawBody(c: CanvasRenderingContext2D, layout: Layout, b: Body, time: number): void {
  drawFruit(
    c,
    worldToPxX(layout, b.x),
    worldToPxY(layout, b.y),
    b.r * layout.scale,
    b.tier,
    b.angle,
    b.spawnPop,
    time,
    true,
  );
}

export function drawGuide(c: CanvasRenderingContext2D, layout: Layout, aimX: number, tier: number): void {
  const x = worldToPxX(layout, aimX);
  const yTop = worldToPxY(layout, CONFIG.DROP_Y + TIERS[tier].r);
  const yBot = worldToPxY(layout, CONFIG.WORLD_H);
  const rpx = TIERS[tier].r * layout.scale;
  c.save();
  c.strokeStyle = `${TIERS[tier].accent}88`;
  c.lineWidth = Math.max(1.5, rpx * 0.08);
  c.setLineDash([rpx * 0.35, rpx * 0.45]);
  c.beginPath();
  c.moveTo(x, yTop);
  c.lineTo(x, yBot);
  c.stroke();
  c.setLineDash([]);
  // landing footprint
  c.globalAlpha = 0.35;
  c.strokeStyle = TIERS[tier].accent;
  c.beginPath();
  c.ellipse(x, yBot - rpx * 0.18, rpx, rpx * 0.3, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

export function drawCurrent(
  c: CanvasRenderingContext2D,
  layout: Layout,
  aimX: number,
  tier: number,
  appear: number,
  time: number,
): void {
  const x = worldToPxX(layout, aimX);
  const bob = Math.sin(time * 3) * layout.scale * 0.006;
  const y = worldToPxY(layout, CONFIG.DROP_Y) + bob;
  const rpx = TIERS[tier].r * layout.scale * (0.3 + 0.7 * appear);
  drawFruit(c, x, y, rpx, tier, 0, 0, time, false);
}

export function drawHud(
  c: CanvasRenderingContext2D,
  layout: Layout,
  score: number,
  best: number,
  nextTier: number,
  time: number,
): void {
  const { W, topUI, originX, jarW } = layout;
  const pad = Math.min(W, layout.H) * 0.03;
  const big = clamp(topUI * 0.4, 16, 44);
  const small = clamp(topUI * 0.2, 11, 22);

  // score
  drawText(c, String(score), originX + pad, topUI * 0.42, big, "#7a3b14", "left", "800");
  drawText(c, `BEST ${best}`, originX + pad, topUI * 0.74, small, "#a86a3a", "left", "700");

  // next preview, top-right
  const boxR = clamp(topUI * 0.34, 16, 40);
  const bx = originX + jarW - pad - boxR;
  const by = topUI * 0.5;
  c.save();
  c.fillStyle = "rgba(255,255,255,0.45)";
  roundRect(c, bx - boxR * 1.25, by - boxR * 1.25, boxR * 2.5, boxR * 2.5, boxR * 0.4);
  c.fill();
  c.restore();
  drawText(c, "NEXT", bx, by - boxR * 1.05, small * 0.8, "#a86a3a", "center", "700");
  drawFruit(c, bx, by + boxR * 0.18, boxR * 0.78, nextTier, 0, 0, time, false);
}

export function drawOverlay(
  c: CanvasRenderingContext2D,
  layout: Layout,
  state: GameState,
  score: number,
  best: number,
  highestTier: number,
): void {
  const { W, H, originX, originY, jarW, jarH } = layout;
  if (state === "intro") {
    c.save();
    c.fillStyle = "rgba(40,20,10,0.32)";
    roundRect(c, originX, originY, jarW, jarH, Math.min(jarW, jarH) * 0.06);
    c.fill();
    drawText(c, "MERGEMELON", W / 2, originY + jarH * 0.4, clamp(jarW * 0.1, 20, 52), "#fff", "center", "800");
    drawText(c, "Drop fruit • merge matching pairs", W / 2, originY + jarH * 0.52, clamp(jarW * 0.045, 12, 22), "rgba(255,255,255,0.92)");
    drawText(c, "Reach the Sunmelon!", W / 2, originY + jarH * 0.59, clamp(jarW * 0.045, 12, 22), "rgba(255,255,255,0.92)");
    drawText(c, "Tap / click to drop", W / 2, originY + jarH * 0.7, clamp(jarW * 0.05, 13, 24), "#ffe14d", "center", "800");
    c.restore();
    return;
  }
  if (state === "dying") {
    c.save();
    c.fillStyle = "rgba(60,10,10,0.45)";
    c.fillRect(0, 0, W, H);
    drawText(c, "OVERFLOW!", W / 2, H * 0.42, clamp(W * 0.09, 24, 64), "#fff", "center", "800");
    drawText(c, `Score ${score}   •   Best ${Math.max(best, score)}`, W / 2, H * 0.52, clamp(W * 0.04, 13, 24), "rgba(255,255,255,0.9)");
    drawText(c, `Biggest: ${TIERS[highestTier].name}`, W / 2, H * 0.58, clamp(W * 0.04, 12, 22), "rgba(255,255,255,0.8)");
    c.restore();
  }
}
