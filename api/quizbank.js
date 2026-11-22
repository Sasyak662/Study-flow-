// Shared quiz bank for Quiz Studio.
//  - When a Plus student makes an AI quiz, it is saved here under its topic, subject, difficulty and level.
//  - When anyone asks for the same topic again, they get that saved quiz straight away (no AI needed).
//  - Every request is counted, so the owner can see which subjects and topics students ask for.
const crypto = require('crypto');
const { configured, cmd, getJSON, readSession, userKey, isPlus, isLifetime, send, readBody } = require('./_store');

const LEVELS = ['basic', 'medium', 'hard'];
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
// "Photosynthesis!" / "photosynthesis " / "PHOTOSYNTHESIS" all count as the same topic
const norm = s => clip(s, 120).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ऀ-ॿ؀-ۿ一-鿿 ]+/g, ' ').replace(/\b(the|a|an|of|and|in|on|for|about|quiz|questions?)\b/g, ' ')
  .replace(/\s+/g, ' ').trim().replace(/(\w{4,})s\b/g, '$1');
const diffOf = d => (LEVELS.includes(String(d).toLowerCase()) ? String(d).toLowerCase() : 'medium');
const keyFor = (topic, subject, diff, level) => 'qb:q:' + crypto.createHash('sha1').update([norm(topic), norm(subject), diffOf(diff), norm(level)].join('|')).digest('hex');

function cleanQuiz(q) {
  const qs = (Array.isArray(q && q.questions) ? q.questions : []).slice(0, 20).map(x => {
    const options = (Array.isArray(x.options) ? x.options : []).slice(0, 4).map(o => clip(o, 160));
    const correct = Number(x.correct);
    return { text: clip(x.text, 400), options, correct, explain: clip(x.explain, 400), time: Math.max(5, Math.min(120, Number(x.time) || 20)) };
  }).filter(x => x.text && x.options.length === 4 && x.options.every(Boolean) && Number.isInteger(x.correct) && x.correct >= 0 && x.correct < 4);
  return qs;
}
async function count(subject, topic, diff) {
  const sub = clip(subject, 60) || 'No subject';
  const top = clip(topic, 80).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  try {
    await Promise.all([
      cmd('HINCRBY', 'qb:stat:subjects', sub, 1),
      cmd('HINCRBY', 'qb:stat:topics', sub + ' | ' + top, 1),
      cmd('HINCRBY', 'qb:stat:diff', diffOf(diff), 1)
    ]);
  } catch (e) {}
}
const top = (flat, n) => { const o = []; for (let i = 0; i < (flat || []).length; i += 2) o.push({ name: flat[i], n: Number(flat[i + 1]) || 0 }); return o.sort((a, b) => b.n - a.n).slice(0, n); };


