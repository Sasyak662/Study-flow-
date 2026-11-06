// StudyFlow Live: video classes (peer-to-peer WebRTC video; this endpoint relays signalling + class events).
// No account needed. Each browser has a random member id. Everything expires automatically.
// Keys:
//   sf:meet:<code>          JSON meeting {code,title,host,hostName,created,locked,chat,share,ended,classCode,spot,rooms}  (TTL 8 h)
//   sf:meet:<code>:ms       SET of member ids currently in the call
//   sf:meet:<code>:m:<id>   JSON live member state (TTL 25 s, refreshed by sync)
//   sf:meet:<code>:ok       SET of ids allowed in      :ban SET of removed ids
//   sf:meet:<code>:wait     SET of ids waiting;  :w:<id> JSON {id,name,at} (TTL 25 s)
//   sf:meet:<code>:q:<id>   LIST signalling inbox for one member (offer/answer/ice)
//   sf:meet:<code>:ev       LIST of class events;  :seq event counter
//   sf:meet:<code>:att      HASH attendance id -> {name, first, last, mins}
const { configured, cmd, getJSON, send, readBody } = require('./_store');

const TTL = 8 * 3600, MEMBER_TTL = 25, MAX = 30, EV_KEEP = 500;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const okId = id => /^[a-z0-9]{8,32}$/i.test(String(id || ''));
const normCode = c => String(c || '').toLowerCase().replace(/^.*[?&]meet=/, '').replace(/[^a-z]/g, '').slice(0, 10);
const okCode = c => /^[a-z]{10}$/.test(c);
const mk = c => 'sf:meet:' + c;
const EVENTS = ['chat', 'react', 'poll', 'vote', 'pollend', 'wb', 'wbclear', 'wbundo', 'wbopen', 'wbclose', 'cap', 'timer', 'mute', 'muteall', 'lowerhands', 'note',
  'qa', 'qaup', 'qadone', 'pulse', 'pulsereset', 'lq', 'lqa', 'lqr', 'lqend', 'ccall', 'sprint', 'bcast', 'notes'];
const HOST_ONLY = ['poll', 'pollend', 'wbclear', 'wbopen', 'wbclose', 'timer', 'mute', 'muteall', 'lowerhands', 'qadone', 'pulsereset', 'lq', 'lqr', 'lqend', 'ccall', 'sprint', 'bcast', 'notes'];
const HISTORY = ['chat', 'poll', 'vote', 'pollend', 'wb', 'wbclear', 'wbundo', 'wbopen', 'wbclose', 'timer', 'qa', 'qaup', 'qadone', 'pulse', 'pulsereset', 'sprint', 'ccall', 'lq', 'lqr', 'lqend', 'notes'];

