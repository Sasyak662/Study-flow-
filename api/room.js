// Group focus rooms: study "together" with a shared code.
// No account needed. Each browser has a random member id; members send a heartbeat every ~15 s.
// Keys (all expire automatically):
//   sf:room:<CODE>            JSON {code,name,host,created,sprint:{startAt,minutes}|null}   (TTL 12 h)
//   sf:room:<CODE>:ms         SET of member ids                                              (TTL 12 h)
//   sf:room:<CODE>:m:<id>     JSON {id,name,status,subject,left,at}                           (TTL 60 s)
const { configured, cmd, getJSON, send, readBody } = require('./_store');

const ROOM_TTL = 12 * 3600, MEMBER_TTL = 60, MAX_MEMBERS = 30;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const okId = id => /^[a-z0-9]{8,32}$/i.test(String(id || ''));
const okCode = c => /^[A-Z2-9]{6}$/.test(String(c || ''));
const STATUSES = ['focusing', 'break', 'paused', 'idle'];
const rk = c => 'sf:room:' + c;

async function roomState(code) {
  const room = await getJSON(rk(code));
  if (!room) return null;
  const ids = (await cmd('SMEMBERS', rk(code) + ':ms')) || [];
  let members = [];
  if (ids.length) {
    const vals = await cmd('MGET', ...ids.map(id => rk(code) + ':m:' + id));
    const gone = [];
    vals.forEach((v, i) => { if (v) { try { members.push(JSON.parse(v)); } catch (e) {} } else gone.push(ids[i]); });
    if (gone.length) await cmd('SREM', rk(code) + ':ms', ...gone);
  }
  members.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { ...room, members, now: Date.now() };
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { configured: configured() });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!configured()) return send(res, 503, { error: 'Group rooms need the StudyFlow server store. Ask the site owner to switch it on.' });
  let b;
  try { b = await readBody(req, 20000); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
  const action = String(b.action || '');
  const id = String(b.id || '');
  if (!okId(id)) return send(res, 400, { error: 'Missing member id' });
  const name = clean(b.name, 24) || 'Student';
  try {
    if (action === 'create') {
      let code = '';
      for (let i = 0; i < 8; i++) {
        code = Array.from({ length: 6 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
        const set = await cmd('SET', rk(code), JSON.stringify({ code, name: clean(b.room, 40) || name + "'s room", host: id, created: Date.now(), sprint: null }), 'NX', 'EX', String(ROOM_TTL));
        if (set) break; code = '';
      }
      if (!code) return send(res, 500, { error: 'Could not create a room, try again' });
      b.code = code;
    }
    const code = String(b.code || '').toUpperCase();
    if (!okCode(code)) return send(res, 400, { error: 'Room codes are 6 letters or numbers' });
    const room = await getJSON(rk(code));
    if (!room) return send(res, 404, { error: 'That room does not exist or has expired' });

    if (action === 'create' || action === 'join' || action === 'beat') {
      const isMember = await cmd('SISMEMBER', rk(code) + ':ms', id);
      if (!isMember) {
        const n = await cmd('SCARD', rk(code) + ':ms');
        if (n >= MAX_MEMBERS) return send(res, 403, { error: 'This room is full (30 people)' });
      }
      const status = STATUSES.includes(b.status) ? b.status : 'idle';
      const m = { id, name, status, subject: clean(b.subject, 30), left: Math.max(0, Math.min(86400, Number(b.left) || 0)), mins: Math.max(0, Math.min(1440, Number(b.mins) || 0)), at: Date.now() };
      await cmd('SET', rk(code) + ':m:' + id, JSON.stringify(m), 'EX', String(MEMBER_TTL));
      await cmd('SADD', rk(code) + ':ms', id);
      await cmd('EXPIRE', rk(code) + ':ms', String(ROOM_TTL));
      await cmd('EXPIRE', rk(code), String(ROOM_TTL));
    } else if (action === 'leave') {
      await cmd('DEL', rk(code) + ':m:' + id);
      await cmd('SREM', rk(code) + ':ms', id);
    } else if (action === 'sprint') {
      if (room.host !== id) return send(res, 403, { error: 'Only the person who made the room can start a sprint' });
      const minutes = Math.max(5, Math.min(180, Number(b.minutes) || 25));
      room.sprint = b.stop ? null : { startAt: Date.now() + 10000, minutes };
      await cmd('SET', rk(code), JSON.stringify(room), 'EX', String(ROOM_TTL));
    } else if (action !== 'state') {
      return send(res, 400, { error: 'Unknown action' });
    }
    // Hide everyone's secret member id (and the host's), so nobody can pretend to be someone else in the room.
    const st = await roomState(code);
    st.members = st.members.map(m => ({ ...m, id: m.id === id ? id : undefined }));
    st.host = st.host === id ? id : undefined;
    return send(res, 200, { ok: true, room: st });
  } catch (e) {
    return send(res, 500, { error: 'Room server error' });
  }
};
