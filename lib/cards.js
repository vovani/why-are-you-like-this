// Word cards. One person acts the card out silently; their team guesses.
//
// Card rules (enforced by test/cards.test.js):
//   - ONE word per card, and no verbs: things, animals, people, characters,
//     places, sports, feelings.
//   - Actable without words or sounds. No abstract ideas (karma, WiFi, echo).
//   - Not trivial: nothing you'd solve by pointing at the room (chair, door).
//   - No duplicates anywhere in a language's deck.
//   - easy = everyday, medium = less common, hard = tricky but still actable.
//   - Hebrew is written natively, not translated; local references welcome.

export const cards = {
  en: {
    easy: [
      // Animals
      'Dog', 'Cat', 'Elephant', 'Snake', 'Monkey', 'Rabbit', 'Lion', 'Chicken', 'Frog', 'Bear',
      'Horse', 'Penguin', 'Kangaroo', 'Duck', 'Pig', 'Cow', 'Mouse', 'Shark', 'Butterfly', 'Spider',
      'Bee', 'Turtle', 'Owl', 'Crab', 'Giraffe', 'Gorilla', 'Dinosaur', 'Fish', 'Camel', 'Dolphin',
      'Sheep', 'Goat', 'Tiger', 'Zebra', 'Whale',

      // Things
      'Umbrella', 'Camera', 'Guitar', 'Piano', 'Violin', 'Drum', 'Scissors', 'Ladder', 'Hammer', 'Kite',
      'Skateboard', 'Bicycle', 'Balloon', 'Bathtub', 'Shower', 'Telephone', 'Microphone', 'Sunglasses', 'Backpack', 'Pillow',
      'Blanket', 'Candle', 'Key', 'Book', 'Ball', 'Broom', 'Bucket', 'Glove', 'Sock', 'Shoe',
      'Hat',

      // Vehicles
      'Car', 'Bus', 'Train', 'Airplane', 'Boat', 'Rocket', 'Helicopter', 'Tractor', 'Motorcycle',

      // Food
      'Pizza', 'Banana', 'Hamburger', 'Popcorn', 'Spaghetti', 'Sandwich', 'Cake', 'Watermelon', 'Lemon', 'Popsicle',
      'Lollipop', 'Corn',

      // Jobs
      'Doctor', 'Teacher', 'Chef', 'Police', 'Firefighter', 'Pilot', 'Dentist', 'Farmer', 'Hairdresser', 'Waiter',
      'Photographer', 'Magician', 'Astronaut', 'Builder', 'Lifeguard', 'Mailman', 'Soldier', 'DJ', 'Gardener', 'Nurse',

      // Characters
      'Baby', 'Robot', 'King', 'Queen', 'Pirate', 'Cowboy', 'Ninja', 'Clown', 'Witch', 'Ghost',
      'Vampire', 'Zombie', 'Superhero', 'Mermaid', 'Grandpa', 'Grandma', 'Monster', 'Princess', 'Alien',

      // Feelings
      'Happy', 'Sad', 'Angry', 'Scared', 'Surprised', 'Tired', 'Hungry', 'Shy', 'Sick', 'Cold',

      // Sports
      'Tennis', 'Soccer', 'Basketball', 'Golf', 'Karate', 'Yoga', 'Baseball', 'Volleyball', 'Bowling', 'Boxing',
      'Ping-pong',

      // Nature
      'Beach', 'Rain', 'Snow', 'Fire', 'Tree', 'Flower', 'Wind',
    ],

    medium: [
      // Animals
      'Octopus', 'Peacock', 'Bat', 'Jellyfish', 'Scorpion', 'Chameleon', 'Flamingo', 'Hippo', 'Rhino', 'Skunk',
      'Porcupine', 'Lobster', 'Seahorse', 'Beaver', 'Ostrich', 'Sloth', 'Hedgehog', 'Woodpecker', 'Mosquito', 'Snail',
      'Crocodile', 'Squirrel', 'Eagle', 'Seal', 'Parrot', 'Koala', 'Panda', 'Worm', 'Moose',

      // Things
      'Toaster', 'Blender', 'Seesaw', 'Trampoline', 'Telescope', 'Microwave', 'Elevator', 'Escalator', 'Treadmill', 'Parachute',
      'Kayak', 'Lightsaber', 'Wheelchair', 'Crutches', 'Stethoscope', 'Binoculars', 'Slingshot', 'Yo-yo', 'Wheelbarrow', 'Lawnmower',
      'Iron', 'Snorkel', 'Surfboard', 'Sled', 'Hammock', 'Stroller', 'Typewriter', 'Chainsaw', 'Lipstick', 'Tent',
      'Handcuffs', 'Swing', 'Accordion', 'Trumpet', 'Harp', 'Saxophone', 'Bagpipes',

      // People & characters
      'Mummy', 'Werewolf', 'Mime', 'Knight', 'Samurai', 'Viking', 'Caveman', 'Sheriff', 'Spy', 'Detective',
      'Santa', 'Spider-Man', 'Batman', 'Frankenstein', 'Scarecrow', 'Cheerleader', 'Ballerina', 'Bodybuilder', 'Lumberjack', 'Butler',
      'Surgeon', 'Conductor', 'Juggler', 'Acrobat', 'Referee', 'Mechanic', 'Cashier', 'Jockey', 'Pharaoh', 'Gladiator',
      'Elf',

      // Feelings
      'Dizzy', 'Bored', 'Nervous', 'Confused', 'Embarrassed', 'Proud', 'Jealous', 'Grumpy', 'Disgusted', 'Sleepy',

      // Sports & games
      'Hockey', 'Rugby', 'Badminton', 'Gymnastics', 'Karaoke', 'Limbo', 'Hopscotch', 'Twister', 'Bungee', 'Parkour',
      'Marathon', 'Judo', 'Sumo', 'Archery',

      // Everyday
      'Hiccups', 'Sunburn', 'Splinter', 'Headache', 'Tantrum', 'Massage', 'Haircut', 'Wedding', 'Birthday', 'Picnic',
      'Barbecue', 'Traffic', 'Hangover', 'Nightmare', 'Flu', 'Selfie',

      // Places
      'Library', 'Gym', 'Airport', 'Hospital', 'Zoo', 'Circus', 'Casino', 'Supermarket', 'Museum', 'Desert',
      'Jungle', 'Igloo', 'Castle',
    ],

    hard: [
      // Animals
      'Platypus', 'Armadillo', 'Pelican', 'Vulture', 'Anteater', 'Mole', 'Llama', 'Piranha', 'Stingray', 'Termite',
      'Cockroach', 'Pufferfish', 'Walrus',

      // Things
      'Boomerang', 'Quicksand', 'Hourglass', 'Metronome', 'Periscope', 'Catapult', 'Guillotine', 'Unicycle', 'Jackhammer', 'Defibrillator',
      'Straitjacket', 'Snowglobe', 'Pinata', 'Rollercoaster', 'Carousel', 'Zipline', 'Jetpack', 'Submarine', 'Hovercraft', 'Gondola',
      'Corkscrew', 'Mousetrap', 'Bubblegum', 'Chopsticks', 'Spatula', 'Whisk', 'Plunger', 'Toupee', 'Dentures', 'Monocle',
      'Stilts', 'Scuba', 'Jacuzzi', 'Sauna',

      // People & characters
      'Contortionist', 'Puppeteer', 'Hypnotist', 'Stuntman', 'Bodyguard', 'Bouncer', 'Paparazzi', 'Pickpocket', 'Burglar', 'Hitchhiker',
      'Sleepwalker', 'Cyclops', 'Centaur', 'Leprechaun', 'Genie', 'Yeti', 'Godzilla', 'Medusa', 'Pinocchio', 'Tarzan',
      'Dracula', 'Sherlock', 'Elvis', 'Gandalf', 'Yoda', 'Rapunzel', 'Cinderella', 'Zorro',

      // Nature
      'Tornado', 'Earthquake', 'Tsunami', 'Volcano', 'Avalanche', 'Blizzard', 'Lightning', 'Geyser', 'Iceberg', 'Meteor',

      // Everyday
      'Jetlag', 'Insomnia', 'Allergy', 'Wedgie', 'Heist', 'Ambush', 'Stampede', 'Proposal',

      // Dances
      'Ballet', 'Tango', 'Flamenco', 'Breakdance', 'Moonwalk', 'Salsa', 'Hula',

      // Games & curiosities
      'Chess', 'Dominoes', 'Cactus', 'Dreidel', 'Mannequin', 'Lasso', 'Sphinx', 'Gargoyle', 'Totem', 'Harpoon', 'Tightrope', 'Trapeze',

      // Movies
      'Titanic', 'Jaws', 'Rocky', 'Avatar', 'Frozen',
    ],
  },

  he: {
    easy: [
      // חיות
      'כלב', 'חתול', 'פיל', 'נחש', 'קוף', 'ארנב', 'אריה', 'תרנגולת', 'צפרדע', 'דוב',
      'סוס', 'פינגווין', 'קנגורו', 'ברווז', 'חזיר', 'פרה', 'עכבר', 'כריש', 'פרפר', 'עכביש',
      'דבורה', 'צב', 'ינשוף', 'סרטן', "ג'ירפה", 'גורילה', 'דינוזאור', 'דג', 'גמל', 'דולפין',
      'כבשה', 'עז', 'נמר', 'זברה', 'לווייתן',

      // חפצים
      'מטרייה', 'מצלמה', 'גיטרה', 'פסנתר', 'כינור', 'תוף', 'מספריים', 'סולם', 'פטיש', 'עפיפון',
      'סקייטבורד', 'אופניים', 'בלון', 'אמבטיה', 'מקלחת', 'טלפון', 'מיקרופון', 'משקפיים', 'תיק', 'כרית',
      'שמיכה', 'נר', 'מפתח', 'ספר', 'כדור', 'מטאטא', 'דלי', 'כפפה', 'גרב', 'נעל',
      'כובע', 'מטקות',

      // כלי תחבורה
      'מכונית', 'אוטובוס', 'רכבת', 'מטוס', 'סירה', 'טיל', 'מסוק', 'טרקטור', 'אופנוע',

      // אוכל
      'פיצה', 'בננה', 'המבורגר', 'פופקורן', 'ספגטי', 'כריך', 'עוגה', 'אבטיח', 'לימון', 'ארטיק',
      'סוכרייה', 'פלאפל', 'שווארמה',

      // מקצועות
      'רופא', 'מורה', 'שף', 'שוטר', 'כבאי', 'טייס', 'חקלאי', 'מלצר', 'צלם', 'קוסם',
      'אסטרונאוט', 'מציל', 'דוור', 'חייל', "דיג'יי", 'גנן', 'אחות', 'אינסטלטור', 'נהג',

      // דמויות
      'תינוק', 'רובוט', 'מלך', 'מלכה', 'פיראט', 'קאובוי', "נינג'ה", 'ליצן', 'מכשפה', 'ערפד',
      'זומבי', 'סבא', 'סבתא', 'מפלצת', 'נסיכה', 'חייזר',

      // רגשות
      'שמחה', 'עצב', 'כעס', 'פחד', 'הפתעה', 'עייפות', 'רעב', 'ביישנות', 'צמא', 'קור',

      // ספורט
      'טניס', 'כדורגל', 'כדורסל', 'גולף', 'קראטה', 'יוגה', 'כדורעף', 'באולינג', 'איגרוף', 'פינגפונג',
      'שחייה',

      // טבע
      'ים', 'חוף', 'גשם', 'שלג', 'אש', 'עץ', 'פרח',
    ],

    medium: [
      // חיות
      'תמנון', 'טווס', 'עטלף', 'מדוזה', 'עקרב', 'זיקית', 'פלמינגו', 'היפופוטם', 'קרנף', 'בואש',
      'דורבן', 'לובסטר', 'בונה', 'יען', 'עצלן', 'קיפוד', 'נקר', 'יתוש', 'חילזון', 'תנין',
      'סנאי', 'נשר', 'תוכי', 'קואלה', 'פנדה', 'תולעת',

      // חפצים
      'טוסטר', 'בלנדר', 'נדנדה', 'טרמפולינה', 'טלסקופ', 'מיקרוגל', 'מעלית', 'דרגנוע', 'הליכון', 'מצנח',
      'קיאק', 'קביים', 'סטטוסקופ', 'משקפת', 'רוגטקה', 'יויו', 'חישוק', 'מריצה', 'מגהץ', 'שנורקל',
      'גלשן', 'מזחלת', 'ערסל', 'עגלה', 'מסור', 'פומפה', 'שפתון', 'סלפי', 'אוהל', 'אזיקים',
      'אקורדיון', 'חצוצרה', 'נבל', 'סקסופון', 'חליל',

      // דמויות
      'מומיה', 'פנטומימאי', 'אביר', 'סמוראי', 'ויקינג', 'שריף', 'מרגל', 'בלש', 'ספיידרמן', 'באטמן',
      'פרנקנשטיין', 'דחליל', 'מעודדת', 'בלרינה', 'שרירן', 'משרת', 'מנתח', 'מנצח', 'להטוטן', 'אקרובט',
      'שופט', 'מכונאי', 'קופאית', "ג'וקי", 'פרעה', 'גלדיאטור', 'מאבטח', 'שדון',

      // רגשות
      'סחרחורת', 'שעמום', 'לחץ', 'בלבול', 'מבוכה', 'גאווה', 'קנאה', 'עצבים', 'גועל', 'ישנוניות',

      // ספורט ומשחקים
      'הוקי', 'רוגבי', 'בדמינטון', 'התעמלות', 'קריוקי', 'לימבו', 'קלאס', 'טוויסטר', "באנג'י", 'פארקור',
      'מרתון', "ג'ודו", 'סיוף', 'היאבקות', 'מחבואים',

      // יומיום
      'שיהוקים', 'כוויה', 'קוץ', 'מיגרנה', 'קריזה', 'עיסוי', 'תספורת', 'חתונה', 'יומולדת', 'פיקניק',
      'מנגל', 'פקק', 'הנגאובר', 'סיוט', 'שפעת',

      // מקומות
      'ספרייה', 'נתב"ג', 'מיון', 'ספארי', 'קרקס', 'קזינו', 'סופר', 'מוזיאון', 'מדבר', "ג'ונגל",
      'איגלו', 'טירה', 'שוק',
    ],

    hard: [
      // חיות
      'ברווזן', 'ארמדילו', 'שקנאי', 'חפרפרת', 'לאמה', 'פיראנה', 'טרמיט', "ג'וק", 'ניבתן',

      // חפצים
      'בומרנג', 'מטרונום', 'פריסקופ', 'קטפולטה', 'גיליוטינה', 'דפיברילטור', 'פיניאטה', 'קרוסלה', 'אומגה', 'צוללת',
      'רחפת', 'גונדולה', 'מלכודת', 'מסטיק', "צ'ופסטיקס", 'מרית', 'מטרפה', 'פאה', 'תותבות', 'מונוקל',
      'כלונסאות', 'צלילה', "ג'קוזי", 'סאונה',

      // דמויות
      'בובנאי', 'מהפנט', 'פעלולן', 'סלקטור', 'פפראצי', 'כייס', 'פורץ', 'טרמפיסט', 'סהרורי', 'קיקלופ',
      'קנטאור', "ג'יני", 'יטי', 'גודזילה', 'פינוקיו', 'טרזן', 'דרקולה', 'שרלוק', 'אלביס', 'גנדלף',
      'יודה', 'רפונזל', 'סינדרלה', 'שמשון', 'גוליית', 'זורו',

      // טבע
      'טורנדו', 'צונאמי', 'מפולת', 'סופה', 'ברק', 'גייזר', 'קרחון', 'מטאור',

      // יומיום
      "ג'טלג", 'אלרגיה', 'חטיפה', 'שוד', 'מארב',

      // ריקודים
      'בלט', 'טנגו', 'פלמנקו', 'ברייקדאנס', 'הורה', 'דבקה', 'סלסה',

      // משחקים ושונות
      'פסל', 'שחמט', 'דומינו', 'בילבוקט', 'גוגואים', 'סביבון', 'חנוכייה', 'שופר', 'קקטוס', 'כספת', 'צנחן', 'סוכה',

      // סרטים
      'טיטאניק', 'מלתעות', 'רוקי', 'אווטאר', 'פרוזן',
    ],
  },
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const LANGUAGES = Object.keys(cards);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Shuffled, de-duplicated deck. Unknown difficulty/language fall back to
 * defaults instead of throwing. `exclude` is any iterable of words to drop
 * (banned words, words already played this game).
 */
export function getShuffledDeck(difficulty, language = 'en', exclude = []) {
  const lang = cards[language] || cards.en;
  const list = lang[difficulty] || lang.easy;
  const skip = new Set(exclude);
  return shuffle([...new Set(list)].filter(w => !skip.has(w)));
}
