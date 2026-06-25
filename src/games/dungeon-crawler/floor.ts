import {
  COLS,
  ROWS,
  DIRS,
  DIR_VEC,
  OPPOSITE,
  FLOOR_GRID,
  type Dir,
} from "./config";
import type {
  EnemyKind,
  GridCell,
  Pickup,
  RoomDef,
  SpawnSpec,
} from "./types";
import { rollItemId } from "./items";

export interface Floor {
  rooms: Map<string, RoomDef>;
  start: { gx: number; gy: number };
  bossKey: string;
  number: number;
}

const key = (gx: number, gy: number) => `${gx},${gy}`;

function emptyDoors(): Record<Dir, boolean> {
  return { N: false, E: false, S: false, W: false };
}

function makeRoom(gx: number, gy: number): RoomDef {
  return {
    gx,
    gy,
    type: "combat",
    doors: emptyDoors(),
    cleared: false,
    visited: false,
    triggered: false,
    obstacles: [],
    spawns: [],
    pickups: [],
    dist: 0,
    trapdoor: false,
    trapOpen: false,
  };
}

const randInt = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

/** Generate one floor. `rand` is a seeded mulberry32. */
export function generateFloor(rand: () => number, floorNum: number): Floor {
  const rooms = new Map<string, RoomDef>();
  const c = Math.floor(FLOOR_GRID / 2);
  const start = { gx: c, gy: c };

  const startRoom = makeRoom(c, c);
  startRoom.type = "start";
  startRoom.cleared = true;
  startRoom.triggered = true;
  startRoom.visited = true;
  rooms.set(key(c, c), startRoom);

  const budget = Math.min(16, Math.max(6, 6 + floorNum));

  // Random growth: maintain a frontier of placed rooms; expand outward.
  let guard = 0;
  while (rooms.size < budget && guard++ < 4000) {
    const existing = [...rooms.values()];
    const from = existing[randInt(rand, 0, existing.length - 1)];
    const dir = DIRS[randInt(rand, 0, 3)];
    const v = DIR_VEC[dir];
    const nx = from.gx + v.x;
    const ny = from.gy + v.y;
    if (nx < 0 || ny < 0 || nx >= FLOOR_GRID || ny >= FLOOR_GRID) continue;
    const k = key(nx, ny);
    if (rooms.has(k)) continue;
    // Bias against rooms with many existing neighbours so we get more dead-ends.
    let nb = 0;
    for (const d of DIRS) {
      const vv = DIR_VEC[d];
      if (rooms.has(key(nx + vv.x, ny + vv.y))) nb++;
    }
    if (nb > 1 && rand() < 0.6) continue;

    const room = makeRoom(nx, ny);
    rooms.set(k, room);
    // connect to source
    from.doors[dir] = true;
    room.doors[OPPOSITE[dir]] = true;
  }

  // A few extra connections to form occasional loops.
  if (rand() < 0.6) addLoop(rooms, rand);

  // BFS distances from start.
  bfs(rooms, start);

  // Pick special rooms.
  const all = [...rooms.values()].filter((r) => r.type === "combat");
  // Boss: farthest, prefer dead-end (1 door).
  const sorted = all.slice().sort((a, b) => b.dist - a.dist);
  const boss = sorted.find((r) => doorCount(r) === 1) ?? sorted[0];
  boss.type = "boss";
  const bossKey = key(boss.gx, boss.gy);

  // Treasure: a dead-end not the boss, prefer not adjacent to start.
  const deadEnds = all.filter(
    (r) => r !== boss && doorCount(r) === 1,
  );
  deadEnds.sort((a, b) => b.dist - a.dist);
  const treasure = deadEnds.shift();
  if (treasure) treasure.type = "treasure";

  // Shop: another dead-end if available, else a far combat room.
  let shop = deadEnds.shift();
  if (!shop) {
    shop = all.find(
      (r) => r.type === "combat" && r !== boss && r.dist >= 2,
    );
  }
  if (shop && shop.type === "combat") shop.type = "shop";

  // Fill room contents.
  for (const room of rooms.values()) {
    if (room.type === "combat") {
      room.obstacles = makeObstacles(rand);
      room.spawns = rollSpawns(rand, floorNum, room);
    } else if (room.type === "boss") {
      room.obstacles = makeBossObstacles(rand);
      room.spawns = [{ kind: "boss", x: COLS / 2, y: ROWS / 2 - 0.5 }];
    } else if (room.type === "treasure") {
      room.cleared = true;
      room.triggered = true;
      room.obstacles = [];
      room.pickups = [
        {
          kind: "item",
          x: COLS / 2,
          y: ROWS / 2,
          itemId: rollItemId(rand),
          t: 0,
        },
      ];
    } else if (room.type === "shop") {
      room.cleared = true;
      room.triggered = true;
      room.obstacles = [];
      room.pickups = makeShop(rand, floorNum);
    }
  }

  return { rooms, start, bossKey, number: floorNum };
}

