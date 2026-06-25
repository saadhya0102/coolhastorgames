import { clamp, drawText, roundRect } from "@/engine";
import type { GameContext } from "@/engine";
import type { Screen, ScreenEnv } from "./screen";
import { DT_CLAMP } from "./screen";
import { PALETTE, lighten, rgba } from "./theme";
import { sky, sun, clouds, hills, water, grass, stars } from "./backdrop";
import { drawDuck, aiLook, type DuckLook } from "./duck";
import { Particles, Shake } from "./fx";
import { ResultCard, drawCountdown, type MiniResult } from "./common";
import {
  LEAGUE_COUNT,
  LEAGUE_NAMES,
  effectiveStat,
  racePayout,
  type SaveData,
} from "./save";

type Phase = "count" | "race" | "finish";
type Seg = 0 | 1 | 2; // run, swim, fly

export interface RaceResult {
  place: number;
  coins: number;
  unlocked: boolean;
  league: number;
}

interface LeagueTheme {
  sky: [string, string];
  grassTop: string;
  grassBot: string;
  blade: string;
  hills: string[];
  waterTop: string;
  waterBot: string;
  night: boolean;
  sunset: boolean;
}

const THEMES: LeagueTheme[] = [
  {
    sky: ["#8fd4ff", "#dff4ff"],
    grassTop: "#86cf52", grassBot: "#4f9a36", blade: "#73bf45",
    hills: ["#a7d977", "#7bc456"], waterTop: "#46b9e8", waterBot: "#1c6f9c", night: false, sunset: false,
  },
  {
    sky: ["#6fb6f0", "#cfeaff"],
    grassTop: "#79c24f", grassBot: "#3f8a30", blade: "#67b03e",
    hills: ["#8fc96a", "#67ab48"], waterTop: "#3aa6dd", waterBot: "#13608c", night: false, sunset: false,
  },
  {
    sky: ["#9fd0ef", "#eaf6ff"],
    grassTop: "#8ad07a", grassBot: "#4a8f52", blade: "#74c067",
    hills: ["#bfe0c0", "#8fc79a"], waterTop: "#5fc0e6", waterBot: "#2a7aa6", night: false, sunset: false,
  },
  {
    sky: ["#ff9e6b", "#ffd9a0"],
    grassTop: "#c8a25a", grassBot: "#8a6a36", blade: "#b89048",
    hills: ["#e0a878", "#c08858"], waterTop: "#e88a6a", waterBot: "#9c4a5a", night: false, sunset: true,
  },
];

interface Racer {
  name: string;
  look: DuckLook;
  isPlayer: boolean;
  progress: number; // meters
  speed: number;
  lane: number;
  phase: number; // animation phase for gait
  noisePhase: number;
  aiStat: [number, number, number];
  finished: boolean;
  finishTime: number;
}

const SEG_BASE = [26, 20, 30]; // m/s base per segment

