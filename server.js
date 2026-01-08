const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const game = require('./game');

// Banned words file path
const BANNED_WORDS_FILE = path.join(__dirname, 'bannedWords.json');

// Load banned words
function loadBannedWords() {
  try {
    const data = fs.readFileSync(BANNED_WORDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { en: [], he: [] };
  }
}

// Save banned words
function saveBannedWords(bannedWords) {
  try {
    fs.writeFileSync(BANNED_WORDS_FILE, JSON.stringify(bannedWords, null, 2));
  } catch (err) {
    console.error('Failed to save banned words:', err);
  }
}

// Initialize banned words
let bannedWords = loadBannedWords();

// Admin password from environment variable (default for development)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Store valid admin tokens (in production, use Redis or similar)
const adminTokens = new Set();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  },
  // Aggressive keep-alive settings for Cloudflare (100s timeout)
  pingTimeout: 120000,     // 2 minutes before considering connection dead
  pingInterval: 20000,     // Ping every 20 seconds (well under Cloudflare's 100s timeout)
  upgradeTimeout: 30000,   // 30 seconds to upgrade connection
  maxHttpBufferSize: 1e6,  // 1MB max message size
  transports: ['websocket', 'polling'], // Prefer websocket but fallback to polling
  allowUpgrades: true,
  connectTimeout: 45000    // 45 seconds to establish connection
});

// Parse JSON bodies
app.use(express.json());

// Serve static files (except admin.html which requires auth)
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html'
}));

