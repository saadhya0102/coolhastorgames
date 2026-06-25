/** Domain types for Pizza Palace. No logic lives here — only shapes. */

export type ToppingId =
  | "pepperoni"
  | "mushroom"
  | "pepper"
  | "olive"
  | "onion"
  | "sausage"
  | "bacon"
  | "pineapple"
  | "ham"
  | "jalapeno";

/** How a topping is drawn on the pie. */
export type ToppingDrawKind =
  | "disc" // pepperoni / sausage style speckled discs
  | "ring" // olive / onion rings
  | "cap" // mushroom cap
  | "arc" // pepper slice
  | "chunk" // ham / pineapple chunks
  | "strip"; // bacon strip

export interface ToppingDef {
  id: ToppingId;
  name: string;
  /** one-or-two letter shorthand for compact tickets */
  short: string;
  color: string;
  accent: string;
  drawKind: ToppingDrawKind;
  /** relative draw radius multiplier */
  size: number;
}

export interface ToppingReq {
  id: ToppingId;
  count: number;
}

export interface PlacedItem {
  id: ToppingId;
  /** position in pizza-local space, normalized to radius 1 (centered at 0,0) */
  x: number;
  y: number;
  rot: number;
  /** spawn pop animation, 0..1 (1 = settled) */
  pop: number;
}

export interface BakeBand {
  /** ideal bake window, values in 0..1 */
  lo: number;
  hi: number;
  /** human label */
  label: string;
}

export interface OrderSpec {
  toppings: ToppingReq[];
  bake: BakeBand;
  slices: number;
}

export type TicketStatus =
  | "waiting"
  | "building"
  | "baking"
  | "cutting"
  | "served"
  | "left";

export interface PizzaScore {
  topping: number;
  bake: number;
  cut: number;
  overall: number;
  stars: number;
  pay: number;
  tip: number;
}

export type FaceMood = "happy" | "neutral" | "worried" | "angry";

export interface CustomerLook {
  skin: string;
  hair: string;
  hairStyle: number;
  shirt: string;
  bodyType: number;
  faceType: number;
}

export interface Customer {
  seed: number;
  name: string;
  look: CustomerLook;
  /** remaining patience in seconds */
  patience: number;
  patienceMax: number;
  /** animation bob phase */
  phase: number;
}

export interface Ticket {
  id: number;
  customer: Customer;
  spec: OrderSpec;
  status: TicketStatus;
  placed: PlacedItem[];
  /** 0..1 bake progress */
  bake: number;
  baking: boolean;
  pulledBake: number | null;
  /** angles (radians, 0..PI) of cut lines */
  cuts: number[];
  ovenSlot: number | null;
  score: PizzaScore | null;
  /** reaction animation timer when served/left */
  reactionT: number;
}

export type GameState =
  | "title"
  | "dayStart"
  | "play"
  | "dayEnd"
  | "shop"
  | "over";

export type Station = "orders" | "build" | "oven" | "serve";

export type UpgradeId =
  | "oven_speed"
  | "oven_slots"
  | "tray_quick"
  | "seats"
  | "decor"
  | "cutter"
  | "sauce_auto"
  | "marketing";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  icon: string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
}

export interface SaveData {
  /** spendable cash on hand */
  money: number;
  /** gross income earned this run (the reported score) */
  earned: number;
  day: number;
  best: number;
  upgrades: Record<UpgradeId, number>;
  lifetimeServed: number;
  lifetimeTips: number;
}

/** Per-day rolled difficulty profile. */
export interface DayProfile {
  day: number;
  customers: number;
  maxToppings: number;
  minToppings: number;
  bandWidth: number;
  sliceChoices: number[];
  patience: number;
  arrivalInterval: number;
  quota: number;
}
