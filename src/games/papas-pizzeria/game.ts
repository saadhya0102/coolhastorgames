import type { GameContext, GameInstance, Rect } from "@/engine";
import { clamp, dist, lerp, pointInRect, roundRect } from "@/engine";
import {
  PALETTE,
  TOPPINGS,
  TOPPING_ORDER,
  TUNING,
  UPGRADES,
  UPGRADE_ORDER,
  emptyUpgrades,
  makeDayProfile,
  upgradeCost,
} from "./config";
import { Particles } from "./particles";
import { drawPizza, drawTopping } from "./pizza";
import { drawCustomer, generateOrder, makeCustomer, moodFromPatience } from "./customer";
import { drawKitchen } from "./kitchen";
import {
  Sfx,
  drawBadge,
  drawBar,
  drawButton,
  drawPanel,
  drawStars,
  mix,
  tapped,
  text,
} from "./ui";
import type {
  Customer,
  DayProfile,
  GameState,
  PizzaScore,
  PlacedItem,
  SaveData,
  Station,
  Ticket,
  ToppingId,
  UpgradeId,
} from "./types";

const SAVE_KEY = "save";
const STATIONS: Station[] = ["orders", "build", "oven", "serve"];
const STATION_LABEL: Record<Station, string> = {
  orders: "Orders",
  build: "Build",
  oven: "Oven",
  serve: "Serve",
};
const DRAG_THRESHOLD = 9;
const MAX_WAITING = 4;

export class PizzaGame implements GameInstance {
  private gx: GameContext;
  private c: CanvasRenderingContext2D;
  private sfx: Sfx;
  private fx = new Particles();

  private state: GameState = "title";
  private station: Station = "orders";
  private save: SaveData;
  private profile: DayProfile;

  private tickets: Ticket[] = [];
  private ticketSeq = 1;
  private spawnLeft = 0;
  private arrivalTimer = 0;
  private servedToday = 0;
  private walkoutsToday = 0;
  private earnedToday = 0;
  private dayPassed = false;

  private selectedBuild: number | null = null;
  private selectedCut: number | null = null;
  private heldTopping: ToppingId | null = null;
  private drag: { id: ToppingId; x: number; y: number } | null = null;
  private downX = 0;
  private downY = 0;
  private downTrayId: ToppingId | null = null;
  private cutStart: { x: number; y: number } | null = null;

  private t = 0;
  private displayCash = 0;
  private shake = 0;
  private intro = 0; // dayStart card slide
  private flashStation: Partial<Record<Station, number>> = {};

  // cached layout
  private W = 0;
  private H = 0;
  private hud: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private stage: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private tabBar: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private tabRects: Rect[] = [];
  private muteRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(gx: GameContext) {
    this.gx = gx;
    this.c = gx.ctx;
    this.sfx = new Sfx(gx.audio);
    this.save = this.load();
    this.profile = makeDayProfile(this.save.day);
    this.displayCash = this.save.money;
    gx.requestControls([]);
    this.report();
    this.gx.setStatus("Tap to start your shift");
  }

  // ---------------------------------------------------------------- persistence
  private defaultSave(): SaveData {
    return {
      money: 0,
      earned: 0,
      day: 1,
      best: 0,
      upgrades: emptyUpgrades(),
      lifetimeServed: 0,
      lifetimeTips: 0,
    };
  }

  private load(): SaveData {
    const d = this.defaultSave();
    const s = this.gx.storage.get<SaveData>(SAVE_KEY, d);
    // merge to be resilient to older saves
    return {
      money: s.money ?? 0,
      earned: s.earned ?? 0,
      day: s.day ?? 1,
      best: s.best ?? 0,
      upgrades: { ...emptyUpgrades(), ...(s.upgrades ?? {}) },
      lifetimeServed: s.lifetimeServed ?? 0,
      lifetimeTips: s.lifetimeTips ?? 0,
    };
  }

  private persist(): void {
    this.gx.storage.set(SAVE_KEY, this.save);
  }

  private report(): void {
    if (this.save.earned > this.save.best) {
      this.save.best = this.save.earned;
      this.gx.storage.submitScore(this.save.earned, false);
    }
    this.gx.reportScore(Math.round(this.save.earned));
  }

  private up(id: UpgradeId): number {
    return this.save.upgrades[id];
  }

  // ---------------------------------------------------------------- layout
  private ensureLayout(): void {
    this.W = this.gx.width;
    this.H = this.gx.height;
    const W = this.W;
    const H = this.H;
    const hudH = clamp(H * 0.092, 44, 76);
    const tabH = clamp(H * 0.11, 52, 92);
    this.hud = { x: 0, y: 0, w: W, h: hudH };
    this.tabBar = { x: 0, y: H - tabH, w: W, h: tabH };
    this.stage = { x: 0, y: hudH, w: W, h: H - hudH - tabH };

    const n = STATIONS.length;
    const pad = W * 0.012;
    const tw = (W - pad * (n + 1)) / n;
    this.tabRects = STATIONS.map((_, i) => ({
      x: pad + i * (tw + pad),
      y: this.tabBar.y + this.tabBar.h * 0.12,
      w: tw,
      h: this.tabBar.h * 0.76,
    }));

    const ms = hudH * 0.62;
    this.muteRect = { x: W - ms - hudH * 0.25, y: hudH * 0.5 - ms / 2, w: ms, h: ms };
  }

  private get u(): number {
    return clamp(Math.min(this.W, this.H) * 0.045, 11, 30);
  }

  // ---------------------------------------------------------------- lifecycle
  update(dt: number): void {
    const d = Math.min(dt, 0.05);
    this.t += d;
    this.ensureLayout();
    this.fx.update(d);
    this.displayCash = lerp(this.displayCash, this.save.money, 1 - Math.pow(0.0001, d));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - d * 2.5);
    if (this.intro > 0) this.intro = Math.max(0, this.intro - d * 1.8);
    for (const k of STATIONS) {
      const v = this.flashStation[k];
      if (v && v > 0) this.flashStation[k] = Math.max(0, v - d);
    }

    const input = this.gx.input;
    // mute toggle always available
    if (tapped(input, this.muteRect)) {
      this.gx.audio.setMuted(!this.gx.audio.muted);
      this.sfx.tap();
    }