/* ===== Quiz party ===== */
const QT = 20000, RT = 5000, LEAD = 4000; // question time, reveal time, countdown before the first question
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rid = n => Array.from(crypto.randomBytes(n), x => ALPH[x % ALPH.length]).join('');
const cleanName = n => clip(n, 18).replace(/[<>]/g, '') || 'Player';
async function room(code) { return code ? await getJSON('qp:' + code) : null; }
function phaseOf(r, now) {
  if (!r.startAt) return { phase: 'lobby', q: -1 };
  if (now < r.startAt) return { phase: 'countdown', q: -1, endsAt: r.startAt };
  const slot = QT + RT, i = Math.floor((now - r.startAt) / slot);
  if (i >= r.questions.length) return { phase: 'done', q: r.questions.length };
  const t0 = r.startAt + i * slot;
  return now < t0 + QT ? { phase: 'question', q: i, endsAt: t0 + QT, startedAt: t0 } : { phase: 'reveal', q: i, endsAt: t0 + slot };
}
async function players(code) {
  const ids = (await cmd('SMEMBERS', 'qp:' + code + ':ps')) || [];
  if (!ids.length) return [];
  const vals = await cmd('MGET', ...ids.map(x => 'qp:' + code + ':p:' + x));
  return ids.map((id, k) => { try { const v = JSON.parse(vals[k]); v.id = id; return v; } catch (e) { return null; } }).filter(Boolean);
}
async function party(req, res, b) {
  const now = Date.now(), act = b.action, code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (act === 'party_create') {
    const rk = 'qp:rate:' + ip; const n = Number(await cmd('INCR', rk)) || 0; if (n === 1) await cmd('EXPIRE', rk, 3600);
    if (n > 20) return send(res, 429, { error: 'Too many games made from this network. Try again later.' });
    const questions = cleanQuiz(b.quiz);
    if (questions.length < 2) return send(res, 400, { error: 'Pick a quiz with at least 2 questions.' });
    let c = ''; for (let t = 0; t < 6; t++) { c = rid(5); if (!(await cmd('EXISTS', 'qp:' + c))) break; }
    const hostKey = crypto.randomBytes(12).toString('hex'), pid = rid(8);
    await cmd('SET', 'qp:' + c, JSON.stringify({ title: clip(b.quiz && b.quiz.title, 80) || 'Quiz', questions, hostKey, host: pid, created: now, startAt: 0 }), 'EX', 7200);
    await cmd('SET', 'qp:' + c + ':p:' + pid, JSON.stringify({ name: cleanName(b.name), score: 0, ans: {}, host: true }), 'EX', 7200);
    await cmd('SADD', 'qp:' + c + ':ps', pid); await cmd('EXPIRE', 'qp:' + c + ':ps', 7200);
    cmd('INCR', 'qp:stat:games').catch(() => {});
    return send(res, 200, { code: c, hostKey, pid, now });
  }
  const r = await room(code);
  if (!r) return send(res, 404, { error: 'No game with that code. Check the code and try again.' });
  const ph = phaseOf(r, now);
  if (act === 'party_join') {
    if (ph.phase !== 'lobby') return send(res, 409, { error: 'This game has already started.' });
    const ps = (await cmd('SMEMBERS', 'qp:' + code + ':ps')) || [];
    if (ps.length >= 40) return send(res, 409, { error: 'This game is full (40 players).' });
    const pid = rid(8);
    await cmd('SET', 'qp:' + code + ':p:' + pid, JSON.stringify({ name: cleanName(b.name), score: 0, ans: {} }), 'EX', 7200);
    await cmd('SADD', 'qp:' + code + ':ps', pid);
    return send(res, 200, { code, pid, title: r.title, count: r.questions.length, now });
  }
  if (act === 'party_start') {
    if (String(b.hostKey || '') !== r.hostKey) return send(res, 403, { error: 'Only the host can start.' });
    if (ph.phase !== 'lobby') return send(res, 200, { ok: true });
    r.startAt = now + LEAD; await cmd('SET', 'qp:' + code, JSON.stringify(r), 'EX', 7200);
    return send(res, 200, { ok: true, startAt: r.startAt, now });
  }
  const pid = String(b.pid || '').replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (act === 'party_answer') {
    if (ph.phase !== 'question' || Number(b.q) !== ph.q) return send(res, 409, { error: 'Too late for that question.' });
    const key = 'qp:' + code + ':p:' + pid; const me = await getJSON(key);
    if (!me) return send(res, 404, { error: 'You are not in this game.' });
    if (me.ans[ph.q] != null) return send(res, 200, { ok: true, already: true });
    const ch = Number(b.choice), qn = r.questions[ph.q], right = ch === qn.correct;
    const pts = right ? Math.round(500 + 500 * Math.max(0, ph.endsAt - now) / QT) : 0;
    me.ans[ph.q] = [ch, pts]; me.score = (me.score || 0) + pts; me.streak = right ? (me.streak || 0) + 1 : 0;
    await cmd('SET', key, JSON.stringify(me), 'EX', 7200);
    return send(res, 200, { ok: true });
  }
  if (act === 'party_state') {
    const ps = await players(code);
    const me = ps.find(p => p.id === pid);
    const board = ps.map(p => ({ id: p.id, name: p.name, score: p.score || 0, host: !!p.host })).sort((x, y) => y.score - x.score);
    const out = { now, phase: ph.phase, q: ph.q, endsAt: ph.endsAt || 0, startedAt: ph.startedAt || 0, title: r.title, count: r.questions.length, players: board.slice(0, 40), total: board.length, isHost: String(b.hostKey || '') === r.hostKey };
    if (ph.phase === 'question' || ph.phase === 'reveal') {
      const qn = r.questions[ph.q];
      out.question = { text: qn.text, options: qn.options };
      out.answered = ps.filter(p => p.ans && p.ans[ph.q] != null).length;
      if (me && me.ans && me.ans[ph.q] != null) out.mine = me.ans[ph.q];
      if (ph.phase === 'reveal') { out.correct = qn.correct; out.explain = qn.explain || ''; out.counts = [0, 1, 2, 3].map(o => ps.filter(p => p.ans && p.ans[ph.q] && p.ans[ph.q][0] === o).length); }
    }
    if (me) { out.me = { score: me.score || 0, rank: board.findIndex(p => p.id === pid) + 1, streak: me.streak || 0 }; }
    return send(res, 200, out);
  }
  return send(res, 400, { error: 'Unknown action.' });
}

