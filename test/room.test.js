import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, GameError, STATES, TIMING } from '../lib/room.js';

const T0 = 1_000_000;

function lobby(n = 4) {
  const r = new Room('ABCD', T0);
  for (let i = 0; i < n; i++) r.addPlayer(`p${i}`, `P${i}`, T0 + i);
  return r;
}

function playing(n = 4) {
  const r = lobby(n);
  r.startGame([], T0);
  return r;
}

test('first player hosts, teams balance, names deduplicate', () => {
  const r = lobby(4);
  assert.equal(r.hostId, 'p0');
  assert.deepEqual([...r.players.values()].map(p => p.team), ['A', 'B', 'A', 'B']);
  const dup = r.addPlayer('x', 'p0');
  assert.equal(dup.name, 'p0 2');
});

test('names are cleaned and required', () => {
  const r = new Room('ABCD');
  assert.throws(() => r.addPlayer('a', '   '), GameError);
  assert.throws(() => r.addPlayer('a', 42), GameError);
  const p = r.addPlayer('a', '  Bob\u0000  \n the   builder with a very long name ');
  assert.equal(p.name, 'Bob the builder with');
});

test('cannot start with fewer than 2 players; bad settings rejected', () => {
  const r = lobby(1);
  assert.throws(() => r.startGame(), /2 players/);
  r.addPlayer('p1', 'P1');
  assert.throws(() => r.updateSettings({ difficulty: 'nope' }), GameError);
  assert.throws(() => r.updateSettings({ language: 'xx' }), GameError);
  r.updateSettings({ maxSkips: 'abc', roundSeconds: -5 });
  assert.equal(r.settings.maxSkips, 2);
  assert.equal(r.settings.roundSeconds, 10);
});

test('round timer is clamped and validated', () => {
  const r = playing();
  r.startRound('p0', 'abc', T0);
  assert.equal(r.round.durationMs, 60_000, 'NaN falls back to default');
  r.endRound(T0);
  r.startRound('p1', 99999, T0);
  assert.equal(r.round.durationMs, 600_000);
});

test('stale card seq is ignored (double tap cannot score an unseen word)', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  const seq = r.cardSeq;
  assert.ok(r.markCorrect(seq, [], T0));
  assert.equal(r.markCorrect(seq, [], T0), null, 'second tap with old seq ignored');
  assert.equal(r.scores.A, 1);
});

test('scores go to the actor team at the time, undo reverses exactly', () => {
  const r = playing();
  r.startRound('p1', 60, T0); // team B
  r.markCorrect(r.cardSeq, [], T0);
  r.markCorrect(r.cardSeq, [], T0);
  r.undoWord(-1, 0, T0);
  assert.deepEqual(r.scores, { A: 0, B: 1 });
  r.endRound(T0);
  r.undoWord(0, 1, T0);
  assert.deepEqual(r.scores, { A: 0, B: 0 });
  assert.equal(r.history[0].correct, 0);
  assert.throws(() => r.undoWord(0, 1, T0), /Nothing to undo/);
  assert.throws(() => r.undoWord(5, 0, T0), /Nothing to undo/);
});

test('skip limits, including 0 and unlimited', () => {
  const r = playing();
  r.updateSettings({ maxSkips: 1 });
  r.startRound('p0', 60, T0);
  r.markSkip(r.cardSeq, [], T0);
  assert.throws(() => r.markSkip(r.cardSeq, [], T0), /No skips left/);
  r.endRound(T0);
  r.updateSettings({ maxSkips: 0 });
  r.startRound('p1', 60, T0);
  assert.throws(() => r.markSkip(r.cardSeq, [], T0), /off/);
  r.endRound(T0);
  r.updateSettings({ maxSkips: 999 });
  r.startRound('p2', 60, T0);
  for (let i = 0; i < 20; i++) r.markSkip(r.cardSeq, [], T0);
  assert.equal(r.toClient('p2', T0).round.skipsRemaining, null);
});

test('deck never runs dry: reshuffles unplayed, then everything', () => {
  const r = playing();
  r.updateSettings({ maxSkips: 999 });
  r.startRound('p0', 600, T0);
  for (let i = 0; i < 1000; i++) assert.ok(r.markSkip(r.cardSeq, [], T0), `card ${i}`);
});

test('removing a word replaces the card and does not consume a skip', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  const before = r.currentWord();
  const res = r.removeWord(r.cardSeq, [], T0);
  assert.equal(res.word, before);
  assert.notEqual(r.currentWord(), before);
  assert.equal(r.round.skipsUsed, 0);
});

test('pause/resume preserves remaining time', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  r.pause(T0 + 10_000);
  assert.equal(r.timeRemainingMs(T0 + 999_999), 50_000);
  assert.throws(() => r.markCorrect(r.cardSeq, [], T0), /paused/);
  r.resume(T0 + 100_000);
  assert.equal(r.timeRemainingMs(T0 + 110_000), 40_000);
});

