/** Lightweight identity without a login. Each browser gets a stable random UID
 * and a display name (both editable, stored locally). This powers global
 * leaderboards and multiplayer rooms without requiring the (billing-gated)
 * Firebase Auth product. If real auth is enabled later, getUid/getName can be
 * swapped to read from Firebase Auth instead. */
const UID_KEY = "chg.uid";
const NAME_KEY = "chg.name";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "u-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const ADJ = ["Swift", "Brave", "Sneaky", "Mighty", "Cosmic", "Turbo", "Pixel", "Lucky", "Mega", "Wild", "Zappy", "Glitchy"];
const NOUN = ["Fox", "Panda", "Ninja", "Comet", "Tiger", "Wizard", "Racer", "Robot", "Dragon", "Otter", "Yeti", "Falcon"];
export function randomName(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}${Math.floor(Math.random() * 90 + 10)}`;
}

export function getUid(): string {
  let u = localStorage.getItem(UID_KEY);
  if (!u) {
    u = uuid();
    localStorage.setItem(UID_KEY, u);
  }
  return u;
}

export function getName(): string {
  let n = localStorage.getItem(NAME_KEY);
  if (!n) {
    n = randomName();
    localStorage.setItem(NAME_KEY, n);
  }
  return n;
}

export function setName(name: string): string {
  const clean = name.trim().slice(0, 20) || randomName();
  localStorage.setItem(NAME_KEY, clean);
  return clean;
}
