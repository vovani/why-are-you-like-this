// End-to-end: the real Worker + Durable Objects running in `wrangler dev`
// (workerd, same runtime as production), with many WebSocket players.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(import.meta.dirname, '..');
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayl-do-'));
let server = null;
let base = '';

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startWorker() {
  const port = await freePort();
  const child = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir,
    '--var', 'ADMIN_PASSWORD:secret', '--var', 'TEST_HOOKS:1', '--var', 'HOST_GRACE_MS:300',
    '--show-interactive-dev-session=false'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url + '/healthz')).ok) return { child, url }; } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error('wrangler dev did not start:\n' + log);
}

function stopWorker(s) {
  return new Promise((resolve) => {
    if (!s || s.child.exitCode !== null) return resolve();
    s.child.once('exit', () => resolve());
    try { process.kill(-s.child.pid, 'SIGTERM'); } catch { resolve(); }
  });
}

before(async () => { server = await startWorker(); base = server.url; });
after(async () => { await stopWorker(server); fs.rmSync(persistDir, { recursive: true, force: true }); });

/** A fake phone. Tracks the latest state it was sent. */
class Player {
  constructor(token = crypto.randomBytes(16).toString('hex')) {
    this.token = token;
    this.state = null;
    this.events = [];
    this.notices = [];
    this.pending = new Map();
    this.nextId = 1;
  }

