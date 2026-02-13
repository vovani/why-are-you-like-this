// Word cards for charades-style acting game
// Each word should be a single word or very short phrase that can be acted out
// Supports English and Hebrew

const cards = {
  en: {
    easy: [
      // Animals
      "Dog", "Cat", "Elephant", "Snake", "Monkey", "Bird", "Fish", "Rabbit", "Lion", "Chicken",
      "Frog", "Bear", "Horse", "Penguin", "Kangaroo", "Duck", "Pig", "Cow", "Sheep", "Goat",
      "Mouse", "Tiger", "Zebra", "Dolphin", "Shark", "Butterfly", "Spider", "Bee", "Ant", "Turtle",
      "Parrot", "Owl", "Eagle", "Squirrel", "Deer", "Wolf", "Fox", "Seal", "Whale", "Crab",
      "T-Rex", "Llama", "Sloth", "Hedgehog", "Snail", "Worm", "Giraffe", "Panda", "Koala", "Gorilla",
      
      // Actions
      "Sleeping", "Eating", "Dancing", "Running", "Crying", "Laughing", "Jumping", "Swimming", "Cooking", "Reading",
      "Writing", "Singing", "Sneezing", "Yawning", "Clapping", "Walking", "Sitting", "Standing", "Waving", "Pointing",
      "Kicking", "Throwing", "Catching", "Pushing", "Pulling", "Climbing", "Falling", "Crawling", "Hopping", "Skipping",
      "Hugging", "Kissing", "Shaking", "Nodding", "Blinking", "Chewing", "Drinking", "Brushing", "Combing", "Washing",
      "Taking a Selfie", "Gaming", "Typing", "Vacuuming", "Ironing", "Yoga", "Shaving", "High Five", "Texting",
      
      // Objects
      "Phone", "Chair", "Clock", "Mirror", "Umbrella", "Camera", "Guitar", "Balloon", "Candle", "Hammer",
      "Book", "Pencil", "Scissors", "Key", "Door", "Window", "Table", "Bed", "Lamp", "Cup",
      "Plate", "Fork", "Spoon", "Knife", "Ball", "Hat", "Shoe", "Sock", "Shirt", "Pants",
      "Glasses", "Watch", "Ring", "Necklace", "Bag", "Box", "Rope", "Ladder", "Wheel", "Bell",
      "Toilet Paper", "Remote Control", "Pizza", "Burger", "Ice Cream", "Banana", "Toothpaste", "Laptop",
      
      // Occupations
      "Doctor", "Teacher", "Chef", "Police", "Firefighter", "Pilot", "Dentist", "Farmer", "Nurse", "Driver",
      "Painter", "Singer", "Actor", "Dancer", "Athlete", "Soldier", "Sailor", "Builder", "Cleaner", "Waiter",
      "YouTuber", "Gamer", "DJ", "Photographer", "Magician", "Astronaut",
      
      // Characters
      "Baby", "Robot", "King", "Queen", "Princess", "Pirate", "Cowboy", "Ninja", "Clown", "Witch",
      "Ghost", "Vampire", "Zombie", "Superhero",
      
      // Emotions
      "Happy", "Sad", "Angry", "Scared", "Surprised", "Tired", "Hungry", "Thirsty", "Cold", "Hot"
    ],

    medium: [
      // Animals
      "Octopus", "Peacock", "Bat", "Jellyfish", "Scorpion", "Chameleon", "Flamingo", "Hippo", "Rhino", "Camel",
      "Raccoon", "Skunk", "Porcupine", "Lobster", "Starfish", "Seahorse", "Mole", "Beaver", "Otter", "Pelican", 
      "Vulture", "Ostrich", "Armadillo",
      
      // Specific/Fun Actions
      "Surfing", "Bowling", "Skiing", "Boxing", "Fishing", "Juggling", "Hiccupping", "Snoring", "Tiptoeing", "Stretching",
      "Shivering", "Winking", "Fainting", "Itching", "Whistling", "Gargling", "Limping", "Stumbling", "Tripping", "Sliding",
      "Bouncing", "Spinning", "Twirling", "Marching", "Galloping", "Pouncing", "Lunging", "Ducking", "Dodging", "Balancing",
      "Flexing", "Posing", "Bowing", "Curtsying", "Saluting", "Fanning", "Shushing", "Giggling", "Sobbing", "Groaning",
      "Stepping on Lego", "Brain Freeze", "Walking into Spiderweb", "Stubbing Toe", "Burned Tongue", "Paper Cut",
      "Walking a Dog", "Changing a Diaper", "Putting on Skinny Jeans", "Bad Hair Day", "Trying to kill a fly",
      "Folding a fitted sheet", "Parallel Parking", "Hailing a Taxi", "Riding a Rollercoaster", "Walking on hot sand",
      "Opening a stuck jar", "Flipping a pancake", "Eating Spaghetti", "Using Chopsticks",
      
      // Objects/Concepts
      "Toothbrush", "Blender", "Seesaw", "Trampoline", "Telescope", "Microwave", "Chandelier", "Skateboard", "Elevator",
      "Escalator", "Treadmill", "Jacuzzi", "Fireplace", "Chimney", "Fountain", "Statue", "Trophy", "Medal", "Crown",
      "Throne", "Scepter", "Shield", "Sword", "Bow", "Arrow", "Cannon", "Anchor", "Compass", "Binoculars",
      "Stethoscope", "Syringe", "Bandage", "Crutch", "Wheelchair", "Parachute", "Hang glider", "Surfboard", "Snowboard", "Kayak",
      "Lightsaber", "Magic Carpet", "UFO", "Time Machine", "Voodoo Doll", "Crystal Ball",
      
      // Roles/Characters
      "Mummy", "Werewolf", "Mermaid", "Mime", "Jester",
      "Knight", "Samurai", "Viking", "Gladiator", "Pharaoh", "Caveman", "Sheriff", "Outlaw", "Spy", "Detective",
      "Santa Claus", "Easter Bunny", "Tooth Fairy", "Statue of Liberty", "Harry Potter", "Batman", "Spider-Man",
      
      // Emotions/States
      "Dizzy", "Sleepy", "Excited", "Bored", "Nervous", "Confused", "Embarrassed", "Proud", "Jealous", "Grumpy",
      
      // Sports/Activities
      "Tennis", "Golf", "Hockey", "Baseball", "Basketball", "Football", "Volleyball", "Archery", "Fencing", "Wrestling"
    ],

    hard: [
      // Abstract/Tricky
      "Shadow", "Echo", "Gravity", "Invisible", "Melting", "Shrinking", "Growing", "Floating", "Sinking", "Evaporating",
      "Freezing", "Exploding", "Imploding", "Vibrating", "Pulsating", "Morphing", "Teleporting", "Time travel", "Déjà vu", "Amnesia",
      "The Internet", "WiFi", "Bitcoin", "Global Warming", "Karma", "Silence", "Noise", "Infinity",
      
      // Complex Actions/Situations
      "Sleepwalking", "Daydreaming", "Meditating", "Sunbathing", "Brainstorming", "Eavesdropping", "Procrastinating", "Improvising", "Hypnotizing", "Moonwalking",
      "Breakdancing", "Beatboxing", "Ventriloquism", "Pickpocketing", "Lockpicking", "Tightrope walking", "Fire breathing", "Sword swallowing", "Mind reading", "Levitating",
      "Hallucinating", "Stammering", "Stuttering", "Mumbling", "Rambling", "Ranting", "Gossiping", "Whispering", "Yelling", "Mocking",
      "Losing WiFi Signal", "Battery Dying", "Forgot Password", "Awkward Elevator Ride", "Blind Date", "Job Interview",
      "Traffic Jam", "Winning the Lottery", "Alien Abduction", "Realizing you forgot your phone", "Holding a sneeze",
      
      // Tricky Objects/Concepts
      "Boomerang", "Quicksand", "Revolving door", "Vending machine", "Slot machine", "Cuckoo clock", "Mousetrap", "Pinball", "Yo-yo", "Rubik's cube",
      "Kaleidoscope", "Hologram", "Mirage", "Black hole", "Wormhole", "Tornado", "Earthquake", "Tsunami", "Volcano", "Avalanche",
      "Lightning", "Rainbow", "Northern lights", "Solar eclipse", "Meteor shower", "Whirlpool", "Geyser", "Sandstorm", "Blizzard",
      
      // Characters/Roles
      "Frankenstein", "Villain", "Scarecrow", "Puppeteer", "Contortionist", "Acrobat", "Trapeze artist", "Lion tamer", "Snake charmer",
      "Fortune teller", "Hypnotist", "Illusionist", "Escape artist", "Stuntman", "Bodyguard", "Bouncer", "Paparazzi", "Auctioneer",
      
      // Games/Activities
      "Tug of war", "Hot potato", "Musical chairs", "Limbo", "Freeze dance", "Simon says", "Hide and seek", "Tag", "Hopscotch", "Jump rope",
      "Arm wrestling", "Thumb war", "Rock paper scissors", "Charades", "Pictionary", "Twister", "Jenga", "Operation", "Whack-a-mole", "Pinata",
      
      // Idioms
      "Raining cats and dogs", "Piece of cake", "Break a leg", "Spill the beans", "Cold feet", "Butterflies in stomach"
    ]
  },

  he: {
    easy: [
      // חיות
      "כלב", "חתול", "פיל", "נחש", "קוף", "ציפור", "דג", "ארנב", "אריה", "תרנגולת",
      "צפרדע", "דוב", "סוס", "פינגווין", "קנגורו", "ברווז", "חזיר", "פרה", "כבש", "עז",
      "עכבר", "נמר", "זברה", "דולפין", "כריש", "פרפר", "עכביש", "דבורה", "נמלה", "צב",
      "תוכי", "ינשוף", "נשר", "סנאי", "צבי", "זאב", "שועל", "כלב ים", "לוויתן", "סרטן",
      "טי-רקס", "לאמה", "עצלן", "קיפוד", "חילזון", "תולעת", "ג'ירפה", "פנדה", "קואלה", "גורילה",
      
      // פעולות
      "ישן", "אוכל", "רוקד", "רץ", "בוכה", "צוחק", "קופץ", "שוחה", "מבשל", "קורא",
      "כותב", "שר", "מתעטש", "מפהק", "מוחא כפיים", "הולך", "יושב", "עומד", "מנופף", "מצביע",
      "בועט", "זורק", "תופס", "דוחף", "מושך", "מטפס", "נופל", "זוחל", "מקפץ", "מדלג",
      "מחבק", "מנשק", "לוחץ יד", "מהנהן", "מצמץ", "לועס", "שותה", "מצחצח", "מסרק", "רוחץ",
      "עושה סלפי", "גיימינג", "מקליד", "שואב אבק", "מגהץ", "יוגה", "מתגלח", "כיף (High Five)", "שולח הודעה",
      
      // חפצים
      "טלפון", "כיסא", "שעון", "מראה", "מטריה", "מצלמה", "גיטרה", "בלון", "נר", "פטיש",
      "ספר", "עיפרון", "מספריים", "מפתח", "דלת", "חלון", "שולחן", "מיטה", "מנורה", "כוס",
      "צלחת", "מזלג", "כף", "סכין", "כדור", "כובע", "נעל", "גרב", "חולצה", "מכנסיים",
      "משקפיים", "שעון יד", "טבעת", "שרשרת", "תיק", "קופסה", "חבל", "סולם", "גלגל", "פעמון",
      "נייר טואלט", "שלט", "פיצה", "המבורגר", "גלידה", "בננה", "משחת שיניים", "לפטופ",
      
      // מקצועות
      "רופא", "מורה", "טבח", "שוטר", "כבאי", "טייס", "רופא שיניים", "חקלאי", "אחות", "נהג",
      "צייר", "זמר", "שחקן", "רקדן", "ספורטאי", "חייל", "מלח", "בנאי", "מנקה", "מלצר",
      "יוטיובר", "גיימר", "דיג'יי", "צלם", "קוסם", "אסטרונאוט",
      
      // דמויות
      "תינוק", "רובוט", "מלך", "מלכה", "נסיכה", "פיראט", "קאובוי", "נינג'ה", "ליצן", "מכשפה",
      "רוח רפאים", "ערפד", "זומבי", "גיבור על",
      
      // רגשות
      "שמח", "עצוב", "כועס", "מפוחד", "מופתע", "עייף", "רעב", "צמא", "קר", "חם"
    ],

    medium: [
      // חיות
      "תמנון", "טווס", "עטלף", "מדוזה", "עקרב", "זיקית", "פלמינגו", "היפופוטם", "קרנף", "גמל",
      "דביבון", "בואש", "דרבן", "לובסטר", "כוכב ים", "סוסון ים", "חפרפרת", "בונה", "לוטרה", "שקנאי",
      "נשר", "יען", "ארמדילו",
      
      // פעולות ספציפיות
      "גולש", "משחק באולינג", "גולש סקי", "מתאגרף", "דג", "מלהטט", "משהוק", "נוחר", "הולך על קצות האצבעות", "מתמתח",
      "רועד", "קורץ", "מתעלף", "מתגרד", "משרוק", "מגרגר", "צולע", "נתקל", "מחליק", "קופץ",
      "מסתובב", "מתפתל", "צועד", "דוהר", "זונק", "מתכופף", "מתחמק", "מאזן", "מתגמש", "פוזז",
      "משתחווה", "מצדיע", "מאוורר", "משתיק", "מצחקק", "מתייפח", "נאנח",
      "דורך על לגו", "קיפאון מוחי (Brain Freeze)", "נתקל בקורי עכביש", "מקבל מכה בזרת", "לשון שרופה", "חתך מנייר",
      "מטייל עם כלב", "מחליף חיתול", "לובש ג'ינס צמוד", "יום שיער רע", "מנסה להרוג זבוב",
      "מקפל סדין גומי", "חניה במקביל", "עוצר מונית", "נוסע ברכבת הרים", "הולך על חול חם",
      "פותח צנצנת תקועה", "הופך פנקייק", "אוכל ספגטי", "אוכל עם צ'ופסטיקס",
      
      // חפצים
      "מברשת שיניים", "בלנדר", "נדנדה", "טרמפולינה", "טלסקופ", "מיקרוגל", "נברשת", "סקייטבורד", "מעלית",
      "דרגנוע", "הליכון", "ג'קוזי", "אח", "ארובה", "מזרקה", "פסל", "גביע", "מדליה", "כתר",
      "כס מלכות", "שרביט", "מגן", "חרב", "קשת", "חץ", "תותח", "עוגן", "מצפן", "משקפת",
      "סטטוסקופ", "מזרק", "תחבושת", "קב", "כיסא גלגלים", "מצנח", "גלשן", "סנובורד", "קיאק",
      "חרב אור", "שטיח מעופף", "חללית", "מכונת זמן", "בובת וודו", "כדור בדולח",
      
      // דמויות
      "מומיה", "אדם זאב", "בת ים", "פנטומימאי", "ליצן חצר",
      "אביר", "סמוראי", "ויקינג", "גלדיאטור", "פרעה", "אדם קדמון", "שריף", "פושע", "מרגל", "בלש",
      "סנטה קלאוס", "ארנב הפסחא", "פיית השיניים", "פסל החירות", "הארי פוטר", "באטמן", "ספיידרמן",
      
      // רגשות/מצבים
      "סחרחר", "מנומנם", "נרגש", "משועמם", "עצבני", "מבולבל", "נבוך", "גאה", "מקנא", "זועף",
      
      // ספורט
      "טניס", "גולף", "הוקי", "בייסבול", "כדורסל", "כדורגל", "כדורעף", "קשתות", "סיוף", "היאבקות"
    ],

    hard: [
      // מופשט/מתוחכם
      "צל", "הד", "כוח משיכה", "בלתי נראה", "נמס", "מתכווץ", "גדל", "מרחף", "שוקע", "מתאדה",
      "קופא", "מתפוצץ", "מתמוטט", "רוטט", "פועם", "משתנה צורה", "טלפורט", "מסע בזמן", "דז'ה וו", "אמנזיה",
      "האינטרנט", "WiFi", "ביטקוין", "התחממות גלובלית", "קארמה", "שקט", "רעש", "אינסוף",
      
      // פעולות מורכבות/מצבים
      "מהלך בשינה", "חולם בהקיץ", "מתרגל מדיטציה", "משתזף", "סיעור מוחות", "מצותת", "מתמהמה", "מאלתר", "מהפנט", "הליכת ירח",
      "ברייקדאנס", "ביטבוקס", "בובנאות", "כייס", "פורץ מנעולים", "הליכה על חבל", "יורק אש", "בולע חרבות", "קורא מחשבות", "מרחף",
      "הזיות", "מגמגם", "ממלמל", "מקשקש", "מתלונן", "מרכל", "לוחש", "צועק", "מחקה",
      "האינטרנט התנתק", "סוללה נגמרת", "שכחתי סיסמה", "שתיקה מביכה במעלית", "בליינד דייט", "ראיון עבודה",
      "פקק תנועה", "זכייה בלוטו", "חטיפת חייזרים", "שכחת את הטלפון", "מחזיק אפצ'י",
      
      // חפצים מורכבים
      "בומרנג", "חול טובעני", "דלת מסתובבת", "מכונת ממכר", "מכונת מזל", "שעון קוקיה", "מלכודת עכברים", "פינבול", "יויו", "קוביה הונגרית",
      "קליידוסקופ", "הולוגרמה", "מרחשת", "חור שחור", "טורנדו", "רעידת אדמה", "צונאמי", "הר געש", "מפולת",
      "ברק", "קשת בענן", "זוהר צפוני", "ליקוי חמה", "גשם מטאורים", "מערבולת", "גייזר", "סופת חול", "סופת שלגים",
      
      // דמויות
      "פרנקנשטיין", "נבל", "דחליל", "בובנאי", "אקרובט", "מאלף אריות", "מכשף נחשים",
      "מגידת עתידות", "מהפנט", "אשפן", "אמן בריחות", "קסקדור", "שומר ראש", "סדרן", "פפראצי", "מכרז",
      
      // משחקים
      "משיכת חבל", "תפוח אדמה לוהט", "כיסאות מוזיקליים", "לימבו", "ריקוד קפוא", "סיימון אומר", "מחבואים", "תופסת", "קלאס", "קפיצה בחבל",
      "הורדת ידיים", "מלחמת אגודלים", "אבן נייר ומספריים", "שרדות", "פיקשנרי", "טוויסטר", "ג'נגה", "הכה את החפרפרת", "פיניאטה",
      
      // ביטויים
      "פרפרים בבטן", "קלי קלות", "שובר רגל", "רגליים קרות", "מגלה את הסוד"
    ]
  }
};

// Get shuffled cards for a specific difficulty and language
function getShuffledDeck(difficulty, language = 'en', bannedWords = []) {
  const lang = cards[language] || cards.en;
  // Filter out only banned words — keep multi-word phrases (they're some of the best cards)
  const deck = [...lang[difficulty]].filter(word => !bannedWords.includes(word));
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Get all available languages
function getLanguages() {
  return Object.keys(cards);
}

// Get combined deck with all difficulties for a language
function getAllCards(language = 'en') {
  const lang = cards[language] || cards.en;
  return {
    easy: [...lang.easy],
    medium: [...lang.medium],
    hard: [...lang.hard]
  };
}

module.exports = {
  cards,
  getShuffledDeck,
  getLanguages,
  getAllCards
};
