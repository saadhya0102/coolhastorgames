import type { GameContext, GameInstance, Rect } from "@/engine";
import { clamp, drawText, roundRect } from "@/engine";
import {
  DISCIPLINES,
  DISC_NAME,
  FOODS,
  HATS,
  LEAGUE_COUNT,
  LEAGUE_NAMES,
  MAX_ENERGY,
  TRAIN_COST,
  addXp,
  coinsFromXp,
  effectiveStat,
  loadSave,
  persist,
  power,
  regenEnergy,
  secondsToNextEnergy,
  statLevel,
  statXp,
  xpForLevel,
  type Discipline,
  type SaveData,
} from "./duck/save";
import { PALETTE, rgba } from "./duck/theme";
import { clicked, drawButton, drawChip, drawCoin, drawPanel, drawStar, drawStatBar, hovering } from "./duck/ui";
import { drawDuck, lookFromSave, growthScale, type DuckLook } from "./duck/duck";
import { sky, sun, clouds, hills, water, grass } from "./duck/backdrop";
import { Particles } from "./duck/fx";
import type { Screen, ScreenEnv } from "./duck/screen";
import { createHatch } from "./duck/hatch";
import { createRun } from "./duck/train_run";
import { createSwim } from "./duck/train_swim";
import { createFly } from "./duck/train_fly";
import { createRace } from "./duck/race";

type View = "hub" | "train" | "raceSetup" | "shop" | "stats" | "sub";

