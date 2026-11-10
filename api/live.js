// Live quiz games (Kahoot-style): a host shows a game PIN, players join on their phones,
// everyone answers the same question at the same time and the server keeps the score.
// Keys (expire after 3 hours):
//   sf:kq:<PIN>      JSON game {pin,host,title,qs:[{text,options,correct,time}],phase,qi,startAt,created}
//   sf:kq:<PIN>:p    HASH  playerId -> JSON {id,name,score,streak,last:{qi,c,ok,pts}}
const { configured, cmd, getJSON, send, readBody } = require('./_store');

const TTL = 3 * 3600, MAX_PLAYERS = 80, MAX_Q = 50, READY_MS = 3500;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const okId = id => /^[a-z0-9]{8,32}$/i.test(String(id || ''));
const okPin = p => /^\d{6}$/.test(String(p || ''));
const gk = p => 'sf:kq:' + p;

async function saveGame(g) { await cmd('SET', gk(g.pin), JSON.stringify(g), 'EX', String(TTL)); }
async function players(pin) {
  const raw = (await cmd('HGETALL', gk(pin) + ':p')) || [];
  const out = [];
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { try { out.push(JSON.parse(raw[i])); } catch (e) {} } }
  else if (raw && typeof raw === 'object') { Object.values(raw).forEach(v => { try { out.push(JSON.parse(v)); } catch (e) {} }); }
  return out;
}
function board(ps) { return ps.slice().sort((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, streak: p.streak })); }

