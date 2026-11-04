// Guards the deck rules described at the top of lib/cards.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cards, DIFFICULTIES, getShuffledDeck } from '../lib/cards.js';

const LANGS = Object.keys(cards);

test('every language has every difficulty, each a real deck', () => {
  assert.deepEqual(LANGS.sort(), ['en', 'he']);
  for (const lang of LANGS) {
    for (const d of DIFFICULTIES) {
      assert.ok(cards[lang][d].length >= 80, `${lang}/${d} has only ${cards[lang][d].length} cards`);
    }
  }
});

test('no duplicates anywhere in a language (across difficulties too)', () => {
  for (const lang of LANGS) {
    const seen = new Map();
    for (const d of DIFFICULTIES) {
      for (const w of cards[lang][d]) {
        const key = w.trim().toLowerCase();
        assert.ok(!seen.has(key), `${lang}: "${w}" is in both ${seen.get(key)} and ${d}`);
        seen.set(key, d);
      }
    }
  }
});

test('one word per card, clean and readable on a phone', () => {
  for (const lang of LANGS) {
    for (const d of DIFFICULTIES) {
      for (const w of cards[lang][d]) {
        assert.ok(!/\s/.test(w), `${lang}/${d}: one word only, got "${w}"`);
        assert.ok(!/[()[\]{}/\\0-9]/.test(w), `brackets, slashes or digits: "${w}"`);
        assert.ok(w.length <= 16, `too long for the card: "${w}"`);
      }
    }
  }
});

test('English cards are capitalized single words, no verbs', () => {
  // -ing words are verbs, except these real nouns.
  const ingNouns = new Set(['King', 'Viking', 'Ring', 'Wedding', 'Swing', 'Bowling', 'Boxing', 'Lightning']);
  for (const d of DIFFICULTIES) {
    for (const w of cards.en[d]) {
      assert.match(w, /^[A-Z][A-Za-z'-]*$/, `unexpected characters: "${w}"`);
      assert.ok(!/ing$/.test(w) || ingNouns.has(w), `looks like a verb: "${w}"`);
    }
  }
});

test('Hebrew cards are Hebrew words, no infinitives', () => {
  // Infinitives start with ל + verb; these ל-nouns are fine.
  const lNouns = new Set(['לווייתן', 'לימון', 'לובסטר', 'לחץ', 'ליצן', 'לימבו', 'להטוטן', 'לאמה']);
  for (const d of DIFFICULTIES) {
    for (const w of cards.he[d]) {
      assert.ok(!/[A-Za-z]/.test(w), `Latin letters in Hebrew card: "${w}"`);
      assert.match(w, /^[\u05D0-\u05EA'"]+$/, `not a single Hebrew word: "${w}"`);
      assert.ok(!w.startsWith('ל') || lNouns.has(w), `looks like an infinitive: "${w}"`);
    }
  }
});

test('the cards players complained about stay out', () => {
  // Unactable, needs talking, trivial to point at, or bad Hebrew from the old deck.
  const removed = [
    'Sneeze', 'Taking a selfie', 'Stepping on Lego', 'Folding a fitted sheet', 'לרקוד', 'לישון', 'פקק באיילון',
    'Gravity', 'Karma', 'Infinity', 'Bitcoin', 'WiFi', 'The Internet', 'Echo', 'Silence', 'Noise', 'Déjà vu',
    'Amnesia', 'Wormhole', 'Hologram', 'Mirage', 'Kaleidoscope', 'Procrastinating', 'Brainstorming', 'Improvising',
    'Whispering', 'Mumbling', 'Ranting', 'Gossiping', 'Rambling', 'Mocking', 'Stammering', 'Stuttering', 'Auctioneer',
    'Chair', 'Door', 'Window', 'Table', 'Cup', 'Sitting', 'Standing', 'Walking', 'Pointing', 'Charades', 'Invisible',
    'כוח משיכה', 'קארמה', 'אינסוף', 'ביטקוין', 'הד', 'שקט', 'רעש', 'מרחשת', 'מכרז', 'קשתות', 'מתגמש', 'גיימינג',
    'האינטרנט', 'כיסא', 'דלת', 'חלון', 'שולחן', 'כוס', 'יושב', 'עומד', 'הולך', 'מצביע', 'ממלמל', 'מרכל', 'לוחש',
  ];
  const all = new Set(LANGS.flatMap(l => DIFFICULTIES.flatMap(d => cards[l][d])).map(w => w.toLowerCase()));
  for (const w of removed) assert.ok(!all.has(w.toLowerCase()), `"${w}" came back`);
});

test('shuffled deck honours excludes and falls back safely', () => {
  const deck = getShuffledDeck('medium', 'he', ['תמנון']);
  assert.equal(deck.length, cards.he.medium.length - 1);
  assert.ok(!deck.includes('תמנון'));
  assert.equal(getShuffledDeck('nope', 'xx').length, cards.en.easy.length);
});
