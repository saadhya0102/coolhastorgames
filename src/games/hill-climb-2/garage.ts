/**
 * Hill Climb 2 — garage / meta UI.
 * Three tabs (DRIVE / GEAR / WORLD). Pointer-first with keyboard fallback.
 * Mutates the shared SaveState and persists through the provided callback.
 * Returns an intent ("go") to the orchestrator.
 */
import type { AudioManager, GameStorage, InputManager, Rect } from "@/engine";
import { drawText, pointInRect, roundRect } from "@/engine";
import {
  MAX_LEVEL,
  STAGES,
  STAGE_ORDER,
  UPGRADE_DEFS,
  VEHICLES,
  VEHICLE_ORDER,
  deriveStats,
  upgradeCost,
  vehicleRatings,
} from "./config";
import { drawVehiclePreview } from "./render";
import { ownsStage, ownsVehicle, writeSave } from "./save";
import type { GarageTab, SaveState, StageId, VehicleId } from "./types";

interface Deps {
  input: InputManager;
  audio: AudioManager;
  storage: GameStorage;
  save: SaveState;
}

interface Btn {
  rect: Rect;
  action: () => void;
  enabled: boolean;
}

export class Garage {
  tab: GarageTab = "drive";
  private vSel = 0;
  private sSel = 0;
  private btns: Btn[] = [];

  constructor(private d: Deps) {
    this.vSel = Math.max(0, VEHICLE_ORDER.indexOf(d.save.selectedVehicle));
    this.sSel = Math.max(0, STAGE_ORDER.indexOf(d.save.selectedStage));
  }

  private persist(): void {
    writeSave(this.d.storage, this.d.save);
  }

  /** Process input. Returns true if the player pressed GO. */
  update(): boolean {
    const { input } = this.d;
    let go = false;

    // keyboard: tabs
    if (input.pressed("Tab", "ArrowDown")) this.cycleTab(1);
    if (input.pressed("ArrowUp")) this.cycleTab(-1);
    // keyboard: selection within tab
    if (this.tab === "drive") {
      if (input.pressed("ArrowRight", "d")) this.moveVehicle(1);
      if (input.pressed("ArrowLeft", "a")) this.moveVehicle(-1);
    } else if (this.tab === "world") {
      if (input.pressed("ArrowRight", "d")) this.moveStage(1);
      if (input.pressed("ArrowLeft", "a")) this.moveStage(-1);
    }
    if (input.pressed("Enter", "Space")) {
      // Enter triggers GO from anywhere; selection/buy handled via pointer
      go = true;
    }

    // pointer: hit-test the buttons built last render pass
    if (input.pointer.justDown) {
      const px = input.pointer.x;
      const py = input.pointer.y;
      for (const b of this.btns) {
        if (b.enabled && pointInRect(px, py, b.rect)) {
          b.action();
          break;
        }
      }
    }
    if (this.goPressed) {
      go = true;
      this.goPressed = false;
    }
    return go;
  }

  private goPressed = false;

  private cycleTab(dir: number): void {
    const order: GarageTab[] = ["drive", "gear", "world"];
    let i = order.indexOf(this.tab) + dir;
    if (i < 0) i = order.length - 1;
    if (i >= order.length) i = 0;
    this.tab = order[i];
    this.d.audio.blip();
  }

  private moveVehicle(dir: number): void {
    this.vSel = (this.vSel + dir + VEHICLE_ORDER.length) % VEHICLE_ORDER.length;
    this.d.audio.blip();
  }

  private moveStage(dir: number): void {
    this.sSel = (this.sSel + dir + STAGE_ORDER.length) % STAGE_ORDER.length;
    this.d.audio.blip();
  }

  private buyOrSelectVehicle(id: VehicleId): void {
    const save = this.d.save;
    const def = VEHICLES[id];
    if (ownsVehicle(save, id)) {
      save.selectedVehicle = id;
      this.d.audio.blip();
    } else if (save.coins >= def.cost) {
      save.coins -= def.cost;
      save.ownedVehicles.push(id);
      save.selectedVehicle = id;
      this.d.audio.coin();
    }
    this.persist();
  }

  private buyOrSelectStage(id: StageId): void {
    const save = this.d.save;
    const def = STAGES[id];
    if (ownsStage(save, id)) {
      save.selectedStage = id;
      this.d.audio.blip();
    } else if (save.coins >= def.cost) {
      save.coins -= def.cost;
      save.ownedStages.push(id);
      save.selectedStage = id;
      this.d.audio.coin();
    }
    this.persist();
  }

