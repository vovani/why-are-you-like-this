'use strict';

// ============================================================
// Identity & session
//
// Each tab gets its own secret token (sessionStorage), so two tabs = two
// players and a reload keeps your seat. The last session is also mirrored to
// localStorage so a phone that dropped the tab can rejoin with one tap.
// ============================================================
const SS = safeStorage(() => window.sessionStorage);
const LS = safeStorage(() => window.localStorage);

function safeStorage(get) {
  try {
    const s = get();
    const k = '__t';
    s.setItem(k, '1'); s.removeItem(k);
    return s;
  } catch {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
}

function randomToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

let token = SS.getItem('wayl.token');
if (!token) { token = randomToken(); SS.setItem('wayl.token', token); }
let roomCode = SS.getItem('wayl.room');
let state = null;

function saveSession(code) {
  roomCode = code;
  if (code) {
    SS.setItem('wayl.room', code);
    LS.setItem('wayl.last', JSON.stringify({ code, token, name: playerNameInput.value.trim(), at: Date.now() }));
  } else {
    SS.removeItem('wayl.room');
    try {
      const last = JSON.parse(LS.getItem('wayl.last') || 'null');
      if (last && last.token === token) LS.removeItem('wayl.last');
    } catch { LS.removeItem('wayl.last'); }
  }
}

// ============================================================
// Connection: one WebSocket per room, to that room's Durable Object.
// Works at "/" or under any sub-path (e.g. /why_are_you_like_this/).
// ============================================================
const basePath = window.location.pathname.replace(/[^/]*$/, '');

class Conn {
  constructor() {
    this.ws = null;
    this.code = null;
    this.joinName = null;   // set only while joining a room for the first time
    this.wanted = false;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = {};
    this.retries = 0;
    this.lastPong = 0;
    this.pinger = null;
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data) { this.handlers[type]?.(data); }
  get open() { return this.ws?.readyState === WebSocket.OPEN; }

  connect(code, joinName = null) {
    this.disconnect();
    this.code = code;
    this.joinName = joinName;
    this.wanted = true;
    this._dial();
  }

  disconnect() {
    this.wanted = false;
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pinger);
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch { /* ignore */ } }
    this._failPending('closed');
  }

  _dial() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${basePath}ws?room=${encodeURIComponent(this.code)}`);
    this.ws = ws;
    ws.onopen = async () => {
      this.lastPong = Date.now();
      clearInterval(this.pinger);
      // "ping" is answered by Cloudflare without waking the room; a silent
      // socket (phone changed network) is dropped and redialed.
      this.pinger = setInterval(() => {
        if (Date.now() - this.lastPong > 35000) { try { ws.close(); } catch { /* ignore */ } return; }
        try { ws.send('ping'); } catch { /* ignore */ }
      }, 15000);
      const res = await this.call('hello', { token, name: this.joinName || undefined });
      if (res.ok) { this.retries = 0; this.joinName = null; }
      this._emit('hello', res);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') { this.lastPong = Date.now(); return; }
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.lastPong = Date.now();
      if (msg.t === 'ack') {
        const cb = this.pending.get(msg.id);
        if (cb) { this.pending.delete(msg.id); cb(msg); }
        return;
      }
      if (msg.t === 'bye') this.wanted = false;
      this._emit(msg.t, msg);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      this._failPending('closed');
      if (this.ws !== ws) return;
      this._emit('down');
      if (!this.wanted) return;
      const delay = Math.min(4000, 300 * 2 ** this.retries++) + Math.random() * 300;
      setTimeout(() => { if (this.wanted && this.ws === ws) this._dial(); }, delay);
    };
  }

  /** Redial right away (tab became visible again). */
  poke() {
    if (this.wanted && (!this.ws || this.ws.readyState > WebSocket.OPEN)) { this.retries = 0; this._dial(); }
  }

  _failPending(error) {
    for (const cb of this.pending.values()) cb({ ok: false, error });
    this.pending.clear();
  }

  call(ev, p = {}) {
    return new Promise((resolve) => {
      if (!this.open) return resolve({ ok: false, error: 'offline' });
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, 8000);
      this.pending.set(id, (res) => { clearTimeout(timer); resolve(res); });
      this.ws.send(JSON.stringify({ id, ev, p }));
    });
  }
}

const conn = new Conn();

async function send(event, payload = {}) {
  const res = await conn.call(event, payload);
  if (!res.ok) {
    if (res.error === 'offline' || res.error === 'closed') toast('Not connected — retrying…', 'error');
    else if (res.error === 'timeout') toast('Server did not answer, try again', 'error');
    else toast(res.error, 'error');
  }
  return res;
}

async function api(path, body) {
  try {
    const res = await fetch(basePath + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, error: 'Network error, try again' };
  }
}

// ============================================================
// DOM
// ============================================================
const $ = (id) => document.getElementById(id);
const screens = { landing: $('landing-screen'), lobby: $('lobby-screen'), game: $('game-screen'), gameover: $('gameover-screen') };

const connBanner = $('conn-banner');
const playerNameInput = $('player-name');
const roomCodeInput = $('room-code');
const resumeBox = $('resume-box');
const resumeLabel = $('resume-label');

const teamLists = { A: $('team-a-list'), B: $('team-b-list') };
const teamDrops = [$('team-a-drop'), $('team-b-drop')];
const transferHostSelect = $('transfer-host-select');
const actorSelect = $('actor-select');
const timerDisplay = $('timer');
const currentWordEl = $('current-word');
const correctBtn = $('correct-btn');
const skipBtn = $('skip-btn');
const removeWordBtn = $('remove-word-btn');
const pauseBtn = $('pause-btn');
const hostPauseBtn = $('host-pause-btn');

const show = (el, on) => el.classList.toggle('hidden', !on);

function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('active', k === name);
}

function toast(msg, type = 'info') {
  if (!msg) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Restore name / invite code
playerNameInput.value = LS.getItem('wayl.name') || '';
const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) roomCodeInput.value = inviteCode.toUpperCase().slice(0, 4);

function renderResume() {
  let last = null;
  try { last = JSON.parse(LS.getItem('wayl.last') || 'null'); } catch { /* ignore */ }
  const fresh = last && Date.now() - last.at < 6 * 60 * 60 * 1000;
  const offer = fresh && !roomCode && last.token !== token;
  show(resumeBox, !!offer);
  if (offer) resumeLabel.textContent = `Rejoin ${last.code}${last.name ? ' as ' + last.name : ''}`;
  return offer ? last : null;
}

// ============================================================
// Timer (server sends absolute endsAt + its clock; we correct for skew)
// ============================================================
let clockOffset = 0; // serverTime - localTime
let lastTimerSecond = null;

function remainingMs() {
  const r = state?.round;
  if (!r) return 0;
  if (r.paused) return r.remainingMs;
  return Math.max(0, r.endsAt - (Date.now() + clockOffset));
}

function renderTimer() {
  const r = state?.round;
  timerDisplay.classList.remove('warning', 'critical', 'paused');
  if (!r || state.gameState !== 'roundActive') {
    timerDisplay.textContent = '--';
    lastTimerSecond = null;
    return;
  }
  const secs = Math.ceil(remainingMs() / 1000);
  timerDisplay.textContent = secs;
  if (r.paused) timerDisplay.classList.add('paused');
  else if (secs <= 5) timerDisplay.classList.add('critical');
  else if (secs <= 15) timerDisplay.classList.add('warning');
  if (secs !== lastTimerSecond && secs <= 3 && secs > 0 && !r.paused && navigator.vibrate) navigator.vibrate(60);
  lastTimerSecond = secs;
}
setInterval(renderTimer, 200);

// ============================================================
// Rendering — everything derives from the latest server state
// ============================================================
const isHost = () => state && state.hostId === state.you;
const me = () => state?.players.find(p => p.id === state.you);

function render() {
  if (!state) { showScreen('landing'); renderResume(); return; }
  if (state.gameState === 'lobby') { renderLobby(); showScreen('lobby'); }
  else if (state.gameState === 'gameOver') { renderGameOver(); showScreen('gameover'); }
  else { renderGame(); showScreen('game'); }
  renderTimer();
}

function setActive(buttons, attr, value) {
  buttons.forEach(b => b.classList.toggle('active', b.dataset[attr] === String(value)));
}

function renderLobby() {
  const host = isHost();
  $('display-room-code').textContent = state.code;
  renderTeams(host);
  show($('drag-hint'), host);
  show($('host-lobby-controls'), host);
  show($('waiting-message'), !host);

  const s = state.settings;
  setActive(document.querySelectorAll('.lang-btn'), 'lang', s.language);
  setActive(document.querySelectorAll('.diff-btn'), 'difficulty', s.difficulty);
  setActive(document.querySelectorAll('.skip-limit-btn'), 'skips', s.maxSkips);

  const hostPlayer = state.players.find(p => p.isHost);
  $('host-name').textContent = hostPlayer ? hostPlayer.name : 'host';
  const langName = s.language === 'he' ? 'עברית' : 'English';
  $('settings-summary').textContent =
    `${langName} · ${s.difficulty} · ${s.maxSkips >= 999 ? 'unlimited' : s.maxSkips} skips`;

  transferHostSelect.replaceChildren(new Option('Select player...', ''));
  state.players.filter(p => p.id !== state.you && p.connected)
    .forEach(p => transferHostSelect.appendChild(new Option(`${p.name} (Team ${p.team})`, p.id)));

  const enough = state.players.length >= 2;
  $('start-game-btn').disabled = !enough;
  $('start-game-btn').textContent = enough ? 'Start Game' : 'Need 2+ players';
}

function renderTeams(host) {
  teamLists.A.replaceChildren();
  teamLists.B.replaceChildren();
  for (const p of state.players) {
    const li = el('li', 'player-item');
    li.dataset.playerId = p.id;
    if (p.id === state.you) li.classList.add('is-you');
    if (p.isHost) li.classList.add('is-host');
    if (!p.connected) li.classList.add('disconnected');
    let label = p.name;
    if (p.id === state.you) label += ' (you)';
    if (!p.connected) label += ' (offline)';
    li.appendChild(el('span', 'player-name', label));
    if (host) {
      li.draggable = true;
      li.classList.add('draggable');
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      const sw = el('button', 'mini-btn', '⇄');
      sw.title = 'Switch team';
      sw.addEventListener('click', () => send('move-player', { playerId: p.id, team: p.team === 'A' ? 'B' : 'A' }));
      li.appendChild(sw);
      if (p.id !== state.you) {
        const kick = el('button', 'mini-btn danger', '✕');
        kick.title = 'Remove from room';
        kick.addEventListener('click', () => {
          if (confirm(`Remove ${p.name} from the room?`)) send('kick-player', { playerId: p.id });
        });
        li.appendChild(kick);
      }
    }
    teamLists[p.team].appendChild(li);
  }
}

teamDrops.forEach(zone => {
  zone.addEventListener('dragover', (e) => { if (isHost()) { e.preventDefault(); zone.classList.add('drag-over'); } });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    if (id) send('move-player', { playerId: id, team: zone.dataset.team });
  });
});

function renderRoster() {
  const wrap = $('game-teams');
  wrap.replaceChildren();
  for (const team of ['A', 'B']) {
    const line = el('div', `roster roster-${team.toLowerCase()}`);
    state.players.filter(p => p.team === team).forEach(p => {
      const chip = el('span', 'roster-chip' + (p.connected ? '' : ' offline') + (p.id === state.you ? ' you' : ''), p.name);
      if (p.isHost) chip.title = 'Host';
      line.appendChild(chip);
    });
    wrap.appendChild(line);
  }
}

function renderGame() {
  const host = isHost();
  const r = state.round;
  const active = state.gameState === 'roundActive' && r;
  const acting = active && r.actorId === state.you;

  $('score-a').textContent = state.scores.A;
  $('score-b').textContent = state.scores.B;
  $('cards-remaining').textContent = state.cardsRemaining;
  renderRoster();

  show($('round-setup'), state.gameState === 'roundSetup' && host);
  show($('waiting-setup'), state.gameState === 'roundSetup' && !host);
  show($('actor-view'), !!acting);
  show($('guesser-view'), !!active && !acting);
  show($('current-round-section'), !!active);
  show($('host-game-controls'), host);
  show($('end-round-btn'), host && !!active);
  show($('host-pause-btn'), host && !!active && !acting);

  if (state.gameState === 'roundSetup') {
    const hostP = state.players.find(p => p.isHost);
    $('waiting-setup-text').textContent = `Waiting for ${hostP ? hostP.name : 'the host'} to start the next round...`;
    if (host) renderRoundSetup();
  }

  // Pause banner
  const banner = $('paused-banner');
  if (active && r.paused) {
    banner.textContent = r.autoPaused ? `⏸ Paused — waiting for ${r.actorName} to reconnect` : '⏸ Paused';
    show(banner, true);
  } else show(banner, false);

  if (active) {
    const correct = r.words.filter(w => w.result === 'correct').length;
    $('round-correct').textContent = correct;
    $('guesser-round-correct').textContent = correct;
    $('current-actor-name').textContent = r.actorName;
    const myTeam = me()?.team;
    $('guess-hint').textContent = myTeam === r.actorTeam
      ? 'Your team is up — shout your guesses!'
      : `Team ${r.actorTeam} is guessing. Keep them honest!`;
    renderCurrentRoundWords(host, r);
    hostPauseBtn.textContent = r.paused ? 'Resume' : 'Pause';
  }

  if (acting) {
    const hasWord = !!r.word;
    currentWordEl.textContent = hasWord ? r.word : 'No more cards!';
    currentWordEl.classList.toggle('paused-word', r.paused);
    if (r.paused && hasWord) currentWordEl.textContent = '⏸';
    pending = false;
    correctBtn.disabled = !hasWord || r.paused;
    removeWordBtn.disabled = !hasWord || r.paused;
    pauseBtn.textContent = r.paused ? 'Resume' : 'Pause';
    if (r.skipsRemaining === null) { skipBtn.textContent = 'Skip'; skipBtn.disabled = !hasWord || r.paused; }
    else if (r.skipsRemaining <= 0) { skipBtn.textContent = 'No Skips Left'; skipBtn.disabled = true; }
    else { skipBtn.textContent = `Skip (${r.skipsRemaining} left)`; skipBtn.disabled = !hasWord || r.paused; }
  }

  renderHistory(host);
}

let selectedSeconds = null;
let lastSuggested = null;
function renderRoundSetup() {
  const prev = actorSelect.value;
  actorSelect.replaceChildren(new Option('Select a player...', ''));
  for (const p of state.players) {
    if (!p.connected) continue;
    actorSelect.appendChild(new Option(`${p.name} (Team ${p.team})${p.id === state.suggestedActorId ? ' ← next' : ''}`, p.id));
  }
  // Keep the host's manual pick; otherwise pre-select the suggestion.
  const stillThere = [...actorSelect.options].some(o => o.value === prev && prev);
  if (stillThere && prev !== lastSuggested) actorSelect.value = prev;
  else if (state.suggestedActorId) actorSelect.value = state.suggestedActorId;
  lastSuggested = state.suggestedActorId;
  if (selectedSeconds === null) selectedSeconds = state.settings.roundSeconds;
  setActive(document.querySelectorAll('.timer-btn'), 'time', selectedSeconds);
}

/** Host-only: flip a word between counted and not counted. */
function fixButton(item, roundIndex, wordIndex) {
  const counted = item.result === 'correct';
  const b = el('button', `fix-btn ${counted ? 'remove' : 'add'}`, counted ? '✕' : '✓');
  b.title = counted ? 'Not counted (−1)' : 'Count it (+1)';
  b.setAttribute('aria-label', `${b.title}: ${item.word}`);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const q = counted
      ? `Don't count "${item.word}"? −1 for Team ${item.team}.`
      : `Count "${item.word}" as correct? +1 for Team ${item.team}.`;
    if (confirm(q)) send('mark-word', { roundIndex, wordIndex, correct: !counted });
  });
  return b;
}

