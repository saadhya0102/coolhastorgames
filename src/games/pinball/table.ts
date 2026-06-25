/**
 * Neon Nexus — procedural table layout.
 *
 * Pure data describing every collider/feature in VIRTUAL coordinates
 * (0..TABLE_W, 0..TABLE_H). Built once; the renderer + physics consume it.
 * Nothing here touches the canvas or the engine, so the whole table is easy to
 * tweak and is perfectly resolution independent.
 */
import { TABLE_W, TABLE_H, FLIPPER_LEN } from "./constants";
import type { Vec2 } from "./vec";
import { norm } from "./vec";

const D2R = Math.PI / 180;

export interface WallSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  thick: number;
  /** when set, the ball may pass freely while moving along this direction */
  oneWay?: Vec2;
}

export interface Bumper {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface Slingshot {
  id: string;
  /** collidable kicking face A->B */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** third vertex (for drawing the triangle, toward the outer wall) */
  cx: number;
  cy: number;
  /** outward face normal (toward play area), precomputed */
  nx: number;
  ny: number;
}

export interface DropTarget {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dropped: boolean;
}

export interface Standup {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface LaneRollover {
  id: string;
  letter: string;
  x: number;
  y: number;
  r: number;
  lit: boolean;
}

export interface CoreTarget {
  x: number;
  y: number;
  r: number;
}

export interface FlipperSpec {
  id: "L" | "R";
  pivot: Vec2;
  length: number;
  restAngle: number;
  activeAngle: number;
}

export interface PlungerSpec {
  laneCx: number;
  laneX0: number;
  laneX1: number;
  restY: number;
  topY: number;
}

export interface TableLayout {
  walls: WallSeg[];
  bumpers: Bumper[];
  slings: Slingshot[];
  drops: DropTarget[];
  standups: Standup[];
  lanes: LaneRollover[];
  core: CoreTarget;
  flippers: FlipperSpec[];
  plunger: PlungerSpec;
  drainY: number;
  /** decorative polylines (no collision) for the playfield art */
  decals: { pts: Vec2[]; color: string; width: number }[];
}

function faceNormalToward(ax: number, ay: number, bx: number, by: number, towardX: number, towardY: number): Vec2 {
  // two candidate normals
  const dx = bx - ax;
  const dy = by - ay;
  const n1 = norm({ x: -dy, y: dx });
  const midx = (ax + bx) / 2;
  const midy = (ay + by) / 2;
  const toward = { x: towardX - midx, y: towardY - midy };
  return n1.x * toward.x + n1.y * toward.y >= 0 ? n1 : { x: -n1.x, y: -n1.y };
}

export function buildTable(): TableLayout {
  const walls: WallSeg[] = [];
  const wall = (ax: number, ay: number, bx: number, by: number, thick = 6, oneWay?: Vec2) =>
    walls.push({ ax, ay, bx, by, thick, oneWay });

  // ---- Top arch (dome) sampled as short segments --------------------------
  const archPts: Vec2[] = [
    { x: 34, y: 220 },
    { x: 40, y: 150 },
    { x: 70, y: 95 },
    { x: 130, y: 55 },
    { x: 210, y: 36 },
    { x: 290, y: 34 },
    { x: 372, y: 50 },
    { x: 448, y: 92 },
    { x: 506, y: 132 },
    { x: 540, y: 168 },
  ];
  for (let i = 0; i < archPts.length - 1; i++) {
    wall(archPts[i].x, archPts[i].y, archPts[i + 1].x, archPts[i + 1].y, 7);
  }

  // ---- Outer walls --------------------------------------------------------
  // Left wall down from arch start
  wall(34, 220, 34, 560, 7);
  // Left funnel toward the flipper
  wall(34, 560, 58, 690, 7);
  wall(58, 690, 86, 812, 7);
  wall(86, 812, 120, 922, 7);
  wall(120, 922, 152, 1000, 7);

  // Right outer wall (encloses the plunger lane)
  wall(540, 168, 540, 1000, 7);
  // Lane inner wall (separates plunger lane from the playfield)
  wall(498, 236, 498, 560, 6);
  // Lane bottom
  wall(498, 978, 540, 978, 6);
  // One-way launch gate at the top of the lane (ball passes while moving up)
  wall(498, 238, 540, 224, 6, { x: 0, y: -1 });

  // Right funnel toward the right flipper
  wall(498, 560, 470, 690, 7);
  wall(470, 690, 440, 812, 7);
  wall(440, 812, 410, 922, 7);
  wall(410, 922, 380, 1000, 7);

  // ---- Bumpers ------------------------------------------------------------
  const bumpers: Bumper[] = [
    { id: "b1", x: 214, y: 358, r: 34 },
    { id: "b2", x: 346, y: 358, r: 34 },
    { id: "b3", x: 280, y: 462, r: 34 },
  ];

  // ---- Slingshots (kicking face + triangle) -------------------------------
  const mkSling = (id: string, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, towardX: number, towardY: number): Slingshot => {
    const n = faceNormalToward(ax, ay, bx, by, towardX, towardY);
    return { id, ax, ay, bx, by, cx, cy, nx: n.x, ny: n.y };
  };
  const slings: Slingshot[] = [
    // left sling: face from upper (150,716) to lower (206,818), kicks toward center
    mkSling("sl", 150, 716, 206, 818, 112, 792, 320, 760),
    // right sling: mirror
    mkSling("sr", 410, 716, 354, 818, 448, 792, 240, 760),
  ];

  // ---- Drop target bank (upper-left, faces right) -------------------------
  const drops: DropTarget[] = [
    { id: "d0", ax: 66, ay: 300, bx: 104, by: 300, dropped: false },
    { id: "d1", ax: 66, ay: 350, bx: 104, by: 350, dropped: false },
    { id: "d2", ax: 66, ay: 400, bx: 104, by: 400, dropped: false },
    { id: "d3", ax: 66, ay: 450, bx: 104, by: 450, dropped: false },
  ];

  // ---- Standup targets (right mid-field, face left) -----------------------
  const standups: Standup[] = [
    { id: "u0", ax: 478, ay: 398, bx: 478, by: 438 },
    { id: "u1", ax: 478, ay: 470, bx: 478, by: 510 },
  ];

  // ---- Rollover lanes (top sensors): N E X --------------------------------
  const lanes: LaneRollover[] = [
    { id: "ln0", letter: "N", x: 176, y: 150, r: 17, lit: false },
    { id: "ln1", letter: "E", x: 282, y: 132, r: 17, lit: false },
    { id: "ln2", letter: "X", x: 388, y: 150, r: 17, lit: false },
  ];

  // ---- The Core (captive saucer in mid-table) -----------------------------
  const core: CoreTarget = { x: 280, y: 596, r: 27 };

  // ---- Flippers -----------------------------------------------------------
  const flippers: FlipperSpec[] = [
    {
      id: "L",
      pivot: { x: 124, y: 852 },
      length: FLIPPER_LEN * 0.8,
      restAngle: 25 * D2R,
      activeAngle: -30 * D2R,
    },
    {
      id: "R",
      pivot: { x: 410, y: 852 },
      length: FLIPPER_LEN * 0.8,
      restAngle: 155 * D2R,
      activeAngle: 210 * D2R,
    },
  ];

  // ---- Plunger ------------------------------------------------------------
  const plunger: PlungerSpec = {
    laneCx: 519,
    laneX0: 504,
    laneX1: 534,
    restY: 946,
    topY: 250,
  };

  // ---- Decorative inlane / outlane guides (visual only) -------------------
  const decals: { pts: Vec2[]; color: string; width: number }[] = [
    { pts: [{ x: 150, y: 700 }, { x: 196, y: 836 }], color: "rgba(120,110,255,0.5)", width: 4 },
    { pts: [{ x: 410, y: 700 }, { x: 364, y: 836 }], color: "rgba(120,110,255,0.5)", width: 4 },
  ];

  return {
    walls,
    bumpers,
    slings,
    drops,
    standups,
    lanes,
    core,
    flippers,
    plunger,
    drainY: 970,
    decals,
  };
}

export { TABLE_W, TABLE_H };
