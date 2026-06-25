import type { GameDef } from "@/engine";

/** The master list of games.
 * - Games with `collection: "minigames"` live inside the single "Minigames"
 *   app (a sub-hub of bite-size classics).
 * - Games without a collection are standalone "apps" shown on the main hub
 *   (the big flagship games + the multiplayer / party games).
 * Adding a game = create src/games/<id>/ (export `create` for canvas or
 * `Component` for react) and add one entry here. Code is lazy-loaded per game. */
export const GAMES: GameDef[] = [
  // ============================================================
  // FEATURED standalone apps (full-size games)
  // ============================================================
  {
    id: "run", title: "Run 3", description: "Sprint and wall-run through an endless tunnel in space.",
    section: "featured", category: "arcade", color: "#7c5cff", icon: "🌌", players: "1P", aspect: 1.2,
    leaderboard: true, scoreLabel: "Distance", instructions: ["Left / Right to move and wall-run", "Space to jump"],
    kind: "canvas", load: () => import("../games/run"),
  },
  {
    id: "critter-quest", title: "Duck Life", description: "Hatch, train and race your duckling across four worlds.",
    section: "featured", category: "rpg", color: "#ffd23f", icon: "🦆", players: "1P", aspect: 1.4,
    leaderboard: true, scoreLabel: "Power", instructions: ["Train Running, Swimming, Flying", "Race to earn coins"],
    kind: "canvas", load: () => import("../games/critter-quest"),
  },
  {
    id: "hill-climb-2", title: "Hill Climb 2", description: "Climb wild terrain across worlds, flip for coins, upgrade your ride.",
    section: "featured", category: "driving", color: "#ff7b54", icon: "⛰️", players: "1P", aspect: 1.7,
    leaderboard: true, scoreLabel: "Distance", instructions: ["Gas / Brake", "Flip in the air for coins", "Mind your fuel"],
    kind: "canvas", load: () => import("../games/hill-climb-2"),
  },
  {
    id: "papas-pizzeria", title: "Pizza Palace", description: "Run a pizzeria: take orders, top, bake, slice and serve.",
    section: "featured", category: "arcade", color: "#ff6b3d", icon: "🍕", players: "1P", aspect: 1.3,
    leaderboard: true, scoreLabel: "Money", instructions: ["Drag toppings, pull at the green bake zone", "Beat the daily rent"],
    kind: "canvas", load: () => import("../games/papas-pizzeria"),
  },
  {
    id: "vampire-survivors", title: "Nightfall Survivors", description: "Auto-attack endless hordes, level up, evolve, survive.",
    section: "featured", category: "arcade", color: "#b14dff", icon: "🧛", players: "1P", aspect: 1.4,
    leaderboard: true, scoreLabel: "Score", instructions: ["Move only - attacks are automatic", "Pick upgrades on level-up"],
    kind: "canvas", load: () => import("../games/vampire-survivors"),
  },
  {
    id: "tower-defense", title: "Iron Vale", description: "Defend your keep across 20 waves of monsters.",
    section: "featured", category: "arcade", color: "#ffcb45", icon: "🏰", players: "1P", aspect: 1.45,
    leaderboard: true, scoreLabel: "Score", instructions: ["Tap a tower, then tap to build", "Upgrade or sell", "Survive all waves"],
    kind: "canvas", load: () => import("../games/tower-defense"),
  },
  {
    id: "platformer", title: "Mossbloom Run", description: "Run, leap and bop through three biomes to the Bloom Gate.",
    section: "featured", category: "arcade", color: "#6cc24a", icon: "🌿", players: "1P", aspect: 1.6,
    leaderboard: true, scoreLabel: "Score", instructions: ["Arrows/WASD move, Space jump, Shift run", "Stomp foes, grab coins, reach the flag"],
    kind: "canvas", load: () => import("../games/platformer"),
  },
  {
    id: "dungeon-crawler", title: "Crypt of the Cinder King", description: "Descend a cursed crypt, clear rooms, slay the boss.",
    section: "featured", category: "arcade", color: "#e2563f", icon: "💀", players: "1P", aspect: 1.6,
    leaderboard: true, scoreLabel: "Score", instructions: ["WASD move", "Arrows / mouse to shoot", "Clear rooms and descend"],
    kind: "canvas", load: () => import("../games/dungeon-crawler"),
  },
  {
    id: "pinball", title: "Neon Nexus", description: "A glowing neon pinball table with multiball and jackpots.",
    section: "featured", category: "classic", color: "#19d3ff", icon: "🎯", players: "1P", aspect: 0.56,
    leaderboard: true, scoreLabel: "Score", instructions: ["Left / Right flippers", "Hold to charge the plunger"],
    kind: "canvas", load: () => import("../games/pinball"),
  },
  {
    id: "geometry-dash", title: "Neon Dash", description: "Beat-synced cube runner - jump spikes, fly the ship, flip gravity.",
    section: "featured", category: "arcade", color: "#21e6ff", icon: "🔷", players: "1P", aspect: 1.6,
    leaderboard: true, scoreLabel: "Best %", instructions: ["Tap / Space to jump (hold to fly)", "Reach 100%"],
    kind: "canvas", load: () => import("../games/geometry-dash"),
  },

  // ============================================================
  // MINIGAMES collection (bite-size classics)
  // ============================================================
  {
    id: "flap", title: "Flappy Bird", description: "One-tap flying through endless pipes.",
    section: "offline", category: "arcade", color: "#ffd23f", icon: "🐤", players: "1P", aspect: 0.7,
    leaderboard: true, scoreLabel: "Score", instructions: ["Tap / Space to flap", "Avoid the pipes"],
    collection: "minigames", kind: "canvas", load: () => import("../games/flap"),
  },
  {
    id: "dash-run", title: "Canabalt", description: "Auto-run across the rooftops and leap the gaps.",
    section: "offline", category: "arcade", color: "#ff7b54", icon: "🏃", players: "1P", aspect: 1.6,
    leaderboard: true, scoreLabel: "Distance", instructions: ["Space / tap to jump (hold = higher)"],
    collection: "minigames", kind: "canvas", load: () => import("../games/dash-run"),
  },
  {
    id: "helix-drop", title: "Helix Jump", description: "Spin the tower and drop the ball through the gaps.",
    section: "offline", category: "arcade", color: "#19d3ff", icon: "🌀", players: "1P", aspect: 0.62,
    leaderboard: true, scoreLabel: "Levels", instructions: ["Arrow keys or drag to rotate"],
    collection: "minigames", kind: "canvas", load: () => import("../games/helix-drop"),
  },
  {
    id: "stacker", title: "Stack", description: "Time your taps to stack the tower sky-high.",
    section: "offline", category: "arcade", color: "#46e0a0", icon: "🏗️", players: "1P", aspect: 0.7,
    leaderboard: true, scoreLabel: "Height", instructions: ["Tap / Space to drop the block"],
    collection: "minigames", kind: "canvas", load: () => import("../games/stacker"),
  },
  {
    id: "jumpster", title: "Doodle Jump", description: "Bounce ever upward on platforms and springs.",
    section: "offline", category: "arcade", color: "#9b5cff", icon: "🦘", players: "1P", aspect: 0.62,
    leaderboard: true, scoreLabel: "Height", instructions: ["Left / Right to steer", "Screen wraps"],
    collection: "minigames", kind: "canvas", load: () => import("../games/jumpster"),
  },
  {
    id: "hop-cross", title: "Crossy Road", description: "Hop across roads, rivers and rails.",
    section: "offline", category: "arcade", color: "#5cd65c", icon: "🐔", players: "1P", aspect: 0.9,
    leaderboard: true, scoreLabel: "Rows", instructions: ["Arrows / swipe to hop"],
    collection: "minigames", kind: "canvas", load: () => import("../games/hop-cross"),
  },
  {
    id: "reaction", title: "Whack-A-Mole", description: "Bonk the moles, dodge the bombs, beat the clock.",
    section: "offline", category: "arcade", color: "#ff5c8a", icon: "🔨", players: "1P", aspect: 1,
    leaderboard: true, scoreLabel: "Score", instructions: ["Tap the moles, avoid bombs"],
    collection: "minigames", kind: "canvas", load: () => import("../games/reaction"),
  },
  {
    id: "slope", title: "Slope", description: "Roll down the neon course at breakneck speed.",
    section: "offline", category: "arcade", color: "#00e5a8", icon: "🟢", players: "1P", aspect: 0.85,
    leaderboard: true, scoreLabel: "Distance", instructions: ["Left / Right to steer", "Avoid the edges"],
    collection: "minigames", kind: "canvas", load: () => import("../games/slope"),
  },
  {
    id: "snake", title: "Snake", description: "The timeless classic. Eat, grow, don't bite yourself.",
    section: "offline", category: "classic", color: "#46e0a0", icon: "🐍", players: "1P", aspect: 1,
    leaderboard: true, scoreLabel: "Score", instructions: ["Arrow keys or swipe to turn"],
    collection: "minigames", kind: "canvas", load: () => import("../games/snake"),
  },
  {
    id: "brick-buster", title: "Breakout", description: "Smash every brick with paddle, ball and power-ups.",
    section: "offline", category: "classic", color: "#ff9f1c", icon: "🧱", players: "1P", aspect: 0.8,
    leaderboard: true, scoreLabel: "Score", instructions: ["Move paddle, Space to launch"],
    collection: "minigames", kind: "canvas", load: () => import("../games/brick-buster"),
  },
  {
    id: "space-rocks", title: "Asteroids", description: "Drift, shoot and split asteroids in deep space.",
    section: "offline", category: "classic", color: "#c8c8ff", icon: "🪨", players: "1P", aspect: 1.4,
    leaderboard: true, scoreLabel: "Score", instructions: ["Rotate + thrust, Space to fire"],
    collection: "minigames", kind: "canvas", load: () => import("../games/space-rocks"),
  },
  {
    id: "invaders", title: "Space Invaders", description: "Hold the line against waves of marching aliens.",
    section: "offline", category: "classic", color: "#46e0a0", icon: "👾", players: "1P", aspect: 1.1,
    leaderboard: true, scoreLabel: "Score", instructions: ["Move left/right, Space to fire"],
    collection: "minigames", kind: "canvas", load: () => import("../games/invaders"),
  },
  {
    id: "pong", title: "Pong", description: "Retro paddle duel - 2 players or vs the CPU.",
    section: "offline", category: "classic", color: "#ffffff", icon: "🏓", players: "1-2P", aspect: 1.5,
    leaderboard: false, instructions: ["P1: W/S", "P2: Up/Down"],
    collection: "minigames", kind: "canvas", load: () => import("../games/pong"),
  },
  {
    id: "g2048", title: "2048", description: "Slide and merge numbered tiles to reach 2048.",
    section: "offline", category: "puzzle", color: "#edc22e", icon: "🔢", players: "1P", aspect: 1,
    leaderboard: true, scoreLabel: "Score", instructions: ["Arrow keys or swipe", "Merge equal tiles"],
    collection: "minigames", kind: "canvas", load: () => import("../games/g2048"),
  },
  {
    id: "gem-crush", title: "Bejeweled", description: "Swap to match three, chain dazzling cascades.",
    section: "offline", category: "puzzle", color: "#ff5c8a", icon: "💎", players: "1P", aspect: 0.85,
    leaderboard: true, scoreLabel: "Score", instructions: ["Swap adjacent gems to match 3+"],
    collection: "minigames", kind: "canvas", load: () => import("../games/gem-crush"),
  },
  {
    id: "minesweeper", title: "Minesweeper", description: "Clear the field without tripping a mine.",
    section: "offline", category: "puzzle", color: "#9aa4cf", icon: "💣", players: "1P", aspect: 1,
    leaderboard: true, scoreLabel: "Best Time", scoreAscending: true, instructions: ["Tap to reveal", "Flag mode for mines"],
    collection: "minigames", kind: "canvas", load: () => import("../games/minesweeper"),
  },
  {
    id: "blockfall", title: "Tetris", description: "Stack the falling blocks and clear lines.",
    section: "offline", category: "puzzle", color: "#19d3ff", icon: "🟦", players: "1P", aspect: 0.6,
    leaderboard: true, scoreLabel: "Score", instructions: ["Move/rotate, Space to hard drop"],
    collection: "minigames", kind: "canvas", load: () => import("../games/blockfall"),
  },
  {
    id: "push-it", title: "Sokoban", description: "Push every crate onto its target. Brain teaser.",
    section: "offline", category: "puzzle", color: "#ffb700", icon: "📦", players: "1P", aspect: 1,
    leaderboard: true, scoreLabel: "Levels", instructions: ["Arrows to push", "Z undo, R restart"],
    collection: "minigames", kind: "canvas", load: () => import("../games/push-it"),
  },
  {
    id: "word-daily", title: "Wordle", description: "Guess the daily five-letter word in six tries.",
    section: "offline", category: "puzzle", color: "#46e0a0", icon: "🔤", players: "1P", aspect: 0.72,
    leaderboard: true, scoreLabel: "Guesses", scoreAscending: true, instructions: ["Type a 5-letter word, Enter"],
    collection: "minigames", kind: "canvas", load: () => import("../games/word-daily"),
  },
  {
    id: "hill-blazer", title: "Hill Climb Racing", description: "Climb the hills, grab fuel, don't flip.",
    section: "offline", category: "driving", color: "#ff7b54", icon: "🚙", players: "1P", aspect: 1.7,
    leaderboard: true, scoreLabel: "Distance", instructions: ["Gas / Brake", "Mind your fuel"],
    collection: "minigames", kind: "canvas", load: () => import("../games/hill-blazer"),
  },
  {
    id: "redline-drag", title: "Drag Racing", description: "Nail every gear shift for the fastest quarter mile.",
    section: "offline", category: "driving", color: "#ff5c5c", icon: "🏎️", players: "1P", aspect: 1.7,
    leaderboard: true, scoreLabel: "Best Time", scoreAscending: true, instructions: ["Shift at the green RPM band"],
    collection: "minigames", kind: "canvas", load: () => import("../games/redline-drag"),
  },
  {
    id: "drive-smash", title: "Drive Ahead", description: "Wonky-car arena brawl. Bonk the other driver!",
    section: "offline", category: "driving", color: "#ffd23f", icon: "💥", players: "1-2P", aspect: 1.6,
    leaderboard: false, instructions: ["P1: A/D", "P2: Left/Right"],
    collection: "minigames", kind: "canvas", load: () => import("../games/drive-smash"),
  },
  {
    id: "beast-brawl", title: "Monster Battle", description: "Build a monster team and climb the battle tower.",
    section: "offline", category: "rpg", color: "#ff5c8a", icon: "🐉", players: "1P", aspect: 1.2,
    leaderboard: true, scoreLabel: "Floors", instructions: ["Pick a team, auto-battle, choose rewards"],
    collection: "minigames", kind: "canvas", load: () => import("../games/beast-brawl"),
  },
  {
    id: "idle-empire", title: "Cookie Clicker", description: "Tap, automate, prestige - build an idle fortune.",
    section: "offline", category: "rpg", color: "#ffd95c", icon: "🍪", players: "1P", aspect: 1.1,
    leaderboard: true, scoreLabel: "Earned", instructions: ["Tap to earn, buy generators, prestige"],
    collection: "minigames",     kind: "canvas", load: () => import("../games/idle-empire"),
  },
  {
    id: "fruit-ninja", title: "Fruit Frenzy", description: "Slice the flying fruit, dodge the bombs.",
    section: "offline", category: "arcade", color: "#ff4d6d", icon: "🍉", players: "1P", aspect: 1.3,
    leaderboard: true, scoreLabel: "Score", instructions: ["Swipe to slice", "Avoid bombs"],
    collection: "minigames", kind: "canvas", load: () => import("../games/fruit-ninja"),
  },
  {
    id: "suika", title: "Mergemelon", description: "Drop and merge fruit to make the Sunmelon.",
    section: "offline", category: "puzzle", color: "#ff9f1c", icon: "🍈", players: "1P", aspect: 0.7,
    leaderboard: true, scoreLabel: "Score", instructions: ["Move to aim, tap to drop", "Merge two of the same"],
    collection: "minigames", kind: "canvas", load: () => import("../games/suika"),
  },
  {
    id: "bubble-shooter", title: "Bubble Pop Saga", description: "Aim, fire and pop matching bubbles.",
    section: "offline", category: "puzzle", color: "#ff4d7e", icon: "🫧", players: "1P", aspect: 0.72,
    leaderboard: true, scoreLabel: "Score", instructions: ["Aim with the pointer", "Tap to fire, match 3+"],
    collection: "minigames", kind: "canvas", load: () => import("../games/bubble-shooter"),
  },
  {
    id: "tank-battle", title: "Tank Battle", description: "Ricochet shells and mines in walled tank arenas.",
    section: "offline", category: "arcade", color: "#36b58a", icon: "🛡️", players: "1P", aspect: 1.4,
    leaderboard: true, scoreLabel: "Score", instructions: ["Drive + aim, fire ricochet shells", "Destroy all tanks"],
    collection: "minigames", kind: "canvas", load: () => import("../games/tank-battle"),
  },
  {
    id: "solitaire", title: "Solitaire", description: "Klondike - build the foundations, Ace to King.",
    section: "offline", category: "classic", color: "#1e7a52", icon: "🃏", players: "1P", aspect: 1.3,
    leaderboard: true, scoreLabel: "Score", instructions: ["Drag to build down by alternating color", "Tap to send home"],
    collection: "minigames", kind: "canvas", load: () => import("../games/solitaire"),
  },
  {
    id: "piano-tiles", title: "Tap Cascade", description: "Tap the falling tiles in time to play melodies.",
    section: "offline", category: "arcade", color: "#19d3ff", icon: "🎹", players: "1P", aspect: 0.62,
    leaderboard: true, scoreLabel: "Score", instructions: ["Tap tiles at the line (D F J K)", "Don't miss!"],
    collection: "minigames", kind: "canvas", load: () => import("../games/piano-tiles"),
  },
  {
    id: "mini-golf", title: "Putt Park", description: "Drag-to-putt mini-golf across 12 hand-built holes.",
    section: "offline", category: "classic", color: "#3bb265", icon: "⛳", players: "1P", aspect: 1.3,
    leaderboard: true, scoreLabel: "Strokes", scoreAscending: true, instructions: ["Drag back to aim", "Release to putt"],
    collection: "minigames", kind: "canvas", load: () => import("../games/mini-golf"),
  },

  // ============================================================
  // ONLINE multiplayer apps (turn-based)
  // ============================================================
  {
    id: "connect-four", title: "Connect 4", description: "Drop discs, get four in a row. Online 1v1.",
    section: "online", category: "party", color: "#ffd23f", icon: "🔴", players: "2P", online: true,
    instructions: ["Tap a column to drop"], kind: "react", load: () => import("../games/connect-four"),
  },
  {
    id: "battleship", title: "Battleship", description: "Place your fleet and sink theirs. Online 1v1.",
    section: "online", category: "party", color: "#19d3ff", icon: "🚢", players: "2P", online: true,
    instructions: ["Place ships, then fire"], kind: "react", load: () => import("../games/battleship"),
  },
  {
    id: "dots-boxes", title: "Dots and Boxes", description: "Claim the most boxes. Online 1v1.",
    section: "online", category: "party", color: "#7c5cff", icon: "🔳", players: "2P", online: true,
    instructions: ["Tap an edge", "Complete boxes to score"], kind: "react", load: () => import("../games/dots-boxes"),
  },

  // ============================================================
  // GROUP / PARTY apps (room-based)
  // ============================================================
  {
    id: "secret-agenda", title: "Secret Hitler", description: "Hidden-role deception. Find the secret leader.",
    section: "party", category: "party", color: "#ff5c8a", icon: "🕵️", players: "5-10P", online: true,
    instructions: ["Get a code, gather friends"], kind: "react", load: () => import("../games/secret-agenda"),
  },
  {
    id: "moonlight-mafia", title: "Mafia", description: "Night falls. Who can you trust? Auto-moderated.",
    section: "party", category: "party", color: "#7c5cff", icon: "🌙", players: "4-12P", online: true,
    instructions: ["Get a code, gather friends"], kind: "react", load: () => import("../games/moonlight-mafia"),
  },
  {
    id: "spy-words", title: "Codenames", description: "Two teams, secret words, one risky clue at a time.",
    section: "party", category: "party", color: "#19d3ff", icon: "🔎", players: "2-8P", online: true,
    instructions: ["Spymasters give clues"], kind: "react", load: () => import("../games/spy-words"),
  },
  {
    id: "castlefall", title: "Castlefall", description: "Lead your team to your secret word with sly clues.",
    section: "party", category: "party", color: "#ffd95c", icon: "🏰", players: "2-8P", online: true,
    instructions: ["Clue your team, guess your word"], kind: "react", load: () => import("../games/castlefall"),
  },
  {
    id: "doodle-guess", title: "Skribbl", description: "Draw it, guess it, score it. Chaotic fun.",
    section: "party", category: "party", color: "#46e0a0", icon: "🎨", players: "2-10P", online: true,
    instructions: ["Draw on your turn, guess on others'"], kind: "react", load: () => import("../games/doodle-guess"),
  },
  {
    id: "trivia-royale", title: "Trivia", description: "Fast-finger trivia showdown for the whole room.",
    section: "party", category: "party", color: "#ffd95c", icon: "❓", players: "1-12P", online: true,
    instructions: ["Answer fast for more points"], kind: "react", load: () => import("../games/trivia-royale"),
  },
  {
    id: "wild-eights", title: "Uno", description: "Shed your hand first in this wild card scramble.",
    section: "party", category: "party", color: "#ff9f1c", icon: "🃏", players: "2-6P", online: true,
    instructions: ["Match color or rank, eights are wild"], kind: "react", load: () => import("../games/wild-eights"),
  },
];

export const getGame = (id: string) => GAMES.find((g) => g.id === id);

/** Top-level apps shown on the main hub (everything not in a collection). */
export const APPS = GAMES.filter((g) => !g.collection);
/** Games inside the Minigames collection. */
export const MINIGAMES = GAMES.filter((g) => g.collection === "minigames");

export const SECTION_LABELS: Record<string, string> = {
  featured: "Featured",
  offline: "Offline Arcade",
  online: "Online Multiplayer",
  party: "Group & Party",
};

export const SECTION_BLURB: Record<string, string> = {
  featured: "Big, full-size games - dive in.",
  offline: "Play instantly, even without internet. Scores sync when you're online.",
  online: "Challenge the world - turn-based duels and global leaderboards.",
  party: "Grab some friends and play together in the same room.",
};
