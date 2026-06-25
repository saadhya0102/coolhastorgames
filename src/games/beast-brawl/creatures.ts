/** Beast Brawl - species data, stat math and canvas creature rendering.
 * Everything is drawn procedurally with shapes so no assets are needed. */

export type ShapeKind =
  | "blob"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "star"
  | "bolt"
  | "square"
  | "swirl";

/** Special skills a monster can have. */
export type SkillKey =
  | "burn"
  | "heal"
  | "shield"
  | "double"
  | "rally"
  | "crit";

export interface Species {
  key: string;
  name: string;
  /** type color (drives the body fill + theme) */
  color: string;
  shape: ShapeKind;
  skill: SkillKey;
  baseHP: number;
  baseATK: number;
  baseSPD: number;
}

export interface SkillInfo {
  name: string;
  desc: string;
}

export const SKILLS: Record<SkillKey, SkillInfo> = {
  burn: { name: "Scorch", desc: "Attacks set the target on fire for 3 turns." },
  heal: { name: "Mend", desc: "Heals the most hurt ally each turn." },
  shield: { name: "Bulwark", desc: "Takes 40% less damage from hits." },
  double: { name: "Flurry", desc: "Strikes twice every turn." },
  rally: { name: "Rally", desc: "Buffs the whole team's ATK at battle start." },
  crit: { name: "Ambush", desc: "35% chance to deal double damage." },
};

/** Stat growth applied per level above 1. */
const HP_GROW = 11;
const ATK_GROW = 3;
const SPD_GROW = 1;

export const SPECIES: Species[] = [
  { key: "ember", name: "Emberling", color: "#ff6b4a", shape: "triangle", skill: "burn", baseHP: 48, baseATK: 13, baseSPD: 9 },
  { key: "aqua", name: "Aqualet", color: "#3aa6ff", shape: "blob", skill: "heal", baseHP: 58, baseATK: 9, baseSPD: 7 },
  { key: "leaf", name: "Leaflet", color: "#43c46a", shape: "diamond", skill: "shield", baseHP: 66, baseATK: 8, baseSPD: 5 },
  { key: "spark", name: "Sparkit", color: "#ffd23a", shape: "bolt", skill: "double", baseHP: 42, baseATK: 8, baseSPD: 12 },
  { key: "terra", name: "Terrabite", color: "#b07a44", shape: "hexagon", skill: "shield", baseHP: 78, baseATK: 10, baseSPD: 4 },
  { key: "gust", name: "Gustling", color: "#5ee0d0", shape: "swirl", skill: "rally", baseHP: 50, baseATK: 10, baseSPD: 11 },
  { key: "frost", name: "Frostnip", color: "#9fd8ff", shape: "square", skill: "crit", baseHP: 52, baseATK: 12, baseSPD: 8 },
  { key: "shade", name: "Shadeling", color: "#a16bff", shape: "star", skill: "crit", baseHP: 46, baseATK: 15, baseSPD: 10 },
];

export const STARTER_KEYS = ["ember", "aqua", "leaf", "spark"];

export function speciesByKey(key: string): Species {
  return SPECIES.find((s) => s.key === key) ?? SPECIES[0];
}

export type Side = "ally" | "enemy";

export interface Monster {
  species: Species;
  level: number;
  maxHp: number;
  hp: number;
  atk: number;
  spd: number;
  side: Side;
  alive: boolean;
  /** ATK used during the current battle (rally buffs apply here, reset per fight) */
  battleAtk: number;
  burn: number;
  rallied: boolean;
  /** screen center, updated each render so combat fx can find it */
  x: number;
  y: number;
  size: number;
  /** lunge animation 1->0 */
  lunge: number;
  lungeTx: number;
  lungeTy: number;
  /** white hit flash 1->0 */
  hitFlash: number;
  /** spawn / idle bob phase */
  phase: number;
}

