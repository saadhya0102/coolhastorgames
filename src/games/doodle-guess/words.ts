/** Simple, concrete, easy-to-draw nouns for Doodle Guess. Kept short and
 * unambiguous so a quick sketch is enough for friends to guess. */
export const WORDS: readonly string[] = [
  "apple", "banana", "cherry", "grapes", "lemon", "orange", "pear", "pineapple",
  "strawberry", "watermelon", "carrot", "corn", "mushroom", "onion", "potato",
  "pumpkin", "tomato", "broccoli", "cake", "cookie", "donut", "ice cream",
  "pizza", "hamburger", "hot dog", "sandwich", "egg", "bread", "cheese", "candy",
  "lollipop", "popcorn", "fries", "taco", "pancakes", "coffee", "milk", "juice",
  "cat", "dog", "fish", "bird", "frog", "horse", "cow", "pig", "sheep", "duck",
  "chicken", "rabbit", "mouse", "elephant", "lion", "tiger", "bear", "monkey",
  "snake", "turtle", "whale", "dolphin", "shark", "octopus", "crab", "snail",
  "spider", "bee", "butterfly", "ant", "ladybug", "owl", "penguin", "kangaroo",
  "giraffe", "zebra", "fox", "wolf", "deer", "squirrel", "bat", "dragon",
  "dinosaur", "unicorn", "sun", "moon", "star", "cloud", "rain", "rainbow",
  "snowflake", "snowman", "lightning", "fire", "tree", "flower", "leaf", "grass",
  "cactus", "mountain", "volcano", "island", "river", "beach", "wave", "rock",
  "house", "castle", "tent", "barn", "church", "bridge", "lighthouse", "windmill",
  "door", "window", "key", "ladder", "fence", "chair", "table", "bed", "couch",
  "lamp", "clock", "mirror", "candle", "umbrella", "bucket", "broom", "scissors",
  "hammer", "saw", "wrench", "nail", "paintbrush", "pencil", "pen", "book",
  "ruler", "glasses", "camera", "phone", "computer", "television", "radio",
  "guitar", "piano", "drum", "trumpet", "violin", "flute", "bell", "balloon",
  "kite", "ball", "dice", "crown", "ring", "necklace", "hat", "cap", "shoe",
  "boot", "sock", "shirt", "pants", "dress", "glove", "scarf", "tie", "button",
  "car", "truck", "bus", "train", "bicycle", "motorcycle", "airplane", "rocket",
  "helicopter", "boat", "ship", "submarine", "anchor", "wheel", "robot", "ghost",
  "alien", "skull", "heart", "diamond", "arrow", "flag", "map", "compass",
  "telescope", "magnet", "battery", "lightbulb", "gift", "envelope", "stamp",
  "pizza slice", "cupcake", "carousel", "ferris wheel", "swing", "slide",
  "snowball", "footprint", "spoon", "fork", "knife", "plate", "cup", "teapot",
  "bottle", "jar", "basket", "clock tower", "snail shell", "feather", "bone",
  "eye", "hand", "foot", "ear", "nose", "tooth", "mustache", "smiley face",
] as const;

export function randomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

/** Pick `n` distinct random words. */
export function pickWords(n: number): string[] {
  const pool = WORDS.slice();
  const out: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
