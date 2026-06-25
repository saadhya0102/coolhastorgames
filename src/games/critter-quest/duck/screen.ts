import type { GameContext } from "@/engine";
import type { DuckLook } from "./duck";

/** A self-contained takeover sub-screen (mini-game / race). */
export interface Screen {
  update(dt: number): void;
  render(): void;
  destroy?(): void;
}

export interface ScreenEnv {
  ctx: GameContext;
  look: DuckLook;
}

export const DT_CLAMP = 1 / 20;
