// Small Redis client for Upstash Redis REST or Vercel KV (same REST protocol).
// Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL + KV_REST_API_TOKEN.
const crypto = require('crypto');
const BASE = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

const configured = () => Boolean(BASE && TOKEN);

async function cmd(...args) {
  if (!configured()) throw new Error('STORE_OFF');
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(a => (typeof a === 'number' ? String(a) : a)))
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Store error: ' + (j.error || r.status));
  return j.result;
}
async function getJSON(key) { const v = await cmd('GET', key); return v ? JSON.parse(v) : null; }
async function setJSON(key, value) { return cmd('SET', key, JSON.stringify(value)); }

// Session signing secret: SESSION_SECRET if set, otherwise derived from the store token (both stay on the server).
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('studyflow-session|' + TOKEN).digest('hex');
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
const LIMITS = { free: Number(process.env.AI_FREE_DAILY || 60), plus: Number(process.env.AI_PLUS_DAILY || 400) };
const today = () => new Date().toISOString().slice(0, 10);

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

module.exports = { configured, cmd, getJSON, setJSON, signSession, readSession, userKey, isPlus, LIMITS, today, send, readBody };
