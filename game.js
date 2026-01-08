const { getShuffledDeck, getLanguages } = require('./cards');

// Store all active rooms
const rooms = new Map();

// Store player sessions for reconnection (playerId -> roomCode)
const playerSessions = new Map();

// Grace period for reconnection (60 seconds)
const RECONNECT_GRACE_PERIOD = 600000; // 10 minutes

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 15);
}

function createRoom(hostPlayerId, hostName) {
  let roomCode;
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));

  const room = {
    code: roomCode,
    hostId: hostPlayerId,
    players: new Map(),
    teams: {
      A: [],
      B: []
    },
    scores: {
      A: 0,
      B: 0
    },
    gameState: 'lobby', // lobby, playing, roundSetup, roundActive, gameOver
    difficulty: 'medium',
    language: 'en',
    deck: [],
    currentCardIndex: 0,
    currentActorId: null,
    roundTimer: 60,
    roundTimeRemaining: 0,
    timerInterval: null,
    timerPaused: false,
    roundHistory: [],
    currentRoundWords: [],
    maxSkipsPerRound: 2,
    skipsUsedThisRound: 0
  };

  // Add host as first player
  addPlayerToRoom(room, hostPlayerId, hostName, null);

  rooms.set(roomCode, room);
  return room;
}

function addPlayerToRoom(room, playerId, playerName, socketId) {
  // Determine which team to join (balance teams)
  const team = room.teams.A.length <= room.teams.B.length ? 'A' : 'B';

  const player = {
    id: playerId,
    name: playerName,
    team: team,
    socketId: socketId,
    connected: true,
    disconnectTimeout: null
  };

  room.players.set(playerId, player);
  room.teams[team].push(playerId);
  playerSessions.set(playerId, room.code);

  return player;
}

function getRoom(roomCode) {
  if (!roomCode) return null;
  return rooms.get(roomCode.toUpperCase());
}

function getAllRooms() {
  return rooms;
}

function closeRoom(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return null;
  
  // Clear any timers
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }
  
  // Clear disconnect timeouts for all players
  for (const [id, player] of room.players) {
    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
    }
    playerSessions.delete(id);
  }
  
  rooms.delete(room.code);
  return room;
}

function movePlayerToTeam(room, playerId, newTeam) {
  const player = room.players.get(playerId);
  if (!player) return null;
  
  const oldTeam = player.team;
  if (oldTeam === newTeam) return player; // Already on this team
  
  // Remove from old team
  const oldIndex = room.teams[oldTeam].indexOf(playerId);
  if (oldIndex > -1) {
    room.teams[oldTeam].splice(oldIndex, 1);
  }
  
  // Add to new team
  room.teams[newTeam].push(playerId);
  player.team = newTeam;
  
  return player;
}

function transferHost(room, newHostId) {
  const newHost = room.players.get(newHostId);
  if (!newHost) return null;
  
  room.hostId = newHostId;
  return newHost;
}

function setMaxSkips(room, maxSkips) {
  room.maxSkipsPerRound = maxSkips;
}

function getPlayerRoom(playerId) {
  const roomCode = playerSessions.get(playerId);
  if (roomCode) {
    return rooms.get(roomCode);
  }
  return null;
}

function removePlayerFromRoom(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;

  // Remove from team
  const teamIndex = room.teams[player.team].indexOf(playerId);
  if (teamIndex > -1) {
    room.teams[player.team].splice(teamIndex, 1);
  }

  room.players.delete(playerId);
  playerSessions.delete(playerId);

  // If host leaves, assign new host
  if (room.hostId === playerId && room.players.size > 0) {
    room.hostId = room.players.keys().next().value;
  }

  // If no players left, delete the room
  if (room.players.size === 0) {
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
    }
    rooms.delete(room.code);
    return null;
  }

  return room;
}

function handlePlayerDisconnect(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;

  player.connected = false;
  player.socketId = null;

  // Pause timer if actor disconnects
  if (room.currentActorId === playerId && room.gameState === 'roundActive') {
    pauseTimer(room);
  }

  // Set timeout for removal
  player.disconnectTimeout = setTimeout(() => {
    removePlayerFromRoom(room, playerId);
  }, RECONNECT_GRACE_PERIOD);

  return player;
}

function handlePlayerReconnect(room, playerId, socketId) {
  const player = room.players.get(playerId);
  if (!player) return null;

  // Clear disconnect timeout
  if (player.disconnectTimeout) {
    clearTimeout(player.disconnectTimeout);
    player.disconnectTimeout = null;
  }

  player.connected = true;
  player.socketId = socketId;

  // Resume timer if actor reconnects
  if (room.currentActorId === playerId && room.gameState === 'roundActive' && room.timerPaused) {
    resumeTimer(room);
  }

  return player;
}

function startGame(room, difficulty, language = 'en', bannedWords = []) {
  room.difficulty = difficulty;
  room.language = language;
  room.deck = getShuffledDeck(difficulty, language, bannedWords);
  room.currentCardIndex = 0;
  room.gameState = 'roundSetup';
  room.scores = { A: 0, B: 0 };
  room.roundHistory = [];
  return room;
}

function startRound(room, actorId, timerDuration, onTimerEnd) {
  room.currentActorId = actorId;
  room.roundTimer = timerDuration;
  room.roundTimeRemaining = timerDuration;
  room.gameState = 'roundActive';
  room.currentRoundWords = [];
  room.timerPaused = false;
  room.skipsUsedThisRound = 0;

  // Start the timer
  room.timerInterval = setInterval(() => {
    if (!room.timerPaused) {
      room.roundTimeRemaining--;
      if (room.roundTimeRemaining <= 0) {
        endRound(room);
        if (onTimerEnd) onTimerEnd(room);
      }
    }
  }, 1000);

  return room;
}

