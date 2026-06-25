import type { GameContext, GameInstance, Rect } from "@/engine";
import { drawText, roundRect, pointInRect, clamp } from "@/engine";

interface GenDef {
  name: string;
  icon: string;
  baseCost: number;
  rate: number;
  color: string;
}

interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  type: "click" | "prod";
  mult: number;
}

interface SaveData {
  coins: number;
  lifetime: number;
  earnedThisRun: number;
  gens: number[];
  upgrades: string[];
  prestige: number;
  lastVisit: number;
}

const GENS: GenDef[] = [
  { name: "Farm", icon: "🌾", baseCost: 15, rate: 0.5, color: "#7ed957" },
  { name: "Mine", icon: "⛏️", baseCost: 120, rate: 3, color: "#b9925e" },
  { name: "Factory", icon: "🏭", baseCost: 1.3e3, rate: 18, color: "#9aa6c4" },
  { name: "Bank", icon: "🏦", baseCost: 14e3, rate: 95, color: "#ffd23a" },
  { name: "Lab", icon: "🔬", baseCost: 160e3, rate: 520, color: "#5ee0d0" },
  { name: "Rocket", icon: "🚀", baseCost: 1.8e6, rate: 3000, color: "#ff6b4a" },
  { name: "Portal", icon: "🌀", baseCost: 24e6, rate: 16000, color: "#a16bff" },
  { name: "Singularity", icon: "✨", baseCost: 360e6, rate: 95000, color: "#ff5b9a" },
];

const UPGRADES: UpgradeDef[] = [
  { id: "click1", name: "Sharper Taps", desc: "Tap value x3", cost: 400, type: "click", mult: 3 },
  { id: "prod1", name: "Overclock", desc: "All output x2", cost: 6e3, type: "prod", mult: 2 },
  { id: "click2", name: "Golden Touch", desc: "Tap value x4", cost: 80e3, type: "click", mult: 4 },
  { id: "prod2", name: "Automation", desc: "All output x2", cost: 400e3, type: "prod", mult: 2 },
  { id: "prod3", name: "Synergy", desc: "All output x3", cost: 12e6, type: "prod", mult: 3 },
  { id: "click3", name: "Mega Tap", desc: "Tap value x6", cost: 60e6, type: "click", mult: 6 },
  { id: "prod4", name: "Quantum Core", desc: "All output x3", cost: 800e6, type: "prod", mult: 3 },
];

const OFFLINE_CAP = 4 * 3600; // seconds
const PRESTIGE_REQ = 1e6;
const SAVE_KEY = "save";

const UNITS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

