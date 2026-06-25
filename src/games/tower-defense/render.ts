import { roundRect } from "@/engine";
import { TOWERS, UI } from "./config";
import { positionAt } from "./maps";
import type {
  Enemy,
  EnemyDef,
  GameMap,
  Projectile,
  Tower,
  TowerKind,
  Vec,
} from "./types";

export interface Viewport {
  ox: number;
  oy: number;
  cell: number;
  cols: number;
  rows: number;
}

export const gridToScreen = (vp: Viewport, gx: number, gy: number): Vec => ({
  x: vp.ox + gx * vp.cell,
  y: vp.oy + gy * vp.cell,
});

export const screenToGrid = (vp: Viewport, sx: number, sy: number): Vec => ({
  x: (sx - vp.ox) / vp.cell,
  y: (sy - vp.oy) / vp.cell,
});

/* ----------------------------------------------------------------------- */
/* Map                                                                      */
/* ----------------------------------------------------------------------- */

export function drawMap(
  c: CanvasRenderingContext2D,
  map: GameMap,
  vp: Viewport,
  roadTiles: Set<string>,
  t: number,
) {
  const { cell } = vp;

  // grass checker
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const s = gridToScreen(vp, col, row);
      c.fillStyle = (col + row) % 2 === 0 ? map.grass : map.grassAlt;
      c.fillRect(s.x, s.y, cell + 1, cell + 1);
    }
  }
  void roadTiles;

  // soft inner border / vignette of the field
  c.strokeStyle = "rgba(0,0,0,0.18)";
  c.lineWidth = Math.max(2, cell * 0.06);
  c.strokeRect(vp.ox, vp.oy, map.cols * cell, map.rows * cell);

  // road as a thick rounded polyline following the waypoints
  const pts = map.waypoints.map((w) => gridToScreen(vp, w.x, w.y));
  c.lineJoin = "round";
  c.lineCap = "round";
  // edge
  c.strokeStyle = map.roadEdge;
  c.lineWidth = cell * 1.02;
  strokePath(c, pts);
  // surface
  c.strokeStyle = map.road;
  c.lineWidth = cell * 0.82;
  strokePath(c, pts);
  // dashed center guide
  c.save();
  c.strokeStyle = "rgba(255,255,255,0.35)";
  c.lineWidth = Math.max(2, cell * 0.07);
  c.setLineDash([cell * 0.28, cell * 0.34]);
  c.lineDashOffset = -t * cell * 1.2;
  strokePath(c, pts);
  c.restore();

  // decorations (rocks / shrubs) - also block building
  for (const d of map.decorations) {
    const s = gridToScreen(vp, d.x + 0.5, d.y + 0.5);
    drawRock(c, s.x, s.y, cell * 0.34, map.accent);
  }

  drawRift(c, map, vp, t);
  drawKeep(c, map, vp, t, 0);
}

function strokePath(c: CanvasRenderingContext2D, pts: Vec[]) {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.stroke();
}

