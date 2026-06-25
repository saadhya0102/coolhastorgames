import type { GameContext, GameInstance, Rect } from "@/engine";
import { clamp, drawText, pointInRect, roundRect } from "@/engine";
import { BALANCE, ENEMIES, TOWERS, TOWER_ORDER, UI } from "./config";
import {
  buildRoadTiles,
  directionAt,
  MAPS,
  pathLength,
  positionAt,
  tileKey,
} from "./maps";
import { Effects } from "./particles";
import {
  drawEnemy,
  drawKeep,
  drawMap,
  drawProjectile,
  drawRift,
  drawTower,
  drawTowerIcon,
  gridToScreen,
  screenToGrid,
  type Viewport,
} from "./render";
import { generateWaves } from "./waves";
import type {
  Enemy,
  EnemyKind,
  GameMap,
  Phase,
  Projectile,
  Tower,
  TowerKind,
} from "./types";

interface PendingSpawn {
  time: number;
  type: EnemyKind;
  hpMul: number;
  bountyMul: number;
}

interface Button extends Rect {
  id: string;
  enabled: boolean;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  /* -------------------------------------------------------------------- */
  /* Persistent + run state                                                */
  /* -------------------------------------------------------------------- */
  let best = storage.get<number>("best", 0);
  let mapIndex = clamp(storage.get<number>("lastMap", 0), 0, MAPS.length - 1);
  let seenTutorial = storage.get<boolean>("seenTutorial", false);

  const waves = generateWaves();

  let phase: Phase = "menu";
  let map: GameMap = MAPS[mapIndex];
  let roadTiles = buildRoadTiles(map);
  let decoTiles = new Set(map.decorations.map((d) => tileKey(d.x, d.y)));
  let pathLen = pathLength(map.waypoints);

  let gold = 0;
  let lives = 0;
  let waveIndex = 0; // number of waves cleared / index of next wave
  let score = 0;
  let kills = 0;
  let won = false;

  const towers: Tower[] = [];
  const enemies: Enemy[] = [];
  const projectiles: Projectile[] = [];
  const fx = new Effects();

  let pending: PendingSpawn[] = [];
  let waveActive = false;
  let waveClock = 0;
  let buildTimer = 0;

  let selectedId = -1;
  let placing: TowerKind | null = null;
  let speed = 1;
  let nextId = 1;

  let t = 0;
  let keepFlash = 0;
  let shakeT = 0;
  let shakeMag = 0;
  let hitSounds = 0;
  let menuInfo = ""; // transient tutorial hint

  ctx.requestControls([]);

  /* -------------------------------------------------------------------- */
  /* Layout (recomputed every frame)                                       */
  /* -------------------------------------------------------------------- */
  let vp: Viewport = { ox: 0, oy: 0, cell: 1, cols: map.cols, rows: map.rows };
  let topH = 0;
  let botH = 0;
  const buttons: Button[] = [];

  const pad = () => Math.max(6, Math.min(ctx.width, ctx.height) * 0.012);

  function computeLayout() {
    const W = ctx.width;
    const H = ctx.height;
    topH = clamp(H * 0.085, 40, 74);
    botH = clamp(H * 0.15, 76, 132);
    const playW = W;
    const playH = H - topH - botH;
    const cell = Math.min(playW / map.cols, playH / map.rows);
    const gridW = cell * map.cols;
    const gridH = cell * map.rows;
    vp = {
      ox: (playW - gridW) / 2,
      oy: topH + (playH - gridH) / 2,
      cell,
      cols: map.cols,
      rows: map.rows,
    };
  }

  function addBtn(id: string, x: number, y: number, w: number, h: number, enabled = true) {
    const b: Button = { id, x, y, w, h, enabled };
    buttons.push(b);
    return b;
  }

  /* -------------------------------------------------------------------- */
  /* Run lifecycle                                                         */
  /* -------------------------------------------------------------------- */
  function loadMap(i: number) {
    mapIndex = clamp(i, 0, MAPS.length - 1);
    map = MAPS[mapIndex];
    roadTiles = buildRoadTiles(map);
    decoTiles = new Set(map.decorations.map((d) => tileKey(d.x, d.y)));
    pathLen = pathLength(map.waypoints);
    storage.set("lastMap", mapIndex);
  }

  function startRun() {
    loadMap(mapIndex);
    gold = map.startGold;
    lives = map.startLives;
    waveIndex = 0;
    score = 0;
    kills = 0;
    won = false;
    towers.length = 0;
    enemies.length = 0;
    projectiles.length = 0;
    pending = [];
    fx.clear();
    waveActive = false;
    waveClock = 0;
    buildTimer = BALANCE.firstBuildTime;
    selectedId = -1;
    placing = null;
    speed = 1;
    keepFlash = 0;
    shakeT = 0;
    phase = "playing";
    setScore(0);
    if (!seenTutorial) {
      menuInfo = "Tap a tower below, then tap grass to build";
    }
    ctx.setStatus("Defend the keep!");
    audio.blip();
  }

  function setScore(s: number) {
    score = s;
    ctx.reportScore(score);
  }

  function endRun(victory: boolean) {
    if (phase === "gameover") return;
    won = victory;
    phase = "gameover";
    const finalScore = waveIndex * 100 + kills * 2 + Math.max(0, lives) * 5;
    setScore(finalScore);
    if (finalScore > best) {
      best = finalScore;
      storage.set("best", best);
    }
    storage.submitScore(finalScore, false);
    if (victory) audio.win();
    else audio.lose();
    ctx.setStatus(victory ? "Victory!" : "The keep has fallen");
    // schedule the shell game-over hand-off; keep our own screen too
    window.setTimeout(() => ctx.gameOver(finalScore), 400);
  }

  /* -------------------------------------------------------------------- */
  /* Building                                                              */
  /* -------------------------------------------------------------------- */
  function towerAt(col: number, row: number): Tower | null {
    for (const tw of towers) if (tw.col === col && tw.row === row) return tw;
    return null;
  }

  function isBuildable(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return false;
    if (roadTiles.has(tileKey(col, row))) return false;
    if (decoTiles.has(tileKey(col, row))) return false;
    if (towerAt(col, row)) return false;
    return true;
  }

  function buildCost(kind: TowerKind): number {
    return TOWERS[kind].levels[0].cost;
  }

