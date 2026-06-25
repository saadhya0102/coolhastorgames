/**
 * Procedural fruit + bomb + power-up art.
 *
 * Each kind has a `FruitDef` (colors, scoring) and is drawn entirely with
 * canvas paths / gradients — no images. We expose:
 *   - `drawFruit`  : a whole fruit, rotated, with shading + kind detail.
 *   - `drawHalf`   : one side of a sliced fruit (clipped) + an inner flesh face.
 *   - `drawBomb`   : the bomb (animated fuse + spark), used in-flight.
 * Helpers draw the "inner" detail (seeds, segments) shared by whole + halves.
 */
import type { FruitDef, FruitKind, Fruit, Half } from "./types";
import { TAU, seeded, shade, withAlpha } from "./types";

export const FRUIT_DEFS: Record<FruitKind, FruitDef> = {
  watermelon: {
    kind: "watermelon",
    skin: "#3aa856",
    skinDark: "#1f6e38",
    flesh: "#ff5d6c",
    juice: "#ff4d63",
    points: 1,
    sizeMul: 1.25,
    weight: 12,
    special: false,
  },
  apple: {
    kind: "apple",
    skin: "#e8413c",
    skinDark: "#a82420",
    flesh: "#fff2d6",
    juice: "#ff9aa6",
    points: 1,
    sizeMul: 0.95,
    weight: 16,
    special: false,
  },
  orange: {
    kind: "orange",
    skin: "#ff9b21",
    skinDark: "#cf6f06",
    flesh: "#ffd27a",
    juice: "#ffb43d",
    points: 1,
    sizeMul: 1.0,
    weight: 15,
    special: false,
  },
  lemon: {
    kind: "lemon",
    skin: "#ffe04d",
    skinDark: "#d9b41f",
    flesh: "#fff6c2",
    juice: "#ffe680",
    points: 2,
    sizeMul: 0.82,
    weight: 10,
    special: false,
  },
  banana: {
    kind: "banana",
    skin: "#ffd83a",
    skinDark: "#c79a14",
    flesh: "#fff4cf",
    juice: "#fff0b0",
    points: 1,
    sizeMul: 1.05,
    weight: 11,
    special: false,
  },
  pineapple: {
    kind: "pineapple",
    skin: "#e0a32a",
    skinDark: "#9c6c10",
    flesh: "#ffe27a",
    juice: "#ffd35a",
    points: 2,
    sizeMul: 1.2,
    weight: 8,
    special: false,
  },
  strawberry: {
    kind: "strawberry",
    skin: "#e83352",
    skinDark: "#a4132e",
    flesh: "#ff8fa0",
    juice: "#ff5070",
    points: 2,
    sizeMul: 0.8,
    weight: 11,
    special: false,
  },
  kiwi: {
    kind: "kiwi",
    skin: "#8a5a2b",
    skinDark: "#5c3a18",
    flesh: "#9bd64a",
    juice: "#b6e36a",
    points: 2,
    sizeMul: 0.85,
    weight: 9,
    special: false,
  },
  plum: {
    kind: "plum",
    skin: "#7b3f98",
    skinDark: "#4f2563",
    flesh: "#e7b6ff",
    juice: "#ba4dff",
    points: 2,
    sizeMul: 0.78,
    weight: 8,
    special: false,
  },
  bomb: {
    kind: "bomb",
    skin: "#2a2d33",
    skinDark: "#111317",
    flesh: "#2a2d33",
    juice: "#ff7a18",
    points: 0,
    sizeMul: 1.0,
    weight: 0,
    special: true,
  },
  freeze: {
    kind: "freeze",
    skin: "#7fdcff",
    skinDark: "#2f9fd6",
    flesh: "#dffaff",
    juice: "#bfeeff",
    points: 3,
    sizeMul: 0.95,
    weight: 0,
    special: true,
  },
  double: {
    kind: "double",
    skin: "#ffd24a",
    skinDark: "#c98f12",
    flesh: "#fff3c0",
    juice: "#ffe27a",
    points: 3,
    sizeMul: 0.95,
    weight: 0,
    special: true,
  },
  frenzy: {
    kind: "frenzy",
    skin: "#ffcf33",
    skinDark: "#c79410",
    flesh: "#fff2c0",
    juice: "#ffe070",
    points: 3,
    sizeMul: 0.95,
    weight: 0,
    special: true,
  },
};

