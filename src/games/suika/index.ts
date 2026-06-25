import type { GameContext, GameInstance } from "@/engine";
import { SuikaGame } from "./game";

export function create(ctx: GameContext): GameInstance {
  return new SuikaGame(ctx);
}