function pauseTimer(room) {
  room.timerPaused = true;
}

function resumeTimer(room) {
  room.timerPaused = false;
}

function getCurrentWord(room) {
  if (room.currentCardIndex >= room.deck.length) {
    return null; // No more cards
  }
  return room.deck[room.currentCardIndex];
}

function markCorrect(room) {
  const word = getCurrentWord(room);
  if (!word) return null;

  const actor = room.players.get(room.currentActorId);
  if (actor) {
    room.scores[actor.team]++;
  }

  room.currentRoundWords.push({ word, result: 'correct' });
  room.currentCardIndex++;

  return {
    word,
    result: 'correct',
    scores: { ...room.scores },
    nextWord: getCurrentWord(room)
  };
}

function undoCorrect(room, wordIndex) {
  // Find the word in current round words
  if (wordIndex < 0 || wordIndex >= room.currentRoundWords.length) {
    return null;
  }

  const wordEntry = room.currentRoundWords[wordIndex];
  if (wordEntry.result !== 'correct') {
    return null; // Can only undo correct words
  }

  // Deduct the point from the actor's team
  const actor = room.players.get(room.currentActorId);
  if (actor) {
    room.scores[actor.team] = Math.max(0, room.scores[actor.team] - 1);
  }

  // Mark the word as cancelled
  room.currentRoundWords[wordIndex].result = 'cancelled';

  return {
    word: wordEntry.word,
    wordIndex,
    result: 'cancelled',
    scores: { ...room.scores },
    currentRoundWords: [...room.currentRoundWords]
  };
}

function markSkip(room) {
  const word = getCurrentWord(room);
  if (!word) return null;

  // Check if skips are allowed
  if (room.skipsUsedThisRound >= room.maxSkipsPerRound) {
    return { error: 'noSkipsLeft', skipsUsed: room.skipsUsedThisRound, maxSkips: room.maxSkipsPerRound };
  }

  room.skipsUsedThisRound++;
  room.currentRoundWords.push({ word, result: 'skip' });
  room.currentCardIndex++;

  return {
    word,
    result: 'skip',
    scores: { ...room.scores },
    nextWord: getCurrentWord(room),
    skipsRemaining: room.maxSkipsPerRound - room.skipsUsedThisRound
  };
}

function removeCurrentWord(room) {
  const word = getCurrentWord(room);
  if (!word) return null;

  // Remove from deck (don't add to round words, don't count as anything)
  room.deck.splice(room.currentCardIndex, 1);
  // Don't increment currentCardIndex since we removed the current word

  return {
    word,
    nextWord: getCurrentWord(room)
  };
}

function endRound(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }

  // Save round to history
  const actor = room.players.get(room.currentActorId);
  room.roundHistory.push({
    actor: actor ? actor.name : 'Unknown',
    actorTeam: actor ? actor.team : 'A',
    words: [...room.currentRoundWords],
    correct: room.currentRoundWords.filter(w => w.result === 'correct').length
  });

  room.gameState = 'roundSetup';
  room.currentActorId = null;
  room.currentRoundWords = [];
  room.timerPaused = false;

  return room;
}

function endGame(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.gameState = 'gameOver';
  return room;
}

function resetGame(room) {
  room.gameState = 'lobby';
  room.deck = [];
  room.currentCardIndex = 0;
  room.currentActorId = null;
  room.roundHistory = [];
  room.scores = { A: 0, B: 0 };
  room.currentRoundWords = [];
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  return room;
}

function getRoomState(room, forPlayerId = null) {
  const players = [];
  for (const [id, player] of room.players) {
    players.push({
      id,
      name: player.name,
      team: player.team,
      connected: player.connected,
      isHost: id === room.hostId
    });
  }

  const state = {
    code: room.code,
    hostId: room.hostId,
    players,
    teams: {
      A: room.teams.A.map(id => room.players.get(id)?.name || 'Unknown'),
      B: room.teams.B.map(id => room.players.get(id)?.name || 'Unknown')
    },
    scores: room.scores,
    gameState: room.gameState,
    difficulty: room.difficulty,
    language: room.language,
    currentActorId: room.currentActorId,
    currentActorName: room.currentActorId ? room.players.get(room.currentActorId)?.name : null,
    roundTimeRemaining: room.roundTimeRemaining,
    roundTimer: room.roundTimer,
    timerPaused: room.timerPaused,
    roundHistory: room.roundHistory,
    cardsRemaining: room.deck.length - room.currentCardIndex,
    maxSkipsPerRound: room.maxSkipsPerRound,
    skipsRemaining: room.maxSkipsPerRound - room.skipsUsedThisRound
  };

  // Only include current word if the requester is the actor
  if (forPlayerId === room.currentActorId) {
    state.currentWord = getCurrentWord(room);
  }

  return state;
}

module.exports = {
  generatePlayerId,
  createRoom,
  getRoom,
  getAllRooms,
  closeRoom,
  getPlayerRoom,
  addPlayerToRoom,
  removePlayerFromRoom,
  movePlayerToTeam,
  transferHost,
  setMaxSkips,
  handlePlayerDisconnect,
  handlePlayerReconnect,
  startGame,
  startRound,
  pauseTimer,
  resumeTimer,
  getCurrentWord,
  markCorrect,
  undoCorrect,
  markSkip,
  removeCurrentWord,
  endRound,
  endGame,
  resetGame,
  getRoomState
};

