/** Shared cartoon palette + small color helpers for Duck Life. */

export const PALETTE = {
  ink: "#23304a",
  inkSoft: "#5a6b8c",
  panel: "#ffffff",
  panelSoft: "#f1f5ff",
  shadow: "rgba(20,28,55,0.18)",

  accent: "#ffb52e", // duck gold
  accentDark: "#e8941a",

  run: "#ff6f5e",
  swim: "#36b6ff",
  fly: "#9b7bff",

  good: "#34c47a",
  bad: "#ff5b6e",
  coin: "#ffcf3a",
  energy: "#56df8e",

  sky1: "#7ec8ff",
  sky2: "#cdeeff",
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((x) => x + x)
      .join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function lighten(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function darken(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (v: number) => Math.round(v * (1 - amt));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function rgba(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Mix two hex colors, t=0 -> a, t=1 -> b. Returns an rgb() string. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${m(ca.r, cb.r)},${m(ca.g, cb.g)},${m(ca.b, cb.b)})`;
}
