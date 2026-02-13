'use strict';

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const game = require('./game');

// ============================================================
// Config
// ============================================================
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const BANNED_WORDS_FILE = path.join(__dirname, 'bannedWords.json');

// ============================================================
// Banned words
// ============================================================
function loadBannedWords() {
  try { return JSON.parse(fs.readFileSync(BANNED_WORDS_FILE, 'utf8')); }
  catch { return { en: [], he: [] }; }
}

function saveBannedWords(data) {
  try { fs.writeFileSync(BANNED_WORDS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[ban] Save failed:', e.message); }
}

let bannedWords = loadBannedWords();

// ============================================================
// Admin tokens (in-memory; fine for single-instance)
// ============================================================
const adminTokens = new Set();

// ============================================================
// Express + Socket.io
// ============================================================
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 120000,   // 2 min before considering dead
  pingInterval: 25000,   // ping every 25 s (under Cloudflare 100 s timeout)
  maxHttpBufferSize: 1e6,
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// ============================================================
// Admin REST endpoints
// ============================================================
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    setTimeout(() => adminTokens.delete(token), 24 * 60 * 60 * 1000);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

app.post('/api/admin/verify', (req, res) => {
  res.json({ valid: adminTokens.has(req.body.token) });
});

app.post('/api/admin/logout', (req, res) => {
  adminTokens.delete(req.body.token);
  res.json({ success: true });
});

app.get('/health', (_, res) => res.sendStatus(200));

// ============================================================
// Helpers
// ============================================================

/** Send personalized state to every connected player in the room */
function sendStateToAll(room, event) {
  for (const [pid, p] of room.players) {
    if (p.socketId) {
      io.to(p.socketId).emit(event, {
        state: game.getClientState(room, pid),
      });
    }
  }
}

// ============================================================
// Register global round-end handler
// ============================================================
game.setRoundEndHandler((room) => {
  sendStateToAll(room, 'round-ended');
});

// ============================================================
// Socket connection handler
// ============================================================
io.on('connection', (socket) => {
  let myPlayerId = null;
  let myRoomCode = null;

  // ---- Helpers ----
  function myRoom() {
    return myRoomCode ? game.getRoom(myRoomCode) : null;
  }

  function assertHost(room) {
    if (myPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can do that' });
      return false;
    }
    return true;
  }

  function isActor(room) {
    return room.currentActorId === myPlayerId;
  }

  // ================================================================
  // ROOM MANAGEMENT
  // ================================================================

  // ---- Create room ----
  socket.on('create-room', ({ playerId, playerName }) => {
    if (!playerId || !playerName?.trim()) {
      socket.emit('error', { message: 'Name is required' });
      return;
    }
    const name = playerName.trim().slice(0, 20);
    const room = game.createRoom(playerId, name);
    game.playerConnect(room, playerId, socket.id);

    myPlayerId = playerId;
    myRoomCode = room.code;
    socket.join(room.code);

    socket.emit('room-created', {
      roomCode: room.code,
      playerId,
      state: game.getClientState(room, playerId),
    });
    console.log(`[room] ${name} created ${room.code}`);
  });

  // ---- Join room ----
  socket.on('join-room', ({ roomCode, playerId, playerName }) => {
    if (!roomCode || !playerId || !playerName?.trim()) {
      socket.emit('error', { message: 'Name and room code required' });
      return;
    }
    const name = playerName.trim().slice(0, 20);
    const room = game.getRoom(roomCode);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Existing player → reconnect
    const existing = room.players.get(playerId);
    if (existing) {
      game.playerConnect(room, playerId, socket.id);
      myPlayerId = playerId;
      myRoomCode = room.code;
      socket.join(room.code);

      socket.emit('reconnected', {
        playerId,
        state: game.getClientState(room, playerId),
      });
      socket.to(room.code).emit('player-reconnected', {
        playerId,
        playerName: existing.name,
      });
      sendStateToAll(room, 'state-sync');
      console.log(`[room] ${existing.name} reconnected to ${room.code}`);
      return;
    }

    // New player
    if (room.gameState !== game.STATES.LOBBY) {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    const player = game.addPlayer(room, playerId, name, socket.id);
    myPlayerId = playerId;
    myRoomCode = room.code;
    socket.join(room.code);

    socket.emit('room-joined', {
      playerId,
      team: player.team,
      state: game.getClientState(room, playerId),
    });
    socket.to(room.code).emit('player-joined', {
      playerId,
      playerName: name,
      team: player.team,
    });
    sendStateToAll(room, 'state-sync');
    console.log(`[room] ${name} joined ${room.code} (Team ${player.team})`);
  });

  // ---- Rejoin after socket reconnect (single reconnection path) ----
  socket.on('rejoin', ({ playerId, roomCode, playerName }) => {
    const room = game.getRoom(roomCode);
    if (!room || !room.players.has(playerId)) {
      socket.emit('rejoin-failed', {});
      return;
    }

    const player = room.players.get(playerId);
    game.playerConnect(room, playerId, socket.id);

    // If the reconnecting player is the actor and timer was paused
    // (e.g. after server restart), resume the timer
    if (
      room.gameState === game.STATES.ROUND_ACTIVE &&
      room.timerPaused &&
      room.currentActorId === playerId
    ) {
      game.resumeTimer(room);
    }

    myPlayerId = playerId;
    myRoomCode = room.code;
    socket.join(room.code);

    socket.emit('reconnected', {
      playerId,
      state: game.getClientState(room, playerId),
    });
    socket.to(room.code).emit('player-reconnected', {
      playerId,
      playerName: player.name,
    });
    sendStateToAll(room, 'state-sync');
    console.log(`[room] ${player.name} rejoined ${room.code}`);
  });

  // ---- Move player to team (host, lobby only) ----
  socket.on('move-player', ({ targetPlayerId, newTeam }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    if (room.gameState !== game.STATES.LOBBY) {
      socket.emit('error', { message: 'Cannot move during game' });
      return;
    }
    if (game.movePlayerToTeam(room, targetPlayerId, newTeam)) {
      sendStateToAll(room, 'state-sync');
    }
  });

  // ---- Transfer host ----
  socket.on('transfer-host', ({ newHostId }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    if (game.transferHost(room, newHostId)) {
      sendStateToAll(room, 'state-sync');
    }
  });

  // ---- Set max skips ----
  socket.on('set-max-skips', ({ maxSkips }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    game.setMaxSkips(room, maxSkips);
    sendStateToAll(room, 'state-sync');
  });

  // ================================================================
  // GAME FLOW
  // ================================================================

  // ---- Start game ----
  socket.on('start-game', ({ difficulty, language }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    const lang = language || 'en';
    if (!game.startGame(room, difficulty, lang, bannedWords[lang] || [])) {
      socket.emit('error', { message: 'Cannot start game' });
      return;
    }
    sendStateToAll(room, 'game-started');
    console.log(`[game] Started ${room.code} (${difficulty}/${lang})`);
  });

  // ---- Start round ----
  socket.on('start-round', ({ actorId, timerDuration }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    if (!game.startRound(room, actorId, timerDuration)) {
      socket.emit('error', { message: 'Cannot start round' });
      return;
    }
    sendStateToAll(room, 'round-started');
    console.log(`[round] ${room.code}: actor=${actorId}, ${timerDuration}s`);
  });

  // ---- Mark correct ----
  socket.on('mark-correct', () => {
    const room = myRoom();
    if (!room || !isActor(room)) return;
    const result = game.markCorrect(room);
    if (!result) return;
    for (const [pid, p] of room.players) {
      if (p.socketId) {
        io.to(p.socketId).emit('word-result', {
          word: result.word,
          result: result.result,
          scores: result.scores,
          nextWord: pid === myPlayerId ? result.nextWord : undefined,
          timeRemaining: game.getTimeRemaining(room),
        });
      }
    }
  });

  // ---- Undo correct (host, during round) ----
  socket.on('undo-correct', ({ wordIndex }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    const result = game.undoCorrect(room, wordIndex);
    if (!result) {
      socket.emit('error', { message: 'Cannot undo' });
      return;
    }
    for (const [, p] of room.players) {
      if (p.socketId) {
        io.to(p.socketId).emit('word-undone', {
          ...result,
          timeRemaining: game.getTimeRemaining(room),
        });
      }
    }
  });

  // ---- Undo history word (host, after round) ----
  socket.on('undo-history-word', ({ roundIndex, wordIndex }) => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    const result = game.undoHistoryWord(room, roundIndex, wordIndex);
    if (!result) {
      socket.emit('error', { message: 'Cannot undo' });
      return;
    }
    sendStateToAll(room, 'state-sync');
  });

  // ---- Skip ----
  socket.on('mark-skip', () => {
    const room = myRoom();
    if (!room || !isActor(room)) return;
    const result = game.markSkip(room);
    if (!result) return;
    if (result.error === 'noSkipsLeft') {
      socket.emit('skip-denied', {
        message: `No skips left (max ${result.maxSkips})`,
        skipsUsed: result.skipsUsed,
        maxSkips: result.maxSkips,
      });
      return;
    }
    for (const [pid, p] of room.players) {
      if (p.socketId) {
        io.to(p.socketId).emit('word-result', {
          word: result.word,
          result: result.result,
          scores: result.scores,
          nextWord: pid === myPlayerId ? result.nextWord : undefined,
          timeRemaining: game.getTimeRemaining(room),
          skipsRemaining: result.skipsRemaining,
        });
      }
    }
  });

  // ---- Remove word (ban permanently) ----
  socket.on('remove-word', () => {
    const room = myRoom();
    if (!room || !isActor(room)) return;
    const result = game.removeCurrentWord(room);
    if (!result) return;

    // Persist to banned list
    const lang = room.language || 'en';
    if (!bannedWords[lang]) bannedWords[lang] = [];
    if (!bannedWords[lang].includes(result.word)) {
      bannedWords[lang].push(result.word);
      saveBannedWords(bannedWords);
    }

    for (const [pid, p] of room.players) {
      if (p.socketId) {
        io.to(p.socketId).emit('word-removed', {
          word: result.word,
          nextWord: pid === myPlayerId ? result.nextWord : undefined,
          timeRemaining: game.getTimeRemaining(room),
        });
      }
    }
  });

  // ---- Pause / resume timer ----
  socket.on('pause-timer', () => {
    const room = myRoom();
    if (!room || !isActor(room)) return;
    if (game.pauseTimer(room)) {
      io.to(room.code).emit('timer-paused', {
        timeRemaining: game.getTimeRemaining(room),
      });
    }
  });

  socket.on('resume-timer', () => {
    const room = myRoom();
    if (!room || !isActor(room)) return;
    if (game.resumeTimer(room)) {
      io.to(room.code).emit('timer-resumed', {
        timeRemaining: game.getTimeRemaining(room),
        roundEndsAt: room.roundEndsAt,
        serverTime: Date.now(),
      });
    }
  });

  // ---- End round / force end ----
  socket.on('end-round', () => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    if (game.endRound(room)) sendStateToAll(room, 'round-ended');
  });

  socket.on('force-end-round', () => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    if (game.endRound(room)) sendStateToAll(room, 'round-ended');
  });

  // ---- End game ----
  socket.on('end-game', () => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    game.endGame(room);
    sendStateToAll(room, 'game-over');
  });

  // ---- Reset game (back to lobby) ----
  socket.on('reset-game', () => {
    const room = myRoom();
    if (!room || !assertHost(room)) return;
    game.resetGame(room);
    sendStateToAll(room, 'game-reset');
  });

  // ---- Leave room ----
  socket.on('leave-room', () => {
    if (!myRoomCode || !myPlayerId) return;
    const room = myRoom();
    if (!room) return;

    const player = room.players.get(myPlayerId);
    const name = player?.name;
    const result = game.removePlayer(room, myPlayerId);

    socket.leave(myRoomCode);
    if (result) {
      io.to(room.code).emit('player-left', {
        playerId: myPlayerId,
        playerName: name,
      });
      sendStateToAll(room, 'state-sync');
    }

    myPlayerId = null;
    myRoomCode = null;
  });

  // ---- Heartbeat (keep alive through proxies) ----
  socket.on('heartbeat', () => socket.emit('heartbeat-ack'));

  // ================================================================
  // ADMIN
  // ================================================================

  socket.on('admin-get-rooms', ({ token }) => {
    if (!adminTokens.has(token)) {
      socket.emit('admin-auth-required');
      return;
    }
    const allRooms = game.getAllRooms();
    const roomsData = [];
    let totalPlayers = 0;
    let gamesInProgress = 0;

    for (const [, room] of allRooms) {
      const players = [];
      let connected = 0;
      for (const [id, p] of room.players) {
        players.push({
          id, name: p.name, team: p.team,
          connected: p.connected, isHost: id === room.hostId,
        });
        totalPlayers++;
        if (p.connected) connected++;
      }
      if (room.gameState !== 'lobby' && room.gameState !== 'gameOver') {
        gamesInProgress++;
      }
      roomsData.push({
        code: room.code,
        gameState: room.gameState,
        difficulty: room.difficulty,
        scores: room.scores,
        cardsRemaining: room.deck.length - room.deckIndex,
        playerCount: room.players.size,
        connectedCount: connected,
        players,
      });
    }

    socket.emit('admin-rooms-data', {
      rooms: roomsData,
      stats: { totalRooms: allRooms.size, totalPlayers, gamesInProgress },
    });
  });

  socket.on('admin-close-room', ({ roomCode: code, token }) => {
    if (!adminTokens.has(token)) {
      socket.emit('admin-auth-required');
      return;
    }
    const room = game.getRoom(code);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    io.to(room.code).emit('room-closed', {
      message: 'Room closed by administrator',
    });
    game.deleteRoom(code);
    socket.emit('admin-room-closed', { roomCode: code });
  });

  // ================================================================
  // DISCONNECT
  // ================================================================

  socket.on('disconnect', () => {
    if (!myRoomCode || !myPlayerId) return;
    const room = myRoom();
    if (!room) return;

    const player = game.playerDisconnect(room, myPlayerId);
    if (player) {
      socket.to(room.code).emit('player-disconnected', {
        playerId: myPlayerId,
        playerName: player.name,
      });
      sendStateToAll(room, 'state-sync');
    }
  });
});

// ============================================================
// Start
// ============================================================
httpServer.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  game.restartTimers();
});

// Graceful shutdown — flush state to disk
process.on('SIGTERM', () => { console.log('[server] SIGTERM'); game.forceSave(); process.exit(0); });
process.on('SIGINT', () => { console.log('[server] SIGINT'); game.forceSave(); process.exit(0); });
