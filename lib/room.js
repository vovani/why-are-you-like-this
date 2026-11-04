// Pure game rules for one room. No sockets, no timers, no disk: every method
// takes `now` explicitly so the whole thing is deterministic and testable.
// The Durable Object (worker/game-room.js) owns sockets/alarms and calls in.

import { getShuffledDeck, DIFFICULTIES, LANGUAGES } from './cards.js';

export const STATES = Object.freeze({
  LOBBY: 'lobby',
  ROUND_SETUP: 'roundSetup',
  ROUND_ACTIVE: 'roundActive',
  GAME_OVER: 'gameOver',
});

export const TEAMS = ['A', 'B'];
export const LIMITS = Object.freeze({
  NAME_MAX: 20,
  ROUND_MIN_S: 10,
  ROUND_MAX_S: 600,
  SKIPS_UNLIMITED: 999,
  MAX_PLAYERS: 40,
});

/** How long things may stay offline before the room acts on it. */
export const TIMING = Object.freeze({
  hostGraceMs: 20 * 1000,              // host offline → hand host to someone online
  playerGraceMs: 2 * 60 * 60 * 1000,   // offline player → dropped from the room
  roomIdleMs: 12 * 60 * 60 * 1000,     // nobody online → room deleted
});

/** Error whose message is safe to show to the player. */
export class GameError extends Error {}

export function cleanName(name) {
  if (typeof name !== 'string') throw new GameError('Name is required');
  // Strip control chars, collapse whitespace.
  const n = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!n) throw new GameError('Name is required');
  return [...n].slice(0, LIMITS.NAME_MAX).join('');
}

function toInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export class Room {
  constructor(code, now = Date.now()) {
    this.code = code;
    this.hostId = null;
    /** @type {Map<string, {id,name,team,connected,joinedAt,disconnectedAt,acted}>} */
    this.players = new Map();
    this.state = STATES.LOBBY;
    this.settings = { difficulty: 'easy', language: 'en', maxSkips: 2, roundSeconds: 60 };
    this.scores = { A: 0, B: 0 };
    this.deck = [];
    this.deckIndex = 0;
    this.playedWords = [];   // every word drawn this game (for reshuffles)
    this.cardSeq = 0;        // bumps whenever the actor's card changes
    this.round = null;       // active round, see startRound()
    this.history = [];
    this.lastActorTeam = null;
    this.createdAt = now;
    this.updatedAt = now;
  }

  // ------------------------------------------------------------------
  // Players
  // ------------------------------------------------------------------
  _teamSize(team) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  _uniqueName(name, exceptId) {
    const taken = new Set();
    for (const p of this.players.values()) if (p.id !== exceptId) taken.add(p.name.toLowerCase());
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${[...name].slice(0, LIMITS.NAME_MAX - 3).join('')} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  addPlayer(id, rawName, now = Date.now()) {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= LIMITS.MAX_PLAYERS) throw new GameError('Room is full');
    const name = this._uniqueName(cleanName(rawName), id);
    const team = this._teamSize('A') <= this._teamSize('B') ? 'A' : 'B';
    const player = { id, name, team, connected: true, joinedAt: now, disconnectedAt: null, acted: 0 };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    this.touch(now);
    return player;
  }

  renamePlayer(id, rawName, now = Date.now()) {
    const p = this.players.get(id);
    if (!p) return;
    p.name = this._uniqueName(cleanName(rawName), id);
    this.touch(now);
  }

  removePlayer(id, now = Date.now()) {
    const p = this.players.get(id);
    if (!p) return false;
    if (this.state === STATES.ROUND_ACTIVE && this.round?.actorId === id) this.endRound(now);
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this._pickNewHost();
    this.touch(now);
    return true;
  }

  _pickNewHost() {
    let fallback = null;
    for (const p of this.players.values()) {
      if (p.connected) return p.id;
      fallback = fallback || p.id;
    }
    return fallback;
  }

  setConnected(id, connected, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || p.connected === connected) return false;
    p.connected = connected;
    p.disconnectedAt = connected ? null : now;
    // Actor dropped mid-round: freeze the clock so their team isn't robbed.
    if (this.state === STATES.ROUND_ACTIVE && this.round?.actorId === id) {
      if (!connected && !this.round.pausedRemainingMs) {
        if (this.pause(now)) this.round.autoPaused = true;
      } else if (connected && this.round.autoPaused) {
        this.round.autoPaused = false;
        this.resume(now);
      }
    }
    this.touch(now);
    return true;
  }

  movePlayer(id, team, now = Date.now()) {
    if (!TEAMS.includes(team)) throw new GameError('Unknown team');
    const p = this.players.get(id);
    if (!p) throw new GameError('Player not found');
    if (this.state === STATES.ROUND_ACTIVE && this.round?.actorId === id) {
      throw new GameError("Can't move the actor mid-round");
    }
    p.team = team;
    this.touch(now);
  }

  transferHost(id, now = Date.now()) {
    if (!this.players.has(id)) throw new GameError('Player not found');
    this.hostId = id;
    this.touch(now);
  }

  /** Called by the manager when the host has been offline too long. */
  autoTransferHost(now = Date.now()) {
    const host = this.players.get(this.hostId);
    if (host?.connected) return null;
    for (const p of this.players.values()) {
      if (p.connected) { this.hostId = p.id; this.touch(now); return p; }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------
  updateSettings(patch = {}, now = Date.now()) {
    const s = this.settings;
    const inLobby = this.state === STATES.LOBBY || this.state === STATES.GAME_OVER;
    if (patch.difficulty !== undefined && inLobby) {
      if (!DIFFICULTIES.includes(patch.difficulty)) throw new GameError('Unknown difficulty');
      s.difficulty = patch.difficulty;
    }
    if (patch.language !== undefined && inLobby) {
      if (!LANGUAGES.includes(patch.language)) throw new GameError('Unknown language');
      s.language = patch.language;
    }
    if (patch.maxSkips !== undefined) {
      s.maxSkips = toInt(patch.maxSkips, 0, LIMITS.SKIPS_UNLIMITED, s.maxSkips);
    }
    if (patch.roundSeconds !== undefined) {
      s.roundSeconds = toInt(patch.roundSeconds, LIMITS.ROUND_MIN_S, LIMITS.ROUND_MAX_S, s.roundSeconds);
    }
    this.touch(now);
  }

  // ------------------------------------------------------------------
  // Deck
  // ------------------------------------------------------------------
  _ensureCard(banned) {
    if (this.deckIndex < this.deck.length) return;
    // Out of cards: reshuffle everything not yet played this game; if the
    // whole list is exhausted, start over with the full list.
    const { difficulty, language } = this.settings;
    let fresh = getShuffledDeck(difficulty, language, [...banned, ...this.playedWords]);
    if (!fresh.length) {
      this.playedWords = [];
      fresh = getShuffledDeck(difficulty, language, banned);
    }
    this.deck = fresh;
    this.deckIndex = 0;
  }

  currentWord() {
    return this.deckIndex < this.deck.length ? this.deck[this.deckIndex] : null;
  }

  _advance(banned) {
    const w = this.currentWord();
    if (w) this.playedWords.push(w);
    this.deckIndex++;
    this._ensureCard(banned);
    this.cardSeq++;
  }

  // ------------------------------------------------------------------
  // Game flow
  // ------------------------------------------------------------------
  startGame(banned = [], now = Date.now()) {
    if (this.state !== STATES.LOBBY && this.state !== STATES.GAME_OVER) {
      throw new GameError('Game already started');
    }
    if (this.players.size < 2) throw new GameError('Need at least 2 players');
    this.scores = { A: 0, B: 0 };
    this.history = [];
    this.playedWords = [];
    this.lastActorTeam = null;
    for (const p of this.players.values()) p.acted = 0;
    this.deck = getShuffledDeck(this.settings.difficulty, this.settings.language, banned);
    this.deckIndex = 0;
    this._ensureCard(banned);
    this.cardSeq++;
    this.round = null;
    this.state = STATES.ROUND_SETUP;
    this.touch(now);
  }

  /** Next actor: alternate teams, then whoever on that team acted least. */
  suggestedActorId() {
    const online = [...this.players.values()].filter(p => p.connected);
    if (!online.length) return null;
    const wantTeam = this.lastActorTeam === 'A' ? 'B' : this.lastActorTeam === 'B' ? 'A' : null;
    const pool = online.filter(p => !wantTeam || p.team === wantTeam);
    const candidates = pool.length ? pool : online;
    candidates.sort((a, b) => a.acted - b.acted || a.joinedAt - b.joinedAt);
    return candidates[0].id;
  }

  startRound(actorId, seconds, now = Date.now()) {
    if (this.state !== STATES.ROUND_SETUP) throw new GameError('Not ready to start a round');
    const actor = this.players.get(actorId);
    if (!actor) throw new GameError('Pick an actor');
    if (!actor.connected) throw new GameError(`${actor.name} is offline`);
    const secs = toInt(seconds, LIMITS.ROUND_MIN_S, LIMITS.ROUND_MAX_S, this.settings.roundSeconds);
    this.settings.roundSeconds = secs;
    this.round = {
      actorId,
      actorTeam: actor.team,
      durationMs: secs * 1000,
      endsAt: now + secs * 1000,
      pausedRemainingMs: null,
      autoPaused: false,
      skipsUsed: 0,
      words: [],
    };
    actor.acted++;
    this.state = STATES.ROUND_ACTIVE;
    this.cardSeq++;
    this.touch(now);
  }

  _requireActive() {
    if (this.state !== STATES.ROUND_ACTIVE || !this.round) throw new GameError('No round in progress');
  }

  _requireCard(seq) {
    // The client tells us which card it is acting on. If it doesn't match,
    // the tap was for a card that already changed (double-tap / lag) → ignore.
    if (seq !== undefined && seq !== this.cardSeq) return false;
    if (this.isPaused()) throw new GameError('Timer is paused');
    return true;
  }

  markCorrect(seq, banned = [], now = Date.now()) {
    this._requireActive();
    if (!this._requireCard(seq)) return null;
    const word = this.currentWord();
    if (!word) return null;
    const team = this.round.actorTeam;
    this.scores[team]++;
    this.round.words.push({ word, result: 'correct', team });
    this._advance(banned);
    this.touch(now);
    return { word, result: 'correct' };
  }

  markSkip(seq, banned = [], now = Date.now()) {
    this._requireActive();
    if (!this._requireCard(seq)) return null;
    const word = this.currentWord();
    if (!word) return null;
    const max = this.settings.maxSkips;
    if (max < LIMITS.SKIPS_UNLIMITED && this.round.skipsUsed >= max) {
      throw new GameError(max === 0 ? 'Skipping is off' : `No skips left (max ${max})`);
    }
    this.round.skipsUsed++;
    this.round.words.push({ word, result: 'skip', team: this.round.actorTeam });
    this._advance(banned);
    this.touch(now);
    return { word, result: 'skip' };
  }

  /** Drop the current card from this deck (caller persists the ban). Free: no skip used. */
  removeWord(seq, banned = [], now = Date.now()) {
    this._requireActive();
    if (seq !== undefined && seq !== this.cardSeq) return null;
    const word = this.currentWord();
    if (!word) return null;
    this.deck.splice(this.deckIndex, 1);
    this._ensureCard([...banned, word]);
    this.cardSeq++;
    this.touch(now);
    return { word };
  }

  isPaused() {
    return !!(this.round && this.round.pausedRemainingMs);
  }

  pause(now = Date.now()) {
    this._requireActive();
    if (this.isPaused()) return false;
    const remaining = this.round.endsAt - now;
    if (remaining <= 0) return false;
    this.round.pausedRemainingMs = remaining;
    this.round.endsAt = null;
    this.touch(now);
    return true;
  }

  resume(now = Date.now()) {
    this._requireActive();
    if (!this.isPaused()) return false;
    this.round.endsAt = now + this.round.pausedRemainingMs;
    this.round.pausedRemainingMs = null;
    this.round.autoPaused = false;
    this.touch(now);
    return true;
  }

  timeRemainingMs(now = Date.now()) {
    if (this.state !== STATES.ROUND_ACTIVE || !this.round) return 0;
    if (this.isPaused()) return this.round.pausedRemainingMs;
    return Math.max(0, this.round.endsAt - now);
  }

  endRound(now = Date.now()) {
    if (this.state !== STATES.ROUND_ACTIVE || !this.round) return false;
    const r = this.round;
    const actor = this.players.get(r.actorId);
    this.history.push({
      actor: actor?.name || 'Someone',
      actorTeam: r.actorTeam,
      words: r.words,
      correct: r.words.filter(w => w.result === 'correct').length,
    });
    this.lastActorTeam = r.actorTeam;
    this.round = null;
    this.state = STATES.ROUND_SETUP;
    this.cardSeq++;
    this.touch(now);
    return true;
  }

  /**
   * Host fixes a word after the fact. roundIndex -1 = the live round.
   *   correct=true:  skipped / not-counted word → correct (+1)
   *   correct=false: correct word → not counted (−1)
   * Turning a skip from the live round into a correct gives the skip back.
   */
  markWord(roundIndex, wordIndex, correct, now = Date.now()) {
    const ri = Number(roundIndex);
    const wi = Number(wordIndex);
    const live = ri === -1;
    const words = live ? (this.state === STATES.ROUND_ACTIVE ? this.round?.words : null) : this.history[ri]?.words;
    const entry = Number.isInteger(wi) ? words?.[wi] : null;
    if (!entry) throw new GameError('Word not found');
    if (correct) {
      if (entry.result === 'correct') throw new GameError('Already counted');
      if (live && entry.result === 'skip') this.round.skipsUsed = Math.max(0, this.round.skipsUsed - 1);
      entry.result = 'correct';
    } else {
      if (entry.result !== 'correct') throw new GameError('Not counted anyway');
      entry.result = 'cancelled';
    }
    if (!live) this.history[ri].correct = words.filter(w => w.result === 'correct').length;
    this._recomputeScores();
    this.touch(now);
    return entry.word;
  }

  /** Back-compat: old clients send 'undo'. */
  undoWord(roundIndex, wordIndex, now = Date.now()) {
    return this.markWord(roundIndex, wordIndex, false, now);
  }

  /** Scores are always exactly the correct words per team: no drift possible. */
  _recomputeScores() {
    const scores = { A: 0, B: 0 };
    const all = [...this.history.flatMap(r => r.words), ...(this.round?.words || [])];
    for (const w of all) if (w.result === 'correct' && scores[w.team] !== undefined) scores[w.team]++;
    this.scores = scores;
  }

  endGame(now = Date.now()) {
    if (this.state === STATES.LOBBY) throw new GameError('Game has not started');
    if (this.state === STATES.ROUND_ACTIVE) this.endRound(now);
    this.state = STATES.GAME_OVER;
    this.touch(now);
  }

  resetToLobby(now = Date.now()) {
    this.state = STATES.LOBBY;
    this.round = null;
    this.deck = [];
    this.deckIndex = 0;
    this.playedWords = [];
    this.history = [];
    this.scores = { A: 0, B: 0 };
    this.lastActorTeam = null;
    this.touch(now);
  }

  touch(now = Date.now()) {
    this.updatedAt = now;
  }

  // ------------------------------------------------------------------
  // Time-based housekeeping (driven by Durable Object alarms)
  // ------------------------------------------------------------------
  /** Apply everything that is due at `now`. */
  tick(now = Date.now(), timing = TIMING) {
    const notices = [];
    let changed = false;
    if (this.state === STATES.ROUND_ACTIVE && this.round && !this.isPaused() && this.timeRemainingMs(now) <= 0) {
      this.endRound(now);
      notices.push({ text: "Time's up!", kind: 'info' });
      changed = true;
    }
    const host = this.players.get(this.hostId);
    if (!host || (!host.connected && now - host.disconnectedAt >= timing.hostGraceMs)) {
      const newHost = this.autoTransferHost(now);
      if (newHost) {
        changed = true;
        notices.push({ text: `${newHost.name} is now the host`, kind: 'info' });
      }
    }
    for (const p of [...this.players.values()]) {
      if (!p.connected && now - p.disconnectedAt >= timing.playerGraceMs) {
        this.removePlayer(p.id, now);
        changed = true;
      }
    }
    const anyoneOnline = [...this.players.values()].some(p => p.connected);
    const expired = !this.players.size || (!anyoneOnline && now - this.updatedAt >= timing.roomIdleMs);
    return { changed, notices, expired };
  }

  /** The next moment tick() would do something, or null. */
  nextDeadline(now = Date.now(), timing = TIMING) {
    const times = [];
    if (this.state === STATES.ROUND_ACTIVE && this.round && !this.isPaused()) times.push(this.round.endsAt);
    const players = [...this.players.values()];
    const anyoneOnline = players.some(p => p.connected);
    const host = this.players.get(this.hostId);
    if (host && !host.connected && anyoneOnline) times.push(host.disconnectedAt + timing.hostGraceMs);
    for (const p of players) if (!p.connected) times.push(p.disconnectedAt + timing.playerGraceMs);
    if (!anyoneOnline) times.push(this.updatedAt + timing.roomIdleMs);
    return times.length ? Math.max(now, Math.min(...times)) : null;
  }

  summary() {
    const players = [...this.players.values()];
    return {
      code: this.code,
      gameState: this.state,
      settings: this.settings,
      scores: this.scores,
      cardsRemaining: Math.max(0, this.deck.length - this.deckIndex),
      rounds: this.history.length,
      updatedAt: this.updatedAt,
      players: players.map(p => ({ name: p.name, team: p.team, connected: p.connected, isHost: p.id === this.hostId })),
    };
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  /** Snapshot for one player. Only the actor ever sees the current word. */
  toClient(forId, now = Date.now()) {
    const r = this.round;
    const isActor = !!r && r.actorId === forId && this.state === STATES.ROUND_ACTIVE;
    const players = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(p => ({ id: p.id, name: p.name, team: p.team, connected: p.connected, isHost: p.id === this.hostId }));
    const max = this.settings.maxSkips;
    return {
      code: this.code,
      you: forId,
      hostId: this.hostId,
      players,
      gameState: this.state,
      settings: { ...this.settings },
      scores: { ...this.scores },
      history: this.history,
      suggestedActorId: this.state === STATES.ROUND_SETUP ? this.suggestedActorId() : null,
      cardsRemaining: Math.max(0, this.deck.length - this.deckIndex),
      serverTime: now,
      round: r && this.state === STATES.ROUND_ACTIVE ? {
        actorId: r.actorId,
        actorName: this.players.get(r.actorId)?.name || 'Someone',
        actorTeam: r.actorTeam,
        endsAt: r.endsAt,
        durationMs: r.durationMs,
        remainingMs: this.timeRemainingMs(now),
        paused: this.isPaused(),
        autoPaused: r.autoPaused,
        words: r.words,
        skipsRemaining: max >= LIMITS.SKIPS_UNLIMITED ? null : Math.max(0, max - r.skipsUsed),
        word: isActor ? this.currentWord() : undefined,
        cardSeq: isActor ? this.cardSeq : undefined,
      } : null,
    };
  }

  toJSON() {
    return {
      v: 2,
      code: this.code,
      hostId: this.hostId,
      players: [...this.players.values()].map(({ id, name, team, joinedAt, acted, connected, disconnectedAt }) => ({ id, name, team, joinedAt, acted, connected, disconnectedAt })),
      state: this.state,
      settings: this.settings,
      scores: this.scores,
      deck: this.deck,
      deckIndex: this.deckIndex,
      playedWords: this.playedWords,
      cardSeq: this.cardSeq,
      round: this.round,
      history: this.history,
      lastActorTeam: this.lastActorTeam,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * keepPresence: restore exactly as saved (a Durable Object waking up while
   * its sockets are still open). Otherwise treat it as a cold restart:
   * everyone offline, a running round frozen until the actor returns.
   */
  static fromJSON(d, now = Date.now(), { keepPresence = false } = {}) {
    const room = new Room(d.code, d.createdAt || now);
    Object.assign(room, {
      hostId: d.hostId,
      state: Object.values(STATES).includes(d.state) ? d.state : STATES.LOBBY,
      settings: { ...room.settings, ...d.settings },
      scores: d.scores || { A: 0, B: 0 },
      deck: d.deck || [],
      deckIndex: d.deckIndex || 0,
      playedWords: d.playedWords || [],
      cardSeq: d.cardSeq || 0,
      round: d.round || null,
      history: d.history || [],
      lastActorTeam: d.lastActorTeam || null,
      updatedAt: d.updatedAt || now,
    });
    for (const p of d.players || []) {
      const online = keepPresence && !!p.connected;
      room.players.set(p.id, {
        ...p,
        acted: p.acted || 0,
        connected: online,
        disconnectedAt: online ? null : (keepPresence && p.disconnectedAt) || now,
      });
    }
    if (keepPresence) return room;
    if (room.state === STATES.ROUND_ACTIVE) {
      if (!room.round) room.state = STATES.ROUND_SETUP;
      else if (!room.isPaused()) {
        // Freeze the clock until the actor is back (server was down).
        if (room.round.endsAt - now <= 0) room.endRound(now);
        else { room.pause(now); room.round.autoPaused = true; }
      } else {
        room.round.autoPaused = true;
      }
    }
    return room;
  }
}