function renderCurrentRoundWords(host, r) {
  const wrap = $('current-round-words');
  wrap.replaceChildren();
  r.words.forEach((item, i) => {
    const div = el('div', `current-word-item ${item.result}`);
    const span = el('span', 'word-text', item.word);
    span.dir = 'auto';
    div.appendChild(span);
    if (host) div.appendChild(fixButton(item, -1, i));
    wrap.appendChild(div);
  });
}

function renderHistory(host) {
  const wrap = $('round-history');
  wrap.replaceChildren();
  if (!state.history.length) { wrap.appendChild(el('p', 'no-history', 'No rounds played yet')); return; }
  for (let ri = state.history.length - 1; ri >= 0; ri--) {
    const round = state.history[ri];
    const item = el('div', 'history-item');
    const header = el('div', 'history-header');
    const actor = el('span', `history-actor team-${round.actorTeam.toLowerCase()}`, round.actor);
    actor.dir = 'auto';
    header.append(actor, el('span', 'history-score', `+${round.correct}`));
    const words = el('div', 'history-words');
    round.words.forEach((w, wi) => {
      const chip = el('span', `history-word ${w.result}`);
      const t = el('span', null, w.word);
      t.dir = 'auto';
      chip.appendChild(t);
      if (host) chip.appendChild(fixButton({ ...w, team: w.team || round.actorTeam }, ri, wi));
      words.appendChild(chip);
    });
    item.append(header, words);
    wrap.appendChild(item);
  }
}