    switch (this.state) {
      case "title":
        this.updateTitle();
        break;
      case "dayStart":
        this.updateDayStart();
        break;
      case "play":
        this.updatePlay(d);
        break;
      case "dayEnd":
        this.updateDayEnd();
        break;
      case "shop":
        this.updateShop();
        break;
      case "over":
        this.updateOver();
        break;
    }
  }

  render(): void {
    this.ensureLayout();
    const c = this.c;
    c.save();
    if (this.shake > 0) {
      c.translate((Math.random() - 0.5) * this.shake * 14, (Math.random() - 0.5) * this.shake * 14);
    }
    const bgStation = this.state === "play" ? this.station : "orders";
    drawKitchen(c, this.W, this.H, this.t, bgStation);

    switch (this.state) {
      case "title":
        this.renderTitle();
        break;
      case "dayStart":
        this.renderPlay();
        this.renderDayStart();
        break;
      case "play":
        this.renderPlay();
        break;
      case "dayEnd":
        this.renderDayEnd();
        break;
      case "shop":
        this.renderShop();
        break;
      case "over":
        this.renderOver();
        break;
    }

    this.fx.draw(c);
    // dragged topping ghost
    if (this.drag) {
      const r = this.u * 1.1;
      c.globalAlpha = 0.92;
      drawTopping(c, this.drag.x, this.drag.y, r, TOPPINGS[this.drag.id], this.t * 2, 0);
      c.globalAlpha = 1;
    }
    c.restore();
  }

  resize(): void {
    this.ensureLayout();
  }

  destroy(): void {
    this.persist();
  }

  // ---------------------------------------------------------------- title
  private titleButtons(): { play: Rect; fresh: Rect } {
    const W = this.W;
    const H = this.H;
    const bw = clamp(W * 0.5, 200, 360);
    const bh = clamp(H * 0.09, 46, 72);
    const cx = W / 2;
    const y = H * 0.62;
    return {
      play: { x: cx - bw / 2, y, w: bw, h: bh },
      fresh: { x: cx - bw / 2, y: y + bh * 1.3, w: bw, h: bh },
    };
  }

  private hasRun(): boolean {
    return this.save.day > 1 || this.save.earned > 0;
  }

  private updateTitle(): void {
    const input = this.gx.input;
    const { play, fresh } = this.titleButtons();
    if (tapped(input, play) || input.pressed("Space", "Enter")) {
      this.sfx.tap();
      if (!this.hasRun()) this.startNewRun();
      this.beginDay();
    }
    if (this.hasRun() && tapped(input, fresh)) {
      this.sfx.tap();
      this.startNewRun();
      this.beginDay();
    }
  }

  private startNewRun(): void {
    const best = this.save.best;
    this.save = { ...this.defaultSave(), best };
    this.profile = makeDayProfile(1);
    this.displayCash = 0;
    this.persist();
    this.report();
  }

  private renderTitle(): void {
    const c = this.c;
    const W = this.W;
    const H = this.H;
    const cx = W / 2;

    // big pizza emblem
    drawPizza(c, cx, H * 0.3, Math.min(W, H) * 0.16, {
      placed: this.titlePizza(),
      bake: 0.7,
      premiumSauce: true,
      t: this.t,
    });

    text(c, "PIZZA PALACE", cx, H * 0.5, this.u * 2.1, PALETTE.tomato, "center", "800");
    text(c, "Take orders · top · bake · slice · serve", cx, H * 0.5 + this.u * 1.7, this.u * 0.86, PALETTE.inkSoft);

    const { play, fresh } = this.titleButtons();
    drawButton(c, play, this.hasRun() ? `Continue — Day ${this.save.day}` : "Start Shift", {
      style: "primary",
      pressed: pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, play) && this.gx.input.pointer.down,
    });
    if (this.hasRun()) {
      drawButton(c, fresh, "New Shift", {
        style: "secondary",
        pressed: pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, fresh) && this.gx.input.pointer.down,
      });
    }
    text(c, `Best: $${Math.round(this.save.best)}`, cx, H * 0.92, this.u, PALETTE.inkSoft, "center", "800");
    this.drawMute();
  }

  private titlePizza(): PlacedItem[] {
    const out: PlacedItem[] = [];
    const ids: ToppingId[] = ["pepperoni", "mushroom", "pepper", "olive"];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.39996;
      const r = Math.min(0.85, 0.2 + 0.12 * Math.sqrt(i + 1));
      out.push({ id: ids[i % ids.length], x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a, pop: 1 });
    }
    return out;
  }

  // ---------------------------------------------------------------- day flow
  private beginDay(): void {
    this.profile = makeDayProfile(this.save.day);
    this.tickets = [];
    this.spawnLeft = this.profile.customers;
    this.arrivalTimer = 0.4;
    this.servedToday = 0;
    this.walkoutsToday = 0;
    this.earnedToday = 0;
    this.dayPassed = false;
    this.selectedBuild = null;
    this.selectedCut = null;
    this.heldTopping = null;
    this.station = "orders";
    this.state = "dayStart";
    this.intro = 1;
    this.fx.clear();
  }

  private updateDayStart(): void {
    const input = this.gx.input;
    if (input.pointer.justUp || input.pressed("Space", "Enter")) {
      this.sfx.tap();
      this.state = "play";
      this.gx.setStatus(`Day ${this.profile.day} — serve them fast!`);
    }
  }

  private renderDayStart(): void {
    const c = this.c;
    c.fillStyle = "rgba(40,24,14,0.45)";
    c.fillRect(0, 0, this.W, this.H);
    const w = clamp(this.W * 0.8, 260, 460);
    const h = clamp(this.H * 0.5, 220, 360);
    const x = (this.W - w) / 2;
    const yBase = (this.H - h) / 2;
    const y = yBase - this.intro * this.H * 0.5;
    drawPanel(c, { x, y, w, h }, { radius: 18 });
    const cx = this.W / 2;
    text(c, `DAY ${this.profile.day}`, cx, y + h * 0.16, this.u * 1.9, PALETTE.tomato, "center", "800");
    text(c, `${this.profile.customers} customers coming in`, cx, y + h * 0.36, this.u * 0.95, PALETTE.ink);
    text(c, `Rent due: $${this.profile.quota}`, cx, y + h * 0.5, this.u * 1.05, PALETTE.accent, "center", "800");
    text(c, `Patience is ${this.profile.patience | 0}s · slices up to ${Math.max(...this.profile.sliceChoices)}`, cx, y + h * 0.64, this.u * 0.8, PALETTE.inkSoft);
    text(c, "Tap to open the doors", cx, y + h * 0.86, this.u * 0.9, PALETTE.inkSoft, "center", "800");
  }

  // ---------------------------------------------------------------- play
  private activeTickets(): Ticket[] {
    return this.tickets.filter((t) => t.status !== "served" && t.status !== "left");
  }

  private patienceMaxValue(): number {
    return this.profile.patience * (1 + this.up("seats") * 0.18);
  }

  private updatePlay(dt: number): void {
    const input = this.gx.input;

    // station tabs
    for (let i = 0; i < this.tabRects.length; i++) {
      if (tapped(input, this.tabRects[i])) {
        this.station = STATIONS[i];
        this.sfx.tap();
      }
    }
    if (input.pressed("1")) this.station = "orders";
    if (input.pressed("2")) this.station = "build";
    if (input.pressed("3")) this.station = "oven";
    if (input.pressed("4")) this.station = "serve";

    // spawning
    if (this.spawnLeft > 0) {
      this.arrivalTimer -= dt;
      const waiting = this.tickets.filter((t) => t.status === "waiting").length;
      if (this.arrivalTimer <= 0 && waiting < MAX_WAITING) {
        this.spawnCustomer();
        this.arrivalTimer = this.profile.arrivalInterval;
      }
    }

    // patience drain + bake progress
    const decorFactor = 1 - this.up("decor") * 0.12;
    const bakeDur = TUNING.bakeDuration * (1 + this.up("oven_speed") * 0.4);
    for (const tk of this.tickets) {
      if (tk.status === "served" || tk.status === "left") {
        tk.reactionT -= dt;
        continue;
      }
      tk.customer.patience -= dt * decorFactor;
      if (tk.customer.patience <= 0) {
        this.walkout(tk);
        continue;
      }
      if (tk.status === "baking" && tk.baking) {
        tk.bake = Math.min(1, tk.bake + dt / bakeDur);
        if (tk.bake > 0.9 && Math.random() < dt * 6) {
          const slot = tk.ovenSlot ?? 0;
          const pos = this.ovenSlotCenter(slot);
          if (pos) this.fx.puff(pos.x, pos.y - pos.r * 0.6, "rgba(60,40,30,0.5)", 1, pos.r * 0.4);
        }
      }
      // settle topping pops
      for (const p of tk.placed) {
        if (p.pop < 1) p.pop = Math.min(1, p.pop + dt * (3 + this.up("tray_quick")));
      }
    }

    // remove finished reaction tickets
    this.tickets = this.tickets.filter((t) => !((t.status === "served" || t.status === "left") && t.reactionT <= 0));

    // station-specific input
    switch (this.station) {
      case "orders":
        this.updateOrders();
        break;
      case "build":
        this.updateBuild();
        break;
      case "oven":
        this.updateOven();
        break;
      case "serve":
        this.updateServe();
        break;
    }

    // day end check
    if (this.spawnLeft === 0 && this.activeTickets().length === 0 && this.tickets.length === 0) {
      this.endDay();
    }
  }

  private spawnCustomer(): void {
    const pmax = this.patienceMaxValue();
    const seed = (this.save.day * 1000 + this.ticketSeq * 37 + ((Math.random() * 1e6) | 0)) >>> 0;
    const customer = makeCustomer(seed, pmax);
    const spec = generateOrder(this.profile, seed);
    this.tickets.push({
      id: this.ticketSeq++,
      customer,
      spec,
      status: "waiting",
      placed: [],
      bake: 0,
      baking: false,
      pulledBake: null,
      cuts: [],
      ovenSlot: null,
      score: null,
      reactionT: 0,
    });
    this.spawnLeft--;
    this.sfx.bell();
    this.flashStation.orders = 0.8;
  }

  private walkout(tk: Ticket): void {
    tk.status = "left";
    tk.reactionT = 1.1;
    this.walkoutsToday++;
    this.shake = 0.8;
    this.sfx.angry();
    if (this.selectedBuild === tk.id) this.selectedBuild = null;
    if (this.selectedCut === tk.id) this.selectedCut = null;
  }

  // -------------------------------------------------- ORDERS station
  private orderCardRects(): { tk: Ticket; card: Rect; take: Rect }[] {
    const waiting = this.tickets.filter((t) => t.status === "waiting");
    const area = this.workArea();
    const n = Math.max(1, waiting.length);
    const gap = area.w * 0.02;
    const cw = Math.min((area.w - gap * (n + 1)) / n, area.w * 0.32);
    const ch = area.h * 0.92;
    const totalW = cw * waiting.length + gap * (waiting.length - 1);
    let x = area.x + (area.w - totalW) / 2;
    const y = area.y + (area.h - ch) / 2;
    const out: { tk: Ticket; card: Rect; take: Rect }[] = [];
    for (const tk of waiting) {
      const card: Rect = { x, y, w: cw, h: ch };
      const take: Rect = { x: x + cw * 0.12, y: y + ch - ch * 0.18, w: cw * 0.76, h: ch * 0.13 };
      out.push({ tk, card, take });
      x += cw + gap;
    }
    return out;
  }

  private updateOrders(): void {
    const input = this.gx.input;
    const cards = this.orderCardRects();
    for (const { tk, card, take } of cards) {
      if (tapped(input, take) || (tapped(input, card) && !pointInRect(input.pointer.x, input.pointer.y, take))) {
        this.takeOrder(tk);
        break;
      }
    }
    if (input.pressed("Space", "Enter") && cards.length > 0) this.takeOrder(cards[0].tk);
  }

  private takeOrder(tk: Ticket): void {
    tk.status = "building";
    this.selectedBuild = tk.id;
    this.sfx.pop();
    this.flashStation.build = 0.8;
    this.station = "build";
  }

  // -------------------------------------------------- BUILD station
  private buildLayout() {
    const area = this.workArea();
    const listW = clamp(area.w * 0.22, 70, 150);
    const list: Rect = { x: area.x, y: area.y, w: listW, h: area.h };
    const main: Rect = { x: area.x + listW + 8, y: area.y, w: area.w - listW - 8, h: area.h };
    const barH = clamp(main.h * 0.13, 34, 54);
    const bar: Rect = { x: main.x, y: main.y, w: main.w, h: barH };
    const trayH = clamp(main.h * 0.2, 52, 96);
    const tray: Rect = { x: main.x, y: main.y + main.h - trayH, w: main.w, h: trayH };
    const pizArea: Rect = { x: main.x, y: bar.y + bar.h, w: main.w, h: tray.y - (bar.y + bar.h) };
    const R = Math.min(pizArea.w, pizArea.h) * 0.42;
    const cx = pizArea.x + pizArea.w / 2;
    const cy = pizArea.y + pizArea.h / 2;
    const btnW = bar.w * 0.2;
    const bake: Rect = { x: bar.x + bar.w - btnW, y: bar.y + bar.h * 0.06, w: btnW, h: bar.h * 0.88 };
    const trash: Rect = { x: bar.x + bar.w - btnW * 2.12, y: bar.y + bar.h * 0.06, w: btnW, h: bar.h * 0.88 };
    return { list, main, bar, tray, R, cx, cy, bake, trash };
  }

  private trayCells(tray: Rect): { id: ToppingId; r: Rect }[] {
    const n = TOPPING_ORDER.length;
    const gap = tray.w * 0.006;
    const cw = (tray.w - gap * (n + 1)) / n;
    const out: { id: ToppingId; r: Rect }[] = [];
    let x = tray.x + gap;
    for (const id of TOPPING_ORDER) {
      out.push({ id, r: { x, y: tray.y + tray.h * 0.12, w: cw, h: tray.h * 0.76 } });
      x += cw + gap;
    }
    return out;
  }

  private buildTickets(): Ticket[] {
    return this.tickets.filter((t) => t.status === "building");
  }

  private currentBuild(): Ticket | null {
    const list = this.buildTickets();
    if (this.selectedBuild != null) {
      const f = list.find((t) => t.id === this.selectedBuild);
      if (f) return f;
    }
    return list[0] ?? null;
  }

  private updateBuild(): void {
    const input = this.gx.input;
    const lay = this.buildLayout();
    const list = this.buildTickets();

    // list selection
    const rowH = Math.min(lay.list.h / Math.max(list.length, 1), lay.list.h * 0.28);
    list.forEach((tk, i) => {
      const r: Rect = { x: lay.list.x, y: lay.list.y + i * (rowH + 4), w: lay.list.w, h: rowH };
      if (tapped(input, r)) {
        this.selectedBuild = tk.id;
        this.sfx.tap();
      }
    });

    const tk = this.currentBuild();
    if (tk) this.selectedBuild = tk.id;

    const cells = this.trayCells(lay.tray);
    const overPizza = (x: number, y: number) => dist(x, y, lay.cx, lay.cy) <= lay.R * 0.96;

    if (input.pointer.justDown) {
      this.downX = input.pointer.x;
      this.downY = input.pointer.y;
      this.downTrayId = null;
      this.drag = null;
      for (const cell of cells) {
        if (pointInRect(input.pointer.x, input.pointer.y, cell.r)) {
          this.downTrayId = cell.id;
          this.drag = { id: cell.id, x: input.pointer.x, y: input.pointer.y };
          break;
        }
      }
    }
    if (input.pointer.down && this.drag) {
      this.drag.x = input.pointer.x;
      this.drag.y = input.pointer.y;
    }

    if (input.pointer.justUp) {
      const moved = dist(this.downX, this.downY, input.pointer.x, input.pointer.y) > DRAG_THRESHOLD;
      const onPizza = overPizza(input.pointer.x, input.pointer.y);
      if (this.drag && tk) {
        if (onPizza) {
          this.placeTopping(tk, this.drag.id, input.pointer.x, input.pointer.y, lay.cx, lay.cy, lay.R);
        } else if (!moved) {
          this.heldTopping = this.heldTopping === this.drag.id ? null : this.drag.id;
          this.sfx.tap();
        }
      } else if (this.heldTopping && tk && onPizza) {
        this.placeTopping(tk, this.heldTopping, input.pointer.x, input.pointer.y, lay.cx, lay.cy, lay.R);
      }
      this.drag = null;
    }

    if (tk) {
      const ovenFree = this.freeOvenSlot() != null;
      if (tapped(input, lay.bake) && ovenFree) this.sendToOven(tk);
      if (tapped(input, lay.trash)) {
        if (tk.placed.length > 0) {
          tk.placed.pop();
          this.sfx.tap();
        }
      }
      if (input.pressed("Enter") && ovenFree) this.sendToOven(tk);
    }
  }

  private placeTopping(tk: Ticket, id: ToppingId, px: number, py: number, cx: number, cy: number, R: number): void {
    if (tk.placed.length >= 60) return;
    const lx = clamp((px - cx) / R, -0.92, 0.92);
    const ly = clamp((py - cy) / R, -0.92, 0.92);
    tk.placed.push({ id, x: lx, y: ly, rot: Math.random() * Math.PI * 2, pop: 0 });
    this.sfx.pop();
    this.fx.burst(px, py, mix(TOPPINGS[id].color, "#fff", 0.3), 5, 90, { size: 3, life: 0.4, gravity: 300 });
  }

  private sendToOven(tk: Ticket): void {
    const slot = this.freeOvenSlot();
    if (slot == null) return;
    tk.status = "baking";
    tk.baking = true;
    tk.bake = 0;
    tk.ovenSlot = slot;
    this.sfx.whoosh();
    this.flashStation.oven = 0.8;
    if (this.selectedBuild === tk.id) this.selectedBuild = null;
    this.station = "oven";
  }

  // -------------------------------------------------- OVEN station
  private ovenSlots(): number {
    return 1 + this.up("oven_slots");
  }

  private freeOvenSlot(): number | null {
    const used = new Set(this.tickets.filter((t) => t.status === "baking").map((t) => t.ovenSlot));
    for (let i = 0; i < this.ovenSlots(); i++) if (!used.has(i)) return i;
    return null;
  }

  private ovenSlotRects(): Rect[] {
    const area = this.workArea();
    const n = this.ovenSlots();
    const gap = area.w * 0.03;
    const cw = Math.min((area.w - gap * (n + 1)) / n, area.w * 0.5);
    const ch = Math.min(area.h * 0.9, cw * 1.35);
    const totalW = cw * n + gap * (n - 1);
    let x = area.x + (area.w - totalW) / 2;
    const y = area.y + (area.h - ch) / 2;
    const out: Rect[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ x, y, w: cw, h: ch });
      x += cw + gap;
    }
    return out;
  }

  private ovenSlotCenter(slot: number): { x: number; y: number; r: number } | null {
    const rects = this.ovenSlotRects();
    const r = rects[slot];
    if (!r) return null;
    return { x: r.x + r.w / 2, y: r.y + r.h * 0.4, r: Math.min(r.w, r.h) * 0.32 };
  }

  private updateOven(): void {
    const input = this.gx.input;
    const rects = this.ovenSlotRects();
    let best: Ticket | null = null;
    for (let i = 0; i < rects.length; i++) {
      const tk = this.tickets.find((t) => t.status === "baking" && t.ovenSlot === i);
      if (!tk) continue;
      if (!best || tk.bake > best.bake) best = tk;
      const r = rects[i];
      const pull: Rect = { x: r.x + r.w * 0.15, y: r.y + r.h * 0.82, w: r.w * 0.7, h: r.h * 0.14 };
      if (tapped(input, pull) || tapped(input, { x: r.x, y: r.y, w: r.w, h: r.h * 0.8 })) {
        this.pullPizza(tk);
        return;
      }
    }
    if (input.pressed("Space", "Enter") && best) this.pullPizza(best);
  }

  private pullPizza(tk: Ticket): void {
    tk.baking = false;
    tk.pulledBake = tk.bake;
    tk.status = "cutting";
    tk.ovenSlot = null;
    const quality = this.bakeScore(tk.pulledBake, tk.spec.bake.lo, tk.spec.bake.hi);
    this.sfx.sizzle(quality);
    this.flashStation.serve = 0.8;
    const c = this.ovenSlotCenterForCurrent();
    if (c) this.fx.puff(c.x, c.y, "rgba(220,220,220,0.6)", 6, c.r);
    if (this.selectedCut == null) this.selectedCut = tk.id;
    this.station = "serve";
  }

  private ovenSlotCenterForCurrent(): { x: number; y: number; r: number } | null {
    const area = this.workArea();
    return { x: area.x + area.w / 2, y: area.y + area.h / 2, r: Math.min(area.w, area.h) * 0.2 };
  }

  // -------------------------------------------------- SERVE station
  private serveLayout() {
    const area = this.workArea();
    const listW = clamp(area.w * 0.22, 70, 150);
    const list: Rect = { x: area.x, y: area.y, w: listW, h: area.h };
    const main: Rect = { x: area.x + listW + 8, y: area.y, w: area.w - listW - 8, h: area.h };
    const barH = clamp(main.h * 0.13, 34, 54);
    const bar: Rect = { x: main.x, y: main.y, w: main.w, h: barH };
    const pizArea: Rect = { x: main.x, y: bar.y + bar.h, w: main.w, h: main.h - barH };
    const R = Math.min(pizArea.w, pizArea.h) * 0.43;
    const cx = pizArea.x + pizArea.w / 2;
    const cy = pizArea.y + pizArea.h / 2;
    const btnW = bar.w * 0.22;
    const serve: Rect = { x: bar.x + bar.w - btnW, y: bar.y + bar.h * 0.06, w: btnW, h: bar.h * 0.88 };
    const undo: Rect = { x: bar.x + bar.w - btnW * 2.12, y: bar.y + bar.h * 0.06, w: btnW, h: bar.h * 0.88 };
    return { list, main, bar, pizArea, R, cx, cy, serve, undo };
  }

  private cutTickets(): Ticket[] {
    return this.tickets.filter((t) => t.status === "cutting");
  }

  private currentCut(): Ticket | null {
    const list = this.cutTickets();
    if (this.selectedCut != null) {
      const f = list.find((t) => t.id === this.selectedCut);
      if (f) return f;
    }
    return list[0] ?? null;
  }

  private updateServe(): void {
    const input = this.gx.input;
    const lay = this.serveLayout();
    const list = this.cutTickets();

    const rowH = Math.min(lay.list.h / Math.max(list.length, 1), lay.list.h * 0.28);
    list.forEach((tk, i) => {
      const r: Rect = { x: lay.list.x, y: lay.list.y + i * (rowH + 4), w: lay.list.w, h: rowH };
      if (tapped(input, r)) {
        this.selectedCut = tk.id;
        this.sfx.tap();
      }
    });

    const tk = this.currentCut();
    if (tk) this.selectedCut = tk.id;

    const overPizza = (x: number, y: number) => dist(x, y, lay.cx, lay.cy) <= lay.R * 1.0;

    if (input.pointer.justDown && tk && overPizza(input.pointer.x, input.pointer.y)) {
      this.cutStart = { x: input.pointer.x, y: input.pointer.y };
    }
    if (input.pointer.justUp && this.cutStart && tk) {
      const dx = input.pointer.x - this.cutStart.x;
      const dy = input.pointer.y - this.cutStart.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD * 1.5) {
        this.addCut(tk, Math.atan2(dy, dx));
      }
      this.cutStart = null;
    }

    if (tk) {
      if (tapped(input, lay.serve) || input.pressed("Space", "Enter")) this.serve(tk);
      if (tapped(input, lay.undo)) {
        if (tk.cuts.length > 0) {
          tk.cuts.pop();
          this.sfx.tap();
        }
      }
    }
  }

  private addCut(tk: Ticket, ang: number): void {
    let a = ang % Math.PI;
    if (a < 0) a += Math.PI;
    for (const e of tk.cuts) {
      const diff = Math.abs(e - a);
      if (Math.min(diff, Math.PI - diff) < 0.12) return; // too close to an existing cut
    }
    tk.cuts.push(a);
    this.sfx.slice();
    const lay = this.serveLayout();
    this.fx.burst(lay.cx, lay.cy, "#fff6d0", 6, 140, { size: 3, life: 0.35, gravity: 200 });
  }

  private serve(tk: Ticket): void {
    const score = this.computeScore(tk);
    tk.score = score;
    tk.status = "served";
    tk.reactionT = 1.2;
    this.save.money += score.pay + score.tip;
    this.save.earned += score.pay + score.tip;
    this.earnedToday += score.pay + score.tip;
    this.save.lifetimeServed++;
    this.save.lifetimeTips += score.tip;
    this.servedToday++;
    this.report();
    this.persist();
    if (this.selectedCut === tk.id) this.selectedCut = null;

    const lay = this.serveLayout();
    this.sfx.serve(score.stars);
    if (score.stars >= 4) this.sfx.cash();
    this.fx.floatText(lay.cx, lay.cy - lay.R, `+$${score.pay + score.tip}`, PALETTE.green, this.u * 1.4);
    this.fx.burst(lay.cx, lay.cy, PALETTE.accent2, 18, 240, { shape: 2, size: 6, life: 0.8, gravity: 260 });
    for (let i = 0; i < score.stars; i++) {
      this.fx.spawn({ x: lay.cx + (i - 2) * this.u, y: lay.cy - lay.R * 1.2, vx: 0, vy: -60, color: PALETTE.accent2, shape: 2, size: this.u * 0.5, life: 0.9, gravity: 120 });
    }
  }

  // -------------------------------------------------- scoring
  private bakeScore(p: number, lo: number, hi: number): number {
    if (p >= lo && p <= hi) return 1;
    const d = p < lo ? lo - p : p - hi;
    const tol = TUNING.bakeTolerance + this.up("oven_speed") * 0.035;
    return clamp(1 - d / tol, 0, 1);
  }

  private computeScore(tk: Ticket): PizzaScore {
    // topping accuracy
    const req = new Map<ToppingId, number>();
    for (const r of tk.spec.toppings) req.set(r.id, r.count);
    const placed = new Map<ToppingId, number>();
    for (const p of tk.placed) placed.set(p.id, (placed.get(p.id) ?? 0) + 1);

    let sum = 0;
    for (const [id, count] of req) {
      const have = placed.get(id) ?? 0;
      sum += 1 - clamp(Math.abs(have - count) / count, 0, 1);
    }
    let toppingBase = req.size > 0 ? sum / req.size : 1;
    let wrong = 0;
    for (const [id, count] of placed) if (!req.has(id)) wrong += count;
    toppingBase -= wrong * 0.06;
    // spread bonus
    if (tk.placed.length > 2) {
      let mx = 0;
      let my = 0;
      for (const p of tk.placed) {
        mx += p.x;
        my += p.y;
      }
      mx /= tk.placed.length;
      my /= tk.placed.length;
      let spread = 0;
      for (const p of tk.placed) spread += Math.hypot(p.x - mx, p.y - my);
      spread /= tk.placed.length;
      toppingBase += clamp(spread, 0, 0.6) * 0.1;
    }
    if (this.up("sauce_auto") > 0) toppingBase += 0.04;
    const topping = clamp(toppingBase, 0, 1);

    // bake
    const bake = this.bakeScore(tk.pulledBake ?? 0, tk.spec.bake.lo, tk.spec.bake.hi);

    // cut
    const required = Math.max(1, Math.round(tk.spec.slices / 2));
    let cut = 0;
    if (tk.cuts.length > 0) {
      const countDiff = Math.abs(tk.cuts.length - required);
      const countScore = clamp(1 - countDiff * 0.34, 0, 1);
      const sorted = [...tk.cuts].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const next = i === sorted.length - 1 ? sorted[0] + Math.PI : sorted[i + 1];
        gaps.push(next - sorted[i]);
      }
      const ideal = Math.PI / sorted.length;
      let variance = 0;
      for (const g of gaps) variance += (g - ideal) * (g - ideal);
      variance /= gaps.length;
      const std = Math.sqrt(variance);
      const forgive = 1 - this.up("cutter") * 0.18;
      const evenScore = clamp(1 - (std / ideal) * forgive, 0, 1);
      cut = 0.55 * countScore + 0.45 * evenScore;
    }

    const overall = clamp(0.42 * topping + 0.33 * bake + 0.25 * cut, 0, 1);
    const stars = Math.round(overall * 5);
    const basePay = TUNING.basePrice + this.profile.day * TUNING.pricePerDay;
    const pay = Math.round(basePay * (TUNING.payFloor + (1 - TUNING.payFloor) * overall));
    const patienceRem = clamp(tk.customer.patience / tk.customer.patienceMax, 0, 1);
    const tipMult = 1 + this.up("marketing") * 0.25;
    const tip = Math.round(basePay * TUNING.tipMax * overall * (0.5 + 0.5 * patienceRem) * tipMult);
    return { topping, bake, cut, overall, stars, pay, tip };
  }

  // -------------------------------------------------- end of day
  private endDay(): void {
    this.dayPassed = this.earnedToday >= this.profile.quota;
    this.state = "dayEnd";
    this.persist();
    if (this.dayPassed) this.sfx.win();
    else this.sfx.fail();
  }

  private updateDayEnd(): void {
    const input = this.gx.input;
    const btn = this.dayEndButton();
    if (tapped(input, btn) || input.pressed("Space", "Enter")) {
      this.sfx.tap();
      if (this.dayPassed) {
        this.state = "shop";
      } else {
        this.gameOver();
      }
    }
  }

  private gameOver(): void {
    this.state = "over";
    this.report();
    this.persist();
    this.gx.gameOver(Math.round(this.save.earned));
  }

  private dayEndButton(): Rect {
    const w = clamp(this.W * 0.5, 200, 340);
    const h = clamp(this.H * 0.09, 46, 70);
    return { x: (this.W - w) / 2, y: this.H * 0.8, w, h };
  }

  private renderDayEnd(): void {
    const c = this.c;
    const cx = this.W / 2;
    const w = clamp(this.W * 0.84, 280, 520);
    const h = clamp(this.H * 0.62, 280, 460);
    const x = (this.W - w) / 2;
    const y = (this.H - h) / 2 - this.H * 0.04;
    drawPanel(c, { x, y, w, h }, { radius: 18 });

    text(c, this.dayPassed ? `Day ${this.profile.day} Complete!` : "Out of Business", cx, y + h * 0.12, this.u * 1.6, this.dayPassed ? PALETTE.green : PALETTE.red, "center", "800");

    const rows: [string, string][] = [
      ["Pizzas served", String(this.servedToday)],
      ["Walkouts", String(this.walkoutsToday)],
      ["Earned today", `$${this.earnedToday}`],
      ["Rent due", `$${this.profile.quota}`],
    ];
    let ry = y + h * 0.28;
    for (const [k, v] of rows) {
      text(c, k, x + w * 0.12, ry, this.u, PALETTE.inkSoft, "left");
      text(c, v, x + w * 0.88, ry, this.u, PALETTE.ink, "right", "800");
      ry += h * 0.1;
    }
    text(c, `Cash: $${Math.round(this.save.money)}`, cx, y + h * 0.74, this.u * 1.1, PALETTE.accent, "center", "800");

    const btn = this.dayEndButton();
    drawButton(c, btn, this.dayPassed ? "Go Shopping" : "End Run", {
      style: this.dayPassed ? "primary" : "danger",
      pressed: pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, btn) && this.gx.input.pointer.down,
    });
    this.drawMute();
  }

  // -------------------------------------------------- shop
  private shopCardRects(): { id: UpgradeId; r: Rect; buy: Rect }[] {
    const area: Rect = { x: this.W * 0.04, y: this.hud.h + this.H * 0.02, w: this.W * 0.92, h: this.H * 0.72 };
    const cols = this.W > this.H ? 4 : 2;
    const rows = Math.ceil(UPGRADE_ORDER.length / cols);
    const gap = area.w * 0.02;
    const cw = (area.w - gap * (cols - 1)) / cols;
    const ch = Math.min((area.h - gap * (rows - 1)) / rows, area.h * 0.46);
    const out: { id: UpgradeId; r: Rect; buy: Rect }[] = [];
    UPGRADE_ORDER.forEach((id, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = area.x + col * (cw + gap);
      const y = area.y + row * (ch + gap);
      const r: Rect = { x, y, w: cw, h: ch };
      const buy: Rect = { x: x + cw * 0.1, y: y + ch - ch * 0.26, w: cw * 0.8, h: ch * 0.2 };
      out.push({ id, r, buy });
    });
    return out;
  }

  private startDayButton(): Rect {
    const w = clamp(this.W * 0.4, 180, 300);
    const h = clamp(this.H * 0.08, 44, 64);
    return { x: (this.W - w) / 2, y: this.H - h - this.H * 0.02, w, h };
  }

  private updateShop(): void {
    const input = this.gx.input;
    for (const { id, buy } of this.shopCardRects()) {
      if (tapped(input, buy)) this.buyUpgrade(id);
    }
    const start = this.startDayButton();
    if (tapped(input, start) || input.pressed("Space", "Enter")) {
      this.sfx.tap();
      this.save.day++;
      this.persist();
      this.beginDay();
    }
  }

  private buyUpgrade(id: UpgradeId): void {
    const def = UPGRADES[id];
    const lvl = this.up(id);
    if (lvl >= def.maxLevel) return;
    const cost = upgradeCost(id, lvl);
    if (this.save.money < cost) {
      this.sfx.fail();
      return;
    }
    this.save.money -= cost;
    this.save.upgrades[id] = lvl + 1;
    this.sfx.buy();
    this.persist();
    this.report();
  }

  private renderShop(): void {
    const c = this.c;
    text(c, "Upgrade Shop", this.W / 2, this.hud.h * 0.55, this.u * 1.4, PALETTE.tomato, "center", "800");
    text(c, `Cash $${Math.round(this.save.money)}`, this.W - this.W * 0.04, this.hud.h * 0.55, this.u * 1.1, PALETTE.accent, "right", "800");

    for (const { id, r, buy } of this.shopCardRects()) {
      const def = UPGRADES[id];
      const lvl = this.up(id);
      const maxed = lvl >= def.maxLevel;
      const cost = upgradeCost(id, lvl);
      const afford = this.save.money >= cost;
      drawPanel(c, r, { radius: 12, fill: PALETTE.panel });
      {
        const ix = r.x + r.w * 0.18;
        const iy = r.y + r.h * 0.26;
        const ir = Math.min(r.w, r.h) * 0.14;
        c.fillStyle = maxed ? PALETTE.green : PALETTE.accent;
        c.beginPath();
        c.arc(ix, iy, ir, 0, Math.PI * 2);
        c.fill();
        text(c, def.name.slice(0, 1).toUpperCase(), ix, iy, ir * 1.1, PALETTE.ink, "center", "800");
      }
      text(c, def.name, r.x + r.w * 0.34, r.y + r.h * 0.2, this.u * 0.9, PALETTE.ink, "left", "800");
      this.wrapText(def.desc, r.x + r.w * 0.08, r.y + r.h * 0.46, r.w * 0.84, this.u * 0.72, PALETTE.inkSoft, this.u * 0.95);
      // level pips
      const pipR = r.h * 0.035;
      for (let i = 0; i < def.maxLevel; i++) {
        c.fillStyle = i < lvl ? PALETTE.green : "rgba(58,36,24,0.18)";
        c.beginPath();
        c.arc(r.x + r.w * 0.34 + i * pipR * 3, r.y + r.h * 0.32, pipR, 0, Math.PI * 2);
        c.fill();
      }
      drawButton(c, buy, maxed ? "MAX" : afford ? `Buy $${cost}` : `$${cost}`, {
        style: maxed ? "secondary" : afford ? "gold" : "secondary",
        disabled: maxed || !afford,
        size: this.u * 0.85,
        pressed: pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, buy) && this.gx.input.pointer.down,
      });
    }

    const start = this.startDayButton();
    drawButton(c, start, `Start Day ${this.save.day + 1}`, {
      style: "primary",
      pressed: pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, start) && this.gx.input.pointer.down,
    });
    this.drawMute();
  }

  // -------------------------------------------------- game over
  private updateOver(): void {
    const input = this.gx.input;
    if (input.pointer.justUp || input.pressed("Space", "Enter")) {
      this.state = "title";
    }
  }

  private renderOver(): void {
    const c = this.c;
    c.fillStyle = "rgba(40,24,14,0.5)";
    c.fillRect(0, 0, this.W, this.H);
    const cx = this.W / 2;
    text(c, "Shift Over", cx, this.H * 0.4, this.u * 2, PALETTE.cream, "center", "800");
    text(c, `You earned $${Math.round(this.save.earned)}`, cx, this.H * 0.5, this.u * 1.1, PALETTE.cream);
    text(c, `Best $${Math.round(this.save.best)}`, cx, this.H * 0.57, this.u, PALETTE.accent2, "center", "800");
    text(c, "Tap to continue", cx, this.H * 0.7, this.u * 0.9, PALETTE.cream);
  }

  // ---------------------------------------------------------------- play render
  private seatingH(): number {
    return this.activeSeated().length > 0 ? this.stage.h * 0.19 : this.stage.h * 0.02;
  }

  private activeSeated(): Ticket[] {
    return this.tickets.filter((t) => t.status === "building" || t.status === "baking" || t.status === "cutting");
  }

  private workArea(): Rect {
    const sh = this.seatingH();
    return { x: this.stage.x + this.W * 0.02, y: this.stage.y + sh, w: this.W * 0.96, h: this.stage.h - sh - this.H * 0.01 };
  }

  private renderPlay(): void {
    this.renderSeating();
    switch (this.station) {
      case "orders":
        this.renderOrders();
        break;
      case "build":
        this.renderBuild();
        break;
      case "oven":
        this.renderOven();
        break;
      case "serve":
        this.renderServe();
        break;
    }
    this.renderTabs();
    this.renderHud();
    this.renderReactions();
  }

  private renderSeating(): void {
    const seated = this.activeSeated();
    if (seated.length === 0) return;
    const c = this.c;
    const area: Rect = { x: this.stage.x + this.W * 0.02, y: this.stage.y + this.H * 0.006, w: this.W * 0.96, h: this.seatingH() - this.H * 0.012 };
    const n = seated.length;
    const gap = area.w * 0.012;
    const cw = Math.min((area.w - gap * (n - 1)) / n, area.w * 0.2);
    let x = area.x;
    for (const tk of seated) {
      const r: Rect = { x, y: area.y, w: cw, h: area.h };
      drawPanel(c, r, { radius: 10, shadow: false, fill: "rgba(255,253,247,0.85)" });
      const frac = clamp(tk.customer.patience / tk.customer.patienceMax, 0, 1);
      const mood = moodFromPatience(frac);
      drawCustomer(c, r.x + r.w * 0.28, r.y + r.h * 0.78, r.h * 0.5, tk.customer, mood, this.t, frac < 0.18 ? 1 : 0);
      // station tag
      const tag = tk.status === "building" ? "Build" : tk.status === "baking" ? "Oven" : "Cut";
      text(c, tag, r.x + r.w * 0.62, r.y + r.h * 0.32, this.u * 0.6, PALETTE.inkSoft, "center", "800");
      drawBar(c, { x: r.x + r.w * 0.46, y: r.y + r.h * 0.5, w: r.w * 0.48, h: r.h * 0.12 }, frac, this.patienceColor(frac));
      x += cw + gap;
    }
  }

  private patienceColor(frac: number): string {
    if (frac > 0.5) return PALETTE.green;
    if (frac > 0.25) return PALETTE.amber;
    return PALETTE.red;
  }

  private renderOrders(): void {
    const c = this.c;
    const cards = this.orderCardRects();
    if (cards.length === 0) {
      const area = this.workArea();
      text(c, this.spawnLeft > 0 ? "Waiting for the next customer…" : "No one in line — check your other stations!", area.x + area.w / 2, area.y + area.h / 2, this.u, PALETTE.inkSoft);
    }
    for (const { tk, card, take } of cards) {
      drawPanel(c, card, { radius: 12 });
      const frac = clamp(tk.customer.patience / tk.customer.patienceMax, 0, 1);
      const mood = moodFromPatience(frac);
      drawCustomer(c, card.x + card.w / 2, card.y + card.h * 0.32, card.h * 0.34, tk.customer, mood, this.t, frac < 0.18 ? 1 : 0);
      text(c, tk.customer.name, card.x + card.w / 2, card.y + card.h * 0.4, this.u * 0.85, PALETTE.ink, "center", "800");
      // patience bar
      drawBar(c, { x: card.x + card.w * 0.12, y: card.y + card.h * 0.45, w: card.w * 0.76, h: card.h * 0.045 }, frac, this.patienceColor(frac));
      // order ticket
      this.renderTicketSpec(tk, { x: card.x + card.w * 0.08, y: card.y + card.h * 0.5, w: card.w * 0.84, h: card.h * 0.28 });
      const pressed = pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, take) && this.gx.input.pointer.down;
      drawButton(c, take, "Take Order", { style: "primary", size: this.u * 0.85, pressed });
    }
  }

  private renderTicketSpec(tk: Ticket, r: Rect): void {
    const c = this.c;
    const sp = tk.spec;
    const lineH = r.h / 3;
    // toppings line(s)
    let tx = r.x;
    const ty = r.y + lineH * 0.5;
    const iconR = Math.min(lineH * 0.4, r.w * 0.05);
    for (const req of sp.toppings) {
      drawTopping(c, tx + iconR, ty, iconR, TOPPINGS[req.id], 0.4, 0);
      text(c, `x${req.count}`, tx + iconR * 2.2, ty, this.u * 0.7, PALETTE.ink, "left", "800");
      tx += iconR * 2.2 + this.u * 1.6;
      if (tx > r.x + r.w - iconR * 2) {
        tx = r.x;
      }
    }
    text(c, `Bake: ${sp.bake.label}`, r.x, r.y + lineH * 1.6, this.u * 0.72, PALETTE.inkSoft, "left", "800");
    text(c, `${sp.slices} slices`, r.x + r.w, r.y + lineH * 1.6, this.u * 0.72, PALETTE.inkSoft, "right", "800");
  }

  private renderBuild(): void {
    const c = this.c;
    const lay = this.buildLayout();
    const list = this.buildTickets();

    // list
    const rowH = Math.min(lay.list.h / Math.max(list.length, 1), lay.list.h * 0.28);
    if (list.length === 0) {
      text(c, "Take an order first", lay.cx, lay.cy, this.u, PALETTE.inkSoft);
    }
    list.forEach((tk, i) => {
      const r: Rect = { x: lay.list.x, y: lay.list.y + i * (rowH + 4), w: lay.list.w, h: rowH };
      const sel = tk.id === this.selectedBuild;
      drawPanel(c, r, { radius: 8, fill: sel ? PALETTE.accent2 : PALETTE.panel, shadow: false });
      text(c, tk.customer.name, r.x + r.w * 0.5, r.y + r.h * 0.34, this.u * 0.78, PALETTE.ink, "center", "800");
      const frac = clamp(tk.customer.patience / tk.customer.patienceMax, 0, 1);
      drawBar(c, { x: r.x + r.w * 0.1, y: r.y + r.h * 0.62, w: r.w * 0.8, h: r.h * 0.16 }, frac, this.patienceColor(frac));
    });

    const tk = this.currentBuild();

    // bench surface
    c.fillStyle = "rgba(120,74,37,0.25)";
    c.beginPath();
    c.arc(lay.cx, lay.cy, lay.R * 1.16, 0, Math.PI * 2);
    c.fill();

    if (tk) {
      drawPizza(c, lay.cx, lay.cy, lay.R, { placed: tk.placed, bake: 0.12, premiumSauce: this.up("sauce_auto") > 0, t: this.t });
      // requirement chips on the bar
      this.renderRequirements(tk, { x: lay.bar.x, y: lay.bar.y, w: lay.bar.w * 0.56, h: lay.bar.h });
    } else {
      drawPizza(c, lay.cx, lay.cy, lay.R, { placed: [], bake: 0.12, premiumSauce: false, t: this.t });
    }

    // tray
    drawPanel(c, lay.tray, { radius: 10, fill: PALETTE.woodLight, edge: PALETTE.woodDark });
    for (const cell of this.trayCells(lay.tray)) {
      const held = this.heldTopping === cell.id;
      if (held) {
        c.fillStyle = "rgba(255,176,58,0.5)";
        roundRect(c, cell.r.x, cell.r.y, cell.r.w, cell.r.h, 6);
        c.fill();
      }
      const ir = Math.min(cell.r.w, cell.r.h) * 0.34;
      drawTopping(c, cell.r.x + cell.r.w / 2, cell.r.y + cell.r.h * 0.42, ir, TOPPINGS[cell.id], 0.4, 0);
      text(c, TOPPINGS[cell.id].short, cell.r.x + cell.r.w / 2, cell.r.y + cell.r.h * 0.86, this.u * 0.56, PALETTE.ink, "center", "700");
    }

    // buttons
    const ovenFree = this.freeOvenSlot() != null;
    const bakePressed = pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, lay.bake) && this.gx.input.pointer.down;
    drawButton(c, lay.bake, ovenFree ? "Bake" : "Oven Full", { style: "primary", disabled: !ovenFree || !tk, size: this.u * 0.85, pressed: bakePressed });
    drawButton(c, lay.trash, "Undo", { style: "secondary", disabled: !tk || tk.placed.length === 0, size: this.u * 0.8 });
  }

  private renderRequirements(tk: Ticket, r: Rect): void {
    const c = this.c;
    const placed = new Map<ToppingId, number>();
    for (const p of tk.placed) placed.set(p.id, (placed.get(p.id) ?? 0) + 1);
    const n = tk.spec.toppings.length;
    const cw = r.w / Math.max(n, 1);
    tk.spec.toppings.forEach((req, i) => {
      const x = r.x + i * cw;
      const cy = r.y + r.h * 0.5;
      const ir = Math.min(cw * 0.28, r.h * 0.3);
      drawTopping(c, x + ir + 2, cy, ir, TOPPINGS[req.id], 0.4, 0);
      const have = placed.get(req.id) ?? 0;
      const ok = have === req.count;
      text(c, `${have}/${req.count}`, x + ir * 2.4, cy, this.u * 0.74, ok ? PALETTE.green : have > req.count ? PALETTE.red : PALETTE.ink, "left", "800");
    });
  }

  private renderOven(): void {
    const c = this.c;
    const rects = this.ovenSlotRects();
    rects.forEach((r, i) => {
      const tk = this.tickets.find((t) => t.status === "baking" && t.ovenSlot === i);
      // slot frame (oven door)
      drawPanel(c, r, { radius: 12, fill: "#3a241a", edge: "#1c100a" });
      c.fillStyle = "rgba(255,150,40,0.12)";
      roundRect(c, r.x + r.w * 0.06, r.y + r.h * 0.06, r.w * 0.88, r.h * 0.7, 8);
      c.fill();
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h * 0.36;
      const R = Math.min(r.w, r.h) * 0.3;
      if (tk) {
        drawPizza(c, cx, cy, R, { placed: tk.placed, bake: tk.bake, premiumSauce: this.up("sauce_auto") > 0, t: this.t, glow: tk.bake < 0.92 });
        // bake meter with band
        const bar: Rect = { x: r.x + r.w * 0.1, y: r.y + r.h * 0.74, w: r.w * 0.8, h: r.h * 0.06 };
        drawBar(c, bar, tk.bake, tk.bake > tk.spec.bake.hi ? PALETTE.red : PALETTE.accent, {
          band: [tk.spec.bake.lo, tk.spec.bake.hi],
          bandColor: "rgba(70,196,106,0.55)",
        });
        const pull: Rect = { x: r.x + r.w * 0.15, y: r.y + r.h * 0.82, w: r.w * 0.7, h: r.h * 0.14 };
        const inBand = tk.bake >= tk.spec.bake.lo && tk.bake <= tk.spec.bake.hi;
        const pressed = pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, pull) && this.gx.input.pointer.down;
        drawButton(c, pull, inBand ? "PULL!" : "Pull", { style: inBand ? "gold" : "secondary", size: this.u * 0.85, pressed });
      } else {
        text(c, "Empty", cx, cy, this.u, "rgba(255,220,160,0.5)");
        const tip = this.buildTickets().length > 0 ? "Build a pizza, then Bake" : "";
        if (tip) text(c, tip, cx, r.y + r.h * 0.82, this.u * 0.7, "rgba(255,220,160,0.4)");
      }
    });
  }

  private renderServe(): void {
    const c = this.c;
    const lay = this.serveLayout();
    const list = this.cutTickets();

    const rowH = Math.min(lay.list.h / Math.max(list.length, 1), lay.list.h * 0.28);
    if (list.length === 0) {
      text(c, "Bake a pizza first", lay.cx, lay.cy, this.u, PALETTE.inkSoft);
    }
    list.forEach((tk, i) => {
      const r: Rect = { x: lay.list.x, y: lay.list.y + i * (rowH + 4), w: lay.list.w, h: rowH };
      const sel = tk.id === this.selectedCut;
      drawPanel(c, r, { radius: 8, fill: sel ? PALETTE.accent2 : PALETTE.panel, shadow: false });
      text(c, tk.customer.name, r.x + r.w * 0.5, r.y + r.h * 0.34, this.u * 0.78, PALETTE.ink, "center", "800");
      const frac = clamp(tk.customer.patience / tk.customer.patienceMax, 0, 1);
      drawBar(c, { x: r.x + r.w * 0.1, y: r.y + r.h * 0.62, w: r.w * 0.8, h: r.h * 0.16 }, frac, this.patienceColor(frac));
    });

    const tk = this.currentCut();

    // cutting board
    c.fillStyle = "#caa06a";
    c.beginPath();
    c.arc(lay.cx, lay.cy, lay.R * 1.2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(120,74,37,0.4)";
    c.lineWidth = 3;
    c.stroke();

    if (tk) {
      drawPizza(c, lay.cx, lay.cy, lay.R, { placed: tk.placed, bake: tk.pulledBake ?? 0.7, premiumSauce: this.up("sauce_auto") > 0, t: this.t, cuts: tk.cuts });
      // active cut guide
      if (this.cutStart) {
        const dx = this.gx.input.pointer.x - this.cutStart.x;
        const dy = this.gx.input.pointer.y - this.cutStart.y;
        let a = Math.atan2(dy, dx);
        c.strokeStyle = "rgba(255,255,255,0.6)";
        c.lineWidth = 3;
        c.setLineDash([6, 6]);
        c.beginPath();
        c.moveTo(lay.cx - Math.cos(a) * lay.R, lay.cy - Math.sin(a) * lay.R);
        c.lineTo(lay.cx + Math.cos(a) * lay.R, lay.cy + Math.sin(a) * lay.R);
        c.stroke();
        c.setLineDash([]);
      }
      const required = Math.max(1, Math.round(tk.spec.slices / 2));
      text(c, `Cuts ${tk.cuts.length}/${required}  →  ${tk.cuts.length * 2} slices (want ${tk.spec.slices})`, lay.bar.x + lay.bar.w * 0.28, lay.bar.y + lay.bar.h * 0.5, this.u * 0.78, PALETTE.ink, "center", "800");
      text(c, "Swipe across the pizza to slice", lay.cx, lay.cy + lay.R * 1.34, this.u * 0.72, PALETTE.inkSoft);

      const servePressed = pointInRect(this.gx.input.pointer.x, this.gx.input.pointer.y, lay.serve) && this.gx.input.pointer.down;
      drawButton(c, lay.serve, "Serve", { style: "primary", size: this.u * 0.9, disabled: tk.cuts.length === 0, pressed: servePressed });
      drawButton(c, lay.undo, "Undo", { style: "secondary", size: this.u * 0.85, disabled: tk.cuts.length === 0 });
    }
  }

  private renderReactions(): void {
    const c = this.c;
    for (const tk of this.tickets) {
      if (tk.status === "served" && tk.score) {
        // brief score popup near top center
        const a = clamp(tk.reactionT / 1.2, 0, 1);
        c.globalAlpha = a;
        const cx = this.W / 2;
        const cy = this.stage.y + this.stage.h * 0.5;
        drawStars(c, cx, cy - this.u * 1.6, tk.score.stars, this.u * 0.9, this.u * 0.4);
        c.globalAlpha = 1;
      }
    }
  }

  // ---------------------------------------------------------------- tabs + hud
  private renderTabs(): void {
    const c = this.c;
    drawPanel(c, this.tabBar, { radius: 0, fill: PALETTE.woodDark, edge: PALETTE.woodDark, shadow: false });
    const counts: Record<Station, number> = {
      orders: this.tickets.filter((t) => t.status === "waiting").length,
      build: this.buildTickets().length,
      oven: this.tickets.filter((t) => t.status === "baking").length,
      serve: this.cutTickets().length,
    };
    this.tabRects.forEach((r, i) => {
      const st = STATIONS[i];
      const active = st === this.station;
      const flash = this.flashStation[st] ?? 0;
      const pulse = flash > 0 ? 0.5 + 0.5 * Math.sin(this.t * 18) : 0;
      const fill = active ? PALETTE.accent : mix(PALETTE.cream, PALETTE.accent2, pulse * 0.5);
      drawPanel(c, r, { radius: 10, fill, edge: active ? PALETTE.accent2 : PALETTE.panelEdge, shadow: false });
      this.drawStationIcon(c, r.x + r.w / 2, r.y + r.h * 0.36, Math.min(r.w, r.h) * 0.22, st, active);
      text(c, STATION_LABEL[st], r.x + r.w / 2, r.y + r.h * 0.78, this.u * 0.72, active ? "#fff" : PALETTE.ink, "center", "800");
      if (counts[st] > 0) drawBadge(c, r.x + r.w * 0.84, r.y + r.h * 0.18, counts[st], Math.min(r.w, r.h) * 0.16);
    });
  }

  private renderHud(): void {
    const c = this.c;
    drawPanel(c, this.hud, { radius: 0, fill: PALETTE.tomato, edge: PALETTE.tomatoDark, shadow: false });
    const cy = this.hud.h * 0.5;
    text(c, `Day ${this.profile.day}`, this.W * 0.03, cy, this.u * 1.05, "#fff", "left", "800");
    // money (cash) center with count-up
    text(c, `$${Math.round(this.displayCash)}`, this.W * 0.5, cy, this.u * 1.35, "#fff", "center", "800");
    const served = `${this.servedToday} served`;
    text(c, served, this.W * 0.5, this.hud.h * 0.5 + this.u * 1.0, this.u * 0.62, "rgba(255,255,255,0.85)");
    // quota progress
    const qx = this.W * 0.03;
    const qy = this.hud.h * 0.5 + this.u * 0.9;
    const qw = this.W * 0.2;
    if (this.state === "play") {
      drawBar(c, { x: qx, y: qy, w: qw, h: this.u * 0.4 }, clamp(this.earnedToday / this.profile.quota, 0, 1), PALETTE.flameHot, { bg: "rgba(0,0,0,0.2)" });
      text(c, `Rent $${this.earnedToday}/${this.profile.quota}`, qx, qy - this.u * 0.5, this.u * 0.55, "rgba(255,255,255,0.9)", "left", "700");
    }
    this.drawMute();
  }

  private drawMute(): void {
    const c = this.c;
    const r = this.muteRect;
    c.fillStyle = "rgba(255,255,255,0.2)";
    c.beginPath();
    c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
    c.fill();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const s = r.w * 0.26;
    c.fillStyle = "#fff";
    c.beginPath();
    c.moveTo(cx - s, cy - s * 0.5);
    c.lineTo(cx - s * 0.2, cy - s * 0.5);
    c.lineTo(cx + s * 0.4, cy - s);
    c.lineTo(cx + s * 0.4, cy + s);
    c.lineTo(cx - s * 0.2, cy + s * 0.5);
    c.lineTo(cx - s, cy + s * 0.5);
    c.closePath();
    c.fill();
    c.strokeStyle = "#fff";
    c.lineWidth = Math.max(1.5, r.w * 0.05);
    if (this.gx.audio.muted) {
      c.beginPath();
      c.moveTo(cx + s * 0.7, cy - s * 0.6);
      c.lineTo(cx + s * 1.3, cy + s * 0.6);
      c.moveTo(cx + s * 1.3, cy - s * 0.6);
      c.lineTo(cx + s * 0.7, cy + s * 0.6);
      c.stroke();
    } else {
      c.beginPath();
      c.arc(cx + s * 0.5, cy, s * 0.6, -0.7, 0.7);
      c.stroke();
      c.beginPath();
      c.arc(cx + s * 0.5, cy, s * 1.05, -0.7, 0.7);
      c.stroke();
    }
  }

  private drawStationIcon(c: CanvasRenderingContext2D, x: number, y: number, r: number, st: Station, active: boolean): void {
    const col = active ? "#fff" : PALETTE.ink;
    c.save();
    c.translate(x, y);
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = Math.max(1.5, r * 0.16);
    switch (st) {
      case "orders": {
        c.beginPath();
        roundRect(c, -r * 0.7, -r * 0.8, r * 1.4, r * 1.6, r * 0.2);
        c.stroke();
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(-r * 0.45, -r * 0.4 + i * r * 0.45);
          c.lineTo(r * 0.45, -r * 0.4 + i * r * 0.45);
          c.stroke();
        }
        break;
      }
      case "build": {
        c.beginPath();
        c.arc(0, 0, r * 0.85, 0, Math.PI * 2);
        c.stroke();
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7;
          c.beginPath();
          c.arc(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.14, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case "oven": {
        c.beginPath();
        c.arc(0, r * 0.1, r * 0.85, Math.PI, 0);
        c.stroke();
        c.beginPath();
        c.moveTo(0, r * 0.4);
        c.quadraticCurveTo(-r * 0.4, 0, 0, -r * 0.6);
        c.quadraticCurveTo(r * 0.4, 0, 0, r * 0.4);
        c.fill();
        break;
      }
      case "serve": {
        // pizza cutter
        c.beginPath();
        c.arc(-r * 0.2, -r * 0.2, r * 0.45, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.moveTo(r * 0.1, r * 0.1);
        c.lineTo(r * 0.8, r * 0.8);
        c.stroke();
        break;
      }
    }
    c.restore();
  }

  private wrapText(s: string, x: number, y: number, maxW: number, size: number, color: string, lineH: number): void {
    const c = this.c;
    c.fillStyle = color;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.font = `700 ${size}px "Baloo 2", system-ui, sans-serif`;
    const words = s.split(" ");
    let line = "";
    let yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, yy);
        line = w;
        yy += lineH;
      } else {
        line = test;
      }
    }
    if (line) c.fillText(line, x, yy);
  }
}
