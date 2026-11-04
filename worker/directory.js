// Singleton Durable Object: things shared by all rooms.
//  - removed ("banned") words per language
//  - a registry of live rooms for the admin page
//  - admin login throttling

import { DurableObject } from 'cloudflare:workers';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.attempts = new Map(); // ip → { count, resetAt } (memory is fine for throttling)
  }

  // ---- Removed words ----
  async banned(language) {
    const all = (await this.ctx.storage.get('banned')) || {};
    return all[language] || [];
  }

  async allBanned() {
    return (await this.ctx.storage.get('banned')) || {};
  }

  async ban(language, word) {
    if (typeof language !== 'string' || typeof word !== 'string') return false;
    const all = (await this.ctx.storage.get('banned')) || {};
    const list = (all[language] = all[language] || []);
    if (list.includes(word)) return false;
    list.push(word);
    await this.ctx.storage.put('banned', all);
    return true;
  }

  async unban(language, word) {
    const all = (await this.ctx.storage.get('banned')) || {};
    const list = all[language];
    if (!list || !list.includes(word)) return false;
    list.splice(list.indexOf(word), 1);
    await this.ctx.storage.put('banned', all);
    return true;
  }

  // ---- Room registry ----
  async upsertRoom(summary) {
    await this.ctx.storage.put(`room:${summary.code}`, summary);
  }

  async removeRoom(code) {
    await this.ctx.storage.delete(`room:${code}`);
  }

  async listRooms() {
    const rooms = [...(await this.ctx.storage.list({ prefix: 'room:' })).values()];
    const stats = { rooms: rooms.length, players: 0, online: 0, playing: 0 };
    for (const r of rooms) {
      stats.players += r.players.length;
      stats.online += r.players.filter(p => p.connected).length;
      if (r.gameState === 'roundSetup' || r.gameState === 'roundActive') stats.playing++;
    }
    rooms.sort((a, b) => b.updatedAt - a.updatedAt);
    return { stats, rooms };
  }

  // ---- Admin login throttling ----
  loginAllowed(ip, now = Date.now()) {
    const a = this.attempts.get(ip);
    return !a || a.resetAt < now || a.count < LOGIN_MAX;
  }

  loginFailed(ip, now = Date.now()) {
    let a = this.attempts.get(ip);
    if (!a || a.resetAt < now) a = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    a.count++;
    this.attempts.set(ip, a);
  }
}
