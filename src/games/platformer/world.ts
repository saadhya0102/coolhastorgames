import { TILE } from "./constants";
import type { Body, TileQuery } from "./physics";
import { collide } from "./physics";
import type { Box, LevelDef, MoverDef, PickupKind, Palette, TileType, Vec } from "./types";
import { Enemy } from "./enemies";

const CHAR_TO_TILE: Record<string, TileType> = {
  "#": "ground",
  D: "dirt",
  B: "brick",
  "?": "question",
  "=": "oneway",
  "^": "spike",
  "~": "lava",
  C: "checkpoint",
  G: "goal",
};

export interface Coin {
  x: number; // center
  y: number;
  collected: boolean;
  phase: number;
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  dir: number;
  active: boolean;
  phase: number;
  grounded: boolean;
}

export interface Checkpoint {
  x: number;
  y: number;
  active: boolean;
}

/** An oscillating moving platform. */
export class Mover {
  x: number;
  y: number;
  w: number;
  h: number;
  dx = 0;
  dy = 0;
  private baseX: number;
  private baseY: number;
  private amp: number;
  private omega: number;
  private phase: number;
  private t = 0;
  private axis: "h" | "v";

  constructor(def: MoverDef) {
    this.baseX = def.col * TILE;
    this.baseY = def.row * TILE;
    this.w = def.tiles * TILE;
    this.h = TILE * 0.55;
    this.amp = def.range * TILE;
    this.omega = (def.speed / Math.max(0.5, def.range)) * 1.0;
    this.phase = def.phase * Math.PI * 2;
    this.axis = def.axis;
    this.x = this.baseX;
    this.y = this.baseY;
  }

  update(dt: number) {
    this.t += dt;
    const off = Math.sin(this.t * this.omega + this.phase) * this.amp;
    const nx = this.axis === "h" ? this.baseX + off : this.baseX;
    const ny = this.axis === "v" ? this.baseY + off : this.baseY;
    this.dx = nx - this.x;
    this.dy = ny - this.y;
    this.x = nx;
    this.y = ny;
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }
}

export class World implements TileQuery {
  cols = 0;
  rows = 0;
  tiles: TileType[][] = [];
  palette: Palette;
  name: string;
  timeLimit: number;

  coins: Coin[] = [];
  pickups: Pickup[] = [];
  enemies: Enemy[] = [];
  movers: Mover[] = [];
  checkpoints: Checkpoint[] = [];
  goal: Box = { x: 0, y: 0, w: TILE, h: TILE * 2 };
  playerStart: Vec = { x: TILE * 2, y: TILE * 2 };

  /** question blocks already spent (key = col*10000+row) */
  private usedQuestions = new Set<number>();

  constructor(def: LevelDef) {
    this.palette = def.palette;
    this.name = def.name;
    this.timeLimit = def.timeLimit;
    this.parse(def);
    for (const m of def.movers) this.movers.push(new Mover(m));
  }

  private parse(def: LevelDef) {
    const width = def.rows.reduce((m, r) => Math.max(m, r.length), 0);
    this.cols = width;
    this.rows = def.rows.length;
    const padded = def.rows.map((r) => r.padEnd(width, " "));

    let goalMinX = Infinity;
    let goalMinY = Infinity;
    let goalMaxX = -Infinity;
    let goalMaxY = -Infinity;

    for (let row = 0; row < this.rows; row++) {
      const tileRow: TileType[] = [];
      for (let col = 0; col < width; col++) {
        const ch = padded[row][col];
        const cx = col * TILE + TILE / 2;
        const cy = row * TILE + TILE / 2;
        let t: TileType = "empty";
        switch (ch) {
          case "o":
            this.coins.push({ x: cx, y: cy, collected: false, phase: Math.random() * Math.PI * 2 });
            break;
          case "P":
            this.playerStart = { x: col * TILE, y: row * TILE };
            break;
          case "g":
            this.enemies.push(new Enemy("grumbug", cx, cy));
            break;
          case "f":
            this.enemies.push(new Enemy("flutter", cx, cy));
            break;
          case "s":
            this.enemies.push(new Enemy("snapper", cx, cy));
            break;
          case "m":
            this.pickups.push(this.makePickup("mushroom", col, row));
            break;
          case "*":
            this.pickups.push(this.makePickup("star", col, row));
            break;
          default: {
            const mapped = CHAR_TO_TILE[ch];
            if (mapped) t = mapped;
            break;
          }
        }
        if (t === "checkpoint") {
          this.checkpoints.push({ x: cx, y: row * TILE, active: false });
        }
        if (t === "goal") {
          goalMinX = Math.min(goalMinX, col * TILE);
          goalMinY = Math.min(goalMinY, row * TILE);
          goalMaxX = Math.max(goalMaxX, col * TILE + TILE);
          goalMaxY = Math.max(goalMaxY, row * TILE + TILE);
        }
        tileRow.push(t);
      }
      this.tiles.push(tileRow);
    }

    if (goalMaxX > goalMinX) {
      this.goal = { x: goalMinX, y: goalMinY, w: goalMaxX - goalMinX, h: goalMaxY - goalMinY };
    }
  }

