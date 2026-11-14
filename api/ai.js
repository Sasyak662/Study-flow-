// StudyStarx — secure Gemini proxy (Vercel Serverless Function, Node 18+)
// The API key lives ONLY in the GEMINI_API_KEY environment variable and is never sent to the browser.
//
// Request  (POST /api/ai, JSON): { system, messages:[{role,content}], user, temperature, search, codeExecution,
//                                  json (ask for a JSON reply), maxTokens, files:[{mimeType,data(base64)}] }
// Response (200, JSON):          { text, sources:[{title,uri}], usedSearch }
// Error    (4xx/5xx, JSON):      { error }

const S = require('./_store.js');
const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
// Exam papers (a Plus feature) use the stronger Flash model for better questions.
const PAPER_MODEL = (process.env.GEMINI_PAPER_MODEL || 'gemini-3.5-flash').trim();
const PAPER_DAILY = Number(process.env.PAPER_DAILY || 20); // full papers a Plus member can make per day
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_TOTAL_CHARS = 60000;   // total characters accepted per request
const MAX_MESSAGES = 20;         // history turns kept
const TIMEOUT_MS = 55000;
const MAX_FILE_BYTES = 3200000;  // total base64 characters of attached files (Vercel caps a request at about 4.5 MB)
const FILE_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/plain)$/;

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
    if (size > 4400000) throw new Error('Request too large.');
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

  if (!key) return send(res, 500, { error: 'The AI service is not set up on the server yet.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const fastHit = rateLimited(ip);

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Invalid JSON request.' }); }
  // StudyQuest question-bank top-ups have their own small daily allowance, so they never use up AI Coach questions.
  const quest = body && body.purpose === 'quest';
  // The first-day starter pack (quizzes, flashcards, StudyQuest questions) sends many small requests at once;
  // those have their own daily cap below, so the per-minute limit does not block a new student's setup.
  if (fastHit && !(body && body.first === true && (body.purpose === 'quest' || body.purpose === 'setup'))) return send(res, 429, { error: 'You are asking questions very fast. Please wait a minute and try again.' });
  // The starter pack made right after the survey (10 quizzes + flashcards) also has its own allowance.
  const setup = body && body.purpose === 'setup';
  // Exam Paper Maker (Plus only): a fixed kind of system prompt, no files, search or code.
  const paper = body && body.purpose === 'paper';
  if (paper) {
    if (!String(body.system || '').startsWith('You are a senior board examiner') || (Array.isArray(body.files) && body.files.length) || (Array.isArray(body.messages) && body.messages.length)) return send(res, 400, { error: 'Invalid request.' });
    body.search = false; body.codeExecution = false; body.maxTokens = Math.min(Number(body.maxTokens) || 12000, 16000);
    if (String(body.user || '').length > 12000) return send(res, 400, { error: 'Invalid request.' });
  }
  // These two allowances are only for StudyStarx's own quiz builders: no web search, files or code, a fixed kind of system prompt, and a smaller answer size.
  if (quest || setup) {
    const want = quest ? 'You write accurate multiple-choice quiz questions' : 'You write accurate, syllabus-aligned study material';
    if (!String(body.system || '').startsWith(want) || (Array.isArray(body.files) && body.files.length) || (Array.isArray(body.messages) && body.messages.length)) return send(res, 400, { error: 'Invalid request.' });
    body.search = false; body.codeExecution = false; body.maxTokens = Math.min(Number(body.maxTokens) || 8192, quest ? 8192 : 12000);
    if (String(body.user || '').length > 4000) return send(res, 400, { error: 'Invalid request.' });
  }

  // Daily AI limits by plan (only when the Redis/KV store is configured; otherwise just the per-minute limit applies).
  let usageKey = null, limit = null, planNow = 'free', who = 'ip:' + ip;
  if (S.configured()) {
    try {
      const email = S.readSession(req);
      const u = email ? await S.getJSON(S.userKey(email)) : null;
      const plan = S.isPlus(u) ? 'plus' : 'free';planNow = plan;if (u) who = email;
      if (paper && plan !== 'plus') return send(res, 403, { plus: true, error: 'The Exam Paper Maker is part of StudyStarx Plus.' });
      if (paper && body.stage === 'plan') {
        const pk = 'sf:paper:' + who + ':' + S.today();
        const pn = Number(await S.cmd('INCR', pk)) || 0;
        if (pn === 1) await S.cmd('EXPIRE', pk, 172800);
        if (pn > PAPER_DAILY) return send(res, 429, { limit: true, plan, error: 'You have made ' + PAPER_DAILY + ' exam papers today. You can make more tomorrow.' });
      }
      // StudyQuest and starter-pack quizzes count towards the same daily AI allowance as everything else.
      limit = S.LIMITS[plan];
      usageKey = 'sf:usage:' + (u ? email : 'ip:' + ip) + ':' + S.today();
      const used = Number(await S.cmd('INCR', usageKey)) || 0;
      if (used === 1) await S.cmd('EXPIRE', usageKey, 172800);
      // The study pack made right after the survey must always be made, even if today's allowance is used up.
      // It still counts toward today's total, and is capped separately so it cannot be misused.
      let firstOk = false;
      if ((setup || quest) && body.first === true) {
        const fk = 'sf:first:' + who + ':' + S.today();
        const fn = Number(await S.cmd('INCR', fk)) || 0;
        if (fn === 1) await S.cmd('EXPIRE', fk, 172800);
        firstOk = fn <= 45;
      }
      if (used > limit && !firstOk) {
        if (setup || quest) return send(res, 429, { limit: true, quest: true, plan, error: 'You have used today\'s AI allowance, so no new quiz questions can be made until tomorrow.' });
        if (false) return send(res, 429, { limit: true, quest: true, plan, error: 'StudyQuest has made enough new questions for today. More tomorrow!' });
        return send(res, 429, { limit: true, plan, error: plan === 'plus'
          ? `You have used all ${limit} of today's AI questions. Your limit resets tomorrow.`
          : `Your free AI limit for today is over (${limit} questions). Get StudyStarx Plus for ${S.LIMITS.plus} questions a day, or come back tomorrow.`, freeLimit: S.LIMITS.free, plusLimit: S.LIMITS.plus });
      }
    } catch (e) { console.error('usage check failed (allowing request)', e.message); }
  }

  const system = String(body.system || '');
  const contents = buildContents(body.messages, body.user);
  if (!contents.length) return send(res, 400, { error: 'Nothing to answer — the request had no message.' });

  const total = system.length + contents.reduce((n, c) => n + c.parts[0].text.length, 0);
  if (total > MAX_TOTAL_CHARS) return send(res, 413, { error: 'That request is too long. Try a shorter question or fewer pasted notes.' });

  // Optional attachments (photos of answers, PDF pages) go into the last user turn.
  const files = Array.isArray(body.files) ? body.files.slice(0, 4) : [];
  // Daily attachment allowance is checked on the server too (free 3/day, Plus 40/day), so it cannot be bypassed in the browser.
  if (files.length && S.configured()) {
    try {
      const ak = 'sf:att:' + who + ':' + S.today();
      const n = Number(await S.cmd('INCRBY', ak, files.length)) || 0;
      if (n === files.length) await S.cmd('EXPIRE', ak, 172800);
      const cap = planNow === 'plus' ? Number(process.env.AI_PLUS_FILES || 40) : Number(process.env.AI_FREE_FILES || 3);
      if (n > cap) return send(res, 429, { limit: true, plan: planNow, error: planNow === 'plus' ? 'You have attached the most files allowed today. Try again tomorrow.' : 'Free accounts can attach ' + cap + ' files a day. Get StudyStarx Plus to attach up to 40 files a day.' });
    } catch (e) { console.error('attachment check failed', e.message); }
  }
  let fileChars = 0;
  if (files.length && contents[contents.length - 1].role !== 'user') contents.push({ role: 'user', parts: [{ text: 'Use the attached file.' }] });
  for (const f of files) {
    const mimeType = String(f && f.mimeType || '');
    const data = String(f && f.data || '');
    if (!FILE_TYPES.test(mimeType) || !/^[A-Za-z0-9+/=]+$/.test(data)) return send(res, 400, { error: 'Unsupported file. Use a PDF, PNG, JPG or WEBP image.' });
    fileChars += data.length;
    if (fileChars > MAX_FILE_BYTES) return send(res, 413, { error: 'That file is too large. Use a file under about 2 MB, or paste the text instead.' });
    contents[contents.length - 1].parts.push({ inline_data: { mime_type: mimeType, data } });
  }

  const temperature = Math.max(0, Math.min(1, Number(body.temperature) || 0.3));
  const maxOutputTokens = Math.max(1024, Math.min(32768, Number(body.maxTokens) || 8192));
  const payload = { contents, generationConfig: { temperature, maxOutputTokens } };
  if (body.json && !body.search && !body.codeExecution) payload.generationConfig.responseMimeType = 'application/json';
  if (system.trim()) payload.systemInstruction = { parts: [{ text: system }] };

  // Search wins if both are requested (the two tools are not reliably combinable on one call).
  if (body.search) payload.tools = [{ google_search: {} }];
  else if (body.codeExecution) payload.tools = [{ code_execution: {} }];

  // Try the main model with light "thinking" (fast), then a fast fallback model if it is slow, busy or unavailable.
  // exam-paper questions are written in many small parallel pieces: the lightest thinking keeps each piece fast
  const quick = paper && body.stage && body.stage !== 'plan';
  const thinkFor = m => /gemini-(3|4)/.test(m) ? { thinkingLevel: quick ? 'minimal' : 'low' } : /2\.5/.test(m) ? { thinkingBudget: /pro/.test(m) ? 512 : 0 } : null;
  async function callModel(model, ms, useThinking) {
    const p = JSON.parse(JSON.stringify(payload));
    const tc = useThinking ? thinkFor(model) : null;
    if (tc) p.generationConfig.thinkingConfig = tc;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(p), signal: ctrl.signal
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok && r.status === 400 && tc && /think/i.test(json?.error?.message || '')) return callModel(model, ms, false);
      return { r, json };
    } finally { clearTimeout(timer); }
  }
  const FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';
  try {
    let out = null, firstErr = null;
    const primary = paper ? PAPER_MODEL : MODEL;
    try { out = await callModel(primary, paper ? (quick ? 24000 : 30000) : 26000, true); } catch (e) { firstErr = e; }
    // If the stronger exam-paper model fails, the normal model takes over before the backup.
    if (paper && primary !== MODEL && (!out || !out.r.ok)) { try { const o2 = await callModel(MODEL, 22000, true); if (o2.r.ok) { out = o2; firstErr = null; } else if (!out) out = o2; } catch (e) {} }
    const emptyOk = o => o && o.r.ok && !((o.json?.candidates?.[0]?.content?.parts || []).some(p => typeof p.text === 'string' && p.text.trim()));
    // A busy or briefly failing model is tried once more before switching to the backup model, so students rarely see an error.
    if (!paper && out && (out.r.status >= 500 || emptyOk(out))) { try { const again = await callModel(MODEL, 20000, true); if (again.r.ok && !emptyOk(again)) out = again; } catch (e) {} }
    const retry = !out || emptyOk(out) || out.r.status === 429 || out.r.status === 404 || out.r.status >= 500 || (out.r.status === 400 && !/API key/i.test(out.json?.error?.message || ''));
    if (retry && FALLBACK && FALLBACK !== MODEL) {
      console.error('Primary model failed', MODEL, firstErr ? firstErr.name : out.r.status, '- trying', FALLBACK);
      try { out = await callModel(FALLBACK, 28000, true); } catch (e) { if (!out) throw e; }
    } else if (!out) throw firstErr;
    const r = out.r, json = out.json;

    if (!r.ok) {
      const msg = json?.error?.message || `AI service returned HTTP ${r.status}`;
      console.error('Gemini error', r.status, msg);
      if (r.status === 429) return send(res, 429, { error: 'The AI is busy right now (quota reached). Please try again shortly.' });
      if (r.status === 400 && /API key/i.test(msg)) return send(res, 502, { error: 'The AI service is not set up correctly on the server yet.' });
      if (r.status === 401 || r.status === 403) return send(res, 502, { error: 'The AI service is not set up correctly on the server yet.' });
      return send(res, 502, { error: 'The AI service had a problem. Please try again.' });
    }

    if (json?.promptFeedback?.blockReason) {
      return send(res, 422, { error: 'That request was blocked by the AI safety filter. Try rephrasing it.' });
    }

    const cand = json?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const text = parts.map(p => (typeof p.text === 'string' ? p.text : '')).join('').trim();
    const codeRan = parts.some(p => p.codeExecutionResult && /OK/i.test(String(p.codeExecutionResult.outcome || '')));
    if (!text) return send(res, 502, { error: 'The AI returned an empty answer' + (cand?.finishReason ? ` (${cand.finishReason})` : '') + '.' });

    const gm = cand?.groundingMetadata || {};
    const seen = new Set();
    const sources = [];
    for (const c of gm.groundingChunks || []) {
      const uri = c?.web?.uri;
      if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ title: c.web.title || uri, uri }); }
    }
    const usedSearch = Boolean(body.search) && ((gm.webSearchQueries || []).length > 0 || sources.length > 0);

    return send(res, 200, { text, sources: sources.slice(0, 6), usedSearch, codeRan });
  } catch (e) {
    if (e.name === 'AbortError') return send(res, 504, { error: 'The AI took too long to answer. Please try again.' });
    console.error('AI proxy failure', e);
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  }
};
