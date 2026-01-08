const { getShuffledDeck, getLanguages } = require('./cards');
const fs = require('fs');
const path = require('path');

// File path for persistent storage
const ROOMS_FILE = path.join(__dirname, 'rooms.json');

// Store all active rooms
let rooms = new Map();

// Store player sessions for reconnection (playerId -> roomCode)
const playerSessions = new Map();

// Grace period for reconnection (10 minutes)
const RECONNECT_GRACE_PERIOD = 600000;

// Timer callbacks (can't be persisted, so we store them separately)
const timerCallbacks = new Map();

// Load rooms from file on startup
function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const data = fs.readFileSync(ROOMS_FILE, 'utf8');
      const roomsData = JSON.parse(data);
      
      for (const roomData of roomsData) {
        // Convert players array back to Map
        const room = {
          ...roomData,
          players: new Map(roomData.players.map(p => [p.id, {
            ...p,
            connected: false, // All players start disconnected after restart
            socketId: null,
            disconnectTimeout: null
          }])),
          timerInterval: null, // Timer needs to be restarted
          timerPaused: true // Pause timer after restart
        };
        
        rooms.set(room.code, room);
        
        // Rebuild player sessions
        for (const [playerId] of room.players) {
          playerSessions.set(playerId, room.code);
        }
      }
      
      console.log(`Loaded ${rooms.size} rooms from file`);
    }
  } catch (err) {
    console.error('Failed to load rooms:', err);
    rooms = new Map();
  }
}

// Save rooms to file
function saveRooms() {
  try {
    const roomsData = [];
    
    for (const [code, room] of rooms) {
      // Convert players Map to array for JSON
      const players = [];
      for (const [id, player] of room.players) {
        players.push({
          id,
          name: player.name,
          team: player.team
        });
      }
      
      roomsData.push({
        code: room.code,
        hostId: room.hostId,
        players,
        teams: room.teams,
        scores: room.scores,
        gameState: room.gameState,
        difficulty: room.difficulty,
        language: room.language,
        deck: room.deck,
        currentCardIndex: room.currentCardIndex,
        currentActorId: room.currentActorId,
        roundTimer: room.roundTimer,
        roundTimeRemaining: room.roundTimeRemaining,
        timerPaused: room.timerPaused,
        roundHistory: room.roundHistory,
        currentRoundWords: room.currentRoundWords,
        maxSkipsPerRound: room.maxSkipsPerRound,
        skipsUsedThisRound: room.skipsUsedThisRound
      });
    }
    
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomsData, null, 2));
  } catch (err) {
    console.error('Failed to save rooms:', err);
  }
}

// Auto-save every 30 seconds
setInterval(saveRooms, 30000);

// Load rooms on module load
loadRooms();

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
    gameState: 'lobby',
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

  addPlayerToRoom(room, hostPlayerId, hostName, null);
  rooms.set(roomCode, room);
  saveRooms();
  return room;
}

function addPlayerToRoom(room, playerId, playerName, socketId) {
  const team = room.teams.A.length <= room.teams.B.length ? 'A' : 'B';

  const player = {
    id: playerId,
    name: playerName,
    team: team,
    socketId: socketId,
    connected: !!socketId,
    disconnectTimeout: null
  };

  room.players.set(playerId, player);
  room.teams[team].push(playerId);
  playerSessions.set(playerId, room.code);
  saveRooms();

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
  
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }
  
  for (const [id, player] of room.players) {
    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
    }
    playerSessions.delete(id);
  }
  
  timerCallbacks.delete(roomCode);
  rooms.delete(room.code);
  saveRooms();
  return room;
}

function movePlayerToTeam(room, playerId, newTeam) {
  const player = room.players.get(playerId);
  if (!player) return null;
  
  const oldTeam = player.team;
  if (oldTeam === newTeam) return player;
  
  const oldIndex = room.teams[oldTeam].indexOf(playerId);
  if (oldIndex > -1) {
    room.teams[oldTeam].splice(oldIndex, 1);
  }
  
  room.teams[newTeam].push(playerId);
  player.team = newTeam;
  saveRooms();
  
  return player;
}

