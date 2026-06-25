/** Hand-crafted Sokoban levels, ordered easiest -> hardest.
 * Legend: # wall, (space) floor, . target, $ crate, @ player,
 *         * crate-on-target, + player-on-target.
 * Every level has been verified solvable with a BFS solver. */
export const LEVELS: ReadonlyArray<ReadonlyArray<string>> = [
  // 1 - push one crate right
  ["#######", "#@ $ .#", "#######"],
  // 2 - push one crate up
  ["#####", "#.  #", "#   #", "#$  #", "#@  #", "#####"],
  // 3 - tuck a crate into a corner
  ["######", "#.   #", "# $  #", "#  @ #", "#    #", "######"],
  // 4 - two-step corner
  ["######", "#@   #", "# $  #", "#  . #", "#    #", "######"],
  // 5 - push two crates up
  ["######", "# .. #", "# $$ #", "#  @ #", "#    #", "######"],
  // 6 - two crates, travel between them
  ["######", "#.  .#", "#    #", "#$  $#", "#@   #", "######"],
  // 7 - three crates to the right wall
  ["#######", "#@$  .#", "# $  .#", "# $  .#", "#######"],
  // 8 - three crates straight up
  ["#######", "#. . .#", "#$ $ $#", "#  @  #", "#######"],
  // 9 - pack a pair
  ["#######", "#@    #", "# $$  #", "# ..  #", "#     #", "#######"],
  // 10 - three crates, mixed directions
  ["#######", "#. .  #", "#$ $  #", "#  @  #", "#  $  #", "#  .  #", "#######"],
  // 11 - squeeze
  ["#######", "#.    #", "#.$$ @#", "#.$   #", "#######"],
  // 12 - weave around walls
  ["########", "#  .   #", "# #$#  #", "# .$.$ #", "#  @   #", "########"],
  // 13 - the cross
  ["#######", "#  #  #", "#. $ .#", "# $@$ #", "#. $ .#", "#  #  #", "#######"],
  // 14 - four crates down
  ["########", "#@     #", "# $$$$ #", "# .... #", "#      #", "########"],
  // 15 - four crates, the long haul
  ["#########", "#@      #", "# $$$$  #", "# ....  #", "#       #", "#########"],
];