  function placeTower(kind: TowerKind, col: number, row: number) {
    const cost = buildCost(kind);
    if (gold < cost || !isBuildable(col, row)) {
      audio.tone(160, 0.1, "square", 0.25);
      return;
    }
    gold -= cost;
    const tw: Tower = {
      id: nextId++,
      kind,
      col,
      row,
      x: col + 0.5,
      y: row + 0.5,
      level: 1,
      invested: cost,
      cooldown: 0,
      angle: -Math.PI / 2,
      recoil: 0,
      targetId: -1,
    };
    towers.push(tw);
    fx.ring(tw.x, tw.y, 0.8, "rgba(255,210,90,0.8)", 0.12);
    audio.tone(523, 0.08, "triangle", 0.4);
    audio.tone(784, 0.1, "triangle", 0.3);
    if (!seenTutorial) {
      seenTutorial = true;
      storage.set("seenTutorial", true);
      menuInfo = "";
    }
  }

  function upgradeTower(tw: Tower) {
    if (tw.level >= 3) return;
    const cost = TOWERS[tw.kind].levels[tw.level].cost;
    if (gold < cost) {
      audio.tone(160, 0.1, "square", 0.25);
      return;
    }
    gold -= cost;
    tw.invested += cost;
    tw.level++;
    fx.ring(tw.x, tw.y, 1.0, "rgba(255,210,90,0.9)", 0.14);
    fx.burst(tw.x, tw.y, UI.gold, 12, 2.5);
    audio.sweep(440, 880, 0.25, "triangle", 0.4);
  }

  function sellTower(tw: Tower) {
    const refund = Math.round(tw.invested * BALANCE.sellRefund);
    gold += refund;
    const idx = towers.indexOf(tw);
    if (idx >= 0) towers.splice(idx, 1);
    fx.burst(tw.x, tw.y, "#cfa14a", 14, 2.5);
    fx.text(tw.x, tw.y - 0.4, `+${refund}`, UI.gold, 0.55);
    audio.sweep(660, 220, 0.22, "square", 0.35);
    selectedId = -1;
  }

  /* -------------------------------------------------------------------- */
  /* Waves                                                                 */
  /* -------------------------------------------------------------------- */
  function startWave(early: boolean) {
    if (waveActive || waveIndex >= waves.length) return;
    if (early) {
      const bonus = Math.ceil(buildTimer) * BALANCE.earlyCallPerSec;
      if (bonus > 0) {
        gold += bonus;
        fx.text(map.cols / 2, map.rows / 2, `Early call +${bonus}`, UI.gold, 0.7);
      }
    }
    const wave = waves[waveIndex];
    pending = [];
    for (const g of wave.groups) {
      for (let i = 0; i < g.count; i++) {
        pending.push({
          time: g.delay + i * g.spacing,
          type: g.type,
          hpMul: g.hpMul,
          bountyMul: g.bountyMul,
        });
      }
    }
    pending.sort((a, b) => a.time - b.time);
    waveActive = true;
    waveClock = 0;
    if (wave.boss) audio.sweep(420, 120, 0.6, "sawtooth", 0.4);
    else audio.blip();
    ctx.setStatus(`Wave ${waveIndex + 1} of ${waves.length}`);
  }

  function spawnEnemy(p: PendingSpawn) {
    const def = ENEMIES[p.type];
    const hp = def.hp * p.hpMul;
    const e: Enemy = {
      id: nextId++,
      kind: p.type,
      dist: 0,
      x: map.waypoints[0].x,
      y: map.waypoints[0].y,
      hp,
      maxHp: hp,
      speed: def.speed,
      armor: def.armor,
      flying: def.flying,
      leak: def.leak,
      bounty: Math.round(def.bounty * p.bountyMul),
      radius: def.radius,
      slowT: 0,
      slowAmt: 0,
      anim: Math.random() * Math.PI * 2,
      bob: Math.random() * Math.PI * 2,
      flash: 0,
      faceX: 1,
      faceY: 0,
      dead: false,
      leaked: false,
    };
    enemies.push(e);
  }

  function completeWave() {
    waveActive = false;
    waveIndex++;
    const bonus = BALANCE.clearBonusBase + BALANCE.clearBonusPerWave * waveIndex;
    gold += bonus;
    fx.text(map.cols / 2, 1, `Wave clear +${bonus}`, UI.good, 0.8);
    setScore(waveIndex * 100 + kills * 2);
    if (waveIndex >= waves.length) {
      endRun(true);
      return;
    }
    buildTimer = BALANCE.buildTime;
    audio.tone(659, 0.12, "triangle", 0.4);
    ctx.setStatus(`Build phase — wave ${waveIndex + 1} next`);
  }

  /* -------------------------------------------------------------------- */
  /* Combat resolution                                                     */
  /* -------------------------------------------------------------------- */
  function enemyById(id: number): Enemy | null {
    for (const e of enemies) if (e.id === id && !e.dead) return e;
    return null;
  }

  function damageEnemy(e: Enemy, amount: number, magic: boolean) {
    if (e.dead) return;
    const final = magic ? amount : amount * (1 - e.armor);
    e.hp -= final;
    e.flash = 0.12;
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    kills++;
    gold += e.bounty;
    setScore(waveIndex * 100 + kills * 2);
    fx.burst(e.x, e.y, ENEMIES[e.kind].body, e.kind === "titan" ? 40 : 14, 3);
    fx.text(e.x, e.y - 0.4, `+${e.bounty}`, UI.gold, 0.5);
    if (hitSounds < BALANCE.maxHitSoundsPerFrame) {
      hitSounds++;
      audio.tone(880, 0.05, "square", 0.25);
    }
    if (e.kind === "warden" || e.kind === "titan") {
      audio.explosion();
      shake(12);
      fx.ring(e.x, e.y, 2.5, "rgba(255,180,90,0.9)", 0.2);
    }
  }

  function applySlow(e: Enemy, amt: number, dur: number) {
    if (amt >= e.slowAmt || e.slowT <= 0) {
      e.slowAmt = Math.max(e.slowAmt, amt);
      e.slowT = Math.max(e.slowT, dur);
    } else {
      e.slowT = Math.max(e.slowT, dur);
    }
  }