function renderGameOver() {
  const { A, B } = state.scores;
  $('final-score-a').textContent = A;
  $('final-score-b').textContent = B;
  const w = $('winner-announcement');
  w.classList.remove('winner-a', 'winner-b', 'winner-tie');
  if (A > B) { w.textContent = 'Team A Wins!'; w.classList.add('winner-a'); }
  else if (B > A) { w.textContent = 'Team B Wins!'; w.classList.add('winner-b'); }
  else { w.textContent = "It's a Tie!"; w.classList.add('winner-tie'); }
  show($('play-again-btn'), isHost());
  show($('play-again-wait'), !isHost());
}

// ============================================================
// Landing actions
// ============================================================
function nameOrComplain() {
  const name = playerNameInput.value.trim();
  if (!name) { toast('Enter your name', 'error'); playerNameInput.focus(); return null; }
  LS.setItem('wayl.name', name);
  return name;
}

let busy = false;
async function enterRoom(code, joinName) {
  conn.connect(code, joinName);
  const res = await new Promise((resolve) => {
    conn.on('hello', resolve);
    conn.on('bye', (m) => resolve({ ok: false, error: m.message }));
    setTimeout(() => resolve({ ok: false, error: 'Could not reach the game, try again' }), 10000);
  });
  wireConn();
  if (res.ok && res.member) { saveSession(code); return true; }
  conn.disconnect();
  toast(res.ok ? 'Room not found' : res.error, 'error');
  return false;
}