  open(code) {
    this.code = code;
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${code}`);
    this.ws.onmessage = (e) => {
      if (e.data === 'pong') { this.pongs = (this.pongs || 0) + 1; return; }
      const m = JSON.parse(e.data);
      if (m.t === 'ack') { this.pending.get(m.id)?.(m); this.pending.delete(m.id); return; }
      this.events.push(m);
      if (m.t === 'state') this.state = m.s;
      if (m.t === 'notice') this.notices.push(m.text);
    };
    this.closed = new Promise(r => { this.ws.onclose = r; });
    return new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
  }

  call(ev, p = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no ack for ${ev}`)), 5000);
      this.pending.set(id, (m) => { clearTimeout(t); resolve(m); });
      this.ws.send(JSON.stringify({ id, ev, p }));
    });
  }

  async enter(code, name) {
    await this.open(code);
    return this.call('hello', { token: this.token, name });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function until(fn, ms = 3000, label = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (fn()) return; } catch { /* keep waiting */ }
    await sleep(15);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function createRoom(host, name = 'Host') {
  const res = await fetch(base + '/api/rooms', { method: 'POST', body: JSON.stringify({ token: host.token, name }) }).then(r => r.json());
  assert.ok(res.ok, res.error);
  const hello = await host.enter(res.code);
  assert.ok(hello.member);
  return res.code;
}

async function roomWith(n) {
  const host = new Player();
  const code = await createRoom(host);
  const others = [];
  for (let i = 1; i < n; i++) {
    const p = new Player();
    const res = await p.enter(code, `P${i}`);
    assert.ok(res.ok && res.member, res.error);
    others.push(p);
  }
  const all = [host, ...others];
  await until(() => all.every(p => p.state?.players.length === n && p.state.players.every(x => x.connected)), 3000, 'everyone sees everyone');
  return { code, host, others, all };
}

const closeAll = (...ps) => ps.flat().forEach(p => p.close());

test('8 players: full game flow stays consistent for everyone', async (t) => {
  const { host, all } = await roomWith(8);
  t.after(() => closeAll(all));
  assert.ok((await host.call('start-game', { difficulty: 'medium', language: 'en' })).ok);
  await until(() => all.every(p => p.state.gameState === 'roundSetup'));

  for (let round = 0; round < 3; round++) {
    const actorId = host.state.suggestedActorId;
    const actor = all.find(p => p.state.you === actorId);
    assert.ok((await host.call('start-round', { actorId, seconds: 30 })).ok);
    await until(() => all.every(p => p.state.gameState === 'roundActive'));
    for (const p of all) {
      if (p === actor) assert.ok(p.state.round.word);
      else assert.equal(p.state.round.word, undefined, 'guessers never see the word');
    }
    for (let i = 0; i < 5; i++) {
      const seq = actor.state.round.cardSeq;
      assert.ok((await actor.call('correct', { seq })).ok);
      await until(() => actor.state.round.cardSeq !== seq);
    }
    assert.ok((await host.call('end-round')).ok);
    await until(() => all.every(p => p.state.gameState === 'roundSetup' && p.state.history.length === round + 1));
  }
  assert.equal(new Set(all.map(p => JSON.stringify(p.state.scores))).size, 1, 'all clients agree');
  assert.equal(host.state.scores.A + host.state.scores.B, 15);
});

test('reconnect replaces the old socket; the stale one closing does not knock you offline', async (t) => {
  const { host, others, all } = await roomWith(3);
  const victim = others[0];
  const fresh = new Player(victim.token);
  t.after(() => closeAll(all, fresh));
  assert.ok((await fresh.enter(host.state.code)).member);
  await until(() => victim.events.some(e => e.t === 'bye' && e.reason === 'replaced'), 3000, 'old socket told it was replaced');
  await victim.closed;
  await sleep(150);
  assert.equal(host.state.players.find(p => p.id === fresh.state.you).connected, true);
  assert.equal(host.state.players.length, 3, 'no duplicate seat');
  await host.call('update-settings', { maxSkips: 3 });
  await until(() => fresh.state.settings.maxSkips === 3, 3000, 'fresh socket gets updates');
});

test('actor drops mid-round: clock freezes, resumes with the same word on return', async (t) => {
  const { host, others, all } = await roomWith(3);
  t.after(() => closeAll(all));
  await host.call('start-game');
  const actor = others[0];
  await host.call('start-round', { actorId: actor.state.you, seconds: 60 });
  await until(() => actor.state?.round?.word);
  const word = actor.state.round.word;
  actor.close();
  await until(() => host.state.round.paused && host.state.round.autoPaused, 3000, 'auto pause');
  const back = new Player(actor.token);
  t.after(() => back.close());
  await back.enter(host.state.code);
  await until(() => back.state?.round?.word === word && !back.state.round.paused, 3000, 'resumed');
});

test('double-tapped Correct only scores once', async (t) => {
  const { host, others, all } = await roomWith(2);
  t.after(() => closeAll(all));
  await host.call('start-game');
  await host.call('start-round', { actorId: others[0].state.you, seconds: 60 });
  await until(() => others[0].state.round?.cardSeq !== undefined);
  const seq = others[0].state.round.cardSeq;
  await Promise.all([1, 2, 3].map(() => others[0].call('correct', { seq })));
  await sleep(100);
  assert.equal(host.state.scores.B, 1);
});

test('garbage never breaks the room', async (t) => {
  const { host, others, all } = await roomWith(2);
  t.after(() => closeAll(all));
  for (const raw of ['', 'nope', '{', '[]', 'null', '{"ev":5}', JSON.stringify({ id: 1, ev: 'start-game', p: 'x' })]) others[0].ws.send(raw);
  const junk = [null, 5, 'x', [], { difficulty: 'nope' }, { actorId: { $gt: '' } }, { seconds: 'abc' }, { roundIndex: 'a', wordIndex: {} }];
  const evs = ['hello', 'update-settings', 'move-player', 'transfer-host', 'kick-player', 'start-game', 'start-round', 'correct',
    'skip', 'remove-word', 'pause', 'resume', 'end-round', 'undo', 'end-game', 'reset-game', 'debug-expire-round', 'what'];
  const acks = await Promise.all(evs.flatMap(ev => junk.map(j => others[0].call(ev, j))));
  assert.ok(acks.every(a => typeof a.ok === 'boolean'));
  for (const j of junk) await host.call('start-game', j).catch(() => {});
  assert.ok((await host.call('update-settings', { maxSkips: 1 })).ok, 'room still works');
  assert.ok((await fetch(base + '/healthz')).ok);
});

test('permissions: only host runs the game, only the actor scores', async (t) => {
  const { host, others, all } = await roomWith(3);
  t.after(() => closeAll(all));
  const r1 = await others[0].call('start-game');
  assert.match(r1.error, /host/);
  await host.call('start-game');
  await host.call('start-round', { actorId: others[0].state.you, seconds: 60 });
  assert.equal((await others[1].call('correct', { seq: 0 })).ok, false);
  assert.equal((await host.call('correct', {})).ok, false);
});

test('a public player id cannot be used to take a seat', async (t) => {
  const { host, others, all } = await roomWith(2);
  t.after(() => closeAll(all));
  assert.ok(!JSON.stringify(others[0].state).includes(host.token));
  const impostor = new Player(host.state.you.padEnd(20, 'x'));
  t.after(() => impostor.close());
  const res = await impostor.enter(host.state.code);
  assert.equal(res.member, false);
});

test('host fixes words both ways; guessers cannot', async (t) => {
  const { host, others, all } = await roomWith(3);
  t.after(() => closeAll(all));
  const actor = others[0];
  await host.call('start-game');
  await host.call('update-settings', { maxSkips: 3 });
  await host.call('start-round', { actorId: actor.state.you, seconds: 60 });
  await until(() => actor.state?.round?.cardSeq !== undefined);
  await actor.call('skip', { seq: actor.state.round.cardSeq });
  await until(() => actor.state.round.words.length === 1);
  assert.equal((await others[1].call('mark-word', { roundIndex: -1, wordIndex: 0, correct: true })).ok, false);
  assert.ok((await host.call('mark-word', { roundIndex: -1, wordIndex: 0, correct: true })).ok);
  await until(() => all.every(p => p.state.scores.B === 1 && p.state.round.words[0].result === 'correct'));
  assert.equal(actor.state.round.skipsRemaining, 3, 'skip given back');
  assert.ok((await host.call('mark-word', { roundIndex: -1, wordIndex: 0, correct: false })).ok);
  await until(() => all.every(p => p.state.scores.B === 0));
  assert.ok(host.notices.some(n => /not counted/.test(n)));
});

test('late joiner mid-round gets a team and no word', async (t) => {
  const { host, others, all } = await roomWith(2);
  await host.call('start-game');
  await host.call('start-round', { actorId: others[0].state.you, seconds: 60 });
  const late = new Player();
  t.after(() => closeAll(all, late));
  assert.ok((await late.enter(host.state.code, 'Late')).member);
  await until(() => late.state?.gameState === 'roundActive');
  assert.equal(late.state.round.word, undefined);
});

test('host drops → host passes to someone online after grace (alarm)', async (t) => {
  const { host, others, all } = await roomWith(3);
  t.after(() => closeAll(all));
  const oldHost = host.state.you;
  host.close();
  await until(() => others[0].state.hostId !== oldHost, 5000, 'host transfer');
  assert.ok(others[0].notices.some(n => /now the host/.test(n)));
});

test('round timer ends the round for everyone (alarm)', async (t) => {
  const { host, others, all } = await roomWith(2);
  t.after(() => closeAll(all));
  await host.call('start-game');
  await host.call('start-round', { actorId: others[0].state.you, seconds: 10 });
  assert.ok((await host.call('debug-expire-round')).ok);
  await until(() => all.every(p => p.state.gameState === 'roundSetup' && p.state.history.length === 1), 5000, 'round ended');
});

test('kick and leave', async (t) => {
  const { host, others, all } = await roomWith(3);
  t.after(() => closeAll(all));
  assert.ok((await host.call('kick-player', { playerId: others[1].state.you })).ok);
  await until(() => others[1].events.some(e => e.t === 'bye' && e.reason === 'kicked'));
  await until(() => host.state.players.length === 2);
  await others[0].call('leave-room');
  await until(() => host.state.players.length === 1);
  const last = await host.call('leave-room');
  assert.equal(last.ok, true, 'last player leaving still gets an answer');
  const probe = new Player();
  t.after(() => probe.close());
  assert.equal((await probe.enter(host.state.code, 'X')).member, false, 'empty room deleted');
});

test('removed words are banned for future games', async (t) => {
  const { host, others, all } = await roomWith(2);
  t.after(() => closeAll(all));
  await host.call('start-game');
  await host.call('start-round', { actorId: others[0].state.you, seconds: 60 });
  await until(() => others[0].state.round?.word);
  const word = others[0].state.round.word;
  assert.ok((await others[0].call('remove-word', { seq: others[0].state.round.cardSeq })).ok);
  await until(() => others[0].state.round.word !== word);
  const login = await fetch(base + '/api/admin/login', { method: 'POST', body: '{"password":"secret"}' }).then(r => r.json());
  const banned = await fetch(base + '/api/admin/banned', { headers: { authorization: `Bearer ${login.token}` } }).then(r => r.json());
  assert.ok(banned.easy === undefined && banned.en.includes(word));
});

test('admin: auth required, rooms listed, close kicks everyone', async (t) => {
  const { host, all } = await roomWith(2);
  t.after(() => closeAll(all));
  assert.equal((await fetch(base + '/api/admin/rooms')).status, 401);
  assert.equal((await fetch(base + '/api/admin/login', { method: 'POST', body: '{"password":"nope"}' })).status, 401);
  const { token } = await fetch(base + '/api/admin/login', { method: 'POST', body: '{"password":"secret"}' }).then(r => r.json());
  const auth = { authorization: `Bearer ${token}` };
  await until(async () => true);
  const list = await fetch(base + '/api/admin/rooms', { headers: auth }).then(r => r.json());
  assert.ok(list.rooms.some(r => r.code === host.state.code));
  const res = await fetch(`${base}/api/admin/rooms/${host.state.code}/close`, { method: 'POST', headers: auth });
  assert.equal(res.status, 200);
  await until(() => all.every(p => p.events.some(e => e.t === 'bye' && e.reason === 'closed')));
  const gone = new Player();
  t.after(() => gone.close());
  assert.equal((await gone.enter(host.state.code, 'X')).member, false, 'room really deleted');
});

// Keep last: restarts the worker.
test('games survive a full worker restart (Durable Object storage)', async (t) => {
  const { host, others, all } = await roomWith(2);
  await host.call('start-game');
  await host.call('start-round', { actorId: others[0].state.you, seconds: 60 });
  await until(() => others[0].state.round?.cardSeq !== undefined);
  await others[0].call('correct', { seq: others[0].state.round.cardSeq });
  await until(() => host.state.scores.B === 1);
  const code = host.state.code;
  const word = others[0].state.round.word;

  closeAll(all);
  await stopWorker(server);
  server = await startWorker();
  base = server.url;

  const h2 = new Player(host.token);
  const a2 = new Player(others[0].token);
  t.after(() => closeAll(h2, a2));
  assert.ok((await h2.enter(code)).member, 'host seat restored');
  await until(() => h2.state.round?.paused, 3000, 'round frozen while actor is away');
  assert.ok((await a2.enter(code)).member);
  await until(() => a2.state.round && !a2.state.round.paused && a2.state.round.word === word, 3000, 'actor back, same word, clock running');
  assert.equal(h2.state.scores.B, 1);
});