function drawRock(c: CanvasRenderingContext2D, x: number, y: number, r: number, accent: string) {
  c.fillStyle = "rgba(0,0,0,0.18)";
  c.beginPath();
  c.ellipse(x, y + r * 0.5, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#7c7368";
  c.beginPath();
  c.moveTo(x - r, y + r * 0.4);
  c.lineTo(x - r * 0.5, y - r * 0.8);
  c.lineTo(x + r * 0.3, y - r);
  c.lineTo(x + r, y + r * 0.3);
  c.lineTo(x + r * 0.5, y + r * 0.6);
  c.closePath();
  c.fill();
  c.fillStyle = "#9a9087";
  c.beginPath();
  c.moveTo(x - r * 0.5, y - r * 0.8);
  c.lineTo(x + r * 0.3, y - r);
  c.lineTo(x + r * 0.1, y - r * 0.2);
  c.closePath();
  c.fill();
  c.strokeStyle = accent;
  c.globalAlpha = 0.25;
  c.lineWidth = Math.max(1, r * 0.12);
  c.stroke();
  c.globalAlpha = 1;
}

export function drawRift(c: CanvasRenderingContext2D, map: GameMap, vp: Viewport, t: number) {
  const p = positionAt(map.waypoints, 0.7);
  const s = gridToScreen(vp, p.x, p.y);
  const R = vp.cell * 0.7;
  c.save();
  c.translate(s.x, s.y);
  for (let i = 3; i >= 0; i--) {
    const rr = R * (0.5 + i * 0.18);
    c.globalAlpha = 0.18 + 0.12 * Math.sin(t * 3 + i);
    c.fillStyle = i % 2 === 0 ? "#b14bff" : "#ff4bd6";
    c.beginPath();
    c.ellipse(0, 0, rr, rr * 0.7, t * (0.6 + i * 0.2), 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  c.fillStyle = "#1a0a26";
  c.beginPath();
  c.ellipse(0, 0, R * 0.42, R * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

export function drawKeep(
  c: CanvasRenderingContext2D,
  map: GameMap,
  vp: Viewport,
  t: number,
  flash: number,
) {
  const L = totalLen(map.waypoints);
  const p = positionAt(map.waypoints, L - 0.7);
  const s = gridToScreen(vp, p.x, p.y);
  const u = vp.cell * 0.5;
  c.save();
  c.translate(s.x, s.y);
  // shadow
  c.fillStyle = "rgba(0,0,0,0.25)";
  c.beginPath();
  c.ellipse(0, u * 0.9, u * 1.2, u * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  // body
  const body = flash > 0 ? "#ff6b5d" : "#8a8f9a";
  c.fillStyle = body;
  roundRect(c, -u, -u, u * 2, u * 2, u * 0.25);
  c.fill();
  // battlements
  c.fillStyle = flash > 0 ? "#ffd0c8" : "#b3b8c2";
  for (let i = -1; i <= 1; i++) c.fillRect(i * u * 0.7 - u * 0.2, -u * 1.25, u * 0.4, u * 0.35);
  // door
  c.fillStyle = "#3a2c1d";
  roundRect(c, -u * 0.3, u * 0.2, u * 0.6, u * 0.8, u * 0.2);
  c.fill();
  // flag
  c.strokeStyle = "#5b4a36";
  c.lineWidth = Math.max(2, u * 0.1);
  c.beginPath();
  c.moveTo(0, -u * 1.25);
  c.lineTo(0, -u * 1.9);
  c.stroke();
  c.fillStyle = map.accent;
  const fw = u * 0.7 + Math.sin(t * 6) * u * 0.06;
  c.beginPath();
  c.moveTo(0, -u * 1.85);
  c.lineTo(fw, -u * 1.65);
  c.lineTo(0, -u * 1.45);
  c.closePath();
  c.fill();
  c.restore();
}

function totalLen(wp: Vec[]): number {
  let total = 0;
  for (let i = 0; i < wp.length - 1; i++) {
    total += Math.hypot(wp[i + 1].x - wp[i].x, wp[i + 1].y - wp[i].y);
  }
  return total;
}

/* ----------------------------------------------------------------------- */
/* Towers                                                                   */
/* ----------------------------------------------------------------------- */

export function drawTower(
  c: CanvasRenderingContext2D,
  tw: Tower,
  vp: Viewport,
  selected: boolean,
  t: number,
) {
  const def = TOWERS[tw.kind];
  const s = gridToScreen(vp, tw.x, tw.y);
  const u = vp.cell * 0.46;

  c.save();
  c.translate(s.x, s.y);

  // shadow
  c.fillStyle = "rgba(0,0,0,0.25)";
  c.beginPath();
  c.ellipse(0, u * 0.85, u * 1.0, u * 0.42, 0, 0, Math.PI * 2);
  c.fill();

  // selection glow
  if (selected) {
    c.fillStyle = "rgba(255,210,90,0.25)";
    c.beginPath();
    c.arc(0, 0, u * 1.4, 0, Math.PI * 2);
    c.fill();
  }

  // base platform
  c.fillStyle = "#6b5536";
  roundRect(c, -u * 0.92, -u * 0.55, u * 1.84, u * 1.3, u * 0.3);
  c.fill();
  c.fillStyle = "#8a6e45";
  roundRect(c, -u * 0.82, -u * 0.62, u * 1.64, u * 0.5, u * 0.22);
  c.fill();

  const recoil = tw.recoil;
  if (tw.kind === "archer") drawArcher(c, u, def.body, def.accent, tw.angle, recoil);
  else if (tw.kind === "cannon") drawCannon(c, u, def.body, def.accent, tw.angle, recoil);
  else if (tw.kind === "frost") drawFrost(c, u, def.body, def.accent, t);
  else drawArcane(c, u, def.body, def.accent, t);

  // level pips
  c.fillStyle = UI.gold;
  for (let i = 0; i < tw.level; i++) {
    c.beginPath();
    c.arc(-u * 0.5 + i * u * 0.5, u * 0.55, u * 0.12, 0, Math.PI * 2);
    c.fill();
  }

  c.restore();
}

function drawArcher(
  c: CanvasRenderingContext2D,
  u: number,
  body: string,
  accent: string,
  angle: number,
  recoil: number,
) {
  c.save();
  c.rotate(angle);
  // post
  c.fillStyle = body;
  roundRect(c, -u * 0.32, -u * 0.7, u * 0.64, u * 0.9, u * 0.2);
  c.fill();
  // bow arc
  c.strokeStyle = accent;
  c.lineWidth = u * 0.16;
  c.beginPath();
  c.arc(u * (0.2 - recoil * 0.3), -u * 0.25, u * 0.5, -1.1, 1.1);
  c.stroke();
  // arrow nocked
  c.strokeStyle = "#fff";
  c.lineWidth = u * 0.1;
  c.beginPath();
  c.moveTo(u * (0.1 - recoil * 0.4), -u * 0.25);
  c.lineTo(u * (0.8 - recoil * 0.4), -u * 0.25);
  c.stroke();
  c.restore();
}

function drawCannon(
  c: CanvasRenderingContext2D,
  u: number,
  body: string,
  accent: string,
  angle: number,
  recoil: number,
) {
  c.save();
  c.rotate(angle);
  // barrel
  c.fillStyle = body;
  roundRect(c, -u * 0.2 - recoil * u * 0.3, -u * 0.34, u * 1.1, u * 0.68, u * 0.2);
  c.fill();
  c.fillStyle = accent;
  c.beginPath();
  c.arc(u * 0.9 - recoil * u * 0.3, 0, u * 0.34, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#1f1f24";
  c.beginPath();
  c.arc(u * 0.9 - recoil * u * 0.3, 0, u * 0.2, 0, Math.PI * 2);
  c.fill();
  // hub
  c.fillStyle = "#3a3f47";
  c.beginPath();
  c.arc(0, 0, u * 0.42, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawFrost(
  c: CanvasRenderingContext2D,
  u: number,
  body: string,
  accent: string,
  t: number,
) {
  // crystal spire
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(0, -u * 1.2);
  c.lineTo(u * 0.5, 0);
  c.lineTo(0, u * 0.4);
  c.lineTo(-u * 0.5, 0);
  c.closePath();
  c.fill();
  c.fillStyle = accent;
  c.beginPath();
  c.moveTo(0, -u * 1.2);
  c.lineTo(u * 0.22, -u * 0.2);
  c.lineTo(0, u * 0.1);
  c.closePath();
  c.fill();
  // orbiting frost motes
  c.fillStyle = accent;
  for (let i = 0; i < 3; i++) {
    const a = t * 2 + (i * Math.PI * 2) / 3;
    c.globalAlpha = 0.7;
    c.beginPath();
    c.arc(Math.cos(a) * u * 0.7, -u * 0.3 + Math.sin(a) * u * 0.3, u * 0.1, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

function drawArcane(
  c: CanvasRenderingContext2D,
  u: number,
  body: string,
  accent: string,
  t: number,
) {
  // pillar
  c.fillStyle = body;
  roundRect(c, -u * 0.3, -u * 0.5, u * 0.6, u * 0.9, u * 0.2);
  c.fill();
  // floating orb
  const fy = -u * 0.9 + Math.sin(t * 3) * u * 0.1;
  c.fillStyle = accent;
  c.globalAlpha = 0.4;
  c.beginPath();
  c.arc(0, fy, u * 0.55, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(0, fy, u * 0.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = body;
  c.beginPath();
  c.arc(0, fy, u * 0.16, 0, Math.PI * 2);
  c.fill();
  // runes
  c.strokeStyle = accent;
  c.lineWidth = u * 0.08;
  for (let i = 0; i < 3; i++) {
    const a = -t * 1.5 + (i * Math.PI * 2) / 3;
    c.beginPath();
    c.arc(Math.cos(a) * u * 0.7, fy + Math.sin(a) * u * 0.7, u * 0.08, 0, Math.PI * 2);
    c.stroke();
  }
}

/** Draw a tower icon for the shop (no board context). */
export function drawTowerIcon(
  c: CanvasRenderingContext2D,
  kind: TowerKind,
  x: number,
  y: number,
  u: number,
) {
  const def = TOWERS[kind];
  c.save();
  c.translate(x, y);
  c.fillStyle = "#6b5536";
  roundRect(c, -u * 0.85, -u * 0.45, u * 1.7, u * 1.1, u * 0.28);
  c.fill();
  if (kind === "archer") drawArcher(c, u, def.body, def.accent, -0.5, 0);
  else if (kind === "cannon") drawCannon(c, u, def.body, def.accent, -0.5, 0);
  else if (kind === "frost") drawFrost(c, u, def.body, def.accent, 0);
  else drawArcane(c, u, def.body, def.accent, 0);
  c.restore();
}

/* ----------------------------------------------------------------------- */
/* Enemies                                                                  */
/* ----------------------------------------------------------------------- */

export function drawEnemy(
  c: CanvasRenderingContext2D,
  e: Enemy,
  def: EnemyDef,
  vp: Viewport,
  t: number,
) {
  const s = gridToScreen(vp, e.x, e.y);
  const r = e.radius * vp.cell;
  const dir = directionAtEnemy(e);
  const bob = e.flying ? Math.sin(e.bob) * r * 0.4 : 0;

  c.save();
  // shadow
  c.fillStyle = "rgba(0,0,0,0.22)";
  c.beginPath();
  c.ellipse(s.x, s.y + r * 0.7, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
  c.fill();

  c.translate(s.x, s.y - r * 0.2 + bob);

  if (def.kind === "wisp") drawWisp(c, r, def, t, e.anim);
  else if (def.kind === "brute") drawBrute(c, r, def, dir, e.anim);
  else if (def.kind === "warden" || def.kind === "titan") drawBigBoss(c, r, def, e.anim, t);
  else drawCritter(c, r, def, dir, e.anim);

  // slow tint
  if (e.slowT > 0) {
    c.globalAlpha = 0.35;
    c.fillStyle = "#9fe8ff";
    c.beginPath();
    c.arc(0, 0, r * 1.05, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }
  // hit flash
  if (e.flash > 0) {
    c.globalAlpha = Math.min(1, e.flash * 4);
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(0, 0, r * 1.02, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }
  c.restore();

  // health bar
  if (e.hp < e.maxHp) {
    const big = def.kind === "warden" || def.kind === "titan";
    const w = r * (big ? 3 : 2.2);
    const h = Math.max(3, r * 0.22);
    const bx = s.x - w / 2;
    const by = s.y - r * 1.5 + bob;
    c.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(c, bx - 1, by - 1, w + 2, h + 2, h * 0.5);
    c.fill();
    const frac = Math.max(0, e.hp / e.maxHp);
    c.fillStyle = frac > 0.5 ? "#5fd66b" : frac > 0.25 ? "#ffcb45" : "#ff5d5d";
    roundRect(c, bx, by, w * frac, h, h * 0.5);
    c.fill();
  }
}

function directionAtEnemy(e: Enemy): Vec {
  return { x: e.faceX, y: e.faceY };
}

function drawCritter(
  c: CanvasRenderingContext2D,
  r: number,
  def: EnemyDef,
  dir: Vec,
  anim: number,
) {
  // legs
  c.fillStyle = def.accent;
  const legSwing = Math.sin(anim) * r * 0.4;
  c.fillRect(-r * 0.5, r * 0.3, r * 0.3, r * 0.6 + legSwing);
  c.fillRect(r * 0.2, r * 0.3, r * 0.3, r * 0.6 - legSwing);
  // body
  c.fillStyle = def.body;
  c.beginPath();
  c.ellipse(0, 0, r, r * 0.95, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = def.accent;
  c.beginPath();
  c.ellipse(0, -r * 0.35, r * 0.7, r * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  drawEyes(c, r, dir);
}

function drawBrute(
  c: CanvasRenderingContext2D,
  r: number,
  def: EnemyDef,
  dir: Vec,
  anim: number,
) {
  c.fillStyle = def.accent;
  const legSwing = Math.sin(anim) * r * 0.3;
  c.fillRect(-r * 0.6, r * 0.4, r * 0.4, r * 0.6 + legSwing);
  c.fillRect(r * 0.2, r * 0.4, r * 0.4, r * 0.6 - legSwing);
  // armored body
  c.fillStyle = def.body;
  roundRect(c, -r, -r * 0.9, r * 2, r * 1.8, r * 0.4);
  c.fill();
  // plates
  c.fillStyle = def.accent;
  c.fillRect(-r * 0.9, -r * 0.5, r * 1.8, r * 0.22);
  c.fillRect(-r * 0.9, 0, r * 1.8, r * 0.22);
  // rivets
  c.fillStyle = "#d8dde4";
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.arc(i * r * 0.6, -r * 0.75, r * 0.1, 0, Math.PI * 2);
    c.fill();
  }
  drawEyes(c, r * 0.8, dir);
}

function drawWisp(
  c: CanvasRenderingContext2D,
  r: number,
  def: EnemyDef,
  t: number,
  anim: number,
) {
  // wings
  const flap = Math.sin(anim * 1.5) * 0.5;
  c.fillStyle = "rgba(220,250,255,0.55)";
  for (const sgn of [-1, 1]) {
    c.save();
    c.scale(sgn, 1);
    c.rotate(flap);
    c.beginPath();
    c.ellipse(r * 0.7, -r * 0.2, r * 0.7, r * 0.35, -0.4, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  // glowing body
  c.globalAlpha = 0.5;
  c.fillStyle = def.accent;
  c.beginPath();
  c.arc(0, 0, r * 1.15 + Math.sin(t * 5) * r * 0.1, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = def.body;
  c.beginPath();
  c.arc(0, 0, r * 0.8, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(-r * 0.2, -r * 0.2, r * 0.22, 0, Math.PI * 2);
  c.arc(r * 0.3, -r * 0.1, r * 0.18, 0, Math.PI * 2);
  c.fill();
}

function drawBigBoss(
  c: CanvasRenderingContext2D,
  r: number,
  def: EnemyDef,
  anim: number,
  t: number,
) {
  // aura
  c.globalAlpha = 0.3;
  c.fillStyle = def.accent;
  c.beginPath();
  c.arc(0, 0, r * 1.3 + Math.sin(t * 4) * r * 0.1, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  // legs
  c.fillStyle = def.accent;
  const sw = Math.sin(anim) * r * 0.3;
  c.fillRect(-r * 0.7, r * 0.5, r * 0.45, r * 0.7 + sw);
  c.fillRect(r * 0.25, r * 0.5, r * 0.45, r * 0.7 - sw);
  // body
  c.fillStyle = def.body;
  c.beginPath();
  c.ellipse(0, 0, r, r * 1.05, 0, 0, Math.PI * 2);
  c.fill();
  // horns / crown
  c.fillStyle = def.accent;
  for (const sgn of [-1, 1]) {
    c.beginPath();
    c.moveTo(sgn * r * 0.4, -r * 0.7);
    c.lineTo(sgn * r * 0.9, -r * 1.5);
    c.lineTo(sgn * r * 0.65, -r * 0.6);
    c.closePath();
    c.fill();
  }
  // glowing eyes
  c.fillStyle = "#fff2a8";
  c.beginPath();
  c.arc(-r * 0.32, -r * 0.1, r * 0.18, 0, Math.PI * 2);
  c.arc(r * 0.32, -r * 0.1, r * 0.18, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#b8351a";
  c.beginPath();
  c.arc(-r * 0.32, -r * 0.1, r * 0.08, 0, Math.PI * 2);
  c.arc(r * 0.32, -r * 0.1, r * 0.08, 0, Math.PI * 2);
  c.fill();
}

function drawEyes(c: CanvasRenderingContext2D, r: number, dir: Vec) {
  const lx = dir.x * r * 0.2;
  const ly = dir.y * r * 0.2;
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(-r * 0.3, -r * 0.3, r * 0.22, 0, Math.PI * 2);
  c.arc(r * 0.3, -r * 0.3, r * 0.22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#1a1a1a";
  c.beginPath();
  c.arc(-r * 0.3 + lx, -r * 0.3 + ly, r * 0.1, 0, Math.PI * 2);
  c.arc(r * 0.3 + lx, -r * 0.3 + ly, r * 0.1, 0, Math.PI * 2);
  c.fill();
}

/* ----------------------------------------------------------------------- */
/* Projectiles                                                              */
/* ----------------------------------------------------------------------- */

export function drawProjectile(c: CanvasRenderingContext2D, p: Projectile, vp: Viewport) {
  const s = gridToScreen(vp, p.x, p.y);
  const u = vp.cell;
  if (p.kind === "archer") {
    const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
    c.save();
    c.translate(s.x, s.y);
    c.rotate(ang);
    c.strokeStyle = "#fff0c0";
    c.lineWidth = u * 0.08;
    c.beginPath();
    c.moveTo(-u * 0.25, 0);
    c.lineTo(u * 0.25, 0);
    c.stroke();
    c.fillStyle = "#ffe6a6";
    c.beginPath();
    c.moveTo(u * 0.3, 0);
    c.lineTo(u * 0.15, -u * 0.08);
    c.lineTo(u * 0.15, u * 0.08);
    c.closePath();
    c.fill();
    c.restore();
  } else if (p.kind === "cannon") {
    c.fillStyle = "#2a2a30";
    c.beginPath();
    c.arc(s.x, s.y, u * 0.18, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ff9d4d";
    c.beginPath();
    c.arc(s.x - u * 0.05, s.y - u * 0.05, u * 0.06, 0, Math.PI * 2);
    c.fill();
  } else if (p.kind === "frost") {
    c.fillStyle = "#d6f4ff";
    c.save();
    c.translate(s.x, s.y);
    c.rotate(p.age * 12);
    for (let i = 0; i < 6; i++) {
      c.rotate(Math.PI / 3);
      c.fillRect(-u * 0.03, 0, u * 0.06, u * 0.16);
    }
    c.restore();
  } else {
    c.fillStyle = "rgba(233,200,255,0.5)";
    c.beginPath();
    c.arc(s.x, s.y, u * 0.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(s.x, s.y, u * 0.1, 0, Math.PI * 2);
    c.fill();
  }
}
