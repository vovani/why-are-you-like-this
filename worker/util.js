const enc = new TextEncoder();

const hex = (buf) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
}

// The browser keeps a random secret token; everyone else only ever sees a
// hash of it, so knowing someone's public id doesn't let you take their seat.
export async function playerIdFromToken(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  return 'p' + (await sha256Hex(token)).slice(0, 15);
}

export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

/** Stateless admin session: "<expiry>.<hmac>". Changing the password logs everyone out. */
export async function signAdminToken(secret, now = Date.now()) {
  const exp = String(now + ADMIN_TTL_MS);
  return `${exp}.${await hmac(secret, 'admin:' + exp)}`;
}

export async function verifyAdminToken(token, secret, now = Date.now()) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !(Number(exp) > now)) return false;
  return safeEqual(sig, await hmac(secret, 'admin:' + exp));
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function readJSON(request) {
  try {
    const text = await request.text();
    if (text.length > 10_000) return {};
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
