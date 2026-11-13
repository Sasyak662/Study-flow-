// StudyStarx read-aloud: turns a short piece of text into natural speech with Gemini's AI voices.
// The API key lives ONLY in the GEMINI_API_KEY environment variable and is never sent to the browser.
const S = require('./_store.js');

const VOICES = { warm: 'Sulafat', friendly: 'Achird', calm: 'Vindemiatrix', clear: 'Iapetus', bright: 'Autonoe', deep: 'Charon' };
const STYLE = 'a warm, friendly and encouraging teacher explaining to a school student; lively, upbeat and brisk — speak at a quick natural conversational pace, never slow or drawn out, with short pauses only; gentle Indian English';
// newest first; each is tried until one answers
const MODELS = [
  { id: 'gemini-3.8-flash-lite-tts', shape: 'new' },
  { id: 'gemini-3.8-flash-tts', shape: 'new' },
  { id: 'gemini-3.1-flash-tts-preview', shape: 'old' },
  { id: 'gemini-2.5-flash-preview-tts', shape: 'old' }
];
const DAILY = { free: 90, plus: 600 }; // pieces per day (one answer is usually 1–4 pieces)
const hits = new Map();

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function body(shape, text, voice) {
  if (shape === 'new') return { contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: STYLE } }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } } };
  return { contents: [{ parts: [{ text: 'Say this as ' + STYLE + ': ' + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
}

module.exports = async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (req.method !== 'POST') return S.send(res, 405, { error: 'POST only' });
  if (!key) return S.send(res, 503, { error: 'Voice is not set up yet.' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'x';
  // short burst limit per server instance
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000); arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  if (arr.length > 30) return S.send(res, 429, { error: 'Too many read-alouds at once. Wait a minute.' });
  let b; try { b = await S.readBody(req, 20000); } catch (e) { return S.send(res, 400, { error: 'Invalid request' }); }
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!text) return S.send(res, 400, { error: 'Nothing to read' });
  const voice = VOICES[b.voice] || VOICES.warm;
  // daily limit (when the store is set up)
  try {
    if (S.configured()) {
      const who = S.readSession(req);
      let plus = false; if (who) { try { plus = S.isPlus(await S.getJSON(S.userKey(who))); } catch (e) {} }
      const k = 'sf:tts:' + (who || 'ip:' + ip) + ':' + S.today();
      const n = Number(await S.cmd('INCR', k)); if (n === 1) await S.cmd('EXPIRE', k, '90000');
      if (n > (plus ? DAILY.plus : DAILY.free)) return S.send(res, 429, { error: 'You have used today’s AI voice. The phone’s own voice will read instead.', limit: true });
    }
  } catch (e) {}
  let lastErr = '';
  for (const m of MODELS) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(m.shape, text, voice)), signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { lastErr = m.id + ': ' + (j?.error?.message || r.status); continue; }
      const part = (j?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
      const inl = part && (part.inlineData || part.inline_data);
      if (!inl || !inl.data) { lastErr = m.id + ': no audio'; continue; }
      let buf = Buffer.from(inl.data, 'base64'); const mime = String(inl.mimeType || inl.mime_type || '');
      if (buf.slice(0, 4).toString() !== 'RIFF') { const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000; buf = wav(buf, rate); }
      res.statusCode = 200; res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Voice-Model', m.id);
      return res.end(buf);
    } catch (e) { lastErr = m.id + ': ' + (e.name === 'AbortError' ? 'timeout' : e.message); }
    finally { clearTimeout(timer); }
  }
  return S.send(res, 502, { error: 'The AI voice is busy right now.', detail: lastErr.slice(0, 300) });
};
