// Word lists organized by difficulty
// Themed around relatable, funny, and "why are you like this" situations

const cards = {
  easy: [
    // Basic actions and things
    "Pizza",
    "Dancing",
    "Birthday party",
    "Sleeping",
    "Taking a selfie",
    "Walking the dog",
    "Cooking dinner",
    "Watching TV",
    "Playing video games",
    "Going shopping",
    "Eating ice cream",
    "Swimming",
    "Reading a book",
    "Texting",
    "Singing in the shower",
    "Making coffee",
    "Brushing teeth",
    "Doing laundry",
    "Riding a bike",
    "Waiting for the bus",
    // Relatable easy ones
    "Running late",
    "Taking a nap",
    "Binge watching",
    "Midnight snack",
    "Hitting snooze",
    "Getting a haircut",
    "Waiting in line",
    "Taking out trash",
    "Charging your phone",
    "Making the bed",
    "Ordering takeout",
    "Scrolling social media",
    "Taking a shower",
    "Packing a suitcase",
    "Looking for parking",
    "Catching a cold",
    "Forgetting something",
    "Being hungry",
    "Feeling sleepy",
    "Being bored",
    "Getting excited",
    "Being nervous",
    "Feeling cold",
    "Being too hot",
    "Having hiccups",
    "Yawning",
    "Stretching",
    "Daydreaming",
    "Being confused",
    "Feeling happy"
  ],

  medium: [
    // Relatable struggles
    "Procrastination",
    "Awkward silence",
    "Monday morning",
    "Sunday scaries",
    "Food coma",
    "Post-vacation blues",
    "Decision fatigue",
    "Social battery dying",
    "FOMO",
    "Hangry",
    "Brain fog",
    "Doomscrolling",
    "Reply all disaster",
    "Autocorrect fail",
    "Forgetting someone's name",
    "Waving at wrong person",
    "Walking into glass door",
    "Sending text to wrong person",
    "Talking to yourself",
    "Laughing at own joke",
    // Situations
    "Pretending to work",
    "Avoiding eye contact",
    "Fake laughing",
    "Running into your ex",
    "Meeting your crush",
    "Job interview nerves",
    "First date anxiety",
    "Waiting for a text back",
    "Getting ghosted",
    "Reading on delivered",
    "Parallel parking",
    "Making small talk",
    "Crying at commercials",
    "Retail therapy",
    "Stress eating",
    "Overthinking",
    "Getting ASMR tingles",
    "Having a quarter-life crisis",
    "Being extra",
    "Caught in the rain",
    "Missing your stop",
    "Elevator small talk",
    "Forgetting your password",
    "Autocomplete embarrassment",
    "When WiFi stops working",
    "Hearing your voice recorded",
    "Photo doesn't match reality",
    "Cart abandonment guilt",
    "Unread email anxiety",
    "Meeting deadlines last minute"
  ],

  hard: [
    // Deep relatable moments
    "Existential crisis",
    "Passive aggressive",
    "Imposter syndrome",
    "Main character energy",
    "Chronically online",
    "Parasocial relationship",
    "Weaponized incompetence",
    "Performative activism",
    "Love bombing",
    "Gaslighting yourself",
    "Emotional unavailability",
    "Toxic positivity",
    "Situationship",
    "Breadcrumbing",
    "Quiet quitting",
    "Hustle culture burnout",
    "Doomspiraling",
    "Revenge bedtime procrastination",
    "Decision paralysis",
    "Analysis paralysis",
    // Complex scenarios
    "Acting like you read the article",
    "Pretending to understand wine",
    "Faking a phone call to escape",
    "Laughing at a joke you didn't hear",
    "Nodding along in a meeting",
    "Pretending you're fine",
    "Acting surprised at a surprise party",
    "Fake typing to look busy",
    "Being fashionably late on purpose",
    "Humble bragging",
    "Posting for the aesthetic",
    "Manifesting your best life",
    "Having a shower argument",
    "Planning revenge you'll never take",
    "Stalking someone's social media",
    "Rehearsing a confrontation",
    "Avoiding someone you know in public",
    "Pretending to be on a call",
    "Acting normal after falling",
    "Playing it cool when nervous",
    "Being passive about restaurant choice",
    "Apologizing when not sorry",
    "Saying you're 5 minutes away",
    "Judging someone silently",
    "Acting like you don't care",
    "Pretending to be happy for someone",
    "Posting vague attention-seeking stories",
    "Being chronically early but hiding it",
    "Acting surprised when you already know",
    "Pretending not to see someone"
  ]
};

// Get shuffled cards for a specific difficulty
function getShuffledDeck(difficulty) {
  const deck = [...cards[difficulty]];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Get combined deck with all difficulties
function getAllCards() {
  return {
    easy: [...cards.easy],
    medium: [...cards.medium],
    hard: [...cards.hard]
  };
}

module.exports = {
  cards,
  getShuffledDeck,
  getAllCards
};