const DISC_COLOR: Record<Discipline, string> = { run: PALETTE.run, swim: PALETTE.swim, fly: PALETTE.fly };

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;

  let save = regenEnergy(loadSave(storage));
  persist(storage, save);

  let view: View = "hub";
  let sub: Screen | null = null;
  let t = 0;
  let raceLeague = save.league;
  const particles = new Particles();

  // ambient quack
  let quackT = 3 + Math.random() * 3;
  let beakOpen = 0;

  // fade transition
  let fade = 0;
  let fadeDir = 0; // +1 out, -1 in
  let onMid: (() => void) | null = null;
  const idle = () => fadeDir === 0;
  const go = (action: () => void) => {
    if (fadeDir !== 0) return;
    fadeDir = 1;
    onMid = action;
    audio.blip();
  };

  let toast: { text: string; t: number; color: string } | null = null;
  const showToast = (text: string, color = PALETTE.good) => {
    toast = { text, t: 2.8, color };
  };

  const syncScore = () => ctx.reportScore(power(save));
  const currentLook = (): DuckLook => lookFromSave(save);

  const setSub = (s: Screen | null) => {
    if (sub && sub !== s) sub.destroy?.();
    sub = s;
  };

  const enterHub = () => {
    setSub(null);
    view = "hub";
    ctx.requestControls([]);
    ctx.setStatus("Raise your duckling — Train, Race, Shop, climb the Leagues!");
  };

  // start: hatch on first run
  syncScore();
  if (!save.hatched) {
    view = "sub";
    const env: ScreenEnv = { ctx, look: currentLook() };
    setSub(
      createHatch(env, () => {
        save.hatched = true;
        persist(storage, save);
        go(enterHub);
      }),
    );
    ctx.setStatus("A wild egg appears...");
  } else {
    enterHub();
  }

  /* --------------------------- actions --------------------------- */

  const startTrain = (disc: Discipline) => {
    if (save.energy < TRAIN_COST) {
      showToast("Not enough energy! Buy food in the Shop.", PALETTE.bad);
      audio.lose();
      return;
    }
    save.energy -= TRAIN_COST;
    persist(storage, save);
    const env: ScreenEnv = { ctx, look: currentLook() };
    go(() => {
      view = "sub";
      const onDone = (xp: number) => {
        const levels = addXp(save, disc, xp);
        save.coins += coinsFromXp(xp);
        persist(storage, save);
        syncScore();
        go(() => {
          enterHub();
          const extra = levels > 0 ? `  •  +${levels} Level${levels > 1 ? "s" : ""}!` : "";
          showToast(`${DISC_NAME[disc]} +${xp} XP${extra}`, levels > 0 ? PALETTE.accent : PALETTE.good);
          if (levels > 0) audio.win();
        });
      };
      if (disc === "run") setSub(createRun(env, onDone));
      else if (disc === "swim") setSub(createSwim(env, onDone));
      else setSub(createFly(env, onDone));
    });
  };

  const startRace = () => {
    save.league = raceLeague;
    persist(storage, save);
    const env: ScreenEnv = { ctx, look: currentLook() };
    go(() => {
      view = "sub";
      setSub(
        createRace(env, save, (r) => {
          save.coins += r.coins;
          save.races += 1;
          if (r.place === 0) save.wins += 1;
          if (r.unlocked) {
            save.bestLeague = Math.min(LEAGUE_COUNT - 1, r.league + 1);
            raceLeague = save.bestLeague;
          }
          persist(storage, save);
          syncScore();
          go(() => {
            enterHub();
            if (r.unlocked) showToast(`${LEAGUE_NAMES[save.bestLeague]} unlocked!`, PALETTE.accent);
            else showToast(`+${r.coins} coins`, PALETTE.coin);
          });
        }),
      );
    });
  };

  const buyFood = (id: string) => {
    const f = FOODS.find((x) => x.id === id);
    if (!f) return;
    if (save.coins < f.cost) {
      showToast("Not enough coins!", PALETTE.bad);
      audio.lose();
      return;
    }
    if (save.energy >= MAX_ENERGY) {
      showToast("Energy already full!", PALETTE.bad);
      return;
    }
    save.coins -= f.cost;
    save.energy = clamp(save.energy + f.energy, 0, MAX_ENERGY);
    persist(storage, save);
    audio.coin();
    showToast(`${f.name}! +${f.energy} energy`, PALETTE.energy);
  };

  const buyOrEquipHat = (id: string) => {
    const h = HATS.find((x) => x.id === id);
    if (!h) return;
    if (!save.owned.includes(id)) {
      if (save.coins < h.cost) {
        showToast("Not enough coins!", PALETTE.bad);
        audio.lose();
        return;
      }
      save.coins -= h.cost;
      save.owned.push(id);
      save.equipped = id;
      audio.coin();
      showToast(`Bought ${h.name}!`, PALETTE.accent);
    } else if (save.equipped === id) {
      save.equipped = null;
      audio.blip();
    } else {
      save.equipped = id;
      audio.blip();
    }
    persist(storage, save);
    syncScore();
  };

  /* --------------------------- layout --------------------------- */

  const backRect = (): Rect => ({ x: ctx.width * 0.04, y: ctx.height * 0.04, w: ctx.width * 0.16, h: ctx.height * 0.07 });

  const menuButtons = (): { rect: Rect; label: string; color: string; act: () => void }[] => {
    const W = ctx.width;
    const H = ctx.height;
    const gap = W * 0.03;
    const bw = (W * 0.86 - gap) / 2;
    const bh = H * 0.12;
    const x0 = W * 0.07;
    const y0 = H * 0.74;
    const defs = [
      { label: "TRAIN", color: PALETTE.run, act: () => go(() => (view = "train")) },
      { label: "RACE", color: PALETTE.swim, act: () => go(() => { raceLeague = save.league; view = "raceSetup"; }) },
      { label: "SHOP", color: PALETTE.fly, act: () => go(() => (view = "shop")) },
      { label: "STATS", color: PALETTE.accent, act: () => go(() => (view = "stats")) },
    ];
    return defs.map((d, i) => ({
      rect: { x: x0 + (i % 2) * (bw + gap), y: y0 + Math.floor(i / 2) * (bh + H * 0.02), w: bw, h: bh },
      label: d.label,
      color: d.color,
      act: d.act,
    }));
  };

  const disciplineCards = (): { rect: Rect; disc: Discipline }[] => {
    const W = ctx.width;
    const H = ctx.height;
    const gap = W * 0.03;
    const cw = (W * 0.9 - gap * 2) / 3;
    const ch = H * 0.56;
    const x0 = W * 0.05;
    const y0 = H * 0.22;
    return DISCIPLINES.map((disc, i) => ({ rect: { x: x0 + i * (cw + gap), y: y0, w: cw, h: ch }, disc }));
  };

  const shopFoodRects = (): Rect[] => {
    const W = ctx.width;
    const H = ctx.height;
    const gap = W * 0.03;
    const cw = (W * 0.9 - gap * 2) / 3;
    const x0 = W * 0.05;
    const y0 = H * 0.2;
    return FOODS.map((_, i) => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: H * 0.18 }));
  };

  const shopHatRects = (): Rect[] => {
    const W = ctx.width;
    const H = ctx.height;
    const x0 = W * 0.05;
    const y0 = H * 0.44;
    const rh = H * 0.092;
    const gap = H * 0.016;
    return HATS.map((_, i) => ({ x: x0, y: y0 + i * (rh + gap), w: W * 0.9, h: rh }));
  };

  /* --------------------------- update --------------------------- */

  const updateFade = (dt: number) => {
    if (fadeDir === 1) {
      fade += dt * 4.5;
      if (fade >= 1) {
        fade = 1;
        onMid?.();
        onMid = null;
        fadeDir = -1;
      }
    } else if (fadeDir === -1) {
      fade -= dt * 4.5;
      if (fade <= 0) {
        fade = 0;
        fadeDir = 0;
      }
    }
  };

  const update: GameInstance["update"] = (dt) => {
    t += dt;
    particles.update(dt);
    const before = save.energy;
    regenEnergy(save);
    if (Math.floor(save.energy) !== Math.floor(before)) persist(storage, save);

    if (toast) {
      toast.t -= dt;
      if (toast.t <= 0) toast = null;
    }
    updateFade(dt);

    // ambient quack on hub
    beakOpen = Math.max(0, beakOpen - dt * 4);
    if (view === "hub" && idle()) {
      quackT -= dt;
      if (quackT <= 0) {
        quackT = 4 + Math.random() * 4;
        beakOpen = 1;
        audio.tone(420, 0.1, "sawtooth", 0.25);
        audio.tone(360, 0.12, "sawtooth", 0.2);
        const W = ctx.width;
        const H = ctx.height;
        particles.spawn({ x: W * 0.5 + W * 0.06, y: H * 0.34, vx: 30, vy: -20, life: 0.6, max: 0.6, size: 6, color: rgba("#fff", 0.8) });
      }
    }

    if (view === "sub" && sub) {
      sub.update(dt);
      return;
    }
    if (!idle()) return;

    if (view === "hub") {
      for (const b of menuButtons()) if (clicked(input, b.rect)) b.act();
      if (input.pressed("1")) go(() => (view = "train"));
      if (input.pressed("2")) go(() => { raceLeague = save.league; view = "raceSetup"; });
      if (input.pressed("3")) go(() => (view = "shop"));
      if (input.pressed("4")) go(() => (view = "stats"));
      return;
    }

    // sub-pages share Back
    if (clicked(input, backRect()) || input.pressed("Escape", "Backspace")) {
      go(enterHub);
      return;
    }

    if (view === "train") {
      for (const card of disciplineCards()) if (clicked(input, card.rect)) startTrain(card.disc);
    } else if (view === "raceSetup") {
      const W = ctx.width;
      const H = ctx.height;
      const lr: Rect = { x: W * 0.1, y: H * 0.44, w: W * 0.12, h: H * 0.12 };
      const rr: Rect = { x: W * 0.78, y: H * 0.44, w: W * 0.12, h: H * 0.12 };
      const start: Rect = { x: W * 0.27, y: H * 0.82, w: W * 0.46, h: H * 0.11 };
      if ((clicked(input, lr) || input.pressed("ArrowLeft", "a")) && raceLeague > 0) {
        raceLeague--;
        audio.blip();
      }
      if ((clicked(input, rr) || input.pressed("ArrowRight", "d")) && raceLeague < save.bestLeague) {
        raceLeague++;
        audio.blip();
      }
      if (clicked(input, start) || input.pressed("Space", "Enter")) startRace();
    } else if (view === "shop") {
      shopFoodRects().forEach((r, i) => {
        if (clicked(input, r)) buyFood(FOODS[i].id);
      });
      shopHatRects().forEach((r, i) => {
        const btn: Rect = { x: r.x + r.w - ctx.width * 0.24, y: r.y + r.h * 0.16, w: ctx.width * 0.22, h: r.h * 0.68 };
        if (clicked(input, btn)) buyOrEquipHat(HATS[i].id);
      });
    } else if (view === "stats") {
      const W = ctx.width;
      const H = ctx.height;
      const submit: Rect = { x: W * 0.22, y: H * 0.84, w: W * 0.56, h: H * 0.1 };
      if (clicked(input, submit)) {
        syncScore();
        save.bestPower = Math.max(save.bestPower, power(save));
        persist(storage, save);
        ctx.gameOver(power(save));
        showToast("Score submitted!", PALETTE.good);
      }
    }
  };

  /* --------------------------- render --------------------------- */

  const drawTopBar = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const h = H * 0.062;
    const y = H * 0.035;
    // power chip (left)
    const pw = W * 0.24;
    drawChip(c, { x: W * 0.04, y, w: pw, h }, `Power ${power(save)}`, (cx, cy, r) => drawStar(c, cx, cy, r, PALETTE.accent));
    // coins chip (right)
    const cw = W * 0.2;
    const cx = W - cw - W * 0.04;
    drawChip(c, { x: cx, y, w: cw, h }, String(save.coins), (ix, iy, r) => drawCoin(c, ix, iy, r));
    // energy chip (center)
    const ex = W * 0.04 + pw + W * 0.02;
    const ew = cx - ex - W * 0.02;
    if (ew > W * 0.16) {
      drawPanel(c, { x: ex, y, w: ew, h }, rgba("#ffffff", 0.94), h / 2, false);
      const pad = h * 0.45;
      const bx = ex + pad;
      const bw = ew - pad * 2;
      const bh = h * 0.34;
      const by = y + h / 2 - bh / 2;
      c.fillStyle = rgba("#000000", 0.12);
      roundRect(c, bx, by, bw, bh, bh / 2);
      c.fill();
      const ratio = save.energy / MAX_ENERGY;
      if (ratio > 0.02) {
        c.fillStyle = ratio > 0.25 ? PALETTE.energy : PALETTE.bad;
        roundRect(c, bx, by, bw * ratio, bh, bh / 2);
        c.fill();
      }
      const label =
        save.energy >= MAX_ENERGY
          ? "ENERGY FULL"
          : `${Math.floor(save.energy)}/${MAX_ENERGY}  +1 in ${Math.ceil(secondsToNextEnergy(save))}s`;
      drawText(c, label, bx + bw / 2, by + bh / 2, bh * 0.86, "#0a3d1e", "center", "800");
    }
  };

  const drawBack = (c: CanvasRenderingContext2D) => {
    const r = backRect();
    drawButton(c, r, "BACK", { fill: "#ffffff", text: PALETTE.ink }, { hover: hovering(input, r), fontScale: 0.42 });
  };

  const drawWorld = (c: CanvasRenderingContext2D, W: number, H: number) => {
    sky(c, W, H, theme(save.league).sky[0], theme(save.league).sky[1]);
    sun(c, W * 0.82, H * 0.2, Math.min(W, H) * 0.06, "#fff3c8");
    clouds(c, W, H, t, { speed: 10, count: 4 });
    const groundY = H * 0.62;
    hills(c, W, H, t * 0.4, groundY, theme(save.league).hills);
    // pond on the right
    water(c, W, H, t, H * 0.66, theme(save.league).waterTop, theme(save.league).waterBot);
    grass(c, W, H, groundY, t * 6, theme(save.league).grassTop, theme(save.league).grassBot, theme(save.league).blade);
    // butterfly
    const bx = W * 0.3 + Math.sin(t * 0.8) * W * 0.18;
    const by = H * 0.4 + Math.sin(t * 2.3) * H * 0.04;
    c.fillStyle = "#ff8ac4";
    c.beginPath();
    c.ellipse(bx - 4, by, 5, 7, Math.sin(t * 18) * 0.6, 0, Math.PI * 2);
    c.ellipse(bx + 4, by, 5, 7, -Math.sin(t * 18) * 0.6, 0, Math.PI * 2);
    c.fill();
  };

  const renderHub = (c: CanvasRenderingContext2D, W: number, H: number) => {
    drawWorld(c, W, H);
    drawTopBar(c, W, H);

    drawText(c, "DUCK LIFE", W / 2, H * 0.155, H * 0.066, "#ffffff", "center", "800");
    c.save();
    c.globalAlpha = 0.9;
    drawText(c, LEAGUE_NAMES[save.league], W / 2, H * 0.205, H * 0.032, "#ffffff", "center");
    c.restore();

    // duck on a grassy mound
    const cx = W * 0.5;
    const cy = H * 0.42;
    const u = Math.min(W, H) * 0.1 * growthScale(currentLook().stage);
    // mound shadow
    c.fillStyle = rgba("#3f7a2e", 0.5);
    c.beginPath();
    c.ellipse(cx, cy + u * 1.3, u * 1.8, u * 0.5, 0, 0, Math.PI * 2);
    c.fill();
    drawDuck(c, cx, cy, u, currentLook(), { pose: "idle", t, beakOpen, glance: Math.sin(t * 0.7) * 0.6, shadow: false });
    particles.render(c);

    // mini stat bars
    const sbW = W * 0.86;
    const sbX = W * 0.07;
    const sbH = H * 0.055;
    DISCIPLINES.forEach((disc, i) => {
      const y = H * 0.55 + i * (sbH + H * 0.008);
      const lvl = statLevel(save, disc);
      const frac = statXp(save, disc) / xpForLevel(lvl);
      drawStatBar(c, { x: sbX, y, w: sbW, h: sbH }, DISC_NAME[disc], lvl, frac, DISC_COLOR[disc]);
    });

    for (const b of menuButtons()) {
      drawButton(c, b.rect, b.label, { fill: b.color, text: "#fff" }, { hover: hovering(input, b.rect), fontScale: 0.4 });
    }
  };

  const renderTrain = (c: CanvasRenderingContext2D, W: number, H: number) => {
    sky(c, W, H, "#ffd9a0", "#fff1d8");
    clouds(c, W, H, t, { speed: 8, count: 3, color: rgba("#ffffff", 0.7) });
    drawText(c, "CHOOSE TRAINING", W / 2, H * 0.12, H * 0.05, PALETTE.ink, "center", "800");
    drawText(c, `Each session costs ${TRAIN_COST} energy`, W / 2, H * 0.17, H * 0.028, PALETTE.inkSoft, "center");
    const enough = save.energy >= TRAIN_COST;
    for (const card of disciplineCards()) {
      const r = card.rect;
      const col = DISC_COLOR[card.disc];
      drawPanel(c, r, "#ffffff", 16);
      c.fillStyle = col;
      roundRect(c, r.x, r.y, r.w, r.h * 0.16, 16);
      c.fill();
      c.fillRect(r.x, r.y + r.h * 0.08, r.w, r.h * 0.08);
      drawText(c, DISC_NAME[card.disc], r.x + r.w / 2, r.y + r.h * 0.08, r.h * 0.08, "#fff", "center", "800");
      // demo duck performing the action
      const pose = card.disc === "run" ? "run" : card.disc === "swim" ? "swim" : "fly";
      const dphase = t * 1.5;
      drawDuck(c, r.x + r.w / 2, r.y + r.h * 0.42, r.w * 0.24, currentLook(), {
        pose,
        t,
        phase: dphase,
        flap: card.disc === "fly" ? Math.sin(t * 8) * 0.25 + 0.25 : 0,
        pitch: card.disc === "fly" ? Math.sin(t * 3) * 0.15 : 0,
        shadow: card.disc === "run",
      });
      const lvl = statLevel(save, card.disc);
      const frac = statXp(save, card.disc) / xpForLevel(lvl);
      drawText(c, `Level ${lvl}`, r.x + r.w / 2, r.y + r.h * 0.64, r.h * 0.07, col, "center", "800");
      const bx = r.x + r.w * 0.12;
      const bw = r.w * 0.76;
      const by = r.y + r.h * 0.72;
      const bh = r.h * 0.045;
      c.fillStyle = rgba("#000000", 0.1);
      roundRect(c, bx, by, bw, bh, bh / 2);
      c.fill();
      if (frac > 0) {
        c.fillStyle = col;
        roundRect(c, bx, by, bw * clamp(frac, 0, 1), bh, bh / 2);
        c.fill();
      }
      const tb: Rect = { x: r.x + r.w * 0.12, y: r.y + r.h * 0.83, w: r.w * 0.76, h: r.h * 0.12 };
      drawButton(c, tb, "TRAIN", { fill: enough ? col : "#9aa3b8", text: "#fff" }, {
        hover: hovering(input, r) && enough,
        disabled: !enough,
        fontScale: 0.5,
      });
    }
    drawEnergyStrip(c, W, H);
    drawBack(c);
  };

  const drawEnergyStrip = (c: CanvasRenderingContext2D, W: number, H: number) => {
    const bx = W * 0.07;
    const bw = W * 0.86;
    const by = H * 0.9;
    const bh = H * 0.03;
    drawText(c, "ENERGY", bx, by - H * 0.022, H * 0.028, PALETTE.inkSoft, "left");
    c.fillStyle = rgba("#000000", 0.1);
    roundRect(c, bx, by, bw, bh, bh / 2);
    c.fill();
    const w = (save.energy / MAX_ENERGY) * bw;
    if (w > 2) {
      const g = c.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, "#3fd07a");
      g.addColorStop(1, "#8af0a8");
      c.fillStyle = g;
      roundRect(c, bx, by, w, bh, bh / 2);
      c.fill();
    }
    drawText(c, `${Math.floor(save.energy)}/${MAX_ENERGY}`, bx + bw / 2, by + bh / 2, bh * 0.8, "#0a3d1e", "center", "800");
  };

  const renderRaceSetup = (c: CanvasRenderingContext2D, W: number, H: number) => {
    sky(c, W, H, theme(raceLeague).sky[0], theme(raceLeague).sky[1]);
    clouds(c, W, H, t, { speed: 10, count: 4 });
    drawText(c, "RACE", W / 2, H * 0.12, H * 0.06, "#ffffff", "center", "800");

    drawPanel(c, { x: W * 0.12, y: H * 0.2, w: W * 0.76, h: H * 0.18 }, "#ffffff", 16);
    drawText(c, LEAGUE_NAMES[raceLeague], W / 2, H * 0.27, H * 0.045, PALETTE.accent, "center", "800");
    const base = 3 + raceLeague * 5;
    drawText(c, `Rivals ~ stat ${base - 1}-${base + 5}`, W / 2, H * 0.33, H * 0.03, PALETTE.inkSoft, "center");

    const lr: Rect = { x: W * 0.1, y: H * 0.44, w: W * 0.12, h: H * 0.12 };
    const rr: Rect = { x: W * 0.78, y: H * 0.44, w: W * 0.12, h: H * 0.12 };
    drawButton(c, lr, "<", { fill: raceLeague > 0 ? PALETTE.accent : "#bbb", text: "#fff" }, {
      hover: hovering(input, lr), disabled: raceLeague <= 0, fontScale: 0.6,
    });
    drawButton(c, rr, ">", { fill: raceLeague < save.bestLeague ? PALETTE.accent : "#bbb", text: "#fff" }, {
      hover: hovering(input, rr), disabled: raceLeague >= save.bestLeague, fontScale: 0.6,
    });

    drawDuck(c, W / 2, H * 0.52, Math.min(W, H) * 0.09 * growthScale(currentLook().stage), currentLook(), {
      pose: "idle",
      t,
      glance: 0.4,
    });
    DISCIPLINES.forEach((disc, i) => {
      const y = H * 0.64 + i * H * 0.045;
      drawText(c, `${DISC_NAME[disc]}: ${effectiveStat(save, disc)}`, W / 2, y, H * 0.034, DISC_COLOR[disc], "center", "800");
    });

    const start: Rect = { x: W * 0.27, y: H * 0.82, w: W * 0.46, h: H * 0.11 };
    drawButton(c, start, "START RACE", { fill: PALETTE.good, text: "#fff" }, { hover: hovering(input, start), fontScale: 0.42 });
    drawBack(c);
  };

  const renderShop = (c: CanvasRenderingContext2D, W: number, H: number) => {
    sky(c, W, H, "#ffd9a8", "#fff3e3");
    clouds(c, W, H, t, { speed: 8, count: 3, color: rgba("#ffffff", 0.7) });
    drawTopBar(c, W, H);
    drawText(c, "SHOP", W / 2, H * 0.135, H * 0.05, PALETTE.ink, "center", "800");
    drawText(c, "FOOD — restore energy", W * 0.05, H * 0.18, H * 0.028, PALETTE.inkSoft, "left");

    shopFoodRects().forEach((r, i) => {
      const f = FOODS[i];
      drawPanel(c, r, "#ffffff", 14);
      c.fillStyle = f.color;
      c.beginPath();
      c.arc(r.x + r.w / 2, r.y + r.h * 0.32, r.h * 0.2, 0, Math.PI * 2);
      c.fill();
      drawText(c, f.name, r.x + r.w / 2, r.y + r.h * 0.6, r.h * 0.14, PALETTE.ink, "center", "800");
      drawText(c, `+${f.energy} energy`, r.x + r.w / 2, r.y + r.h * 0.76, r.h * 0.12, PALETTE.inkSoft, "center");
      const aff = save.coins >= f.cost;
      drawText(c, `${f.cost} coins`, r.x + r.w / 2, r.y + r.h * 0.92, r.h * 0.13, aff ? PALETTE.good : PALETTE.bad, "center", "800");
    });

    drawText(c, "HATS — style + race boost (tap to buy / equip)", W * 0.05, H * 0.42, H * 0.026, PALETTE.inkSoft, "left");
    shopHatRects().forEach((r, i) => {
      const h = HATS[i];
      const owned = save.owned.includes(h.id);
      const equipped = save.equipped === h.id;
      drawPanel(c, r, equipped ? PALETTE.panelSoft : "#ffffff", 12);
      // mini duck wearing the hat as a preview swatch
      const previewLook = { ...currentLook(), hat: h.hat, hatColor: h.color };
      drawDuck(c, r.x + r.h * 0.7, r.y + r.h * 0.6, r.h * 0.32, previewLook, { pose: "idle", t, shadow: false });
      drawText(c, h.name, r.x + r.h * 1.4, r.y + r.h * 0.38, r.h * 0.28, PALETTE.ink, "left", "800");
      const boostTxt = h.stat ? `+${h.boost} ${DISC_NAME[h.stat]}` : `+${h.boost} all stats`;
      drawText(c, boostTxt, r.x + r.h * 1.4, r.y + r.h * 0.7, r.h * 0.22, PALETTE.inkSoft, "left");
      const btn: Rect = { x: r.x + r.w - W * 0.24, y: r.y + r.h * 0.16, w: W * 0.22, h: r.h * 0.68 };
      const label = !owned ? `BUY ${h.cost}` : equipped ? "EQUIPPED" : "EQUIP";
      const fill = !owned ? (save.coins >= h.cost ? PALETTE.good : "#c2b28a") : equipped ? PALETTE.accent : "#9aa3b8";
      drawButton(c, btn, label, { fill, text: "#fff" }, { hover: hovering(input, btn), fontScale: 0.32 });
    });
    drawBack(c);
  };

  const renderStats = (c: CanvasRenderingContext2D, W: number, H: number) => {
    sky(c, W, H, "#c4b8ff", "#efeaff");
    clouds(c, W, H, t, { speed: 8, count: 3, color: rgba("#ffffff", 0.6) });
    drawText(c, "STATS", W / 2, H * 0.11, H * 0.05, PALETTE.ink, "center", "800");

    const panel: Rect = { x: W * 0.08, y: H * 0.18, w: W * 0.84, h: H * 0.56 };
    drawPanel(c, panel, "#ffffff", 18);
    drawDuck(c, panel.x + panel.w * 0.22, panel.y + panel.h * 0.4, Math.min(W, H) * 0.085 * growthScale(currentLook().stage), currentLook(), {
      pose: "idle",
      t,
      glance: 0.3,
    });

    const rows: [string, string, string][] = [
      ["Power", String(power(save)), PALETTE.accent],
      ["Running", `Lv ${save.run}`, PALETTE.run],
      ["Swimming", `Lv ${save.swim}`, PALETTE.swim],
      ["Flying", `Lv ${save.fly}`, PALETTE.fly],
      ["Coins", String(save.coins), PALETTE.coin],
      ["Races / Wins", `${save.races} / ${save.wins}`, PALETTE.good],
      ["Best League", LEAGUE_NAMES[save.bestLeague], PALETTE.swim],
    ];
    const rx = panel.x + panel.w * 0.42;
    rows.forEach((row, i) => {
      const y = panel.y + panel.h * 0.14 + i * panel.h * 0.115;
      drawText(c, row[0], rx, y, panel.h * 0.065, PALETTE.inkSoft, "left");
      drawText(c, row[1], panel.x + panel.w * 0.94, y, panel.h * 0.075, row[2], "right", "800");
    });

    // league dots
    const dotY = H * 0.78;
    const dotGap = (W * 0.6) / LEAGUE_COUNT;
    for (let i = 0; i < LEAGUE_COUNT; i++) {
      const dx = W * 0.2 + i * dotGap + dotGap / 2;
      c.fillStyle = i <= save.bestLeague ? PALETTE.good : rgba("#000000", 0.15);
      c.beginPath();
      c.arc(dx, dotY, H * 0.018, 0, Math.PI * 2);
      c.fill();
    }

    const submit: Rect = { x: W * 0.22, y: H * 0.84, w: W * 0.56, h: H * 0.1 };
    drawButton(c, submit, "SUBMIT SCORE", { fill: PALETTE.good, text: "#fff" }, { hover: hovering(input, submit), fontScale: 0.4 });
    drawText(c, "(submits your Power to the leaderboard)", W / 2, H * 0.96, H * 0.024, PALETTE.inkSoft, "center");
    drawBack(c);
  };

  const drawToast = (c: CanvasRenderingContext2D, W: number, H: number) => {
    if (!toast) return;
    const a = clamp(toast.t > 2.4 ? (2.8 - toast.t) / 0.4 : Math.min(1, toast.t / 0.6), 0, 1);
    c.save();
    c.globalAlpha = a;
    const tw = Math.min(W * 0.92, W * 0.4 + toast.text.length * H * 0.013);
    const tr: Rect = { x: W / 2 - tw / 2, y: H * 0.12, w: tw, h: H * 0.07 };
    drawPanel(c, tr, toast.color, tr.h / 2, true);
    drawText(c, toast.text, W / 2, tr.y + tr.h / 2, tr.h * 0.42, "#fff", "center", "800");
    c.restore();
  };

  const render: GameInstance["render"] = () => {
    const c = ctx.ctx;
    const W = ctx.width;
    const H = ctx.height;

    if (view === "sub" && sub) {
      sub.render();
    } else if (view === "hub") {
      renderHub(c, W, H);
    } else if (view === "train") {
      renderTrain(c, W, H);
    } else if (view === "raceSetup") {
      renderRaceSetup(c, W, H);
    } else if (view === "shop") {
      renderShop(c, W, H);
    } else if (view === "stats") {
      renderStats(c, W, H);
    }

    drawToast(c, W, H);

    if (fade > 0) {
      c.fillStyle = rgba("#0c0a1c", fade);
      c.fillRect(0, 0, W, H);
    }
  };

  return {
    update,
    render,
    resize() {
      /* layout is computed per-frame from width/height getters */
    },
    destroy() {
      sub?.destroy?.();
      sub = null;
      ctx.requestControls([]);
      persist(storage, save);
    },
  };
}