function transferHost(room, newHostId) {
  const newHost = room.players.get(newHostId);
  if (!newHost) return null;
  
  room.hostId = newHostId;
  saveRooms();
  return newHost;
}

function setMaxSkips(room, maxSkips) {
  room.maxSkipsPerRound = maxSkips;
  saveRooms();
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

  const teamIndex = room.teams[player.team].indexOf(playerId);
  if (teamIndex > -1) {
    room.teams[player.team].splice(teamIndex, 1);
  }

  room.players.delete(playerId);
  playerSessions.delete(playerId);

  if (room.hostId === playerId && room.players.size > 0) {
    // Find a connected player to be host, or any player if none connected
    let newHostId = null;
    for (const [id, p] of room.players) {
      if (p.connected) {
        newHostId = id;
        break;
      }
    }
    if (!newHostId) {
      newHostId = room.players.keys().next().value;
    }
    room.hostId = newHostId;
  }

  if (room.players.size === 0) {
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
    }
    timerCallbacks.delete(room.code);
    rooms.delete(room.code);
    saveRooms();
    return null;
  }

  saveRooms();
  return room;
}

function handlePlayerDisconnect(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;

  player.connected = false;
  player.socketId = null;

  // DON'T pause timer - let the game continue
  // Players can catch up when they reconnect

  // Set timeout for removal (10 minutes)
  player.disconnectTimeout = setTimeout(() => {
    removePlayerFromRoom(room, playerId);
  }, RECONNECT_GRACE_PERIOD);

  saveRooms();
  return player;
}

function handlePlayerReconnect(room, playerId, socketId) {
  const player = room.players.get(playerId);
  if (!player) return null;

  if (player.disconnectTimeout) {
    clearTimeout(player.disconnectTimeout);
    player.disconnectTimeout = null;
  }

  player.connected = true;
  player.socketId = socketId;

  // If timer was paused (e.g., after server restart), resume it
  if (room.gameState === 'roundActive' && room.timerPaused && room.currentActorId === playerId) {
    resumeTimer(room);
  }

  saveRooms();
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
  saveRooms();
  return room;
}

function startRound(room, actorId, timerDuration, onTimerEnd) {
  // Clear any existing timer
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }

  room.currentActorId = actorId;
  room.roundTimer = timerDuration;
  room.roundTimeRemaining = timerDuration;
  room.gameState = 'roundActive';
  room.currentRoundWords = [];
  room.timerPaused = false;
  room.skipsUsedThisRound = 0;

  // Store callback for potential restart
  if (onTimerEnd) {
    timerCallbacks.set(room.code, onTimerEnd);
  }

  // Start the timer
  room.timerInterval = setInterval(() => {
    if (room.gameState === 'roundActive' && !room.timerPaused) {
      room.roundTimeRemaining--;
      if (room.roundTimeRemaining <= 0) {
        endRound(room);
        const callback = timerCallbacks.get(room.code);
        if (callback) callback(room);
      }
    }
  }, 1000);

  saveRooms();
  return room;
}

// Restart timer after server restart (for active rounds)
function restartRoundTimer(room, onTimerEnd) {
  if (room.gameState !== 'roundActive') return;
  if (room.timerInterval) return; // Already running
  
  if (onTimerEnd) {
    timerCallbacks.set(room.code, onTimerEnd);
  }

  room.timerInterval = setInterval(() => {
    if (room.gameState === 'roundActive' && !room.timerPaused) {
      room.roundTimeRemaining--;
      if (room.roundTimeRemaining <= 0) {
        endRound(room);
        const callback = timerCallbacks.get(room.code);
        if (callback) callback(room);
      }
    }
  }, 1000);
}

function pauseTimer(room) {
  room.timerPaused = true;
  saveRooms();
}

function resumeTimer(room) {
  room.timerPaused = false;
  saveRooms();
}

