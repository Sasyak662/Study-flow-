// StudyStarx Classes: teachers create a class, students join with a code, teachers see a progress summary and set assignments.
// POST /api/class  (Bearer token from /api/account)  { action, ... }
//   create   {name}                                   -> {code}
//   join     {code, name}                             -> {ok}
//   leave    {code}                                   -> {ok}
//   mine                                              -> {teaching:[...], joined:[...]}
//   roster   {code}                (teacher)         -> {cls, students:[{email,name,updated,summary}]}
//   assign   {code,title,subject,topic,due,note} (teacher) -> {cls}
//   unassign {code,id}             (teacher)         -> {cls}
//   remove   {code,email}          (teacher)         -> {ok}
//   close    {code}                (teacher)         -> {ok}
//   golive   {code, meet, title}   (teacher)         -> {cls}   start a StudyStarx Live video class
//   endlive  {code}                (teacher)         -> {cls}
//   report   {name, summary}       (student; sent to every class they joined) -> {ok, classes}
// Students choose to join and can leave at any time; only the summary they send is shared, never their notes or chats.
const crypto = require('crypto');
const S = require('./_store.js');

const MAX_TEACH = 10, MAX_JOIN = 10, MAX_STUDENTS = 200, MAX_ASSIGN = 60, MAX_SUMMARY = 8000;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), b => ALPH[b % ALPH.length]).join('');
const ck = c => 'sf:class:' + c;
const listGet = async k => (await S.getJSON(k)) || [];
const pub = c => ({ code: c.code, name: c.name, teacherName: c.teacherName || '', created: c.created, assignments: c.assignments || [], studentCount: (c.students || []).length, live: c.live && Date.now() - c.live.at < 8 * 3600e3 ? c.live : null });

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return S.send(res, 200, { configured: S.configured() });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return S.send(res, 405, { error: 'Method not allowed.' }); }
  if (!S.configured()) return S.send(res, 503, { configured: false, error: 'Classes need accounts, which are not switched on for this website yet.' });
  let body;
  try { body = await S.readBody(req, 60000); } catch (e) { return S.send(res, 400, { error: 'Invalid request.' }); }
  const email = S.readSession(req);
  if (!email) return S.send(res, 401, { error: 'Log in to your StudyStarx account to use Classes.', signedOut: true });
  const action = String(body.action || '');
  const tk = 'sf:tclasses:' + email, sk = 'sf:sclasses:' + email;

  async function own(code) {
    const c = await S.getJSON(ck(normCode(code)));
    if (!c) { const e = new Error('That class code was not found.'); e.status = 404; throw e; }
    if (c.teacher !== email) { const e = new Error('Only the teacher who created this class can do that.'); e.status = 403; throw e; }
    return c;
  }

  try {
    if (action === 'create') {
      const name = clean(body.name, 60);
      if (!name) return S.send(res, 400, { error: 'Give the class a name, for example "10B Physics".' });
      const mine = await listGet(tk);
      if (mine.length >= MAX_TEACH) return S.send(res, 400, { error: `You can run up to ${MAX_TEACH} classes. Close one first.` });
      let code = '';
      for (let i = 0; i < 6 && !code; i++) {
        const c = newCode();
        const ok = await S.cmd('SET', ck(c), JSON.stringify({ code: c, name, teacher: email, teacherName: clean(body.teacherName, 40), created: Date.now(), students: [], assignments: [] }), 'NX');
        if (ok) code = c;
      }
      if (!code) return S.send(res, 500, { error: 'Could not create a class code. Try again.' });
      mine.push(code); await S.setJSON(tk, mine);
      return S.send(res, 200, { code });
    }

    if (action === 'join') {
      const code = normCode(body.code), name = clean(body.name, 40);
      if (code.length < 6) return S.send(res, 400, { error: 'Enter the 6-character class code from your teacher.' });
      if (!name) return S.send(res, 400, { error: 'Enter the name your teacher will see.' });
      const c = await S.getJSON(ck(code));
      if (!c) return S.send(res, 404, { error: 'That class code was not found. Check it with your teacher.' });
      if (c.teacher === email) return S.send(res, 400, { error: 'You teach this class, so you cannot join it as a student.' });
      const joined = await listGet(sk);
      if (!joined.includes(code)) {
        if (joined.length >= MAX_JOIN) return S.send(res, 400, { error: `You can be in up to ${MAX_JOIN} classes.` });
        c.students = c.students || [];
        if (!c.students.includes(email)) {
          if (c.students.length >= MAX_STUDENTS) return S.send(res, 400, { error: 'This class is full.' });
          c.students.push(email); await S.setJSON(ck(code), c);
        }
        joined.push(code); await S.setJSON(sk, joined);
      }
      const r = (await S.getJSON('sf:report:' + code + ':' + email)) || {};
      await S.setJSON('sf:report:' + code + ':' + email, { ...r, name, updated: r.updated || null, summary: r.summary || null });
      return S.send(res, 200, { ok: true, cls: pub(c) });
    }

    if (action === 'leave') {
      const code = normCode(body.code);
      const c = await S.getJSON(ck(code));
      if (c) { c.students = (c.students || []).filter(x => x !== email); await S.setJSON(ck(code), c); }
      await S.setJSON(sk, (await listGet(sk)).filter(x => x !== code));
      await S.cmd('DEL', 'sf:report:' + code + ':' + email);
      return S.send(res, 200, { ok: true });
    }

    if (action === 'mine') {
      const load = async codes => (await Promise.all(codes.map(c => S.getJSON(ck(c))))).filter(Boolean);
      const teaching = (await load(await listGet(tk))).filter(c => c.teacher === email).map(pub);
      const joined = (await load(await listGet(sk))).filter(c => (c.students || []).includes(email)).map(pub);
      return S.send(res, 200, { teaching, joined });
    }

    if (action === 'roster') {
      const c = await own(body.code);
      const students = await Promise.all((c.students || []).map(async e => {
        const r = (await S.getJSON('sf:report:' + c.code + ':' + e)) || {};
        return { email: e, name: r.name || e.split('@')[0], updated: r.updated || null, summary: r.summary || null };
      }));
      return S.send(res, 200, { cls: pub(c), students });
    }

    if (action === 'assign') {
      const c = await own(body.code);
      const title = clean(body.title, 120);
      if (!title) return S.send(res, 400, { error: 'Give the assignment a title.' });
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(body.due || '')) ? body.due : '';
      c.assignments = c.assignments || [];
      if (c.assignments.length >= MAX_ASSIGN) c.assignments.shift();
      c.assignments.push({ id: crypto.randomBytes(5).toString('hex'), title, subject: clean(body.subject, 40), topic: clean(body.topic, 80), due, note: clean(body.note, 400), created: Date.now() });
      await S.setJSON(ck(c.code), c);
      return S.send(res, 200, { cls: pub(c) });
    }

    if (action === 'golive' || action === 'endlive') {
      const c = await own(body.code);
      if (action === 'golive') {
        const meet = String(body.meet || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 10);
        if (meet.length !== 10) return S.send(res, 400, { error: 'Missing meeting code.' });
        c.live = { meet, title: clean(body.title, 60) || c.name, at: Date.now() };
      } else c.live = null;
      await S.setJSON(ck(c.code), c);
      return S.send(res, 200, { cls: pub(c) });
    }

    if (action === 'unassign') {
      const c = await own(body.code);
      c.assignments = (c.assignments || []).filter(a => a.id !== String(body.id || ''));
      await S.setJSON(ck(c.code), c);
      return S.send(res, 200, { cls: pub(c) });
    }

    if (action === 'remove') {
      const c = await own(body.code), who = String(body.email || '').toLowerCase();
      c.students = (c.students || []).filter(x => x !== who); await S.setJSON(ck(c.code), c);
      await S.setJSON('sf:sclasses:' + who, (await listGet('sf:sclasses:' + who)).filter(x => x !== c.code));
      await S.cmd('DEL', 'sf:report:' + c.code + ':' + who);
      return S.send(res, 200, { ok: true });
    }

    if (action === 'close') {
      const c = await own(body.code);
      for (const s of c.students || []) {
        await S.setJSON('sf:sclasses:' + s, (await listGet('sf:sclasses:' + s)).filter(x => x !== c.code));
        await S.cmd('DEL', 'sf:report:' + c.code + ':' + s);
      }
      await S.cmd('DEL', ck(c.code));
      await S.setJSON(tk, (await listGet(tk)).filter(x => x !== c.code));
      return S.send(res, 200, { ok: true });
    }

    if (action === 'report') {
      const summary = body.summary && typeof body.summary === 'object' ? body.summary : null;
      if (!summary) return S.send(res, 400, { error: 'Nothing to share.' });
      if (JSON.stringify(summary).length > MAX_SUMMARY) return S.send(res, 413, { error: 'Progress summary is too large.' });
      const joined = await listGet(sk);
      for (const code of joined) {
        const k = 'sf:report:' + code + ':' + email;
        const r = (await S.getJSON(k)) || {};
        await S.setJSON(k, { name: clean(body.name, 40) || r.name || email.split('@')[0], updated: Date.now(), summary });
      }
      return S.send(res, 200, { ok: true, classes: joined.length });
    }

    return S.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    if (e.status) return S.send(res, e.status, { error: e.message });
    console.error('class error', e);
    return S.send(res, 502, { error: 'The class service is not responding. Please try again.' });
  }
};