function doorCount(r: RoomDef): number {
  let n = 0;
  for (const d of DIRS) if (r.doors[d]) n++;
  return n;
}

function addLoop(rooms: Map<string, RoomDef>, rand: () => number) {
  const list = [...rooms.values()];
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = list[randInt(rand, 0, list.length - 1)];
    const dir = DIRS[randInt(rand, 0, 3)];
    if (r.doors[dir]) continue;
    const v = DIR_VEC[dir];
    const nb = rooms.get(key(r.gx + v.x, r.gy + v.y));
    if (!nb) continue;
    if (nb.type === "boss" || r.type === "boss") continue;
    r.doors[dir] = true;
    nb.doors[OPPOSITE[dir]] = true;
    return;
  }
}

function bfs(rooms: Map<string, RoomDef>, start: { gx: number; gy: number }) {
  for (const r of rooms.values()) r.dist = Infinity;
  const sk = key(start.gx, start.gy);
  const s = rooms.get(sk);
  if (!s) return;
  s.dist = 0;
  const queue: RoomDef[] = [s];
  while (queue.length) {
    const cur = queue.shift() as RoomDef;
    for (const d of DIRS) {
      if (!cur.doors[d]) continue;
      const v = DIR_VEC[d];
      const nb = rooms.get(key(cur.gx + v.x, cur.gy + v.y));
      if (nb && nb.dist > cur.dist + 1) {
        nb.dist = cur.dist + 1;
        queue.push(nb);
      }
    }
  }
}

/** Symmetric interior obstacles, never blocking the central cross/doorways. */
function makeObstacles(rand: () => number): GridCell[] {
  const cells: GridCell[] = [];
  const seen = new Set<string>();
  const n = randInt(rand, 0, 3);
  const midX = (COLS - 1) / 2;
  for (let i = 0; i < n; i++) {
    const cx = randInt(rand, 2, Math.floor(midX) - 1);
    const cy = randInt(rand, 2, ROWS - 3);
    for (const c of [
      { cx, cy },
      { cx: COLS - 1 - cx, cy },
    ]) {
      const k = `${c.cx},${c.cy}`;
      if (seen.has(k)) continue;
      // keep central horizontal and vertical lanes clear for door access
      if (c.cy === Math.floor((ROWS - 1) / 2)) continue;
      if (c.cx === Math.floor(midX)) continue;
      seen.add(k);
      cells.push(c);
    }
  }
  return cells;
}

function makeBossObstacles(rand: () => number): GridCell[] {
  // sparse corner rubble only
  if (rand() < 0.5) return [];
  return [
    { cx: 2, cy: 2 },
    { cx: COLS - 3, cy: 2 },
    { cx: 2, cy: ROWS - 3 },
    { cx: COLS - 3, cy: ROWS - 3 },
  ];
}

const ENEMY_POOL: EnemyKind[] = ["crawler", "spitter", "blob"];

function rollSpawns(
  rand: () => number,
  floorNum: number,
  room: RoomDef,
): SpawnSpec[] {
  const spawns: SpawnSpec[] = [];
  const count = Math.min(8, 2 + Math.floor((floorNum + room.dist) / 2));
  const pool = ENEMY_POOL.slice();
  if (floorNum >= 3) pool.push("floater");
  const blocked = new Set(room.obstacles.map((o) => `${o.cx},${o.cy}`));
  for (let i = 0; i < count; i++) {
    let kind = pool[randInt(rand, 0, pool.length - 1)];
    // weight: more crawlers early
    if (floorNum <= 1 && rand() < 0.4) kind = "crawler";
    let cx = randInt(rand, 2, COLS - 3);
    let cy = randInt(rand, 2, ROWS - 3);
    let guard = 0;
    while (blocked.has(`${cx},${cy}`) && guard++ < 10) {
      cx = randInt(rand, 2, COLS - 3);
      cy = randInt(rand, 2, ROWS - 3);
    }
    spawns.push({ kind, x: cx + 0.5, y: cy + 0.5 });
  }
  return spawns;
}

function makeShop(rand: () => number, floorNum: number): Pickup[] {
  const items: Pickup[] = [];
  const count = randInt(rand, 2, 3);
  const exclude = new Set<string>();
  const baseY = ROWS / 2;
  const startX = (COLS - (count - 1) * 3) / 2;
  for (let i = 0; i < count; i++) {
    const roll = rand();
    if (roll < 0.55) {
      items.push({
        kind: "item" as const,
        x: startX + i * 3,
        y: baseY,
        itemId: (() => {
          const id = rollItemId(rand, exclude);
          exclude.add(id);
          return id;
        })(),
        cost: 8 + floorNum * 2,
        t: 0,
      });
    } else if (roll < 0.8) {
      items.push({
        kind: "heart" as const,
        x: startX + i * 3,
        y: baseY,
        cost: 5,
        t: 0,
      });
    } else {
      items.push({
        kind: "coin" as const,
        x: startX + i * 3,
        y: baseY,
        cost: 0,
        t: 0,
      });
    }
  }
  return items;
}