module.exports = async (req, res) => {
  if (!configured()) return send(res, 503, { error: 'Quiz bank is not set up.' });
  try {
    if (req.method === 'GET') {
      // Owner-only: what students are asking for
      const email = readSession(req);
      if (!email || !isLifetime(email)) return send(res, 403, { error: 'Owner only.' });
      const [s, t, d, total, cr, hits, made, asks] = await Promise.all([cmd('HGETALL', 'qb:stat:subjects'), cmd('HGETALL', 'qb:stat:topics'), cmd('HGETALL', 'qb:stat:diff'), cmd('GET', 'qb:count'), cmd('HGETALL', 'qb:stat:created'), cmd('GET', 'qb:hits'), cmd('GET', 'qb:made'), cmd('GET', 'qb:asks')]);
      return send(res, 200, { subjects: top(s, 30), topics: top(t, 50), difficulty: top(d, 3), created: top(cr, 30), saved: Number(total) || 0, hits: Number(hits) || 0, made: Number(made) || 0, asks: Number(asks) || 0 });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
    const b = await readBody(req, 300000);
    // ---------- Quiz party: play a quiz live with friends (room code, no AI used) ----------
    if (String(b.action || '').startsWith('party_')) return party(req, res, b);
    const topic = clip(b.topic, 120), subject = clip(b.subject, 60), diff = diffOf(b.difficulty), level = clip(b.level, 40);
    if (!norm(topic)) return send(res, 400, { error: 'Type a topic.' });
    const key = keyFor(topic, subject, diff, level);

    if (b.action === 'get') {
      count(subject, topic, diff);
      cmd('INCR', 'qb:asks').catch(() => {});
      const want = Math.max(1, Math.min(20, Number(b.count) || 10));
      const saved = await getJSON(key);
      if (!saved || !Array.isArray(saved.questions) || saved.questions.length < want) return send(res, 200, { hit: false });
      cmd('HINCRBY', key + ':m', 'served', 1).catch(() => {});
      cmd('INCR', 'qb:hits').catch(() => {});
      return send(res, 200, { hit: true, quiz: { title: saved.title, topic: saved.topic, subject: saved.subject, difficulty: saved.difficulty, questions: saved.questions.slice(0, want) } });
    }

    if (b.action === 'put') {
      // Only signed-in Plus students' AI quizzes are saved to the shared bank
      const email = readSession(req);
      if (!email) return send(res, 401, { error: 'Sign in first.' });
      const u = await getJSON(userKey(email));
      if (!isPlus(u) && !isLifetime(email)) return send(res, 403, { error: 'Plus only.' });
      const questions = cleanQuiz(b.quiz);
      if (questions.length < 3) return send(res, 400, { error: 'Not enough good questions.' });
      const label = (subject || 'No subject') + ' | ' + topic.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
      cmd('INCR', 'qb:made').catch(() => {});
      cmd('HINCRBY', 'qb:stat:created', label, 1).catch(() => {});
      const old = await getJSON(key);
      if (old && Array.isArray(old.questions) && old.questions.length >= questions.length) return send(res, 200, { saved: false, reason: 'already saved' });
      const rec = { title: clip(b.quiz && b.quiz.title, 80) || topic, topic, subject, difficulty: diff, level, questions, at: Date.now() };
      await cmd('SET', key, JSON.stringify(rec));
      if (!old) await cmd('INCR', 'qb:count');
      return send(res, 200, { saved: true });
    }
    return send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    return send(res, 500, { error: 'Quiz bank error.' });
  }
};
