'use strict';

// ============================================================
// Socket setup
// ============================================================
const basePath = window.location.pathname.includes('/why_are_you_like_this')
  ? '/why_are_you_like_this'
  : '';

const socket = io({
  path: basePath + '/socket.io',
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 60000,
  transports: ['websocket', 'polling'],
});

// ============================================================
// State
// ============================================================
let playerId = localStorage.getItem('playerId');
let roomCode = localStorage.getItem('roomCode');
let playerName = localStorage.getItem('playerName');
let isHost = false;
let currentState = null;

// UI selection state
let selectedDifficulty = 'easy';
let selectedTimer = 60;
let selectedLanguage = 'en';
let selectedMaxSkips = 2;
let currentRoundWordsList = [];
let skipsRemaining = 2;

// Timestamp-based timer (computed client-side)
let timerEndsAtLocal = null; // server's roundEndsAt, adjusted for clock skew
let timerIsPaused = false;
let pauseRemainingSec = 0;
let timerTick = null;

// Debounce disconnect toasts (suppress if they reconnect within 10 s)
const pendingDisconnectToasts = new Map();

// Generate stable player ID
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).substring(2, 15);
  localStorage.setItem('playerId', playerId);
}

// ============================================================
// DOM References
// ============================================================
const screens = {
  landing: document.getElementById('landing-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  gameover: document.getElementById('gameover-screen'),
};

// Landing
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');

// Lobby
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

// Game
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
const forceEndRoundBtn = document.getElementById('force-end-round-btn');
const endGameBtn = document.getElementById('end-game-btn');
const currentRoundSection = document.getElementById('current-round-section');
const currentRoundWordsEl = document.getElementById('current-round-words');

// Game Over
const finalScoreA = document.getElementById('final-score-a');
const finalScoreB = document.getElementById('final-score-b');
const winnerAnnouncement = document.getElementById('winner-announcement');
const playAgainBtn = document.getElementById('play-again-btn');
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');

// Toast
const toastContainer = document.getElementById('toast-container');

// Restore saved name
if (playerName) playerNameInput.value = playerName;

// ============================================================
// Utility
// ============================================================
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ============================================================
// Timer (timestamp-based, computed locally)
//
// The server sends roundEndsAt (absolute timestamp) and serverTime.
// We adjust for clock skew once and then count down locally.
// No polling, no sync events needed.
// ============================================================
function syncTimer(state) {
  if (!state) return;
  timerIsPaused = !!state.timerPaused;

  if (timerIsPaused) {
    timerEndsAtLocal = null;
    pauseRemainingSec = state.pauseRemainingMs
      ? Math.ceil(state.pauseRemainingMs / 1000)
      : 0;
  } else if (state.roundEndsAt && state.serverTime) {
    // Adjust server timestamp to local clock
    const offset = state.serverTime - Date.now();
    timerEndsAtLocal = state.roundEndsAt - offset;
    pauseRemainingSec = 0;
  } else {
    timerEndsAtLocal = null;
    pauseRemainingSec = state.timeRemaining || 0;
  }

  startTimerTick();
}

function startTimerTick() {
  if (timerTick) clearInterval(timerTick);
  renderTimer();
  timerTick = setInterval(renderTimer, 250); // 4 Hz is plenty
}

function stopTimerTick() {
  if (timerTick) { clearInterval(timerTick); timerTick = null; }
}

function renderTimer() {
  let remaining;
  if (timerIsPaused) {
    remaining = pauseRemainingSec;
  } else if (timerEndsAtLocal) {
    remaining = Math.max(0, Math.ceil((timerEndsAtLocal - Date.now()) / 1000));
  } else {
    remaining = 0;
  }

  const inRound = currentState?.gameState === 'roundActive';
  timerDisplay.textContent = inRound ? remaining : '--';
  timerDisplay.classList.remove('warning', 'critical', 'paused');

  if (timerIsPaused && inRound) {
    timerDisplay.classList.add('paused');
  } else if (remaining <= 5 && remaining > 0) {
    timerDisplay.classList.add('critical');
  } else if (remaining <= 15 && remaining > 0) {
    timerDisplay.classList.add('warning');
  }
}

// ============================================================
// UI Update Functions
// ============================================================
function updatePlayerLists(state) {
  teamAList.innerHTML = '';
  teamBList.innerHTML = '';
  const canDrag = state.hostId === playerId && state.gameState === 'lobby';
  dragHint.classList.toggle('hidden', !canDrag);

  state.players.forEach(player => {
    const li = document.createElement('li');
    li.className = 'player-item';
    li.dataset.playerId = player.id;
    if (player.id === playerId) li.classList.add('is-you');
    if (player.isHost) li.classList.add('is-host');
    if (!player.connected) li.classList.add('disconnected');

    if (canDrag) {
      li.classList.add('draggable');
      li.draggable = true;
      li.addEventListener('dragstart', handleDragStart);
      li.addEventListener('dragend', handleDragEnd);
    }

    let text = player.name;
    if (player.id === playerId) text += ' (you)';
    if (!player.connected) text += ' (offline)';
    li.textContent = text;
    (player.team === 'A' ? teamAList : teamBList).appendChild(li);
  });
}

// --- Drag & Drop ---
let draggedPlayerId = null;

function handleDragStart(e) {
  draggedPlayerId = e.target.dataset.playerId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedPlayerId = null;
  teamADrop.classList.remove('drag-over');
  teamBDrop.classList.remove('drag-over');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const newTeam = e.currentTarget.dataset.team;
  if (draggedPlayerId && newTeam) {
    socket.emit('move-player', { targetPlayerId: draggedPlayerId, newTeam });
  }
}

[teamADrop, teamBDrop].forEach(el => {
  el.addEventListener('dragover', handleDragOver);
  el.addEventListener('dragenter', handleDragEnter);
  el.addEventListener('dragleave', handleDragLeave);
  el.addEventListener('drop', handleDrop);
});

function updateActorSelect(state) {
  actorSelect.innerHTML = '<option value="">Select a player...</option>';
  if (!state?.players) return;
  state.players.forEach(p => {
    if (p.connected) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (Team ${p.team})`;
      actorSelect.appendChild(opt);
    }
  });
}

function updateTransferHostSelect(state) {
  if (!transferHostSelect) return;
  transferHostSelect.innerHTML = '<option value="">Select player...</option>';
  if (!state?.players) return;
  state.players.forEach(p => {
    if (p.id !== playerId && p.connected) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (Team ${p.team})`;
      transferHostSelect.appendChild(opt);
    }
  });
}

