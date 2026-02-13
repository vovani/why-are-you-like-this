'use strict';

const { getShuffledDeck } = require('./cards');
const fs = require('fs');
const path = require('path');

// ============================================================
// Constants
// ============================================================
const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const RECONNECT_GRACE_MS = 10 * 60 * 1000; // 10 min grace period
const SAVE_DEBOUNCE_MS = 3000;

const STATES = Object.freeze({
  LOBBY: 'lobby',
  ROUND_SETUP: 'roundSetup',
  ROUND_ACTIVE: 'roundActive',
  GAME_OVER: 'gameOver',
});

// Valid state transitions – anything not listed is rejected
const TRANSITIONS = {
  [STATES.LOBBY]:        [STATES.ROUND_SETUP],
  [STATES.ROUND_SETUP]:  [STATES.ROUND_ACTIVE, STATES.GAME_OVER, STATES.LOBBY],
  [STATES.ROUND_ACTIVE]: [STATES.ROUND_SETUP, STATES.GAME_OVER],
  [STATES.GAME_OVER]:    [STATES.LOBBY],
};

// ============================================================
// Storage
// ============================================================
const rooms = new Map();
const playerToRoom = new Map(); // playerId → roomCode

let _saveTimer = null;
let _dirty = false;

/** Mark state as needing a save (debounced to ≤1 write per 3 s) */
function scheduleSave() {
  _dirty = true;
  if (!_saveTimer) {
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      if (_dirty) { _dirty = false; _persist(); }
    }, SAVE_DEBOUNCE_MS);
  }
}

/** Force an immediate write (used on shutdown) */
function forceSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _dirty = false;
  _persist();
}

function _persist() {
  try {
    const arr = [];
    for (const [, room] of rooms) arr.push(_serialize(room));
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error('[save] Failed:', err.message);
  }
}

function _serialize(room) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({ id, name: p.name, team: p.team });
  }
  return {
    code: room.code,
    hostId: room.hostId,
    players,
    teams: room.teams,
    scores: room.scores,
    gameState: room.gameState,
    difficulty: room.difficulty,
    language: room.language,
    deck: room.deck,
    deckIndex: room.deckIndex,
    currentActorId: room.currentActorId,
    roundDuration: room.roundDuration,
    roundEndsAt: room.roundEndsAt,
    timerPaused: room.timerPaused,
    pauseRemainingMs: room.pauseRemainingMs,
    roundHistory: room.roundHistory,
    currentRoundWords: room.currentRoundWords,
    maxSkipsPerRound: room.maxSkipsPerRound,
    skipsUsedThisRound: room.skipsUsedThisRound,
  };
}

function _load() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const arr = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    for (const rd of arr) {
      const room = {
        ...rd,
        players: new Map(
          rd.players.map(p => [p.id, {
            ...p,
            connected: false,
            socketId: null,
            disconnectTimer: null,
          }])
        ),
        roundEndTimeout: null, // runtime-only
      };

      // Fixup rounds that were active when the server died
      if (room.gameState === STATES.ROUND_ACTIVE) {
        if (!room.timerPaused) {
          const remaining = room.roundEndsAt ? room.roundEndsAt - Date.now() : 0;
          if (remaining <= 0) {
            // Round expired while offline → finalize it
            _finalizeRound(room);
          } else {
            // Pause until someone reconnects
            room.timerPaused = true;
            room.pauseRemainingMs = remaining;
            room.roundEndsAt = null;
          }
        }
      }

      rooms.set(room.code, room);
      for (const [pid] of room.players) playerToRoom.set(pid, room.code);
    }
    if (rooms.size > 0) console.log(`[init] Loaded ${rooms.size} room(s)`);
  } catch (err) {
    console.error('[init] Load failed:', err.message);
  }
}

_load();

// ============================================================
// Global round-end callback
// ============================================================
let _roundEndHandler = null;

/**
 * Register a handler that fires whenever a round ends via timer.
 * Called once at server startup.
 */
function setRoundEndHandler(handler) {
  _roundEndHandler = handler;
}

// ============================================================
// State machine
// ============================================================
function _canTransition(room, to) {
  const allowed = TRANSITIONS[room.gameState];
  return allowed && allowed.includes(to);
}

function _transition(room, to) {
  if (!_canTransition(room, to)) {
    console.warn(`[state] Invalid: ${room.gameState} → ${to} in ${room.code}`);
    return false;
  }
  room.gameState = to;
  return true;
}

// ============================================================
// Timestamp-based timer (no setInterval drift)
// ============================================================
function _clearTimer(room) {
  if (room.roundEndTimeout) {
    clearTimeout(room.roundEndTimeout);
    room.roundEndTimeout = null;
  }
}

