/**
 * Hill Climb 2 — persistence.
 * Loads/saves the single SaveState blob through ctx.storage, merging over
 * defaults so new content never breaks an old save.
 */
import type { GameStorage } from "@/engine";
import { defaultUpgrades } from "./config";
import type {
  SaveState,
  StageId,
  UpgradeLevels,
  VehicleId,
} from "./types";

const SAVE_KEY = "save";
const SAVE_VERSION = 1;

const ALL_VEHICLES: VehicleId[] = ["jeep", "sports", "truck", "bike", "rover"];

function freshSave(): SaveState {
  const upgrades = {} as Record<VehicleId, UpgradeLevels>;
  for (const id of ALL_VEHICLES) upgrades[id] = defaultUpgrades();
  return {
    version: SAVE_VERSION,
    coins: 0,
    selectedVehicle: "jeep",
    selectedStage: "country",
    ownedVehicles: ["jeep"],
    ownedStages: ["country"],
    upgrades,
    bestByStage: {},
    totalDistance: 0,
  };
}

/** Read + merge the persisted save over a fresh default. */
export function loadSave(storage: GameStorage): SaveState {
  const fresh = freshSave();
  const raw = storage.get<Partial<SaveState> | null>(SAVE_KEY, null);
  if (!raw) return fresh;

  const merged: SaveState = {
    ...fresh,
    ...raw,
    version: SAVE_VERSION,
    coins: typeof raw.coins === "number" ? raw.coins : fresh.coins,
    selectedVehicle: raw.selectedVehicle ?? fresh.selectedVehicle,
    selectedStage: raw.selectedStage ?? fresh.selectedStage,
    ownedVehicles: raw.ownedVehicles ?? fresh.ownedVehicles,
    ownedStages: raw.ownedStages ?? fresh.ownedStages,
    upgrades: { ...fresh.upgrades },
    bestByStage: { ...(raw.bestByStage ?? {}) },
    totalDistance:
      typeof raw.totalDistance === "number" ? raw.totalDistance : 0,
  };

  // merge upgrade levels per vehicle so a partial/old save is filled in
  if (raw.upgrades) {
    for (const id of ALL_VEHICLES) {
      const stored = raw.upgrades[id];
      if (stored) {
        merged.upgrades[id] = {
          engine: stored.engine ?? 0,
          tires: stored.tires ?? 0,
          suspension: stored.suspension ?? 0,
          drive: stored.drive ?? 0,
          fuel: stored.fuel ?? 0,
        };
      }
    }
  }

  // guarantee starters are always owned
  if (!merged.ownedVehicles.includes("jeep")) merged.ownedVehicles.push("jeep");
  if (!merged.ownedStages.includes("country"))
    merged.ownedStages.push("country");

  return merged;
}

export function writeSave(storage: GameStorage, save: SaveState): void {
  storage.set(SAVE_KEY, save);
}

export function ownsVehicle(save: SaveState, id: VehicleId): boolean {
  return save.ownedVehicles.includes(id);
}

export function ownsStage(save: SaveState, id: StageId): boolean {
  return save.ownedStages.includes(id);
}