/** The normal sliceable fruit (excludes bomb + power-ups). */
export const NORMAL_FRUIT: FruitKind[] = [
  "watermelon",
  "apple",
  "orange",
  "lemon",
  "banana",
  "pineapple",
  "strawberry",
  "kiwi",
  "plum",
];

type Ctx = CanvasRenderingContext2D;

/** Apply a soft top-left light + bottom-right shadow over a circular body. */
function shadeSphere(c: Ctx, r: number, base: string): void {
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.15);
  g.addColorStop(0, shade(base, 0.22));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -0.28));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.fill();
}

/** A glossy specular highlight blob in the upper-left. */
function specular(c: Ctx, r: number): void {
  const g = c.createRadialGradient(
    -r * 0.4,
    -r * 0.45,
    0,
    -r * 0.4,
    -r * 0.45,
    r * 0.6,
  );
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(-r * 0.34, -r * 0.4, r * 0.42, r * 0.3, -0.6, 0, TAU);
  c.fill();
}

// ---------------------------------------------------------------------------
// Per-kind skin detail (drawn after the base sphere, before specular)
// ---------------------------------------------------------------------------

function drawSkinDetail(c: Ctx, def: FruitDef, r: number, seed: number): void {
  switch (def.kind) {
    case "watermelon": {
      c.strokeStyle = withAlpha(def.skinDark, 0.85);
      c.lineWidth = r * 0.12;
      c.lineCap = "round";
      for (let i = -2; i <= 2; i++) {
        const off = (i / 2.4) * r;
        c.beginPath();
        c.moveTo(off, -r * 0.96);
        c.quadraticCurveTo(off * 1.5, 0, off, r * 0.96);
        c.stroke();
      }
      break;
    }
    case "orange": {
      c.fillStyle = withAlpha(def.skinDark, 0.25);
      for (let i = 0; i < 28; i++) {
        const a = seeded(seed, i) * TAU;
        const rr = Math.sqrt(seeded(seed, i + 50)) * r * 0.9;
        c.beginPath();
        c.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.035, 0, TAU);
        c.fill();
      }
      drawLeaf(c, r);
      break;
    }
    case "lemon": {
      c.fillStyle = withAlpha("#ffffff", 0.18);
      for (let i = 0; i < 16; i++) {
        const a = seeded(seed, i) * TAU;
        const rr = Math.sqrt(seeded(seed, i + 30)) * r * 0.85;
        c.beginPath();
        c.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.03, 0, TAU);
        c.fill();
      }
      break;
    }
    case "apple": {
      // stem + leaf
      c.strokeStyle = "#6b4423";
      c.lineWidth = r * 0.09;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(0, -r * 0.78);
      c.quadraticCurveTo(r * 0.1, -r * 1.05, r * 0.04, -r * 1.18);
      c.stroke();
      drawLeaf(c, r);
      // sheen stripe
      c.fillStyle = "rgba(255,255,255,0.12)";
      c.beginPath();
      c.ellipse(r * 0.25, r * 0.1, r * 0.14, r * 0.5, 0.3, 0, TAU);
      c.fill();
      break;
    }
    case "strawberry": {
      c.fillStyle = withAlpha("#ffe9a8", 0.9);
      for (let i = 0; i < 22; i++) {
        const a = seeded(seed, i) * TAU;
        const rr = Math.sqrt(seeded(seed, i + 70)) * r * 0.82;
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a) * rr * 1.05 + r * 0.1;
        c.save();
        c.translate(sx, sy);
        c.rotate(a);
        c.beginPath();
        c.ellipse(0, 0, r * 0.04, r * 0.07, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      // green calyx
      c.fillStyle = "#3fa850";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        c.save();
        c.translate(0, -r * 0.7);
        c.rotate(a * 0.4);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(r * 0.18, -r * 0.28);
        c.lineTo(r * 0.32, 0.0);
        c.closePath();
        c.fill();
        c.restore();
      }
      break;
    }
    case "kiwi": {
      c.fillStyle = withAlpha(def.skinDark, 0.5);
      for (let i = 0; i < 40; i++) {
        const a = seeded(seed, i) * TAU;
        const rr = Math.sqrt(seeded(seed, i + 90)) * r * 0.95;
        c.beginPath();
        c.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.018, 0, TAU);
        c.fill();
      }
      break;
    }
    case "pineapple": {
      // diamond cross-hatch
      c.strokeStyle = withAlpha(def.skinDark, 0.6);
      c.lineWidth = r * 0.04;
      const step = r * 0.32;
      for (let gx = -1.2; gx <= 1.2; gx += step / r) {
        c.beginPath();
        c.moveTo(gx * r - r, -r);
        c.lineTo(gx * r + r, r);
        c.stroke();
        c.beginPath();
        c.moveTo(gx * r + r, -r);
        c.lineTo(gx * r - r, r);
        c.stroke();
      }
      // crown
      c.fillStyle = "#3fa850";
      for (let i = -2; i <= 2; i++) {
        c.save();
        c.translate(0, -r * 0.85);
        c.rotate(i * 0.35);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(r * 0.12, -r * 0.6);
        c.lineTo(r * 0.24, 0);
        c.closePath();
        c.fill();
        c.restore();
      }
      break;
    }
    case "banana": {
      // ridge shading along the crescent
      c.strokeStyle = withAlpha(def.skinDark, 0.4);
      c.lineWidth = r * 0.05;
      for (let i = -1; i <= 1; i++) {
        c.beginPath();
        c.moveTo(-r * 0.7, i * r * 0.18);
        c.quadraticCurveTo(0, i * r * 0.18 + r * 0.2, r * 0.7, i * r * 0.18);
        c.stroke();
      }
      break;
    }
    case "plum": {
      c.fillStyle = "rgba(255,255,255,0.10)";
      c.beginPath();
      c.ellipse(r * 0.28, r * 0.08, r * 0.12, r * 0.45, 0.3, 0, TAU);
      c.fill();
      break;
    }
    default:
      break;
  }
}

