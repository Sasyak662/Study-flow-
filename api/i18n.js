// StudyFlow interface translation.
// POST /api/i18n {lang, strings:[...]} -> {lang, t:{original: translated}}
// Translations are saved in the store per language, so each piece of text is translated once and then shared by everyone.
// Uses GEMINI_API_KEY (server only). Does not count towards anyone's daily AI allowance.
const crypto = require('crypto');
const S = require('./_store.js');
const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
const MAX_STRINGS = 80, MAX_LEN = 300;
const hits = new Map();
const h = t => crypto.createHash('sha1').update(t).digest('base64url').slice(0, 20);

function normLang(l) {
  const v = String(l || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L} ()\-]{2,30}$/u.test(v)) return '';
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return S.send(res, 405, { error: 'Method not allowed.' }); }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000); arr.push(now); hits.set(ip, arr);
  if (arr.length > 150) return S.send(res, 429, { error: 'Too many requests.' });
  let body;
  try { body = await S.readBody(req, 60000); } catch (e) { return S.send(res, 400, { error: 'Invalid request.' }); }
  const lang = normLang(body.lang);
  if (!lang || /^english$/i.test(lang)) return S.send(res, 400, { error: 'Unsupported language.' });
  const strings = [...new Set((Array.isArray(body.strings) ? body.strings : []).map(x => String(x || '').trim()).filter(x => x && x.length <= MAX_LEN))].slice(0, MAX_STRINGS);
  if (!strings.length) return S.send(res, 200, { lang, t: {} });

  const key = 'sf:i18n:' + lang.toLowerCase();
  const out = {}; let missing = strings;
  if (S.configured()) {
    try {
      const got = await S.cmd('HMGET', key, ...strings.map(h));
      missing = [];
      strings.forEach((s, i) => { if (got && got[i]) out[s] = got[i]; else missing.push(s); });
    } catch (e) { missing = strings; }
  }
  if (!missing.length) return S.send(res, 200, { lang, t: out });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return S.send(res, 200, { lang, t: out });
  try {
    const prompt = 'Translate each item of this JSON array of short app interface texts (a study app for school and college students) from English into ' + lang + '. Keep the meaning, keep it short and natural for app buttons and labels, keep emojis, numbers, symbols and the brand name "StudyFlow" unchanged, and keep words like IB, IGCSE, CBSE, AI and Plus unchanged. Return ONLY a JSON array of strings in the same order with exactly ' + missing.length + ' items.\n' + JSON.stringify(missing);
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' } })
    }).finally(() => clearTimeout(timer));
    const j = await r.json().catch(() => ({}));
    const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    let list = []; try { list = JSON.parse(text); } catch (e) {}
    if (Array.isArray(list) && list.length === missing.length) {
      const pairs = [];
      missing.forEach((s, i) => { const v = String(list[i] || '').trim().slice(0, MAX_LEN * 2); if (v) { out[s] = v; pairs.push(h(s), v); } });
      if (pairs.length && S.configured()) { try { await S.cmd('HSET', key, ...pairs); } catch (e) {} }
    }
  } catch (e) { /* the app keeps showing English for anything not translated */ }
  return S.send(res, 200, { lang, t: out });
};