function _scheduleEnd(room, ms) {
  _clearTimer(room);
  room.roundEndTimeout = setTimeout(() => {
    room.roundEndTimeout = null;
    if (room.gameState === STATES.ROUND_ACTIVE) {
      _finalizeRound(room);
      if (_roundEndHandler) _roundEndHandler(room);
    }
  }, Math.max(0, ms));
}

function _startTimer(room, durationSec) {
  room.roundDuration = durationSec;
  room.roundEndsAt = Date.now() + durationSec * 1000;
  room.timerPaused = false;
  room.pauseRemainingMs = null;
  _scheduleEnd(room, durationSec * 1000);
}

function pauseTimer(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE || room.timerPaused) return false;
  if (!room.roundEndsAt) return false;
  const remaining = room.roundEndsAt - Date.now();
  if (remaining <= 0) return false;
  room.pauseRemainingMs = remaining;
  room.timerPaused = true;
  room.roundEndsAt = null;
  _clearTimer(room);
  scheduleSave();
  return true;
}

function resumeTimer(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE || !room.timerPaused) return false;
  if (!room.pauseRemainingMs || room.pauseRemainingMs <= 0) return false;
  room.roundEndsAt = Date.now() + room.pauseRemainingMs;
  room.timerPaused = false;
  _scheduleEnd(room, room.pauseRemainingMs);
  room.pauseRemainingMs = null;
  scheduleSave();
  return true;
}

function getTimeRemaining(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE) return 0;
  if (room.timerPaused) return Math.max(0, Math.ceil((room.pauseRemainingMs || 0) / 1000));
  if (!room.roundEndsAt) return 0;
  return Math.max(0, Math.ceil((room.roundEndsAt - Date.now()) / 1000));
}

// ============================================================
// Room code generation
// ============================================================
function _generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

// ============================================================
// Room CRUD
// ============================================================
function createRoom(hostId, hostName) {
  const code = _generateCode();
  const room = {
    code,
    hostId,
    players: new Map(),
    teams: { A: [], B: [] },
    scores: { A: 0, B: 0 },
    gameState: STATES.LOBBY,
    difficulty: 'medium',
    language: 'en',
    deck: [],
    deckIndex: 0,
    currentActorId: null,
    roundDuration: 60,
    roundEndsAt: null,
    timerPaused: false,
    pauseRemainingMs: null,
    roundEndTimeout: null,
    roundHistory: [],
    currentRoundWords: [],
    maxSkipsPerRound: 2,
    skipsUsedThisRound: 0,
  };
  addPlayer(room, hostId, hostName, null);
  rooms.set(code, room);
  scheduleSave();
  return room;
}

function getRoom(code) {
  return code ? rooms.get(code.toUpperCase()) || null : null;
}

function getAllRooms() {
  return rooms;
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  _clearTimer(room);
  for (const [pid, p] of room.players) {
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    playerToRoom.delete(pid);
  }
  rooms.delete(code);
  scheduleSave();
}

// ============================================================
// Player management
// ============================================================
function addPlayer(room, id, name, socketId) {
  const team = room.teams.A.length <= room.teams.B.length ? 'A' : 'B';
  const player = {
    id, name, team, socketId,
    connected: !!socketId,
    disconnectTimer: null,
  };
  room.players.set(id, player);
  room.teams[team].push(id);
  playerToRoom.set(id, room.code);
  scheduleSave();
  return player;
}

function removePlayer(room, pid) {
  const player = room.players.get(pid);
  if (!player) return null;
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

  // Remove from team
  const arr = room.teams[player.team];
  const idx = arr.indexOf(pid);
  if (idx !== -1) arr.splice(idx, 1);

  room.players.delete(pid);
  playerToRoom.delete(pid);

  // Empty room → destroy
  if (room.players.size === 0) {
    deleteRoom(room.code);
    return null;
  }

  // Transfer host if needed
  if (room.hostId === pid) {
    let newHost = null;
    for (const [id, p] of room.players) {
      if (p.connected) { newHost = id; break; }
    }
    room.hostId = newHost || room.players.keys().next().value;
  }

  // If the actor left mid-round, end the round
  if (room.gameState === STATES.ROUND_ACTIVE && room.currentActorId === pid) {
    _finalizeRound(room);
    if (_roundEndHandler) _roundEndHandler(room);
  }

  scheduleSave();
  return room;
}

function movePlayerToTeam(room, pid, newTeam) {
  if (newTeam !== 'A' && newTeam !== 'B') return null;
  const player = room.players.get(pid);
  if (!player || player.team === newTeam) return null;
  const arr = room.teams[player.team];
  const idx = arr.indexOf(pid);
  if (idx !== -1) arr.splice(idx, 1);
  room.teams[newTeam].push(pid);
  player.team = newTeam;
  scheduleSave();
  return player;
}