function drawLeaf(c: Ctx, r: number): void {
  c.save();
  c.translate(r * 0.18, -r * 0.92);
  c.rotate(0.5);
  c.fillStyle = "#4cae52";
  c.beginPath();
  c.ellipse(0, 0, r * 0.26, r * 0.12, 0, 0, TAU);
  c.fill();
  c.strokeStyle = "#2f7d36";
  c.lineWidth = r * 0.02;
  c.beginPath();
  c.moveTo(-r * 0.24, 0);
  c.lineTo(r * 0.24, 0);
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------------------
// Whole fruit
// ---------------------------------------------------------------------------

export function drawFruit(c: Ctx, f: Fruit): void {
  const r = f.radius;
  c.save();
  c.translate(f.x, f.y);
  // subtle squash from wobble
  const sq = 1 + Math.sin(f.wobble * 6) * 0.02;
  c.scale(1 / sq, sq);
  c.rotate(f.angle);

  // drop shadow on ground-facing side handled by gradient; add contact glow
  if (f.golden) {
    const gl = c.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.7);
    gl.addColorStop(0, "rgba(255,225,120,0.5)");
    gl.addColorStop(1, "rgba(255,225,120,0)");
    c.fillStyle = gl;
    c.beginPath();
    c.arc(0, 0, r * 1.7, 0, TAU);
    c.fill();
  }

  if (f.def.kind === "bomb") {
    drawBombBody(c, r, f.wobble);
  } else {
    const base = f.golden ? "#ffd24a" : f.def.skin;
    shadeSphere(c, r, base);
    drawSkinDetail(c, f.def, r, f.seed);
    specular(c, r);
    if (f.golden) drawSparkle(c, r, f.wobble, f.seed);
  }
  c.restore();
}

function drawSparkle(c: Ctx, r: number, t: number, seed: number): void {
  c.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 3; i++) {
    const ph = t * 3 + seeded(seed, i) * 6;
    const a = seeded(seed, i + 5) * TAU + t;
    const rr = r * (0.4 + 0.4 * seeded(seed, i + 9));
    const s = (0.5 + 0.5 * Math.sin(ph)) * r * 0.12;
    const sx = Math.cos(a) * rr;
    const sy = Math.sin(a) * rr;
    drawStar(c, sx, sy, s);
  }
}

