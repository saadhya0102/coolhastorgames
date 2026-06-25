import { PALETTE } from "./config";
import { mix } from "./ui";
import type { PlacedItem, ToppingDef } from "./types";
import { TOPPINGS } from "./config";

/** Map a bake value 0..1 to crust + cheese colours. */
function bakeColors(bake: number): { crust: string; cheese: string; sauce: string; char: number } {
  const d = Math.max(0, Math.min(1, bake));
  // golden peak around 0.7, then darkens, then chars
  let crust: string;
  let cheese: string;
  if (d < 0.7) {
    const t = d / 0.7;
    crust = mix(PALETTE.crustRaw, PALETTE.crust, t);
    cheese = mix("#f7e6b0", PALETTE.cheeseLight, t);
  } else if (d < 0.9) {
    const t = (d - 0.7) / 0.2;
    crust = mix(PALETTE.crust, PALETTE.crustDark, t);
    cheese = mix(PALETTE.cheeseLight, "#caa23e", t);
  } else {
    const t = (d - 0.9) / 0.1;
    crust = mix(PALETTE.crustDark, "#3a2412", t);
    cheese = mix("#caa23e", "#7a5e22", t);
  }
  const sauce = mix(PALETTE.tomato, "#7e2418", Math.max(0, (d - 0.6) / 0.4));
  const char = Math.max(0, (d - 0.86) / 0.14);
  return { crust, cheese, sauce, char };
}

export interface DrawPizzaOpts {
  placed: PlacedItem[];
  /** doneness used for colouring 0..1 */
  bake: number;
  premiumSauce: boolean;
  /** cut angles in [0, PI) to render slice lines */
  cuts?: number[];
  /** time for subtle shimmer */
  t: number;
  /** show steam shimmer (fresh out of oven) */
  glow?: boolean;
}

