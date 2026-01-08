// Socket.io client - auto-detect base path for subpath hosting
const basePath = window.location.pathname.includes('/why_are_you_like_this') 
  ? '/why_are_you_like_this' 
  : '';
const socket = io({
  path: basePath + '/socket.io',
  // Robust connection settings
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 60000,
  transports: ['websocket', 'polling']
});

// Track connection state
let isConnected = false;
let hasAttemptedAutoRejoin = false;

// Auto-rejoin room on reconnect
socket.on('connect', () => {
  console.log('Socket connected:', socket.id);
  isConnected = true;
  
  // If we have stored session info, try to rejoin
  const storedPlayerId = localStorage.getItem('playerId');
  const storedRoomCode = localStorage.getItem('roomCode');
  const storedPlayerName = localStorage.getItem('playerName');
  
  if (storedPlayerId && storedRoomCode && storedPlayerName && !hasAttemptedAutoRejoin) {
    hasAttemptedAutoRejoin = true;
    console.log('Attempting auto-rejoin to room:', storedRoomCode);
    socket.emit('rejoin-room', {
      playerId: storedPlayerId,
      roomCode: storedRoomCode,
      playerName: storedPlayerName
    });
  }
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason);
  isConnected = false;
  hasAttemptedAutoRejoin = false; // Allow rejoin on next connect
  
  // Only show toast for unexpected disconnects (not manual ones)
  if (reason !== 'io client disconnect') {
    showToast('Connection lost, reconnecting...', 'info');
  }
});

socket.on('connect_error', (error) => {
  console.log('Connection error:', error.message);
});

// Game state
let playerId = localStorage.getItem('playerId');
let roomCode = localStorage.getItem('roomCode');
let playerName = localStorage.getItem('playerName');
let isHost = false;
let currentState = null;
let selectedDifficulty = 'easy';
let selectedTimer = 60;
let selectedLanguage = 'en';
let selectedMaxSkips = 2;
let currentRoundWordsList = [];
let skipsRemaining = 2;
let pendingDisconnectToasts = new Map(); // playerId -> timeout