export function createRace(
  env: ScreenEnv,
  save: SaveData,
  onDone: (result: RaceResult) => void,
): Screen {
  const { ctx, look } = env;
  const { input, audio } = ctx;
  const league = clamp(save.league, 0, LEAGUE_COUNT - 1);
  const theme = THEMES[league];
  const particles = new Particles();
  const shake = new Shake();

  const COURSE_M = 900 + league * 120;
  const segLen = COURSE_M / 3;
  const B1 = segLen;
  const B2 = segLen * 2;
  const leagueScale = 1 + league * 0.04;

  let phase: Phase = "count";
  let countT = 3.4;
  let t = 0;
  let raceTime = 0;
  let result: ResultCard | null = null;
  let raceResult: RaceResult | null = null;
  let finishHold = 0;
  let closed = false;

  // build field
  const racers: Racer[] = [];
  const playerStats: [number, number, number] = [
    effectiveStat(save, "run"),
    effectiveStat(save, "swim"),
    effectiveStat(save, "fly"),
  ];
  racers.push({
    name: "You",
    look,
    isPlayer: true,
    progress: 0,
    speed: 0,
    lane: 0,
    phase: 0,
    noisePhase: 0,
    aiStat: playerStats,
    finished: false,
    finishTime: 0,
  });
  const aiNames = ["Quackers", "Pebble", "Splash", "Waddles", "Ziggy", "Pip"];
  const leagueBase = 3 + league * 5;
  for (let i = 0; i < 3; i++) {
    const personality = (Math.random() * 3) | 0;
    const stat: [number, number, number] = [0, 0, 0];
    for (let s = 0; s < 3; s++) {
      let v = leagueBase + (Math.random() * 4 - 2);
      if (s === personality) v += 3;
      stat[s] = Math.max(1, v);
    }
    racers.push({
      name: aiNames[(i + league) % aiNames.length],
      look: aiLook(i + league),
      isPlayer: false,
      progress: 0,
      speed: 0,
      lane: i + 1,
      phase: Math.random(),
      noisePhase: Math.random() * 10,
      aiStat: stat,
      finished: false,
      finishTime: 0,
    });
  }

  const player = racers[0];

  ctx.requestControls([]);
  ctx.setStatus(`${LEAGUE_NAMES[league]} — race to the finish!`);

  const segAt = (p: number): Seg => (p < B1 ? 0 : p < B2 ? 1 : 2);

  const finishRace = () => {
    phase = "finish";
    const place = racers.filter((r) => r !== player && r.finished && r.finishTime < player.finishTime).length;
    const won = place === 0;
    let unlocked = false;
    if (won && league === save.bestLeague && league < LEAGUE_COUNT - 1) unlocked = true;
    const coins = racePayout(place, league);
    raceResult = { place, coins, unlocked, league };
    if (won) audio.win();
    else audio.lose();

    const ordinal = ["1st", "2nd", "3rd", "4th"][place] ?? `${place + 1}th`;
    const lines: MiniResult["lines"] = [
      { label: "Finish", value: ordinal, color: won ? PALETTE.good : PALETTE.ink },
      { label: "Coins", value: `+${coins}`, color: PALETTE.coin },
    ];
    const res: MiniResult = {
      title: won ? "VICTORY!" : place <= 1 ? "So close!" : "Keep training!",
      lines,
      banner: unlocked ? `${LEAGUE_NAMES[league + 1]} Unlocked!` : undefined,
    };
    result = new ResultCard(res);
    if (won) particles.confetti(ctx.width / 2, ctx.height * 0.2, 60);
  };

  return {
    update(dt) {
      const d = Math.min(dt, DT_CLAMP);
      t += d;
      particles.update(d);
      shake.update(d);

      if (phase === "count") {
        countT -= d;
        if (countT <= 0) phase = "race";
        return;
      }
      if (phase === "finish") {
        result?.update(d);
        finishHold += d;
        if (!closed && finishHold > 0.4 && result?.handle(ctx) && raceResult) {
          closed = true;
          onDone(raceResult);
        }
        return;
      }

      raceTime += d;
      // simulate racers
      for (const r of racers) {
        if (r.finished) continue;
        const seg = segAt(r.progress);
        const stat = r.aiStat[seg];
        const factor = 0.85 + stat * 0.035;
        const noise = 1 + Math.sin(t * 2.2 + r.noisePhase) * 0.06 + (r.isPlayer ? 0 : (Math.random() - 0.5) * 0.02);
        r.speed = SEG_BASE[seg] * factor * noise * leagueScale;
        r.progress += r.speed * d;
        r.phase += (seg === 2 ? r.speed * 0.05 : r.speed * 0.03) * d;
        if (r.progress >= COURSE_M) {
          r.progress = COURSE_M;
          r.finished = true;
          r.finishTime = raceTime;
        }
      }

      // particles from player's feet/body per segment
      if (Math.random() < 0.5) {
        const seg = segAt(player.progress);
        const sx = ctx.width * 0.32;
        const yy = racerScreenY(ctx, player, segAt);
        if (seg === 0) particles.dust(sx, yy + ctx.height * 0.02, 1);
        else if (seg === 1) particles.splash(sx - ctx.width * 0.02, yy + ctx.height * 0.02, -1, rgba("#ffffff", 0.6));
      }

      if (player.finished) {
        finishHold += d;
        if (finishHold > 0.6) finishRace();
      }

      if (input.pressed("Escape")) {
        // bail straight to a (losing) result based on current standings
        player.finished = true;
        player.finishTime = raceTime;
        finishRace();
      }
    },

    render() {
      const c = ctx.ctx;
      const W = ctx.width;
      const H = ctx.height;
      const pxPerM = W / 60; // ~60m visible
      const camM = player.progress - 60 * 0.32;

      // ---- background ----
      sky(c, W, H, theme.sky[0], theme.sky[1]);
      if (theme.night) stars(c, W, H, t);
      if (theme.sunset) sun(c, W * 0.5, H * 0.26, Math.min(W, H) * 0.09, "#ffd27a");
      else sun(c, W * 0.8, H * 0.18, Math.min(W, H) * 0.06, "#fff3c8");
      clouds(c, W, H, t, { speed: 10, count: 4, color: rgba("#ffffff", theme.sunset ? 0.6 : 0.85) });

      const groundY = H * 0.82;
      const waterY = H * 0.5;

      // distant hills along run+swim portion
      hills(c, W, H, t * 0.5, groundY, theme.hills);

      // segment terrain projected to screen
      const sx = (m: number) => (m - camM) * pxPerM;
      const grassX0 = sx(0);
      const grassX1 = sx(B1);
      const waterX0 = grassX1;
      const waterX1 = sx(B2);
      const flyX0 = waterX1;
      const finishX = sx(COURSE_M);

      // grass band (run zone)
      if (grassX1 > 0 && grassX0 < W) {
        c.save();
        c.beginPath();
        c.rect(Math.max(0, grassX0), 0, Math.min(W, grassX1) - Math.max(0, grassX0) + 1, H);
        c.clip();
        grass(c, W, H, groundY, camM * pxPerM, theme.grassTop, theme.grassBot, theme.blade);
        c.restore();
      }
      // water band (swim zone)
      if (waterX1 > 0 && waterX0 < W) {
        c.save();
        c.beginPath();
        c.rect(Math.max(0, waterX0), 0, Math.min(W, waterX1) - Math.max(0, waterX0) + 1, H);
        c.clip();
        // a thin grass shore behind the water for context
        grass(c, W, H, groundY, camM * pxPerM, theme.grassTop, theme.grassBot, theme.blade);
        water(c, W, H, t, waterY, theme.waterTop, theme.waterBot);
        c.restore();
        // banks
        c.fillStyle = theme.grassBot;
        c.fillRect(Math.max(0, waterX0), waterY - H * 0.02, 4, H * 0.02);
      }
      // fly zone: open sky with low mountains
      if (flyX0 < W) {
        c.save();
        c.beginPath();
        c.rect(Math.max(0, flyX0), 0, W - Math.max(0, flyX0) + 1, H);
        c.clip();
        hills(c, W, H, t * 0.3, H * 0.95, [lighten(theme.hills[0], 0.1)]);
        c.restore();
      }

      // segment boundary posts
      drawPost(c, grassX1, groundY, "🏊");
      drawPost(c, waterX1, waterY, "🕊");

      // finish line
      if (finishX > -40 && finishX < W + 40) drawFinish(c, finishX, H, t);

      // ---- racers (draw far lanes first) ----
      c.save();
      c.translate(shake.x, shake.y);
      const order = [...racers].sort((a, b) => b.lane - a.lane);
      for (const r of order) {
        const rx = sx(r.progress);
        if (rx < -60 || rx > W + 60) continue;
        const ry = racerScreenY(ctx, r, segAt);
        const seg = segAt(r.progress);
        const u = Math.min(W, H) * (r.isPlayer ? 0.06 : 0.052);
        if (seg === 0) {
          drawDuck(c, rx, ry, u, r.look, { pose: "run", t, phase: r.phase, glance: 0.4 });
        } else if (seg === 1) {
          drawDuck(c, rx, ry, u, r.look, { pose: "swim", t, phase: r.phase, shadow: false, glance: 0.3 });
        } else {
          const flap01 = Math.sin(r.phase * Math.PI * 2) * 0.5 + 0.5;
          drawDuck(c, rx, ry, u, r.look, { pose: "fly", t, flap: flap01 * 0.5, pitch: -0.1, shadow: false, glance: 0.4 });
        }
        if (r.isPlayer) {
          drawText(c, "YOU", rx, ry - u * 2.0, u * 0.6, PALETTE.ink, "center", "800");
          c.fillStyle = PALETTE.accent;
          c.beginPath();
          c.moveTo(rx, ry - u * 1.55);
          c.lineTo(rx - u * 0.3, ry - u * 1.85);
          c.lineTo(rx + u * 0.3, ry - u * 1.85);
          c.fill();
        }
      }
      particles.render(c);
      c.restore();

      // ---- HUD: mini-map + placement ----
      drawMiniMap(c, W, H, racers, COURSE_M, B1, B2, segAt);
      const place = 1 + racers.filter((r) => r !== player && r.progress > player.progress).length;
      const toFinish = Math.max(0, COURSE_M - player.progress);
      drawText(c, `P${place}/4`, W * 0.06, H * 0.16, H * 0.06, place === 1 ? PALETTE.good : "#fff", "left", "800");
      drawText(c, `${Math.round(toFinish)}m`, W * 0.94, H * 0.16, H * 0.045, "#fff", "right", "800");
      const segName = ["RUN", "SWIM", "FLY"][segAt(player.progress)];
      drawText(c, segName, W * 0.5, H * 0.16, H * 0.05, segColor(segAt(player.progress)), "center", "800");

      if (phase === "count") drawCountdown(c, W, H, Math.ceil(countT - 0.4), (countT - 0.4) - Math.floor(countT - 0.4));
      if (phase === "finish") result?.render(ctx);
    },

    destroy() {
      ctx.requestControls([]);
    },
  };
}

