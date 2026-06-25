/**
 * Nightfall Survivors — an original auto-attacking survival roguelite.
 *
 * Move to survive; weapons fire automatically. Collect XP, level up, choose
 * upgrades, evolve your arsenal, and outlast endless escalating hordes.
 *
 * Entry point: `create(ctx)` returns a GameInstance. All simulation is in world
 * coordinates; the camera follows the player. Canvas-only procedural visuals.
 */
import type { GameContext, GameInstance } from "@/engine";
import { clamp, drawText, roundRect } from "@/engine";

import type {
  Beam,
  DamageNumber,
  DamageOpts,
  Enemy,
  Gem,
  Offer,
  OwnedPassive,
  Particle,
  Player,
  Projectile,
  Stats,
  Vec,
  WeaponState,
  World,
} from "./types";
import {
  CAPS,
  COLORS,
  DIRECTOR,
  LIMITS,
  PLAYER,
  bossHp,
  dmgScale,
  gemColor,
  hpScale,
  speedScale,
  spawnBatch,
  spawnInterval,
  xpScale,
  xpToNext,
} from "./config";
import {
  ENEMIES,
  NEW_WEAPON_IDS,
  PASSIVES,
  PASSIVE_IDS,
  WEAPONS,
  bossId,
  spawnPool,
} from "./defs";
import { SpatialGrid } from "./grid";

const TAU = Math.PI * 2;

