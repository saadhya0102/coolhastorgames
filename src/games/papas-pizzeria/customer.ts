import { clamp } from "@/engine";
import { Rng } from "./rng";
import { PALETTE, TOPPINGS, TOPPING_ORDER } from "./config";
import { mix } from "./ui";
import type {
  Customer,
  DayProfile,
  FaceMood,
  OrderSpec,
  ToppingId,
  ToppingReq,
} from "./types";

const FIRST_NAMES = [
  "Tony", "Mia", "Gus", "Rosa", "Vince", "Lena", "Bobby", "Pia", "Sal", "Nina",
  "Marco", "Dot", "Hank", "Ivy", "Otto", "Bea", "Cleo", "Rex", "Fran", "Joon",
  "Kai", "Lou", "Bruno", "Cici", "Theo", "Greta", "Milo", "Suki", "Dex", "Vera",
];

const SKINS = ["#f6cba0", "#e8b07e", "#c98a5a", "#a96a3c", "#8a5230", "#ffd9b3"];
const HAIRS = ["#2a1a12", "#5a3a1c", "#8a5a2a", "#1c1c1c", "#b8543a", "#9a9a9a", "#d8b14a", "#3a2a55"];
const SHIRTS = ["#4a8ad6", "#e05c6a", "#46b07a", "#f0a83a", "#8a5cd6", "#3aada0", "#e07a3a", "#6a6f7a"];

export function makeCustomer(seed: number, patienceMax: number): Customer {
  const r = new Rng(seed);
  const name = r.pick(FIRST_NAMES);
  return {
    seed,
    name,
    look: {
      skin: r.pick(SKINS),
      hair: r.pick(HAIRS),
      hairStyle: r.int(0, 3),
      shirt: r.pick(SHIRTS),
      bodyType: r.int(0, 2),
      faceType: r.int(0, 2),
    },
    patience: patienceMax,
    patienceMax,
    phase: r.range(0, Math.PI * 2),
  };
}

export function generateOrder(profile: DayProfile, seed: number): OrderSpec {
  const r = new Rng(seed ^ 0x9e3779b9);
  const n = r.int(profile.minToppings, profile.maxToppings);
  const pool = [...TOPPING_ORDER];
  // bias the available pool to the first 6 on early days for readability
  const available = profile.day <= 3 ? pool.slice(0, 6) : pool;
  const chosen: ToppingId[] = [];
  while (chosen.length < n && available.length > 0) {
    const idx = r.int(0, available.length - 1);
    const id = available[idx];
    available.splice(idx, 1);
    chosen.push(id);
  }
  const toppings: ToppingReq[] = chosen.map((id) => {
    const def = TOPPINGS[id];
    // big toppings get fewer; small discs get more
    const base = def.size > 1 ? r.int(3, 6) : r.int(4, 9);
    return { id, count: base };
  });

  const center = r.range(0.55, 0.82);
  const half = profile.bandWidth / 2;
  const lo = clamp(center - half, 0.18, 0.95);
  const hi = clamp(center + half, 0.2, 0.98);
  const label = center < 0.62 ? "Light" : center < 0.74 ? "Normal" : "Well-done";

  const slices = profile.sliceChoices[r.int(0, profile.sliceChoices.length - 1)];

  return { toppings, bake: { lo, hi, label }, slices };
}

export function moodFromPatience(p: number): FaceMood {
  if (p > 0.55) return "happy";
  if (p > 0.3) return "neutral";
  if (p > 0.12) return "worried";
  return "angry";
}

/** Draw a customer avatar centered horizontally at x, standing on baseline y. */
export function drawCustomer(
  c: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  scale: number,
  cust: Customer,
  mood: FaceMood,
  t: number,
  shake = 0,
): void {
  const look = cust.look;
  const bob = mood === "happy" ? Math.sin((t + cust.phase) * 4) * scale * 0.04 : 0;
  const sx = shake > 0 ? Math.sin(t * 50) * shake * scale * 0.12 : 0;

  c.save();
  c.translate(x + sx, baseY + bob);

  const bodyW = scale * (0.62 + look.bodyType * 0.08);
  const bodyH = scale * 0.78;
  const headR = scale * 0.34;

  // shadow
  c.fillStyle = "rgba(58,36,24,0.2)";
  c.beginPath();
  c.ellipse(0, scale * 0.06, bodyW * 0.7, scale * 0.1, 0, 0, Math.PI * 2);
  c.fill();

  // body / shirt
  const bg = c.createLinearGradient(0, -bodyH, 0, 0);
  bg.addColorStop(0, mix(look.shirt, "#fff", 0.18));
  bg.addColorStop(1, look.shirt);
  c.fillStyle = bg;
  roundBody(c, -bodyW / 2, -bodyH, bodyW, bodyH, scale * 0.22);
  c.fill();

  // collar
  c.fillStyle = mix(look.shirt, "#000", 0.15);
  c.beginPath();
  c.moveTo(-bodyW * 0.22, -bodyH);
  c.lineTo(0, -bodyH + scale * 0.16);
  c.lineTo(bodyW * 0.22, -bodyH);
  c.closePath();
  c.fill();

  // head
  const hy = -bodyH - headR * 0.62;
  c.fillStyle = look.skin;
  c.beginPath();
  c.arc(0, hy, headR, 0, Math.PI * 2);
  c.fill();
  // ears
  c.beginPath();
  c.arc(-headR * 0.95, hy, headR * 0.2, 0, Math.PI * 2);
  c.arc(headR * 0.95, hy, headR * 0.2, 0, Math.PI * 2);
  c.fill();

  // hair
  c.fillStyle = look.hair;
  drawHair(c, hy, headR, look.hairStyle);

  // face
  drawFace(c, hy, headR, mood, t + cust.phase, look.faceType);

  c.restore();
}