  private buyUpgrade(key: (typeof UPGRADE_DEFS)[number]["key"]): void {
    const save = this.d.save;
    const id = save.selectedVehicle;
    const lvl = save.upgrades[id][key];
    if (lvl >= MAX_LEVEL) return;
    const cost = upgradeCost(key, lvl);
    if (save.coins < cost) return;
    save.coins -= cost;
    save.upgrades[id][key] = lvl + 1;
    this.d.audio.coin();
    this.persist();
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  draw(c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    this.btns = [];
    const save = this.d.save;

    // background
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#121a30");
    g.addColorStop(1, "#223a63");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // garage floor stripe
    c.fillStyle = "rgba(255,255,255,0.04)";
    c.fillRect(0, H * 0.66, W, H);

    const pad = Math.min(W, H) * 0.04;
    const titleSize = Math.min(40, W * 0.06);
    drawText(c, "HILL CLIMB 2", pad, pad + titleSize * 0.5, titleSize, "#ffd23f", "left", "800");
    drawText(
      c,
      `\u25C9 ${save.coins.toLocaleString()}`,
      W - pad,
      pad + titleSize * 0.5,
      Math.min(28, W * 0.045),
      "#ffd95c",
      "right",
    );

    // tabs
    const tabY = pad * 2 + titleSize;
    const tabW = Math.min(W * 0.28, 170);
    const tabH = Math.min(H * 0.08, 46);
    const tabs: GarageTab[] = ["drive", "gear", "world"];
    const labels = ["DRIVE", "GEAR", "WORLD"];
    const totalTabW = tabW * 3 + pad * 2;
    let tx = (W - totalTabW) / 2;
    for (let i = 0; i < 3; i++) {
      const active = this.tab === tabs[i];
      const r: Rect = { x: tx, y: tabY, w: tabW, h: tabH };
      c.fillStyle = active ? "#ffd23f" : "rgba(255,255,255,0.08)";
      roundRect(c, r.x, r.y, r.w, r.h, 10);
      c.fill();
      drawText(c, labels[i], tx + tabW / 2, tabY + tabH / 2, tabH * 0.42, active ? "#0d1b2a" : "#cdd8ee");
      const tab = tabs[i];
      this.btns.push({
        rect: r,
        enabled: true,
        action: () => {
          if (this.tab !== tab) {
            this.tab = tab;
            this.d.audio.blip();
          }
        },
      });
      tx += tabW + pad;
    }

    const contentTop = tabY + tabH + pad;
    const goH = Math.min(H * 0.1, 60);
    const goY = H - pad - goH;
    const contentBottom = goY - pad;

    if (this.tab === "drive") this.drawDrive(c, W, H, contentTop, contentBottom, t);
    else if (this.tab === "gear") this.drawGear(c, W, contentTop, contentBottom);
    else this.drawWorld(c, W, H, contentTop, contentBottom);

    // GO button
    const goW = Math.min(W * 0.5, 320);
    const goX = (W - goW) / 2;
    const goRect: Rect = { x: goX, y: goY, w: goW, h: goH };
    const vName = VEHICLES[save.selectedVehicle].name;
    const sName = STAGES[save.selectedStage].name;
    c.fillStyle = "#43d17a";
    roundRect(c, goX, goY, goW, goH, 14);
    c.fill();
    drawText(c, `GO!  ${vName} \u2192 ${sName}`, W / 2, goY + goH / 2, goH * 0.34, "#0a2417");
    this.btns.push({
      rect: goRect,
      enabled: true,
      action: () => {
        this.goPressed = true;
      },
    });
  }

  private drawDrive(
    c: CanvasRenderingContext2D,
    W: number,
    H: number,
    top: number,
    bottom: number,
    t: number,
  ): void {
    const save = this.d.save;
    const id = VEHICLE_ORDER[this.vSel];
    const def = VEHICLES[id];
    const owned = ownsVehicle(save, id);
    const midY = (top + bottom) / 2;
    const pad = Math.min(W, H) * 0.04;

    // preview platform
    c.fillStyle = "rgba(0,0,0,0.25)";
    roundRect(c, W * 0.5 - W * 0.32, midY - (bottom - top) * 0.28, W * 0.64, (bottom - top) * 0.4, 16);
    c.fill();
    const scale = Math.min(W, H) / 320;
    drawVehiclePreview(c, W / 2, midY - (bottom - top) * 0.02, scale, def, t * 2);

    // name + lock/cost
    drawText(c, def.name, W / 2, top + (bottom - top) * 0.04, Math.min(30, W * 0.05), "#fff");
    drawText(c, def.blurb, W / 2, top + (bottom - top) * 0.12, Math.min(16, W * 0.026), "#9fc6e8");

    // arrows
    const arrW = Math.min(W * 0.1, 60);
    const arrY = midY - arrW / 2;
    this.arrowButton(c, pad, arrY, arrW, "\u2039", () => this.moveVehicle(-1));
    this.arrowButton(c, W - pad - arrW, arrY, arrW, "\u203A", () => this.moveVehicle(1));

    // ratings bars
    const r = vehicleRatings(def);
    const bars: Array<[string, number]> = [
      ["POWER", r.power],
      ["SPEED", r.speed],
      ["GRIP", r.grip],
      ["SUSP", r.susp],
      ["STABILITY", r.stability],
    ];
    const barW = Math.min(W * 0.5, 260);
    const barX = (W - barW) / 2;
    let by = bottom - bars.length * 22 - 70;
    for (const [label, val] of bars) {
      drawText(c, label, barX, by, 13, "#9fc6e8", "left");
      c.fillStyle = "rgba(255,255,255,0.12)";
      roundRect(c, barX + 84, by - 6, barW - 84, 10, 5);
      c.fill();
      c.fillStyle = "#ffd23f";
      roundRect(c, barX + 84, by - 6, (barW - 84) * val, 10, 5);
      c.fill();
      by += 22;
    }

    // buy / select button
    const btnW = Math.min(W * 0.4, 240);
    const btnX = (W - btnW) / 2;
    const btnY = bottom - 44;
    const btnRect: Rect = { x: btnX, y: btnY, w: btnW, h: 40 };
    let label: string;
    let color: string;
    let enabled = true;
    if (owned) {
      const selected = save.selectedVehicle === id;
      label = selected ? "SELECTED" : "SELECT";
      color = selected ? "rgba(255,255,255,0.18)" : "#2bd6c0";
      enabled = !selected;
    } else if (save.coins >= def.cost) {
      label = `BUY  \u25C9 ${def.cost.toLocaleString()}`;
      color = "#43d17a";
    } else {
      label = `\u25C9 ${def.cost.toLocaleString()}`;
      color = "rgba(226,59,59,0.5)";
      enabled = false;
    }
    c.fillStyle = color;
    roundRect(c, btnX, btnY, btnW, 40, 10);
    c.fill();
    drawText(c, label, W / 2, btnY + 20, 17, "#0d1b2a");
    this.btns.push({ rect: btnRect, enabled, action: () => this.buyOrSelectVehicle(id) });
  }

  private drawGear(
    c: CanvasRenderingContext2D,
    W: number,
    top: number,
    bottom: number,
  ): void {
    const save = this.d.save;
    const id = save.selectedVehicle;
    const upg = save.upgrades[id];
    drawText(c, `${VEHICLES[id].name} — UPGRADES`, W / 2, top, Math.min(22, W * 0.04), "#fff");

    const panelW = Math.min(W * 0.9, 640);
    const panelX = (W - panelW) / 2;
    const rowsTop = top + 30;
    const avail = bottom - rowsTop - 56;
    const rowH = Math.min(avail / UPGRADE_DEFS.length - 8, 70);
    for (let i = 0; i < UPGRADE_DEFS.length; i++) {
      const def = UPGRADE_DEFS[i];
      const y = rowsTop + i * (rowH + 8);
      c.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(c, panelX, y, panelW, rowH, 10);
      c.fill();
      const lvl = upg[def.key];
      drawText(c, def.name, panelX + 16, y + rowH * 0.34, rowH * 0.26, "#fff", "left");
      drawText(c, def.blurb, panelX + 16, y + rowH * 0.7, rowH * 0.2, "#9fc6e8", "left");
      // pips
      const pipR = Math.min(rowH * 0.08, 6);
      for (let p = 0; p < MAX_LEVEL; p++) {
        c.fillStyle = p < lvl ? "#ffd23f" : "rgba(255,255,255,0.18)";
        c.beginPath();
        c.arc(panelX + panelW * 0.44 + p * pipR * 2.4, y + rowH / 2, pipR, 0, Math.PI * 2);
        c.fill();
      }
      // buy button
      const btnW = Math.min(panelW * 0.24, 130);
      const btnX = panelX + panelW - btnW - 12;
      const maxed = lvl >= MAX_LEVEL;
      const cost = upgradeCost(def.key, lvl);
      const afford = save.coins >= cost;
      const bh = rowH * 0.6;
      const bRect: Rect = { x: btnX, y: y + (rowH - bh) / 2, w: btnW, h: bh };
      c.fillStyle = maxed ? "rgba(255,255,255,0.12)" : afford ? "#43d17a" : "rgba(226,59,59,0.45)";
      roundRect(c, bRect.x, bRect.y, btnW, bh, 8);
      c.fill();
      drawText(
        c,
        maxed ? "MAX" : `\u25C9 ${cost}`,
        btnX + btnW / 2,
        y + rowH / 2,
        Math.min(rowH * 0.28, 18),
        "#0d1b2a",
      );
      const key = def.key;
      this.btns.push({
        rect: bRect,
        enabled: !maxed && afford,
        action: () => this.buyUpgrade(key),
      });
    }

    // live performance hint
    const stats = deriveStats(id, upg);
    drawText(
      c,
      `Drive ${Math.round(stats.driveAccel)}  •  Grip ${stats.grip.toFixed(2)}  •  Fuel ${Math.round(stats.maxFuel)}  •  4WD ${(stats.fwd * 100) | 0}%`,
      W / 2,
      bottom - 20,
      Math.min(15, W * 0.026),
      "#9fc6e8",
    );
  }

  private drawWorld(
    c: CanvasRenderingContext2D,
    W: number,
    H: number,
    top: number,
    bottom: number,
  ): void {
    const save = this.d.save;
    const id = STAGE_ORDER[this.sSel];
    const def = STAGES[id];
    const owned = ownsStage(save, id);
    const midY = (top + bottom) / 2;
    const pad = Math.min(W, H) * 0.04;

    // thumbnail card painting the stage
    const cardW = Math.min(W * 0.6, 420);
    const cardH = Math.min((bottom - top) * 0.46, 220);
    const cardX = (W - cardW) / 2;
    const cardY = top + (bottom - top) * 0.12;
    c.save();
    roundRect(c, cardX, cardY, cardW, cardH, 14);
    c.clip();
    const sg = c.createLinearGradient(0, cardY, 0, cardY + cardH);
    sg.addColorStop(0, def.palette.skyTop);
    sg.addColorStop(1, def.palette.skyBottom);
    c.fillStyle = sg;
    c.fillRect(cardX, cardY, cardW, cardH);
    // terrain silhouette
    c.fillStyle = def.palette.groundTop;
    c.beginPath();
    c.moveTo(cardX, cardY + cardH);
    for (let x = 0; x <= cardW; x += 8) {
      const yy =
        cardY + cardH * 0.62 +
        Math.sin(x / 50 + this.sSel) * (def.amps[0] * 0.3) +
        Math.sin(x / 22) * (def.amps[1] * 0.3);
      c.lineTo(cardX + x, yy);
    }
    c.lineTo(cardX + cardW, cardY + cardH);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = "rgba(255,255,255,0.2)";
    c.lineWidth = 2;
    roundRect(c, cardX, cardY, cardW, cardH, 14);
    c.stroke();

    drawText(c, def.name, W / 2, cardY + cardH + 28, Math.min(28, W * 0.05), "#fff");
    drawText(c, def.blurb, W / 2, cardY + cardH + 54, Math.min(15, W * 0.025), "#9fc6e8");
    const grav = `Gravity ${Math.round(def.gravityScale * 100)}%`;
    const best = save.bestByStage[id] ?? 0;
    drawText(c, `${grav}   •   Best ${best} m`, W / 2, cardY + cardH + 78, Math.min(15, W * 0.025), def.palette.hudAccent);

    // arrows
    const arrW = Math.min(W * 0.1, 60);
    const arrY = midY - arrW / 2;
    this.arrowButton(c, pad, arrY, arrW, "\u2039", () => this.moveStage(-1));
    this.arrowButton(c, W - pad - arrW, arrY, arrW, "\u203A", () => this.moveStage(1));

    // buy / select
    const btnW = Math.min(W * 0.4, 240);
    const btnX = (W - btnW) / 2;
    const btnY = bottom - 44;
    const bRect: Rect = { x: btnX, y: btnY, w: btnW, h: 40 };
    let label: string;
    let color: string;
    let enabled = true;
    if (owned) {
      const selected = save.selectedStage === id;
      label = selected ? "SELECTED" : "SELECT";
      color = selected ? "rgba(255,255,255,0.18)" : "#2bd6c0";
      enabled = !selected;
    } else if (save.coins >= def.cost) {
      label = `BUY  \u25C9 ${def.cost.toLocaleString()}`;
      color = "#43d17a";
    } else {
      label = `\u25C9 ${def.cost.toLocaleString()}`;
      color = "rgba(226,59,59,0.5)";
      enabled = false;
    }
    c.fillStyle = color;
    roundRect(c, btnX, btnY, btnW, 40, 10);
    c.fill();
    drawText(c, label, W / 2, btnY + 20, 17, "#0d1b2a");
    this.btns.push({ rect: bRect, enabled, action: () => this.buyOrSelectStage(id) });
  }

  private arrowButton(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    glyph: string,
    action: () => void,
  ): void {
    c.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(c, x, y, s, s, 10);
    c.fill();
    drawText(c, glyph, x + s / 2, y + s / 2, s * 0.6, "#fff");
    this.btns.push({ rect: { x, y, w: s, h: s }, enabled: true, action });
  }
}
