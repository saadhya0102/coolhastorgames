import type { GameContext, GameInstance } from "@/engine";
import { PizzaGame } from "./game";

/** Pizza Palace — an original time-management cooking game.
 * Take orders, build pizzas, bake them to the perfect colour, slice them into
 * even wedges and serve before patience runs out. Day-based progression with an
 * upgrade shop and ramping difficulty. All visuals + audio are procedural. */
export function create(ctx: GameContext): GameInstance {
  return new PizzaGame(ctx);
}