export function drawPizza(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: DrawPizzaOpts,
): void {
  const { crust, cheese, sauce, char } = bakeColors(opts.bake);

  // crust base
  c.save();
  c.translate(cx, cy);

  // outer crust ring
  const cg = c.createRadialGradient(0, -R * 0.2, R * 0.4, 0, 0, R);
  cg.addColorStop(0, mix(crust, "#fff", 0.12));
  cg.addColorStop(0.82, crust);
  cg.addColorStop(1, mix(crust, "#000", 0.18));
  c.fillStyle = cg;
  c.beginPath();
  c.arc(0, 0, R, 0, Math.PI * 2);
  c.fill();

  // sauce layer
  const sr = R * 0.86;
  c.fillStyle = sauce;
  c.beginPath();
  c.arc(0, 0, sr, 0, Math.PI * 2);
  c.fill();

  // cheese layer (mottled)
  const chR = R * 0.8;
  const chg = c.createRadialGradient(0, -chR * 0.2, chR * 0.2, 0, 0, chR);
  chg.addColorStop(0, mix(cheese, "#fff", 0.18));
  chg.addColorStop(1, cheese);
  c.fillStyle = chg;
  c.beginPath();
  c.arc(0, 0, chR, 0, Math.PI * 2);
  c.fill();

  // cheese blobs / texture (deterministic)
  c.save();
  c.beginPath();
  c.arc(0, 0, chR, 0, Math.PI * 2);
  c.clip();
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996;
    const rr = chR * (0.18 + ((i * 13) % 70) / 100);
    const bx = Math.cos(a) * rr;
    const by = Math.sin(a) * rr;
    const s = chR * (0.06 + ((i * 7) % 5) / 60);
    c.fillStyle = i % 3 === 0 ? mix(cheese, "#fff", 0.25) : mix(cheese, "#c79a3a", 0.3);
    c.globalAlpha = 0.5;
    c.beginPath();
    c.ellipse(bx, by, s, s * 0.8, a, 0, Math.PI * 2);
    c.fill();
  }
  // premium sauce sheen / basil flecks
  if (opts.premiumSauce) {
    c.globalAlpha = 0.6;
    for (let i = 0; i < 10; i++) {
      const a = i * 1.7 + 0.4;
      const rr = chR * (0.3 + ((i * 17) % 50) / 100);
      c.fillStyle = PALETTE.basil;
      c.beginPath();
      c.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, chR * 0.05, chR * 0.025, a, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  c.restore();

  // toppings
  for (const p of opts.placed) {
    const def = TOPPINGS[p.id];
    const pr = R * 0.12 * def.size * (0.6 + 0.4 * p.pop);
    const px = p.x * R * 0.78;
    const py = p.y * R * 0.78;
    const pop = p.pop;
    c.save();
    c.translate(px, py);
    if (pop < 1) {
      c.globalAlpha = pop;
      c.scale(0.5 + 0.5 * pop, 0.5 + 0.5 * pop);
    }
    drawTopping(c, 0, 0, pr, def, p.rot, opts.bake);
    c.restore();
  }

  // char blotches when overbaked (drawn on top, inside crust)
  if (char > 0) {
    c.save();
    c.beginPath();
    c.arc(0, 0, R * 0.98, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = `rgba(20,10,6,${0.5 * char})`;
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996;
      const rr = R * (0.2 + ((i * 19) % 75) / 100);
      const s = R * (0.05 + ((i * 11) % 6) / 50) * char;
      c.beginPath();
      c.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, s, s * 0.8, a, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  // cut lines
  if (opts.cuts && opts.cuts.length > 0) {
    for (const ang of opts.cuts) {
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      c.strokeStyle = "rgba(120,78,40,0.55)";
      c.lineWidth = Math.max(2, R * 0.018);
      c.beginPath();
      c.moveTo(-dx * R * 0.97, -dy * R * 0.97);
      c.lineTo(dx * R * 0.97, dy * R * 0.97);
      c.stroke();
      c.strokeStyle = "rgba(255,247,225,0.5)";
      c.lineWidth = Math.max(1, R * 0.008);
      c.beginPath();
      c.moveTo(-dx * R * 0.97, -dy * R * 0.97);
      c.lineTo(dx * R * 0.97, dy * R * 0.97);
      c.stroke();
    }
  }

  // rim highlight
  c.lineWidth = Math.max(2, R * 0.03);
  c.strokeStyle = "rgba(255,255,255,0.16)";
  c.beginPath();
  c.arc(0, 0, R - c.lineWidth, Math.PI * 1.05, Math.PI * 1.75);
  c.stroke();

  if (opts.glow) {
    c.globalAlpha = 0.18 + 0.06 * Math.sin(opts.t * 6);
    c.fillStyle = "#fff6d0";
    c.beginPath();
    c.arc(0, 0, R * 1.05, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }

  c.restore();
}

/** Draw a single topping centered at x,y with radius r. Used on pizza + tray. */
export function drawTopping(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  def: ToppingDef,
  rot: number,
  bake = 0,
): void {
  const dark = Math.max(0, (bake - 0.7) / 0.3) * 0.5;
  const col = dark > 0 ? mix(def.color, "#2a1208", dark) : def.color;
  const acc = dark > 0 ? mix(def.accent, "#2a1208", dark) : def.accent;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  // soft drop shadow
  c.fillStyle = "rgba(58,36,24,0.18)";
  c.beginPath();
  c.ellipse(r * 0.12, r * 0.18, r, r * 0.9, 0, 0, Math.PI * 2);
  c.fill();

  switch (def.drawKind) {
    case "disc": {
      const g = c.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
      g.addColorStop(0, mix(acc, "#fff", 0.2));
      g.addColorStop(1, col);
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      // greasy curl rim
      c.strokeStyle = mix(col, "#000", 0.25);
      c.lineWidth = r * 0.16;
      c.beginPath();
      c.arc(0, 0, r * 0.86, 0, Math.PI * 2);
      c.stroke();
      // speckles
      c.fillStyle = mix(col, "#000", 0.35);
      for (let i = 0; i < 4; i++) {
        const a = i * 1.9;
        c.beginPath();
        c.arc(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.12, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case "cap": {
      // mushroom cross-section
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(0, -r * 0.1, r, r * 0.85, 0, Math.PI, 0);
      c.lineTo(r * 0.35, r * 0.7);
      c.lineTo(-r * 0.35, r * 0.7);
      c.closePath();
      c.fill();
      c.fillStyle = mix(col, "#fff", 0.3);
      c.fillRect(-r * 0.22, -r * 0.05, r * 0.44, r * 0.7);
      c.strokeStyle = acc;
      c.lineWidth = r * 0.1;
      c.beginPath();
      c.ellipse(0, -r * 0.1, r, r * 0.85, 0, Math.PI, 0);
      c.stroke();
      break;
    }
    case "arc": {
      c.strokeStyle = col;
      c.lineWidth = r * 0.5;
      c.lineCap = "round";
      c.beginPath();
      c.arc(0, 0, r * 0.7, Math.PI * 0.25, Math.PI * 1.6);
      c.stroke();
      c.strokeStyle = mix(col, "#fff", 0.25);
      c.lineWidth = r * 0.18;
      c.beginPath();
      c.arc(0, 0, r * 0.7, Math.PI * 0.3, Math.PI * 1.4);
      c.stroke();
      break;
    }
    case "ring": {
      c.strokeStyle = col;
      c.lineWidth = r * 0.42;
      c.beginPath();
      c.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = mix(col, "#fff", 0.2);
      c.lineWidth = r * 0.14;
      c.beginPath();
      c.arc(0, 0, r * 0.72, -0.4, 1.4);
      c.stroke();
      break;
    }
    case "chunk": {
      const g = c.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, mix(col, "#fff", 0.2));
      g.addColorStop(1, col);
      c.fillStyle = g;
      roundedChunk(c, r);
      c.fill();
      c.strokeStyle = acc;
      c.lineWidth = r * 0.12;
      roundedChunk(c, r);
      c.stroke();
      break;
    }
    case "strip": {
      c.strokeStyle = col;
      c.lineWidth = r * 0.7;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(-r, -r * 0.4);
      c.quadraticCurveTo(0, r * 0.5, r, -r * 0.3);
      c.stroke();
      c.strokeStyle = acc;
      c.lineWidth = r * 0.22;
      c.beginPath();
      c.moveTo(-r, -r * 0.4);
      c.quadraticCurveTo(0, r * 0.5, r, -r * 0.3);
      c.stroke();
      break;
    }
  }
  c.restore();
}

function roundedChunk(c: CanvasRenderingContext2D, r: number): void {
  const s = r * 0.85;
  const rad = r * 0.3;
  c.beginPath();
  c.moveTo(-s + rad, -s);
  c.arcTo(s, -s, s, s, rad);
  c.arcTo(s, s, -s, s, rad);
  c.arcTo(-s, s, -s, -s, rad);
  c.arcTo(-s, -s, s, -s, rad);
  c.closePath();
}

/** Deterministic position for placing a topping nicely on the pie. */
export function autoPlacePos(index: number): { x: number; y: number; rot: number } {
  const a = index * 2.39996; // golden angle
  const r = Math.min(0.92, 0.18 + 0.13 * Math.sqrt(index + 1));
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a };
}