// Admin login endpoint
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    
    // Token expires in 24 hours
    setTimeout(() => adminTokens.delete(token), 24 * 60 * 60 * 1000);
    
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Verify admin token endpoint
app.post('/api/admin/verify', (req, res) => {
  const { token } = req.body;
  
  if (adminTokens.has(token)) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Admin logout endpoint
app.post('/api/admin/logout', (req, res) => {
  const { token } = req.body;
  adminTokens.delete(token);
  res.json({ success: true });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  let currentPlayerId = null;
  let currentRoomCode = null;

  // Create a new room
  socket.on('create-room', ({ playerId, playerName }) => {
    const room = game.createRoom(playerId, playerName);
    currentPlayerId = playerId;
    currentRoomCode = room.code;

    // Update socket ID
    const player = room.players.get(playerId);
    if (player) {
      player.socketId = socket.id;
    }

    socket.join(room.code);
    socket.emit('room-created', {
      roomCode: room.code,
      playerId,
      state: game.getRoomState(room, playerId)
    });
    console.log(`Room ${room.code} created by ${playerName}`);
  });

  // Join an existing room
  socket.on('join-room', ({ roomCode, playerId, playerName }) => {
    const room = game.getRoom(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Check if reconnecting
    const existingPlayer = room.players.get(playerId);
    if (existingPlayer) {
      // Reconnection
      game.handlePlayerReconnect(room, playerId, socket.id);
      currentPlayerId = playerId;
      currentRoomCode = room.code;
      socket.join(room.code);
      
      socket.emit('reconnect-success', {
        playerId,
        state: game.getRoomState(room, playerId)
      });
      
      socket.to(room.code).emit('player-reconnected', {
        playerId,
        playerName: existingPlayer.name,
        state: game.getRoomState(room)
      });
      
      console.log(`Player ${existingPlayer.name} reconnected to ${room.code}`);
      return;
    }

    // New player joining
    if (room.gameState !== 'lobby') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    const player = game.addPlayerToRoom(room, playerId, playerName, socket.id);
    currentPlayerId = playerId;
    currentRoomCode = room.code;
    socket.join(room.code);

    socket.emit('room-joined', {
      playerId,
      team: player.team,
      state: game.getRoomState(room, playerId)
    });

    socket.to(room.code).emit('player-joined', {
      playerId,
      playerName,
      team: player.team,
      state: game.getRoomState(room)
    });

    console.log(`Player ${playerName} joined room ${room.code} on Team ${player.team}`);
  });

  // Auto-rejoin room after socket reconnects (silent - no error toasts)
  socket.on('rejoin-room', ({ playerId, roomCode, playerName }) => {
    const room = game.getRoom(roomCode);
    
    if (!room) {
      // Room gone - just clear storage, don't show error
      socket.emit('rejoin-failed', { silent: true });
      return;
    }

    const player = room.players.get(playerId);
    if (!player) {
      // Player no longer in room - just clear storage
      socket.emit('rejoin-failed', { silent: true });
      return;
    }

    game.handlePlayerReconnect(room, playerId, socket.id);
    currentPlayerId = playerId;
    currentRoomCode = room.code;
    socket.join(room.code);

    socket.emit('reconnect-success', {
      playerId,
      state: game.getRoomState(room, playerId)
    });

    // Notify others (this will be delayed on client side)
    socket.to(room.code).emit('player-reconnected', {
      playerId,
      playerName: player.name,
      state: game.getRoomState(room)
    });

    console.log(`Player ${player.name} auto-rejoined room ${room.code}`);
  });

  // Attempt to reconnect to a room
  socket.on('reconnect-attempt', ({ playerId, roomCode }) => {
    const room = game.getRoom(roomCode);
    
    if (!room) {
      socket.emit('reconnect-failed', { message: 'Room no longer exists' });
      return;
    }

    const player = room.players.get(playerId);
    if (!player) {
      socket.emit('reconnect-failed', { message: 'Player no longer in room' });
      return;
    }

    game.handlePlayerReconnect(room, playerId, socket.id);
    currentPlayerId = playerId;
    currentRoomCode = room.code;
    socket.join(room.code);

    socket.emit('reconnect-success', {
      playerId,
      state: game.getRoomState(room, playerId)
    });

    socket.to(room.code).emit('player-reconnected', {
      playerId,
      playerName: player.name,
      state: game.getRoomState(room)
    });

    console.log(`Player ${player.name} reconnected to ${room.code}`);
  });

  // Move player to different team (host only)
  socket.on('move-player', ({ targetPlayerId, newTeam }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can move players' });
      return;
    }

    if (room.gameState !== 'lobby') {
      socket.emit('error', { message: 'Cannot change teams during game' });
      return;
    }

    const player = game.movePlayerToTeam(room, targetPlayerId, newTeam);
    if (player) {
      io.to(room.code).emit('teams-updated', {
        state: game.getRoomState(room)
      });
      console.log(`Player ${player.name} moved to Team ${newTeam}`);
    }
  });

  // Transfer host to another player
  socket.on('transfer-host', ({ newHostId }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can transfer host privileges' });
      return;
    }

    const newHost = game.transferHost(room, newHostId);
    if (newHost) {
      io.to(room.code).emit('host-changed', {
        newHostId,
        newHostName: newHost.name,
        state: game.getRoomState(room)
      });
      console.log(`Host transferred to ${newHost.name} in room ${room.code}`);
    }
  });

  // Set max skips per round
  socket.on('set-max-skips', ({ maxSkips }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can change settings' });
      return;
    }

    game.setMaxSkips(room, maxSkips);
    io.to(room.code).emit('settings-updated', {
      maxSkipsPerRound: maxSkips,
      state: game.getRoomState(room)
    });
  });

  // Start the game
  socket.on('start-game', ({ difficulty, language }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can start the game' });
      return;
    }

    const lang = language || 'en';
    const langBannedWords = bannedWords[lang] || [];
    game.startGame(room, difficulty, lang, langBannedWords);
    
    io.to(room.code).emit('game-started', {
      state: game.getRoomState(room)
    });

    console.log(`Game started in room ${room.code} with difficulty ${difficulty}, language ${lang} (${langBannedWords.length} words banned)`);
  });

  // Start a round (host selects actor and timer)
  socket.on('start-round', ({ actorId, timerDuration }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can start rounds' });
      return;
    }

    // Prevent starting a round when one is already active
    if (room.gameState === 'roundActive') {
      socket.emit('error', { message: 'A round is already in progress' });
      return;
    }

    const actor = room.players.get(actorId);
    if (!actor || !actor.connected) {
      socket.emit('error', { message: 'Selected player is not available' });
      return;
    }

    game.startRound(room, actorId, timerDuration, (endedRoom) => {
      // Timer ended callback
      io.to(endedRoom.code).emit('round-ended', {
        state: game.getRoomState(endedRoom)
      });
    });

    // Send different states to actor vs other players
    for (const [pid, player] of room.players) {
      if (player.socketId) {
        io.to(player.socketId).emit('round-started', {
          state: game.getRoomState(room, pid)
        });
      }
    }

    console.log(`Round started in ${room.code}: ${actor.name} is acting for ${timerDuration}s`);
  });

  // Actor marks word as correct
  socket.on('mark-correct', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room || room.currentActorId !== currentPlayerId) return;

    const result = game.markCorrect(room);
    if (!result) return;

    // Send update to all players
    for (const [pid, player] of room.players) {
      if (player.socketId) {
        io.to(player.socketId).emit('word-result', {
          ...result,
          nextWord: pid === currentPlayerId ? result.nextWord : undefined,
          timeRemaining: room.roundTimeRemaining
        });
      }
    }
  });

  // Host undoes a correct word (actor broke rules)
  socket.on('undo-correct', ({ wordIndex }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    // Only host can undo
    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can undo words' });
      return;
    }

    const result = game.undoCorrect(room, wordIndex);
    if (!result) {
      socket.emit('error', { message: 'Cannot undo this word' });
      return;
    }

    // Send update to all players
    for (const [pid, player] of room.players) {
      if (player.socketId) {
        io.to(player.socketId).emit('word-undone', {
          ...result,
          timeRemaining: room.roundTimeRemaining
        });
      }
    }

    console.log(`Word "${result.word}" undone in room ${room.code}`);
  });

  // Host undoes a word from history (after round ended)
  socket.on('undo-history-word', ({ roundIndex, wordIndex }) => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    // Only host can undo
    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can undo words' });
      return;
    }

    const result = game.undoHistoryWord(room, roundIndex, wordIndex);
    if (!result) {
      socket.emit('error', { message: 'Cannot undo this word' });
      return;
    }

    // Send update to all players
    for (const [pid, player] of room.players) {
      if (player.socketId) {
        io.to(player.socketId).emit('history-updated', {
          state: game.getRoomState(room, pid)
        });
      }
    }

    console.log(`History word "${result.word}" undone in room ${room.code}`);
  });

  // Actor removes word (ban it permanently)
  socket.on('remove-word', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room || room.currentActorId !== currentPlayerId) return;

    const result = game.removeCurrentWord(room);
    if (!result) return;

    // Add word to banned list
    const lang = room.language || 'en';
    if (!bannedWords[lang]) bannedWords[lang] = [];
    if (!bannedWords[lang].includes(result.word)) {
      bannedWords[lang].push(result.word);
      saveBannedWords(bannedWords);
      console.log(`Word "${result.word}" banned from ${lang} deck`);
    }

    // Send update to all players
    for (const [pid, player] of room.players) {
      if (player.socketId) {
        io.to(player.socketId).emit('word-removed', {
          word: result.word,
          nextWord: pid === currentPlayerId ? result.nextWord : undefined,
          timeRemaining: room.roundTimeRemaining
        });
      }
    }
  });

  // Actor skips word
  socket.on('mark-skip', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room || room.currentActorId !== currentPlayerId) return;

    const result = game.markSkip(room);
    if (!result) return;

    // Check if skip was denied due to limit
    if (result.error === 'noSkipsLeft') {
      socket.emit('skip-denied', {
        message: `No skips remaining (max ${result.maxSkips} per round)`,
        skipsUsed: result.skipsUsed,
        maxSkips: result.maxSkips
      });
      return;
    }

    // Send update to all players
    for (const [pid, player] of room.players) {
      if (player.socketId) {
        io.to(player.socketId).emit('word-result', {
          ...result,
          nextWord: pid === currentPlayerId ? result.nextWord : undefined,
          timeRemaining: room.roundTimeRemaining,
          skipsRemaining: result.skipsRemaining
        });
      }
    }
  });

  // Host ends round early
  socket.on('end-round', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can end rounds' });
      return;
    }

    game.endRound(room);

    io.to(room.code).emit('round-ended', {
      state: game.getRoomState(room)
    });

    console.log(`Round ended in ${room.code}`);
  });

  // End the game
  socket.on('end-game', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can end the game' });
      return;
    }

    game.endGame(room);

    io.to(room.code).emit('game-over', {
      state: game.getRoomState(room)
    });

    console.log(`Game ended in ${room.code}`);
  });

  // Reset game (go back to lobby)
  socket.on('reset-game', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    if (currentPlayerId !== room.hostId) {
      socket.emit('error', { message: 'Only the host can reset the game' });
      return;
    }

    game.resetGame(room);

    io.to(room.code).emit('game-reset', {
      state: game.getRoomState(room)
    });

    console.log(`Game reset in ${room.code}`);
  });

  // Pause timer (actor only)
  socket.on('pause-timer', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room || room.currentActorId !== currentPlayerId) return;
    
    game.pauseTimer(room);
    io.to(room.code).emit('timer-paused');
  });

  // Resume timer (actor only)
  socket.on('resume-timer', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room || room.currentActorId !== currentPlayerId) return;
    
    game.resumeTimer(room);
    io.to(room.code).emit('timer-resumed', {
      timeRemaining: room.roundTimeRemaining
    });
  });

  // Heartbeat to keep connection alive
  socket.on('heartbeat', () => {
    // Just acknowledge - keeps the connection alive through Cloudflare
    socket.emit('heartbeat-ack');
  });

  // Request timer sync
  socket.on('sync-timer', () => {
    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    socket.emit('timer-sync', {
      timeRemaining: room.roundTimeRemaining,
      paused: room.timerPaused
    });
  });

  // Leave room
  socket.on('leave-room', () => {
    if (!currentRoomCode) return;

    const room = game.getRoom(currentRoomCode);
    if (room) {
      const player = room.players.get(currentPlayerId);
      game.removePlayerFromRoom(room, currentPlayerId);
      
      if (room.players.size > 0) {
        io.to(room.code).emit('player-left', {
          playerId: currentPlayerId,
          playerName: player?.name,
          state: game.getRoomState(room)
        });
      }
    }

    socket.leave(currentRoomCode);
    currentPlayerId = null;
    currentRoomCode = null;
  });

  // Admin: Get all rooms (requires valid token)
  socket.on('admin-get-rooms', ({ token }) => {
    if (!token || !adminTokens.has(token)) {
      socket.emit('admin-auth-required');
      return;
    }
    
    const allRooms = game.getAllRooms();
    const roomsData = [];
    let totalPlayers = 0;
    let gamesInProgress = 0;

    for (const [code, room] of allRooms) {
      const players = [];
      let connectedCount = 0;

      for (const [id, player] of room.players) {
        players.push({
          id,
          name: player.name,
          team: player.team,
          connected: player.connected,
          isHost: id === room.hostId
        });
        totalPlayers++;
        if (player.connected) connectedCount++;
      }

      if (room.gameState !== 'lobby' && room.gameState !== 'gameOver') {
        gamesInProgress++;
      }

      roomsData.push({
        code: room.code,
        gameState: room.gameState,
        difficulty: room.difficulty,
        scores: room.scores,
        cardsRemaining: room.deck.length - room.currentCardIndex,
        playerCount: room.players.size,
        connectedCount,
        players
      });
    }

    socket.emit('admin-rooms-data', {
      rooms: roomsData,
      stats: {
        totalRooms: allRooms.size,
        totalPlayers,
        gamesInProgress
      }
    });
  });

  // Admin: Close a room (requires valid token)
  socket.on('admin-close-room', ({ roomCode, token }) => {
    if (!token || !adminTokens.has(token)) {
      socket.emit('admin-auth-required');
      return;
    }
    
    const room = game.getRoom(roomCode);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Notify all players in the room
    io.to(room.code).emit('room-closed', {
      message: 'This room has been closed by an administrator'
    });

    // Close the room
    game.closeRoom(roomCode);

    socket.emit('admin-room-closed', { roomCode });
    console.log(`Admin closed room ${roomCode}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (!currentRoomCode || !currentPlayerId) return;

    const room = game.getRoom(currentRoomCode);
    if (!room) return;

    const player = game.handlePlayerDisconnect(room, currentPlayerId);
    if (player) {
      io.to(room.code).emit('player-disconnected', {
        playerId: currentPlayerId,
        playerName: player.name,
        state: game.getRoomState(room)
      });
      console.log(`Player ${player.name} disconnected from ${room.code}`);
    }
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