$('create-btn').addEventListener('click', async () => {
  const name = nameOrComplain();
  if (!name || busy) return;
  busy = true;
  const res = await api('api/rooms', { token, name });
  if (!res.ok) toast(res.error, 'error');
  else if (await enterRoom(res.code)) toast('Room created! Share the code', 'success');
  busy = false;
});

$('join-btn').addEventListener('click', async () => {
  const name = nameOrComplain();
  if (!name || busy) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { toast('Enter the 4-letter room code', 'error'); return; }
  busy = true;
  await enterRoom(code, name);
  busy = false;
});

$('resume-btn').addEventListener('click', () => {
  const last = renderResume();
  if (!last) return;
  token = last.token;
  SS.setItem('wayl.token', token);
  if (last.name) playerNameInput.value = last.name;
  enterRoom(last.code);
});

roomCodeInput.addEventListener('input', () => { roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); });
roomCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });
playerNameInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (roomCodeInput.value.trim()) $('join-btn').click(); else $('create-btn').click();
});

// ============================================================
// Lobby actions
// ============================================================
document.querySelectorAll('.lang-btn').forEach(b => b.addEventListener('click', () => send('update-settings', { language: b.dataset.lang })));
document.querySelectorAll('.diff-btn').forEach(b => b.addEventListener('click', () => send('update-settings', { difficulty: b.dataset.difficulty })));
document.querySelectorAll('.skip-limit-btn').forEach(b => b.addEventListener('click', () => send('update-settings', { maxSkips: Number(b.dataset.skips) })));

