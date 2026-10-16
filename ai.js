// StudyFlow AI — secure Gemini proxy (Vercel Serverless Function, Node 18+)
// The API key lives ONLY in the GEMINI_API_KEY environment variable and is never sent to the browser.
//
// Request  (POST /api/ai, JSON): { system, messages:[{role,content}], user, temperature, search, codeExecution }
// Response (200, JSON):          { text, sources:[{title,uri}], usedSearch }
// Error    (4xx/5xx, JSON):      { error }

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_TOTAL_CHARS = 60000;   // total characters accepted per request
const MAX_MESSAGES = 20;         // history turns kept
const TIMEOUT_MS = 55000;

// Best-effort per-IP rate limit (resets on cold start; use Upstash/Redis for a hard limit).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = Number(process.env.AI_RATE_LIMIT_PER_MIN || 20);
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
  return arr.length > RATE_MAX;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;          // Vercel pre-parses JSON
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 400000) throw new Error('Request too large.');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function buildContents(messages, user) {
  const turns = [];
  for (const m of Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : []) {
    const text = String(m && m.content || '').trim();
    if (!text) continue;
    turns.push({ role: m.role === 'assistant' ? 'model' : 'user', text });
  }
  const last = String(user || '').trim();
  if (last) turns.push({ role: 'user', text: last });

  // Gemini wants the conversation to start with a user turn; merge consecutive same-role turns.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const merged = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === t.role) prev.parts[0].text += '\n\n' + t.text;
    else merged.push({ role: t.role, parts: [{ text: t.text }] });
  }
  return merged;
}

module.exports = async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;

  // Handy health check: open /api/ai in a browser to see if the key is configured (never reveals it).
  if (req.method === 'GET') return send(res, 200, { ok: true, configured: Boolean(key), model: MODEL });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'Method not allowed.' }); }

  if (!key) return send(res, 500, { error: 'Server is missing GEMINI_API_KEY. Add it in your hosting environment variables and redeploy.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests — please wait a minute and try again.' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Invalid JSON request.' }); }

  const system = String(body.system || '');
  const contents = buildContents(body.messages, body.user);
  if (!contents.length) return send(res, 400, { error: 'Nothing to answer — the request had no message.' });

  const total = system.length + contents.reduce((n, c) => n + c.parts[0].text.length, 0);
  if (total > MAX_TOTAL_CHARS) return send(res, 413, { error: 'That request is too long. Try a shorter question or fewer pasted notes.' });

  const temperature = Math.max(0, Math.min(1, Number(body.temperature) || 0.3));
  const payload = { contents, generationConfig: { temperature, maxOutputTokens: 8192 } };
  if (system.trim()) payload.systemInstruction = { parts: [{ text: system }] };

  // Search wins if both are requested (the two tools are not reliably combinable on one call).
  if (body.search) payload.tools = [{ google_search: {} }];
  else if (body.codeExecution) payload.tools = [{ code_execution: {} }];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg = json?.error?.message || `Gemini returned HTTP ${r.status}`;
      console.error('Gemini error', r.status, msg);
      if (r.status === 429) return send(res, 429, { error: 'The AI is busy right now (quota reached). Please try again shortly.' });
      if (r.status === 400 && /API key/i.test(msg)) return send(res, 502, { error: 'The server\'s Gemini API key was rejected. Check GEMINI_API_KEY.' });
      if (r.status === 401 || r.status === 403) return send(res, 502, { error: 'The server\'s Gemini API key is invalid or not allowed. Check GEMINI_API_KEY.' });
      return send(res, 502, { error: 'AI service error: ' + msg.slice(0, 200) });
    }

    if (json?.promptFeedback?.blockReason) {
      return send(res, 422, { error: 'That request was blocked by the AI safety filter. Try rephrasing it.' });
    }

    const cand = json?.candidates?.[0];
    const text = (cand?.content?.parts || []).map(p => (typeof p.text === 'string' ? p.text : '')).join('').trim();
    if (!text) return send(res, 502, { error: 'Gemini returned an empty answer' + (cand?.finishReason ? ` (${cand.finishReason})` : '') + '.' });

    const gm = cand?.groundingMetadata || {};
    const seen = new Set();
    const sources = [];
    for (const c of gm.groundingChunks || []) {
      const uri = c?.web?.uri;
      if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ title: c.web.title || uri, uri }); }
    }
    const usedSearch = Boolean(body.search) && ((gm.webSearchQueries || []).length > 0 || sources.length > 0);

    return send(res, 200, { text, sources: sources.slice(0, 6), usedSearch });
  } catch (e) {
    if (e.name === 'AbortError') return send(res, 504, { error: 'The AI took too long to answer. Please try again.' });
    console.error('AI proxy failure', e);
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
};