function transferHost(room, newHostId) {
  const p = room.players.get(newHostId);
  if (!p) return null;
  room.hostId = newHostId;
  scheduleSave();
  return p;
}

// ============================================================
// Connection lifecycle
// ============================================================
function playerConnect(room, pid, socketId) {
  const player = room.players.get(pid);
  if (!player) return null;
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  player.connected = true;
  player.socketId = socketId;
  scheduleSave();
  return player;
}

function playerDisconnect(room, pid) {
  const player = room.players.get(pid);
  if (!player) return null;
  player.connected = false;
  player.socketId = null;
  // Grace period — remove after 10 min if they don't come back
  player.disconnectTimer = setTimeout(() => {
    player.disconnectTimer = null;
    removePlayer(room, pid);
  }, RECONNECT_GRACE_MS);
  scheduleSave();
  return player;
}

// ============================================================
// Game flow
// ============================================================
function startGame(room, difficulty, language, bannedWords = []) {
  if (!_transition(room, STATES.ROUND_SETUP)) return null;
  room.difficulty = difficulty;
  room.language = language || 'en';
  room.deck = getShuffledDeck(difficulty, room.language, bannedWords);
  room.deckIndex = 0;
  room.scores = { A: 0, B: 0 };
  room.roundHistory = [];
  room.currentRoundWords = [];
  scheduleSave();
  return room;
}

function startRound(room, actorId, duration) {
  if (!room.players.has(actorId)) return null;
  if (!_transition(room, STATES.ROUND_ACTIVE)) return null;
  room.currentActorId = actorId;
  room.currentRoundWords = [];
  room.skipsUsedThisRound = 0;
  _startTimer(room, duration);
  scheduleSave();
  return room;
}

function getCurrentWord(room) {
  if (room.deckIndex >= room.deck.length) return null;
  return room.deck[room.deckIndex];
}

function markCorrect(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE) return null;
  const word = getCurrentWord(room);
  if (!word) return null;
  const actor = room.players.get(room.currentActorId);
  if (actor) room.scores[actor.team]++;
  room.currentRoundWords.push({ word, result: 'correct' });
  room.deckIndex++;
  scheduleSave();
  return {
    word,
    result: 'correct',
    scores: { ...room.scores },
    nextWord: getCurrentWord(room),
  };
}

function undoCorrect(room, wordIndex) {
  if (wordIndex < 0 || wordIndex >= room.currentRoundWords.length) return null;
  const entry = room.currentRoundWords[wordIndex];
  if (entry.result !== 'correct') return null;
  const actor = room.players.get(room.currentActorId);
  if (actor) room.scores[actor.team] = Math.max(0, room.scores[actor.team] - 1);
  entry.result = 'cancelled';
  scheduleSave();
  return {
    word: entry.word,
    wordIndex,
    scores: { ...room.scores },
    currentRoundWords: [...room.currentRoundWords],
  };
}

function undoHistoryWord(room, roundIndex, wordIndex) {
  const round = room.roundHistory?.[roundIndex];
  if (!round) return null;
  const entry = round.words?.[wordIndex];
  if (!entry || entry.result !== 'correct') return null;
  room.scores[round.actorTeam] = Math.max(0, room.scores[round.actorTeam] - 1);
  entry.result = 'cancelled';
  round.correct = round.words.filter(w => w.result === 'correct').length;
  scheduleSave();
  return { word: entry.word, roundIndex, wordIndex, scores: { ...room.scores } };
}

function markSkip(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE) return null;
  const word = getCurrentWord(room);
  if (!word) return null;
  if (room.skipsUsedThisRound >= room.maxSkipsPerRound) {
    return { error: 'noSkipsLeft', skipsUsed: room.skipsUsedThisRound, maxSkips: room.maxSkipsPerRound };
  }
  room.skipsUsedThisRound++;
  room.currentRoundWords.push({ word, result: 'skip' });
  room.deckIndex++;
  scheduleSave();
  return {
    word,
    result: 'skip',
    scores: { ...room.scores },
    nextWord: getCurrentWord(room),
    skipsRemaining: room.maxSkipsPerRound - room.skipsUsedThisRound,
  };
}

function removeCurrentWord(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE) return null;
  const word = getCurrentWord(room);
  if (!word) return null;
  room.deck.splice(room.deckIndex, 1); // deckIndex now points to next word
  scheduleSave();
  return { word, nextWord: getCurrentWord(room) };
}

/** Internal: push round to history and reset round state */
function _finalizeRound(room) {
  _clearTimer(room);
  const actor = room.players.get(room.currentActorId);
  if (room.currentRoundWords.length > 0 || room.currentActorId) {
    room.roundHistory.push({
      actor: actor?.name || 'Unknown',
      actorTeam: actor?.team || 'A',
      words: [...room.currentRoundWords],
      correct: room.currentRoundWords.filter(w => w.result === 'correct').length,
    });
  }
  room.currentActorId = null;
  room.currentRoundWords = [];
  room.roundEndsAt = null;
  room.timerPaused = false;
  room.pauseRemainingMs = null;
  room.gameState = STATES.ROUND_SETUP;
  scheduleSave();
}

