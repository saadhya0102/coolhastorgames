/**
 * Tank Battle — top-down ricochet tank skirmish.
 * Original design + procedural art. See PRD.md for the full spec.
 *
 * Everything is simulated in "world" units (1 unit = 1 grid tile) so the game
 * is fully independent of canvas size / aspect. A per-frame transform maps world
 * space to CSS pixels (centred + letterboxed).
 */

import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, roundRect } from "@/engine";
import {
  Tile,
  Phase,
  type Tank,
  type Shell,
  type Mine,
  type Particle,
  type Decal,
  type FloatingText,
  type ArchetypeDef,
} from "./types";
import { ARCHETYPES, PLAYER_PALETTE, getLevel } from "./levels";

/* ------------------------------------------------------------------ */
/* Tuning constants (world units / seconds).                          */
/* ------------------------------------------------------------------ */

const DT_CLAMP = 1 / 30;
const TANK_R = 0.36;

const PLAYER_SPEED = 3.5;
const PLAYER_ACCEL = PLAYER_SPEED / 0.1;
const PLAYER_FRICTION = PLAYER_SPEED / 0.08;
const PLAYER_TURRET_RATE = 16; // rad/s
const ENEMY_TURRET_RATE = 7; // rad/s

const SHELL_SPEED = 7.6;
const SHELL_R = 0.13;
const PLAYER_BOUNCES = 1;
const PLAYER_MAX_SHELLS = 5;
const PLAYER_FIRE_CD = 0.27;
const SHELL_LIFE = 6;
const OWNER_GRACE = 0.16;

const MINE_BLAST_R = 1.75;
const MINE_ARM = 0.8;
const MINE_FUSE = 9;
const MINE_PROX = 0.9;
const PLAYER_MAX_MINES = 2;
const PLAYER_MINE_CD = 0.7;

const LIVES_START = 3;
const RESPAWN_INVULN = 2.2;

const INTRO_TIME = 1.7;
const CLEAR_TIME = 1.9;
const DEAD_TIME = 1.5;

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Small math helpers.                                                 */
/* ------------------------------------------------------------------ */

function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d < -Math.PI) d += TAU;
  if (d > Math.PI) d -= TAU;
  return d;
}

function angApproach(a: number, target: number, maxStep: number): number {
  const d = angDiff(a, target);
  if (Math.abs(d) <= maxStep) return target;
  return a + Math.sign(d) * maxStep;
}