function roundBody(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawHair(c: CanvasRenderingContext2D, hy: number, r: number, style: number): void {
  switch (style) {
    case 0: // round cap
      c.beginPath();
      c.arc(0, hy - r * 0.05, r * 1.04, Math.PI * 1.05, Math.PI * 1.95);
      c.fill();
      break;
    case 1: // side part
      c.beginPath();
      c.arc(0, hy, r * 1.05, Math.PI, Math.PI * 2);
      c.lineTo(r * 1.05, hy);
      c.lineTo(r * 0.5, hy + r * 0.2);
      c.closePath();
      c.fill();
      break;
    case 2: // bun / top knot
      c.beginPath();
      c.arc(0, hy - r * 0.05, r * 1.02, Math.PI * 1.1, Math.PI * 1.9);
      c.fill();
      c.beginPath();
      c.arc(0, hy - r * 1.05, r * 0.28, 0, Math.PI * 2);
      c.fill();
      break;
    default: // spiky
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + (i / 5) * Math.PI;
        c.beginPath();
        c.moveTo(Math.cos(a) * r, hy + Math.sin(a) * r);
        c.lineTo(Math.cos(a) * r * 1.3, hy + Math.sin(a) * r * 1.3);
        c.lineTo(Math.cos(a + 0.25) * r, hy + Math.sin(a + 0.25) * r);
        c.closePath();
        c.fill();
      }
      c.beginPath();
      c.arc(0, hy, r * 1.0, Math.PI, Math.PI * 2);
      c.fill();
  }
}

function drawFace(c: CanvasRenderingContext2D, hy: number, r: number, mood: FaceMood, t: number, faceType: number): void {
  const eyeY = hy - r * 0.05;
  const eyeX = r * 0.4;
  const blink = Math.sin(t * 1.3) > 0.97 ? 0.15 : 1;

  // eyes
  c.fillStyle = "#fff";
  for (const sgn of [-1, 1]) {
    c.beginPath();
    c.ellipse(sgn * eyeX, eyeY, r * 0.18, r * 0.2 * blink, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = PALETTE.ink;
  const look = mood === "angry" ? -0.04 : Math.sin(t * 0.7) * 0.06;
  for (const sgn of [-1, 1]) {
    c.beginPath();
    c.arc(sgn * eyeX + look * r, eyeY, r * 0.09 * (blink > 0.5 ? 1 : 0.4), 0, Math.PI * 2);
    c.fill();
  }

  // brows for mood
  c.strokeStyle = PALETTE.ink;
  c.lineWidth = r * 0.07;
  c.lineCap = "round";
  if (mood === "angry" || mood === "worried") {
    const tilt = mood === "angry" ? r * 0.16 : r * 0.08;
    for (const sgn of [-1, 1]) {
      c.beginPath();
      c.moveTo(sgn * eyeX - sgn * r * 0.16, eyeY - r * 0.34 + sgn * -tilt * 0 - tilt);
      c.lineTo(sgn * eyeX + sgn * r * 0.16, eyeY - r * 0.34 + sgn * tilt);
      c.stroke();
    }
  }

  // cheeks for happy
  if (mood === "happy") {
    c.fillStyle = "rgba(230,90,80,0.3)";
    for (const sgn of [-1, 1]) {
      c.beginPath();
      c.arc(sgn * r * 0.55, hy + r * 0.28, r * 0.14, 0, Math.PI * 2);
      c.fill();
    }
  }

  // mouth
  c.strokeStyle = PALETTE.ink;
  c.lineWidth = r * 0.08;
  c.fillStyle = "#7a2a28";
  const my = hy + r * 0.42;
  c.beginPath();
  if (mood === "happy") {
    c.arc(0, my - r * 0.1, r * 0.34, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
  } else if (mood === "neutral") {
    c.moveTo(-r * 0.22, my);
    c.lineTo(r * 0.22, my);
    c.stroke();
  } else if (mood === "worried") {
    c.moveTo(-r * 0.22, my + r * 0.05);
    c.quadraticCurveTo(0, my - r * 0.08, r * 0.22, my + r * 0.05);
    c.stroke();
  } else {
    // angry open frown
    c.arc(0, my + r * 0.16, r * 0.3, 1.15 * Math.PI, 1.85 * Math.PI);
    c.stroke();
  }

  // faceType-specific accessory
  if (faceType === 1) {
    // glasses
    c.strokeStyle = "rgba(58,36,24,0.7)";
    c.lineWidth = r * 0.05;
    for (const sgn of [-1, 1]) {
      c.beginPath();
      c.arc(sgn * eyeX, eyeY, r * 0.26, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(-eyeX + r * 0.26, eyeY);
    c.lineTo(eyeX - r * 0.26, eyeY);
    c.stroke();
  }
}