interface HubTheme {
  sky: [string, string];
  grassTop: string;
  grassBot: string;
  blade: string;
  hills: string[];
  waterTop: string;
  waterBot: string;
}

function theme(league: number): HubTheme {
  const list: HubTheme[] = [
    { sky: ["#8fd4ff", "#dff4ff"], grassTop: "#86cf52", grassBot: "#4f9a36", blade: "#73bf45", hills: ["#a7d977", "#7bc456"], waterTop: "#46b9e8", waterBot: "#1c6f9c" },
    { sky: ["#6fb6f0", "#cfeaff"], grassTop: "#79c24f", grassBot: "#3f8a30", blade: "#67b03e", hills: ["#8fc96a", "#67ab48"], waterTop: "#3aa6dd", waterBot: "#13608c" },
    { sky: ["#9fd0ef", "#eaf6ff"], grassTop: "#8ad07a", grassBot: "#4a8f52", blade: "#74c067", hills: ["#bfe0c0", "#8fc79a"], waterTop: "#5fc0e6", waterBot: "#2a7aa6" },
    { sky: ["#ff9e6b", "#ffd9a0"], grassTop: "#c8a25a", grassBot: "#8a6a36", blade: "#b89048", hills: ["#e0a878", "#c08858"], waterTop: "#e88a6a", waterBot: "#9c4a5a" },
  ];
  return list[clamp(league, 0, list.length - 1)];
}