test('actor disconnect auto-pauses, reconnect auto-resumes', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  r.setConnected('p0', false, T0 + 5_000);
  assert.ok(r.isPaused());
  assert.ok(r.round.autoPaused);
  r.setConnected('p0', true, T0 + 60_000);
  assert.ok(!r.isPaused());
  assert.equal(r.timeRemainingMs(T0 + 60_000), 55_000);
});

test('manual pause survives actor blip', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  r.pause(T0);
  r.setConnected('p0', false, T0);
  r.setConnected('p0', true, T0);
  assert.ok(r.isPaused(), 'stays paused: actor paused on purpose');
});

test('only actor sees the word', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  assert.ok(r.toClient('p0', T0).round.word);
  assert.equal(r.toClient('p1', T0).round.word, undefined);
  assert.equal(r.toClient('p1', T0).round.cardSeq, undefined);
  assert.ok(!JSON.stringify(r.toClient('p1', T0)).includes(r.currentWord()));
});

test('cannot start a round with an offline actor', () => {
  const r = playing();
  r.setConnected('p1', false, T0);
  assert.throws(() => r.startRound('p1', 60, T0), /offline/);
});

test('suggested actor alternates teams and rotates players', () => {
  const r = playing(4);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const id = r.suggestedActorId();
    seen.push(id);
    r.startRound(id, 60, T0);
    r.endRound(T0);
  }
  const teams = seen.map(id => r.players.get(id).team);
  assert.deepEqual(teams, ['A', 'B', 'A', 'B']);
  assert.equal(new Set(seen).size, 4);
});

test('actor leaving ends the round; host leaving hands host to someone online', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  r.setConnected('p1', false, T0);
  r.removePlayer('p0', T0);
  assert.equal(r.state, STATES.ROUND_SETUP);
  assert.equal(r.hostId, 'p2', 'skips offline p1');
});

test('auto host transfer only when host is offline', () => {
  const r = lobby(3);
  assert.equal(r.autoTransferHost(T0), null);
  r.setConnected('p0', false, T0);
  assert.equal(r.autoTransferHost(T0).id, 'p1');
});

test('late joiners can join mid-game', () => {
  const r = playing(2);
  r.startRound('p0', 60, T0);
  const p = r.addPlayer('late', 'Late', T0);
  assert.ok(p.team);
});

test('serialization round-trips and freezes an in-flight round', () => {
  const r = playing();
  r.startRound('p0', 60, T0);
  r.markCorrect(r.cardSeq, [], T0);
  const copy = Room.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), T0 + 20_000);
  assert.equal(copy.state, STATES.ROUND_ACTIVE);
  assert.ok(copy.isPaused());
  assert.equal(copy.timeRemainingMs(T0 + 99_000), 40_000);
  assert.deepEqual(copy.scores, r.scores);
  assert.ok([...copy.players.values()].every(p => !p.connected));
  copy.setConnected('p0', true, T0 + 30_000);
  assert.ok(!copy.isPaused(), 'actor return resumes');

  const expired = Room.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), T0 + 120_000);
  assert.equal(expired.state, STATES.ROUND_SETUP);
  assert.equal(expired.history.length, 1);
});

test('tick: round end, host hand-off, player drop, room expiry; nextDeadline agrees', () => {
  const r = playing(3);
  r.startRound('p1', 30, T0);
  assert.equal(r.nextDeadline(T0), T0 + 30_000);
  let res = r.tick(T0 + 30_000);
  assert.equal(r.state, STATES.ROUND_SETUP);
  assert.ok(res.notices.some(n => /Time/.test(n.text)));

  r.setConnected('p0', false, T0 + 40_000);
  assert.equal(r.nextDeadline(T0 + 40_000), T0 + 40_000 + TIMING.hostGraceMs);
  r.tick(T0 + 40_000 + TIMING.hostGraceMs);
  assert.equal(r.hostId, 'p1');

  r.tick(T0 + 40_000 + TIMING.playerGraceMs);
  assert.ok(!r.players.has('p0'), 'offline too long → dropped');

  for (const id of ['p1', 'p2']) r.setConnected(id, false, T0 + 50_000);
  const keepPlayers = { ...TIMING, playerGraceMs: Infinity };
  const idleAt = r.updatedAt + TIMING.roomIdleMs;
  assert.equal(r.nextDeadline(T0 + 50_000, keepPlayers), idleAt);
  assert.equal(r.tick(idleAt - 1, keepPlayers).expired, false);
  assert.equal(r.tick(idleAt, keepPlayers).expired, true);
});

test('keepPresence restore leaves a live room untouched', () => {
  const r = playing(2);
  r.startRound('p0', 60, T0);
  const copy = Room.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), T0 + 5_000, { keepPresence: true });
  assert.ok(copy.players.get('p0').connected);
  assert.ok(!copy.isPaused());
  assert.equal(copy.timeRemainingMs(T0 + 5_000), 55_000);
});
