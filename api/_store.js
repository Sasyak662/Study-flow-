// Small Redis client. Works with either:
//  - Upstash Redis REST / Vercel KV: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN)
//  - Any normal Redis URL (redis:// or rediss://), e.g. Vercel's "Redis" integration: REDIS_URL, STORAGE_URL, KV_URL or any env var holding a redis:// URL
const crypto = require('crypto');
const net = require('net'), tls = require('tls');
const BASE = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const RURL = (() => {
  for (const k of ['REDIS_URL', 'STORAGE_URL', 'KV_URL', 'REDIS_TLS_URL']) if (/^rediss?:\/\//.test(process.env[k] || '')) return process.env[k];
  for (const [k, v] of Object.entries(process.env)) if (/_URL$/.test(k) && /^rediss?:\/\//.test(v || '')) return v;
  return '';
})();

const configured = () => Boolean((BASE && TOKEN) || RURL);

// ---- minimal RESP (Redis protocol) client, one shared connection per server instance ----
let conn = null;
function parseReply(buf, i) {
  if (i >= buf.length) return null;
  const t = String.fromCharCode(buf[i]);
  const nl = buf.indexOf('\r\n', i);
  if (nl < 0) return null;
  const line = buf.toString('utf8', i + 1, nl);
  if (t === '+') return [line, nl + 2];
  if (t === '-') return [new Error(line), nl + 2];
  if (t === ':') return [Number(line), nl + 2];
  if (t === '$') {
    const n = Number(line);
    if (n < 0) return [null, nl + 2];
    if (buf.length < nl + 2 + n + 2) return null;
    return [buf.toString('utf8', nl + 2, nl + 2 + n), nl + 2 + n + 2];
  }
  if (t === '*') {
    const n = Number(line);
    if (n < 0) return [null, nl + 2];
    const out = []; let p = nl + 2;
    for (let k = 0; k < n; k++) { const r = parseReply(buf, p); if (!r) return null; out.push(r[0] instanceof Error ? r[0].message : r[0]); p = r[1]; }
    return [out, p];
  }
  throw new Error('Bad Redis reply');
}
function encode(args) {
  let s = '*' + args.length + '\r\n';
  for (const a of args) { const b = Buffer.from(String(a), 'utf8'); s += '$' + b.length + '\r\n' + b.toString('utf8') + '\r\n'; }
  return s;
}
function connect() {
  if (conn && !conn.dead) return conn.ready;
  const u = new URL(RURL);
  const port = Number(u.port || 6379), host = u.hostname;
  const sock = u.protocol === 'rediss:' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  const c = { sock, buf: Buffer.alloc(0), q: [], dead: false };
  conn = c;
  sock.setNoDelay(true);
  sock.setTimeout(15000, () => sock.destroy(new Error('Redis timeout')));
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    for (;;) {
      let r; try { r = parseReply(c.buf, 0); } catch (e) { sock.destroy(e); return; }
      if (!r) break;
      c.buf = c.buf.slice(r[1]);
      const p = c.q.shift(); if (!p) continue;
      r[0] instanceof Error ? p.reject(r[0]) : p.resolve(r[0]);
    }
  });
  const fail = e => { c.dead = true; while (c.q.length) c.q.shift().reject(e || new Error('Redis connection closed')); };
  sock.on('error', fail); sock.on('close', () => fail());
  const raw = (...a) => new Promise((resolve, reject) => { c.q.push({ resolve, reject }); sock.write(encode(a)); });
  c.raw = raw;
  c.ready = new Promise((resolve, reject) => {
    sock.once(u.protocol === 'rediss:' ? 'secureConnect' : 'connect', async () => {
      try {
        const pass = decodeURIComponent(u.password || ''), user = decodeURIComponent(u.username || '');
        if (pass) await (user && user !== 'default' ? raw('AUTH', user, pass) : raw('AUTH', pass));
        const db = (u.pathname || '').replace('/', ''); if (db && db !== '0') await raw('SELECT', db);
        resolve(c);
      } catch (e) { reject(e); }
    });
    sock.once('error', reject);
  });
  return c.ready;
}

async function cmd(...args) {
  if (!configured()) throw new Error('STORE_OFF');
  if (BASE && TOKEN) {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(a => (typeof a === 'number' ? String(a) : a)))
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error('Store error: ' + (j.error || r.status));
    return j.result;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const c = await connect(); return await c.raw(...args.map(a => (typeof a === 'number' ? String(a) : a))); }
    catch (e) { if (conn) conn.dead = true; if (attempt || /WRONGTYPE|ERR|NOAUTH/.test(e.message)) throw new Error('Store error: ' + e.message); }
  }
}
// Lifetime Plus for one owner account only. Matched by a fingerprint (SHA-256) of the exact email, so the email itself is not stored in the code.
const LIFETIME = new Set(['58e0f93855fc063f8d5d16a7887f9ea9aba7180bb5413ffb2ac8ba78fae1d9f3']);
const FOREVER = 4102444800000; // 1 Jan 2100
const isLifetime = email => LIFETIME.has(crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex'));
async function getJSON(key) {
  const v = await cmd('GET', key); const o = v ? JSON.parse(v) : null;
  if (o && typeof o === 'object' && typeof key === 'string' && key.startsWith('sf:user:') && isLifetime(key.slice(8))) o.plusUntil = Math.max(+o.plusUntil || 0, FOREVER);
  return o;
}
async function setJSON(key, value) { return cmd('SET', key, JSON.stringify(value)); }

// Session signing secret: SESSION_SECRET if set, otherwise derived from the store token (both stay on the server).
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('studyflow-session|' + (TOKEN || RURL)).digest('hex');
const b64u = b => Buffer.from(b).toString('base64url');

function signSession(email, days = 30) {
  const body = b64u(JSON.stringify({ e: email, exp: Date.now() + days * 864e5 }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readSession(req) {
  const h = String(req.headers.authorization || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p.exp > Date.now() ? p.e : null; } catch (e) { return null; }
}

const userKey = email => 'sf:user:' + email;
const isPlus = u => Boolean(u && u.plusUntil && u.plusUntil > Date.now());
const LIMITS = { free: Number(process.env.AI_FREE_DAILY_V2 || 5), plus: Number(process.env.AI_PLUS_DAILY || 250) };
// The day changes at midnight India time (most StudyStarx students are in India).
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
async function readBody(req, max = 1500000) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw new Error('TOO_BIG'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = { configured, cmd, getJSON, setJSON, signSession, readSession, userKey, isPlus, isLifetime, LIMITS, today, send, readBody };
