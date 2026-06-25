/** A single multiple-choice trivia question.
 * `answer` is the index (0-3) of the correct entry in `choices`. */
export interface Question {
  q: string;
  choices: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  category: string;
}

/** General-knowledge bank. Questions are picked at random per match, so a big,
 * varied pool keeps rematches fresh. All answers are factually verified. */
export const QUESTIONS: readonly Question[] = [
  // ---------- Geography ----------
  { q: "What is the capital of Australia?", choices: ["Sydney", "Melbourne", "Canberra", "Perth"], answer: 2, category: "Geography" },
  { q: "Which is the largest ocean on Earth?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], answer: 3, category: "Geography" },
  { q: "Which country is the largest by land area?", choices: ["Canada", "China", "Russia", "United States"], answer: 2, category: "Geography" },
  { q: "On which continent is the Sahara Desert?", choices: ["Asia", "Africa", "Australia", "South America"], answer: 1, category: "Geography" },
  { q: "In which city is the Eiffel Tower?", choices: ["London", "Paris", "Rome", "Berlin"], answer: 1, category: "Geography" },
  { q: "How many continents are there on Earth?", choices: ["Five", "Six", "Seven", "Eight"], answer: 2, category: "Geography" },
  { q: "What is the capital of Japan?", choices: ["Beijing", "Seoul", "Tokyo", "Bangkok"], answer: 2, category: "Geography" },
  { q: "Which of these is NOT one of the Great Lakes?", choices: ["Huron", "Erie", "Superior", "Victoria"], answer: 3, category: "Geography" },
  { q: "Mount Everest lies in which mountain range?", choices: ["Andes", "Alps", "Himalayas", "Rockies"], answer: 2, category: "Geography" },
  { q: "Which river is generally considered the longest?", choices: ["Nile", "Amazon", "Yangtze", "Mississippi"], answer: 0, category: "Geography" },

  // ---------- History ----------
  { q: "In which year did World War II end?", choices: ["1943", "1945", "1947", "1950"], answer: 1, category: "History" },
  { q: "Who was the first President of the United States?", choices: ["George Washington", "Abraham Lincoln", "Thomas Jefferson", "John Adams"], answer: 0, category: "History" },
  { q: "The Great Pyramid still stands near which city?", choices: ["Giza", "Athens", "Rome", "Babylon"], answer: 0, category: "History" },
  { q: "In which year did the Titanic sink?", choices: ["1905", "1912", "1918", "1923"], answer: 1, category: "History" },
  { q: "Which empire built the Colosseum?", choices: ["Greek", "Roman", "Ottoman", "Persian"], answer: 1, category: "History" },
  { q: "In what year did the Berlin Wall fall?", choices: ["1979", "1989", "1991", "1999"], answer: 1, category: "History" },
  { q: "Who was the first person to walk on the Moon?", choices: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], answer: 1, category: "History" },
  { q: "The U.S. Declaration of Independence was signed in?", choices: ["1776", "1789", "1798", "1812"], answer: 0, category: "History" },
  { q: "Which civilization built Machu Picchu?", choices: ["Aztec", "Maya", "Inca", "Olmec"], answer: 2, category: "History" },
  { q: "The Cold War was mainly between the USA and which nation?", choices: ["China", "USSR", "Germany", "Japan"], answer: 1, category: "History" },

  // ---------- Science ----------
  { q: "What is the chemical symbol for gold?", choices: ["Go", "Au", "Ag", "Gd"], answer: 1, category: "Science" },
  { q: "Which planet is closest to the Sun?", choices: ["Venus", "Mercury", "Earth", "Mars"], answer: 1, category: "Science" },
  { q: "The formula H₂O represents which substance?", choices: ["Salt", "Water", "Oxygen", "Hydrogen peroxide"], answer: 1, category: "Science" },
  { q: "How many bones are in the adult human body?", choices: ["206", "201", "250", "180"], answer: 0, category: "Science" },
  { q: "The speed of light is approximately?", choices: ["300,000 km/s", "30,000 km/s", "3,000 km/s", "3 million km/s"], answer: 0, category: "Science" },
  { q: "Which gas do plants absorb for photosynthesis?", choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], answer: 2, category: "Science" },
  { q: "Which organelle is the 'powerhouse of the cell'?", choices: ["Nucleus", "Ribosome", "Mitochondria", "Golgi body"], answer: 2, category: "Science" },
  { q: "What is the hardest naturally occurring substance?", choices: ["Gold", "Iron", "Diamond", "Quartz"], answer: 2, category: "Science" },
  { q: "Which is the largest planet in our solar system?", choices: ["Earth", "Jupiter", "Saturn", "Neptune"], answer: 1, category: "Science" },
  { q: "What does the chemical symbol 'O' stand for?", choices: ["Osmium", "Oxygen", "Gold", "Oganesson"], answer: 1, category: "Science" },

  // ---------- Mathematics ----------
  { q: "What is 7 × 8?", choices: ["54", "56", "64", "48"], answer: 1, category: "Mathematics" },
  { q: "What is the value of pi to two decimal places?", choices: ["3.14", "3.41", "3.12", "3.16"], answer: 0, category: "Mathematics" },
  { q: "How many sides does a hexagon have?", choices: ["Five", "Six", "Seven", "Eight"], answer: 1, category: "Mathematics" },
  { q: "What is the square root of 144?", choices: ["11", "12", "13", "14"], answer: 1, category: "Mathematics" },
  { q: "What is 15% of 200?", choices: ["20", "30", "15", "45"], answer: 1, category: "Mathematics" },
  { q: "A right angle measures how many degrees?", choices: ["45", "90", "180", "360"], answer: 1, category: "Mathematics" },
  { q: "What is 9 squared?", choices: ["18", "81", "72", "99"], answer: 1, category: "Mathematics" },
  { q: "The interior angles of a triangle add up to?", choices: ["90°", "180°", "270°", "360°"], answer: 1, category: "Mathematics" },

  // ---------- Literature ----------
  { q: "Who wrote 'Romeo and Juliet'?", choices: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], answer: 1, category: "Literature" },
  { q: "The novel '1984' was written by?", choices: ["Aldous Huxley", "George Orwell", "Ray Bradbury", "H. G. Wells"], answer: 1, category: "Literature" },
  { q: "Who created the detective Sherlock Holmes?", choices: ["Agatha Christie", "Arthur Conan Doyle", "Edgar Allan Poe", "Bram Stoker"], answer: 1, category: "Literature" },
  { q: "Who wrote 'Pride and Prejudice'?", choices: ["Charlotte Brontë", "Jane Austen", "George Eliot", "Virginia Woolf"], answer: 1, category: "Literature" },
  { q: "The epic poem 'The Odyssey' is attributed to?", choices: ["Virgil", "Homer", "Ovid", "Sophocles"], answer: 1, category: "Literature" },
  { q: "Who wrote the 'Harry Potter' series?", choices: ["J. K. Rowling", "J. R. R. Tolkien", "C. S. Lewis", "Philip Pullman"], answer: 0, category: "Literature" },

  // ---------- Art & Music ----------
  { q: "Who painted the 'Mona Lisa'?", choices: ["Vincent van Gogh", "Leonardo da Vinci", "Pablo Picasso", "Rembrandt"], answer: 1, category: "Art & Music" },
  { q: "How many strings does a standard guitar have?", choices: ["Four", "Five", "Six", "Seven"], answer: 2, category: "Art & Music" },
  { q: "Ludwig van Beethoven was primarily a?", choices: ["Painter", "Composer", "Poet", "Sculptor"], answer: 1, category: "Art & Music" },
  { q: "Who painted 'The Starry Night'?", choices: ["Claude Monet", "Vincent van Gogh", "Salvador Dalí", "Henri Matisse"], answer: 1, category: "Art & Music" },
  { q: "Which instrument has black and white keys?", choices: ["Violin", "Piano", "Flute", "Drums"], answer: 1, category: "Art & Music" },

  // ---------- Film & TV ----------
  { q: "Which film franchise features 'May the Force be with you'?", choices: ["Star Trek", "Star Wars", "Avatar", "The Matrix"], answer: 1, category: "Film & TV" },
  { q: "Who directed 'Jaws' and 'E.T.'?", choices: ["Steven Spielberg", "George Lucas", "James Cameron", "Christopher Nolan"], answer: 0, category: "Film & TV" },
  { q: "Which studio created the 'Toy Story' films?", choices: ["DreamWorks", "Pixar", "Studio Ghibli", "Blue Sky"], answer: 1, category: "Film & TV" },

  // ---------- Sports ----------
  { q: "How many players from one soccer team are on the field?", choices: ["Nine", "Ten", "Eleven", "Twelve"], answer: 2, category: "Sports" },
  { q: "In which sport would you perform a 'slam dunk'?", choices: ["Tennis", "Basketball", "Golf", "Cricket"], answer: 1, category: "Sports" },
  { q: "How often are the Summer Olympic Games held?", choices: ["Every 2 years", "Every 3 years", "Every 4 years", "Every 5 years"], answer: 2, category: "Sports" },
  { q: "'Strike' and 'spare' are scoring terms in which sport?", choices: ["Bowling", "Boxing", "Baseball", "Golf"], answer: 0, category: "Sports" },

  // ---------- Nature & Food ----------
  { q: "What is the largest land animal?", choices: ["African elephant", "Rhinoceros", "Hippopotamus", "Giraffe"], answer: 0, category: "Nature & Food" },
  { q: "Honey is produced by which insect?", choices: ["Ants", "Bees", "Wasps", "Flies"], answer: 1, category: "Nature & Food" },
  { q: "Which fruit is said to 'keep the doctor away'?", choices: ["Banana", "Apple", "Orange", "Grape"], answer: 1, category: "Nature & Food" },
  { q: "What is the main ingredient in guacamole?", choices: ["Tomato", "Avocado", "Pepper", "Onion"], answer: 1, category: "Nature & Food" },
];