  function resolveImpact(p: Projectile) {
    const main = enemyById(p.targetId);
    const ix = main ? main.x : p.tx;
    const iy = main ? main.y : p.ty;
    const magic = p.damageType === "magic";

    if (p.splash > 0) {
      // AoE: damage all ground (or all if magic-ish) enemies in radius
      const r2 = p.splash * p.splash;
      for (const e of enemies) {
        if (e.dead) continue;
        if (e.flying) continue; // cannon cannot strike flyers
        const dx = e.x - ix;
        const dy = e.y - iy;
        if (dx * dx + dy * dy <= r2) damageEnemy(e, p.damage, magic);
      }
      fx.ring(ix, iy, p.splash, "rgba(255,170,80,0.9)", 0.16);
      fx.burst(ix, iy, "#ff9d4d", 16, 3);
      if (hitSounds < BALANCE.maxHitSoundsPerFrame) {
        hitSounds++;
        audio.noise(0.18, 0.35);
      }
      shake(5);
    } else if (main) {
      damageEnemy(main, p.damage, magic);
      fx.spark(ix, iy, p.kind === "arcane" ? "#e9c8ff" : p.kind === "frost" ? "#d6f4ff" : "#fff0c0");
      if (hitSounds < BALANCE.maxHitSoundsPerFrame && Math.random() < 0.5) {
        hitSounds++;
        audio.tone(p.kind === "arcane" ? 720 : 520, 0.04, "square", 0.18);
      }
    }

    // slow
    if (p.slow > 0) {
      if (main) applySlow(main, p.slow, p.slowDur);
      if (p.aoeSlow) {
        const r2 = 1.4 * 1.4;
        for (const e of enemies) {
          if (e.dead) continue;
          const dx = e.x - ix;
          const dy = e.y - iy;
          if (dx * dx + dy * dy <= r2) applySlow(e, p.slow, p.slowDur);
        }
        fx.ring(ix, iy, 1.4, "rgba(150,230,255,0.9)", 0.14);
      }
    }

    // chain (arcane)
    if (p.chain > 0 && main) {
      let remaining = p.chain;
      let from = main;
      const hitSet = new Set<number>([main.id]);
      while (remaining > 0) {
        let best: Enemy | null = null;
        let bestD = 2.6 * 2.6;
        for (const e of enemies) {
          if (e.dead || hitSet.has(e.id)) continue;
          const dx = e.x - from.x;
          const dy = e.y - from.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = e;
          }
        }
        if (!best) break;
        damageEnemy(best, p.damage * 0.6, true);
        fx.text(best.x, best.y - 0.4, "⚡", "#e9c8ff", 0.5);
        chainLink(from, best);
        hitSet.add(best.id);
        from = best;
        remaining--;
      }
    }
  }

  const chainLinks: { ax: number; ay: number; bx: number; by: number; life: number }[] = [];
  function chainLink(a: Enemy, b: Enemy) {
    chainLinks.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, life: 0.18 });
  }

  /* -------------------------------------------------------------------- */
  /* Tower firing                                                          */
  /* -------------------------------------------------------------------- */
  function acquireTarget(tw: Tower): Enemy | null {
    const def = TOWERS[tw.kind];
    const range = def.levels[tw.level - 1].range;
    const r2 = range * range;
    let best: Enemy | null = null;
    let bestDist = -1;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.flying && !def.canHitFlying) continue;
      const dx = e.x - tw.x;
      const dy = e.y - tw.y;
      if (dx * dx + dy * dy > r2) continue;
      // prefer the enemy furthest along the path
      if (e.dist > bestDist) {
        bestDist = e.dist;
        best = e;
      }
    }
    return best;
  }

  function fireTower(tw: Tower, target: Enemy) {
    const def = TOWERS[tw.kind];
    const lvl = def.levels[tw.level - 1];
    tw.angle = Math.atan2(target.y - tw.y, target.x - tw.x);
    tw.recoil = 1;
    tw.cooldown = 1 / lvl.fireRate;

    const make = (spread: number): Projectile => ({
      kind: tw.kind,
      x: tw.x + Math.cos(tw.angle) * 0.3,
      y: tw.y + Math.sin(tw.angle) * 0.3,
      targetId: target.id,
      tx: target.x,
      ty: target.y,
      speed: def.projectileSpeed,
      damage: lvl.damage,
      damageType: def.damageType,
      splash: lvl.splash ?? 0,
      slow: lvl.slow ?? 0,
      slowDur: lvl.slowDur ?? 0,
      chain: lvl.chain ?? 0,
      aoeSlow: lvl.aoeSlow ?? false,
      age: spread,
      dead: false,
    });

    projectiles.push(make(0));
    if (lvl.multishot) projectiles.push(make(0.001));

    switch (tw.kind) {
      case "archer":
        audio.tone(720, 0.04, "square", 0.16);
        break;
      case "cannon":
        audio.tone(180, 0.08, "square", 0.3);
        fx.burst(tw.x + Math.cos(tw.angle) * 0.6, tw.y + Math.sin(tw.angle) * 0.6, "#ffcf8a", 6, 2);
        shake(2);
        break;
      case "frost":
        audio.sweep(900, 1300, 0.1, "sine", 0.14);
        break;
      case "arcane":
        audio.tone(560, 0.07, "triangle", 0.18);
        break;
    }
  }

  /* -------------------------------------------------------------------- */
  /* Simulation                                                            */
  /* -------------------------------------------------------------------- */
  function shake(m: number) {
    shakeMag = Math.max(shakeMag, m);
    shakeT = Math.max(shakeT, 0.3);
  }

  function simulate(dt: number) {
    hitSounds = 0;
    t += dt;
    if (keepFlash > 0) keepFlash -= dt;
    if (shakeT > 0) shakeT -= dt;
    fx.update(dt);
    for (const cl of chainLinks) cl.life -= dt;
    if (chainLinks.length) {
      for (let i = chainLinks.length - 1; i >= 0; i--) if (chainLinks[i].life <= 0) chainLinks.splice(i, 1);
    }

    // build-phase countdown
    if (!waveActive && waveIndex < waves.length) {
      buildTimer -= dt;
      if (buildTimer <= 0) startWave(false);
    }

    // spawns
    if (waveActive) {
      waveClock += dt;
      while (pending.length && pending[0].time <= waveClock) {
        spawnEnemy(pending.shift()!);
        fx.burst(map.waypoints[0].x, map.waypoints[0].y, "#d24bff", 4, 1.5);
      }
    }

    // enemies
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.slowT > 0) {
        e.slowT -= dt;
        if (e.slowT <= 0) e.slowAmt = 0;
      }
      if (e.flash > 0) e.flash -= dt;
      const sp = e.speed * (1 - e.slowAmt);
      e.dist += sp * dt;
      e.anim += sp * dt * 6;
      e.bob += dt * 6;
      const p = positionAt(map.waypoints, e.dist);
      const d = directionAt(map.waypoints, e.dist);
      e.x = p.x;
      e.y = p.y;
      e.faceX = d.x;
      e.faceY = d.y;
      if (e.dist >= pathLen) leak(e);
    }

    // towers
    if (waveActive || enemies.length) {
      for (const tw of towers) {
        if (tw.recoil > 0) tw.recoil = Math.max(0, tw.recoil - dt * 5);
        if (tw.cooldown > 0) tw.cooldown -= dt;
        const target = acquireTarget(tw);
        tw.targetId = target ? target.id : -1;
        if (target) {
          // smoothly aim even when not firing (non-frost/arcane have barrels)
          tw.angle = Math.atan2(target.y - tw.y, target.x - tw.x);
          if (tw.cooldown <= 0) fireTower(tw, target);
        }
      }
    }

    // projectiles
    for (const p of projectiles) {
      if (p.dead) continue;
      p.age += dt;
      const target = enemyById(p.targetId);
      const tx = target ? target.x : p.tx;
      const ty = target ? target.y : p.ty;
      p.tx = tx;
      p.ty = ty;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 0.15 || p.age > 3) {
        resolveImpact(p);
        p.dead = true;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }

    // cleanup
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].dead || enemies[i].leaked) enemies.splice(i, 1);
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      if (projectiles[i].dead) projectiles.splice(i, 1);
    }

    // wave completion
    if (waveActive && pending.length === 0 && enemies.length === 0) completeWave();

    // selection sanity
    if (selectedId >= 0 && !towers.some((tw) => tw.id === selectedId)) selectedId = -1;
  }

  function leak(e: Enemy) {
    e.leaked = true;
    e.dead = true;
    lives -= e.leak;
    keepFlash = 0.3;
    shake(8);
    fx.burst(e.x, e.y, UI.heart, 12, 2.5);
    audio.tone(120, 0.18, "sawtooth", 0.35);
    audio.noise(0.12, 0.3);
    if (lives <= 0) {
      lives = 0;
      endRun(false);
    }
  }

  /* -------------------------------------------------------------------- */
  /* Input handling                                                        */
  /* -------------------------------------------------------------------- */
  function hit(b: Button, x: number, y: number): boolean {
    return b.enabled && pointInRect(x, y, b);
  }

  function findBtn(x: number, y: number): string | null {
    for (const b of buttons) if (hit(b, x, y)) return b.id;
    return null;
  }

  function handleTap(x: number, y: number) {
    const id = findBtn(x, y);
    if (phase === "menu") {
      if (id === "play") startRun();
      else if (id === "mapPrev") {
        loadMap(mapIndex - 1 < 0 ? MAPS.length - 1 : mapIndex - 1);
        audio.blip();
      } else if (id === "mapNext") {
        loadMap((mapIndex + 1) % MAPS.length);
        audio.blip();
      } else if (id && id.startsWith("map:")) {
        loadMap(parseInt(id.slice(4), 10));
        audio.blip();
      }
      return;
    }

    if (phase === "gameover") {
      if (id === "retry") startRun();
      else if (id === "menu") {
        phase = "menu";
        ctx.setStatus("");
      }
      return;
    }

    if (phase === "paused") {
      if (id === "resume") phase = "playing";
      else if (id === "restart") startRun();
      else if (id === "pmenu") {
        phase = "menu";
        ctx.setStatus("");
      }
      return;
    }

    // ---- playing ----
    if (id === "pause") {
      phase = "paused";
      return;
    }
    if (id === "speed") {
      speed = speed === 1 ? 2 : 1;
      audio.blip();
      return;
    }
    if (id === "next") {
      if (!waveActive) startWave(true);
      return;
    }
    if (id === "upgrade") {
      const tw = towers.find((w) => w.id === selectedId);
      if (tw) upgradeTower(tw);
      return;
    }
    if (id === "sell") {
      const tw = towers.find((w) => w.id === selectedId);
      if (tw) sellTower(tw);
      return;
    }
    if (id && id.startsWith("shop:")) {
      const kind = id.slice(5) as TowerKind;
      placing = placing === kind ? null : kind;
      selectedId = -1;
      audio.blip();
      return;
    }

    // tap on the board
    if (y > topH && y < ctx.height - botH) {
      const g = screenToGrid(vp, x, y);
      const col = Math.floor(g.x);
      const row = Math.floor(g.y);
      if (placing) {
        placeTower(placing, col, row);
        // keep placing mode for rapid building unless unaffordable
        if (gold < buildCost(placing)) placing = null;
        return;
      }
      const tw = towerAt(col, row);
      selectedId = tw ? tw.id : -1;
      if (!tw) placing = null;
      return;
    }

    // tapped empty HUD area -> deselect
    selectedId = -1;
    placing = null;
  }

  function handleKeys() {
    if (phase === "playing") {
      if (input.pressed("1")) (placing = placing === "archer" ? null : "archer"), (selectedId = -1);
      if (input.pressed("2")) (placing = placing === "cannon" ? null : "cannon"), (selectedId = -1);
      if (input.pressed("3")) (placing = placing === "frost" ? null : "frost"), (selectedId = -1);
      if (input.pressed("4")) (placing = placing === "arcane" ? null : "arcane"), (selectedId = -1);
      if (input.pressed("Escape")) {
        placing = null;
        selectedId = -1;
      }
      if (input.pressed("Space")) {
        if (!waveActive) startWave(true);
      }
      if (input.pressed("p")) phase = "paused";
      const tw = towers.find((w) => w.id === selectedId);
      if (tw && input.pressed("u")) upgradeTower(tw);
      if (tw && input.pressed("s")) sellTower(tw);
    } else if (phase === "paused") {
      if (input.pressed("p", "Escape")) phase = "playing";
    } else if (phase === "menu") {
      if (input.pressed("ArrowLeft")) loadMap(mapIndex - 1 < 0 ? MAPS.length - 1 : mapIndex - 1);
      if (input.pressed("ArrowRight")) loadMap((mapIndex + 1) % MAPS.length);
      if (input.pressed("Space", "Enter")) startRun();
    } else if (phase === "gameover") {
      if (input.pressed("Space", "Enter")) startRun();
    }
  }

  /* -------------------------------------------------------------------- */
  /* UPDATE                                                                */
  /* -------------------------------------------------------------------- */
  return {
    update(dt) {
      computeLayout();
      buildButtons();
      handleKeys();
      if (input.pointer.justDown) handleTap(input.pointer.x, input.pointer.y);

      const clamped = Math.min(dt, 0.05);
      if (phase === "playing") {
        const steps = speed;
        for (let i = 0; i < steps; i++) simulate(clamped);
      } else if (phase === "menu") {
        t += clamped;
        fx.update(clamped);
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      c.clearRect(0, 0, W, H);
      if (phase === "menu") {
        renderMenu(c);
        return;
      }
      renderGame(c);
      if (phase === "paused") renderPaused(c);
      if (phase === "gameover") renderGameOver(c);
    },

    resize() {
      computeLayout();
    },

    destroy() {
      enemies.length = 0;
      projectiles.length = 0;
      towers.length = 0;
      fx.clear();
    },
  };

  /* -------------------------------------------------------------------- */
  /* Button construction per phase                                         */
  /* -------------------------------------------------------------------- */
  function buildButtons() {
    buttons.length = 0;
    const W = ctx.width;
    const H = ctx.height;
    const P = pad();

    if (phase === "menu") {
      const cardW = Math.min(W * 0.26, 220);
      const cardH = Math.min(H * 0.3, 200);
      const gap = Math.min(W * 0.03, 26);
      const totalW = cardW * 3 + gap * 2;
      const startX = (W - totalW) / 2;
      const cy = H * 0.46;
      for (let i = 0; i < MAPS.length; i++) {
        addBtn(`map:${i}`, startX + i * (cardW + gap), cy - cardH / 2, cardW, cardH);
      }
      const pw = Math.min(W * 0.4, 280);
      addBtn("play", (W - pw) / 2, H * 0.78, pw, Math.min(H * 0.1, 64));
      return;
    }

    if (phase === "gameover") {
      const bw = Math.min(W * 0.34, 240);
      const bh = Math.min(H * 0.1, 60);
      addBtn("retry", W / 2 - bw - P, H * 0.62, bw, bh);
      addBtn("menu", W / 2 + P, H * 0.62, bw, bh);
      return;
    }

    if (phase === "paused") {
      const bw = Math.min(W * 0.5, 280);
      const bh = Math.min(H * 0.1, 58);
      const cx = (W - bw) / 2;
      addBtn("resume", cx, H * 0.4, bw, bh);
      addBtn("restart", cx, H * 0.4 + bh + P, bw, bh);
      addBtn("pmenu", cx, H * 0.4 + (bh + P) * 2, bw, bh);
      return;
    }

    // playing: top bar buttons
    const tb = topH - P * 1.2;
    addBtn("pause", W - tb - P, P * 0.6, tb, tb);
    addBtn("speed", W - tb * 2 - P * 2, P * 0.6, tb, tb);

    // bottom bar
    const byTop = H - botH + P;
    const bh = botH - P * 2;
    const nextW = clamp(W * 0.17, 92, 168);
    addBtn("next", W - nextW - P, byTop, nextW, bh, !waveActive);

    const leftX = P;
    const leftW = W - nextW - P * 3;
    if (selectedId >= 0) {
      // inspector buttons
      const tw = towers.find((w) => w.id === selectedId);
      const half = (leftW - P) / 2;
      const btnH = bh * 0.46;
      const yy = byTop + bh - btnH;
      const canUp = tw ? tw.level < 3 && gold >= TOWERS[tw.kind].levels[tw.level].cost : false;
      addBtn("upgrade", leftX + leftW * 0.42, yy, leftW * 0.58 - P, btnH, canUp);
      addBtn("sell", leftX + leftW * 0.42, byTop, leftW * 0.58 - P, btnH, true);
      void half;
    } else {
      // shop
      const n = TOWER_ORDER.length;
      const gap = P * 0.6;
      const bw = (leftW - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const kind = TOWER_ORDER[i];
        addBtn(`shop:${kind}`, leftX + i * (bw + gap), byTop, bw, bh, gold >= buildCost(kind));
      }
    }
  }

  function btn(id: string): Button | undefined {
    return buttons.find((b) => b.id === id);
  }

  /* -------------------------------------------------------------------- */
  /* Rendering: game                                                       */
  /* -------------------------------------------------------------------- */
  function renderGame(c: CanvasRenderingContext2D) {
    const W = ctx.width;
    const H = ctx.height;

    // sky/backsplash behind letterbox
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#27313b");
    bg.addColorStop(1, "#161d24");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    c.save();
    if (shakeT > 0) {
      const m = shakeMag * (shakeT / 0.3);
      c.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    drawMap(c, map, vp, roadTiles, t);
    // re-draw keep with current flash on top of map's static keep
    drawKeep(c, map, vp, t, keepFlash);
    void drawRift;

    // placement / selection range preview
    renderPreview(c);

    // towers (sorted by y for depth)
    const sorted = [...towers].sort((a, b) => a.y - b.y);
    for (const tw of sorted) drawTower(c, tw, vp, tw.id === selectedId, t);

    // enemies
    for (const e of enemies) drawEnemy(c, e, ENEMIES[e.kind], vp, t);

    // chain links
    for (const cl of chainLinks) {
      const a = gridToScreen(vp, cl.ax, cl.ay);
      const b = gridToScreen(vp, cl.bx, cl.by);
      c.globalAlpha = clamp(cl.life / 0.18, 0, 1);
      c.strokeStyle = "#e9c8ff";
      c.lineWidth = Math.max(2, vp.cell * 0.08);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      c.globalAlpha = 1;
    }

    // projectiles
    for (const p of projectiles) drawProjectile(c, p, vp);

    // effects
    fx.render(c, (gx, gy) => gridToScreen(vp, gx, gy), vp.cell);

    c.restore();

    renderHUD(c);
  }

  function renderPreview(c: CanvasRenderingContext2D) {
    let cx = -1;
    let cy = -1;
    let range = 0;
    let valid = true;
    let kind: TowerKind | null = null;

    if (placing) {
      const g = screenToGrid(vp, input.pointer.x, input.pointer.y);
      cx = Math.floor(g.x);
      cy = Math.floor(g.y);
      kind = placing;
      range = TOWERS[placing].levels[0].range;
      valid =
        isBuildable(cx, cy) &&
        gold >= buildCost(placing) &&
        input.pointer.y > topH &&
        input.pointer.y < ctx.height - botH;
    } else if (selectedId >= 0) {
      const tw = towers.find((w) => w.id === selectedId);
      if (tw) {
        cx = tw.col;
        cy = tw.row;
        kind = tw.kind;
        range = TOWERS[tw.kind].levels[tw.level - 1].range;
        valid = true;
      }
    }
    if (!kind || cx < 0) return;

    const center = gridToScreen(vp, cx + 0.5, cy + 0.5);
    // range circle
    c.fillStyle = valid ? UI.rangeFill : UI.rangeBad;
    c.strokeStyle = valid ? UI.rangeStroke : UI.rangeBadStroke;
    c.lineWidth = Math.max(2, vp.cell * 0.05);
    c.beginPath();
    c.arc(center.x, center.y, range * vp.cell, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    if (placing) {
      // tile highlight + ghost tower
      const s = gridToScreen(vp, cx, cy);
      c.fillStyle = valid ? "rgba(95,214,107,0.4)" : "rgba(255,107,93,0.4)";
      c.fillRect(s.x, s.y, vp.cell, vp.cell);
      c.globalAlpha = 0.7;
      const ghost: Tower = {
        id: -99,
        kind: placing,
        col: cx,
        row: cy,
        x: cx + 0.5,
        y: cy + 0.5,
        level: 1,
        invested: 0,
        cooldown: 0,
        angle: -Math.PI / 2,
        recoil: 0,
        targetId: -1,
      };
      drawTower(c, ghost, vp, false, t);
      c.globalAlpha = 1;
    }
  }

  /* -------------------------------------------------------------------- */
  /* Rendering: HUD                                                        */
  /* -------------------------------------------------------------------- */
  function renderHUD(c: CanvasRenderingContext2D) {
    const W = ctx.width;
    const H = ctx.height;
    const P = pad();

    // top bar
    c.fillStyle = "rgba(20,16,10,0.72)";
    c.fillRect(0, 0, W, topH);
    c.fillStyle = UI.panelEdge;
    c.fillRect(0, topH - 3, W, 3);

    const fs = clamp(topH * 0.4, 14, 26);
    const midY = topH * 0.5;

    // gold
    let x = P + fs * 0.6;
    drawCoin(c, x, midY, fs * 0.5);
    drawText(c, `${gold}`, x + fs * 0.8, midY, fs, UI.gold, "left");

    // lives
    x += fs * 4.2;
    drawHeart(c, x, midY, fs * 0.55);
    drawText(c, `${lives}`, x + fs * 0.8, midY, fs, "#ffd2d2", "left");

    // wave + score (center)
    const waveLabel =
      waveIndex >= waves.length ? "Done" : `Wave ${Math.min(waveIndex + 1, waves.length)}/${waves.length}`;
    drawText(c, waveLabel, W * 0.5, midY * 0.72, fs * 0.92, "#fff", "center");
    drawText(c, `Score ${score}`, W * 0.5, midY * 1.34, fs * 0.7, "#cdbfa6", "center");

    // speed + pause buttons
    const sb = btn("speed");
    if (sb) {
      drawHudButton(c, sb, false);
      drawText(c, speed === 1 ? "▶" : "▶▶", sb.x + sb.w / 2, sb.y + sb.h / 2, sb.h * 0.42, "#fff");
    }
    const pb = btn("pause");
    if (pb) {
      drawHudButton(c, pb, false);
      drawText(c, "II", pb.x + pb.w / 2, pb.y + pb.h / 2, pb.h * 0.42, "#fff");
    }

    // bottom bar
    c.fillStyle = "rgba(20,16,10,0.78)";
    c.fillRect(0, H - botH, W, botH);
    c.fillStyle = UI.panelEdge;
    c.fillRect(0, H - botH, W, 3);

    if (selectedId >= 0) renderInspector(c);
    else renderShop(c);
    renderNextButton(c);

    // transient hint
    if (menuInfo) {
      drawText(c, menuInfo, W / 2, H - botH - P - 8, clamp(H * 0.024, 12, 18), "#ffe9b0", "center");
    }
  }

  function renderShop(c: CanvasRenderingContext2D) {
    for (const kind of TOWER_ORDER) {
      const b = btn(`shop:${kind}`);
      if (!b) continue;
      const def = TOWERS[kind];
      const selected = placing === kind;
      const affordable = gold >= buildCost(kind);
      c.fillStyle = selected ? "rgba(255,210,90,0.28)" : "rgba(244,230,200,0.1)";
      roundRect(c, b.x, b.y, b.w, b.h, 10);
      c.fill();
      c.strokeStyle = selected ? UI.gold : "rgba(202,165,94,0.5)";
      c.lineWidth = selected ? 3 : 1.5;
      roundRect(c, b.x, b.y, b.w, b.h, 10);
      c.stroke();

      c.globalAlpha = affordable ? 1 : 0.4;
      const iconU = Math.min(b.w, b.h) * 0.26;
      drawTowerIcon(c, kind, b.x + b.w * 0.5, b.y + b.h * 0.36, iconU);
      const fs = clamp(b.h * 0.16, 10, 16);
      drawText(c, def.name, b.x + b.w / 2, b.y + b.h * 0.72, fs, "#fff", "center");
      c.globalAlpha = 1;
      // cost
      const cy = b.y + b.h * 0.88;
      drawCoin(c, b.x + b.w / 2 - fs * 1.1, cy, fs * 0.42);
      drawText(c, `${buildCost(kind)}`, b.x + b.w / 2 - fs * 0.5, cy, fs, affordable ? UI.gold : "#c98", "left");
    }
  }

  function renderInspector(c: CanvasRenderingContext2D) {
    const tw = towers.find((w) => w.id === selectedId);
    if (!tw) return;
    const def = TOWERS[tw.kind];
    const lvl = def.levels[tw.level - 1];
    const P = pad();
    const x = P;
    const yTop = ctx.height - botH + P;
    const h = botH - P * 2;
    const infoW = (ctx.width - clamp(ctx.width * 0.17, 92, 168) - P * 3) * 0.42;

    // info panel
    c.fillStyle = "rgba(244,230,200,0.1)";
    roundRect(c, x, yTop, infoW, h, 10);
    c.fill();
    const iconU = Math.min(infoW, h) * 0.2;
    drawTowerIcon(c, tw.kind, x + iconU * 1.4, yTop + h * 0.4, iconU);
    const fs = clamp(h * 0.16, 11, 17);
    drawText(c, `${def.name} L${tw.level}`, x + infoW * 0.45, yTop + h * 0.22, fs, "#fff", "left");
    drawText(
      c,
      `DMG ${lvl.damage}  RNG ${lvl.range.toFixed(1)}`,
      x + infoW * 0.45,
      yTop + h * 0.48,
      fs * 0.82,
      "#cdbfa6",
      "left",
    );
    const extra =
      lvl.splash ? `Splash ${lvl.splash.toFixed(1)}` : lvl.slow ? `Slow ${Math.round(lvl.slow * 100)}%` : def.damageType === "magic" ? "Ignores armor" : `${lvl.fireRate.toFixed(1)}/s`;
    drawText(c, extra, x + infoW * 0.45, yTop + h * 0.72, fs * 0.82, "#cdbfa6", "left");

    // upgrade button
    const ub = btn("upgrade");
    if (ub) {
      const maxed = tw.level >= 3;
      const cost = maxed ? 0 : def.levels[tw.level].cost;
      const can = !maxed && gold >= cost;
      c.fillStyle = maxed ? "rgba(120,120,120,0.25)" : can ? "rgba(95,214,107,0.3)" : "rgba(255,107,93,0.18)";
      roundRect(c, ub.x, ub.y, ub.w, ub.h, 9);
      c.fill();
      c.strokeStyle = maxed ? "#888" : can ? UI.good : "rgba(255,120,100,0.6)";
      c.lineWidth = 2;
      roundRect(c, ub.x, ub.y, ub.w, ub.h, 9);
      c.stroke();
      const ufs = clamp(ub.h * 0.34, 11, 18);
      if (maxed) {
        drawText(c, "MAX LEVEL", ub.x + ub.w / 2, ub.y + ub.h / 2, ufs, "#ddd", "center");
      } else {
        drawText(c, "UPGRADE", ub.x + ub.w * 0.34, ub.y + ub.h / 2, ufs, "#fff", "center");
        drawCoin(c, ub.x + ub.w * 0.62, ub.y + ub.h / 2, ufs * 0.45);
        drawText(c, `${cost}`, ub.x + ub.w * 0.7, ub.y + ub.h / 2, ufs, can ? UI.gold : "#e9a", "left");
      }
    }
    // sell button
    const sb = btn("sell");
    if (sb) {
      const refund = Math.round(tw.invested * BALANCE.sellRefund);
      c.fillStyle = "rgba(255,180,90,0.18)";
      roundRect(c, sb.x, sb.y, sb.w, sb.h, 9);
      c.fill();
      c.strokeStyle = UI.goldDeep;
      c.lineWidth = 2;
      roundRect(c, sb.x, sb.y, sb.w, sb.h, 9);
      c.stroke();
      const sfs = clamp(sb.h * 0.34, 11, 18);
      drawText(c, `SELL +${refund}`, sb.x + sb.w / 2, sb.y + sb.h / 2, sfs, "#ffe2b0", "center");
    }
  }

  function renderNextButton(c: CanvasRenderingContext2D) {
    const b = btn("next");
    if (!b) return;
    const active = !waveActive;
    c.fillStyle = active ? "rgba(95,214,107,0.3)" : "rgba(120,120,120,0.18)";
    roundRect(c, b.x, b.y, b.w, b.h, 10);
    c.fill();
    c.strokeStyle = active ? UI.good : "rgba(160,160,160,0.5)";
    c.lineWidth = 2.5;
    roundRect(c, b.x, b.y, b.w, b.h, 10);
    c.stroke();
    const fs = clamp(b.h * 0.2, 12, 20);
    if (active) {
      drawText(c, "NEXT WAVE", b.x + b.w / 2, b.y + b.h * 0.34, fs, "#fff", "center");
      const secs = Math.max(0, Math.ceil(buildTimer));
      drawText(c, `auto in ${secs}s`, b.x + b.w / 2, b.y + b.h * 0.6, fs * 0.72, "#dfeede", "center");
      const bonus = Math.ceil(buildTimer) * BALANCE.earlyCallPerSec;
      drawText(c, `call → +${bonus}`, b.x + b.w / 2, b.y + b.h * 0.84, fs * 0.66, UI.gold, "center");
    } else {
      drawText(c, "WAVE", b.x + b.w / 2, b.y + b.h * 0.36, fs, "#fff", "center");
      drawText(c, "in progress", b.x + b.w / 2, b.y + b.h * 0.62, fs * 0.7, "#ccc", "center");
      const left = pending.length + enemies.length;
      drawText(c, `${left} left`, b.x + b.w / 2, b.y + b.h * 0.84, fs * 0.66, "#ffd2a0", "center");
    }
  }

  function drawHudButton(c: CanvasRenderingContext2D, b: Button, glow: boolean) {
    c.fillStyle = glow ? "rgba(255,210,90,0.3)" : "rgba(244,230,200,0.14)";
    roundRect(c, b.x, b.y, b.w, b.h, 8);
    c.fill();
    c.strokeStyle = "rgba(202,165,94,0.6)";
    c.lineWidth = 1.5;
    roundRect(c, b.x, b.y, b.w, b.h, 8);
    c.stroke();
  }

  /* -------------------------------------------------------------------- */
  /* Rendering: menu / overlays                                            */
  /* -------------------------------------------------------------------- */
  function renderMenu(c: CanvasRenderingContext2D) {
    const W = ctx.width;
    const H = ctx.height;
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1c2a3a");
    bg.addColorStop(1, "#0f1620");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // drifting decorative critters
    for (let i = 0; i < 8; i++) {
      const px = ((i * 137 + t * (18 + i * 4)) % (W + 80)) - 40;
      const py = H * (0.12 + ((i * 0.11) % 0.7));
      c.globalAlpha = 0.25;
      c.fillStyle = i % 2 ? "#5fd0e0" : "#7cae4c";
      c.beginPath();
      c.arc(px, py, 10 + (i % 3) * 4, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }

    // title
    drawText(c, "IRON VALE", W / 2, H * 0.16, clamp(H * 0.1, 34, 76), UI.gold, "center", "800");
    drawText(c, "Tower Defense", W / 2, H * 0.255, clamp(H * 0.035, 14, 28), "#cdbfa6", "center");
    drawText(
      c,
      `Best ${best}`,
      W / 2,
      H * 0.31,
      clamp(H * 0.03, 12, 22),
      "#9fb4c8",
      "center",
    );

    drawText(c, "Choose your map", W / 2, H * 0.37, clamp(H * 0.028, 12, 20), "#fff", "center");

    // map cards
    for (let i = 0; i < MAPS.length; i++) {
      const b = btn(`map:${i}`);
      if (!b) continue;
      const m = MAPS[i];
      const selected = i === mapIndex;
      c.fillStyle = selected ? "rgba(255,210,90,0.18)" : "rgba(255,255,255,0.05)";
      roundRect(c, b.x, b.y, b.w, b.h, 12);
      c.fill();
      c.strokeStyle = selected ? UI.gold : "rgba(255,255,255,0.18)";
      c.lineWidth = selected ? 3.5 : 1.5;
      roundRect(c, b.x, b.y, b.w, b.h, 12);
      c.stroke();

      // mini map preview
      drawMapPreview(c, m, b.x + b.w * 0.12, b.y + b.h * 0.12, b.w * 0.76, b.h * 0.56);
      drawText(c, m.name, b.x + b.w / 2, b.y + b.h * 0.82, clamp(b.h * 0.11, 12, 20), "#fff", "center");
      drawText(c, m.theme, b.x + b.w / 2, b.y + b.h * 0.93, clamp(b.h * 0.075, 9, 14), "#9fb4c8", "center");
    }

    // play button
    const pb = btn("play");
    if (pb) {
      const pulse = 1 + Math.sin(t * 4) * 0.03;
      c.save();
      c.translate(pb.x + pb.w / 2, pb.y + pb.h / 2);
      c.scale(pulse, pulse);
      c.translate(-(pb.x + pb.w / 2), -(pb.y + pb.h / 2));
      c.fillStyle = UI.gold;
      roundRect(c, pb.x, pb.y, pb.w, pb.h, pb.h * 0.5);
      c.fill();
      drawText(c, `PLAY · ${MAPS[mapIndex].name}`, pb.x + pb.w / 2, pb.y + pb.h / 2, pb.h * 0.4, "#2a2118", "center", "800");
      c.restore();
    }

    drawText(
      c,
      "Place towers to stop monsters reaching your keep",
      W / 2,
      H * 0.92,
      clamp(H * 0.024, 11, 18),
      "#8aa0b6",
      "center",
    );
  }

  function drawMapPreview(
    c: CanvasRenderingContext2D,
    m: GameMap,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    c.fillStyle = m.grass;
    roundRect(c, x, y, w, h, 6);
    c.fill();
    const sx = w / m.cols;
    const sy = h / m.rows;
    c.strokeStyle = m.road;
    c.lineWidth = Math.max(3, Math.min(sx, sy) * 0.8);
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    for (let i = 0; i < m.waypoints.length; i++) {
      const wp = m.waypoints[i];
      const px = x + clamp(wp.x, 0, m.cols) * sx;
      const py = y + clamp(wp.y, 0, m.rows) * sy;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.stroke();
  }

  function renderPaused(c: CanvasRenderingContext2D) {
    const W = ctx.width;
    const H = ctx.height;
    c.fillStyle = "rgba(10,8,5,0.7)";
    c.fillRect(0, 0, W, H);
    drawText(c, "PAUSED", W / 2, H * 0.3, clamp(H * 0.07, 28, 56), "#fff", "center", "800");
    drawMenuButton(c, btn("resume"), "RESUME", UI.good);
    drawMenuButton(c, btn("restart"), "RESTART", UI.gold);
    drawMenuButton(c, btn("pmenu"), "MAIN MENU", "#9fb4c8");
  }

  function renderGameOver(c: CanvasRenderingContext2D) {
    const W = ctx.width;
    const H = ctx.height;
    c.fillStyle = won ? "rgba(20,40,20,0.78)" : "rgba(40,12,12,0.8)";
    c.fillRect(0, 0, W, H);
    drawText(
      c,
      won ? "VICTORY!" : "DEFEAT",
      W / 2,
      H * 0.28,
      clamp(H * 0.09, 32, 70),
      won ? UI.gold : UI.heart,
      "center",
      "800",
    );
    drawText(
      c,
      won ? `You survived all ${waves.length} waves` : `Fell on wave ${Math.min(waveIndex + 1, waves.length)}`,
      W / 2,
      H * 0.38,
      clamp(H * 0.032, 14, 24),
      "#fff",
      "center",
    );
    drawText(c, `Score ${score}`, W / 2, H * 0.46, clamp(H * 0.04, 16, 30), "#fff", "center", "800");
    drawText(c, `Best ${best}`, W / 2, H * 0.52, clamp(H * 0.03, 12, 22), "#cdbfa6", "center");
    drawMenuButton(c, btn("retry"), "RETRY", UI.good);
    drawMenuButton(c, btn("menu"), "MENU", "#9fb4c8");
  }

  function drawMenuButton(c: CanvasRenderingContext2D, b: Button | undefined, label: string, color: string) {
    if (!b) return;
    c.fillStyle = color;
    roundRect(c, b.x, b.y, b.w, b.h, b.h * 0.45);
    c.fill();
    drawText(c, label, b.x + b.w / 2, b.y + b.h / 2, b.h * 0.4, "#1a1410", "center", "800");
  }

  /* -------------------------------------------------------------------- */
  /* Small icon helpers                                                    */
  /* -------------------------------------------------------------------- */
  function drawCoin(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.fillStyle = UI.goldDeep;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = UI.gold;
    c.beginPath();
    c.arc(x, y, r * 0.74, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = UI.goldDeep;
    c.font = `800 ${r * 1.1}px "Baloo 2", system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("$", x, y + r * 0.05);
  }

  function drawHeart(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.fillStyle = UI.heart;
    c.beginPath();
    c.moveTo(x, y + r * 0.7);
    c.bezierCurveTo(x - r * 1.3, y - r * 0.4, x - r * 0.5, y - r, x, y - r * 0.35);
    c.bezierCurveTo(x + r * 0.5, y - r, x + r * 1.3, y - r * 0.4, x, y + r * 0.7);
    c.fill();
  }
}