function approach(v: number, target: number, maxStep: number): number {
  if (v < target) return Math.min(v + maxStep, target);
  if (v > target) return Math.max(v - maxStep, target);
  return v;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  /* ---------------- persistent ---------------- */
  let best = storage.get<number>("best", 0);
  let lifetimeKills = storage.get<number>("kills", 0);

  /* ---------------- run state ----------------- */
  let phase: Phase = Phase.Title;
  let level = 1;
  let lives = LIVES_START;
  let score = 0;
  let phaseTimer = 0;
  let titleT = 0;

  /* ---------------- world --------------------- */
  let grid: Tile[][] = [[]];
  let cols = 0;
  let rows = 0;
  let playerSpawn = { x: 1.5, y: 1.5 };

  let player: Tank = makeTank(1.5, 1.5, null);
  let tanks: Tank[] = [player];
  let shells: Shell[] = [];
  let mines: Mine[] = [];
  let particles: Particle[] = [];
  let decals: Decal[] = [];
  let floats: FloatingText[] = [];

  /* ---------------- screen layout (recomputed per frame) ---------- */
  let tile = 32;
  let ox = 0;
  let oy = 0;
  let hudH = 40;

  /* ---------------- effects ---------------------- */
  let shake = 0;
  let treadTimer = 0;
  const sfxClock: Record<string, number> = {};

  /* ---------------- controls --------------------- */
  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Space", label: "FIRE", id: "fire" },
    { type: "button", key: "e", label: "MINE", id: "mine" },
  ]);
  ctx.setStatus(
    ctx.isTouch
      ? "Drive · FIRE shoots ricochets · MINE drops a mine"
      : "WASD/Arrows drive · Mouse aims · Space/Click fires · E lays mine",
  );

  /* ================================================================ */
  /* Construction helpers                                             */
  /* ================================================================ */

  function makeTank(x: number, y: number, arch: ArchetypeDef | null): Tank {
    const pal = arch ?? PLAYER_PALETTE;
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      bodyAngle: -Math.PI / 2,
      turretAngle: -Math.PI / 2,
      radius: TANK_R,
      alive: true,
      isPlayer: arch === null,
      archetype: arch,
      hull: pal.hull,
      tread: pal.tread,
      trim: pal.trim,
      fireCooldown: arch ? arch.reaction + Math.random() * 0.6 : 0,
      mineCooldown: 0,
      activeShells: 0,
      activeMines: 0,
      treadPhase: 0,
      muzzle: 0,
      recoil: 0,
      invuln: 0,
      ai: "wander",
      aiTimer: Math.random() * 1.5,
      wanderAngle: Math.random() * TAU,
      acquire: arch ? arch.reaction : 0,
      seesPlayer: false,
      aimAngle: -Math.PI / 2,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
      mineTimer: 1 + Math.random() * 2,
    };
  }

  function loadLevel(n: number) {
    const def = getLevel(n);
    rows = def.layout.length;
    cols = def.layout.reduce((m, r) => Math.max(m, r.length), 0);
    grid = [];
    const enemies: Tank[] = [];
    for (let y = 0; y < rows; y++) {
      const row: Tile[] = [];
      const line = def.layout[y];
      for (let x = 0; x < cols; x++) {
        const ch = x < line.length ? line[x] : "#";
        let t = Tile.Empty;
        if (ch === "#") t = Tile.Wall;
        else if (ch === "B") t = Tile.Breakable;
        else if (ch === "O") t = Tile.Hole;
        else if (ch === "P") {
          playerSpawn = { x: x + 0.5, y: y + 0.5 };
        } else if (ARCHETYPES[ch]) {
          enemies.push(makeTank(x + 0.5, y + 0.5, ARCHETYPES[ch]));
        }
        row.push(t);
      }
      grid.push(row);
    }
    player = makeTank(playerSpawn.x, playerSpawn.y, null);
    player.invuln = RESPAWN_INVULN;
    tanks = [player, ...enemies];
    shells = [];
    mines = [];
    particles = [];
    decals = [];
    floats = [];
    shake = 0;
  }

  function startRun() {
    level = 1;
    lives = LIVES_START;
    score = 0;
    ctx.reportScore(0);
    loadLevel(level);
    phase = Phase.Intro;
    phaseTimer = INTRO_TIME;
  }

  /* ================================================================ */
  /* Tile queries & collision                                         */
  /* ================================================================ */

  function tileAt(cx: number, cy: number): Tile {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return Tile.Wall;
    return grid[cy][cx];
  }

  /** Solid for tank movement (walls, crates, pits). */
  function solidForTank(cx: number, cy: number): boolean {
    const t = tileAt(cx, cy);
    return t === Tile.Wall || t === Tile.Breakable || t === Tile.Hole;
  }

  /** Tile that blocks a shell (walls + crates; pits let shells fly over). */
  function shellBlockTile(cx: number, cy: number): Tile {
    const t = tileAt(cx, cy);
    if (t === Tile.Wall || t === Tile.Breakable) return t;
    return Tile.Empty;
  }

  function destroyTile(cx: number, cy: number) {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    if (grid[cy][cx] === Tile.Breakable) {
      grid[cy][cx] = Tile.Empty;
      spawnDebris(cx + 0.5, cy + 0.5, "#c79a5b");
      addDecal(cx + 0.5, cy + 0.5, 0, "scorch", 0.9, 0.9);
    }
  }

  /** Clear line of sight between two world points (blocked by walls/crates). */
  function lineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    const steps = Math.ceil(d / 0.18);
    if (steps === 0) return true;
    const sx = dx / steps;
    const sy = dy / steps;
    let x = x0;
    let y = y0;
    for (let i = 0; i < steps; i++) {
      x += sx;
      y += sy;
      if (shellBlockTile(Math.floor(x), Math.floor(y)) !== Tile.Empty) return false;
    }
    return true;
  }

  /** Is the path ahead of a tank blocked within `dist` tiles? */
  function blockedAhead(x: number, y: number, ang: number, dist: number): boolean {
    const ex = x + Math.cos(ang) * dist;
    const ey = y + Math.sin(ang) * dist;
    const steps = Math.ceil(dist / 0.2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = x + (ex - x) * t;
      const py = y + (ey - y) * t;
      if (solidForTank(Math.floor(px), Math.floor(py))) return true;
    }
    return false;
  }

  /** Simulate a shell's bouncing path; true if it would reach the player. */
  function bankHitsPlayer(x: number, y: number, ang: number, bounces: number): boolean {
    let sx = x;
    let sy = y;
    let vx = Math.cos(ang);
    let vy = Math.sin(ang);
    let b = bounces;
    const step = 0.14;
    const maxLen = (cols + rows) * 1.5;
    const hitR = player.radius + 0.2;
    let travelled = 0;
    // Skip the muzzle region so we don't "hit" through our own start.
    while (travelled < maxLen) {
      // X
      const nx = sx + vx * step;
      const exX = Math.floor(nx + Math.sign(vx) * SHELL_R);
      if (shellBlockTile(exX, Math.floor(sy)) !== Tile.Empty) {
        if (b <= 0) return false;
        vx = -vx;
        b--;
      } else {
        sx = nx;
      }
      // Y
      const ny = sy + vy * step;
      const exY = Math.floor(ny + Math.sign(vy) * SHELL_R);
      if (shellBlockTile(Math.floor(sx), exY) !== Tile.Empty) {
        if (b <= 0) return false;
        vy = -vy;
        b--;
      } else {
        sy = ny;
      }
      travelled += step;
      if (travelled > 0.8) {
        const ddx = sx - player.x;
        const ddy = sy - player.y;
        if (ddx * ddx + ddy * ddy < hitR * hitR) return true;
      }
    }
    return false;
  }

  /* ================================================================ */
  /* Firing / mines                                                   */
  /* ================================================================ */

  function fireShell(t: Tank, ang: number, bounces: number) {
    const tipDist = t.radius + 0.22;
    const sx = t.x + Math.cos(ang) * tipDist;
    const sy = t.y + Math.sin(ang) * tipDist;
    shells.push({
      x: sx,
      y: sy,
      vx: Math.cos(ang) * SHELL_SPEED,
      vy: Math.sin(ang) * SHELL_SPEED,
      bounces,
      owner: t,
      ownerGrace: OWNER_GRACE,
      life: SHELL_LIFE,
      radius: SHELL_R,
      alive: true,
      trail: [],
    });
    t.activeShells++;
    t.muzzle = 0.08;
    t.recoil = 0.18;
    t.vx -= Math.cos(ang) * 0.6;
    t.vy -= Math.sin(ang) * 0.6;
    playSfx("fire", () => audio.sweep(520, 150, 0.16, "square", 0.32));
    if (t.isPlayer) addShake(0.12);
  }

  function killShell(s: Shell) {
    if (!s.alive) return;
    s.alive = false;
    s.owner.activeShells = Math.max(0, s.owner.activeShells - 1);
  }

  function layMine(t: Tank, max: number) {
    if (t.activeMines >= max || t.mineCooldown > 0) return;
    mines.push({ x: t.x, y: t.y, owner: t, fuse: MINE_FUSE, arm: MINE_ARM, alive: true });
    t.activeMines++;
    t.mineCooldown = PLAYER_MINE_CD;
    playSfx("mine", () => audio.tone(180, 0.12, "sine", 0.4));
  }

  /* ================================================================ */
  /* Explosions & death                                               */
  /* ================================================================ */

  function detonate(x: number, y: number, radius: number) {
    spawnExplosion(x, y, true);
    addShake(0.8);
    playSfx("boom", () => {
      audio.noise(0.45, 0.6);
      audio.tone(90, 0.3, "sawtooth", 0.4);
    });
    addDecal(x, y, 0, "scorch", radius * 1.1, radius * 1.1);
    // destroy breakables in radius
    const r = Math.ceil(radius);
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++)
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (Math.hypot(cx + 0.5 - x, cy + 0.5 - y) <= radius) destroyTile(cx, cy);
      }
    // kill tanks in radius
    for (const t of tanks) {
      if (!t.alive) continue;
      if (Math.hypot(t.x - x, t.y - y) <= radius + t.radius) killTank(t);
    }
    // chain neighbouring mines
    for (const m of mines) {
      if (m.alive && Math.hypot(m.x - x, m.y - y) <= radius + 0.4) m.fuse = Math.min(m.fuse, 0.04);
    }
  }

  function killTank(t: Tank) {
    if (!t.alive) return;
    if (t.isPlayer) {
      if (t.invuln > 0) return;
      t.alive = false;
      lives--;
      spawnExplosion(t.x, t.y, true);
      addShake(1.2);
      addDecal(t.x, t.y, 0, "scorch", 1.2, 1.2);
      playSfx("pdeath", () => audio.lose());
      phase = Phase.PlayerDead;
      phaseTimer = DEAD_TIME;
      return;
    }
    t.alive = false;
    spawnExplosion(t.x, t.y, false);
    addShake(0.5);
    addDecal(t.x, t.y, 0, "scorch", 1, 1);
    const pts = t.archetype ? t.archetype.score : 100;
    score += pts;
    lifetimeKills++;
    ctx.reportScore(score);
    floats.push({
      x: t.x,
      y: t.y,
      vy: -1.4,
      life: 1,
      max: 1,
      text: `+${pts}`,
      color: t.trim,
    });
    playSfx("kill", () => {
      audio.tone(330, 0.1, "square", 0.4);
      audio.noise(0.18, 0.35);
    });
  }

  /* ================================================================ */
  /* Particles / decals / effects                                     */
  /* ================================================================ */

  function addShake(m: number) {
    shake = Math.min(1.4, shake + m);
  }

  function playSfx(key: string, fn: () => void) {
    const now = titleT;
    if ((sfxClock[key] ?? -1) > now) return;
    sfxClock[key] = now + 0.03;
    fn();
  }

  function spawnSpark(x: number, y: number, color: string, n: number, spd: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = spd * (0.3 + Math.random() * 0.7);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.3 + Math.random() * 0.3,
        max: 0.6,
        size: 0.04 + Math.random() * 0.05,
        color,
        kind: "spark",
        grow: 0,
      });
    }
  }

  function spawnDebris(x: number, y: number, color: string) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU;
      const s = 1 + Math.random() * 3;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        size: 0.06 + Math.random() * 0.08,
        color,
        kind: "debris",
        grow: 0,
      });
    }
  }

  function spawnExplosion(x: number, y: number, big: boolean) {
    const ring: Particle = {
      x,
      y,
      vx: 0,
      vy: 0,
      life: big ? 0.45 : 0.32,
      max: big ? 0.45 : 0.32,
      size: 0.2,
      color: "#ffd27a",
      kind: "ring",
      grow: big ? 5.5 : 3.5,
    };
    particles.push(ring);
    particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.16,
      max: 0.16,
      size: big ? 1.3 : 0.85,
      color: "#fff4d0",
      kind: "flash",
      grow: 0,
    });
    const n = big ? 22 : 14;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = (big ? 4 : 2.6) * (0.3 + Math.random() * 0.9);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        size: 0.08 + Math.random() * 0.12,
        color: Math.random() < 0.5 ? "#ff8a3c" : "#ffd166",
        kind: "spark",
        grow: 0,
      });
    }
    for (let i = 0; i < (big ? 10 : 6); i++) {
      const a = Math.random() * TAU;
      const s = (big ? 1.6 : 1) * Math.random();
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 0.6,
        life: 0.7 + Math.random() * 0.7,
        max: 1.4,
        size: 0.3 + Math.random() * 0.3,
        color: "rgba(70,70,80,0.5)",
        kind: "smoke",
        grow: 0.8,
      });
    }
  }

  function addDecal(x: number, y: number, angle: number, kind: "tread" | "scorch", w: number, h: number) {
    decals.push({ x, y, angle, life: kind === "scorch" ? 6 : 2.5, max: kind === "scorch" ? 6 : 2.5, kind, w, h });
    if (decals.length > 220) decals.shift();
  }

  /* ================================================================ */
  /* Update                                                           */
  /* ================================================================ */

  function updatePlayer(dt: number) {
    if (!player.alive) return;
    let ix = 0;
    let iy = 0;
    if (input.isDown("a", "ArrowLeft")) ix -= 1;
    if (input.isDown("d", "ArrowRight")) ix += 1;
    if (input.isDown("w", "ArrowUp")) iy -= 1;
    if (input.isDown("s", "ArrowDown")) iy += 1;
    const mag = Math.hypot(ix, iy);
    if (mag > 0) {
      ix /= mag;
      iy /= mag;
      player.vx = approach(player.vx, ix * PLAYER_SPEED, PLAYER_ACCEL * dt);
      player.vy = approach(player.vy, iy * PLAYER_SPEED, PLAYER_ACCEL * dt);
      player.bodyAngle = angApproach(player.bodyAngle, Math.atan2(player.vy, player.vx), 10 * dt);
    } else {
      player.vx = approach(player.vx, 0, PLAYER_FRICTION * dt);
      player.vy = approach(player.vy, 0, PLAYER_FRICTION * dt);
    }

    integrateTank(player, dt);

    // turret aim
    let aim: number;
    if (ctx.isTouch) {
      aim = autoAim();
    } else {
      const wx = (input.pointer.x - ox) / tile;
      const wy = (input.pointer.y - oy) / tile;
      aim = Math.atan2(wy - player.y, wx - player.x);
    }
    player.aimAngle = aim;
    player.turretAngle = angApproach(player.turretAngle, aim, PLAYER_TURRET_RATE * dt);

    // fire
    player.fireCooldown -= dt;
    player.mineCooldown -= dt;
    const fireHeld = input.isDown("Space") || (!ctx.isTouch && input.pointer.down);
    if (
      fireHeld &&
      player.fireCooldown <= 0 &&
      player.activeShells < PLAYER_MAX_SHELLS
    ) {
      fireShell(player, player.turretAngle, PLAYER_BOUNCES);
      player.fireCooldown = PLAYER_FIRE_CD;
    }
    if (input.pressed("e", "Shift", "q")) layMine(player, PLAYER_MAX_MINES);
  }

  function autoAim(): number {
    let bestAng = player.turretAngle;
    let bestScore = -Infinity;
    for (const t of tanks) {
      if (t.isPlayer || !t.alive) continue;
      const d = Math.hypot(t.x - player.x, t.y - player.y);
      const clear = lineClear(player.x, player.y, t.x, t.y);
      const s = (clear ? 100 : 0) - d;
      if (s > bestScore) {
        bestScore = s;
        bestAng = Math.atan2(t.y - player.y, t.x - player.x);
      }
    }
    // fall back to movement direction if standing still & no target
    if (bestScore === -Infinity) {
      if (Math.hypot(player.vx, player.vy) > 0.3) return Math.atan2(player.vy, player.vx);
      return player.turretAngle;
    }
    return bestAng;
  }

  function integrateTank(t: Tank, dt: number) {
    t.x += t.vx * dt;
    collideTankX(t);
    t.y += t.vy * dt;
    collideTankY(t);
    const spd = Math.hypot(t.vx, t.vy);
    t.treadPhase += spd * dt * 2.4;
    if (spd > 0.6) {
      t.bodyAngle = angApproach(t.bodyAngle, Math.atan2(t.vy, t.vx), 9 * dt);
    }
    if (t.muzzle > 0) t.muzzle -= dt;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 1.2);
    if (t.invuln > 0) t.invuln -= dt;
  }

  function collideTankX(t: Tank) {
    const r = t.radius;
    if (t.vx === 0) return;
    const dir = Math.sign(t.vx);
    const edge = Math.floor(t.x + dir * r);
    const top = Math.floor(t.y - r + 1e-4);
    const bot = Math.floor(t.y + r - 1e-4);
    for (let cy = top; cy <= bot; cy++) {
      if (solidForTank(edge, cy)) {
        t.x = dir > 0 ? edge - r : edge + 1 + r;
        t.vx = 0;
        return;
      }
    }
  }

  function collideTankY(t: Tank) {
    const r = t.radius;
    if (t.vy === 0) return;
    const dir = Math.sign(t.vy);
    const edge = Math.floor(t.y + dir * r);
    const left = Math.floor(t.x - r + 1e-4);
    const right = Math.floor(t.x + r - 1e-4);
    for (let cx = left; cx <= right; cx++) {
      if (solidForTank(cx, edge)) {
        t.y = dir > 0 ? edge - r : edge + 1 + r;
        t.vy = 0;
        return;
      }
    }
  }

  function updateEnemy(t: Tank, dt: number) {
    const a = t.archetype;
    if (!a || !t.alive) return;
    t.fireCooldown -= dt;
    t.mineCooldown -= dt;
    t.mineTimer -= dt;

    const dx = player.x - t.x;
    const dy = player.y - t.y;
    const dist = Math.hypot(dx, dy);
    const angToPlayer = Math.atan2(dy, dx);
    const los = player.alive && lineClear(t.x, t.y, player.x, player.y);
    const wasSeeing = t.seesPlayer;
    t.seesPlayer = los && dist < a.awareness;
    if (t.seesPlayer && !wasSeeing) t.acquire = a.reaction;
    if (t.seesPlayer) t.acquire -= dt;

    /* ---- movement ---- */
    let moveAng = t.wanderAngle;
    let moveSpd = a.speed;
    const incoming = a.evasive > 0 ? incomingShell(t) : null;

    if (incoming !== null && Math.random() < 0.9) {
      moveAng = incoming;
      moveSpd = a.speed * 1.05;
      t.ai = "evade";
    } else if (t.seesPlayer && a.speed > 0) {
      t.ai = "engage";
      if (a.id === "u") {
        moveAng = angToPlayer; // rush
      } else if (a.banker || a.id === "w") {
        if (dist < 4.5) moveAng = angToPlayer + Math.PI;
        else if (dist > 8.5) moveAng = angToPlayer;
        else moveAng = angToPlayer + (Math.PI / 2) * t.strafeDir;
      } else if (a.id === "s") {
        moveAng = angToPlayer + (Math.PI / 2) * t.strafeDir;
        if (t.mineTimer <= 0 && t.activeMines < 2 && dist < 9) {
          layMine(t, 2);
          t.mineTimer = 2.4 + Math.random() * 2;
        }
      } else {
        // roamer-ish: approach a little, mostly hold
        moveAng = angToPlayer;
        moveSpd = a.speed * (0.4 + a.aggression);
      }
    } else {
      t.ai = "wander";
      moveSpd = a.speed * 0.55;
      t.aiTimer -= dt;
      if (t.aiTimer <= 0) {
        t.wanderAngle = Math.random() * TAU;
        t.aiTimer = 1 + Math.random() * 2.2;
        if (Math.random() < 0.4) t.strafeDir *= -1;
      }
      moveAng = t.wanderAngle;
    }

    if (a.speed > 0) {
      moveAng = steerAroundWalls(t, moveAng);
      t.vx = Math.cos(moveAng) * moveSpd;
      t.vy = Math.sin(moveAng) * moveSpd;
    } else {
      t.vx = 0;
      t.vy = 0;
    }
    integrateTank(t, dt);

    /* ---- aim & fire ---- */
    let aim: number | null = null;
    const canShoot = t.fireCooldown <= 0 && t.activeShells < a.maxShells;
    if (los) {
      const leadT = (dist / SHELL_SPEED) * a.lead;
      const tx = player.x + player.vx * leadT;
      const ty = player.y + player.vy * leadT;
      aim = Math.atan2(ty - t.y, tx - t.x);
    } else if (a.banker && canShoot && dist < a.awareness) {
      aim = solveBankShot(t, a.bounces);
    }

    const track = aim ?? (player.alive ? angToPlayer : t.turretAngle);
    t.aimAngle = track;
    t.turretAngle = angApproach(t.turretAngle, track, ENEMY_TURRET_RATE * dt);

    if (
      aim !== null &&
      canShoot &&
      t.acquire <= 0 &&
      Math.abs(angDiff(t.turretAngle, aim)) < 0.16
    ) {
      const jitter = (Math.random() - 0.5) * 2 * a.aimError;
      fireShell(t, t.turretAngle + jitter, a.bounces);
      t.fireCooldown = a.fireInterval * (0.82 + Math.random() * 0.36);
    }
  }

  function solveBankShot(t: Tank, bounces: number): number | null {
    let bestAng: number | null = null;
    let bestDelta = Infinity;
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * TAU;
      if (bankHitsPlayer(t.x, t.y, ang, bounces)) {
        const delta = Math.abs(angDiff(t.turretAngle, ang));
        if (delta < bestDelta) {
          bestDelta = delta;
          bestAng = ang;
        }
      }
    }
    return bestAng;
  }

  function incomingShell(t: Tank): number | null {
    const range = 2.5 + (t.archetype ? t.archetype.evasive * 5 : 0);
    for (const s of shells) {
      if (!s.alive || s.owner === t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      const vlen = Math.hypot(s.vx, s.vy) || 1;
      const proj = (dx * s.vx + dy * s.vy) / vlen;
      if (proj <= 0) continue;
      const perp = (dx * s.vy - dy * s.vx) / vlen;
      if (Math.abs(perp) < t.radius + 0.55) {
        const shellAng = Math.atan2(s.vy, s.vx);
        return shellAng + (perp > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    return null;
  }

  function steerAroundWalls(t: Tank, ang: number): number {
    const probe = t.radius + 0.7;
    if (!blockedAhead(t.x, t.y, ang, probe)) return ang;
    const offsets = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
    for (const o of offsets) {
      if (!blockedAhead(t.x, t.y, ang + o, probe)) {
        if (t.ai === "wander") t.wanderAngle = ang + o;
        return ang + o;
      }
    }
    return ang + Math.PI;
  }

  function updateShells(dt: number) {
    for (const s of shells) {
      if (!s.alive) continue;
      if (s.ownerGrace > 0) s.ownerGrace -= dt;
      s.life -= dt;
      if (s.life <= 0) {
        killShell(s);
        spawnSpark(s.x, s.y, "#ffd27a", 4, 1.5);
        continue;
      }
      const speed = Math.hypot(s.vx, s.vy);
      const subSteps = Math.max(1, Math.ceil((speed * dt) / 0.18));
      const h = dt / subSteps;
      for (let i = 0; i < subSteps && s.alive; i++) stepShell(s, h);
      if (!s.alive) continue;
      s.trail.push({ x: s.x, y: s.y });
      if (s.trail.length > 8) s.trail.shift();
    }
    // shell vs tank
    for (const s of shells) {
      if (!s.alive) continue;
      for (const t of tanks) {
        if (!t.alive) continue;
        if (s.owner === t && s.ownerGrace > 0) continue;
        if (t.isPlayer && t.invuln > 0) continue;
        const rr = t.radius + s.radius;
        if ((s.x - t.x) ** 2 + (s.y - t.y) ** 2 <= rr * rr) {
          killShell(s);
          killTank(t);
          break;
        }
      }
    }
    // shell vs shell
    for (let i = 0; i < shells.length; i++) {
      const a = shells[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < shells.length; j++) {
        const b = shells[j];
        if (!b.alive) continue;
        const rr = a.radius + b.radius + 0.05;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= rr * rr) {
          killShell(a);
          killShell(b);
          spawnSpark((a.x + b.x) / 2, (a.y + b.y) / 2, "#fff0c0", 8, 2.5);
          playSfx("clink", () => audio.tone(880, 0.05, "square", 0.25));
          break;
        }
      }
    }
    shells = shells.filter((s) => s.alive);
  }

  function stepShell(s: Shell, h: number) {
    // X axis
    const nx = s.x + s.vx * h;
    const exX = Math.floor(nx + Math.sign(s.vx) * s.radius);
    const tx = shellBlockTile(exX, Math.floor(s.y));
    if (tx === Tile.Breakable) {
      destroyTile(exX, Math.floor(s.y));
      killShell(s);
      spawnSpark(s.x, s.y, "#c79a5b", 5, 1.5);
      return;
    } else if (tx === Tile.Wall) {
      if (s.bounces > 0) {
        s.vx = -s.vx;
        s.bounces--;
        onRicochet(s);
      } else {
        killShell(s);
        spawnSpark(s.x, s.y, "#ffd27a", 4, 1.5);
        return;
      }
    } else {
      s.x = nx;
    }
    // Y axis
    const ny = s.y + s.vy * h;
    const exY = Math.floor(ny + Math.sign(s.vy) * s.radius);
    const ty = shellBlockTile(Math.floor(s.x), exY);
    if (ty === Tile.Breakable) {
      destroyTile(Math.floor(s.x), exY);
      killShell(s);
      spawnSpark(s.x, s.y, "#c79a5b", 5, 1.5);
      return;
    } else if (ty === Tile.Wall) {
      if (s.bounces > 0) {
        s.vy = -s.vy;
        s.bounces--;
        onRicochet(s);
      } else {
        killShell(s);
        spawnSpark(s.x, s.y, "#ffd27a", 4, 1.5);
        return;
      }
    } else {
      s.y = ny;
    }
  }

  function onRicochet(s: Shell) {
    spawnSpark(s.x, s.y, "#fff0c0", 5, 2.2);
    playSfx("tink", () => audio.tone(1200, 0.04, "square", 0.18));
  }

  function updateMines(dt: number) {
    for (const m of mines) {
      if (!m.alive) continue;
      if (m.arm > 0) {
        m.arm -= dt;
        continue;
      }
      m.fuse -= dt;
      // proximity
      let trip = m.fuse <= 0;
      if (!trip) {
        for (const t of tanks) {
          if (t.alive && Math.hypot(t.x - m.x, t.y - m.y) < MINE_PROX) {
            trip = true;
            break;
          }
        }
      }
      if (trip) {
        m.alive = false;
        m.owner.activeMines = Math.max(0, m.owner.activeMines - 1);
        detonate(m.x, m.y, MINE_BLAST_R);
      }
    }
    mines = mines.filter((m) => m.alive);
  }

  function updateParticles(dt: number) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark" || p.kind === "debris") {
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 3 * dt;
      } else if (p.kind === "smoke") {
        p.vy -= 0.4 * dt;
        p.size += p.grow * dt;
      } else if (p.kind === "ring") {
        p.size += p.grow * dt;
      }
    }
    particles = particles.filter((p) => p.life > 0);

    for (const d of decals) d.life -= dt;
    decals = decals.filter((d) => d.life > 0);

    for (const f of floats) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    floats = floats.filter((f) => f.life > 0);

    if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
  }

  function spawnTreadDecals(dt: number) {
    treadTimer -= dt;
    if (treadTimer > 0) return;
    treadTimer = 0.06;
    for (const t of tanks) {
      if (!t.alive) continue;
      if (Math.hypot(t.vx, t.vy) < 0.6) continue;
      const perp = t.bodyAngle + Math.PI / 2;
      const off = t.radius * 0.7;
      addDecal(
        t.x + Math.cos(perp) * off,
        t.y + Math.sin(perp) * off,
        t.bodyAngle,
        "tread",
        t.radius * 0.9,
        t.radius * 0.4,
      );
      addDecal(
        t.x - Math.cos(perp) * off,
        t.y - Math.sin(perp) * off,
        t.bodyAngle,
        "tread",
        t.radius * 0.9,
        t.radius * 0.4,
      );
    }
  }

  function enemiesLeft(): number {
    let n = 0;
    for (const t of tanks) if (!t.isPlayer && t.alive) n++;
    return n;
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  function computeLayout() {
    const W = ctx.width;
    const H = ctx.height;
    hudH = clamp(H * 0.07, 30, 58);
    const pad = Math.min(W, H) * 0.02;
    const availW = W - pad * 2;
    const availH = H - hudH - pad * 2;
    tile = Math.max(4, Math.min(availW / cols, availH / rows));
    ox = (W - cols * tile) / 2;
    oy = hudH + (H - hudH - rows * tile) / 2;
  }

  /* ================================================================ */
  /* GameInstance                                                      */
  /* ================================================================ */

  return {
    update(dtRaw: number) {
      const dt = Math.min(dtRaw, DT_CLAMP);
      titleT += dt;
      if (cols > 0) computeLayout();

      const startPressed =
        input.pressed("Space", "Enter") || input.pointer.justDown;

      if (phase === Phase.Title) {
        if (startPressed) {
          startRun();
          playSfx("start", () => audio.coin());
        }
        return;
      }

      if (phase === Phase.GameOver) {
        if (startPressed) {
          startRun();
          playSfx("start", () => audio.coin());
        }
        return;
      }

      if (phase === Phase.Intro) {
        phaseTimer -= dt;
        // let particles settle but keep sim paused
        updateParticles(dt);
        if (phaseTimer <= 0) phase = Phase.Playing;
        return;
      }

      if (phase === Phase.Cleared) {
        phaseTimer -= dt;
        updateParticles(dt);
        if (phaseTimer <= 0) {
          level++;
          if (level % 5 === 0 && lives < 5) lives++;
          loadLevel(level);
          phase = Phase.Intro;
          phaseTimer = INTRO_TIME;
        }
        return;
      }

      if (phase === Phase.PlayerDead) {
        phaseTimer -= dt;
        // keep enemies & projectiles moving for drama
        for (const t of tanks) if (!t.isPlayer) updateEnemy(t, dt);
        updateShells(dt);
        updateMines(dt);
        updateParticles(dt);
        if (phaseTimer <= 0) {
          if (lives > 0) {
            player = makeTank(playerSpawn.x, playerSpawn.y, null);
            player.invuln = RESPAWN_INVULN;
            tanks[0] = player;
            phase = Phase.Playing;
          } else {
            endGame();
          }
        }
        return;
      }

      // ---- PLAYING ----
      updatePlayer(dt);
      for (const t of tanks) if (!t.isPlayer) updateEnemy(t, dt);
      updateShells(dt);
      updateMines(dt);
      spawnTreadDecals(dt);
      updateParticles(dt);

      if (phase === Phase.Playing && enemiesLeft() === 0) {
        const bonus = 50 * level;
        score += bonus;
        ctx.reportScore(score);
        floats.push({
          x: player.x,
          y: player.y - 1,
          vy: -1,
          life: 1.5,
          max: 1.5,
          text: `CLEAR +${bonus}`,
          color: "#aef2d6",
        });
        phase = Phase.Cleared;
        phaseTimer = CLEAR_TIME;
        playSfx("win", () => audio.win());
      }
    },

    render() {
      draw();
    },

    resize() {
      if (cols > 0) computeLayout();
    },

    destroy() {
      storage.set("kills", lifetimeKills);
    },
  };

  function endGame() {
    phase = Phase.GameOver;
    if (score > best) {
      best = score;
      storage.set("best", best);
    }
    storage.set("kills", lifetimeKills);
    storage.submitScore(score);
    ctx.gameOver(score);
  }

  /* ================================================================ */
  /* Rendering                                                         */
  /* ================================================================ */

  function draw() {
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;

    // backdrop
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#10141d");
    bg.addColorStop(1, "#070a10");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    if (cols === 0) {
      drawTitle(c, W, H);
      return;
    }

    c.save();
    // screen shake (arena layer only)
    if (shake > 0) {
      const s = shake * tile * 0.5;
      c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawArenaFloor(c);
    drawDecals(c);
    drawTiles(c);
    drawMines(c);
    drawShells(c);
    for (const t of tanks) if (t.alive) drawTank(c, t);
    drawParticles(c);
    drawFloats(c);

    c.restore();

    drawHUD(c, W, H);
    drawOverlays(c, W, H);
  }

  function sx(wx: number): number {
    return ox + wx * tile;
  }
  function sy(wy: number): number {
    return oy + wy * tile;
  }

  function drawArenaFloor(c: CanvasRenderingContext2D) {
    const x = ox;
    const y = oy;
    const w = cols * tile;
    const h = rows * tile;
    c.save();
    c.shadowColor = "rgba(0,0,0,0.5)";
    c.shadowBlur = tile * 0.6;
    c.fillStyle = "#1b2230";
    roundRect(c, x, y, w, h, tile * 0.3);
    c.fill();
    c.restore();
    // checker
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < cols; gx++) {
        if ((gx + gy) % 2 === 0) {
          c.fillStyle = "rgba(255,255,255,0.018)";
          c.fillRect(x + gx * tile, y + gy * tile, tile, tile);
        }
      }
  }

  function drawDecals(c: CanvasRenderingContext2D) {
    for (const d of decals) {
      const alpha = (d.life / d.max) * (d.kind === "scorch" ? 0.5 : 0.35);
      c.save();
      c.translate(sx(d.x), sy(d.y));
      c.rotate(d.angle);
      if (d.kind === "scorch") {
        c.fillStyle = `rgba(10,10,14,${alpha})`;
        c.beginPath();
        c.ellipse(0, 0, d.w * tile * 0.6, d.h * tile * 0.6, 0, 0, TAU);
        c.fill();
      } else {
        c.fillStyle = `rgba(20,22,28,${alpha})`;
        c.fillRect(-d.w * tile * 0.5, -d.h * tile * 0.5, d.w * tile, d.h * tile);
      }
      c.restore();
    }
  }

  function drawTiles(c: CanvasRenderingContext2D) {
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < cols; gx++) {
        const t = grid[gy][gx];
        if (t === Tile.Empty) continue;
        const x = sx(gx);
        const y = sy(gy);
        if (t === Tile.Wall) drawWall(c, x, y);
        else if (t === Tile.Breakable) drawCrate(c, x, y);
        else if (t === Tile.Hole) drawHole(c, x, y);
      }
  }

  function drawWall(c: CanvasRenderingContext2D, x: number, y: number) {
    const m = tile * 0.04;
    const g = c.createLinearGradient(x, y, x, y + tile);
    g.addColorStop(0, "#5a6376");
    g.addColorStop(1, "#3a4254");
    c.fillStyle = g;
    roundRect(c, x + m, y + m, tile - m * 2, tile - m * 2, tile * 0.12);
    c.fill();
    // bevel highlight
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(x + m, y + m, tile - m * 2, tile * 0.12);
    c.fillStyle = "rgba(0,0,0,0.22)";
    c.fillRect(x + m, y + tile - m - tile * 0.12, tile - m * 2, tile * 0.12);
    // rivets
    c.fillStyle = "rgba(0,0,0,0.3)";
    const rr = tile * 0.05;
    for (const [px, py] of [
      [0.22, 0.22],
      [0.78, 0.22],
      [0.22, 0.78],
      [0.78, 0.78],
    ]) {
      c.beginPath();
      c.arc(x + px * tile, y + py * tile, rr, 0, TAU);
      c.fill();
    }
  }

  function drawCrate(c: CanvasRenderingContext2D, x: number, y: number) {
    const m = tile * 0.06;
    const g = c.createLinearGradient(x, y, x, y + tile);
    g.addColorStop(0, "#c79a5b");
    g.addColorStop(1, "#9c7038");
    c.fillStyle = g;
    roundRect(c, x + m, y + m, tile - m * 2, tile - m * 2, tile * 0.08);
    c.fill();
    c.strokeStyle = "rgba(80,52,20,0.7)";
    c.lineWidth = Math.max(1, tile * 0.04);
    c.stroke();
    // planks
    c.strokeStyle = "rgba(80,52,20,0.4)";
    c.lineWidth = Math.max(1, tile * 0.02);
    c.beginPath();
    c.moveTo(x + m, y + tile * 0.5);
    c.lineTo(x + tile - m, y + tile * 0.5);
    c.stroke();
  }

  function drawHole(c: CanvasRenderingContext2D, x: number, y: number) {
    c.fillStyle = "#05070b";
    roundRect(c, x + tile * 0.08, y + tile * 0.08, tile * 0.84, tile * 0.84, tile * 0.18);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(c, x + tile * 0.08, y + tile * 0.08, tile * 0.84, tile * 0.18, tile * 0.1);
    c.fill();
  }

  function drawMines(c: CanvasRenderingContext2D) {
    for (const m of mines) {
      const x = sx(m.x);
      const y = sy(m.y);
      c.fillStyle = "#2a2f3a";
      c.beginPath();
      c.arc(x, y, tile * 0.28, 0, TAU);
      c.fill();
      c.strokeStyle = "rgba(0,0,0,0.5)";
      c.lineWidth = Math.max(1, tile * 0.03);
      c.stroke();
      const armed = m.arm <= 0;
      const blinkRate = armed ? 2 + (MINE_FUSE - m.fuse) * 0.7 : 1;
      const on = Math.sin(titleT * blinkRate * 6) > 0;
      c.fillStyle = armed ? (on ? "#ff5544" : "#5a1f1a") : "#caa23a";
      c.beginPath();
      c.arc(x, y, tile * 0.1, 0, TAU);
      c.fill();
    }
  }

  function drawShells(c: CanvasRenderingContext2D) {
    for (const s of shells) {
      // trail
      for (let i = 0; i < s.trail.length; i++) {
        const p = s.trail[i];
        const a = (i / s.trail.length) * 0.5;
        c.fillStyle = `rgba(255,210,120,${a})`;
        c.beginPath();
        c.arc(sx(p.x), sy(p.y), tile * 0.1 * (i / s.trail.length + 0.3), 0, TAU);
        c.fill();
      }
      const x = sx(s.x);
      const y = sy(s.y);
      c.save();
      c.shadowColor = "#ffcf6e";
      c.shadowBlur = tile * 0.4;
      c.fillStyle = "#fff2cc";
      c.beginPath();
      c.arc(x, y, tile * 0.14, 0, TAU);
      c.fill();
      c.restore();
    }
  }

  function drawTank(c: CanvasRenderingContext2D, t: Tank) {
    const x = sx(t.x);
    const y = sy(t.y);
    const R = t.radius * tile;
    // invuln flicker
    if (t.invuln > 0 && Math.floor(titleT * 20) % 2 === 0) return;

    // shadow
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.beginPath();
    c.ellipse(x + R * 0.18, y + R * 0.22, R * 1.05, R * 0.95, 0, 0, TAU);
    c.fill();

    // ---- body ----
    c.save();
    c.translate(x, y);
    c.rotate(t.bodyAngle);
    // tread strips
    c.fillStyle = t.tread;
    const tw = R * 0.5;
    const tl = R * 1.7;
    roundRect(c, -tl / 2, -R - tw * 0.1, tl, tw, tw * 0.3);
    c.fill();
    roundRect(c, -tl / 2, R - tw * 0.9, tl, tw, tw * 0.3);
    c.fill();
    // tread segments
    c.fillStyle = "rgba(0,0,0,0.3)";
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const sgx = -tl / 2 + ((i / segs + (t.treadPhase % (1 / segs))) % 1) * tl;
      c.fillRect(sgx, -R - tw * 0.1, tl * 0.06, tw);
      c.fillRect(sgx, R - tw * 0.9, tl * 0.06, tw);
    }
    // hull
    const g = c.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, shade(t.hull, 1.18));
    g.addColorStop(1, shade(t.hull, 0.82));
    c.fillStyle = g;
    roundRect(c, -R * 0.85, -R * 0.7, R * 1.7, R * 1.4, R * 0.3);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.25)";
    c.lineWidth = Math.max(1, R * 0.08);
    c.stroke();
    c.restore();

    // ---- turret ----
    c.save();
    c.translate(x, y);
    c.rotate(t.turretAngle);
    const recoil = t.recoil * tile * 0.5;
    // barrel
    c.fillStyle = shade(t.trim, 0.85);
    roundRect(c, -recoil, -R * 0.16, R * 1.5 - recoil, R * 0.32, R * 0.12);
    c.fill();
    // muzzle flash
    if (t.muzzle > 0) {
      c.fillStyle = "rgba(255,230,150,0.9)";
      c.beginPath();
      c.arc(R * 1.5, 0, R * 0.4 * (t.muzzle / 0.08), 0, TAU);
      c.fill();
    }
    // dome
    const dg = c.createRadialGradient(-R * 0.15, -R * 0.15, R * 0.1, 0, 0, R * 0.6);
    dg.addColorStop(0, shade(t.trim, 1.1));
    dg.addColorStop(1, shade(t.hull, 0.9));
    c.fillStyle = dg;
    c.beginPath();
    c.arc(0, 0, R * 0.55, 0, TAU);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.25)";
    c.lineWidth = Math.max(1, R * 0.06);
    c.stroke();
    c.restore();

    // player chevron marker
    if (t.isPlayer) {
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.arc(x, y, R * 0.16, 0, TAU);
      c.fill();
    }
  }

  function drawParticles(c: CanvasRenderingContext2D) {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      const x = sx(p.x);
      const y = sy(p.y);
      if (p.kind === "ring") {
        c.strokeStyle = `rgba(255,210,120,${a})`;
        c.lineWidth = Math.max(1, tile * 0.12 * a);
        c.beginPath();
        c.arc(x, y, p.size * tile, 0, TAU);
        c.stroke();
      } else if (p.kind === "flash") {
        c.fillStyle = `rgba(255,244,208,${a})`;
        c.beginPath();
        c.arc(x, y, p.size * tile, 0, TAU);
        c.fill();
      } else if (p.kind === "smoke") {
        c.fillStyle = withAlpha(p.color, a * 0.6);
        c.beginPath();
        c.arc(x, y, p.size * tile, 0, TAU);
        c.fill();
      } else {
        c.fillStyle = withAlpha(p.color, a);
        c.beginPath();
        c.arc(x, y, p.size * tile, 0, TAU);
        c.fill();
      }
    }
  }

  function drawFloats(c: CanvasRenderingContext2D) {
    for (const f of floats) {
      const a = clamp(f.life / f.max, 0, 1);
      drawText(c, f.text, sx(f.x), sy(f.y), tile * 0.5, withAlpha(f.color, a), "center", "800");
    }
  }

  function drawHUD(c: CanvasRenderingContext2D, W: number, H: number) {
    c.fillStyle = "rgba(8,11,17,0.85)";
    c.fillRect(0, 0, W, hudH);
    c.fillStyle = "rgba(255,255,255,0.06)";
    c.fillRect(0, hudH - 2, W, 2);
    const fs = hudH * 0.42;
    const cy = hudH * 0.5;
    drawText(c, `LEVEL ${level}`, W * 0.02, cy, fs, "#cfe4ff", "left", "800");

    // lives as tank pips
    const pipR = hudH * 0.16;
    let px = W * 0.3;
    drawText(c, "LIVES", px - pipR, cy, fs * 0.8, "#9fb0c8", "right", "700");
    for (let i = 0; i < lives; i++) {
      c.fillStyle = PLAYER_PALETTE.hull;
      roundRect(c, px + i * pipR * 2.6, cy - pipR, pipR * 2, pipR * 2, pipR * 0.5);
      c.fill();
    }

    drawText(c, `ENEMIES ${enemiesLeft()}`, W * 0.5, cy, fs, "#ffb0a6", "center", "800");
    drawText(c, `SCORE ${score}`, W * 0.78, cy, fs, "#fff", "right", "800");
    drawText(c, `BEST ${best}`, W * 0.98, cy, fs * 0.85, "#9fb0c8", "right", "700");
  }

  function drawOverlays(c: CanvasRenderingContext2D, W: number, H: number) {
    if (phase === Phase.Title) {
      drawTitle(c, W, H);
    } else if (phase === Phase.Intro) {
      scrim(c, W, H, 0.35);
      drawText(c, `LEVEL ${level}`, W / 2, H * 0.4, H * 0.1, "#cfe4ff", "center", "800");
      const n = enemiesLeft();
      drawText(c, `${n} enemy tank${n === 1 ? "" : "s"}`, W / 2, H * 0.52, H * 0.05, "#ffb0a6");
      const count = Math.ceil(phaseTimer);
      drawText(c, count > 0 ? String(count) : "GO!", W / 2, H * 0.64, H * 0.08, "#fff");
    } else if (phase === Phase.Cleared) {
      scrim(c, W, H, 0.3);
      drawText(c, "AREA CLEARED!", W / 2, H * 0.45, H * 0.1, "#aef2d6", "center", "800");
      drawText(c, `Score ${score}`, W / 2, H * 0.56, H * 0.05, "#fff");
    } else if (phase === Phase.GameOver) {
      scrim(c, W, H, 0.7);
      drawText(c, "GAME OVER", W / 2, H * 0.32, H * 0.11, "#ff7b6b", "center", "800");
      drawText(c, `Reached Level ${level}`, W / 2, H * 0.46, H * 0.05, "#cfe4ff");
      drawText(c, `Score ${score}`, W / 2, H * 0.55, H * 0.07, "#fff", "center", "800");
      drawText(c, `Best ${best}`, W / 2, H * 0.64, H * 0.045, "#9fb0c8");
      const pulse = 0.6 + 0.4 * Math.sin(titleT * 4);
      drawText(
        c,
        ctx.isTouch ? "Tap to play again" : "Press Space to play again",
        W / 2,
        H * 0.76,
        H * 0.045,
        withAlpha("#ffffff", pulse),
      );
    }
  }

  function drawTitle(c: CanvasRenderingContext2D, W: number, H: number) {
    scrim(c, W, H, 0.45);
    // decorative tank
    const cx = W / 2;
    const cy = H * 0.32;
    const R = Math.min(W, H) * 0.07;
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.sin(titleT) * 0.2);
    c.fillStyle = PLAYER_PALETTE.tread;
    roundRect(c, -R * 0.9, -R, R * 1.8, R * 0.5, R * 0.2);
    c.fill();
    roundRect(c, -R * 0.9, R * 0.5, R * 1.8, R * 0.5, R * 0.2);
    c.fill();
    c.fillStyle = PLAYER_PALETTE.hull;
    roundRect(c, -R * 0.85, -R * 0.7, R * 1.7, R * 1.4, R * 0.3);
    c.fill();
    c.save();
    c.rotate(-0.5 + Math.sin(titleT * 1.5) * 0.3);
    c.fillStyle = PLAYER_PALETTE.trim;
    roundRect(c, 0, -R * 0.16, R * 1.5, R * 0.32, R * 0.1);
    c.fill();
    c.beginPath();
    c.arc(0, 0, R * 0.55, 0, TAU);
    c.fillStyle = shade(PLAYER_PALETTE.hull, 1.1);
    c.fill();
    c.restore();
    c.restore();

    drawText(c, "TANK BATTLE", W / 2, H * 0.52, H * 0.1, "#cfe4ff", "center", "800");
    drawText(c, "Ricochet arena warfare", W / 2, H * 0.6, H * 0.04, "#7fa6d6");
    drawText(c, `Best ${best}  ·  Kills ${lifetimeKills}`, W / 2, H * 0.67, H * 0.04, "#9fb0c8");
    const pulse = 0.6 + 0.4 * Math.sin(titleT * 4);
    drawText(
      c,
      ctx.isTouch ? "Tap to start" : "Press Space to start",
      W / 2,
      H * 0.78,
      H * 0.05,
      withAlpha("#ffffff", pulse),
      "center",
      "800",
    );
    drawText(
      c,
      ctx.isTouch ? "dpad drive · FIRE · MINE" : "WASD move · mouse aim · Space fire · E mine",
      W / 2,
      H * 0.86,
      H * 0.032,
      "#6b7a92",
    );
  }

  function scrim(c: CanvasRenderingContext2D, W: number, H: number, a: number) {
    c.fillStyle = `rgba(6,9,14,${a})`;
    c.fillRect(0, 0, W, H);
  }
}

/* ------------------------------------------------------------------ */
/* Color helpers (module scope, pure).                                */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    const [r, g, b] = hexToRgb(color);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (color.startsWith("rgba")) {
    return color.replace(/[\d.]+\)$/, `${a})`);
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${a})`);
  }
  return color;
}