function endRound(room) {
  if (room.gameState !== STATES.ROUND_ACTIVE) return null;
  _finalizeRound(room);
  return room;
}

function endGame(room) {
  // Save active round to history if mid-round
  if (room.gameState === STATES.ROUND_ACTIVE) {
    const actor = room.players.get(room.currentActorId);
    _clearTimer(room);
    if (room.currentRoundWords.length > 0) {
      room.roundHistory.push({
        actor: actor?.name || 'Unknown',
        actorTeam: actor?.team || 'A',
        words: [...room.currentRoundWords],
        correct: room.currentRoundWords.filter(w => w.result === 'correct').length,
      });
    }
  }
  _clearTimer(room);
  room.gameState = STATES.GAME_OVER;
  room.currentActorId = null;
  room.currentRoundWords = [];
  room.roundEndsAt = null;
  room.timerPaused = false;
  room.pauseRemainingMs = null;
  scheduleSave();
  return room;
}

function resetGame(room) {
  _clearTimer(room);
  room.gameState = STATES.LOBBY;
  room.deck = [];
  room.deckIndex = 0;
  room.currentActorId = null;
  room.roundHistory = [];
  room.scores = { A: 0, B: 0 };
  room.currentRoundWords = [];
  room.roundEndsAt = null;
  room.timerPaused = false;
  room.pauseRemainingMs = null;
  scheduleSave();
  return room;
}

function setMaxSkips(room, maxSkips) {
  room.maxSkipsPerRound = maxSkips;
  scheduleSave();
}

// ============================================================
// Client-facing state snapshot
// ============================================================
function getClientState(room, forPlayerId = null) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({
      id,
      name: p.name,
      team: p.team,
      connected: p.connected,
      isHost: id === room.hostId,
    });
  }

  const state = {
    code: room.code,
    hostId: room.hostId,
    players,
    teams: {
      A: room.teams.A.map(id => room.players.get(id)?.name || '?'),
      B: room.teams.B.map(id => room.players.get(id)?.name || '?'),
    },
    scores: { ...room.scores },
    gameState: room.gameState,
    difficulty: room.difficulty,
    language: room.language,
    currentActorId: room.currentActorId,
    currentActorName: room.currentActorId
      ? room.players.get(room.currentActorId)?.name
      : null,
    // Timestamp-based timer info for client-side computation
    timeRemaining: getTimeRemaining(room),
    roundEndsAt: room.timerPaused ? null : room.roundEndsAt,
    timerPaused: room.timerPaused,
    pauseRemainingMs: room.pauseRemainingMs,
    serverTime: Date.now(),
    roundHistory: room.roundHistory,
    cardsRemaining: room.deck.length - room.deckIndex,
    maxSkipsPerRound: room.maxSkipsPerRound,
    skipsRemaining: room.maxSkipsPerRound - (room.skipsUsedThisRound || 0),
    currentRoundWords: room.currentRoundWords,
  };

  // Only the actor sees the current word
  if (forPlayerId === room.currentActorId) {
    state.currentWord = getCurrentWord(room);
  }

  return state;
}

// ============================================================
// Restart timers after server restart
// ============================================================
function restartTimers() {
  for (const [code, room] of rooms) {
    if (room.gameState !== STATES.ROUND_ACTIVE) continue;
    if (room.timerPaused) {
      console.log(`[timer] ${code}: paused (${Math.ceil((room.pauseRemainingMs || 0) / 1000)}s left)`);
      continue;
    }
    if (room.roundEndsAt) {
      const ms = room.roundEndsAt - Date.now();
      if (ms > 0) {
        _scheduleEnd(room, ms);
        console.log(`[timer] ${code}: resumed (${Math.ceil(ms / 1000)}s left)`);
      } else {
        _finalizeRound(room);
        if (_roundEndHandler) _roundEndHandler(room);
        console.log(`[timer] ${code}: expired offline, ended round`);
      }
    }
  }
}

// ============================================================
// Exports
// ============================================================
module.exports = {
  STATES,
  setRoundEndHandler,
  createRoom, getRoom, getAllRooms, deleteRoom,
  addPlayer, removePlayer, movePlayerToTeam, transferHost,
  playerConnect, playerDisconnect,
  startGame, startRound, getCurrentWord,
  markCorrect, undoCorrect, undoHistoryWord, markSkip, removeCurrentWord,
  endRound, endGame, resetGame,
  setMaxSkips, pauseTimer, resumeTimer, getTimeRemaining,
  getClientState, restartTimers, forceSave, scheduleSave,
};