function view(g, me, ps, isHost) {
  const now = Date.now();
  const q = g.qs[g.qi];
  const out = { pin: g.pin, title: g.title, phase: g.phase, qi: g.qi, total: g.qs.length, startAt: g.startAt, now, host: isHost };
  if (q && (g.phase === 'q' || g.phase === 'reveal')) {
    out.q = { text: q.text, options: q.options, time: q.time };
    if (g.phase === 'reveal') {
      out.q.correct = q.correct;
      const counts = [0, 0, 0, 0];
      ps.forEach(p => { if (p.last && p.last.qi === g.qi && p.last.c >= 0 && p.last.c < 4) counts[p.last.c]++; });
      out.counts = counts;
    }
  }
  if (g.phase === 'q') out.answered = ps.filter(p => p.last && p.last.qi === g.qi).length;
  out.players = ps.length;
  if (g.phase === 'lobby' || isHost) out.names = ps.map(p => p.name).slice(0, MAX_PLAYERS);
  // Other players' secret ids are never sent out, so nobody can answer on someone else's behalf.
  if (g.phase === 'reveal' || g.phase === 'end' || isHost) out.board = board(ps).slice(0, g.phase === 'end' ? 10 : 5).map(x => ({ rank: x.rank, name: x.name, score: x.score, streak: x.streak, id: me && x.id === me.id ? x.id : undefined }));
  if (me) {
    const b = board(ps), mine = b.find(x => x.id === me.id);
    out.me = { name: me.name, score: me.score, streak: me.streak, rank: mine ? mine.rank : null, last: me.last && me.last.qi === g.qi ? me.last : null };
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { configured: configured() });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!configured()) return send(res, 503, { error: 'Live games need the StudyFlow server store. Ask the site owner to switch it on.' });
  let b;
  try { b = await readBody(req, 200000); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
  const action = String(b.action || ''), id = String(b.id || '');
  if (!okId(id)) return send(res, 400, { error: 'Missing player id' });
  try {
    if (action === 'create') {
      const quiz = b.quiz || {};
      const qs = (Array.isArray(quiz.questions) ? quiz.questions : []).slice(0, MAX_Q).map(q => ({
        text: clean(q.text, 300),
        options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map(o => clean(o, 120)),
        correct: Math.max(0, Math.min(3, Number(q.correct) || 0)),
        time: Math.max(5, Math.min(120, Number(q.time) || 20))
      })).filter(q => q.text && q.options.length >= 2 && q.options.every(Boolean) && q.correct < q.options.length);
      if (!qs.length) return send(res, 400, { error: 'This quiz has no complete questions' });
      let pin = '';
      for (let i = 0; i < 10; i++) {
        const p = String(Math.floor(100000 + Math.random() * 900000));
        const g = { pin: p, host: id, title: clean(quiz.title, 80) || 'StudyFlow quiz', qs, phase: 'lobby', qi: -1, startAt: 0, created: Date.now() };
        const ok = await cmd('SET', gk(p), JSON.stringify(g), 'NX', 'EX', String(TTL));
        if (ok) { pin = p; break; }
      }
      if (!pin) return send(res, 500, { error: 'Could not create a game, try again' });
      b.pin = pin;
    }
    const pin = String(b.pin || '');
    if (!okPin(pin)) return send(res, 400, { error: 'Game PINs are 6 digits' });
    const g = await getJSON(gk(pin));
    if (!g) return send(res, 404, { error: 'No game with that PIN (it may have ended)' });
    const isHost = g.host === id;
    const pkey = gk(pin) + ':p';

    if (action === 'join') {
      if (g.phase === 'end') return send(res, 403, { error: 'This game has finished' });
      let meRaw = await cmd('HGET', pkey, id);
      if (!meRaw) {
        const n = await cmd('HLEN', pkey);
        if (n >= MAX_PLAYERS) return send(res, 403, { error: 'This game is full' });
        const ps = await players(pin);
        let name = clean(b.name, 20) || 'Player';
        const taken = new Set(ps.map(p => p.name.toLowerCase()));
        let base = name, k = 2; while (taken.has(name.toLowerCase())) name = base.slice(0, 17) + ' ' + (k++);
        const me = { id, name, score: 0, streak: 0, last: null };
        await cmd('HSET', pkey, id, JSON.stringify(me));
        await cmd('EXPIRE', pkey, String(TTL));
      }
    } else if (action === 'answer') {
      if (g.phase !== 'q' || Number(b.qi) !== g.qi) return send(res, 409, { error: 'Too late for that question' });
      const raw = await cmd('HGET', pkey, id);
      if (!raw) return send(res, 403, { error: 'Join the game first' });
      const me = JSON.parse(raw);
      if (me.last && me.last.qi === g.qi) return send(res, 409, { error: 'You already answered' });
      const q = g.qs[g.qi], now = Date.now(), el = now - g.startAt, lim = q.time * 1000;
      if (el < -500) return send(res, 409, { error: 'Wait for the question' });
      if (el > lim + 1500) return send(res, 409, { error: 'Time is up' });
      const c = Math.max(-1, Math.min(3, Number(b.c)));
      const ok = c === q.correct;
      let pts = 0;
      if (ok) {
        me.streak = (me.streak || 0) + 1;
        pts = Math.round(1000 * (1 - Math.max(0, Math.min(1, el / lim)) / 2)) + Math.min(5, me.streak - 1) * 100;
      } else me.streak = 0;
      me.score = (me.score || 0) + pts;
      me.last = { qi: g.qi, c, ok, pts, ms: Math.max(0, el) };
      await cmd('HSET', pkey, id, JSON.stringify(me));
    } else if (action === 'start' || action === 'next' || action === 'reveal' || action === 'end') {
      if (!isHost) return send(res, 403, { error: 'Only the host can do that' });
      if (action === 'start' || action === 'next') {
        if (g.qi + 1 >= g.qs.length) g.phase = 'end';
        else { g.qi += 1; g.phase = 'q'; g.startAt = Date.now() + READY_MS; }
      } else if (action === 'reveal') { if (g.phase === 'q') g.phase = 'reveal'; }
      else g.phase = 'end';
      await saveGame(g);
    } else if (action !== 'state' && action !== 'create') {
      return send(res, 400, { error: 'Unknown action' });
    }
    const ps = await players(pin);
    const meRaw = await cmd('HGET', pkey, id);
    const me = meRaw ? JSON.parse(meRaw) : null;
    return send(res, 200, { ok: true, game: view(g, me, ps, isHost) });
  } catch (e) {
    return send(res, 500, { error: 'Live game server error' });
  }
};