function getCurrentWord(room) {
  if (room.currentCardIndex >= room.deck.length) {
    return null;
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
  saveRooms();

  return {
    word,
    result: 'correct',
    scores: { ...room.scores },
    nextWord: getCurrentWord(room)
  };
}

function undoCorrect(room, wordIndex) {
  if (wordIndex < 0 || wordIndex >= room.currentRoundWords.length) {
    return null;
  }

  const wordEntry = room.currentRoundWords[wordIndex];
  if (wordEntry.result !== 'correct') {
    return null;
  }

  const actor = room.players.get(room.currentActorId);
  if (actor) {
    room.scores[actor.team] = Math.max(0, room.scores[actor.team] - 1);
  }

  room.currentRoundWords[wordIndex].result = 'cancelled';
  saveRooms();

  return {
    word: wordEntry.word,
    wordIndex,
    result: 'cancelled',
    scores: { ...room.scores },
    currentRoundWords: [...room.currentRoundWords]
  };
}

function undoHistoryWord(room, roundIndex, wordIndex) {
  if (roundIndex < 0 || roundIndex >= room.roundHistory.length) {
    return null;
  }

  const round = room.roundHistory[roundIndex];
  if (wordIndex < 0 || wordIndex >= round.words.length) {
    return null;
  }

  const wordEntry = round.words[wordIndex];
  if (wordEntry.result !== 'correct') {
    return null;
  }

  room.scores[round.actorTeam] = Math.max(0, room.scores[round.actorTeam] - 1);
  round.words[wordIndex].result = 'cancelled';
  round.correct = round.words.filter(w => w.result === 'correct').length;
  saveRooms();

  return {
    word: wordEntry.word,
    roundIndex,
    wordIndex,
    result: 'cancelled',
    scores: { ...room.scores },
    roundHistory: room.roundHistory
  };
}

function markSkip(room) {
  const word = getCurrentWord(room);
  if (!word) return null;

  if (room.skipsUsedThisRound >= room.maxSkipsPerRound) {
    return { error: 'noSkipsLeft', skipsUsed: room.skipsUsedThisRound, maxSkips: room.maxSkipsPerRound };
  }

  room.skipsUsedThisRound++;
  room.currentRoundWords.push({ word, result: 'skip' });
  room.currentCardIndex++;
  saveRooms();

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

  room.deck.splice(room.currentCardIndex, 1);
  saveRooms();

  return {
    word,
    nextWord: getCurrentWord(room)
  };
}

function endRound(room) {
  if (room.gameState !== 'roundActive') {
    return room;
  }

  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }

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
  timerCallbacks.delete(room.code);
  saveRooms();

  return room;
}

// Force end round - for stuck scenarios
function forceEndRound(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }

  if (room.currentRoundWords.length > 0 || room.currentActorId) {
    const actor = room.players.get(room.currentActorId);
    room.roundHistory.push({
      actor: actor ? actor.name : 'Unknown',
      actorTeam: actor ? actor.team : 'A',
      words: [...room.currentRoundWords],
      correct: room.currentRoundWords.filter(w => w.result === 'correct').length
    });
  }

  room.gameState = 'roundSetup';
  room.currentActorId = null;
  room.currentRoundWords = [];
  room.timerPaused = false;
  room.roundTimeRemaining = 0;
  timerCallbacks.delete(room.code);
  saveRooms();

  return room;
}

function endGame(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.gameState = 'gameOver';
  timerCallbacks.delete(room.code);
  saveRooms();
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
  room.timerPaused = false;
  room.roundTimeRemaining = 0;
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  timerCallbacks.delete(room.code);
  saveRooms();
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
    skipsRemaining: room.maxSkipsPerRound - room.skipsUsedThisRound,
    currentRoundWords: room.currentRoundWords // Always send for catch-up
  };

  // Include current word if requester is the actor
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
  restartRoundTimer,
  pauseTimer,
  resumeTimer,
  getCurrentWord,
  markCorrect,
  undoCorrect,
  undoHistoryWord,
  markSkip,
  removeCurrentWord,
  endRound,
  forceEndRound,
  endGame,
  resetGame,
  getRoomState,
  saveRooms
};
