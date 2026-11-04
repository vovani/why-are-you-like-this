// One Durable Object per room code. It holds the room's state in its own
// storage (so games survive deploys/restarts), the players' WebSockets
// (hibernatable: no cost while nobody is sending), and one alarm that drives
// the round timer, host hand-off, dead-socket detection and cleanup.
//
// Wire protocol (JSON text frames):
//   client → { id, ev, p }                    command, answered by an ack
//   server → { t:'ack', id, ok, error?, ... }
//            { t:'state', s }                 full personalized snapshot
//            { t:'notice', text, kind }       toast
//            { t:'word', word, result, team }
//            { t:'bye', reason, message }     replaced | kicked | closed | not-found
//   "ping" → "pong" is answered by the runtime without waking the object.

import { DurableObject } from 'cloudflare:workers';
import { Room, GameError, STATES, TIMING } from '../lib/room.js';
import { playerIdFromToken } from './util.js';

const LIVENESS_CHECK_MS = 30_000;  // while anyone is online
const DEAD_AFTER_MS = 50_000;      // client pings every 15 s

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.timing = {
      hostGraceMs: num(env.HOST_GRACE_MS, TIMING.hostGraceMs),
      playerGraceMs: num(env.PLAYER_GRACE_MS, TIMING.playerGraceMs),
      roomIdleMs: num(env.ROOM_IDLE_MS, TIMING.roomIdleMs),
    };
    this.testHooks = env.TEST_HOOKS === '1';
    this.room = null;
    this.banned = [];
    this.lastSummary = '';
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      this.banned = (await ctx.storage.get('banned')) || [];
      if (!saved) return;
      this.room = Room.fromJSON(saved, Date.now(), { keepPresence: true });
      // Woken from hibernation or restarted: trust the sockets we actually hold.
      if (this._reconcilePresence()) await this._commit();
    });
  }

  // ------------------------------------------------------------------
  // Sockets
  // ------------------------------------------------------------------
  _sockets() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN);
  }

  _pidOf(ws) {
    return ws.deserializeAttachment()?.pid || null;
  }

  _send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket already gone */ }
  }

  _bye(ws, reason, message) {
    ws.serializeAttachment({ pid: null });
    this._send(ws, { t: 'bye', reason, message });
    try { ws.close(4000, reason); } catch { /* already closed */ }
  }

  _reconcilePresence(now = Date.now()) {
    const live = new Set(this._sockets().map(ws => this._pidOf(ws)).filter(Boolean));
    let changed = false;
    for (const p of this.room.players.values()) {
      const online = live.has(p.id);
      if (p.connected !== online) changed = this.room.setConnected(p.id, online, now) || changed;
    }
    return changed;
  }

  _broadcast() {
    if (!this.room) return;
    const now = Date.now();
    for (const ws of this._sockets()) {
      const pid = this._pidOf(ws);
      if (pid && this.room.players.has(pid)) this._send(ws, { t: 'state', s: this.room.toClient(pid, now) });
    }
  }

  _notify(msg) {
    for (const ws of this._sockets()) if (this._pidOf(ws)) this._send(ws, msg);
  }

  // ------------------------------------------------------------------
  // Persistence + alarm
  // ------------------------------------------------------------------
  async _commit() {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room.toJSON());
    this._broadcast();
    await this._scheduleAlarm();
    const summary = this.room.summary();
    const key = JSON.stringify({ ...summary, updatedAt: 0 });
    if (key !== this.lastSummary) {
      this.lastSummary = key;
      this._directory().upsertRoom(summary).catch(e => console.error('[room] directory upsert', e));
    }
  }

  async _scheduleAlarm(now = Date.now()) {
    if (!this.room) { await this.ctx.storage.deleteAlarm(); return; }
    let next = this.room.nextDeadline(now, this.timing);
    if (this._sockets().some(ws => this._pidOf(ws))) {
      next = Math.min(next ?? Infinity, now + LIVENESS_CHECK_MS);
    }
    if (next === null || next === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    if (!this.room) return;
    const now = Date.now();
    // Phones that vanished without closing (network switch, dead battery).
    for (const ws of this._sockets()) {
      const att = ws.deserializeAttachment() || {};
      if (!att.pid) continue;
      const pong = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0;
      const last = Math.max(pong, att.lastSeen || 0);
      if (now - last > DEAD_AFTER_MS) {
        ws.serializeAttachment({ pid: null });
        try { ws.close(4001, 'timeout'); } catch { /* gone */ }
      }
    }
    this._reconcilePresence(now);
    const { notices, expired } = this.room.tick(now, this.timing);
    if (expired) { await this._deleteRoom('Room expired'); return; }
    for (const n of notices) this._notify({ t: 'notice', ...n });
    await this._commit();
  }

  async _deleteRoom(message) {
    const code = this.room?.code;
    for (const ws of this._sockets()) this._bye(ws, 'closed', message);
    this.room = null;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    if (code) await this._directory().removeRoom(code).catch(() => {});
  }

  _directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global'));
  }

  // ------------------------------------------------------------------
  // RPC from the Worker
  // ------------------------------------------------------------------
  async create(code, pid, name) {
    if (this.room) return { ok: false };
    const now = Date.now();
    const room = new Room(code, now);
    room.addPlayer(pid, name, now);
    room.setConnected(pid, false, now); // online once their socket says hello
    this.room = room;
    await this._commit();
    return { ok: true };
  }

  async close(message) {
    if (!this.room) return false;
    await this._deleteRoom(message);
    return true;
  }

  async fetch(request) {
    if (request.headers.get('upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.ev !== 'string') return;
    const p = msg.p && typeof msg.p === 'object' && !Array.isArray(msg.p) ? msg.p : {};
    const ack = (data) => { if (msg.id !== undefined) this._send(ws, { t: 'ack', id: msg.id, ...data }); };

    try {
      const att = ws.deserializeAttachment() || {};
      if (att.pid) ws.serializeAttachment({ ...att, lastSeen: Date.now() });
      const { bye, ...result } = (msg.ev === 'hello' ? await this._hello(ws, p) : await this._command(ws, att.pid, msg.ev, p)) || {};
      ack({ ok: true, ...result });
      if (bye) this._bye(ws, bye.reason, bye.message); // after the ack, so the client hears both
    } catch (e) {
      const known = e instanceof GameError;
      if (!known) console.error(`[room] ${msg.ev} failed`, e);
      ack({ ok: false, error: known ? e.message : 'Something went wrong' });
    }
  }

  async webSocketClose(ws) { await this._socketGone(ws); }
  async webSocketError(ws) { await this._socketGone(ws); }

  async _socketGone(ws) {
    const pid = this._pidOf(ws);
    ws.serializeAttachment({ pid: null });
    try { ws.close(); } catch { /* already closed */ }
    if (!pid || !this.room) return;
    // Only mark offline if this was their last socket (a reconnect may
    // already have taken over the seat).
    const stillHere = this._sockets().some(other => other !== ws && this._pidOf(other) === pid);
    if (!stillHere && this.room.setConnected(pid, false)) await this._commit();
  }

  async _hello(ws, { token, name }) {
    if (!this.room) return { member: false, bye: { reason: 'not-found', message: 'That game has ended' } };
    const pid = await playerIdFromToken(token);
    if (!pid) throw new GameError('Bad session, reload the page');
    const room = this.room;
    let player = room.players.get(pid);
    if (player) {
      if (name) room.renamePlayer(pid, name);
    } else if (name) {
      player = room.addPlayer(pid, name);
      this._notify({ t: 'notice', text: `${player.name} joined Team ${player.team}`, kind: 'info' });
    } else {
      return { member: false };
    }
    // Take the seat; push out any older socket (other tab / stale phone).
    ws.serializeAttachment({ pid, lastSeen: Date.now() });
    for (const other of this._sockets()) {
      if (other !== ws && this._pidOf(other) === pid) this._bye(other, 'replaced', 'You opened this game in another tab or device');
    }
    room.setConnected(pid, true);
    await this._commit();
    return { member: true, code: room.code, you: pid };
  }

  async _command(ws, pid, ev, p) {
    const room = this.room;
    if (!room) throw new GameError('That game has ended');
    if (!pid || !room.players.has(pid)) throw new GameError('You are not in this room');
    const isHost = room.hostId === pid;
    const isActor = room.state === STATES.ROUND_ACTIVE && room.round?.actorId === pid;
    const host = () => { if (!isHost) throw new GameError('Only the host can do that'); };
    const actor = () => { if (!isActor) throw new GameError("You're not acting right now"); };
    const actorOrHost = () => { if (!isActor && !isHost) throw new GameError('Only the actor or host can do that'); };

    let result;
    switch (ev) {
      case 'leave-room': {
        const name = room.players.get(pid)?.name;
        ws.serializeAttachment({ pid: null });
        room.removePlayer(pid);
        if (!room.players.size) { await this._deleteRoom('Room closed'); return; }
        this._notify({ t: 'notice', text: `${name} left`, kind: 'info' });
        break;
      }
      case 'update-settings': host(); room.updateSettings(p); break;
      case 'move-player': host(); room.movePlayer(p.playerId, p.team); break;
      case 'transfer-host': host(); room.transferHost(p.playerId); break;
      case 'kick-player': {
        host();
        if (p.playerId === pid) throw new GameError("You can't kick yourself");
        const target = room.players.get(p.playerId);
        if (!target) throw new GameError('Player not found');
        for (const s of this._sockets()) {
          if (this._pidOf(s) === target.id) this._bye(s, 'kicked', 'The host removed you from the room');
        }
        room.removePlayer(target.id);
        this._notify({ t: 'notice', text: `${target.name} was removed`, kind: 'info' });
        break;
      }
      case 'start-game': {
        host();
        room.updateSettings(p);
        this.banned = await this._directory().banned(room.settings.language).catch(() => this.banned);
        await this.ctx.storage.put('banned', this.banned);
        room.startGame(this.banned);
        break;
      }
      case 'start-round': host(); room.startRound(p.actorId, p.seconds); break;
      case 'correct':
      case 'skip': {
        actor();
        const team = room.round.actorTeam;
        result = ev === 'correct' ? room.markCorrect(p.seq, this.banned) : room.markSkip(p.seq, this.banned);
        if (result) this._notify({ t: 'word', ...result, team });
        break;
      }
      case 'remove-word': {
        actor();
        const res = room.removeWord(p.seq, this.banned);
        if (res) {
          this.banned.push(res.word);
          await this.ctx.storage.put('banned', this.banned);
          this._directory().ban(room.settings.language, res.word).catch(e => console.error('[room] ban', e));
          this._send(ws, { t: 'notice', text: `"${res.word}" removed for good`, kind: 'info' });
        }
        break;
      }
      case 'pause': actorOrHost(); room.pause(); break;
      case 'resume': actorOrHost(); room.resume(); break;
      case 'end-round': host(); room.endRound(); break;
      case 'undo': {
        host();
        const word = room.undoWord(p.roundIndex, p.wordIndex);
        this._notify({ t: 'notice', text: `"${word}" undone (−1)`, kind: 'info' });
        break;
      }
      case 'end-game': host(); room.endGame(); break;
      case 'reset-game': host(); room.resetToLobby(); break;
      case 'debug-expire-round': {
        // Test-only: make the running round end in 100 ms.
        if (!this.testHooks || !room.round) throw new GameError('Unknown command');
        if (room.round.endsAt) room.round.endsAt = Date.now() + 100;
        break;
      }
      default:
        throw new GameError('Unknown command');
    }
    await this._commit();
    return result ? {} : undefined;
  }
}