function drawStar(c: Ctx, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.moveTo(0, -s);
  c.lineTo(s * 0.25, -s * 0.25);
  c.lineTo(s, 0);
  c.lineTo(s * 0.25, s * 0.25);
  c.lineTo(0, s);
  c.lineTo(-s * 0.25, s * 0.25);
  c.lineTo(-s, 0);
  c.lineTo(-s * 0.25, -s * 0.25);
  c.closePath();
  c.fill();
  c.restore();
}

// ---------------------------------------------------------------------------
// Bomb
// ---------------------------------------------------------------------------

function drawBombBody(c: Ctx, r: number, t: number): void {
  // pulsing danger glow
  const pulse = 0.5 + 0.5 * Math.sin(t * 8);
  const gl = c.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.8);
  gl.addColorStop(0, `rgba(255,40,40,${0.18 + pulse * 0.18})`);
  gl.addColorStop(1, "rgba(255,40,40,0)");
  c.fillStyle = gl;
  c.beginPath();
  c.arc(0, 0, r * 1.8, 0, TAU);
  c.fill();

  // metal sphere
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, "#5a606b");
  g.addColorStop(0.5, "#2a2d33");
  g.addColorStop(1, "#0b0d11");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.fill();

  // rim light
  c.strokeStyle = "rgba(255,80,80,0.4)";
  c.lineWidth = r * 0.05;
  c.beginPath();
  c.arc(0, 0, r * 0.97, 0, TAU);
  c.stroke();

  // specular
  c.fillStyle = "rgba(255,255,255,0.5)";
  c.beginPath();
  c.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.14, -0.6, 0, TAU);
  c.fill();

  // fuse cap
  c.fillStyle = "#caa15a";
  c.fillRect(-r * 0.16, -r * 1.12, r * 0.32, r * 0.28);

  // fuse
  c.strokeStyle = "#7a5a38";
  c.lineWidth = r * 0.09;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(0, -r * 1.05);
  c.quadraticCurveTo(r * 0.4, -r * 1.35, r * 0.28, -r * 1.6);
  c.stroke();

  // spark
  const sx = r * 0.28 + Math.cos(t * 30) * r * 0.05;
  const sy = -r * 1.6 + Math.sin(t * 30) * r * 0.05;
  const sg = c.createRadialGradient(sx, sy, 0, sx, sy, r * 0.4);
  sg.addColorStop(0, "rgba(255,240,180,1)");
  sg.addColorStop(0.5, "rgba(255,150,40,0.9)");
  sg.addColorStop(1, "rgba(255,80,0,0)");
  c.fillStyle = sg;
  c.beginPath();
  c.arc(sx, sy, r * (0.28 + pulse * 0.12), 0, TAU);
  c.fill();
}

// ---------------------------------------------------------------------------
// Inner flesh + cut face (shared by halves)
// ---------------------------------------------------------------------------