function fmt(n: number): string {
  if (!isFinite(n)) return "∞";
  if (n < 0) return "0";
  if (n < 1000) return n < 10 ? n.toFixed(1) : Math.floor(n).toString();
  let u = 0;
  let v = n;
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}${UNITS[u]}`;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

interface Item {
  kind: "header" | "upgrade" | "gen";
  text?: string;
  up?: UpgradeDef;
  idx?: number;
  y: number;
  h: number;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  text: string;
}

export function create(ctx: GameContext): GameInstance {
  const { input, audio, storage } = ctx;
  const c = ctx.ctx;

  const def: SaveData = {
    coins: 0,
    lifetime: 0,
    earnedThisRun: 0,
    gens: GENS.map(() => 0),
    upgrades: [],
    prestige: 0,
    lastVisit: 0,
  };
  const save = storage.get<SaveData>(SAVE_KEY, def);
  // defensive merge for older / partial saves
  const s: SaveData = { ...def, ...save };
  if (!Array.isArray(s.gens) || s.gens.length !== GENS.length)
    s.gens = GENS.map((_, i) => (Array.isArray(save.gens) ? save.gens[i] ?? 0 : 0));
  if (!Array.isArray(s.upgrades)) s.upgrades = [];

  let scrollY = 0;
  let maxScroll = 0;
  let contentH = 0;
  let buttonScale = 1;
  const coinFx: Coin[] = [];
  let prestigeConfirm = 0; // seconds left on confirm window
  let saveTimer = 0;
  let scoreTimer = 0;

  let offlinePopup: { amount: number; secs: number } | null = null;
  let dragging = false;
  let dragStartY = 0;
  let dragScrollStart = 0;
  let dragMoved = 0;

  // -------------------------------------------------------------- derived
  const clickMult = (): number => {
    let m = 1;
    for (const u of UPGRADES)
      if (u.type === "click" && s.upgrades.includes(u.id)) m *= u.mult;
    return m;
  };
  const prodMult = (): number => {
    let m = 1;
    for (const u of UPGRADES)
      if (u.type === "prod" && s.upgrades.includes(u.id)) m *= u.mult;
    return m;
  };
  const prestigeMult = (): number => 1 + 0.1 * s.prestige;
  const clickValue = (): number => 1 * clickMult() * prestigeMult();
  const baseProd = (): number => {
    let sum = 0;
    for (let i = 0; i < GENS.length; i++) sum += s.gens[i] * GENS[i].rate;
    return sum;
  };
  const perSec = (): number => baseProd() * prodMult() * prestigeMult();
  const genCost = (i: number): number =>
    Math.floor(GENS[i].baseCost * Math.pow(1.15, s.gens[i]));
  const genLocked = (i: number): boolean => i > 0 && s.gens[i - 1] === 0;
  const prestigeGain = (): number => Math.floor(Math.sqrt(s.earnedThisRun / PRESTIGE_REQ));

  // -------------------------------------------------------------- offline
  const now = Date.now();
  if (s.lastVisit > 0) {
    const elapsed = Math.min((now - s.lastVisit) / 1000, OFFLINE_CAP);
    const rate = perSec();
    if (elapsed > 1 && rate > 0) {
      const earn = rate * elapsed;
      s.coins += earn;
      s.lifetime += earn;
      s.earnedThisRun += earn;
      offlinePopup = { amount: earn, secs: elapsed };
    }
  }
  s.lastVisit = now;

  const persist = () => {
    s.lastVisit = Date.now();
    storage.set(SAVE_KEY, s);
  };
  persist();

  ctx.requestControls([]);
  ctx.setStatus("Tap the coin - buy generators - prestige to multiply!");
  ctx.reportScore(Math.floor(s.lifetime));

  // -------------------------------------------------------------- wheel
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    scrollY = clamp(scrollY + e.deltaY, 0, maxScroll);
  };
  ctx.canvas.addEventListener("wheel", onWheel, { passive: false });

  // -------------------------------------------------------------- layout
  const layout = () => {
    const w = ctx.width;
    const h = ctx.height;
    const headerH = h * 0.15;
    const btnBand = h * 0.24;
    const bottomH = h * 0.1;
    const btnCx = w / 2;
    const btnCy = headerH + btnBand / 2;
    const btnR = Math.min(btnBand * 0.42, w * 0.2);
    const listY = headerH + btnBand + h * 0.01;
    const listH = h - listY - bottomH - h * 0.012;
    const list: Rect = { x: w * 0.04, y: listY, w: w * 0.92, h: listH };
    const bw = w * 0.44;
    const prestigeBtn: Rect = { x: w * 0.04, y: h - bottomH, w: bw, h: bottomH * 0.82 };
    const submitBtn: Rect = { x: w * 0.52, y: h - bottomH, w: bw, h: bottomH * 0.82 };
    return { w, h, headerH, btnCx, btnCy, btnR, list, prestigeBtn, submitBtn };
  };

  const buildItems = (list: Rect): Item[] => {
    const rowH = clamp(list.h * 0.2, 52, 96);
    const gap = rowH * 0.12;
    const headerH = rowH * 0.55;
    const items: Item[] = [];
    let y = 0;
    const ups = UPGRADES.filter((u) => !s.upgrades.includes(u.id));
    if (ups.length) {
      items.push({ kind: "header", text: "UPGRADES", y, h: headerH });
      y += headerH;
      for (const u of ups) {
        items.push({ kind: "upgrade", up: u, y, h: rowH });
        y += rowH + gap;
      }
      y += gap;
    }
    items.push({ kind: "header", text: "GENERATORS", y, h: headerH });
    y += headerH;
    for (let i = 0; i < GENS.length; i++) {
      items.push({ kind: "gen", idx: i, y, h: rowH });
      y += rowH + gap;
    }
    contentH = y;
    maxScroll = Math.max(0, contentH - list.h);
    return items;
  };

  // -------------------------------------------------------------- actions
  const doClick = (px: number, py: number) => {
    const v = clickValue();
    s.coins += v;
    s.lifetime += v;
    s.earnedThisRun += v;
    buttonScale = 0.86;
    coinFx.push({
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 60,
      vy: -90 - Math.random() * 40,
      t: 1,
      text: `+${fmt(v)}`,
    });
    audio.tone(540 + Math.random() * 120, 0.05, "square", 0.25);
  };

  const buyUpgrade = (u: UpgradeDef) => {
    if (s.coins >= u.cost) {
      s.coins -= u.cost;
      s.upgrades.push(u.id);
      audio.coin();
      persist();
    } else {
      audio.tone(160, 0.08, "sawtooth", 0.2);
    }
  };

  const buyGen = (i: number) => {
    if (genLocked(i)) {
      audio.tone(160, 0.08, "sawtooth", 0.2);
      return;
    }
    const cost = genCost(i);
    if (s.coins >= cost) {
      s.coins -= cost;
      s.gens[i]++;
      audio.coin();
      persist();
    } else {
      audio.tone(160, 0.08, "sawtooth", 0.2);
    }
  };

  const doPrestige = () => {
    const gain = prestigeGain();
    if (gain < 1) {
      audio.tone(160, 0.08, "sawtooth", 0.2);
      return;
    }
    if (prestigeConfirm > 0) {
      s.prestige += gain;
      s.coins = 0;
      s.earnedThisRun = 0;
      s.gens = GENS.map(() => 0);
      s.upgrades = [];
      prestigeConfirm = 0;
      scrollY = 0;
      audio.win();
      persist();
    } else {
      prestigeConfirm = 3;
      audio.blip();
    }
  };

  // -------------------------------------------------------------- update
  const tapped = (r: Rect): boolean =>
    input.pointer.justUp && pointInRect(input.pointer.x, input.pointer.y, r);

  return {
    update(dt) {
      const d = Math.min(dt, 0.1);
      const L = layout();
      const items = buildItems(L.list);
      // keep scroll in range when the list shrinks (e.g. an upgrade is bought)
      scrollY = clamp(scrollY, 0, maxScroll);

      // passive income
      const inc = perSec() * d;
      if (inc > 0) {
        s.coins += inc;
        s.lifetime += inc;
        s.earnedThisRun += inc;
      }

      // animations
      buttonScale += (1 - buttonScale) * Math.min(1, d * 12);
      for (const f of coinFx) {
        f.t -= d / 1;
        f.x += f.vx * d;
        f.y += f.vy * d;
        f.vy += 60 * d;
      }
      for (let i = coinFx.length - 1; i >= 0; i--) if (coinFx[i].t <= 0) coinFx.splice(i, 1);
      if (prestigeConfirm > 0) prestigeConfirm = Math.max(0, prestigeConfirm - d);

      // offline popup dismiss
      if (offlinePopup) {
        if (input.pointer.justUp || input.pressed("Space", "Enter")) offlinePopup = null;
        // freeze other input while popup is up
      } else {
        // big button click (keyboard)
        if (input.pressed("Space")) doClick(L.btnCx, L.btnCy);
        // big button click (pointer down inside circle)
        if (
          input.pointer.justDown &&
          Math.hypot(input.pointer.x - L.btnCx, input.pointer.y - L.btnCy) <= L.btnR
        ) {
          doClick(input.pointer.x, input.pointer.y);
        }

        // bottom buttons
        if (tapped(L.prestigeBtn)) doPrestige();
        if (tapped(L.submitBtn)) {
          persist();
          ctx.gameOver(Math.floor(s.lifetime));
        }

        // list scrolling / buying
        if (input.pointer.justDown && pointInRect(input.pointer.x, input.pointer.y, L.list)) {
          dragging = true;
          dragStartY = input.pointer.y;
          dragScrollStart = scrollY;
          dragMoved = 0;
        }
        if (dragging && input.pointer.down) {
          const dy = input.pointer.y - dragStartY;
          dragMoved = Math.max(dragMoved, Math.abs(dy));
          scrollY = clamp(dragScrollStart - dy, 0, maxScroll);
        }
        if (dragging && input.pointer.justUp) {
          dragging = false;
          if (dragMoved < 8) {
            // treat as tap -> find row under release point
            const px = input.pointer.x;
            const py = input.pointer.y;
            for (const it of items) {
              if (it.kind === "header") continue;
              const ry = L.list.y + it.y - scrollY;
              if (py >= ry && py <= ry + it.h && px >= L.list.x && px <= L.list.x + L.list.w) {
                if (it.kind === "upgrade" && it.up) buyUpgrade(it.up);
                else if (it.kind === "gen" && it.idx !== undefined) buyGen(it.idx);
                break;
              }
            }
          }
        }
      }

      // persist + score throttled
      saveTimer += d;
      if (saveTimer >= 2) {
        saveTimer = 0;
        persist();
      }
      scoreTimer += d;
      if (scoreTimer >= 0.3) {
        scoreTimer = 0;
        ctx.reportScore(Math.floor(s.lifetime));
      }
    },

    render() {
      const L = layout();
      const { w, h } = L;
      const items = buildItems(L.list);

      // background
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#10182b");
      g.addColorStop(1, "#0a0f1d");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      // ---- header ----
      drawText(c, `${fmt(s.coins)}`, w / 2, h * 0.045, Math.min(w, h) * 0.085, "#ffd23a");
      drawText(
        c,
        `${fmt(perSec())}/sec`,
        w / 2,
        h * 0.095,
        Math.min(w, h) * 0.04,
        "#7ed957",
      );
      drawText(
        c,
        `Prestige x${prestigeMult().toFixed(1)}  (${s.prestige} pp)`,
        w * 0.04,
        h * 0.13,
        Math.min(w, h) * 0.03,
        "#a16bff",
        "left",
      );
      drawText(
        c,
        `Lifetime ${fmt(s.lifetime)}`,
        w * 0.96,
        h * 0.13,
        Math.min(w, h) * 0.03,
        "#9fb0e0",
        "right",
      );

      // ---- big button ----
      const r = L.btnR * buttonScale;
      const bg = c.createRadialGradient(L.btnCx, L.btnCy - r * 0.3, r * 0.2, L.btnCx, L.btnCy, r);
      bg.addColorStop(0, "#ffe79a");
      bg.addColorStop(1, "#f5a623");
      c.fillStyle = bg;
      c.beginPath();
      c.arc(L.btnCx, L.btnCy, r, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = Math.max(3, r * 0.08);
      c.strokeStyle = "#c87f12";
      c.stroke();
      drawText(c, "$", L.btnCx, L.btnCy - r * 0.12, r * 0.8, "#7a4d00");
      drawText(c, `+${fmt(clickValue())}`, L.btnCx, L.btnCy + r * 0.55, r * 0.3, "#7a4d00");

      // ---- list ----
      c.save();
      c.beginPath();
      c.rect(L.list.x, L.list.y, L.list.w, L.list.h);
      c.clip();
      // panel bg
      c.fillStyle = "rgba(255,255,255,0.03)";
      roundRect(c, L.list.x, L.list.y, L.list.w, L.list.h, 10);
      c.fill();

      for (const it of items) {
        const ry = L.list.y + it.y - scrollY;
        if (ry + it.h < L.list.y || ry > L.list.y + L.list.h) continue;

        if (it.kind === "header") {
          drawText(c, it.text ?? "", L.list.x + 8, ry + it.h / 2, it.h * 0.6, "#6f7ba6", "left");
          continue;
        }

        const rx = L.list.x + 6;
        const rw = L.list.w - 12;
        if (it.kind === "upgrade" && it.up) {
          const u = it.up;
          const afford = s.coins >= u.cost;
          c.fillStyle = afford ? "rgba(126,217,87,0.16)" : "rgba(255,255,255,0.04)";
          roundRect(c, rx, ry, rw, it.h, 10);
          c.fill();
          c.strokeStyle = afford ? "#7ed957" : "rgba(255,255,255,0.08)";
          c.lineWidth = afford ? 2 : 1;
          roundRect(c, rx, ry, rw, it.h, 10);
          c.stroke();
          drawText(c, u.name, rx + 14, ry + it.h * 0.34, it.h * 0.24, "#fff", "left");
          drawText(c, u.desc, rx + 14, ry + it.h * 0.68, it.h * 0.2, "#9fb0e0", "left");
          drawText(
            c,
            fmt(u.cost),
            rx + rw - 14,
            ry + it.h / 2,
            it.h * 0.26,
            afford ? "#ffd23a" : "#ff6b6b",
            "right",
          );
        } else if (it.kind === "gen" && it.idx !== undefined) {
          const i = it.idx;
          const def2 = GENS[i];
          const locked = genLocked(i);
          const cost = genCost(i);
          const afford = !locked && s.coins >= cost;
          c.fillStyle = "rgba(255,255,255,0.04)";
          roundRect(c, rx, ry, rw, it.h, 10);
          c.fill();
          c.strokeStyle = afford ? def2.color : "rgba(255,255,255,0.08)";
          c.lineWidth = afford ? 2 : 1;
          roundRect(c, rx, ry, rw, it.h, 10);
          c.stroke();

          // icon chip
          const chip = it.h * 0.62;
          c.fillStyle = locked ? "rgba(255,255,255,0.06)" : def2.color;
          roundRect(c, rx + 8, ry + (it.h - chip) / 2, chip, chip, 8);
          c.fill();
          drawText(c, locked ? "🔒" : def2.icon, rx + 8 + chip / 2, ry + it.h / 2, chip * 0.5, "#1a1300");

          const tx = rx + 8 + chip + 12;
          drawText(
            c,
            `${def2.name}  x${s.gens[i]}`,
            tx,
            ry + it.h * 0.32,
            it.h * 0.24,
            locked ? "rgba(255,255,255,0.5)" : "#fff",
            "left",
          );
          const each = def2.rate * prodMult() * prestigeMult();
          drawText(
            c,
            locked ? "Unlock previous tier" : `+${fmt(each)}/s each  -  total ${fmt(s.gens[i] * each)}/s`,
            tx,
            ry + it.h * 0.68,
            it.h * 0.19,
            "#9fb0e0",
            "left",
          );
          if (!locked)
            drawText(
              c,
              fmt(cost),
              rx + rw - 14,
              ry + it.h / 2,
              it.h * 0.26,
              afford ? "#ffd23a" : "#ff6b6b",
              "right",
            );
        }
      }

      // scroll indicator
      if (maxScroll > 0) {
        const trackH = L.list.h;
        const thumbH = Math.max(20, (L.list.h / contentH) * trackH);
        const ty = L.list.y + (scrollY / maxScroll) * (trackH - thumbH);
        c.fillStyle = "rgba(255,255,255,0.18)";
        roundRect(c, L.list.x + L.list.w - 5, ty, 3, thumbH, 1.5);
        c.fill();
      }
      c.restore();

      // ---- coin fx (above everything except popup) ----
      for (const f of coinFx) {
        c.globalAlpha = clamp(f.t, 0, 1);
        drawText(c, f.text, f.x, f.y, Math.min(w, h) * 0.04, "#ffe79a");
        c.globalAlpha = 1;
      }

      // ---- bottom buttons ----
      const gain = prestigeGain();
      const canPrestige = gain >= 1;
      c.fillStyle = canPrestige ? "#a16bff" : "rgba(255,255,255,0.1)";
      roundRect(c, L.prestigeBtn.x, L.prestigeBtn.y, L.prestigeBtn.w, L.prestigeBtn.h, 10);
      c.fill();
      drawText(
        c,
        prestigeConfirm > 0
          ? `Confirm? +${gain}pp`
          : canPrestige
            ? `Prestige +${gain}pp`
            : `Prestige (${fmt(PRESTIGE_REQ)})`,
        L.prestigeBtn.x + L.prestigeBtn.w / 2,
        L.prestigeBtn.y + L.prestigeBtn.h / 2,
        L.prestigeBtn.h * 0.32,
        canPrestige ? "#fff" : "rgba(255,255,255,0.5)",
      );

      c.fillStyle = "#3aa6ff";
      roundRect(c, L.submitBtn.x, L.submitBtn.y, L.submitBtn.w, L.submitBtn.h, 10);
      c.fill();
      drawText(
        c,
        "Submit Score",
        L.submitBtn.x + L.submitBtn.w / 2,
        L.submitBtn.y + L.submitBtn.h / 2,
        L.submitBtn.h * 0.32,
        "#04223f",
      );

      // ---- offline popup ----
      if (offlinePopup) {
        c.fillStyle = "rgba(6,10,20,0.78)";
        c.fillRect(0, 0, w, h);
        const pw = Math.min(w * 0.84, 360);
        const ph = Math.min(h * 0.4, 240);
        const px = w / 2 - pw / 2;
        const py = h / 2 - ph / 2;
        c.fillStyle = "#16203a";
        roundRect(c, px, py, pw, ph, 16);
        c.fill();
        c.strokeStyle = "#ffd23a";
        c.lineWidth = 2;
        roundRect(c, px, py, pw, ph, 16);
        c.stroke();
        drawText(c, "Welcome back!", w / 2, py + ph * 0.22, Math.min(w, h) * 0.05, "#ffd23a");
        drawText(
          c,
          "While you were away",
          w / 2,
          py + ph * 0.42,
          Math.min(w, h) * 0.035,
          "#9fb0e0",
        );
        drawText(
          c,
          `you earned ${fmt(offlinePopup.amount)}`,
          w / 2,
          py + ph * 0.56,
          Math.min(w, h) * 0.055,
          "#7ed957",
        );
        drawText(
          c,
          `(${fmtTime(offlinePopup.secs)} idle)`,
          w / 2,
          py + ph * 0.7,
          Math.min(w, h) * 0.032,
          "#9fb0e0",
        );
        drawText(
          c,
          "tap to collect",
          w / 2,
          py + ph * 0.87,
          Math.min(w, h) * 0.035,
          "rgba(255,255,255,0.6)",
        );
      }
    },

    destroy() {
      ctx.canvas.removeEventListener("wheel", onWheel);
      persist();
    },
  };
}