function updateSkipButton(remaining, max) {
  skipsRemaining = remaining;
  if (max >= 999) {
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
  currentRoundWordsEl.innerHTML = '';
  currentRoundWordsList.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = `current-word-item ${item.result}`;

    const span = document.createElement('span');
    span.className = 'word-text';
    span.textContent = item.word;
    div.appendChild(span);

    // Host can undo correct words during active round
    if (isHost && item.result === 'correct' && currentState?.gameState === 'roundActive') {
      const btn = document.createElement('button');
      btn.className = 'undo-btn';
      btn.textContent = '\u2715';
      btn.title = 'Undo (actor broke rules)';
      btn.addEventListener('click', () => {
        if (confirm(`Undo "${item.word}"? -1 point.`)) {
          socket.emit('undo-correct', { wordIndex: index });
        }
      });
      div.appendChild(btn);
    }

    currentRoundWordsEl.appendChild(div);
  });
}

function updateRoundHistory(state) {
  if (!state.roundHistory?.length) {
    roundHistory.innerHTML = '<p class="no-history">No rounds played yet</p>';
    return;
  }

  roundHistory.innerHTML = '';
  const reversed = [...state.roundHistory].reverse();

  reversed.forEach((round, revIdx) => {
    const origIdx = state.roundHistory.length - 1 - revIdx;

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

    round.words.forEach((w, wIdx) => {
      const wc = document.createElement('span');
      wc.className = `history-word ${w.result}`;

      const wt = document.createElement('span');
      wt.textContent = w.word;
      wc.appendChild(wt);

      if (isHost && w.result === 'correct') {
        const btn = document.createElement('button');
        btn.className = 'history-undo-btn';
        btn.textContent = '\u2715';
        btn.title = 'Undo';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Undo "${w.word}"? -1 from Team ${round.actorTeam}.`)) {
            socket.emit('undo-history-word', { roundIndex: origIdx, wordIndex: wIdx });
          }
        });
        wc.appendChild(btn);
      }

      words.appendChild(wc);
    });

    item.appendChild(header);
    item.appendChild(words);
    roundHistory.appendChild(item);
  });
}

function updateGameUI(state) {
  currentState = state;
  isHost = state.hostId === playerId;

  // Scores
  scoreA.textContent = state.scores.A;
  scoreB.textContent = state.scores.B;
  cardsRemaining.textContent = state.cardsRemaining;

  // Timer
  syncTimer(state);

  // History
  updateRoundHistory(state);

  // Hide all game sections
  [roundSetup, waitingSetup, actorView, guesserView,
   endRoundBtn, forceEndRoundBtn, currentRoundSection
  ].forEach(el => el.classList.add('hidden'));

  if (state.gameState === 'roundSetup') {
    if (isHost) {
      roundSetup.classList.remove('hidden');
      updateActorSelect(state);
    } else {
      waitingSetup.classList.remove('hidden');
    }
  } else if (state.gameState === 'roundActive') {
    currentRoundSection.classList.remove('hidden');
    updateCurrentRoundWords();

    if (state.currentActorId === playerId) {
      actorView.classList.remove('hidden');
      if (state.currentWord) currentWord.textContent = state.currentWord;
    } else {
      guesserView.classList.remove('hidden');
      currentActorName.textContent = state.currentActorName || 'Someone';
    }

    if (isHost) {
      endRoundBtn.classList.remove('hidden');
      forceEndRoundBtn.classList.remove('hidden');
    }
  }

  hostGameControls.classList.toggle('hidden', !isHost);
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

  playAgainBtn.classList.toggle('hidden', state.hostId !== playerId);
}

/**
 * Apply full server state — the single source of truth.
 * Routes to the correct screen and updates all UI.
 */
function applyFullState(state) {
  currentState = state;
  isHost = state.hostId === playerId;
  currentRoundWordsList = state.currentRoundWords || [];

  if (state.gameState === 'lobby') {
    displayRoomCode.textContent = state.code;
    updatePlayerLists(state);
    updateTransferHostSelect(state);
    hostLobbyControls.classList.toggle('hidden', !isHost);
    waitingMessage.classList.toggle('hidden', isHost);
    showScreen('lobby');
  } else if (state.gameState === 'gameOver') {
    updateGameOverUI(state);
    showScreen('gameover');
  } else {
    // roundSetup or roundActive
    if (state.skipsRemaining !== undefined) {
      updateSkipButton(state.skipsRemaining, state.maxSkipsPerRound || 2);
    }
    updateGameUI(state);
    showScreen('game');
  }
}

// ============================================================
// Event Listeners — Landing
// ============================================================
createBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) { showToast('Enter your name', 'error'); return; }
  playerName = name;
  localStorage.setItem('playerName', name);
  socket.emit('create-room', { playerId, playerName: name });
});

joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) { showToast('Enter your name', 'error'); return; }
  if (!code || code.length !== 4) { showToast('Enter a 4-letter room code', 'error'); return; }
  playerName = name;
  localStorage.setItem('playerName', name);
  socket.emit('join-room', { roomCode: code, playerId, playerName: name });
});

// Enter key shortcuts
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});
playerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (roomCodeInput.value.trim()) joinBtn.click();
    else createBtn.click();
  }
});

// ============================================================
// Event Listeners — Lobby
// ============================================================
difficultyBtns.forEach(btn => btn.addEventListener('click', () => {
  difficultyBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedDifficulty = btn.dataset.difficulty;
}));

languageBtns.forEach(btn => btn.addEventListener('click', () => {
  languageBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedLanguage = btn.dataset.lang;
}));

skipLimitBtns.forEach(btn => btn.addEventListener('click', () => {
  skipLimitBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedMaxSkips = parseInt(btn.dataset.skips);
  socket.emit('set-max-skips', { maxSkips: selectedMaxSkips });
}));

leaveRoomBtn.addEventListener('click', () => {
  if (confirm('Leave the room?')) {
    socket.emit('leave-room');
    localStorage.removeItem('roomCode');
    roomCode = null;
    showScreen('landing');
  }
});

leaveGameBtn.addEventListener('click', () => {
  if (confirm('Leave the game?')) {
    socket.emit('leave-room');
    localStorage.removeItem('roomCode');
    roomCode = null;
    showScreen('landing');
  }
});

transferHostBtn.addEventListener('click', () => {
  const id = transferHostSelect.value;
  if (!id) { showToast('Select a player', 'error'); return; }
  socket.emit('transfer-host', { newHostId: id });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start-game', { difficulty: selectedDifficulty, language: selectedLanguage });
});

// ============================================================
// Event Listeners — Game
// ============================================================
timerBtns.forEach(btn => btn.addEventListener('click', () => {
  timerBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTimer = parseInt(btn.dataset.time);
}));

startRoundBtn.addEventListener('click', () => {
  const actorId = actorSelect.value;
  if (!actorId) { showToast('Select an actor', 'error'); return; }
  socket.emit('start-round', { actorId, timerDuration: selectedTimer });
});

correctBtn.addEventListener('click', () => socket.emit('mark-correct'));
skipBtn.addEventListener('click', () => socket.emit('mark-skip'));

removeWordBtn.addEventListener('click', () => {
  socket.emit('pause-timer');
  if (confirm("Remove this word permanently? It won't appear in future games.")) {
    socket.emit('remove-word');
  }
  socket.emit('resume-timer');
});

endRoundBtn.addEventListener('click', () => socket.emit('end-round'));

forceEndRoundBtn.addEventListener('click', () => {
  if (confirm('Force end the round? Use if the game is stuck.')) {
    socket.emit('force-end-round');
  }
});

endGameBtn.addEventListener('click', () => {
  if (confirm('End the game?')) socket.emit('end-game');
});

// ============================================================
// Event Listeners — Game Over
// ============================================================
playAgainBtn.addEventListener('click', () => socket.emit('reset-game'));

backToLobbyBtn.addEventListener('click', () => {
  socket.emit('leave-room');
  localStorage.removeItem('roomCode');
  roomCode = null;
  showScreen('landing');
});

// ============================================================
// Socket Events — Connection
// ============================================================
socket.on('connect', () => {
  console.log('[ws] Connected:', socket.id);

  // Single reconnection path: if we have a stored session, try to rejoin
  const pid = localStorage.getItem('playerId');
  const rc = localStorage.getItem('roomCode');
  const pn = localStorage.getItem('playerName');

  if (pid && rc && pn) {
    console.log('[ws] Attempting rejoin to', rc);
    socket.emit('rejoin', { playerId: pid, roomCode: rc, playerName: pn });
  }
});

socket.on('disconnect', (reason) => {
  console.log('[ws] Disconnected:', reason);
  // Only show toast for unexpected disconnects
  if (reason !== 'io client disconnect') {
    showToast('Connection lost, reconnecting...', 'info');
  }
});

socket.on('connect_error', (err) => {
  console.log('[ws] Connection error:', err.message);
});

// ============================================================
// Socket Events — Room
// ============================================================
socket.on('room-created', (data) => {
  roomCode = data.roomCode;
  localStorage.setItem('roomCode', roomCode);
  applyFullState(data.state);
  showToast('Room created! Share the code', 'success');
});

socket.on('room-joined', (data) => {
  roomCode = data.state.code;
  localStorage.setItem('roomCode', roomCode);
  applyFullState(data.state);
  showToast(`Joined Team ${data.team}!`, 'success');
});

socket.on('reconnected', (data) => {
  roomCode = data.state.code;
  localStorage.setItem('roomCode', roomCode);
  applyFullState(data.state);
  showToast('Reconnected!', 'success');
});

socket.on('rejoin-failed', () => {
  localStorage.removeItem('roomCode');
  roomCode = null;
  // Silent — just go to landing
  showScreen('landing');
});

// General state sync — the server sends this after most mutations
socket.on('state-sync', (data) => {
  if (!data.state) return;
  currentState = data.state;
  isHost = data.state.hostId === playerId;
  currentRoundWordsList = data.state.currentRoundWords || [];

  if (data.state.gameState === 'lobby') {
    displayRoomCode.textContent = data.state.code;
    updatePlayerLists(data.state);
    updateTransferHostSelect(data.state);
    hostLobbyControls.classList.toggle('hidden', !isHost);
    waitingMessage.classList.toggle('hidden', isHost);
  } else if (data.state.gameState === 'gameOver') {
    updateGameOverUI(data.state);
  } else {
    updateGameUI(data.state);
  }
});

// ============================================================
// Socket Events — Player notifications
// ============================================================
socket.on('player-joined', (data) => {
  showToast(`${data.playerName} joined Team ${data.team}`, 'info');
});

socket.on('player-left', (data) => {
  if (currentState?.hostId === playerId && !isHost) {
    isHost = true;
    showToast('You are now the host', 'info');
  }
  showToast(`${data.playerName} left`, 'info');
});

socket.on('player-disconnected', (data) => {
  // Delay toast — they often reconnect within seconds
  const timeout = setTimeout(() => {
    showToast(`${data.playerName} disconnected`, 'info');
    pendingDisconnectToasts.delete(data.playerId);
  }, 10000);
  pendingDisconnectToasts.set(data.playerId, timeout);
});

socket.on('player-reconnected', (data) => {
  const pending = pendingDisconnectToasts.get(data.playerId);
  if (pending) {
    clearTimeout(pending);
    pendingDisconnectToasts.delete(data.playerId);
    // Don't show "reconnected" if we never showed "disconnected"
  } else {
    showToast(`${data.playerName} reconnected`, 'success');
  }
});

// ============================================================
// Socket Events — Game flow
// ============================================================
socket.on('game-started', (data) => {
  applyFullState(data.state);
  showToast('Game started!', 'success');
});

socket.on('round-started', (data) => {
  currentState = data.state;
  currentRoundWordsList = data.state.currentRoundWords || [];
  updateSkipButton(data.state.skipsRemaining, data.state.maxSkipsPerRound);
  updateGameUI(data.state);
  updateCurrentRoundWords();

  const count = currentRoundWordsList.filter(w => w.result === 'correct').length;
  roundCorrect.textContent = count;
  guesserRoundCorrect.textContent = count;

  if (data.state.currentActorId === playerId) {
    showToast("You're acting! Go!", 'success');
  }
  showScreen('game');
});

socket.on('word-result', (data) => {
  // Scores
  scoreA.textContent = data.scores.A;
  scoreB.textContent = data.scores.B;

  // Track word locally
  currentRoundWordsList.push({ word: data.word, result: data.result });
  updateCurrentRoundWords();

  // Skip button
  if (data.skipsRemaining !== undefined) {
    updateSkipButton(data.skipsRemaining, currentState?.maxSkipsPerRound || 2);
  }

  // Correct count
  const count = currentRoundWordsList.filter(w => w.result === 'correct').length;
  roundCorrect.textContent = count;
  guesserRoundCorrect.textContent = count;

  // Next word (actor only)
  if (data.nextWord !== undefined) {
    if (data.nextWord === null) {
      currentWord.textContent = 'No more cards!';
      correctBtn.disabled = true;
      skipBtn.disabled = true;
    } else {
      currentWord.textContent = data.nextWord;
    }
  }

  if (data.result === 'correct') showToast('Correct! +1', 'success');
});

socket.on('word-undone', (data) => {
  if (data.wordIndex >= 0 && data.wordIndex < currentRoundWordsList.length) {
    currentRoundWordsList[data.wordIndex].result = 'cancelled';
  }
  updateCurrentRoundWords();
  scoreA.textContent = data.scores.A;
  scoreB.textContent = data.scores.B;

  const count = currentRoundWordsList.filter(w => w.result === 'correct').length;
  roundCorrect.textContent = count;
  guesserRoundCorrect.textContent = count;
  showToast(`"${data.word}" undone (-1)`, 'info');
});

socket.on('word-removed', (data) => {
  showToast(`"${data.word}" removed`, 'info');
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

socket.on('skip-denied', (data) => {
  showToast(data.message, 'error');
  updateSkipButton(0, data.maxSkips);
});

socket.on('timer-paused', (data) => {
  timerIsPaused = true;
  pauseRemainingSec = data.timeRemaining || 0;
  timerEndsAtLocal = null;
  renderTimer();
});

socket.on('timer-resumed', (data) => {
  timerIsPaused = false;
  if (data.roundEndsAt && data.serverTime) {
    const offset = data.serverTime - Date.now();
    timerEndsAtLocal = data.roundEndsAt - offset;
  }
  startTimerTick();
});

socket.on('round-ended', (data) => {
  currentRoundWordsList = [];
  stopTimerTick();
  applyFullState(data.state);
  // Re-enable buttons
  correctBtn.disabled = false;
  skipBtn.disabled = false;
  removeWordBtn.disabled = false;
  actorSelect.value = '';
  showToast('Round ended!', 'info');
});

socket.on('game-over', (data) => {
  stopTimerTick();
  applyFullState(data.state);
});

socket.on('game-reset', (data) => {
  stopTimerTick();
  applyFullState(data.state);
  showToast('Back to lobby', 'info');
});

socket.on('room-closed', (data) => {
  stopTimerTick();
  localStorage.removeItem('roomCode');
  roomCode = null;
  showScreen('landing');
  showToast(data.message, 'error');
});

socket.on('error', (data) => showToast(data.message, 'error'));

// ============================================================
// Heartbeat (keeps connection alive through Cloudflare / proxies)
// ============================================================
setInterval(() => {
  if (socket.connected && roomCode) socket.emit('heartbeat');
}, 30000);

// ============================================================
// Visibility change — reconnect when tab becomes visible
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && roomCode) {
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit('heartbeat');
    }
  }
});
