import { TILE } from "./constants";
import type { TileType } from "./types";

/** Minimal interface a collidable world must expose (breaks import cycles). */
export interface TileQuery {
  cols: number;
  rows: number;
  /** full solid (ground/dirt/brick/question) */
  solidAt(col: number, row: number): boolean;
  /** one-way platform (solid from above only) */
  oneWayAt(col: number, row: number): boolean;
  typeAt(col: number, row: number): TileType;
}

/** A movable body in world space. */
export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export interface CollideResult {
  grounded: boolean;
  ceiling: boolean;
  wallLeft: boolean;
  wallRight: boolean;
  /** solid tiles struck from below this move (col,row) */
  bumped: { col: number; row: number; type: TileType }[];
}

const EPS = 0.001;

/** Move `body` by its velocity over `dt`, resolving against solid + one-way
 *  tiles using axis-separated AABB with sub-stepping to prevent tunneling.
 *  `opts.dropThrough` lets the body fall through one-way platforms. */
export function collide(
  body: Body,
  dt: number,
  q: TileQuery,
  opts: { dropThrough?: boolean; useOneWay?: boolean } = {},
): CollideResult {
  const useOneWay = opts.useOneWay !== false;
  const res: CollideResult = {
    grounded: false,
    ceiling: false,
    wallLeft: false,
    wallRight: false,
    bumped: [],
  };

  const dx = body.vx * dt;
  const dy = body.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;

  for (let s = 0; s < steps; s++) {
    // ---- X axis ----
    if (sx !== 0) {
      body.x += sx;
      const top = Math.floor((body.y + EPS) / TILE);
      const bot = Math.floor((body.y + body.h - EPS) / TILE);
      if (sx > 0) {
        const col = Math.floor((body.x + body.w - EPS) / TILE);
        if (anySolidCol(q, col, top, bot)) {
          body.x = col * TILE - body.w - EPS;
          body.vx = 0;
          res.wallRight = true;
        }
      } else {
        const col = Math.floor((body.x + EPS) / TILE);
        if (anySolidCol(q, col, top, bot)) {
          body.x = (col + 1) * TILE + EPS;
          body.vx = 0;
          res.wallLeft = true;
        }
      }
    }

    // ---- Y axis ----
    if (sy !== 0) {
      const prevBottom = body.y + body.h;
      body.y += sy;
      const left = Math.floor((body.x + EPS) / TILE);
      const right = Math.floor((body.x + body.w - EPS) / TILE);
      if (sy > 0) {
        const row = Math.floor((body.y + body.h - EPS) / TILE);
        let landed = false;
        for (let col = left; col <= right; col++) {
          if (q.solidAt(col, row)) { landed = true; break; }
          if (useOneWay && !opts.dropThrough && q.oneWayAt(col, row)) {
            // only land if we were above the platform top before moving
            if (prevBottom <= row * TILE + EPS + Math.abs(sy)) { landed = true; break; }
          }
        }
        if (landed) {
          body.y = row * TILE - body.h - EPS;
          body.vy = 0;
          res.grounded = true;
        }
      } else {
        const row = Math.floor((body.y + EPS) / TILE);
        let hit = false;
        for (let col = left; col <= right; col++) {
          if (q.solidAt(col, row)) {
            hit = true;
            res.bumped.push({ col, row, type: q.typeAt(col, row) });
          }
        }
        if (hit) {
          body.y = (row + 1) * TILE + EPS;
          body.vy = 0;
          res.ceiling = true;
        }
      }
    }
  }

  return res;
}

function anySolidCol(q: TileQuery, col: number, top: number, bot: number): boolean {
  for (let row = top; row <= bot; row++) {
    if (q.solidAt(col, row)) return true;
  }
  return false;
}
