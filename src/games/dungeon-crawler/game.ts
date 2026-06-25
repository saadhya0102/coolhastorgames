import type { GameContext } from "@/engine";
import { mulberry32, drawText } from "@/engine";
import {
  COLS,
  ROWS,
  COL,
  DIRS,
  DIR_VEC,
  OPPOSITE,
  MIN_X,
  MAX_X,
  MIN_Y,
  MAX_Y,
  MAX_BULLETS,
  MAX_PARTICLES,
  MAX_DT,
  clamp,
  norm,
  type Dir,
} from "./config";
import type {
  Bullet,
  DamageNumber,
  Enemy,
  EnemyKind,
  Particle,
  PlayerStats,
  Pickup,
  RoomDef,
} from "./types";
import { generateFloor, type Floor } from "./floor";
import { applyItem } from "./items";
import * as D from "./draw";
import type { View } from "./draw";

type State = "title" | "play" | "paused" | "descend" | "dead";

const PLAYER_R = 0.4;

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export class Game {
  private ctx: GameContext;

  private state: State = "title";
  private t = 0;
  private slowmo = 0;
  private deathTimer = 0;

  private stats: PlayerStats = {
    maxHp: 6,
    hp: 6,
    damage: 3,
    fireDelay: 0.42,
    moveSpeed: 6,
    shotCount: 1,
    piercing: 0,
    shotSpeed: 13,
    range: 2.4,
    luck: 0,
    coins: 0,
  };

  // player
  private px = COLS / 2;
  private py = ROWS / 2;
  private pvx = 0;
  private pvy = 0;
  private face = -Math.PI / 2;
  private bob = 0;
  private invuln = 0;
  private flash = 0;
  private fireT = 0;

  // run / floor
  private baseSeed = (Math.random() * 1e9) >>> 0;
  private floorNum = 1;
  private floorsCompleted = 0;
  private kills = 0;
  private score = 0;
  private floor!: Floor;
  private roomKey = "";
  private room!: RoomDef;

  // entities (current room only)
  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private dmgNums: DamageNumber[] = [];
  private enemyId = 1;

  // fx
  private shakeT = 0;
  private shakeMag = 0;
  private toast = "";
  private toastT = 0;
  private wipe = 0; // descend transition 0..1
  private hurtFlash = 0;

  // touch sticks
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;

  // persisted bests
  private bestDepth = 0;
  private bestScore = 0;

  // cached view
  private view: View = { scale: 1, ox: 0, oy: 0, theme: 1 };
  private hudH = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.bestDepth = ctx.storage.get<number>("bestDepth", 0);
    this.bestScore = ctx.storage.get<number>("bestScore", 0);
    this.startRun();
    this.state = "title";
    ctx.setStatus("WASD move · Arrows / mouse shoot · P pause");
  }

  /* ----------------------------------------------------------- run setup */

  private floorRand(floorNum: number): () => number {
    return mulberry32((this.baseSeed ^ (floorNum * 0x9e3779b1)) >>> 0);
  }

  private startRun() {
    this.stats = {
      maxHp: 6,
      hp: 6,
      damage: 3,
      fireDelay: 0.42,
      moveSpeed: 6,
      shotCount: 1,
      piercing: 0,
      shotSpeed: 13,
      range: 2.4,
      luck: 0,
      coins: 0,
    };
    this.floorNum = 1;
    this.floorsCompleted = 0;
    this.kills = 0;
    this.score = 0;
    this.baseSeed = (Math.random() * 1e9) >>> 0;
    this.loadFloor(1);
  }

  private loadFloor(n: number) {
    this.floor = generateFloor(this.floorRand(n), n);
    this.view.theme = n;
    this.roomKey = `${this.floor.start.gx},${this.floor.start.gy}`;
    const start = this.floor.rooms.get(this.roomKey);
    if (!start) return;
    this.room = start;
    this.room.visited = true;
    this.px = COLS / 2;
    this.py = ROWS / 2;
    this.pvx = 0;
    this.pvy = 0;
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.dmgNums = [];
  }

  /* ----------------------------------------------------------- view calc */

  private computeView() {
    const W = this.ctx.width;
    const H = this.ctx.height;
    const min = Math.min(W, H);
    this.hudH = clamp(min * 0.12, 46, 120);
    const availH = H - this.hudH;
    const scale = Math.min(W / COLS, availH / ROWS);
    this.view.scale = scale;
    this.view.ox = (W - scale * COLS) / 2;
    this.view.oy = this.hudH + (availH - scale * ROWS) / 2;
  }

  /* ----------------------------------------------------------- update */

  update(dtRaw: number) {
    const dt0 = Math.min(dtRaw, MAX_DT);
    this.computeView();

    // global timers tick even when paused-ish (toast/title anim)
    this.t += dt0;

    // pause toggle
    if (this.ctx.input.pressed("p", "Escape") && (this.state === "play" || this.state === "paused")) {
      this.state = this.state === "play" ? "paused" : "play";
    }

    if (this.state === "title") {
      if (this.anyStart()) {
        this.state = "play";
        this.ctx.audio.sweep(220, 520, 0.25, "sine", 0.3);
      }
      return;
    }

    if (this.state === "paused") return;

    if (this.state === "dead") {
      this.deathTimer -= dt0;
      this.stepFx(dt0);
      if (this.deathTimer <= 0) {
        this.ctx.gameOver(this.score);
        this.deathTimer = 9999; // guard against double-call
      }
      return;
    }

    const dt = this.slowmo > 0 ? dt0 * 0.35 : dt0;
    if (this.slowmo > 0) this.slowmo -= dt0;

    if (this.state === "descend") {
      const prev = this.wipe;
      this.wipe += dt0 * 1.8;
      if (prev < 1 && this.wipe >= 1) this.finishDescend();
      if (this.wipe >= 2) {
        this.wipe = 0;
        this.state = "play";
      }
      this.stepFx(dt0);
      return;
    }

    // ----- PLAY -----
    this.handleInput(dt);
    this.updatePlayer(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updatePickups(dt);
    this.checkRoomClear();
    this.checkDoors();
    this.stepFx(dt0);
    this.refreshScore();
  }

  private anyStart(): boolean {
    if (this.t < 0.3) return false;
    const inp = this.ctx.input;
    return (
      inp.pressed("Space", "Enter", "w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight") ||
      inp.pointer.justDown
    );
  }

  /* ----------------------------------------------------------- input */

  private handleInput(dt: number) {
    const inp = this.ctx.input;
    const touch = this.ctx.isTouch;

    // movement
    let mx = 0;
    let my = 0;
    if (inp.isDown("a")) mx -= 1;
    if (inp.isDown("d")) mx += 1;
    if (inp.isDown("w")) my -= 1;
    if (inp.isDown("s")) my += 1;
    if (touch) {
      if (inp.isDown("ArrowLeft")) mx -= 1;
      if (inp.isDown("ArrowRight")) mx += 1;
      if (inp.isDown("ArrowUp")) my -= 1;
      if (inp.isDown("ArrowDown")) my += 1;
    }

    // touch virtual sticks
    if (touch) {
      this.updateSticks();
      if (this.moveStick) {
        const dx = this.moveStick.x - this.moveStick.ox;
        const dy = this.moveStick.y - this.moveStick.oy;
        const l = Math.hypot(dx, dy);
        if (l > 8) {
          const mag = Math.min(1, l / 60);
          mx += (dx / l) * mag;
          my += (dy / l) * mag;
        }
      }
    }

    const ml = Math.hypot(mx, my);
    const moveSpeed = this.stats.moveSpeed;
    if (ml > 0.01) {
      const nx = mx / Math.max(1, ml);
      const ny = my / Math.max(1, ml);
      const accel = 60;
      this.pvx += nx * accel * dt;
      this.pvy += ny * accel * dt;
    }
    // friction
    const fr = Math.pow(0.0001, dt);
    this.pvx *= fr;
    this.pvy *= fr;
    // clamp speed
    const sp = Math.hypot(this.pvx, this.pvy);
    if (sp > moveSpeed) {
      this.pvx = (this.pvx / sp) * moveSpeed;
      this.pvy = (this.pvy / sp) * moveSpeed;
    }

    // ----- shooting -----
    let aimx = 0;
    let aimy = 0;
    let shooting = false;
    if (touch) {
      if (this.aimStick) {
        const dx = this.aimStick.x - this.aimStick.ox;
        const dy = this.aimStick.y - this.aimStick.oy;
        if (Math.hypot(dx, dy) > 10) {
          aimx = dx;
          aimy = dy;
          shooting = true;
        }
      }
    } else {
      // arrow keys 4-way
      if (inp.isDown("ArrowLeft")) aimx -= 1;
      if (inp.isDown("ArrowRight")) aimx += 1;
      if (inp.isDown("ArrowUp")) aimy -= 1;
      if (inp.isDown("ArrowDown")) aimy += 1;
      if (aimx !== 0 || aimy !== 0) shooting = true;
      // mouse aim toward pointer
      if (!shooting && inp.pointer.down) {
        const psx = D.sx(this.view, this.px);
        const psy = D.sy(this.view, this.py);
        const dx = inp.pointer.x - psx;
        const dy = inp.pointer.y - psy;
        if (Math.hypot(dx, dy) > 4 && inp.pointer.y > this.hudH * 0.8) {
          aimx = dx;
          aimy = dy;
          shooting = true;
        }
      }
    }

    this.fireT -= dt;
    if (shooting && this.fireT <= 0) {
      this.fire(aimx, aimy);
      this.fireT = this.stats.fireDelay;
    }
  }

  private updateSticks() {
    const pointers = this.ctx.input.pointers;
    const W = this.ctx.width;
    // drop sticks whose pointer vanished
    if (this.moveStick && !pointers.has(this.moveStick.id)) this.moveStick = null;
    if (this.aimStick && !pointers.has(this.aimStick.id)) this.aimStick = null;
    // update existing + assign new
    for (const [id, p] of pointers) {
      if (this.moveStick && this.moveStick.id === id) {
        this.moveStick.x = p.x;
        this.moveStick.y = p.y;
        continue;
      }
      if (this.aimStick && this.aimStick.id === id) {
        this.aimStick.x = p.x;
        this.aimStick.y = p.y;
        continue;
      }
      // new pointer -> assign by half
      if (p.x < W / 2) {
        if (!this.moveStick) this.moveStick = { id, ox: p.x, oy: p.y, x: p.x, y: p.y };
        else if (!this.aimStick) this.aimStick = { id, ox: p.x, oy: p.y, x: p.x, y: p.y };
      } else {
        if (!this.aimStick) this.aimStick = { id, ox: p.x, oy: p.y, x: p.x, y: p.y };
        else if (!this.moveStick) this.moveStick = { id, ox: p.x, oy: p.y, x: p.x, y: p.y };
      }
    }
  }

  private fire(ax: number, ay: number) {
    const a0 = Math.atan2(ay, ax);
    this.face = a0;
    const n = this.stats.shotCount;
    const spread = (n - 1) * 0.16;
    const speed = this.stats.shotSpeed;
    for (let i = 0; i < n; i++) {
      const a = a0 - spread / 2 + (n > 1 ? (spread / (n - 1)) * i : 0);
      this.bullets.push({
        x: this.px + Math.cos(a) * PLAYER_R,
        y: this.py + Math.sin(a) * PLAYER_R,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 0.17 + Math.min(0.12, this.stats.damage * 0.012),
        life: 0,
        maxLife: this.stats.range,
        dmg: this.stats.damage,
        pierce: this.stats.piercing,
        foe: false,
        hitIds: [],
      });
    }
    // muzzle spark
    this.spawnParticles(
      this.px + Math.cos(a0) * PLAYER_R,
      this.py + Math.sin(a0) * PLAYER_R,
      3,
      COL.bullet,
      4,
    );
    this.ctx.audio.tone(620 + Math.random() * 80, 0.05, "square", 0.18);
  }

  /* ----------------------------------------------------------- player */

  private updatePlayer(dt: number) {
    this.px += this.pvx * dt;
    this.py += this.pvy * dt;
    this.collidePlayer();
    this.resolveObstacles();
    if (this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) this.flash -= dt;
    const moving = Math.hypot(this.pvx, this.pvy) > 0.5;
    this.bob = moving ? Math.sin(this.t * 14) * this.view.scale * 0.06 : 0;
  }

  private doorOpen(): boolean {
    return this.room.cleared;
  }

  private collidePlayer() {
    const r = PLAYER_R;
    const open = this.doorOpen();
    const inGapH = Math.abs(this.px - COLS / 2) < 0.9 - r * 0.2;
    const inGapV = Math.abs(this.py - ROWS / 2) < 0.9 - r * 0.2;
    if (!(open && this.room.doors.W && inGapV)) this.px = Math.max(this.px, MIN_X + r);
    if (!(open && this.room.doors.E && inGapV)) this.px = Math.min(this.px, MAX_X - r);
    if (!(open && this.room.doors.N && inGapH)) this.py = Math.max(this.py, MIN_Y + r);
    if (!(open && this.room.doors.S && inGapH)) this.py = Math.min(this.py, MAX_Y - r);
  }

  private resolveObstacles() {
    const r = PLAYER_R;
    for (const o of this.room.obstacles) {
      const res = pushCircleOutOfCell(this.px, this.py, r, o.cx, o.cy);
      this.px = res.x;
      this.py = res.y;
    }
  }

  /* ----------------------------------------------------------- doors / rooms */

  private checkDoors() {
    if (!this.doorOpen()) return;
    let dir: Dir | null = null;
    if (this.px <= 0.55 && this.room.doors.W) dir = "W";
    else if (this.px >= COLS - 0.55 && this.room.doors.E) dir = "E";
    else if (this.py <= 0.55 && this.room.doors.N) dir = "N";
    else if (this.py >= ROWS - 0.55 && this.room.doors.S) dir = "S";
    if (dir) this.goThroughDoor(dir);
  }

  private goThroughDoor(dir: Dir) {
    const v = DIR_VEC[dir];
    const nk = `${this.room.gx + v.x},${this.room.gy + v.y}`;
    const next = this.floor.rooms.get(nk);
    if (!next) return;
    this.roomKey = nk;
    this.room = next;
    next.visited = true;
    // reset transient entities
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    // place player at opposite door, just inside
    const into = OPPOSITE[dir];
    const inset = 1.4;
    if (into === "W") {
      this.px = MIN_X + inset;
      this.py = ROWS / 2;
    } else if (into === "E") {
      this.px = MAX_X - inset;
      this.py = ROWS / 2;
    } else if (into === "N") {
      this.px = COLS / 2;
      this.py = MIN_Y + inset;
    } else {
      this.px = COLS / 2;
      this.py = MAX_Y - inset;
    }
    this.pvx = 0;
    this.pvy = 0;
    this.enterRoom();
  }

  private enterRoom() {
    const room = this.room;
    if (room.cleared) return;
    if (!room.triggered) {
      room.triggered = true;
      if (room.spawns.length === 0) {
        room.cleared = true;
        return;
      }
      // spawn enemies + lock
      for (const s of room.spawns) {
        this.enemies.push(this.makeEnemy(s.kind, s.x, s.y));
      }
      this.shake(6);
      if (room.type === "boss") {
        this.ctx.audio.sweep(160, 70, 0.5, "sawtooth", 0.4);
      } else {
        this.ctx.audio.tone(90, 0.18, "square", 0.4);
      }
    } else {
      // already triggered (e.g. re-entered mid-fight - shouldn't normally happen)
      for (const s of room.spawns) {
        this.enemies.push(this.makeEnemy(s.kind, s.x, s.y));
      }
    }
  }

  private checkRoomClear() {
    if (this.room.cleared || !this.room.triggered) return;
    if (this.enemies.length > 0) return;
    this.room.cleared = true;
    this.ctx.audio.tone(880, 0.12, "triangle", 0.35);
    setTimeout(() => this.ctx.audio.tone(1320, 0.12, "triangle", 0.3), 90);
    this.shake(4);
    if (this.room.type === "boss") {
      this.onBossDefeated();
    } else if (this.room.type === "combat") {
      // chance for a reward drop
      const rand = Math.random;
      if (rand() < 0.45 + this.stats.luck * 0.05) {
        const roll = rand();
        const kind: Pickup["kind"] = roll < 0.55 ? "coin" : roll < 0.85 ? "halfheart" : "heart";
        this.room.pickups.push({ kind, x: COLS / 2, y: ROWS / 2, t: 0 });
      }
    }
  }

  private onBossDefeated() {
    this.slowmo = 0.8;
    this.shake(16);
    this.ctx.audio.explosion();
    this.ctx.audio.win();
    this.spawnParticles(COLS / 2, ROWS / 2, 40, COL.boss, 9);
    // guaranteed reward + heart + trapdoor
    const rand = this.floorRand(this.floorNum * 777 + this.kills);
    this.room.pickups.push({
      kind: "item",
      x: COLS / 2 - 2,
      y: ROWS / 2,
      itemId: rollBossItem(rand),
      t: 0,
    });
    this.room.pickups.push({ kind: "heart", x: COLS / 2 + 2, y: ROWS / 2, t: 0 });
    this.room.trapdoor = true;
    this.room.trapOpen = true;
    // best depth
    if (this.floorNum > this.bestDepth) {
      this.bestDepth = this.floorNum;
      this.ctx.storage.set("bestDepth", this.bestDepth);
    }
  }

  /* ----------------------------------------------------------- enemies */

  private floorSpeedMul(): number {
    return Math.min(1.5, 1 + 0.05 * (this.floorNum - 1));
  }
  private floorHpMul(): number {
    return 1 + 0.18 * (this.floorNum - 1);
  }
  private enemyBulletSpeed(): number {
    return 5.5 + 0.25 * (this.floorNum - 1);
  }

  private makeEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const hpMul = this.floorHpMul();
    const base: Record<EnemyKind, { hp: number; r: number; dmg: number }> = {
      crawler: { hp: 3, r: 0.42, dmg: 1 },
      spitter: { hp: 4, r: 0.46, dmg: 1 },
      blob: { hp: 6, r: 0.52, dmg: 1 },
      blobSmall: { hp: 3, r: 0.34, dmg: 1 },
      floater: { hp: 4, r: 0.42, dmg: 1 },
      boss: { hp: 58 + this.floorNum * 14, r: 1.3, dmg: 1 },
    };
    const b = base[kind];
    const hp = kind === "boss" ? b.hp : Math.round(b.hp * hpMul);
    return {
      id: this.enemyId++,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      r: b.r,
      hp,
      maxHp: hp,
      touchDmg: b.dmg,
      flash: 0,
      t: Math.random() * 3,
      fireT: 1 + Math.random() * 1.5,
      phase: 0,
      windup: 0,
      charge: 3 + Math.random() * 2,
      face: 0,
    };
  }

  private updateEnemies(dt: number) {
    const spMul = this.floorSpeedMul();
    for (const e of this.enemies) {
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;
      const dx = this.px - e.x;
      const dy = this.py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const dirx = dx / d;
      const diry = dy / d;

      switch (e.kind) {
        case "crawler":
          e.vx = dirx * 3 * spMul;
          e.vy = diry * 3 * spMul;
          break;
        case "blob":
        case "blobSmall": {
          const sp = (e.kind === "blob" ? 2.6 : 3.6) * spMul;
          const wob = Math.sin(e.t * 4) * 0.6;
          e.vx = dirx * sp + -diry * wob;
          e.vy = diry * sp + dirx * wob;
          break;
        }
        case "spitter": {
          e.face = Math.atan2(dy, dx);
          const want = 4.2;
          const sp = 2.4 * spMul;
          if (d > want + 0.6) {
            e.vx = dirx * sp;
            e.vy = diry * sp;
          } else if (d < want - 0.6) {
            e.vx = -dirx * sp;
            e.vy = -diry * sp;
          } else {
            e.vx = -diry * sp * 0.8;
            e.vy = dirx * sp * 0.8;
          }
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = Math.max(0.7, 1.7 - 0.08 * this.floorNum);
            this.enemyShot(e.x, e.y, Math.atan2(dy, dx));
          }
          break;
        }
        case "floater": {
          const sp = 1.8 * spMul;
          const perp = Math.sin(e.t * 2.5) * 1.4;
          e.vx = dirx * sp + -diry * perp;
          e.vy = diry * sp + dirx * perp;
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = 2.4;
            const base = Math.atan2(dy, dx);
            for (let i = -1; i <= 1; i++) this.enemyShot(e.x, e.y, base + i * 0.4);
          }
          break;
        }
        case "boss":
          this.updateBoss(e, dt, dirx, diry, d);
          break;
      }

      // floaters ignore obstacles; others collide
      if (e.kind !== "floater") {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        for (const o of this.room.obstacles) {
          const res = pushCircleOutOfCell(e.x, e.y, e.r, o.cx, o.cy);
          e.x = res.x;
          e.y = res.y;
        }
      } else {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
      // keep within interior
      e.x = clamp(e.x, MIN_X + e.r, MAX_X - e.r);
      e.y = clamp(e.y, MIN_Y + e.r, MAX_Y - e.r);

      // contact damage
      const rr = e.r + PLAYER_R;
      if (this.invuln <= 0 && (this.px - e.x) ** 2 + (this.py - e.y) ** 2 < rr * rr) {
        this.hurtPlayer(e.touchDmg);
      }
    }
    // soft separation
    this.separateEnemies();
  }

  private updateBoss(e: Enemy, dt: number, dirx: number, diry: number, d: number) {
    e.face = Math.atan2(diry, dirx);
    e.phase = e.hp <= e.maxHp * 0.5 ? 1 : 0;
    const spMul = this.floorSpeedMul();

    if (e.windup > 0) {
      // telegraph; stand still, then launch the dash
      e.windup -= dt;
      e.vx = 0;
      e.vy = 0;
      if (e.windup <= 0) {
        e.vx = dirx * 16;
        e.vy = diry * 16;
        e.charge = -0.4; // negative = active dash timer
        this.ctx.audio.sweep(400, 120, 0.25, "sawtooth", 0.4);
      }
    } else if (e.charge < 0) {
      // currently dashing: glide + decay, ignore steering
      e.charge += dt;
      e.vx *= Math.pow(0.05, dt);
      e.vy *= Math.pow(0.05, dt);
      if (e.charge >= 0) e.charge = 4; // reset cooldown after dash
    } else {
      const sp = (e.phase === 1 ? 2.6 : 1.7) * spMul;
      e.vx = dirx * sp;
      e.vy = diry * sp;
      if (e.phase === 1) {
        e.charge -= dt;
        if (e.charge <= 0) {
          e.windup = 0.55;
          this.spawnParticles(e.x, e.y, 8, "#ff9a6a", 4);
        }
      }
    }

    // ranged attacks
    e.fireT -= dt;
    if (e.fireT <= 0) {
      if (e.phase === 0) {
        e.fireT = 2.2;
        const count = 10 + this.floorNum;
        for (let i = 0; i < count; i++) {
          this.enemyShot(e.x, e.y, (i / count) * Math.PI * 2);
        }
        // aimed triple
        const base = Math.atan2(this.py - e.y, this.px - e.x);
        for (let i = -1; i <= 1; i++) this.enemyShot(e.x, e.y, base + i * 0.22);
      } else {
        e.fireT = 0.16;
        e.face += 0.5;
        this.enemyShot(e.x, e.y, e.face);
        this.enemyShot(e.x, e.y, e.face + Math.PI);
      }
    }

    // minions when low
    if (e.phase === 1 && e.hp < e.maxHp * 0.33) {
      if (e.t > 4) {
        e.t = 0;
        this.enemies.push(this.makeEnemy("crawler", e.x + 1, e.y));
        this.enemies.push(this.makeEnemy("crawler", e.x - 1, e.y));
        this.ctx.audio.tone(120, 0.2, "square", 0.3);
      }
    }
  }

  private separateEnemies() {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.kind === "boss") continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.kind === "boss") continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  private enemyShot(x: number, y: number, ang: number) {
    if (this.bullets.length >= MAX_BULLETS) return;
    const sp = this.enemyBulletSpeed();
    this.bullets.push({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r: 0.22,
      life: 0,
      maxLife: 4,
      dmg: 1,
      pierce: 0,
      foe: true,
    });
    this.ctx.audio.tone(220, 0.06, "sawtooth", 0.12);
  }

  /* ----------------------------------------------------------- bullets */

  private updateBullets(dt: number) {
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life += dt;
      if (b.life >= b.maxLife) {
        b.dead = true;
        continue;
      }
      // wall collision (interior bounds)
      if (b.x < MIN_X || b.x > MAX_X || b.y < MIN_Y || b.y > MAX_Y) {
        b.dead = true;
        this.spawnParticles(b.x, b.y, 3, b.foe ? COL.enemyBullet : COL.bullet, 3);
        continue;
      }
      // obstacle collision
      for (const o of this.room.obstacles) {
        if (b.x > o.cx && b.x < o.cx + 1 && b.y > o.cy && b.y < o.cy + 1) {
          if (b.pierce <= 0) {
            b.dead = true;
            this.spawnParticles(b.x, b.y, 3, b.foe ? COL.enemyBullet : COL.bullet, 3);
          }
          break;
        }
      }
      if (b.dead) continue;

      if (b.foe) {
        if (this.invuln <= 0) {
          const rr = b.r + PLAYER_R * 0.85;
          if ((b.x - this.px) ** 2 + (b.y - this.py) ** 2 < rr * rr) {
            b.dead = true;
            this.hurtPlayer(b.dmg);
          }
        }
      } else {
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (b.hitIds && b.hitIds.indexOf(e.id) !== -1) continue;
          const rr = b.r + e.r;
          if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 < rr * rr) {
            this.damageEnemy(e, b.dmg, b.vx, b.vy);
            if (b.pierce > 0) {
              b.pierce--;
              if (b.hitIds) b.hitIds.push(e.id);
            } else {
              b.dead = true;
            }
            break;
          }
        }
      }
    }
    if (this.bullets.length > MAX_BULLETS) {
      this.bullets.splice(0, this.bullets.length - MAX_BULLETS);
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  private damageEnemy(e: Enemy, dmg: number, vx: number, vy: number) {
    e.hp -= dmg;
    e.flash = 0.1;
    // knockback (light, none for boss)
    if (e.kind !== "boss") {
      const k = norm(vx, vy);
      e.x += k.x * 0.18;
      e.y += k.y * 0.18;
    }
    this.dmgNums.push({
      x: e.x,
      y: e.y - e.r,
      vy: -1.6,
      life: 0.7,
      text: String(dmg),
      color: COL.white,
      size: 0.6,
    });
    this.spawnParticles(e.x, e.y, 3, this.enemyColor(e.kind), 4);
    this.ctx.audio.tone(420 - Math.random() * 60, 0.04, "square", 0.12);
    if (e.hp <= 0) this.killEnemy(e);
  }

  private enemyColor(kind: EnemyKind): string {
    switch (kind) {
      case "crawler":
        return COL.crawler;
      case "spitter":
        return COL.spitter;
      case "blob":
      case "blobSmall":
        return COL.blob;
      case "floater":
        return COL.floater;
      case "boss":
        return COL.boss;
    }
  }

  private killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.spawnParticles(e.x, e.y, e.kind === "boss" ? 36 : 10, this.enemyColor(e.kind), e.kind === "boss" ? 8 : 5);
    this.shake(e.kind === "boss" ? 14 : 3);
    if (e.kind !== "boss") this.ctx.audio.noise(0.12, 0.25);

    // splitter splits
    if (e.kind === "blob") {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = this.makeEnemy("blobSmall", e.x + Math.cos(a) * 0.4, e.y + Math.sin(a) * 0.4);
        this.enemies.push(s);
      }
    }

    // small coin/heart chance from non-boss kills
    if (e.kind !== "boss" && Math.random() < 0.18 + this.stats.luck * 0.03) {
      const roll = Math.random();
      const kind: Pickup["kind"] = roll < 0.7 ? "coin" : "halfheart";
      this.room.pickups.push({ kind, x: e.x, y: e.y, t: 0 });
    }

    this.enemies = this.enemies.filter((x) => !x.dead);
  }

  /* ----------------------------------------------------------- pickups */

  private updatePickups(dt: number) {
    const r = PLAYER_R + 0.45;
    for (const p of this.room.pickups) {
      if (p.taken) continue;
      p.t += dt;
      const d2 = (p.x - this.px) ** 2 + (p.y - this.py) ** 2;
      if (d2 < r * r) {
        this.tryPickup(p);
      }
    }
    // trapdoor descend
    if (this.room.trapdoor && this.room.trapOpen) {
      const d2 = (COLS / 2 - this.px) ** 2 + (ROWS / 2 - this.py) ** 2;
      if (d2 < 0.6 * 0.6) this.beginDescend();
    }
  }

  private tryPickup(p: Pickup) {
    // shop cost gate
    if (p.cost && p.cost > 0) {
      if (this.stats.coins < p.cost) return;
      this.stats.coins -= p.cost;
      this.ctx.audio.coin();
    }
    p.taken = true;
    switch (p.kind) {
      case "coin":
        this.stats.coins += p.cost ? 5 : 1;
        this.ctx.audio.coin();
        this.spawnParticles(p.x, p.y, 5, COL.coin, 4);
        break;
      case "heart":
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 2);
        this.ctx.audio.tone(660, 0.1, "triangle", 0.4);
        this.spawnParticles(p.x, p.y, 6, COL.heart, 4);
        break;
      case "halfheart":
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 1);
        this.ctx.audio.tone(560, 0.09, "triangle", 0.35);
        this.spawnParticles(p.x, p.y, 4, COL.heart, 3);
        break;
      case "item": {
        if (p.itemId) {
          const def = applyItem(p.itemId, this.stats);
          if (def) {
            this.toast = `${def.name} — ${def.blurb}`;
            this.toastT = 3;
          }
        }
        this.ctx.audio.win();
        this.spawnParticles(p.x, p.y, 14, COL.itemGlow, 6);
        this.shake(3);
        break;
      }
    }
    this.room.pickups = this.room.pickups.filter((x) => !x.taken);
  }

  /* ----------------------------------------------------------- descend */

  private beginDescend() {
    if (this.state === "descend") return;
    this.state = "descend";
    this.wipe = 0;
    this.ctx.audio.sweep(500, 120, 0.4, "sine", 0.4);
  }

  private finishDescend() {
    this.floorsCompleted++;
    this.floorNum++;
    this.loadFloor(this.floorNum);
    if (this.floorNum > this.bestDepth) {
      this.bestDepth = this.floorNum;
      this.ctx.storage.set("bestDepth", this.bestDepth);
    }
    this.refreshScore();
  }

  /* ----------------------------------------------------------- damage / death */

  private hurtPlayer(dmg: number) {
    if (this.invuln > 0 || this.state !== "play") return;
    this.stats.hp -= dmg;
    this.invuln = 1.0;
    this.flash = 0.12;
    this.hurtFlash = 0.4;
    this.shake(9);
    this.ctx.audio.sweep(300, 90, 0.25, "sawtooth", 0.4);
    this.ctx.audio.noise(0.15, 0.3);
    this.dmgNums.push({
      x: this.px,
      y: this.py - PLAYER_R,
      vy: -1.8,
      life: 0.8,
      text: `-${dmg}`,
      color: COL.heart,
      size: 0.7,
    });
    if (this.stats.hp <= 0) {
      this.stats.hp = 0;
      this.die();
    }
  }

  private die() {
    if (this.state === "dead") return;
    this.state = "dead";
    this.deathTimer = 1.1;
    this.slowmo = 0.6;
    this.shake(18);
    this.ctx.audio.lose();
    this.spawnParticles(this.px, this.py, 30, COL.player, 8);
    // persist best score
    this.refreshScore();
    this.ctx.storage.submitScore(this.score);
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.ctx.storage.set("bestScore", this.bestScore);
    }
  }

  private refreshScore() {
    const s = this.floorsCompleted * 100 + this.kills * 10;
    if (s !== this.score) {
      this.score = s;
      this.ctx.reportScore(s);
    }
  }

  /* ----------------------------------------------------------- fx */

  private shake(m: number) {
    this.shakeMag = Math.max(this.shakeMag, m);
    this.shakeT = Math.max(this.shakeT, 0.35);
  }

  private spawnParticles(x: number, y: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.3 + Math.random() * 0.5,
        size: 0.06 + Math.random() * 0.08,
        color,
      });
    }
  }

  private stepFx(dt: number) {
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.toastT > 0) this.toastT -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const d of this.dmgNums) {
      d.life -= dt;
      d.y += d.vy * dt;
      d.vy *= 0.92;
    }
    this.dmgNums = this.dmgNums.filter((d) => d.life > 0);
  }

  /* =====================================================================
   *  RENDER
   * ===================================================================== */

  render() {
    const c = this.ctx.ctx;
    const W = this.ctx.width;
    const H = this.ctx.height;

    // backdrop
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COL.bgTop);
    bg.addColorStop(1, COL.bgBottom);
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    this.drawBackdropMotes(c, W, H);

    if (this.state === "title") {
      this.renderTitle(c, W, H);
      return;
    }

    const v = this.view;

    c.save();
    if (this.shakeT > 0) {
      const m = this.shakeMag * (this.shakeT / 0.35);
      c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    const doorOpen = this.doorOpen();
    D.drawRoom(c, v, this.room, this.t, doorOpen);

    // obstacles
    for (const o of this.room.obstacles) {
      this.drawObstacle(c, v, o.cx, o.cy);
    }

    // pickups (under entities)
    this.renderPickups(c, v);

    // trapdoor
    if (this.room.trapdoor) {
      D.drawTrapdoor(c, D.sx(v, COLS / 2), D.sy(v, ROWS / 2), v.scale * 0.7, this.room.trapOpen, this.t);
    }

    // particles (behind)
    this.renderParticles(c, v);

    // bullets
    for (const b of this.bullets) {
      const fade = b.life > b.maxLife - 0.25 ? clamp((b.maxLife - b.life) / 0.25, 0, 1) : 1;
      D.drawBullet(c, D.sx(v, b.x), D.sy(v, b.y), b.r * v.scale, b.foe, fade);
    }

    // enemies
    for (const e of this.enemies) {
      D.drawEnemy(c, e, D.sx(v, e.x), D.sy(v, e.y), e.r * v.scale, this.t);
    }

    // player
    if (this.state !== "dead") {
      D.drawPlayer(
        c,
        D.sx(v, this.px),
        D.sy(v, this.py),
        PLAYER_R * v.scale,
        this.face,
        this.bob,
        this.flash,
        this.invuln > 0,
        this.t,
      );
    }

    // damage numbers
    for (const d of this.dmgNums) {
      const a = clamp(d.life / 0.7, 0, 1);
      c.globalAlpha = a;
      drawText(c, d.text, D.sx(v, d.x), D.sy(v, d.y), d.size * v.scale, d.color, "center");
      c.globalAlpha = 1;
    }

    c.restore();

    // hurt vignette
    if (this.hurtFlash > 0) {
      c.fillStyle = `rgba(220,30,50,${this.hurtFlash * 0.5})`;
      c.fillRect(0, 0, W, H);
    }

    // boss HP bar
    const boss = this.enemies.find((e) => e.kind === "boss");
    if (boss) this.renderBossBar(c, W, H, boss);

    // HUD
    this.renderHud(c, W, H);

    if (this.state === "descend") this.renderWipe(c, W, H);
    if (this.state === "paused") this.renderPause(c, W, H);
    if (this.state === "dead") this.renderDeath(c, W, H);
  }

  private drawBackdropMotes(c: CanvasRenderingContext2D, W: number, H: number) {
    c.fillStyle = "rgba(180,140,220,0.10)";
    for (let i = 0; i < 26; i++) {
      const x = ((i * 7919) % W) + Math.sin(this.t * 0.4 + i) * 12;
      const y = (((i * 104729) % H) + this.t * 14 * ((i % 3) + 1)) % H;
      const s = 1 + (i % 3);
      c.fillRect(x, y, s, s);
    }
  }

  private drawObstacle(c: CanvasRenderingContext2D, v: View, cx: number, cy: number) {
    const x = D.sx(v, cx);
    const y = D.sy(v, cy);
    const s = v.scale;
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.fillRect(x + s * 0.12, y + s * 0.22, s * 0.86, s * 0.82);
    c.fillStyle = "#352a44";
    c.fillRect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.78);
    c.fillStyle = "#4a3c5e";
    c.fillRect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.16);
    c.fillStyle = "#241b30";
    c.fillRect(x + s * 0.22, y + s * 0.5, s * 0.2, s * 0.2);
    c.fillRect(x + s * 0.56, y + s * 0.34, s * 0.16, s * 0.16);
  }

  private renderPickups(c: CanvasRenderingContext2D, v: View) {
    for (const p of this.room.pickups) {
      if (p.taken) continue;
      const x = D.sx(v, p.x);
      const float = Math.sin(this.t * 2 + p.x) * v.scale * 0.1;
      const y = D.sy(v, p.y) + float;
      const s = v.scale * 0.5;
      if (p.kind === "coin") {
        D.drawCoin(c, x, y, s * 0.6, this.t);
      } else if (p.kind === "heart") {
        D.drawHeart(c, x, y, s * 0.7, COL.heart);
      } else if (p.kind === "halfheart") {
        D.drawHalfHeart(c, x, y, s * 0.6, COL.heart, COL.heartEmpty);
      } else if (p.kind === "item") {
        const gy = D.drawPedestal(c, D.sx(v, p.x), D.sy(v, p.y), v.scale * 0.6, this.t);
        if (p.itemId) D.drawItemGlyph(c, D.sx(v, p.x), gy, v.scale * 0.45, p.itemId);
      }
      // cost label
      if (p.cost && p.cost > 0) {
        drawText(c, `${p.cost}c`, x, D.sy(v, p.y) + v.scale * 0.85, v.scale * 0.3, COL.coin, "center");
      }
    }
  }

  private renderParticles(c: CanvasRenderingContext2D, v: View) {
    for (const p of this.particles) {
      c.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
      c.fillStyle = p.color;
      const s = p.size * v.scale;
      c.fillRect(D.sx(v, p.x) - s / 2, D.sy(v, p.y) - s / 2, s, s);
    }
    c.globalAlpha = 1;
  }

  /* ----------------------------------------------------------- HUD */

  private renderHud(c: CanvasRenderingContext2D, W: number, H: number) {
    const min = Math.min(W, H);
    const pad = min * 0.025;
    const hs = clamp(min * 0.03, 10, 22); // heart size

    // hearts row
    const hearts = Math.ceil(this.stats.maxHp / 2);
    for (let i = 0; i < hearts; i++) {
      const hx = pad + hs * 1.3 + i * hs * 2.3;
      const hy = pad + hs;
      const filled = this.stats.hp - i * 2;
      if (filled >= 2) D.drawHeart(c, hx, hy, hs, COL.heart);
      else if (filled === 1) D.drawHalfHeart(c, hx, hy, hs, COL.heart, COL.heartEmpty);
      else D.drawHeart(c, hx, hy, hs, COL.heartEmpty);
    }

    // coins
    const cy = pad + hs * 2.9;
    D.drawCoin(c, pad + hs * 0.9, cy, hs * 0.7, this.t);
    drawText(c, `${this.stats.coins}`, pad + hs * 1.9, cy, hs * 1.1, COL.coin, "left");

    // floor center
    drawText(c, `FLOOR ${this.floorNum}`, W / 2, pad + hs * 0.9, hs * 1.3, COL.hudText, "center");

    // score right
    drawText(c, `${this.score}`, W - pad, pad + hs * 0.9, hs * 1.3, COL.hudText, "right");
    drawText(c, `BEST ${this.bestScore}`, W - pad, pad + hs * 2.2, hs * 0.7, COL.hudDim, "right");

    // minimap
    this.renderMinimap(c, W, H);

    // toast
    if (this.toastT > 0) {
      const a = clamp(this.toastT / 0.5, 0, 1);
      c.globalAlpha = a;
      c.fillStyle = "rgba(20,12,28,0.85)";
      const tw = min * 0.5;
      const th = min * 0.07;
      const tx = (W - tw) / 2;
      const ty = H - this.hudH - th - min * 0.02;
      c.fillRect(tx, ty, tw, th);
      c.fillStyle = COL.itemGlow;
      c.fillRect(tx, ty, tw, th * 0.08);
      drawText(c, this.toast, W / 2, ty + th / 2, th * 0.4, COL.hudText, "center");
      c.globalAlpha = 1;
    }
  }

  private renderMinimap(c: CanvasRenderingContext2D, W: number, H: number) {
    const min = Math.min(W, H);
    const cell = clamp(min * 0.022, 7, 16);
    const gap = cell * 0.25;
    const mapW = 5; // show a 5x5 window around current room
    const total = mapW * (cell + gap);
    const mx = W - total - min * 0.02;
    const my = min * 0.07;

    c.fillStyle = "rgba(10,6,16,0.55)";
    c.fillRect(mx - gap, my - gap, total + gap, total + gap);

    const half = Math.floor(mapW / 2);
    for (const room of this.floor.rooms.values()) {
      if (!room.visited && room.dist > 0 && !this.isAdjacentVisited(room)) continue;
      const rx = room.gx - this.room.gx + half;
      const ry = room.gy - this.room.gy + half;
      if (rx < 0 || ry < 0 || rx >= mapW || ry >= mapW) continue;
      const x = mx + rx * (cell + gap);
      const y = my + ry * (cell + gap);
      let col = "#4a3c5e";
      if (!room.visited) col = "#2a2238";
      else if (room.cleared) col = "#6a5a82";
      if (room.type === "boss") col = room.cleared ? "#7a4a52" : "#c44a5a";
      if (room.type === "treasure") col = "#caa84a";
      if (room.type === "shop") col = "#4ac6c4";
      if (room === this.room) col = "#ffffff";
      c.fillStyle = col;
      c.fillRect(x, y, cell, cell);
      // icon dot
      if (room.visited || this.isAdjacentVisited(room)) {
        if (room.type === "boss") {
          c.fillStyle = "#1a0a0a";
          c.fillRect(x + cell * 0.35, y + cell * 0.3, cell * 0.3, cell * 0.3);
        } else if (room.type === "treasure") {
          c.fillStyle = "#5a4a10";
          c.fillRect(x + cell * 0.38, y + cell * 0.38, cell * 0.24, cell * 0.24);
        }
      }
    }
  }

  private isAdjacentVisited(room: RoomDef): boolean {
    for (const d of DIRS) {
      if (!room.doors[d]) continue;
      const v = DIR_VEC[d];
      const nb = this.floor.rooms.get(`${room.gx + v.x},${room.gy + v.y}`);
      if (nb && nb.visited) return true;
    }
    return false;
  }

  private renderBossBar(c: CanvasRenderingContext2D, W: number, H: number, boss: Enemy) {
    const min = Math.min(W, H);
    const bw = W * 0.6;
    const bh = min * 0.025;
    const bx = (W - bw) / 2;
    const by = H - this.hudH * 0.5;
    c.fillStyle = "rgba(0,0,0,0.5)";
    c.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    c.fillStyle = "#2a0e0e";
    c.fillRect(bx, by, bw, bh);
    const frac = clamp(boss.hp / boss.maxHp, 0, 1);
    c.fillStyle = "#e2563f";
    c.fillRect(bx, by, bw * frac, bh);
    c.fillStyle = "rgba(255,255,255,0.25)";
    c.fillRect(bx, by, bw * frac, bh * 0.4);
    drawText(c, "THE CINDER KING", W / 2, by + bh / 2, bh * 0.8, "#fff", "center");
  }

  /* ----------------------------------------------------------- overlays */

  private renderWipe(c: CanvasRenderingContext2D, W: number, H: number) {
    // diamond/iris wipe out then in
    const p = this.wipe <= 1 ? this.wipe : 2 - this.wipe;
    c.fillStyle = "#05030a";
    const h = H * p;
    c.fillRect(0, 0, W, h);
    c.fillRect(0, H - h, W, h);
    if (p > 0.4) {
      drawText(c, `DESCENDING…`, W / 2, H / 2, Math.min(W, H) * 0.06, COL.hudText, "center");
    }
  }

  private renderPause(c: CanvasRenderingContext2D, W: number, H: number) {
    c.fillStyle = "rgba(5,3,10,0.7)";
    c.fillRect(0, 0, W, H);
    const min = Math.min(W, H);
    drawText(c, "PAUSED", W / 2, H * 0.35, min * 0.1, COL.hudText, "center");
    drawText(c, `Floor ${this.floorNum} · Score ${this.score}`, W / 2, H * 0.48, min * 0.045, COL.hudDim, "center");
    drawText(c, `Best depth ${this.bestDepth} · Best ${this.bestScore}`, W / 2, H * 0.55, min * 0.04, COL.hudDim, "center");
    drawText(c, "P / Esc to resume", W / 2, H * 0.66, min * 0.045, COL.hudText, "center");
  }

  private renderDeath(c: CanvasRenderingContext2D, W: number, H: number) {
    c.fillStyle = `rgba(20,2,6,${clamp(1 - this.deathTimer, 0, 1) * 0.7})`;
    c.fillRect(0, 0, W, H);
    const min = Math.min(W, H);
    drawText(c, "YOU DIED", W / 2, H * 0.45, min * 0.1, "#ff5470", "center");
    drawText(c, `Floor ${this.floorNum} · Score ${this.score}`, W / 2, H * 0.56, min * 0.05, COL.hudText, "center");
  }

  private renderTitle(c: CanvasRenderingContext2D, W: number, H: number) {
    const min = Math.min(W, H);
    const cx = W / 2;
    // animated crypt arch + logo
    c.save();
    c.translate(cx, H * 0.34);
    const pulse = 1 + Math.sin(this.t * 2) * 0.03;
    c.scale(pulse, pulse);
    // emblem: skull-ish sigil
    c.fillStyle = "#1a0f24";
    c.beginPath();
    c.arc(0, 0, min * 0.13, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = COL.bossDoor;
    c.lineWidth = min * 0.012;
    c.beginPath();
    c.arc(0, 0, min * 0.13, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = COL.bossEye;
    c.beginPath();
    c.arc(-min * 0.045, -min * 0.02, min * 0.028, 0, Math.PI * 2);
    c.arc(min * 0.045, -min * 0.02, min * 0.028, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#1a0f24";
    c.beginPath();
    c.arc(-min * 0.045, -min * 0.02, min * 0.012, 0, Math.PI * 2);
    c.arc(min * 0.045, -min * 0.02, min * 0.012, 0, Math.PI * 2);
    c.fill();
    c.restore();

    drawText(c, "CRYPT OF THE", cx, H * 0.55, min * 0.055, COL.hudDim, "center");
    drawText(c, "CINDER KING", cx, H * 0.63, min * 0.1, COL.heart, "center");
    drawText(
      c,
      this.ctx.isTouch ? "Tap to begin" : "Press any key to begin",
      cx,
      H * 0.76,
      min * 0.045,
      COL.hudText,
      "center",
    );
    drawText(
      c,
      `Best depth: Floor ${this.bestDepth}   ·   Best score: ${this.bestScore}`,
      cx,
      H * 0.84,
      min * 0.035,
      COL.hudDim,
      "center",
    );
    const ctrl = this.ctx.isTouch
      ? "Left drag move · Right drag aim & fire"
      : "WASD move · Arrows or mouse to shoot · P pause";
    drawText(c, ctrl, cx, H * 0.9, min * 0.03, COL.hudDim, "center");
  }

  /* ----------------------------------------------------------- lifecycle */

  onPause() {
    if (this.state === "play") this.state = "paused";
  }
}

/* =========================================================== free helpers */

function pushCircleOutOfCell(
  px: number,
  py: number,
  r: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const closeX = clamp(px, cx, cx + 1);
  const closeY = clamp(py, cy, cy + 1);
  const dx = px - closeX;
  const dy = py - closeY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return { x: px, y: py };
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    const push = r - d;
    return { x: px + (dx / d) * push, y: py + (dy / d) * push };
  }
  // center inside the cell: push out along the smallest penetration axis
  const left = px - cx;
  const right = cx + 1 - px;
  const top = py - cy;
  const bottom = cy + 1 - py;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: cx - r, y: py };
  if (m === right) return { x: cx + 1 + r, y: py };
  if (m === top) return { x: px, y: cy - r };
  return { x: px, y: cy + 1 + r };
}

function rollBossItem(rand: () => number): string {
  // boss drops weighted toward stronger items
  const pool = ["ember", "lens", "twin", "wick", "pierce", "locket", "glass", "fuse"];
  return pool[Math.floor(rand() * pool.length)];
}

export function createGame(ctx: GameContext): Game {
  return new Game(ctx);
}