function ice() {
  const s = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.MEET_TURN_URL) s.push({ urls: process.env.MEET_TURN_URL.split(',').map(x => x.trim()), username: process.env.MEET_TURN_USER || '', credential: process.env.MEET_TURN_PASS || '' });
  return s;
}
async function pushEvent(code, ev) {
  const seq = await cmd('INCR', mk(code) + ':seq');
  ev.seq = seq; ev.at = Date.now();
  await cmd('RPUSH', mk(code) + ':ev', JSON.stringify(ev));
  if (seq % 20 === 0) { await cmd('LTRIM', mk(code) + ':ev', String(-EV_KEEP), '-1'); await cmd('EXPIRE', mk(code) + ':ev', String(TTL)); await cmd('EXPIRE', mk(code) + ':seq', String(TTL)); }
  if (seq === 1) { await cmd('EXPIRE', mk(code) + ':ev', String(TTL)); await cmd('EXPIRE', mk(code) + ':seq', String(TTL)); }
  return seq;
}
async function members(code) {
  const ids = (await cmd('SMEMBERS', mk(code) + ':ms')) || [];
  const out = [];
  if (ids.length) {
    const vals = await cmd('MGET', ...ids.map(id => mk(code) + ':m:' + id));
    const gone = [];
    vals.forEach((v, i) => { if (v) { try { out.push(JSON.parse(v)); } catch (e) {} } else gone.push(ids[i]); });
    if (gone.length) { await cmd('SREM', mk(code) + ':ms', ...gone); for (const g of gone) await pushEvent(code, { t: 'leave', from: g }); }
  }
  return out.sort((a, b) => (a.joined || 0) - (b.joined || 0));
}
async function waiting(code) {
  const ids = (await cmd('SMEMBERS', mk(code) + ':wait')) || [];
  if (!ids.length) return [];
  const vals = await cmd('MGET', ...ids.map(id => mk(code) + ':w:' + id));
  const out = [], gone = [];
  vals.forEach((v, i) => { if (v) { try { out.push(JSON.parse(v)); } catch (e) {} } else gone.push(ids[i]); });
  if (gone.length) await cmd('SREM', mk(code) + ':wait', ...gone);
  return out;
}
const pubMeet = m => ({ code: m.code, title: m.title, host: m.host, hostName: m.hostName, created: m.created, locked: !!m.locked, chat: m.chat !== false, share: m.share !== false, ended: !!m.ended, classCode: m.classCode || '', spot: m.spot || '', rooms: m.rooms || null, max: MAX });

