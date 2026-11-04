// Worker entry: routing, room creation, admin API. Static files in public/
// are served by Workers Static Assets before this code even runs.
//
//   POST /api/rooms          create a room → { code }
//   GET  /ws?room=CODE       WebSocket into that room's Durable Object
//   /api/admin/*             admin (bearer token, needs ADMIN_PASSWORD secret)
//   /healthz
//
// Legacy links krachtzen.com/why_are_you_like_this/* are handled by stripping
// the prefix (see LEGACY_PREFIX).

import { GameRoom } from './game-room.js';
import { Directory } from './directory.js';
import { playerIdFromToken, json, readJSON, signAdminToken, verifyAdminToken, safeEqual } from './util.js';
import { cleanName, GameError } from '../lib/room.js';

export { GameRoom, Directory };

const LEGACY_PREFIX = '/why_are_you_like_this';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode() {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

const directory = (env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));
const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));

async function createRoom(request, env) {
  const body = await readJSON(request);
  const pid = await playerIdFromToken(body.token);
  if (!pid) return json({ ok: false, error: 'Bad session, reload the page' }, 400);
  let name;
  try { name = cleanName(body.name); } catch (e) { return json({ ok: false, error: e.message }, 400); }
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    const res = await roomStub(env, code).create(code, pid, name);
    if (res.ok) return json({ ok: true, code });
  }
  return json({ ok: false, error: 'Could not create a room, try again' }, 503);
}

async function admin(request, env, path) {
  const password = env.ADMIN_PASSWORD;
  if (!password) return json({ error: 'Admin is disabled (set the ADMIN_PASSWORD secret)' }, 503);
  const dir = directory(env);

  if (path === '/api/admin/login' && request.method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    if (!(await dir.loginAllowed(ip))) return json({ error: 'Too many attempts, try later' }, 429);
    const body = await readJSON(request);
    if (!(await safeEqual(body.password || '', password))) {
      await dir.loginFailed(ip);
      return json({ error: 'Invalid password' }, 401);
    }
    return json({ token: await signAdminToken(password) });
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await verifyAdminToken(token, password))) return json({ error: 'auth' }, 401);

  if (path === '/api/admin/logout') return json({ ok: true }); // stateless tokens: client forgets it
  if (path === '/api/admin/rooms') return json(await dir.listRooms());
  if (path === '/api/admin/banned') return json(await dir.allBanned());
  if (path === '/api/admin/unban' && request.method === 'POST') {
    const { language, word } = await readJSON(request);
    return (await dir.unban(language, word)) ? json({ ok: true }) : json({ error: 'Not banned' }, 404);
  }
  const close = path.match(/^\/api\/admin\/rooms\/([A-Za-z]{4})\/close$/);
  if (close && request.method === 'POST') {
    const ok = await roomStub(env, close[1].toUpperCase()).close('Room closed by administrator');
    return ok ? json({ ok: true }) : json({ error: 'Room not found' }, 404);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === LEGACY_PREFIX) return Response.redirect(`${url.origin}${LEGACY_PREFIX}/${url.search}`, 301);
    const legacy = path.startsWith(LEGACY_PREFIX + '/');
    if (legacy) path = path.slice(LEGACY_PREFIX.length);

    try {
      if (path === '/healthz' || path === '/health') return json({ ok: true });

      if (path === '/ws') {
        if (request.headers.get('upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        const code = (url.searchParams.get('room') || '').toUpperCase();
        if (!/^[A-Z]{4}$/.test(code)) return new Response('Bad room code', { status: 400 });
        return roomStub(env, code).fetch(request);
      }

      if (path === '/api/rooms' && request.method === 'POST') return await createRoom(request, env);
      if (path.startsWith('/api/admin/')) return await admin(request, env, path);
      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

      // Static files (only reached for legacy-prefixed paths or misses).
      const assetUrl = new URL(path + url.search, url.origin);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    } catch (e) {
      if (e instanceof GameError) return json({ ok: false, error: e.message }, 400);
      console.error('[worker]', e);
      return json({ ok: false, error: 'Something went wrong' }, 500);
    }
  },
};