// DOM Elements
const screens = {
  landing: document.getElementById('landing-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  gameover: document.getElementById('gameover-screen')
};

// Landing screen elements
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');

// Lobby elements
const displayRoomCode = document.getElementById('display-room-code');
const teamAList = document.getElementById('team-a-list');
const teamBList = document.getElementById('team-b-list');
const teamADrop = document.getElementById('team-a-drop');
const teamBDrop = document.getElementById('team-b-drop');
const dragHint = document.getElementById('drag-hint');
const hostLobbyControls = document.getElementById('host-lobby-controls');
const waitingMessage = document.getElementById('waiting-message');
const startGameBtn = document.getElementById('start-game-btn');
const difficultyBtns = document.querySelectorAll('.diff-btn');
const languageBtns = document.querySelectorAll('.lang-btn');
const skipLimitBtns = document.querySelectorAll('.skip-limit-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const transferHostSelect = document.getElementById('transfer-host-select');
const transferHostBtn = document.getElementById('transfer-host-btn');
const leaveGameBtn = document.getElementById('leave-game-btn');

// Game elements
const scoreA = document.getElementById('score-a');
const scoreB = document.getElementById('score-b');
const timerDisplay = document.getElementById('timer');
const roundSetup = document.getElementById('round-setup');
const waitingSetup = document.getElementById('waiting-setup');
const actorView = document.getElementById('actor-view');
const guesserView = document.getElementById('guesser-view');
const actorSelect = document.getElementById('actor-select');
const timerBtns = document.querySelectorAll('.timer-btn');
const startRoundBtn = document.getElementById('start-round-btn');
const cardsRemaining = document.getElementById('cards-remaining');
const currentWord = document.getElementById('current-word');
const correctBtn = document.getElementById('correct-btn');
const skipBtn = document.getElementById('skip-btn');
const removeWordBtn = document.getElementById('remove-word-btn');
const roundCorrect = document.getElementById('round-correct');
const guesserRoundCorrect = document.getElementById('guesser-round-correct');
const currentActorName = document.getElementById('current-actor-name');
const roundHistory = document.getElementById('round-history');
const hostGameControls = document.getElementById('host-game-controls');
const endRoundBtn = document.getElementById('end-round-btn');
const endGameBtn = document.getElementById('end-game-btn');

// Current round elements
const currentRoundSection = document.getElementById('current-round-section');
const currentRoundWords = document.getElementById('current-round-words');

// Game over elements
const finalScoreA = document.getElementById('final-score-a');
const finalScoreB = document.getElementById('final-score-b');
const winnerAnnouncement = document.getElementById('winner-announcement');
const playAgainBtn = document.getElementById('play-again-btn');
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');

// Toast container
const toastContainer = document.getElementById('toast-container');

// Generate player ID if not exists
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('playerId', playerId);
}

// Restore player name if exists
if (playerName) {
  playerNameInput.value = playerName;
}

// Try to reconnect on page load
if (roomCode) {
  socket.emit('reconnect-attempt', { playerId, roomCode });
}

// Helper Functions
function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  screens[screenName].classList.add('active');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function updatePlayerLists(state) {
  teamAList.innerHTML = '';
  teamBList.innerHTML = '';
  
  const canDrag = state.hostId === playerId && state.gameState === 'lobby';
  
  // Show/hide drag hint
  if (canDrag) {
    dragHint.classList.remove('hidden');
  } else {
    dragHint.classList.add('hidden');
  }
  
  state.players.forEach(player => {
    const li = document.createElement('li');
    li.className = 'player-item';
    li.dataset.playerId = player.id;
    
    if (player.id === playerId) li.classList.add('is-you');
    if (player.isHost) li.classList.add('is-host');
    if (!player.connected) li.classList.add('disconnected');
    
    // Make draggable for host
    if (canDrag) {
      li.classList.add('draggable');
      li.draggable = true;
      
      li.addEventListener('dragstart', handleDragStart);
      li.addEventListener('dragend', handleDragEnd);
    }
    
    let nameText = player.name;
    if (player.id === playerId) nameText += ' (you)';
    if (!player.connected) nameText += ' (disconnected)';
    
    li.textContent = nameText;
    
    if (player.team === 'A') {
      teamAList.appendChild(li);
    } else {
      teamBList.appendChild(li);
    }
  });
}

// Drag and Drop handlers
let draggedPlayerId = null;

function handleDragStart(e) {
  draggedPlayerId = e.target.dataset.playerId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedPlayerId = null;
  
  // Remove drag-over from all teams
  teamADrop.classList.remove('drag-over');
  teamBDrop.classList.remove('drag-over');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  const team = e.currentTarget;
  team.classList.add('drag-over');
}

function handleDragLeave(e) {
  const team = e.currentTarget;
  // Only remove if we're actually leaving the team container
  if (!team.contains(e.relatedTarget)) {
    team.classList.remove('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();
  const team = e.currentTarget;
  team.classList.remove('drag-over');
  
  const newTeam = team.dataset.team;
  
  if (draggedPlayerId && newTeam) {
    socket.emit('move-player', { targetPlayerId: draggedPlayerId, newTeam });
  }
}

// Set up drop zones
teamADrop.addEventListener('dragover', handleDragOver);
teamADrop.addEventListener('dragenter', handleDragEnter);
teamADrop.addEventListener('dragleave', handleDragLeave);
teamADrop.addEventListener('drop', handleDrop);

teamBDrop.addEventListener('dragover', handleDragOver);
teamBDrop.addEventListener('dragenter', handleDragEnter);
teamBDrop.addEventListener('dragleave', handleDragLeave);
teamBDrop.addEventListener('drop', handleDrop);

function updateActorSelect(state) {
  actorSelect.innerHTML = '<option value="">Select a player...</option>';
  
  if (!state || !state.players) return;
  
  state.players.forEach(player => {
    // Show all connected players
    if (player.connected) {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = `${player.name} (Team ${player.team})`;
      actorSelect.appendChild(option);
    }
  });
  
  console.log('Actor dropdown updated:', actorSelect.options.length - 1, 'players available');
}

function updateTransferHostSelect(state) {
  if (!transferHostSelect) return;
  
  transferHostSelect.innerHTML = '<option value="">Select player...</option>';
  
  if (!state || !state.players) return;
  
  state.players.forEach(player => {
    // Show all connected players except yourself
    if (player.id !== playerId && player.connected) {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = `${player.name} (Team ${player.team})`;
      transferHostSelect.appendChild(option);
    }
  });
  
  // Debug log to help identify issues
  console.log('Transfer dropdown updated:', transferHostSelect.options.length - 1, 'players available');
}

function updateSkipButton(remaining, max) {
  skipsRemaining = remaining;
  if (max === 999) {
    skipBtn.textContent = 'Skip';
    skipBtn.disabled = false;
  } else if (remaining <= 0) {
    skipBtn.textContent = 'No Skips Left';
    skipBtn.disabled = true;
  } else {
    skipBtn.textContent = `Skip (${remaining} left)`;
    skipBtn.disabled = false;
  }
}

function updateCurrentRoundWords() {
  currentRoundWords.innerHTML = '';
  
  currentRoundWordsList.forEach((item, index) => {
    const container = document.createElement('div');
    container.className = `current-word-item ${item.result}`;
    
    const wordSpan = document.createElement('span');
    wordSpan.className = 'word-text';
    wordSpan.textContent = item.word;
    container.appendChild(wordSpan);
    
    // Add undo button for correct words (host only, during active round)
    if (isHost && item.result === 'correct' && currentState?.gameState === 'roundActive') {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'undo-btn';
      undoBtn.textContent = '✕';
      undoBtn.title = 'Undo (actor broke rules)';
      undoBtn.addEventListener('click', () => {
        if (confirm(`Undo "${item.word}"? This will deduct 1 point.`)) {
          socket.emit('undo-correct', { wordIndex: index });
        }
      });
      container.appendChild(undoBtn);
    }
    
    currentRoundWords.appendChild(container);
  });
}

function updateRoundHistory(state) {
  if (!state.roundHistory || state.roundHistory.length === 0) {
    roundHistory.innerHTML = '<p class="no-history">No rounds played yet</p>';
    return;
  }
  
  roundHistory.innerHTML = '';
  
  // Show most recent first (but keep original indices for undo)
  const reversedHistory = [...state.roundHistory].reverse();
  reversedHistory.forEach((round, reversedIdx) => {
    // Calculate the original index
    const originalRoundIndex = state.roundHistory.length - 1 - reversedIdx;
    
    const item = document.createElement('div');
    item.className = 'history-item';
    
    const header = document.createElement('div');
    header.className = 'history-header';
    header.innerHTML = `
      <span class="history-actor team-${round.actorTeam.toLowerCase()}">${round.actor}</span>
      <span class="history-score">+${round.correct}</span>
    `;
    
    const words = document.createElement('div');
    words.className = 'history-words';
    round.words.forEach((w, wordIdx) => {
      const wordContainer = document.createElement('span');
      wordContainer.className = `history-word ${w.result}`;
      
      const wordText = document.createElement('span');
      wordText.textContent = w.word;
      wordContainer.appendChild(wordText);
      
      // Add undo button for correct words (host only)
      if (isHost && w.result === 'correct') {
        const undoBtn = document.createElement('button');
        undoBtn.className = 'history-undo-btn';
        undoBtn.textContent = '✕';
        undoBtn.title = 'Undo (actor broke rules)';
        undoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Undo "${w.word}"? This will deduct 1 point from Team ${round.actorTeam}.`)) {
            socket.emit('undo-history-word', { roundIndex: originalRoundIndex, wordIndex: wordIdx });
          }
        });
        wordContainer.appendChild(undoBtn);
      }
      
      words.appendChild(wordContainer);
    });
    
    item.appendChild(header);
    item.appendChild(words);
    roundHistory.appendChild(item);
  });
}

function updateGameUI(state) {
  currentState = state;
  isHost = state.hostId === playerId;
  
  // Update scores
  scoreA.textContent = state.scores.A;
  scoreB.textContent = state.scores.B;
  
  // Update timer display
  timerDisplay.textContent = state.roundTimeRemaining || '--';
  timerDisplay.classList.remove('warning', 'critical');
  if (state.gameState === 'roundActive') {
    if (state.roundTimeRemaining <= 5) {
      timerDisplay.classList.add('critical');
    } else if (state.roundTimeRemaining <= 15) {
      timerDisplay.classList.add('warning');
    }
  }
  
  // Update history
  updateRoundHistory(state);
  
  // Update cards remaining
  cardsRemaining.textContent = state.cardsRemaining;
  
  // Hide all game sections first
  roundSetup.classList.add('hidden');
  waitingSetup.classList.add('hidden');
  actorView.classList.add('hidden');
  guesserView.classList.add('hidden');
  endRoundBtn.classList.add('hidden');
  currentRoundSection.classList.add('hidden');
  
  // Show appropriate section based on game state
  if (state.gameState === 'roundSetup') {
    if (isHost) {
      roundSetup.classList.remove('hidden');
      updateActorSelect(state);
    } else {
      waitingSetup.classList.remove('hidden');
    }
  } else if (state.gameState === 'roundActive') {
    // Show current round section for everyone
    currentRoundSection.classList.remove('hidden');
    updateCurrentRoundWords();
    
    if (state.currentActorId === playerId) {
      actorView.classList.remove('hidden');
      if (state.currentWord) {
        currentWord.textContent = state.currentWord;
      }
    } else {
      guesserView.classList.remove('hidden');
      currentActorName.textContent = state.currentActorName || 'Someone';
    }
    if (isHost) {
      endRoundBtn.classList.remove('hidden');
    }
  }
  
  // Show host controls
  if (isHost) {
    hostGameControls.classList.remove('hidden');
  } else {
    hostGameControls.classList.add('hidden');
  }
}

function updateGameOverUI(state) {
  finalScoreA.textContent = state.scores.A;
  finalScoreB.textContent = state.scores.B;
  
  winnerAnnouncement.classList.remove('winner-a', 'winner-b', 'winner-tie');
  
  if (state.scores.A > state.scores.B) {
    winnerAnnouncement.textContent = 'Team A Wins!';
    winnerAnnouncement.classList.add('winner-a');
  } else if (state.scores.B > state.scores.A) {
    winnerAnnouncement.textContent = 'Team B Wins!';
    winnerAnnouncement.classList.add('winner-b');
  } else {
    winnerAnnouncement.textContent = "It's a Tie!";
    winnerAnnouncement.classList.add('winner-tie');
  }
  
  // Only host can play again
  if (state.hostId === playerId) {
    playAgainBtn.classList.remove('hidden');
  } else {
    playAgainBtn.classList.add('hidden');
  }
}

// Event Listeners - Landing Screen
createBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }
  
  playerName = name;
  localStorage.setItem('playerName', name);
  socket.emit('create-room', { playerId, playerName: name });
});

joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }
  if (!code || code.length !== 4) {
    showToast('Please enter a valid 4-letter room code', 'error');
    return;
  }
  
  playerName = name;
  localStorage.setItem('playerName', name);
  socket.emit('join-room', { roomCode: code, playerId, playerName: name });
});

// Event Listeners - Lobby
difficultyBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    difficultyBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDifficulty = btn.dataset.difficulty;
  });
});

languageBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    languageBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLanguage = btn.dataset.lang;
  });
});

skipLimitBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    skipLimitBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMaxSkips = parseInt(btn.dataset.skips);
    socket.emit('set-max-skips', { maxSkips: selectedMaxSkips });
  });
});

leaveRoomBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to leave the room?')) {
    socket.emit('leave-room');
    localStorage.removeItem('roomCode');
    roomCode = null;
    showScreen('landing');
    showToast('You left the room', 'info');
  }
});

leaveGameBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to leave the game?')) {
    socket.emit('leave-room');
    localStorage.removeItem('roomCode');
    roomCode = null;
    showScreen('landing');
    showToast('You left the game', 'info');
  }
});

transferHostBtn.addEventListener('click', () => {
  const newHostId = transferHostSelect.value;
  if (!newHostId) {
    showToast('Please select a player', 'error');
    return;
  }
  socket.emit('transfer-host', { newHostId });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start-game', { difficulty: selectedDifficulty, language: selectedLanguage });
});

// Event Listeners - Game
timerBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    timerBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTimer = parseInt(btn.dataset.time);
  });
});

startRoundBtn.addEventListener('click', () => {
  const actorId = actorSelect.value;
  if (!actorId) {
    showToast('Please select an actor', 'error');
    return;
  }
  socket.emit('start-round', { actorId, timerDuration: selectedTimer });
});

correctBtn.addEventListener('click', () => {
  socket.emit('mark-correct');
});

skipBtn.addEventListener('click', () => {
  socket.emit('mark-skip');
});

removeWordBtn.addEventListener('click', () => {
  // Pause timer while popup is shown
  socket.emit('pause-timer');
  
  if (confirm('Remove this word permanently? It won\'t appear in future games.')) {
    socket.emit('remove-word');
  }
  
  // Resume timer after popup
  socket.emit('resume-timer');
});

endRoundBtn.addEventListener('click', () => {
  socket.emit('end-round');
});

endGameBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to end the game?')) {
    socket.emit('end-game');
  }
});

// Event Listeners - Game Over
playAgainBtn.addEventListener('click', () => {
  socket.emit('reset-game');
});

backToLobbyBtn.addEventListener('click', () => {
  socket.emit('leave-room');
  localStorage.removeItem('roomCode');
  roomCode = null;
  showScreen('landing');
});

// Socket Event Handlers
socket.on('room-created', (data) => {
  roomCode = data.roomCode;
  localStorage.setItem('roomCode', roomCode);
  currentState = data.state;
  isHost = true;
  
  displayRoomCode.textContent = roomCode;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  hostLobbyControls.classList.remove('hidden');
  waitingMessage.classList.add('hidden');
  
  showScreen('lobby');
  showToast('Room created! Share the code with friends', 'success');
});

socket.on('room-joined', (data) => {
  roomCode = data.state.code;
  localStorage.setItem('roomCode', roomCode);
  currentState = data.state;
  isHost = data.state.hostId === playerId;
  
  displayRoomCode.textContent = roomCode;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  
  if (isHost) {
    hostLobbyControls.classList.remove('hidden');
    waitingMessage.classList.add('hidden');
  } else {
    hostLobbyControls.classList.add('hidden');
    waitingMessage.classList.remove('hidden');
  }
  
  showScreen('lobby');
  showToast(`Joined Team ${data.team}!`, 'success');
});

socket.on('player-joined', (data) => {
  currentState = data.state;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  updateActorSelect(data.state);
  showToast(`${data.playerName} joined Team ${data.team}`, 'info');
});

socket.on('player-left', (data) => {
  currentState = data.state;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  updateActorSelect(data.state);
  
  // Check if we became host
  if (data.state.hostId === playerId && !isHost) {
    isHost = true;
    if (currentState.gameState === 'lobby') {
      hostLobbyControls.classList.remove('hidden');
      waitingMessage.classList.add('hidden');
    }
    showToast('You are now the host', 'info');
  }
  
  showToast(`${data.playerName} left the game`, 'info');
});

socket.on('player-disconnected', (data) => {
  currentState = data.state;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  updateActorSelect(data.state);
  
  // Delay disconnect message by 10 seconds (in case they reconnect quickly)
  const timeout = setTimeout(() => {
    showToast(`${data.playerName} disconnected`, 'info');
    pendingDisconnectToasts.delete(data.playerId);
  }, 10000);
  pendingDisconnectToasts.set(data.playerId, timeout);
});

socket.on('player-reconnected', (data) => {
  currentState = data.state;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  updateActorSelect(data.state);
  
  // Cancel pending disconnect toast if they reconnected quickly
  const pendingTimeout = pendingDisconnectToasts.get(data.playerId);
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingDisconnectToasts.delete(data.playerId);
    // Don't show reconnected message if disconnect wasn't shown
  } else {
    showToast(`${data.playerName} reconnected`, 'success');
  }
});

socket.on('teams-updated', (data) => {
  currentState = data.state;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
});

socket.on('host-changed', (data) => {
  currentState = data.state;
  isHost = data.newHostId === playerId;
  updatePlayerLists(data.state);
  updateTransferHostSelect(data.state);
  
  if (isHost) {
    hostLobbyControls.classList.remove('hidden');
    waitingMessage.classList.add('hidden');
    showToast('You are now the host!', 'success');
  } else {
    hostLobbyControls.classList.add('hidden');
    waitingMessage.classList.remove('hidden');
    showToast(`${data.newHostName} is now the host`, 'info');
  }
});

socket.on('settings-updated', (data) => {
  currentState = data.state;
  showToast(`Max skips set to ${data.maxSkipsPerRound === 999 ? 'unlimited' : data.maxSkipsPerRound}`, 'info');
});

socket.on('skip-denied', (data) => {
  showToast(data.message, 'error');
  updateSkipButton(0, data.maxSkips);
});

socket.on('word-removed', (data) => {
  showToast(`"${data.word}" removed from deck`, 'info');
  
  // Update word for actor
  if (data.nextWord !== undefined) {
    if (data.nextWord === null) {
      currentWord.textContent = 'No more cards!';
      correctBtn.disabled = true;
      skipBtn.disabled = true;
      removeWordBtn.disabled = true;
    } else {
      currentWord.textContent = data.nextWord;
    }
  }
});

socket.on('reconnect-success', (data) => {
  roomCode = data.state.code;
  currentState = data.state;
  isHost = data.state.hostId === playerId;
  
  if (data.state.gameState === 'lobby') {
    displayRoomCode.textContent = roomCode;
    updatePlayerLists(data.state);
    updateTransferHostSelect(data.state);
    
    if (isHost) {
      hostLobbyControls.classList.remove('hidden');
      waitingMessage.classList.add('hidden');
    } else {
      hostLobbyControls.classList.add('hidden');
      waitingMessage.classList.remove('hidden');
    }
    
    showScreen('lobby');
  } else if (data.state.gameState === 'gameOver') {
    updateGameOverUI(data.state);
    showScreen('gameover');
  } else {
    updateGameUI(data.state);
    showScreen('game');
  }
  
  showToast('Reconnected!', 'success');
});

socket.on('reconnect-failed', (data) => {
  localStorage.removeItem('roomCode');
  roomCode = null;
  showScreen('landing');
});

socket.on('rejoin-failed', (data) => {
  // Silent failure - just clear storage
  localStorage.removeItem('roomCode');
  roomCode = null;
  hasAttemptedAutoRejoin = false;
  // Don't show error toast for silent failures
});

socket.on('game-started', (data) => {
  currentState = data.state;
  updateGameUI(data.state);
  showScreen('game');
  showToast('Game started!', 'success');
});

socket.on('round-started', (data) => {
  currentState = data.state;
  
  // Reset current round words
  currentRoundWordsList = [];
  
  // Reset skip button
  updateSkipButton(data.state.skipsRemaining, data.state.maxSkipsPerRound);
  
  updateGameUI(data.state);
  
  // Reset round correct count
  roundCorrect.textContent = '0';
  guesserRoundCorrect.textContent = '0';
  
  if (data.state.currentActorId === playerId) {
    showToast("You're acting! Go!", 'success');
  }
});

socket.on('word-result', (data) => {
  // Update scores
  scoreA.textContent = data.scores.A;
  scoreB.textContent = data.scores.B;
  
  // Update timer
  timerDisplay.textContent = data.timeRemaining;
  timerDisplay.classList.remove('warning', 'critical');
  if (data.timeRemaining <= 5) {
    timerDisplay.classList.add('critical');
  } else if (data.timeRemaining <= 15) {
    timerDisplay.classList.add('warning');
  }
  
  // Add word to current round list and update display
  currentRoundWordsList.push({ word: data.word, result: data.result });
  updateCurrentRoundWords();
  
  // Update skip button if skip was used
  if (data.skipsRemaining !== undefined) {
    updateSkipButton(data.skipsRemaining, currentState?.maxSkipsPerRound || 2);
  }
  
  // Count correct words this round
  const correctCount = currentRoundWordsList.filter(w => w.result === 'correct').length;
  roundCorrect.textContent = correctCount;
  guesserRoundCorrect.textContent = correctCount;
  
  // Update word for actor
  if (data.nextWord !== undefined) {
    if (data.nextWord === null) {
      currentWord.textContent = 'No more cards!';
      correctBtn.disabled = true;
      skipBtn.disabled = true;
    } else {
      currentWord.textContent = data.nextWord;
    }
  }
  
  if (data.result === 'correct') {
    showToast('Correct! +1 point', 'success');
  }
});

socket.on('word-undone', (data) => {
  // Update the word in our list
  if (data.wordIndex >= 0 && data.wordIndex < currentRoundWordsList.length) {
    currentRoundWordsList[data.wordIndex].result = 'cancelled';
  }
  updateCurrentRoundWords();
  
  // Update scores
  scoreA.textContent = data.scores.A;
  scoreB.textContent = data.scores.B;
  
  // Update correct count
  const correctCount = currentRoundWordsList.filter(w => w.result === 'correct').length;
  roundCorrect.textContent = correctCount;
  guesserRoundCorrect.textContent = correctCount;
  
  showToast(`"${data.word}" undone (-1 point)`, 'info');
});

socket.on('history-updated', (data) => {
  currentState = data.state;
  
  // Update scores
  scoreA.textContent = data.state.scores.A;
  scoreB.textContent = data.state.scores.B;
  
  // Update history
  updateRoundHistory(data.state);
  
  showToast('History updated', 'info');
});

socket.on('timer-sync', (data) => {
  timerDisplay.textContent = data.timeRemaining;
  if (data.paused) {
    timerDisplay.classList.add('paused');
  } else {
    timerDisplay.classList.remove('paused');
  }
});

socket.on('timer-paused', () => {
  timerDisplay.classList.add('paused');
});

socket.on('timer-resumed', (data) => {
  timerDisplay.classList.remove('paused');
  if (data.timeRemaining !== undefined) {
    timerDisplay.textContent = data.timeRemaining;
  }
});

socket.on('round-ended', (data) => {
  currentState = data.state;
  
  // Clear current round words (they're now in history)
  currentRoundWordsList = [];
  
  updateGameUI(data.state);
  
  // Re-enable buttons
  correctBtn.disabled = false;
  skipBtn.disabled = false;
  removeWordBtn.disabled = false;
  
  // Reset actor selection for next round
  actorSelect.value = '';
  
  showToast('Round ended!', 'info');
});

socket.on('game-over', (data) => {
  currentState = data.state;
  updateGameOverUI(data.state);
  showScreen('gameover');
});

socket.on('game-reset', (data) => {
  currentState = data.state;
  displayRoomCode.textContent = data.state.code;
  updatePlayerLists(data.state);
  
  if (data.state.hostId === playerId) {
    hostLobbyControls.classList.remove('hidden');
    waitingMessage.classList.add('hidden');
  } else {
    hostLobbyControls.classList.add('hidden');
    waitingMessage.classList.remove('hidden');
  }
  
  showScreen('lobby');
  showToast('Game reset - back to lobby', 'info');
});

socket.on('error', (data) => {
  showToast(data.message, 'error');
});

socket.on('room-closed', (data) => {
  localStorage.removeItem('roomCode');
  roomCode = null;
  showScreen('landing');
  showToast(data.message, 'error');
});

// Timer sync interval
setInterval(() => {
  if (currentState && currentState.gameState === 'roundActive') {
    socket.emit('sync-timer');
  }
}, 1000);

// Handle page visibility change for reconnection
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && roomCode) {
    socket.emit('reconnect-attempt', { playerId, roomCode });
  }
});