function drawFleshFace(c: Ctx, def: FruitDef, r: number, seed: number): void {
  // The cut face is the local x-axis line (y = 0). The flesh interior fills the
  // half-disc on the body side; this is drawn while already clipped to a half.
  c.fillStyle = def.flesh;
  c.beginPath();
  c.arc(0, 0, r * 0.92, 0, TAU);
  c.fill();

  switch (def.kind) {
    case "watermelon": {
      // rind ring
      c.strokeStyle = "#eaffea";
      c.lineWidth = r * 0.1;
      c.beginPath();
      c.arc(0, 0, r * 0.86, 0, TAU);
      c.stroke();
      c.strokeStyle = def.skinDark;
      c.lineWidth = r * 0.06;
      c.beginPath();
      c.arc(0, 0, r * 0.93, 0, TAU);
      c.stroke();
      // seeds
      c.fillStyle = "#2a1a12";
      for (let i = 0; i < 10; i++) {
        const a = seeded(seed, i) * TAU;
        const rr = (0.2 + seeded(seed, i + 20) * 0.55) * r;
        c.save();
        c.translate(Math.cos(a) * rr, Math.sin(a) * rr);
        c.rotate(a);
        c.beginPath();
        c.ellipse(0, 0, r * 0.04, r * 0.07, 0, 0, TAU);
        c.fill();
        c.restore();
      }
      break;
    }
    case "orange":
    case "lemon": {
      c.strokeStyle = withAlpha("#ffffff", 0.7);
      c.lineWidth = r * 0.04;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
        c.stroke();
      }
      c.strokeStyle = withAlpha(def.skin, 0.9);
      c.lineWidth = r * 0.09;
      c.beginPath();
      c.arc(0, 0, r * 0.88, 0, TAU);
      c.stroke();
      break;
    }
    case "kiwi": {
      c.fillStyle = "#f3fbe0";
      c.beginPath();
      c.arc(0, 0, r * 0.28, 0, TAU);
      c.fill();
      c.fillStyle = "#1d1d1d";
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        c.beginPath();
        c.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.025, r * 0.04, a, 0, TAU);
        c.fill();
      }
      c.strokeStyle = def.skin;
      c.lineWidth = r * 0.1;
      c.beginPath();
      c.arc(0, 0, r * 0.88, 0, TAU);
      c.stroke();
      break;
    }
    case "apple": {
      c.fillStyle = "#e9d9a8";
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.5;
        c.save();
        c.translate(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
        c.rotate(a);
        c.beginPath();
        c.ellipse(0, 0, r * 0.05, r * 0.08, 0, 0, TAU);
        c.fillStyle = "#5a3a1a";
        c.fill();
        c.restore();
      }
      break;
    }
    case "strawberry": {
      c.fillStyle = withAlpha("#ffffff", 0.5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
        c.lineWidth = r * 0.02;
        c.strokeStyle = withAlpha("#ffd0d8", 0.7);
        c.stroke();
      }
      break;
    }
    case "pineapple": {
      c.strokeStyle = withAlpha(def.skinDark, 0.4);
      c.lineWidth = r * 0.04;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(0, 0, r * 0.2 * (i + 1), 0, TAU);
        c.stroke();
      }
      break;
    }
    case "banana": {
      c.fillStyle = "#e9dca0";
      c.beginPath();
      c.arc(0, 0, r * 0.18, 0, TAU);
      c.fill();
      break;
    }
    default:
      break;
  }

  // bright cut-face sheen along the flat edge
  const sheen = c.createLinearGradient(0, -r * 0.05, 0, r * 0.18);
  sheen.addColorStop(0, "rgba(255,255,255,0.55)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = sheen;
  c.fillRect(-r, -r * 0.05, r * 2, r * 0.22);
}

// ---------------------------------------------------------------------------
// Half fruit
// ---------------------------------------------------------------------------

export function drawHalf(c: Ctx, h: Half): void {
  const r = h.radius;
  c.save();
  c.translate(h.x, h.y);
  c.rotate(h.angle);

  if (h.golden) {
    const gl = c.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.5);
    gl.addColorStop(0, "rgba(255,225,120,0.4)");
    gl.addColorStop(1, "rgba(255,225,120,0)");
    c.fillStyle = gl;
    c.beginPath();
    c.arc(0, 0, r * 1.5, 0, TAU);
    c.fill();
  }

  // Clip to one side of the cut line (the cut runs along local x-axis; flesh
  // sits below for side +1, above for side -1). We rotate the whole thing by
  // cutAngle so the flat face matches the slice direction.
  c.rotate(h.cutAngle);
  c.beginPath();
  if (h.side === 1) {
    c.rect(-r * 1.2, 0, r * 2.4, r * 1.2);
  } else {
    c.rect(-r * 1.2, -r * 1.2, r * 2.4, r * 1.2);
  }
  c.clip();

  // draw flesh interior + face, then a thin slice of skin on the rounded edge
  const base = h.golden ? "#ffd24a" : h.def.skin;
  // outer skin ring
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.15);
  g.addColorStop(0, shade(base, 0.18));
  g.addColorStop(0.6, base);
  g.addColorStop(1, shade(base, -0.3));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.fill();

  drawFleshFace(c, h.def, r, h.seed);

  c.restore();
}