  private makePickup(kind: PickupKind, col: number, row: number): Pickup {
    return {
      kind,
      x: col * TILE + TILE * 0.1,
      y: row * TILE + TILE * 0.1,
      w: TILE * 0.8,
      h: TILE * 0.8,
      vx: kind === "mushroom" ? 85 : 0,
      vy: 0,
      dir: 1,
      active: true,
      phase: Math.random() * Math.PI * 2,
      grounded: false,
    };
  }

  // ---- TileQuery ----
  typeAt(col: number, row: number): TileType {
    if (row < 0 || row >= this.rows) return "empty";
    if (col < 0) return "ground"; // invisible left wall
    if (col >= this.cols) return "empty";
    return this.tiles[row][col];
  }

  solidAt(col: number, row: number): boolean {
    const t = this.typeAt(col, row);
    return t === "ground" || t === "dirt" || t === "brick" || t === "question";
  }

  oneWayAt(col: number, row: number): boolean {
    return this.typeAt(col, row) === "oneway";
  }

  /** Hazard type overlapping a world-space box. */
  hazardAt(box: Box): "none" | "spike" | "lava" {
    const c0 = Math.floor(box.x / TILE);
    const c1 = Math.floor((box.x + box.w) / TILE);
    const r0 = Math.floor(box.y / TILE);
    const r1 = Math.floor((box.y + box.h) / TILE);
    let found: "none" | "spike" | "lava" = "none";
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = this.typeAt(c, r);
        if (t === "lava") {
          // require meaningful overlap (lava sits a bit lower)
          if (overlapTile(box, c, r, 0.2)) return "lava";
        } else if (t === "spike") {
          if (overlapTile(box, c, r, 0.35)) found = "spike";
        }
      }
    }
    return found;
  }

  /** Break a brick tile (Big Pip). Returns true if broken. */
  breakBrick(col: number, row: number): boolean {
    if (this.typeAt(col, row) === "brick") {
      this.tiles[row][col] = "empty";
      return true;
    }
    return false;
  }

  /** Bump a question block from below. Returns its content (or null if spent). */
  bumpQuestion(col: number, row: number): "coin" | null {
    if (this.typeAt(col, row) !== "question") return null;
    const key = col * 10000 + row;
    if (this.usedQuestions.has(key)) return null;
    this.usedQuestions.add(key);
    return "coin";
  }

  isQuestionSpent(col: number, row: number): boolean {
    return this.usedQuestions.has(col * 10000 + row);
  }

  updateMovers(dt: number) {
    for (const m of this.movers) m.update(dt);
  }

  /** Land a falling body on top of any mover. Mutates body. Returns the mover
   *  the body landed on (so the caller can carry it next frame), or null. */
  landOnMovers(body: Body, prevBottom: number): Mover | null {
    if (body.vy < 0) return null;
    for (const m of this.movers) {
      const top = m.y;
      const withinX = body.x + body.w > m.x + 2 && body.x < m.x + m.w - 2;
      const bottom = body.y + body.h;
      if (withinX && prevBottom <= top + 2 && bottom >= top) {
        body.y = top - body.h;
        body.vy = 0;
        return m;
      }
    }
    return null;
  }

  updatePickups(dt: number) {
    for (const p of this.pickups) {
      if (!p.active) continue;
      p.phase += dt;
      if (p.kind === "oneup") continue;
      p.vy = Math.min(1000, p.vy + 2200 * dt);
      const body: Body = { x: p.x, y: p.y, w: p.w, h: p.h, vx: p.vx, vy: p.vy };
      const prevBottom = body.y + body.h;
      const r = collide(body, dt, this);
      const mover = this.landOnMovers(body, prevBottom);
      p.x = body.x;
      p.y = body.y;
      p.vy = body.vy;
      p.grounded = r.grounded || mover !== null;
      if (p.kind === "mushroom") {
        if (r.wallLeft || r.wallRight) p.dir = -p.dir;
        // turn at ledges when grounded
        if (p.grounded) {
          const aheadCol = Math.floor((p.dir > 0 ? p.x + p.w + 2 : p.x - 2) / TILE);
          const footRow = Math.floor((p.y + p.h + 4) / TILE);
          if (!this.solidAt(aheadCol, footRow) && !this.oneWayAt(aheadCol, footRow)) {
            p.dir = -p.dir;
          }
        }
        p.vx = 85 * p.dir;
      } else if (p.kind === "star") {
        if (r.wallLeft || r.wallRight) p.dir = -p.dir;
        p.vx = 120 * p.dir;
        if (p.grounded) p.vy = -520; // bounce
      }
    }
  }
}

function overlapTile(box: Box, col: number, row: number, inset: number): boolean {
  const tx = col * TILE + TILE * inset;
  const ty = row * TILE + TILE * inset;
  const tw = TILE * (1 - inset * 2);
  const th = TILE * (1 - inset * 2);
  return box.x < tx + tw && box.x + box.w > tx && box.y < ty + th && box.y + box.h > ty;
}
