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