type GameState = "playing" | "levelup" | "paused" | "dead";

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  // ----- pools & live entity lists -----
  const enemies: Enemy[] = [];
  const enemyPool: Enemy[] = [];
  const projectiles: Projectile[] = [];
  const projPool: Projectile[] = [];
  const gems: Gem[] = [];
  const gemPool: Gem[] = [];
  const particles: Particle[] = [];
  const particlePool: Particle[] = [];
  const dmgNumbers: DamageNumber[] = [];
  const dmgPool: DamageNumber[] = [];
  const beams: Beam[] = [];
  const beamPool: Beam[] = [];

  let enemyIdSeq = 1;

  // ----- spatial grid (rebuilt each frame) for fast radius queries -----
  const grid = new SpatialGrid(70);

  function rebuildGrid() {
    grid.clear();
    for (let i = 0; i < enemies.length; i++) grid.insert(enemies[i]);
  }

  function queryRadius(x: number, y: number, r: number, cb: (e: Enemy) => void) {
    grid.query(x, y, r, cb);
  }

  // ----- player & progression -----
  const baseStats = (): Stats => ({
    damageMult: 1,
    cooldownMult: 1,
    areaMult: 1,
    projSpeedMult: 1,
    projCountBonus: 0,
    moveMult: 1,
    magnet: 78,
    xpMult: 1,
    regen: 0,
    armorMult: 1,
    durationMult: 1,
    critChance: 0.05,
    critMult: 1.6,
  });

  const player: Player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    hp: PLAYER.baseMaxHp,
    maxHp: PLAYER.baseMaxHp,
    level: 1,
    xp: 0,
    xpToNext: xpToNext(1),
    invuln: PLAYER.startInvuln,
    facingX: 0,
    facingY: 1,
    flash: 0,
    regenAcc: 0,
    anim: 0,
    stats: baseStats(),
  };

  const weapons: WeaponState[] = [];
  const passives: OwnedPassive[] = [];
  let bonusMaxHp = 0;

  let state: GameState = "playing";
  let time = 0;
  let kills = 0;
  let score = 0;
  let lastReported = -1;
  let pendingLevels = 0;
  let offers: Offer[] = [];
  let hintTimer = 6;
  let deadHandled = false;

  // camera + shake
  let camX = 0;
  let camY = 0;
  let shakeMag = 0;

  // director
  let spawnT = 0;
  let nextBoss = DIRECTOR.bossEvery;
  let nextSwarm = DIRECTOR.swarmEvery;
  let bossIndex = 0;
  let activeBoss: Enemy | null = null;

  const best = storage.get<number>("__best", 0);

  // touch joystick
  const joy = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  const JOY_MAX = 64;

  ctx.requestControls([{ type: "dpad" }]);
  ctx.setStatus(best > 0 ? `Survive! Best: ${best}` : "Move to survive — weapons auto-fire");

  // ---------------------------------------------------------------------
  // stats
  // ---------------------------------------------------------------------
  function recomputeStats() {
    const s = baseStats();
    let vitFactor = 1;
    for (const op of passives) {
      const def = PASSIVES[op.defId];
      if (!def) continue;
      if (op.defId === "vitality") vitFactor *= 1 + 0.18 * op.level;
      else def.apply(s, op.level);
    }
    player.stats = s;
    const newMax = (PLAYER.baseMaxHp + bonusMaxHp) * vitFactor;
    if (newMax > player.maxHp) player.hp += newMax - player.maxHp;
    player.maxHp = newMax;
    player.hp = Math.min(player.hp, player.maxHp);
  }

  function syncSlots() {
    for (let i = 0; i < weapons.length; i++) weapons[i].data.slot = i;
  }

  function addWeapon(id: string) {
    const def = WEAPONS[id];
    if (!def) return;
    const w: WeaponState = { defId: id, level: 1, timer: 0, angle: 0, data: {} };
    weapons.push(w);
    syncSlots();
    def.init?.(worldApi, w);
  }

  // ---------------------------------------------------------------------
  // entity factories (pooled)
  // ---------------------------------------------------------------------
  function obtainEnemy(): Enemy {
    const e = enemyPool.pop();
    if (e) return e;
    return {
      id: 0,
      typeId: "bat",
      kind: "chase",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      hp: 1,
      maxHp: 1,
      radius: 10,
      speed: 50,
      damage: 5,
      xp: 1,
      flash: 0,
      contactCd: 0,
      slow: 0,
      slowFactor: 1,
      knockX: 0,
      knockY: 0,
      kbResist: 0,
      hitTimers: new Array<number>(LIMITS.maxWeaponSlots).fill(0),
      anim: 0,
      boss: false,
      fireCd: 0,
      windup: 0,
      dashTime: 0,
      dashX: 0,
      dashY: 0,
      alive: true,
    };
  }

  function obtainProjectile(): Projectile {
    const p = projPool.pop();
    if (p) {
      p.hits.length = 0;
      p.trail.length = 0;
      return p;
    }
    return {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 6,
      damage: 1,
      pierce: 1,
      life: 1,
      maxLife: 1,
      color: "#fff",
      kind: "shard",
      spin: 0,
      hits: [],
      slotIndex: 0,
      fromEnemy: false,
      area: 0,
      slowOnHit: 0,
      slowTime: 0,
      knockback: 0,
      crit: false,
      returning: false,
      originX: 0,
      originY: 0,
      trail: [],
      alive: true,
    };
  }

  function obtainGem(): Gem {
    const g = gemPool.pop();
    if (g) return g;
    return { x: 0, y: 0, vx: 0, vy: 0, value: 1, kind: 0, attracting: false, anim: 0, life: 0, alive: true };
  }

  function obtainParticle(): Particle {
    const p = particlePool.pop();
    if (p) return p;
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: "#fff", drag: 0, shape: 0, alive: true };
  }

  function obtainDmg(): DamageNumber {
    const d = dmgPool.pop();
    if (d) return d;
    return { x: 0, y: 0, vy: 0, life: 0, maxLife: 1, text: "", color: "#fff", size: 14, alive: true };
  }

  function obtainBeam(): Beam {
    const b = beamPool.pop();
    if (b) return b;
    return { x1: 0, y1: 0, x2: 0, y2: 0, life: 0, maxLife: 1, color: "#fff", width: 2, alive: true };
  }

  // ---------------------------------------------------------------------
  // World API (passed to weapon / enemy update functions)
  // ---------------------------------------------------------------------
  const worldApi: World = {
    player,
    time: 0,
    enemyCount: () => enemies.length,

    nearestEnemy(x, y, maxDist = Infinity, exclude) {
      let best: Enemy | null = null;
      let bestD = maxDist * maxDist;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (exclude && exclude.indexOf(e.id) !== -1) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    },

    forEachEnemyInRadius(x, y, r, cb) {
      const r2 = r * r;
      queryRadius(x, y, r, (e) => {
        const dx = e.x - x;
        const dy = e.y - y;
        if (dx * dx + dy * dy <= r2 + e.radius * e.radius) cb(e);
      });
    },

    densestPoint(x, y, range) {
      let best: Vec | null = null;
      let bestCount = 1;
      let sampled = 0;
      for (let i = 0; i < enemies.length && sampled < 28; i += Math.max(1, (enemies.length / 28) | 0)) {
        const e = enemies[i];
        const dx = e.x - x;
        const dy = e.y - y;
        if (dx * dx + dy * dy > range * range) continue;
        sampled++;
        let count = 0;
        queryRadius(e.x, e.y, 80, () => {
          count++;
        });
        if (count > bestCount) {
          bestCount = count;
          best = { x: e.x, y: e.y };
        }
      }
      return best;
    },

    damageEnemy(e, amount, opts) {
      applyEnemyDamage(e, amount, opts);
    },

    spawnProjectile(p) {
      spawnProjectile(p);
    },

    addParticle(p) {
      addParticle(p);
    },

    burst(x, y, count, color, speed, size = 2) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU;
        const sp = speed * (0.4 + Math.random() * 0.6);
        addParticle({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 0.3 + Math.random() * 0.3,
          maxLife: 0.6,
          size: size * (0.6 + Math.random() * 0.8),
          color,
          drag: 3,
          shape: 0,
        });
      }
    },

    addDamageNumber(x, y, amount, color, crit) {
      addDamageNumber(x, y, amount, color, crit);
    },

    addBeam(x1, y1, x2, y2, color, width = 2.5, life = 0.16) {
      if (beams.length >= CAPS.beams) return;
      const b = obtainBeam();
      b.x1 = x1;
      b.y1 = y1;
      b.x2 = x2;
      b.y2 = y2;
      b.color = color;
      b.width = width;
      b.life = life;
      b.maxLife = life;
      b.alive = true;
      beams.push(b);
    },

    shake(amount) {
      shakeMag = Math.min(28, shakeMag + amount);
    },

    rand: (min, max) => min + Math.random() * (max - min),

    audioTick(freq, dur = 0.05, vol = 0.18) {
      audio.tone(freq, dur, "square", vol);
    },
    audioNoise(dur = 0.2, vol = 0.3) {
      audio.noise(dur, vol);
    },
  };

  // start kit: one weapon (after worldApi exists so init() can use it)
  addWeapon("shard");

  // ---------------------------------------------------------------------
  // spawning helpers
  // ---------------------------------------------------------------------
  function spawnProjectile(opts: Partial<Projectile> & { x: number; y: number }) {
    if (projectiles.length >= CAPS.projectiles) return;
    const p = obtainProjectile();
    p.x = opts.x;
    p.y = opts.y;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.radius = opts.radius ?? 6;
    p.damage = opts.damage ?? 1;
    p.pierce = opts.pierce ?? 1;
    p.life = opts.life ?? 1.5;
    p.maxLife = p.life;
    p.color = opts.color ?? "#fff";
    p.kind = opts.kind ?? "shard";
    p.spin = opts.spin ?? 0;
    p.slotIndex = opts.slotIndex ?? 0;
    p.fromEnemy = opts.fromEnemy ?? false;
    p.area = opts.area ?? 0;
    p.slowOnHit = opts.slowOnHit ?? 0;
    p.slowTime = opts.slowTime ?? 0;
    p.knockback = opts.knockback ?? 0;
    p.crit = false;
    p.returning = false;
    p.originX = opts.originX ?? opts.x;
    p.originY = opts.originY ?? opts.y;
    p.alive = true;
    projectiles.push(p);
  }

  function addParticle(opts: Partial<Particle> & { x: number; y: number }) {
    if (particles.length >= CAPS.particles) {
      // recycle oldest
      const old = particles.shift();
      if (old) {
        old.alive = false;
        particlePool.push(old);
      }
    }
    const p = obtainParticle();
    p.x = opts.x;
    p.y = opts.y;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.life = opts.life ?? 0.5;
    p.maxLife = opts.maxLife ?? p.life;
    p.size = opts.size ?? 2;
    p.color = opts.color ?? "#fff";
    p.drag = opts.drag ?? 0;
    p.shape = opts.shape ?? 0;
    p.alive = true;
    particles.push(p);
  }

  function addDamageNumber(x: number, y: number, amount: number, color: string, crit?: boolean) {
    if (dmgNumbers.length >= CAPS.damageNumbers) return;
    const d = obtainDmg();
    d.x = x + (Math.random() - 0.5) * 8;
    d.y = y;
    d.vy = -38;
    d.life = crit ? 0.9 : 0.65;
    d.maxLife = d.life;
    d.text = String(Math.max(1, Math.round(amount)));
    d.color = color;
    d.size = crit ? 22 : 15;
    d.alive = true;
    dmgNumbers.push(d);
  }

  function addGem(x: number, y: number, value: number, kind = 0) {
    if (gems.length >= CAPS.gems) {
      const old = gems.shift();
      if (old) {
        old.alive = false;
        gemPool.push(old);
      }
    }
    const g = obtainGem();
    g.x = x;
    g.y = y;
    g.vx = (Math.random() - 0.5) * 60;
    g.vy = (Math.random() - 0.5) * 60;
    g.value = value;
    g.kind = kind;
    g.attracting = false;
    g.anim = Math.random() * TAU;
    g.life = 0;
    g.alive = true;
    gems.push(g);
  }

  function spawnEnemy(typeId: string, x: number, y: number, hpOverride?: number) {
    if (enemies.length >= CAPS.enemies) return null;
    const def = ENEMIES[typeId];
    if (!def) return null;
    const e = obtainEnemy();
    e.id = enemyIdSeq++;
    e.typeId = typeId;
    e.kind = def.kind;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    const hs = hpScale(time);
    e.maxHp = hpOverride ?? def.hp * hs;
    e.hp = e.maxHp;
    e.radius = def.radius;
    e.speed = def.speed * speedScale(time);
    e.damage = def.damage * dmgScale(time);
    e.xp = Math.max(1, Math.round(def.xp * xpScale(time)));
    e.flash = 0;
    e.contactCd = 0;
    e.slow = 0;
    e.slowFactor = 1;
    e.knockX = 0;
    e.knockY = 0;
    e.kbResist = def.kbResist;
    for (let i = 0; i < e.hitTimers.length; i++) e.hitTimers[i] = 0;
    e.anim = Math.random() * TAU;
    e.boss = !!def.boss;
    e.fireCd = worldApi.rand(1.5, 3.5);
    e.windup = 0;
    e.dashTime = 0;
    e.dashX = 0;
    e.dashY = 0;
    e.alive = true;
    enemies.push(e);
    return e;
  }

  function ringSpawnPos(): { x: number; y: number } {
    const W = ctx.width;
    const H = ctx.height;
    const halfDiag = Math.hypot(W, H) / 2;
    const a = Math.random() * TAU;
    const d = halfDiag + 40 + Math.random() * 140;
    return { x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d };
  }

  function directorUpdate(dt: number) {
    spawnT -= dt;
    if (spawnT <= 0 && enemies.length < CAPS.enemies) {
      spawnT = spawnInterval(time);
      const pool = spawnPool(time);
      const n = spawnBatch(time);
      for (let i = 0; i < n; i++) {
        const id = pool[(Math.random() * pool.length) | 0];
        const pos = ringSpawnPos();
        spawnEnemy(id, pos.x, pos.y);
      }
    }

    // swarm event: a ring of weak enemies
    if (time >= nextSwarm) {
      nextSwarm += DIRECTOR.swarmEvery;
      const W = ctx.width;
      const H = ctx.height;
      const halfDiag = Math.hypot(W, H) / 2 + 60;
      const count = 18 + Math.floor(time / 30);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        spawnEnemy(time > 120 ? "skitter" : "bat", player.x + Math.cos(a) * halfDiag, player.y + Math.sin(a) * halfDiag);
      }
      audio.sweep(200, 90, 0.4, "sawtooth", 0.25);
    }

    // boss
    if (time >= nextBoss) {
      nextBoss += DIRECTOR.bossEvery;
      bossIndex++;
      const pos = ringSpawnPos();
      const boss = spawnEnemy(bossId(), pos.x, pos.y, bossHp(time) * (1 + (bossIndex - 1) * 0.4));
      if (boss) {
        boss.radius = 46 + bossIndex * 4;
        boss.damage = (30 + bossIndex * 6) * dmgScale(time);
        boss.xp = 60 + bossIndex * 30;
        activeBoss = boss;
        shakeMag = Math.min(28, shakeMag + 14);
        audio.sweep(110, 60, 0.6, "sawtooth", 0.35);
      }
    }
  }

  // ---------------------------------------------------------------------
  // combat
  // ---------------------------------------------------------------------
  function applyEnemyDamage(e: Enemy, amount: number, opts?: DamageOpts) {
    if (!e.alive) return;
    e.hp -= amount;
    e.flash = 0.12;
    addDamageNumber(e.x, e.y - e.radius, amount, opts?.crit ? COLORS.crit : COLORS.dmg, opts?.crit);
    if (opts?.knockback && opts.knockback > 0) {
      const dx = opts.dirX ?? e.x - player.x;
      const dy = opts.dirY ?? e.y - player.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = opts.knockback * (1 - e.kbResist);
      e.knockX += (dx / d) * k;
      e.knockY += (dy / d) * k;
    }
    if (opts?.slow && opts.slow > 0) {
      e.slow = Math.max(e.slow, opts.slowTime ?? 1);
      e.slowFactor = Math.min(e.slowFactor, 1 - opts.slow);
    }
    if (e.hp <= 0) killEnemy(e, opts?.color ?? "#ff9a6a");
  }

  function killEnemy(e: Enemy, color: string) {
    if (!e.alive) return;
    e.alive = false;
    kills++;
    if (e.boss) {
      // boss death spectacle
      worldApi.burst(e.x, e.y, 40, COLORS.boss, 360, 4);
      worldApi.burst(e.x, e.y, 24, "#ffd24a", 220, 3);
      addParticle({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.6, maxLife: 0.6, size: 160, color: "rgba(255,77,109,0.5)", shape: 2 });
      shakeMag = Math.min(30, shakeMag + 18);
      audio.explosion();
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * TAU;
        const d = Math.random() * 60;
        addGem(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, Math.round(e.xp / 6), 0);
      }
      addGem(e.x, e.y, 1, 1); // heart
      if (activeBoss === e) activeBoss = null;
    } else {
      worldApi.burst(e.x, e.y, 6, color, 140, 2.4);
      addGem(e.x, e.y, e.xp, Math.random() < 0.012 ? 1 : Math.random() < 0.01 ? 2 : 0);
      if (e.radius > 20) shakeMag = Math.min(20, shakeMag + 3);
    }
  }

  function hurtPlayer(amount: number) {
    if (player.invuln > 0) return;
    const dmg = amount * player.stats.armorMult;
    player.hp -= dmg;
    player.invuln = PLAYER.hitInvuln;
    player.flash = 0.3;
    shakeMag = Math.min(24, shakeMag + 6);
    audio.tone(120, 0.12, "sawtooth", 0.3);
    worldApi.burst(player.x, player.y, 8, COLORS.hp, 160, 2.4);
    if (player.hp <= 0) onDeath();
  }

  function onDeath() {
    if (deadHandled) return;
    deadHandled = true;
    state = "dead";
    player.hp = 0;
    worldApi.burst(player.x, player.y, 40, COLORS.player, 320, 4);
    shakeMag = 24;
    audio.lose();
    window.setTimeout(() => ctx.gameOver(score), 1100);
  }

  // ---------------------------------------------------------------------
  // XP / leveling
  // ---------------------------------------------------------------------
  function gainXp(amount: number) {
    player.xp += amount * player.stats.xpMult;
    while (player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level++;
      player.xpToNext = xpToNext(player.level);
      pendingLevels++;
    }
  }

  function collectGem(g: Gem) {
    if (g.kind === 1) {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.25);
      worldApi.burst(player.x, player.y, 14, "#ff8aa0", 160, 3);
      audio.tone(660, 0.12, "triangle", 0.3);
    } else if (g.kind === 2) {
      for (const o of gems) if (o.kind === 0) o.attracting = true;
      audio.tone(880, 0.1, "triangle", 0.3);
    } else {
      gainXp(g.value);
      audio.tone(720 + Math.min(600, g.value * 8), 0.04, "square", 0.12);
      addParticle({ x: g.x, y: g.y, vx: 0, vy: -20, life: 0.3, maxLife: 0.3, size: 3, color: gemColor(g.value), shape: 0 });
    }
  }

  // ---------------------------------------------------------------------
  // level-up offers
  // ---------------------------------------------------------------------
  function ownedWeapon(id: string) {
    return weapons.find((w) => w.defId === id);
  }
  function ownedPassive(id: string) {
    return passives.find((p) => p.defId === id);
  }

  function buildOffers() {
    const pool: Offer[] = [];
    const priority: Offer[] = [];

    // evolutions
    for (const w of weapons) {
      const def = WEAPONS[w.defId];
      if (!def || !def.evolution) continue;
      if (w.level < def.maxLevel) continue;
      if (!ownedPassive(def.evolution.requires)) continue;
      const into = WEAPONS[def.evolution.into];
      if (!into) continue;
      priority.push({
        kind: "evolution",
        id: def.evolution.into,
        name: into.name,
        desc: into.short,
        tag: "EVOLUTION",
        color: COLORS.evolve,
        icon: into.icon,
        level: 0,
        maxLevel: into.maxLevel,
      });
    }

    // weapon level-ups
    for (const w of weapons) {
      const def = WEAPONS[w.defId];
      if (!def || w.level >= def.maxLevel) continue;
      pool.push({
        kind: "weapon-up",
        id: w.defId,
        name: def.name,
        desc: def.describe(w.level + 1),
        tag: `WEAPON  Lv ${w.level + 1}`,
        color: def.color,
        icon: def.icon,
        level: w.level,
        maxLevel: def.maxLevel,
      });
    }

    // passive level-ups
    for (const p of passives) {
      const def = PASSIVES[p.defId];
      if (!def || p.level >= def.maxLevel) continue;
      pool.push({
        kind: "passive-up",
        id: p.defId,
        name: def.name,
        desc: def.describe(p.level + 1),
        tag: `ITEM  Lv ${p.level + 1}`,
        color: def.color,
        icon: def.icon,
        level: p.level,
        maxLevel: def.maxLevel,
      });
    }

    // new weapons
    if (weapons.length < LIMITS.maxWeapons) {
      for (const id of NEW_WEAPON_IDS) {
        if (ownedWeapon(id)) continue;
        const def = WEAPONS[id];
        pool.push({
          kind: "weapon-new",
          id,
          name: def.name,
          desc: def.short,
          tag: "NEW WEAPON",
          color: def.color,
          icon: def.icon,
          level: 0,
          maxLevel: def.maxLevel,
        });
      }
    }

    // new passives
    if (passives.length < LIMITS.maxPassives) {
      for (const id of PASSIVE_IDS) {
        if (ownedPassive(id)) continue;
        const def = PASSIVES[id];
        pool.push({
          kind: "passive-new",
          id,
          name: def.name,
          desc: def.short,
          tag: "NEW ITEM",
          color: def.color,
          icon: def.icon,
          level: 0,
          maxLevel: def.maxLevel,
        });
      }
    }

    // shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }

    const want = ctx.width < 560 ? 3 : 4;
    const result: Offer[] = [];
    for (const o of priority) {
      if (result.length < want) result.push(o);
    }
    for (const o of pool) {
      if (result.length >= want) break;
      result.push(o);
    }
    // fallbacks
    while (result.length < want) {
      if (result.length % 2 === 0) {
        result.push({
          kind: "heal",
          id: "heal",
          name: "Recover",
          desc: "Heal 30% of max HP.",
          tag: "RECOVERY",
          color: COLORS.hp,
          icon: (c, x, y, s, color) => {
            c.fillStyle = color;
            c.fillRect(x - s * 0.1, y - s * 0.35, s * 0.2, s * 0.7);
            c.fillRect(x - s * 0.35, y - s * 0.1, s * 0.7, s * 0.2);
          },
          level: 0,
          maxLevel: 0,
        });
      } else {
        result.push({
          kind: "maxhp",
          id: "maxhp",
          name: "Lifeblood",
          desc: "+20 max HP and full heal.",
          tag: "VITALITY",
          color: COLORS.hp,
          icon: (c, x, y, s, color) => {
            c.fillStyle = color;
            c.beginPath();
            c.moveTo(x, y + s * 0.32);
            c.bezierCurveTo(x - s * 0.5, y - s * 0.05, x - s * 0.18, y - s * 0.36, x, y - s * 0.1);
            c.bezierCurveTo(x + s * 0.18, y - s * 0.36, x + s * 0.5, y - s * 0.05, x, y + s * 0.32);
            c.fill();
          },
          level: 0,
          maxLevel: 0,
        });
      }
    }
    offers = result;
  }

  function chooseOffer(o: Offer) {
    switch (o.kind) {
      case "weapon-new":
        addWeapon(o.id);
        break;
      case "weapon-up": {
        const w = ownedWeapon(o.id);
        if (w) w.level++;
        break;
      }
      case "passive-new":
        passives.push({ defId: o.id, level: 1 });
        recomputeStats();
        break;
      case "passive-up": {
        const p = ownedPassive(o.id);
        if (p) p.level++;
        recomputeStats();
        break;
      }
      case "evolution": {
        // find a base weapon whose evolution.into === o.id
        const base = weapons.find((w) => WEAPONS[w.defId]?.evolution?.into === o.id);
        if (base) {
          base.defId = o.id;
          base.level = 1;
          base.timer = 0;
          base.angle = 0;
          base.data = { slot: base.data.slot ?? 0 };
          WEAPONS[o.id]?.init?.(worldApi, base);
        }
        worldApi.burst(player.x, player.y, 30, COLORS.evolve, 260, 3);
        shakeMag = Math.min(20, shakeMag + 8);
        break;
      }
      case "heal":
        player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.3);
        break;
      case "maxhp":
        bonusMaxHp += 20;
        recomputeStats();
        player.hp = player.maxHp;
        break;
    }
    audio.tone(880, 0.08, "triangle", 0.3);
    setTimeout(() => audio.tone(1320, 0.1, "triangle", 0.3), 70);

    pendingLevels--;
    if (pendingLevels > 0) {
      buildOffers();
    } else {
      state = "playing";
    }
  }

  // ---------------------------------------------------------------------
  // input → movement vector
  // ---------------------------------------------------------------------
  function moveVector(): { x: number; y: number } {
    let mx = 0;
    let my = 0;
    if (input.isDown("a", "ArrowLeft")) mx -= 1;
    if (input.isDown("d", "ArrowRight")) mx += 1;
    if (input.isDown("w", "ArrowUp")) my -= 1;
    if (input.isDown("s", "ArrowDown")) my += 1;
    if (mx !== 0 || my !== 0) {
      const d = Math.hypot(mx, my);
      return { x: mx / d, y: my / d };
    }
    if (joy.active) {
      const dx = joy.x - joy.ox;
      const dy = joy.y - joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > 8) {
        const mag = Math.min(1, d / JOY_MAX);
        return { x: (dx / d) * mag, y: (dy / d) * mag };
      }
    }
    return { x: 0, y: 0 };
  }

  // ---------------------------------------------------------------------
  // pause button rect (screen space)
  // ---------------------------------------------------------------------
  function pauseRect() {
    const W = ctx.width;
    const ui = Math.min(W, ctx.height);
    const s = clamp(ui * 0.07, 30, 52);
    return { x: W - s - 12, y: 12, w: s, h: s };
  }

  function inRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // card layout for level-up (screen space)
  function cardRects(): { x: number; y: number; w: number; h: number }[] {
    const W = ctx.width;
    const H = ctx.height;
    const n = offers.length;
    const portrait = H > W;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    if (portrait) {
      const cw = Math.min(W * 0.86, 460);
      const gap = H * 0.018;
      const ch = Math.min((H * 0.62) / n - gap, 130);
      const totalH = n * ch + (n - 1) * gap;
      const x = (W - cw) / 2;
      let y = H * 0.5 - totalH / 2 + H * 0.04;
      for (let i = 0; i < n; i++) {
        rects.push({ x, y, w: cw, h: ch });
        y += ch + gap;
      }
    } else {
      const gap = W * 0.02;
      const cw = Math.min((W * 0.9) / n - gap, 240);
      const ch = Math.min(H * 0.5, 300);
      const totalW = n * cw + (n - 1) * gap;
      let x = (W - totalW) / 2;
      const y = H * 0.5 - ch / 2 + H * 0.03;
      for (let i = 0; i < n; i++) {
        rects.push({ x, y, w: cw, h: ch });
        x += cw + gap;
      }
    }
    return rects;
  }

  // ---------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------
  function update(dt: number) {
    dt = Math.min(dt, 1 / 30);

    // global UI inputs
    const togglePause = input.pressed("p", "Escape");

    if (state === "levelup") {
      handleLevelupInput();
      return;
    }
    if (state === "paused") {
      if (togglePause) state = "playing";
      if (input.pointer.justDown) {
        // resume on tapping pause button or anywhere
        state = "playing";
      }
      return;
    }
    if (state === "dead") {
      // keep particles/shake alive for the death effect
      stepEffects(dt);
      return;
    }

    // playing
    if (togglePause) {
      state = "paused";
      return;
    }

    // pause button tap
    if (input.pointer.justDown && inRect(input.pointer.x, input.pointer.y, pauseRect())) {
      state = "paused";
      return;
    }

    // joystick handling (touch / mouse drag)
    if (input.pointer.justDown && !inRect(input.pointer.x, input.pointer.y, pauseRect())) {
      joy.active = true;
      joy.ox = input.pointer.x;
      joy.oy = input.pointer.y;
      joy.x = input.pointer.x;
      joy.y = input.pointer.y;
    }
    if (joy.active) {
      joy.x = input.pointer.x;
      joy.y = input.pointer.y;
      if (!input.pointer.down) joy.active = false;
    }

    time += dt;
    worldApi.time = time;
    player.anim += dt;
    hintTimer -= dt;

    // pending level-ups freeze the game with the upgrade screen
    if (pendingLevels > 0) {
      buildOffers();
      state = "levelup";
      audio.tone(523, 0.1, "triangle", 0.3);
      setTimeout(() => audio.tone(784, 0.12, "triangle", 0.3), 90);
      return;
    }

    // ----- player movement -----
    const mv = moveVector();
    const spd = PLAYER.baseMove * player.stats.moveMult;
    player.x += mv.x * spd * dt;
    player.y += mv.y * spd * dt;
    if (mv.x !== 0 || mv.y !== 0) {
      const d = Math.hypot(mv.x, mv.y) || 1;
      player.facingX = mv.x / d;
      player.facingY = mv.y / d;
    }
    if (player.invuln > 0) player.invuln -= dt;
    if (player.flash > 0) player.flash -= dt;
    if (player.stats.regen > 0 && player.hp < player.maxHp) {
      player.regenAcc += player.stats.regen * dt;
      if (player.regenAcc >= 1) {
        const heal = Math.floor(player.regenAcc);
        player.hp = Math.min(player.maxHp, player.hp + heal);
        player.regenAcc -= heal;
      }
    }

    // camera follow
    const camLerp = Math.min(1, dt * 8);
    camX += (player.x - camX) * camLerp;
    camY += (player.y - camY) * camLerp;

    // ----- director -----
    directorUpdate(dt);

    // ----- spatial grid -----
    rebuildGrid();

    // ----- weapons -----
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const def = WEAPONS[w.defId];
      if (def) def.update(worldApi, w, dt);
    }

    // ----- enemies -----
    updateEnemies(dt);

    // ----- projectiles -----
    updateProjectiles(dt);

    // ----- gems -----
    updateGems(dt);

    // ----- effects -----
    stepEffects(dt);

    // ----- score -----
    score = Math.floor(time) + kills;
    if (score !== lastReported) {
      lastReported = score;
      ctx.reportScore(score);
    }
  }

  function handleLevelupInput() {
    const rects = cardRects();
    // keyboard 1..n
    for (let i = 0; i < offers.length; i++) {
      if (input.pressed(String(i + 1))) {
        chooseOffer(offers[i]);
        return;
      }
    }
    if (input.pointer.justDown) {
      for (let i = 0; i < offers.length; i++) {
        if (inRect(input.pointer.x, input.pointer.y, rects[i])) {
          chooseOffer(offers[i]);
          return;
        }
      }
    }
  }

  function updateEnemies(dt: number) {
    const halfDiag = Math.hypot(ctx.width, ctx.height) / 2;
    const recycleDist = (halfDiag * 2.4) ** 2;
    const pr = PLAYER.radius;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      e.anim += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.slow > 0) {
        e.slow -= dt;
        if (e.slow <= 0) e.slowFactor = 1;
      }
      if (e.contactCd > 0) e.contactCd -= dt;
      for (let h = 0; h < e.hitTimers.length; h++) if (e.hitTimers[h] > 0) e.hitTimers[h] -= dt;

      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const distToPlayer = Math.hypot(dx, dy) || 1;
      const moveSpeed = e.speed * (e.slow > 0 ? e.slowFactor : 1);

      if (e.kind === "charger") {
        if (e.dashTime > 0) {
          e.dashTime -= dt;
          e.x += e.dashX * dt;
          e.y += e.dashY * dt;
        } else if (e.windup > 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            e.dashX = (dx / distToPlayer) * 360;
            e.dashY = (dy / distToPlayer) * 360;
            e.dashTime = 0.42;
          }
        } else {
          e.x += (dx / distToPlayer) * moveSpeed * dt;
          e.y += (dy / distToPlayer) * moveSpeed * dt;
          e.fireCd -= dt;
          if (e.fireCd <= 0 && distToPlayer < 340) {
            e.windup = 0.55;
            e.fireCd = worldApi.rand(2.6, 4.2);
          }
        }
      } else if (e.kind === "shooter") {
        const pref = 230;
        if (distToPlayer < pref - 40) {
          e.x -= (dx / distToPlayer) * moveSpeed * dt;
          e.y -= (dy / distToPlayer) * moveSpeed * dt;
        } else if (distToPlayer > pref + 40) {
          e.x += (dx / distToPlayer) * moveSpeed * dt;
          e.y += (dy / distToPlayer) * moveSpeed * dt;
        }
        if (e.windup > 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            const sp = 150;
            spawnProjectile({
              x: e.x,
              y: e.y,
              vx: (dx / distToPlayer) * sp,
              vy: (dy / distToPlayer) * sp,
              radius: 8,
              damage: e.damage,
              pierce: 1,
              life: 4,
              color: "#ff7ab0",
              kind: "enemy",
              fromEnemy: true,
            });
            e.fireCd = worldApi.rand(2.2, 3.4);
          }
        } else {
          e.fireCd -= dt;
          if (e.fireCd <= 0 && distToPlayer < 460) e.windup = 0.5;
        }
      } else {
        // chase / boss
        e.x += (dx / distToPlayer) * moveSpeed * dt;
        e.y += (dy / distToPlayer) * moveSpeed * dt;
      }

      // knockback
      if (e.knockX !== 0 || e.knockY !== 0) {
        e.x += e.knockX * dt;
        e.y += e.knockY * dt;
        const decay = Math.exp(-9 * dt);
        e.knockX *= decay;
        e.knockY *= decay;
        if (Math.abs(e.knockX) < 1) e.knockX = 0;
        if (Math.abs(e.knockY) < 1) e.knockY = 0;
      }

      // separation (boids-style push)
      if (!e.boss) {
        let sx = 0;
        let sy = 0;
        queryRadius(e.x, e.y, e.radius * 2.2, (o) => {
          if (o === e) return;
          const ox = e.x - o.x;
          const oy = e.y - o.y;
          const od = ox * ox + oy * oy;
          const minD = (e.radius + o.radius) * 0.9;
          if (od > 0 && od < minD * minD) {
            const d = Math.sqrt(od);
            sx += (ox / d) * (minD - d);
            sy += (oy / d) * (minD - d);
          }
        });
        e.x += sx * 6 * dt;
        e.y += sy * 6 * dt;
      }

      // contact damage
      const cd = e.radius + pr;
      if (distToPlayer < cd && e.contactCd <= 0) {
        e.contactCd = PLAYER.contactWindow;
        hurtPlayer(e.damage);
        // small knockback to the enemy on contact
        e.knockX += (e.x - player.x) / distToPlayer * 90 * (1 - e.kbResist);
        e.knockY += (e.y - player.y) / distToPlayer * 90 * (1 - e.kbResist);
      }

      // cull / recycle far enemies
      const ddx = e.x - player.x;
      const ddy = e.y - player.y;
      if (!e.boss && ddx * ddx + ddy * ddy > recycleDist) e.alive = false;

      if (!e.alive) {
        enemyPool.push(e);
        enemies[i] = enemies[enemies.length - 1];
        enemies.pop();
        i--;
      }
    }
  }

  function explode(x: number, y: number, radius: number, damage: number, color: string) {
    worldApi.forEachEnemyInRadius(x, y, radius, (e) => {
      applyEnemyDamage(e, damage, { knockback: 100, dirX: e.x - x, dirY: e.y - y, color });
    });
    addParticle({ x, y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, size: radius, color: "rgba(180,230,255,0.5)", shape: 2 });
    worldApi.burst(x, y, 10, color, 160, 2.4);
  }

  function updateProjectiles(dt: number) {
    const pr = PLAYER.radius;
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];

      // trail sampling for player shots
      if (!p.fromEnemy && (p.kind === "shard" || p.kind === "star" || p.kind === "frost")) {
        p.trail.push(p.x, p.y);
        if (p.trail.length > 8) p.trail.splice(0, p.trail.length - 8);
      }

      if (p.kind === "boomerang") {
        if (!p.returning) {
          const decay = Math.exp(-2.3 * dt);
          p.vx *= decay;
          p.vy *= decay;
          if (Math.hypot(p.vx, p.vy) < 90) {
            p.returning = true;
            p.hits.length = 0;
          }
        } else {
          const dx = player.x - p.x;
          const dy = player.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          p.vx += (dx / d) * 1600 * dt;
          p.vy += (dy / d) * 1600 * dt;
          const sp = Math.hypot(p.vx, p.vy);
          const max = 620;
          if (sp > max) {
            p.vx = (p.vx / sp) * max;
            p.vy = (p.vy / sp) * max;
          }
          if (d < 24) p.alive = false;
        }
        p.spin += dt * 18;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) p.alive = false;

      if (p.fromEnemy) {
        const dx = p.x - player.x;
        const dy = p.y - player.y;
        if (dx * dx + dy * dy < (pr + p.radius) * (pr + p.radius)) {
          hurtPlayer(p.damage);
          p.alive = false;
        }
      } else if (p.alive) {
        // hit enemies
        worldApi.forEachEnemyInRadius(p.x, p.y, p.radius, (e) => {
          if (!p.alive) return;
          if (p.hits.indexOf(e.id) !== -1) return;
          p.hits.push(e.id);
          const s = player.stats;
          let dmg = p.damage * s.damageMult;
          const crit = Math.random() < s.critChance;
          if (crit) dmg *= s.critMult;
          applyEnemyDamage(e, dmg, {
            crit,
            knockback: p.knockback,
            dirX: p.vx,
            dirY: p.vy,
            slow: p.slowOnHit,
            slowTime: p.slowTime,
            color: p.color,
          });
          worldApi.burst(p.x, p.y, 3, p.color, 90, 1.8);
          if (p.kind === "frost" && p.area > 0) {
            // shatter: slow nearby
            worldApi.forEachEnemyInRadius(e.x, e.y, p.area, (o) => {
              if (o.slow < p.slowTime) {
                o.slow = p.slowTime;
                o.slowFactor = Math.min(o.slowFactor, 1 - p.slowOnHit);
              }
            });
            worldApi.burst(e.x, e.y, 5, "#cdf3ff", 100, 2);
          }
          if (p.kind !== "boomerang") {
            p.pierce--;
            if (p.pierce < 0) p.alive = false;
          }
        });
      }

      if (!p.alive) {
        projPool.push(p);
        projectiles[i] = projectiles[projectiles.length - 1];
        projectiles.pop();
        i--;
      }
    }
  }

  function updateGems(dt: number) {
    const mag = player.stats.magnet;
    const mag2 = mag * mag;
    const pr = PLAYER.radius + 8;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      g.anim += dt;
      g.life += dt;
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (g.attracting || d2 < mag2) {
        g.attracting = true;
        const d = Math.sqrt(d2) || 1;
        const pull = 260 + 600 * (1 - Math.min(1, d / mag));
        g.vx += (dx / d) * pull * dt;
        g.vy += (dy / d) * pull * dt;
      } else {
        const fr = Math.exp(-4 * dt);
        g.vx *= fr;
        g.vy *= fr;
      }
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (d2 < pr * pr) {
        collectGem(g);
        g.alive = false;
      }
      if (!g.alive) {
        gemPool.push(g);
        gems[i] = gems[gems.length - 1];
        gems.pop();
        i--;
      }
    }
  }

  function stepEffects(dt: number) {
    // particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life -= dt;
      if (p.drag > 0) {
        const fr = Math.exp(-p.drag * dt);
        p.vx *= fr;
        p.vy *= fr;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) {
        p.alive = false;
        particlePool.push(p);
        particles[i] = particles[particles.length - 1];
        particles.pop();
        i--;
      }
    }
    // damage numbers
    for (let i = 0; i < dmgNumbers.length; i++) {
      const d = dmgNumbers[i];
      d.life -= dt;
      d.y += d.vy * dt;
      d.vy *= Math.exp(-3 * dt);
      if (d.life <= 0) {
        dmgPool.push(d);
        dmgNumbers[i] = dmgNumbers[dmgNumbers.length - 1];
        dmgNumbers.pop();
        i--;
      }
    }
    // beams
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        beamPool.push(b);
        beams[i] = beams[beams.length - 1];
        beams.pop();
        i--;
      }
    }
    // shake decay
    shakeMag *= Math.exp(-6 * dt);
    if (shakeMag < 0.2) shakeMag = 0;
  }

  // ---------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------
  const c = ctx.ctx;

  function render() {
    const W = ctx.width;
    const H = ctx.height;

    // background
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COLORS.bgTop);
    bg.addColorStop(1, COLORS.bgBottom);
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    const sx = shakeMag > 0 ? (Math.random() - 0.5) * shakeMag : 0;
    const sy = shakeMag > 0 ? (Math.random() - 0.5) * shakeMag : 0;
    const offX = W / 2 - camX + sx;
    const offY = H / 2 - camY + sy;

    c.save();
    c.translate(offX, offY);

    drawGround(W, H);
    drawWorld(W, H);

    c.restore();

    // HUD + overlays (screen space)
    drawHud(W, H);
    if (state === "levelup") drawLevelup(W, H);
    if (state === "paused") drawPaused(W, H);
    if (state === "dead") drawDead(W, H);
    if (joy.active && state === "playing") drawJoystick();
  }

  function drawGround(W: number, H: number) {
    const left = camX - W / 2 - 40;
    const top = camY - H / 2 - 40;
    const right = camX + W / 2 + 40;
    const bottom = camY + H / 2 + 40;
    const grid = 80;
    c.strokeStyle = COLORS.grid;
    c.lineWidth = 1;
    c.beginPath();
    const startX = Math.floor(left / grid) * grid;
    for (let x = startX; x < right; x += grid) {
      c.moveTo(x, top);
      c.lineTo(x, bottom);
    }
    const startY = Math.floor(top / grid) * grid;
    for (let y = startY; y < bottom; y += grid) {
      c.moveTo(left, y);
      c.lineTo(right, y);
    }
    c.stroke();

    // stable scattered decals (hashed by cell)
    c.fillStyle = "rgba(150,120,220,0.05)";
    const dgrid = 160;
    const dsx = Math.floor(left / dgrid) * dgrid;
    const dsy = Math.floor(top / dgrid) * dgrid;
    for (let gx = dsx; gx < right; gx += dgrid) {
      for (let gy = dsy; gy < bottom; gy += dgrid) {
        const h = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
        if (h % 3 === 0) {
          const ox = (h % 97) - 48;
          const oy = ((h >> 7) % 97) - 48;
          const r = 6 + (h % 14);
          c.beginPath();
          c.arc(gx + ox, gy + oy, r, 0, TAU);
          c.fill();
        }
      }
    }
  }

  function drawWorld(W: number, H: number) {
    const left = camX - W / 2 - 60;
    const top = camY - H / 2 - 60;
    const right = camX + W / 2 + 60;
    const bottom = camY + H / 2 + 60;
    const vis = (x: number, y: number, m: number) =>
      x + m > left && x - m < right && y + m > top && y - m < bottom;

    // ground weapon auras (under enemies): aura / supernova / cyclone
    for (const w of weapons) {
      const def = WEAPONS[w.defId];
      if (!def?.render) continue;
      if (w.defId === "aura" || w.defId === "supernova" || w.defId === "cyclone") def.render(worldApi, w, c);
    }

    // gems
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (!vis(g.x, g.y, 16)) continue;
      drawGem(g);
    }

    // enemy shadows
    c.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!vis(e.x, e.y, e.radius + 10)) continue;
      c.beginPath();
      c.ellipse(e.x, e.y + e.radius * 0.7, e.radius * 0.8, e.radius * 0.35, 0, 0, TAU);
      c.fill();
    }

    // enemies
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!vis(e.x, e.y, e.radius + 20)) continue;
      const def = ENEMIES[e.typeId];
      if (def) def.draw(c, e, time);
      if (e.flash > 0) {
        c.globalAlpha = Math.min(1, e.flash / 0.12) * 0.8;
        c.fillStyle = "#ffffff";
        c.beginPath();
        c.arc(e.x, e.y, e.radius, 0, TAU);
        c.fill();
        c.globalAlpha = 1;
      }
      // small enemy hp bar for tough/boss enemies
      if (!e.boss && e.maxHp > 60 && e.hp < e.maxHp) {
        const bw = e.radius * 1.8;
        c.fillStyle = "rgba(0,0,0,0.5)";
        c.fillRect(e.x - bw / 2, e.y - e.radius - 8, bw, 3);
        c.fillStyle = COLORS.hp;
        c.fillRect(e.x - bw / 2, e.y - e.radius - 8, bw * (e.hp / e.maxHp), 3);
      }
    }

    // projectiles
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!vis(p.x, p.y, p.radius + 20)) continue;
      drawProjectile(p);
    }

    // player
    drawPlayer();

    // foreground weapon visuals: blades render over the player.
    // (aura/supernova/cyclone were already drawn in the ground pass.)
    for (const w of weapons) {
      if (w.defId === "blades") WEAPONS[w.defId]?.render?.(worldApi, w, c);
    }

    // beams (lightning)
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const a = b.life / b.maxLife;
      c.globalAlpha = a;
      c.strokeStyle = b.color;
      c.lineWidth = b.width;
      c.beginPath();
      // jagged line
      const segs = 4;
      c.moveTo(b.x1, b.y1);
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        const jx = b.x1 + (b.x2 - b.x1) * t + (Math.random() - 0.5) * 12;
        const jy = b.y1 + (b.y2 - b.y1) * t + (Math.random() - 0.5) * 12;
        c.lineTo(jx, jy);
      }
      c.lineTo(b.x2, b.y2);
      c.stroke();
      c.globalAlpha = 1;
    }

    // particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!vis(p.x, p.y, p.size + 10)) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      c.globalAlpha = a;
      if (p.shape === 2) {
        // ring
        c.strokeStyle = p.color;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1 - a * 0.4), 0, TAU);
        c.stroke();
      } else {
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
    }

    // damage numbers
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let i = 0; i < dmgNumbers.length; i++) {
      const d = dmgNumbers[i];
      if (!vis(d.x, d.y, 30)) continue;
      const a = clamp(d.life / d.maxLife, 0, 1);
      c.globalAlpha = a;
      c.font = `800 ${d.size}px "Baloo 2", system-ui, sans-serif`;
      c.fillStyle = "rgba(0,0,0,0.6)";
      c.fillText(d.text, d.x + 1, d.y + 1);
      c.fillStyle = d.color;
      c.fillText(d.text, d.x, d.y);
      c.globalAlpha = 1;
    }
  }

  function drawGem(g: Gem) {
    const pulse = 1 + Math.sin(g.anim * 6) * 0.12;
    if (g.kind === 1) {
      c.fillStyle = "#ff5d6c";
      c.beginPath();
      const s = 7 * pulse;
      c.moveTo(g.x, g.y + s * 0.9);
      c.bezierCurveTo(g.x - s * 1.5, g.y - s * 0.2, g.x - s * 0.5, g.y - s * 1.1, g.x, g.y - s * 0.3);
      c.bezierCurveTo(g.x + s * 0.5, g.y - s * 1.1, g.x + s * 1.5, g.y - s * 0.2, g.x, g.y + s * 0.9);
      c.fill();
      return;
    }
    if (g.kind === 2) {
      c.strokeStyle = "#ff5d6c";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(g.x, g.y, 6 * pulse, Math.PI, TAU);
      c.stroke();
      return;
    }
    const col = gemColor(g.value);
    const s = (3.5 + Math.min(5, g.value * 0.25)) * pulse;
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(g.x, g.y - s);
    c.lineTo(g.x + s * 0.8, g.y);
    c.lineTo(g.x, g.y + s);
    c.lineTo(g.x - s * 0.8, g.y);
    c.closePath();
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.6)";
    c.beginPath();
    c.arc(g.x - s * 0.2, g.y - s * 0.3, s * 0.22, 0, TAU);
    c.fill();
  }

  function drawProjectile(p: Projectile) {
    if (p.trail.length >= 4) {
      c.strokeStyle = p.color;
      c.globalAlpha = 0.35;
      c.lineWidth = p.radius * 0.9;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(p.trail[0], p.trail[1]);
      for (let t = 2; t < p.trail.length; t += 2) c.lineTo(p.trail[t], p.trail[t + 1]);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.save();
    c.translate(p.x, p.y);
    if (p.kind === "boomerang") {
      c.rotate(p.spin);
      c.strokeStyle = p.color;
      c.lineWidth = 4;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(-p.radius, p.radius * 0.5);
      c.quadraticCurveTo(0, -p.radius, p.radius, p.radius * 0.5);
      c.stroke();
    } else if (p.kind === "star") {
      c.rotate(p.spin + time * 12);
      c.fillStyle = p.color;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const r = i % 2 === 0 ? p.radius : p.radius * 0.45;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
    } else if (p.kind === "enemy") {
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(0, 0, p.radius, 0, TAU);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.beginPath();
      c.arc(0, 0, p.radius * 0.5, 0, TAU);
      c.fill();
    } else {
      // shard / frost
      c.rotate(p.spin);
      c.fillStyle = p.color;
      c.beginPath();
      c.moveTo(p.radius * 1.3, 0);
      c.lineTo(0, p.radius * 0.7);
      c.lineTo(-p.radius * 0.6, 0);
      c.lineTo(0, -p.radius * 0.7);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  function drawPlayer() {
    const p = player;
    // shadow
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.beginPath();
    c.ellipse(p.x, p.y + PLAYER.radius * 0.8, PLAYER.radius * 0.85, PLAYER.radius * 0.4, 0, 0, TAU);
    c.fill();

    const blink = p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0;
    c.save();
    c.translate(p.x, p.y);
    // body cloak
    c.fillStyle = blink ? "#ffffff" : COLORS.playerDark;
    c.beginPath();
    c.moveTo(0, -PLAYER.radius);
    c.quadraticCurveTo(PLAYER.radius, -PLAYER.radius * 0.2, PLAYER.radius * 0.7, PLAYER.radius);
    c.lineTo(-PLAYER.radius * 0.7, PLAYER.radius);
    c.quadraticCurveTo(-PLAYER.radius, -PLAYER.radius * 0.2, 0, -PLAYER.radius);
    c.fill();
    // head
    c.fillStyle = blink ? "#ffffff" : COLORS.player;
    c.beginPath();
    c.arc(0, -PLAYER.radius * 0.3, PLAYER.radius * 0.62, 0, TAU);
    c.fill();
    // visor gleam toward facing
    c.fillStyle = "#0a2a2e";
    c.beginPath();
    c.ellipse(p.facingX * 3, -PLAYER.radius * 0.3 + p.facingY * 3, PLAYER.radius * 0.4, PLAYER.radius * 0.22, Math.atan2(p.facingY, p.facingX), 0, TAU);
    c.fill();
    // lantern orb
    const lp = 1 + Math.sin(p.anim * 5) * 0.15;
    const lx = p.facingX * PLAYER.radius * 1.1;
    const ly = p.facingY * PLAYER.radius * 1.1 + PLAYER.radius * 0.1;
    const g = c.createRadialGradient(lx, ly, 1, lx, ly, PLAYER.radius * 0.9 * lp);
    g.addColorStop(0, "rgba(255,226,122,0.9)");
    g.addColorStop(1, "rgba(255,226,122,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(lx, ly, PLAYER.radius * 0.9 * lp, 0, TAU);
    c.fill();
    c.fillStyle = COLORS.lantern;
    c.beginPath();
    c.arc(lx, ly, PLAYER.radius * 0.22, 0, TAU);
    c.fill();
    c.restore();

    if (p.flash > 0) {
      c.globalAlpha = p.flash;
      c.fillStyle = COLORS.hp;
      c.beginPath();
      c.arc(p.x, p.y, PLAYER.radius * 1.3, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  // ----- HUD -----
  function drawHud(W: number, H: number) {
    const ui = Math.min(W, H);

    // timer (top center)
    const tt = Math.floor(time);
    const mm = Math.floor(tt / 60);
    const ss = tt % 60;
    const timeStr = `${mm}:${ss.toString().padStart(2, "0")}`;
    drawText(c, timeStr, W / 2, clamp(ui * 0.06, 22, 46), clamp(ui * 0.07, 24, 46), COLORS.text, "center", "800");

    // XP bar (top, full width thin)
    const xpH = clamp(ui * 0.012, 5, 10);
    const xpFrac = clamp(player.xp / player.xpToNext, 0, 1);
    c.fillStyle = "rgba(255,255,255,0.1)";
    c.fillRect(0, 0, W, xpH);
    c.fillStyle = COLORS.xp;
    c.fillRect(0, 0, W * xpFrac, xpH);

    // level chip (top left)
    const chip = clamp(ui * 0.05, 22, 40);
    c.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(c, 10, xpH + 8, chip * 2.6, chip, 8);
    c.fill();
    drawText(c, `LV ${player.level}`, 10 + chip * 0.5, xpH + 8 + chip / 2, chip * 0.42, COLORS.xpHi, "left", "800");
    drawText(c, `${kills} kills`, 10 + chip * 1.35, xpH + 8 + chip / 2, chip * 0.32, COLORS.textDim, "left", "700");

    // HP bar (under timer center)
    const hpW = clamp(W * 0.34, 160, 360);
    const hpH = clamp(ui * 0.022, 10, 18);
    const hpx = W / 2 - hpW / 2;
    const hpy = clamp(ui * 0.06, 22, 46) + clamp(ui * 0.05, 18, 34);
    c.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(c, hpx - 2, hpy - 2, hpW + 4, hpH + 4, hpH / 2 + 2);
    c.fill();
    const hpFrac = clamp(player.hp / player.maxHp, 0, 1);
    c.fillStyle = COLORS.hp;
    roundRect(c, hpx, hpy, hpW * hpFrac, hpH, hpH / 2);
    c.fill();
    drawText(c, `${Math.ceil(player.hp)} / ${Math.round(player.maxHp)}`, W / 2, hpy + hpH / 2, hpH * 0.8, "#fff", "center", "800");

    // pause button (top right)
    const pb = pauseRect();
    c.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(c, pb.x, pb.y, pb.w, pb.h, 8);
    c.fill();
    c.fillStyle = COLORS.text;
    const bw = pb.w * 0.16;
    c.fillRect(pb.x + pb.w * 0.32, pb.y + pb.h * 0.28, bw, pb.h * 0.44);
    c.fillRect(pb.x + pb.w * 0.52, pb.y + pb.h * 0.28, bw, pb.h * 0.44);

    // boss bar
    if (activeBoss && activeBoss.alive) {
      const bbw = clamp(W * 0.6, 220, 600);
      const bbh = clamp(ui * 0.02, 9, 16);
      const bbx = W / 2 - bbw / 2;
      const bby = hpy + hpH + 10;
      c.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(c, bbx - 2, bby - 2, bbw + 4, bbh + 4, 4);
      c.fill();
      c.fillStyle = COLORS.boss;
      roundRect(c, bbx, bby, bbw * clamp(activeBoss.hp / activeBoss.maxHp, 0, 1), bbh, 3);
      c.fill();
      drawText(c, "THE REAPER", W / 2, bby + bbh / 2, bbh * 0.85, "#fff", "center", "800");
    }

    // weapon / item tray (bottom-left)
    drawTray(W, H, ui);

    // low HP vignette
    if (hpFrac < 0.3) {
      const pulse = 0.3 + Math.sin(time * 8) * 0.2;
      c.globalAlpha = (0.3 - hpFrac) / 0.3 * pulse;
      const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, "rgba(255,0,40,0)");
      vg.addColorStop(1, "rgba(255,0,40,0.8)");
      c.fillStyle = vg;
      c.fillRect(0, 0, W, H);
      c.globalAlpha = 1;
    }

    // early hint
    if (hintTimer > 0 && state === "playing") {
      c.globalAlpha = clamp(hintTimer, 0, 1);
      drawText(c, ctx.isTouch ? "Drag to move — weapons fire automatically" : "WASD / Arrows to move — weapons fire automatically", W / 2, H * 0.8, clamp(ui * 0.035, 14, 22), COLORS.text);
      c.globalAlpha = 1;
    }
  }

  function drawTray(W: number, H: number, ui: number) {
    const slot = clamp(ui * 0.05, 22, 40);
    const gap = slot * 0.18;
    let x = 10;
    const y = H - slot - 10;
    for (const w of weapons) {
      const def = WEAPONS[w.defId];
      if (!def) continue;
      c.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(c, x, y, slot, slot, 7);
      c.fill();
      def.icon(c, x + slot / 2, y + slot / 2, slot * 0.62, def.color);
      drawPips(x, y, slot, w.level, def.maxLevel, def.color);
      x += slot + gap;
    }
    // passives row above
    let px = 10;
    const py = y - slot - gap;
    for (const op of passives) {
      const def = PASSIVES[op.defId];
      if (!def) continue;
      c.fillStyle = "rgba(0,0,0,0.32)";
      roundRect(c, px, py, slot * 0.8, slot * 0.8, 6);
      c.fill();
      def.icon(c, px + slot * 0.4, py + slot * 0.4, slot * 0.46, def.color);
      drawPips(px, py, slot * 0.8, op.level, def.maxLevel, def.color);
      px += slot * 0.8 + gap;
    }
  }

  function drawPips(x: number, y: number, slot: number, level: number, maxLevel: number, color: string) {
    if (maxLevel <= 0) return;
    const pipW = slot / (maxLevel + 1);
    for (let i = 0; i < maxLevel; i++) {
      c.fillStyle = i < level ? color : "rgba(255,255,255,0.18)";
      c.fillRect(x + 2 + i * pipW, y + slot - 4, pipW * 0.7, 2.5);
    }
  }

  // ----- level-up overlay -----
  function drawLevelup(W: number, H: number) {
    const ui = Math.min(W, H);
    c.fillStyle = "rgba(8,6,16,0.82)";
    c.fillRect(0, 0, W, H);
    drawText(c, "LEVEL UP!", W / 2, H * 0.16, clamp(ui * 0.08, 28, 56), COLORS.gold, "center", "800");
    drawText(c, "Choose an upgrade", W / 2, H * 0.16 + clamp(ui * 0.06, 22, 40), clamp(ui * 0.032, 13, 20), COLORS.textDim);

    const rects = cardRects();
    for (let i = 0; i < offers.length; i++) {
      const o = offers[i];
      const r = rects[i];
      // card bg
      c.fillStyle = "rgba(22,16,38,0.96)";
      roundRect(c, r.x, r.y, r.w, r.h, 14);
      c.fill();
      c.lineWidth = o.kind === "evolution" ? 3.5 : 2;
      c.strokeStyle = o.color;
      if (o.kind === "evolution") {
        c.globalAlpha = 0.6 + Math.sin(time * 6) * 0.4;
      }
      roundRect(c, r.x, r.y, r.w, r.h, 14);
      c.stroke();
      c.globalAlpha = 1;

      const portrait = H > W;
      if (portrait) {
        const iconC = r.x + r.h * 0.5;
        const iconY = r.y + r.h / 2;
        c.fillStyle = "rgba(0,0,0,0.3)";
        c.beginPath();
        c.arc(iconC, iconY, r.h * 0.34, 0, TAU);
        c.fill();
        o.icon(c, iconC, iconY, r.h * 0.42, o.color);
        const tx = r.x + r.h * 0.95;
        drawText(c, o.tag, tx, r.y + r.h * 0.26, r.h * 0.12, o.color, "left", "800");
        drawText(c, o.name, tx, r.y + r.h * 0.47, r.h * 0.2, COLORS.text, "left", "800");
        wrapText(o.desc, tx, r.y + r.h * 0.66, r.w - r.h - 24, r.h * 0.13, COLORS.textDim);
        drawText(c, `${i + 1}`, r.x + r.w - 18, r.y + 16, r.h * 0.14, COLORS.textDim, "right", "800");
      } else {
        const cx = r.x + r.w / 2;
        c.fillStyle = "rgba(0,0,0,0.3)";
        c.beginPath();
        c.arc(cx, r.y + r.h * 0.26, r.w * 0.2, 0, TAU);
        c.fill();
        o.icon(c, cx, r.y + r.h * 0.26, r.w * 0.26, o.color);
        drawText(c, o.tag, cx, r.y + r.h * 0.46, r.w * 0.08, o.color, "center", "800");
        drawText(c, o.name, cx, r.y + r.h * 0.57, r.w * 0.12, COLORS.text, "center", "800");
        wrapText(o.desc, cx, r.y + r.h * 0.7, r.w * 0.86, r.w * 0.07, COLORS.textDim, "center");
        drawText(c, `${i + 1}`, r.x + r.w - 16, r.y + 16, r.w * 0.09, COLORS.textDim, "right", "800");
      }
    }
  }

  function wrapText(
    text: string,
    x: number,
    y: number,
    maxW: number,
    size: number,
    color: string,
    align: CanvasTextAlign = "left",
  ) {
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.font = `700 ${size}px "Baloo 2", system-ui, sans-serif`;
    const words = text.split(" ");
    let line = "";
    let yy = y;
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, yy);
        line = word;
        yy += size * 1.25;
      } else {
        line = test;
      }
    }
    if (line) c.fillText(line, x, yy);
  }

  function drawPaused(W: number, H: number) {
    const ui = Math.min(W, H);
    c.fillStyle = "rgba(8,6,16,0.8)";
    c.fillRect(0, 0, W, H);
    drawText(c, "PAUSED", W / 2, H * 0.42, clamp(ui * 0.09, 30, 64), COLORS.text, "center", "800");
    drawText(c, "Tap or press P / Esc to resume", W / 2, H * 0.54, clamp(ui * 0.035, 14, 22), COLORS.textDim);
    // build summary
    drawText(c, `Level ${player.level}   ·   ${kills} kills   ·   Best ${best}`, W / 2, H * 0.62, clamp(ui * 0.03, 12, 18), COLORS.textDim);
  }

  function drawDead(W: number, H: number) {
    const ui = Math.min(W, H);
    c.fillStyle = "rgba(20,4,10,0.7)";
    c.fillRect(0, 0, W, H);
    drawText(c, "YOU FELL", W / 2, H * 0.4, clamp(ui * 0.1, 32, 72), COLORS.boss, "center", "800");
    const tt = Math.floor(time);
    drawText(c, `Survived ${Math.floor(tt / 60)}:${(tt % 60).toString().padStart(2, "0")}  ·  ${kills} kills`, W / 2, H * 0.52, clamp(ui * 0.04, 16, 26), COLORS.text);
    drawText(c, score > best ? "NEW BEST!" : `Best ${best}`, W / 2, H * 0.6, clamp(ui * 0.035, 14, 22), score > best ? COLORS.gold : COLORS.textDim);
  }

  function drawJoystick() {
    const baseR = JOY_MAX;
    c.globalAlpha = 0.5;
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.beginPath();
    c.arc(joy.ox, joy.oy, baseR, 0, TAU);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(joy.ox, joy.oy, baseR, 0, TAU);
    c.stroke();
    const dx = joy.x - joy.ox;
    const dy = joy.y - joy.oy;
    const d = Math.hypot(dx, dy);
    const cl = d > baseR ? baseR / d : 1;
    c.fillStyle = "rgba(122,245,230,0.7)";
    c.beginPath();
    c.arc(joy.ox + dx * cl, joy.oy + dy * cl, baseR * 0.42, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  return {
    update,
    render,
    resize() {
      /* sizes are read every frame from ctx getters; nothing to cache */
    },
    destroy() {
      enemies.length = 0;
      projectiles.length = 0;
      gems.length = 0;
      particles.length = 0;
      dmgNumbers.length = 0;
      beams.length = 0;
    },
  };
}
