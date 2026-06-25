import type { GameContext, GameInstance } from "@/engine";
import { aabb } from "@/engine";
import {
  CLEAR_DELAY,
  COINS_PER_LIFE,
  INTRO_TIME,
  MAX_DT,
  SCORE_CLEAR_BONUS,
  SCORE_COIN,
  SCORE_ENEMY,
  SCORE_POWERUP,
  SCORE_TIME_PER_SEC,
  START_LIVES,
  TILE,
} from "./constants";
import { Camera } from "./camera";
import { LEVELS } from "./levels";
import { ParticleSystem } from "./particles";
import { Player } from "./player";
import { Sfx } from "./sfx";
import { World } from "./world";
import type { Box, GameState, Intent } from "./types";
import {
  drawBackground,
  drawCheckpoints,
  drawCoins,
  drawEnemy,
  drawGoal,
  drawMovers,
  drawPickups,
  drawPlayer,
  drawTiles,
} from "./render";
import {
  drawFlash,
  drawGameOver,
  drawHud,
  drawIntro,
  drawLevelClear,
  drawTitle,
  drawVictory,
  type ClearStats,
} from "./hud";

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;
  const sfx = new Sfx(audio);
  const particles = new ParticleSystem();
  const camera = new Camera();
  const player = new Player();

  let state: GameState = "title";
  let world: World | null = null;
  let levelIndex = 0;
  let score = 0;
  let coins = 0;
  let lives = START_LIVES;
  let coinsForLife = 0;
  let levelStartCoins = 0;
  let timeLeft = 0;

  let t = 0; // global animation clock
  let stateTimer = 0;
  let dying = false;
  let deathTimer = 0;
  let deathVy = 0;
  let flashColor = "#fff";
  let flashAlpha = 0;
  let endSubmitted = false;
  let clearStats: ClearStats | null = null;

  let respawnX = TILE * 2;
  let respawnGroundY = TILE * 2;

  const best = (): number => storage.get<number | null>("__best", null) ?? 0;
  const furthest = (): number => storage.get<number>("furthest", 0);

  ctx.requestControls([
    { type: "dpad" },
    { type: "button", key: "Shift", label: "RUN", id: "run" },
    { type: "button", key: "Space", label: "JUMP", id: "jump" },
  ]);
  ctx.setStatus("Reach the Bloom Gate!");

  // ---------- helpers ----------
  const addScore = (n: number) => {
    score += n;
    ctx.reportScore(score);
  };

  const findGroundY = (w: World, col: number, fromRow: number): number => {
    for (let r = fromRow; r < w.rows; r++) {
      if (w.solidAt(col, r) || w.oneWayAt(col, r)) return r * TILE;
    }
    return w.rows * TILE;
  };

  const loadLevel = (i: number, keepPower: boolean) => {
    const wld = new World(LEVELS[i]);
    camera.setLevelSize(wld.cols, wld.rows);
    levelStartCoins = coins;
    timeLeft = wld.timeLimit;
    const startCol = Math.round(wld.playerStart.x / TILE);
    respawnX = wld.playerStart.x;
    respawnGroundY = findGroundY(wld, startCol, Math.floor(wld.playerStart.y / TILE) + 1);
    player.reset(respawnX, respawnGroundY, keepPower);
    world = wld;
    camera.snapTo(player.cx, player.cy, ctx.width, ctx.height, player.facing);
    const fr = furthest();
    if (i + 1 > fr) storage.set("furthest", i + 1);
    dying = false;
  };

  const startRun = () => {
    score = 0;
    coins = 0;
    lives = START_LIVES;
    coinsForLife = 0;
    levelIndex = 0;
    endSubmitted = false;
    particles.clear();
    loadLevel(0, false);
    state = "intro";
    stateTimer = 0;
    ctx.reportScore(0);
  };

  const flash = (color: string, a: number) => {
    flashColor = color;
    flashAlpha = Math.max(flashAlpha, a);
  };

  const triggerDeath = () => {
    if (dying || player.dead) return;
    dying = true;
    deathTimer = 1.1;
    deathVy = -720;
    player.dead = true;
    sfx.die();
    camera.addShake(10);
    flash("#7a0000", 0.4);
  };

  const resolveDeath = () => {
    lives -= 1;
    if (lives <= 0) {
      enterGameOver();
    } else {
      // respawn at last checkpoint / start, keep big? lose power on death
      player.reset(respawnX, respawnGroundY, false);
      camera.snapTo(player.cx, player.cy, ctx.width, ctx.height, player.facing);
      dying = false;
    }
  };

  const enterLevelClear = (w: World) => {
    sfx.clear();
    const tb = Math.floor(Math.max(0, timeLeft)) * SCORE_TIME_PER_SEC;
    addScore(tb + SCORE_CLEAR_BONUS);
    const lvlCoins = coins - levelStartCoins;
    clearStats = {
      levelName: w.name,
      coins: lvlCoins,
      coinScore: lvlCoins * SCORE_COIN,
      timeBonus: tb,
      clearBonus: SCORE_CLEAR_BONUS,
      total: score,
    };
    particles.confetti(player.cx, player.cy - 20);
    state = "levelclear";
    stateTimer = 0;
  };

  const advanceFromClear = () => {
    levelIndex += 1;
    if (levelIndex >= LEVELS.length) {
      enterVictory();
    } else {
      loadLevel(levelIndex, true);
      state = "intro";
      stateTimer = 0;
    }
  };

  const enterGameOver = () => {
    state = "gameover";
    stateTimer = 0;
    dying = false;
  };

  const enterVictory = () => {
    state = "victory";
    stateTimer = 0;
    sfx.victory();
  };

  const endToHost = () => {
    if (endSubmitted) return;
    endSubmitted = true;
    ctx.gameOver(score);
  };

  // ---------- input ----------
  const buildIntent = (): Intent => ({
    left: input.isDown("ArrowLeft", "a"),
    right: input.isDown("ArrowRight", "d"),
    down: input.isDown("ArrowDown", "s"),
    jumpPressed: input.pressed("Space", "ArrowUp", "w", "z"),
    jumpHeld: input.isDown("Space", "ArrowUp", "w", "z"),
    jumpReleased: input.released("Space", "ArrowUp", "w", "z"),
    run: input.isDown("Shift"),
  });

  const confirmPressed = (): boolean =>
    input.pressed("Space", "Enter", "ArrowUp", "w", "z") || input.pointer.justDown;

  // ---------- interactions ----------
  const coinBox = (cx: number, cy: number): Box => ({ x: cx - 9, y: cy - 11, w: 18, h: 22 });

  const collectCoins = (w: World) => {
    const pb = player.box;
    for (const coin of w.coins) {
      if (coin.collected) continue;
      if (aabb(pb, coinBox(coin.x, coin.y))) {
        coin.collected = true;
        coins += 1;
        addScore(SCORE_COIN);
        sfx.coin();
        particles.coinSparkle(coin.x, coin.y, "#ffe06a");
        coinsForLife += 1;
        if (coinsForLife >= COINS_PER_LIFE) {
          coinsForLife -= COINS_PER_LIFE;
          lives += 1;
          sfx.oneUp();
          flash("#ffffff", 0.3);
        }
      }
    }
  };

  const collectPickups = (w: World) => {
    const pb = player.box;
    for (const p of w.pickups) {
      if (!p.active) continue;
      if (!aabb(pb, { x: p.x, y: p.y, w: p.w, h: p.h })) continue;
      p.active = false;
      addScore(SCORE_POWERUP);
      if (p.kind === "mushroom") {
        player.grow();
        sfx.powerup();
        flash("#9effc0", 0.25);
      } else if (p.kind === "star") {
        player.giveStar();
        sfx.star();
        flash("#fff7a0", 0.3);
      } else {
        lives += 1;
        sfx.oneUp();
      }
      particles.burst(p.x + p.w / 2, p.y + p.h / 2, "#fff", 14, 220);
    }
  };

  const hitEnemies = (w: World) => {
    const pb = player.box;
    for (const e of w.enemies) {
      if (e.state === "dead") continue;

      // star: destroy on touch
      if (player.power === "star" && aabb(pb, e.box)) {
        e.die(player.facing);
        addScore(SCORE_ENEMY);
        sfx.stomp();
        particles.poof(e.x + e.w / 2, e.y + e.h / 2, "#fff");
        camera.addShake(5);
        continue;
      }

      if (!aabb(pb, e.box)) continue;

      const stomping = player.vy > 40 && (player.y + player.h) - e.y < e.h * 0.6;
      if (stomping) {
        const r = e.stomp();
        player.bounce();
        if (r.score) addScore(r.score);
        sfx.stomp();
        camera.addShake(r.killed ? 6 : 4);
        if (r.killed) particles.poof(e.x + e.w / 2, e.y + e.h / 2, "#d7c4ff");
        else particles.burst(e.x + e.w / 2, e.y + e.h / 2, "#d7c4ff", 6, 140);
      } else if (e.kind === "snapper" && e.state === "shell") {
        e.kick(player.cx);
        sfx.shellKick();
      } else if (e.harmful) {
        const dmg = player.takeDamage();
        if (dmg === "die") triggerDeath();
        else if (dmg === "shrink") {
          sfx.hurt();
          camera.addShake(7);
          flash("#ffffff", 0.35);
          particles.burst(player.cx, player.cy, "#fff", 10, 200);
        }
      }
    }

    // moving shells destroy other enemies
    for (const e of w.enemies) {
      if (e.kind !== "snapper" || e.state !== "shellmove") continue;
      for (const o of w.enemies) {
        if (o === e || o.state === "dead") continue;
        if (aabb(e.box, o.box)) {
          o.die(e.dir);
          addScore(SCORE_ENEMY);
          particles.poof(o.x + o.w / 2, o.y + o.h / 2, "#d7c4ff");
          camera.addShake(4);
        }
      }
    }
  };

  const checkCheckpoints = (w: World) => {
    const pb = player.box;
    for (const cp of w.checkpoints) {
      if (cp.active) continue;
      const box: Box = { x: cp.x - TILE * 0.5, y: cp.y - TILE * 2, w: TILE, h: TILE * 3 };
      if (aabb(pb, box)) {
        cp.active = true;
        respawnX = cp.x - player.w / 2;
        const col = Math.round(cp.x / TILE);
        respawnGroundY = findGroundY(w, col, Math.floor(cp.y / TILE));
        sfx.checkpoint();
        particles.burst(cp.x, cp.y - TILE, w.palette.accent, 12, 160);
        flash(w.palette.accent, 0.18);
      }
    }
  };

  // ---------- playing update ----------
  const updatePlaying = (dt: number, w: World) => {
    if (dying) {
      deathVy += 2300 * dt;
      player.y += deathVy * dt;
      camera.update(player.cx, player.cy, player.facing, ctx.width, ctx.height, dt);
      particles.update(dt);
      deathTimer -= dt;
      if (deathTimer <= 0) resolveDeath();
      return;
    }

    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      triggerDeath();
      return;
    }

    w.updateMovers(dt);
    const intent = buildIntent();
    const ev = player.update(dt, intent, w);

    // player events -> fx
    if (ev.jumped) {
      sfx.jump();
      particles.dust(player.cx, player.y + player.h, 0);
    }
    if (ev.landed) {
      particles.landDust(ev.footX, ev.footY);
      if (ev.hardLanding) camera.addShake(3);
    }
    if (ev.bumpedSolid) sfx.bump();
    for (const q of ev.questionHits) {
      sfx.bump();
      if (q.content === "coin") {
        coins += 1;
        addScore(SCORE_COIN);
        sfx.coin();
        coinsForLife += 1;
        if (coinsForLife >= COINS_PER_LIFE) {
          coinsForLife -= COINS_PER_LIFE;
          lives += 1;
          sfx.oneUp();
        }
        particles.coinSparkle(q.x, q.y - 6, "#ffe06a");
      }
    }
    for (const b of ev.brickBreaks) {
      sfx.brick();
      camera.addShake(4);
      particles.debris(b.x, b.y, w.palette.brick);
    }

    // running dust
    if (player.grounded && Math.abs(player.vx) > 260 && Math.random() < 0.4) {
      particles.dust(player.cx - player.facing * 6, player.y + player.h, -player.facing);
    }
    // star trail
    if (player.power === "star") {
      particles.starTrail(player.cx, player.cy, `hsl(${(t * 360) % 360},90%,65%)`);
    }

    for (const e of w.enemies) e.update(dt, w);
    w.updatePickups(dt);

    collectCoins(w);
    collectPickups(w);
    hitEnemies(w);
    checkCheckpoints(w);

    // hazards
    if (!dying) {
      const hz = w.hazardAt(player.box);
      if (hz === "lava") {
        triggerDeath();
      } else if (hz === "spike") {
        const dmg = player.takeDamage();
        if (dmg === "die") triggerDeath();
        else if (dmg === "shrink") {
          sfx.hurt();
          camera.addShake(7);
          flash("#ffffff", 0.35);
        }
      }
    }

    // pit fall
    if (!dying && player.y > w.rows * TILE + 80) triggerDeath();

    // goal
    if (!dying && aabb(player.box, w.goal)) {
      sfx.flagSlide();
      enterLevelClear(w);
      return;
    }

    // cull dead enemies that have fully faded
    w.enemies = w.enemies.filter((e) => !e.gone);

    camera.update(player.cx, player.cy, player.facing, ctx.width, ctx.height, dt);
    particles.update(dt);
  };

  // ---------- render ----------
  const renderWorld = (w: World) => {
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;
    const vp = camera.viewport(W, H);
    drawBackground(c, W, H, w.palette, camera.x, camera.y, vp.scale, t);
    camera.begin(c);
    drawTiles(c, w, vp, t);
    drawCheckpoints(c, w, t);
    drawGoal(c, w, t);
    drawCoins(c, w.coins, w.palette, t);
    drawPickups(c, w.pickups, t);
    drawMovers(c, w.movers, w.palette);
    for (const e of w.enemies) drawEnemy(c, e, w.palette);
    particles.render(c);
    if (!player.dead || dying) drawPlayer(c, player, t);
    c.restore();
  };

  const renderHud = (w: World) => {
    drawHud(ctx.ctx, ctx.width, ctx.height, {
      coins,
      lives,
      score,
      levelName: w.name,
      levelIndex: levelIndex + 1,
      totalLevels: LEVELS.length,
      time: timeLeft,
    }, w.palette);
  };

  // ---------- GameInstance ----------
  return {
    update(dt: number) {
      if (dt > MAX_DT) dt = MAX_DT;
      t += dt;
      if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt * 1.8);

      switch (state) {
        case "title":
          if (confirmPressed()) startRun();
          break;
        case "intro":
          stateTimer += dt;
          // let the player peek; advance on input or timeout
          if (stateTimer > INTRO_TIME || confirmPressed()) {
            state = "playing";
          }
          break;
        case "playing": {
          const w = world;
          if (w) updatePlaying(dt, w);
          break;
        }
        case "levelclear":
          stateTimer += dt;
          particles.update(dt);
          if (stateTimer > 0.6 && Math.random() < 0.25) {
            particles.confetti(
              ctx.width * (0.2 + Math.random() * 0.6) / camera.scale + camera.x,
              camera.y + 20,
            );
          }
          if ((stateTimer > 2.0 && confirmPressed()) || stateTimer > CLEAR_DELAY + 3) {
            advanceFromClear();
          }
          break;
        case "gameover":
          stateTimer += dt;
          if ((stateTimer > 1.0 && confirmPressed()) || stateTimer > 5) endToHost();
          break;
        case "victory":
          stateTimer += dt;
          particles.update(dt);
          if (stateTimer > 0.4 && Math.random() < 0.3) {
            particles.confetti(
              ctx.width * Math.random() / Math.max(0.001, camera.scale) + camera.x,
              camera.y + 10,
            );
          }
          if ((stateTimer > 1.4 && confirmPressed()) || stateTimer > 8) endToHost();
          break;
        default:
          break;
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;

      if (state === "title") {
        // show a live backdrop using the first level's palette
        const pal = LEVELS[0].palette;
        drawBackground(c, W, H, pal, t * 30, 0, H / (14 * TILE), t);
        drawTitle(c, W, H, best(), furthest(), ctx.isTouch, t);
        return;
      }

      const w = world;
      if (!w) return;
      renderWorld(w);
      renderHud(w);
      drawFlash(c, W, H, flashColor, flashAlpha);

      if (state === "intro") {
        const a = Math.min(1, Math.max(0, 1 - (stateTimer - (INTRO_TIME - 0.6)) / 0.6));
        drawIntro(c, W, H, w.name, levelIndex + 1, LEVELS.length, a);
      } else if (state === "levelclear" && clearStats) {
        drawLevelClear(c, W, H, clearStats, stateTimer);
      } else if (state === "gameover") {
        const isBest = score >= best() && score > 0;
        drawGameOver(c, W, H, score, isBest, best(), ctx.isTouch, t);
      } else if (state === "victory") {
        const isBest = score >= best() && score > 0;
        drawVictory(c, W, H, score, isBest, best(), ctx.isTouch, t);
      }
    },

    resize() {
      if (world && state !== "title") {
        camera.snapTo(player.cx, player.cy, ctx.width, ctx.height, player.facing);
      }
    },

    destroy() {
      particles.clear();
    },
  };
}