function segColor(seg: Seg): string {
  return seg === 0 ? PALETTE.run : seg === 1 ? PALETTE.swim : PALETTE.fly;
}

/** Vertical screen position for a racer, blended across segment boundaries. */
function racerScreenY(ctx: GameContext, r: Racer, segAt: (p: number) => Seg): number {
  const H = ctx.height;
  const groundY = H * 0.82;
  const waterY = H * 0.5;
  const u = Math.min(ctx.width, H) * 0.06;
  const laneOff = r.lane * u * 0.55;
  const yForSeg = (seg: Seg): number => {
    if (seg === 0) return groundY - u * 0.9 - laneOff;
    if (seg === 1) return waterY + u * 0.4 - laneOff * 0.6 + Math.sin(r.phase * 6) * u * 0.1;
    return H * 0.36 - laneOff + Math.sin(r.phase * 4) * u * 0.2;
  };
  return yForSeg(segAt(r.progress));
}

function drawPost(c: CanvasRenderingContext2D, x: number, y: number, _icon: string): void {
  if (x < -20 || x > 100000) return;
  c.save();
  c.fillStyle = rgba("#ffffff", 0.5);
  c.fillRect(x - 2, y - 60, 4, 60);
  c.restore();
}

function drawFinish(c: CanvasRenderingContext2D, x: number, H: number, t: number): void {
  const top = H * 0.12;
  const bot = H * 0.85;
  // poles
  c.fillStyle = "#d23b3b";
  c.fillRect(x - 4, top, 6, bot - top);
  // checker banner
  const bw = Math.min(60, H * 0.16);
  const rows = 6;
  const cell = bw / 2;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < 2; j++) {
      c.fillStyle = (i + j) % 2 === 0 ? "#222" : "#fff";
      c.fillRect(x + j * cell, top + i * cell + Math.sin(t * 3 + i) * 2, cell, cell);
    }
  }
  c.fillStyle = "#222";
  c.font = `800 ${H * 0.04}px "Baloo 2", system-ui, sans-serif`;
  c.textAlign = "center";
  c.fillText("FINISH", x + bw, top - H * 0.02);
}