export function maxHpFor(sp: Species, level: number): number {
  return Math.round(sp.baseHP + HP_GROW * (level - 1));
}
export function atkFor(sp: Species, level: number): number {
  return Math.round(sp.baseATK + ATK_GROW * (level - 1));
}
export function spdFor(sp: Species, level: number): number {
  return Math.round(sp.baseSPD + SPD_GROW * (level - 1));
}

export function makeMonster(sp: Species, level: number, side: Side): Monster {
  const maxHp = maxHpFor(sp, level);
  return {
    species: sp,
    level,
    maxHp,
    hp: maxHp,
    atk: atkFor(sp, level),
    spd: spdFor(sp, level),
    side,
    alive: true,
    battleAtk: atkFor(sp, level),
    burn: 0,
    rallied: false,
    x: 0,
    y: 0,
    size: 0,
    lunge: 0,
    lungeTx: 0,
    lungeTy: 0,
    hitFlash: 0,
    phase: Math.random() * Math.PI * 2,
  };
}

/** A lightweight color shade helper. */
function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v : 255 - v) * amt)));
  const to2 = (v: number) => f(v).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function bodyPath(
  ctx: CanvasRenderingContext2D,
  shape: ShapeKind,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case "blob": {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    }
    case "triangle": {
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        const x = cx + Math.cos(a) * r * 1.15;
        const y = cy + Math.sin(a) * r * 1.05;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "diamond": {
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r * 1.15);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    }
    case "square": {
      const s = r * 0.92;
      ctx.moveTo(cx - s, cy - s);
      ctx.lineTo(cx + s, cy - s);
      ctx.lineTo(cx + s, cy + s);
      ctx.lineTo(cx - s, cy + s);
      ctx.closePath();
      break;
    }
    case "hexagon": {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * r * 1.08;
        const y = cy + Math.sin(a) * r * 1.08;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "star": {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r * 1.2 : r * 0.55;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "bolt": {
      const w = r * 0.95;
      const hgt = r * 1.25;
      ctx.moveTo(cx - w * 0.2, cy - hgt);
      ctx.lineTo(cx + w, cy - hgt * 0.1);
      ctx.lineTo(cx + w * 0.15, cy + hgt * 0.05);
      ctx.lineTo(cx + w * 0.5, cy + hgt);
      ctx.lineTo(cx - w, cy - hgt * 0.05);
      ctx.lineTo(cx - w * 0.1, cy - hgt * 0.1);
      ctx.closePath();
      break;
    }
    case "swirl": {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    }
  }
}

/** Draws a cute creature centered at (cx, cy) with the given radius.
 * facing: +1 looks right, -1 looks left. */
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  m: Monster,
  cx: number,
  cy: number,
  r: number,
  facing: number,
): void {
  const sp = m.species;
  ctx.save();

  // drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.05, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  bodyPath(ctx, sp.shape, cx, cy, r);
  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, shade(sp.color, 0.25));
  grad.addColorStop(1, shade(sp.color, -0.25));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.strokeStyle = shade(sp.color, -0.45);
  ctx.stroke();

  if (sp.shape === "swirl") {
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      const t = i / 27;
      const a = t * Math.PI * 4;
      const rad = r * 0.85 * (1 - t);
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // eyes
  const eo = r * 0.32;
  const eyeY = cy - r * 0.12;
  const ex = facing >= 0 ? eo * 0.4 : -eo * 0.4;
  for (const dxs of [-1, 1]) {
    const exC = cx + dxs * eo;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(exC, eyeY, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#16203a";
    ctx.beginPath();
    ctx.arc(exC + ex, eyeY + r * 0.04, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  // little smile
  ctx.strokeStyle = "rgba(20,28,46,0.8)";
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.18, r * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // hit flash overlay
  if (m.hitFlash > 0) {
    bodyPath(ctx, sp.shape, cx, cy, r);
    ctx.fillStyle = `rgba(255,255,255,${0.7 * m.hitFlash})`;
    ctx.fill();
  }

  ctx.restore();
}