$('transfer-host-btn').addEventListener('click', () => {
  const id = transferHostSelect.value;
  if (!id) { toast('Select a player', 'error'); return; }
  send('transfer-host', { playerId: id });
});

$('start-game-btn').addEventListener('click', () => send('start-game'));

$('invite-btn').addEventListener('click', async () => {
  const url = `${location.origin}${basePath}?room=${state.code}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Why Are You Like This?', url });
    else { await navigator.clipboard.writeText(url); toast('Invite link copied', 'success'); }
  } catch { /* user cancelled */ }
});

function leave() {
  conn.call('leave-room').finally(() => conn.disconnect());
  saveSession(null);
  state = null;
  render();
}
$('leave-room-btn').addEventListener('click', () => { if (confirm('Leave the room?')) leave(); });
$('leave-game-btn').addEventListener('click', () => { if (confirm('Leave the game?')) leave(); });
$('back-to-lobby-btn').addEventListener('click', leave);

// ============================================================
// Game actions
// ============================================================
document.querySelectorAll('.timer-btn').forEach(b => b.addEventListener('click', () => {
  selectedSeconds = Number(b.dataset.time);
  setActive(document.querySelectorAll('.timer-btn'), 'time', selectedSeconds);
}));

$('start-round-btn').addEventListener('click', () => {
  const actorId = actorSelect.value;
  if (!actorId) { toast('Select an actor', 'error'); return; }
  send('start-round', { actorId, seconds: selectedSeconds || state.settings.roundSeconds });
});

// One tap = one card. Buttons lock until the next state arrives, and the
// server ignores taps for a card that has already changed (seq mismatch).
let pending = false;
function cardAction(event) {
  if (pending || !state?.round) return;
  pending = true;
  correctBtn.disabled = skipBtn.disabled = removeWordBtn.disabled = true;
  send(event, { seq: state.round.cardSeq }).then((res) => {
    if (!res.ok) { pending = false; render(); }
  });
}
correctBtn.addEventListener('click', () => cardAction('correct'));
skipBtn.addEventListener('click', () => cardAction('skip'));

removeWordBtn.addEventListener('click', async () => {
  if (!state?.round) return;
  const seq = state.round.cardSeq;
  const wasPaused = state.round.paused;
  if (!wasPaused) await send('pause');
  const ok = confirm("Remove this word permanently? It won't appear in future games.");
  if (ok) await send('remove-word', { seq });
  if (!wasPaused) send('resume');
});

pauseBtn.addEventListener('click', () => send(state?.round?.paused ? 'resume' : 'pause'));
hostPauseBtn.addEventListener('click', () => send(state?.round?.paused ? 'resume' : 'pause'));
$('end-round-btn').addEventListener('click', () => { if (confirm('End this round now?')) send('end-round'); });
$('end-game-btn').addEventListener('click', () => { if (confirm('End the game for everyone?')) send('end-game'); });
$('play-again-btn').addEventListener('click', () => send('reset-game'));

// ============================================================
// Socket events
// ============================================================
let bannerTimer = null;
function setConnected(ok) {
  clearTimeout(bannerTimer);
  if (ok) { show(connBanner, false); return; }
  // Don't flash the banner for sub-second blips.
  bannerTimer = setTimeout(() => show(connBanner, !!roomCode), 1200);
}

function endSession(msg, kind = 'error') {
  conn.disconnect();
  saveSession(null);
  state = null;
  render();
  if (msg) toast(msg, kind);
}

// (Re)attach handlers for the live connection.
function wireConn() {
  conn.on('hello', (res) => {
    setConnected(true);
    if (res.ok && !res.member) endSession('That game has ended', 'info');
  });
  conn.on('down', () => setConnected(false));
  conn.on('state', ({ s }) => {
    clockOffset = s.serverTime - Date.now();
    const prev = state;
    state = s;
    if (prev && prev.gameState !== 'roundActive' && s.gameState === 'roundActive' && s.round.actorId === s.you) {
      toast("You're acting! Go!", 'success');
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    }
    if (prev?.round && s.gameState === 'roundSetup') selectedSeconds = s.settings.roundSeconds;
    render();
  });
  conn.on('word', (w) => {
    if (w.result === 'correct') toast(`✓ ${w.word} (+1 Team ${w.team})`, 'success');
  });
  conn.on('notice', (n) => toast(n.text, n.kind));
  conn.on('bye', (m) => {
    if (m.reason === 'replaced') {
      // Another tab/device took this seat: this tab becomes a fresh player.
      token = randomToken();
      SS.setItem('wayl.token', token);
      SS.removeItem('wayl.room');
      conn.disconnect();
      roomCode = null;
      state = null;
      render();
      toast(m.message, 'error');
      return;
    }
    endSession(m.message, m.reason === 'not-found' ? 'info' : 'error');
  });
}
wireConn();

// Resume this tab's seat after a reload.
if (roomCode) { conn.connect(roomCode); setConnected(false); }

// ============================================================
// Phone friendliness
// ============================================================
// Keep the screen awake while in a room (sleeping phones drop sockets).
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.hidden || !roomCode || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not allowed, fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  keepAwake();
  conn.poke();
});
document.addEventListener('click', keepAwake);

render();