function drawMiniMap(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  racers: Racer[],
  course: number,
  b1: number,
  b2: number,
  _segAt: (p: number) => Seg,
): void {
  const x = W * 0.12;
  const y = H * 0.06;
  const w = W * 0.76;
  const h = H * 0.022;
  // track segments colored
  const segW = (m0: number, m1: number) => ((m1 - m0) / course) * w;
  c.fillStyle = rgba(PALETTE.run, 0.85);
  roundRect(c, x, y, segW(0, b1), h, h / 2);
  c.fill();
  c.fillStyle = rgba(PALETTE.swim, 0.85);
  c.fillRect(x + segW(0, b1), y, segW(b1, b2), h);
  c.fillStyle = rgba(PALETTE.fly, 0.85);
  roundRect(c, x + segW(0, b2), y, segW(b2, course), h, h / 2);
  c.fill();
  // racer dots
  for (const r of racers) {
    const rx = x + clamp(r.progress / course, 0, 1) * w;
    c.fillStyle = r.isPlayer ? "#ffffff" : r.look.body;
    c.beginPath();
    c.arc(rx, y + h / 2, r.isPlayer ? h * 0.9 : h * 0.7, 0, Math.PI * 2);
    c.fill();
    if (r.isPlayer) {
      c.strokeStyle = PALETTE.ink;
      c.lineWidth = 2;
      c.stroke();
    }
  }
}