module.exports = async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { configured: configured(), iceServers: ice(), max: MAX });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!configured()) return send(res, 503, { error: 'Live classes need the StudyFlow server store. Ask the site owner to switch it on.' });
  let b;
  try { b = await readBody(req, 120000); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
  const action = String(b.action || ''), id = String(b.id || '');
  if (!okId(id)) return send(res, 400, { error: 'Missing member id' });
  const name = clean(b.name, 32) || 'Guest';
  try {
    if (action === 'create') {
      let code = '';
      for (let i = 0; i < 8 && !code; i++) {
        const c = Array.from({ length: 10 }, () => 'abcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 25)]).join('');
        const ok = await cmd('SET', mk(c), JSON.stringify({ code: c, title: clean(b.title, 60) || name + "'s class", host: id, hostName: name, created: Date.now(), locked: !!b.locked, chat: true, share: true, ended: false, classCode: clean(b.classCode, 8), spot: '', rooms: null }), 'NX', 'EX', String(TTL));
        if (ok) code = c;
      }
      if (!code) return send(res, 500, { error: 'Could not create a meeting, try again' });
      await cmd('SADD', mk(code) + ':ok', id); await cmd('EXPIRE', mk(code) + ':ok', String(TTL));
      return send(res, 200, { ok: true, code, meeting: pubMeet(await getJSON(mk(code))) });
    }
    const code = normCode(b.code);
    if (!okCode(code)) return send(res, 400, { error: 'Meeting codes look like abc-defg-hij' });
    const m = await getJSON(mk(code));
    if (!m) return send(res, 404, { error: 'That meeting does not exist or has expired' });
    if (m.ended && action !== 'peek') return send(res, 410, { ended: true, error: 'This meeting has ended' });
    const isHost = m.host === id;
    if (!isHost && await cmd('SISMEMBER', mk(code) + ':ban', id)) return send(res, 403, { kicked: true, error: 'You were removed from this meeting' });

    if (action === 'peek') {
      const ms = await members(code);
      return send(res, 200, { ok: true, meeting: pubMeet(m), people: ms.map(x => x.name).slice(0, 8), count: ms.length });
    }
    const inCall = !!(await cmd('SISMEMBER', mk(code) + ':ms', id));
    const admitted = isHost || inCall || !m.locked || !!(await cmd('SISMEMBER', mk(code) + ':ok', id));

    if (action === 'join' || action === 'sync') {
      if (!admitted) {
        await cmd('SET', mk(code) + ':w:' + id, JSON.stringify({ id, name, at: Date.now() }), 'EX', String(MEMBER_TTL));
        await cmd('SADD', mk(code) + ':wait', id); await cmd('EXPIRE', mk(code) + ':wait', String(TTL));
        return send(res, 200, { ok: true, waiting: true, meeting: pubMeet(m) });
      }
      if (!inCall) {
        const n = await cmd('SCARD', mk(code) + ':ms');
        if (n >= MAX) return send(res, 403, { error: 'This live class is full (' + MAX + ' people)' });
      }
      const me = b.me || {};
      const st = { id, name, cam: !!me.cam, mic: !!me.mic, hand: Math.max(0, Number(me.hand) || 0), share: !!me.share, joined: Number(me.joined) || Date.now(), net: Math.max(0, Math.min(3, Number(me.net) || 0)), at: Date.now() };
      await cmd('SET', mk(code) + ':m:' + id, JSON.stringify(st), 'EX', String(MEMBER_TTL));
      if (!inCall || b.hb) {
        // upkeep only on join and every ~10 s heartbeat (keeps storage usage low)
        await cmd('SADD', mk(code) + ':ms', id); await cmd('EXPIRE', mk(code) + ':ms', String(TTL));
        await cmd('SADD', mk(code) + ':ok', id); await cmd('EXPIRE', mk(code) + ':ok', String(TTL));
        if (!inCall) await cmd('SREM', mk(code) + ':wait', id);
        const ak = mk(code) + ':att', a = await cmd('HGET', ak, id);
        let att = null; try { att = a ? JSON.parse(a) : null; } catch (e) {}
        const gap = att ? Date.now() - att.last : 0;
        await cmd('HSET', ak, id, JSON.stringify({ name, first: (att && att.first) || Date.now(), last: Date.now(), mins: (att ? att.mins : 0) + (gap > 0 && gap < 60000 ? gap / 60000 : 0) }));
        await cmd('EXPIRE', ak, String(TTL));
        if (!inCall) await pushEvent(code, { t: 'join', from: id, name });
      }
      const qk = mk(code) + ':q:' + id;
      const raw = (await cmd('LRANGE', qk, '0', '199')) || [];
      if (raw.length) await cmd('LTRIM', qk, String(raw.length), '-1');
      const signals = raw.map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      const since = Math.max(0, Number(b.since) || 0);
      let events = [];
      const seqNow = Number(await cmd('GET', mk(code) + ':seq')) || 0;
      if (seqNow > since) {
        const want = since ? Math.min(EV_KEEP, seqNow - since + 5) : EV_KEEP;
        const evRaw = (await cmd('LRANGE', mk(code) + ':ev', String(-want), '-1')) || [];
        events = evRaw.map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(e => e && e.seq > since);
        if (!since) events = events.filter(e => HISTORY.includes(e.t));
      }
      const out = { ok: true, meeting: pubMeet(m), isHost, members: await members(code), signals, events, seq: seqNow, now: Date.now() };
      if (isHost) out.queue = await waiting(code);
      return send(res, 200, out);
    }

    if (!admitted) return send(res, 403, { error: 'You are not in this meeting yet' });

    if (action === 'signal') {
      const msgs = Array.isArray(b.msgs) ? b.msgs.slice(0, 80) : [];
      const by = {};
      for (const s of msgs) {
        if (!okId(s.to) || !['offer', 'answer', 'ice', 'bye'].includes(s.t)) continue;
        const d = JSON.stringify(s.d == null ? null : s.d);
        if (d.length > 30000) continue;
        (by[s.to] = by[s.to] || []).push(JSON.stringify({ from: id, t: s.t, d: s.d, at: Date.now() }));
      }
      for (const to in by) { const qk = mk(code) + ':q:' + to; await cmd('RPUSH', qk, ...by[to]); await cmd('EXPIRE', qk, '3600'); }
      return send(res, 200, { ok: true });
    }
    if (action === 'event') {
      const t = String(b.t || '');
      if (!EVENTS.includes(t)) return send(res, 400, { error: 'Unknown event' });
      if (HOST_ONLY.includes(t) && !isHost) return send(res, 403, { error: 'Only the host can do that' });
      if (t === 'chat' && m.chat === false && !isHost) return send(res, 403, { error: 'The host turned off chat' });
      const d = b.d == null ? null : b.d;
      if (JSON.stringify(d).length > 16000) return send(res, 400, { error: 'Too big' });
      const seq = await pushEvent(code, { t, from: id, name, d });
      return send(res, 200, { ok: true, seq });
    }
    if (action === 'leave') {
      await cmd('DEL', mk(code) + ':m:' + id); await cmd('SREM', mk(code) + ':ms', id);
      await pushEvent(code, { t: 'leave', from: id, name });
      return send(res, 200, { ok: true });
    }
    // ---- host controls
    if (!isHost) return send(res, 403, { error: 'Only the host can do that' });
    const target = String(b.target || '');
    if (action === 'admit' || action === 'deny') {
      const ids = target === 'all' ? ((await cmd('SMEMBERS', mk(code) + ':wait')) || []) : [target];
      for (const t of ids) {
        if (!okId(t)) continue;
        await cmd('SREM', mk(code) + ':wait', t);
        if (action === 'admit') await cmd('SADD', mk(code) + ':ok', t); else await cmd('SADD', mk(code) + ':ban', t);
      }
      await cmd('EXPIRE', mk(code) + ':ban', String(TTL)); await cmd('EXPIRE', mk(code) + ':ok', String(TTL));
    } else if (action === 'remove') {
      if (!okId(target) || target === id) return send(res, 400, { error: 'Pick someone to remove' });
      await cmd('SADD', mk(code) + ':ban', target); await cmd('EXPIRE', mk(code) + ':ban', String(TTL));
      await cmd('SREM', mk(code) + ':ms', target); await cmd('SREM', mk(code) + ':ok', target); await cmd('DEL', mk(code) + ':m:' + target);
      await pushEvent(code, { t: 'leave', from: target });
    } else if (action === 'settings') {
      if (b.locked != null) m.locked = !!b.locked;
      if (b.chat != null) m.chat = !!b.chat;
      if (b.share != null) m.share = !!b.share;
      if (b.title != null) m.title = clean(b.title, 60) || m.title;
      if (b.spot != null) m.spot = okId(b.spot) ? String(b.spot) : '';
      if (b.rooms !== undefined) {
        const r = b.rooms;
        if (!r) m.rooms = null;
        else {
          const n = Math.max(2, Math.min(10, Number(r.n) || 2)), assign = {};
          Object.keys(r.assign || {}).slice(0, 60).forEach(k => { if (okId(k)) assign[k] = Math.max(0, Math.min(n, Number(r.assign[k]) || 0)); });
          m.rooms = { n, assign, open: !!r.open, ends: Number(r.ends) || 0, names: Array.isArray(r.names) ? r.names.slice(0, 10).map(x => clean(x, 30)) : [] };
        }
      }
      await cmd('SET', mk(code), JSON.stringify(m), 'EX', String(TTL));
    } else if (action === 'end') {
      m.ended = true; await cmd('SET', mk(code), JSON.stringify(m), 'EX', '3600');
    } else if (action === 'attendance') {
      const all = (await cmd('HGETALL', mk(code) + ':att')) || [];
      const rows = [];
      for (let i = 0; i < all.length; i += 2) { try { const a = JSON.parse(all[i + 1]); rows.push({ id: all[i], name: a.name, first: a.first, last: a.last, mins: Math.round(a.mins || 0) }); } catch (e) {} }
      return send(res, 200, { ok: true, rows });
    } else return send(res, 400, { error: 'Unknown action' });
    return send(res, 200, { ok: true, meeting: pubMeet(m) });
  } catch (e) {
    return send(res, 500, { error: 'Live class server error' });
  }
};
