// StudyStarx accounts and cloud sync.
// POST /api/account  { action, ... }
//   signup  {email, password}                -> {token, email, recoveryCode, ...me}
//   login   {email, password}                -> {token, ...me}
//   recover {email, recoveryCode, password}  -> {token, recoveryCode (new), ...me}
//   google  {credential}                     -> {token, name, ...me}   (Sign in with Google; needs GOOGLE_CLIENT_ID)
//   me      (Bearer token)                   -> {email, plan, plusUntil, usage, limit, cloud:{v, updated}}
//   pull    (Bearer token)                   -> {v, updated, blob}
//   push    (Bearer token) {blob, baseV, force} -> {v, updated}   409 {conflict:true, v, updated} if the cloud copy changed
// GET /api/account -> {configured}
// Needs Upstash Redis or Vercel KV env vars (see _store.js).
const crypto = require('crypto');
const S = require('./_store.js');
const MAX_BLOB = 1200000; // characters of JSON study data per account

const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k.toString('hex')))));
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newCode = () => crypto.randomBytes(8).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
const cleanEmail = e => String(e || '').trim().toLowerCase();
const GOOGLE_ID = () => String(process.env.GOOGLE_CLIENT_ID || '').trim();
// Checks a Google sign-in token with Google itself, so nobody can pretend to own an email address.
async function verifyGoogle(cred) {
  const id = GOOGLE_ID();
  if (!id) throw Object.assign(new Error('Sign in with Google is not switched on yet.'), { code: 503 });
  if (!/^[A-Za-z0-9._-]{20,4000}$/.test(cred)) throw Object.assign(new Error('Google sign-in failed. Please try again.'), { code: 400 });
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
  const p = await r.json().catch(() => ({}));
  const okIss = p.iss === 'accounts.google.com' || p.iss === 'https://accounts.google.com';
  if (!r.ok || p.aud !== id || !okIss || Number(p.exp) * 1000 < Date.now() || String(p.email_verified) !== 'true' || !p.email) throw Object.assign(new Error('Google could not confirm this account. Please try again.'), { code: 401 });
  return { email: cleanEmail(p.email), sub: String(p.sub || ''), name: String(p.given_name || p.name || '').slice(0, 60) };
}
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e) && e.length <= 254;

async function me(email, u) {
  const usage = Number(await S.cmd('GET', 'sf:usage:' + email + ':' + S.today())) || 0;
  const meta = await S.getJSON('sf:datameta:' + email);
  const plan = S.isPlus(u) ? 'plus' : 'free';
  return { email, plan, plusUntil: u.plusUntil || null, usage, limit: S.LIMITS[plan], cloud: meta || null };
}
async function tooManyFails(email, ip) {
  const k = 'sf:fail:' + email + ':' + ip;
  const n = Number(await S.cmd('GET', k)) || 0;
  return n >= 8;
}
async function noteFail(email, ip) {
  const k = 'sf:fail:' + email + ':' + ip;
  await S.cmd('INCR', k); await S.cmd('EXPIRE', k, 900);
  await S.cmd('INCR', 'sf:ipfail:' + ip); await S.cmd('EXPIRE', 'sf:ipfail:' + ip, 900);
}


// Owner dashboard numbers. Counts only — no emails are sent back to the app.
async function ownerStats() {
  const now = Date.now(), day = 864e5;
  const days = n => { const o = []; for (let i = 0; i < n; i++) o.push(new Date(now + 5.5 * 3600e3 - i * day).toISOString().slice(0, 10)); return o; };
  const scan = async pat => { const keys = []; let cur = '0', n = 0; do { const r = await S.cmd('SCAN', cur, 'MATCH', pat, 'COUNT', 500); cur = String(r && r[0] || '0'); keys.push(...(r && r[1] || [])); n++; } while (cur !== '0' && n < 400); return keys; };
  const out = { at: now };
  // accounts and Plus
  const users = await scan('sf:user:*'); let plus = 0, newWeek = 0, total = 0;
  for (const k of users) { if (S.isLifetime(k.slice(8))) continue; total++; const u = await S.getJSON(k).catch(() => null); if (!u) continue; if (S.isPlus(u)) plus++; if (u.created && now - u.created < 7 * day) newWeek++; }
  out.accounts = { total, plus, newWeek };
  // signed-in people who used the app (cloud sync)
  const metas = await scan('sf:datameta:*'); let a1 = 0, a7 = 0, a30 = 0;
  for (const k of metas) { if (S.isLifetime(k.slice(12))) continue; const m = await S.getJSON(k).catch(() => null); const t = m && +m.updated || 0; if (now - t < day) a1++; if (now - t < 7 * day) a7++; if (now - t < 30 * day) a30++; }
  out.active = { today: a1, week: a7, month: a30 };
  // devices that opened the app (anonymous) and website visits
  const d7 = days(7), d30 = days(30);
  out.devices = { today: Number(await S.cmd('PFCOUNT', 'sf:dau:' + d7[0])) || 0, week: Number(await S.cmd('PFCOUNT', ...d7.map(d => 'sf:dau:' + d))) || 0 };
  const num = async k => Number(await S.cmd('GET', k)) || 0;
  let v7 = 0, u7 = 0, v30 = 0, u30 = 0; const chart = [];
  for (let i = 0; i < d30.length; i++) { const v = await num('sf:visit:' + d30[i]), uv = await num('sf:uvisit:' + d30[i]); v30 += v; u30 += uv; if (i < 7) { v7 += v; u7 += uv; chart.push({ day: d30[i], visitors: uv, opens: v }); } }
  out.visits = { today: await num('sf:uvisit:' + d7[0]), week: u7, month: u30, opensWeek: v7, opensMonth: v30, chart: chart.reverse() };
  // purchases, straight from Razorpay (books and Plus)
  out.sales = { ok: false };
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (id && secret) {
    try {
      const r = await fetch('https://api.razorpay.com/v1/payment_links', { headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') } });
      const j = await r.json().catch(() => ({}));
      const list = (j.payment_links || []).filter(x => x.status === 'paid');
      const PRICES = require('./_catalog.js');
      let books = 0, bookOrders = 0, bookMoney = 0, plusSales = 0, plusMoney = 0, week = 0; const recent = [], perBook = {};
      for (const x of list) {
        const notes = x.notes || {}, paid = Number(x.amount_paid || 0) / 100, t = (Number(x.updated_at || x.created_at) || 0) * 1000;
        if (notes.plus) { plusSales++; plusMoney += paid; recent.push({ t, what: 'Plus · ' + notes.plus, amount: paid }); }
        else { const b = Object.values(notes).map(String).filter(v => PRICES[v]); if (!b.length) continue; bookOrders++; books += b.length; bookMoney += paid; b.forEach(v => perBook[v] = (perBook[v] || 0) + 1); recent.push({ t, what: b.length + (b.length === 1 ? ' book' : ' books'), amount: paid }); }
        if (now - t < 7 * day) week++;
      }
      recent.sort((a, b) => b.t - a.t);
      const top = Object.entries(perBook).sort((a, b) => b[1] - a[1]).slice(0, 5);
      out.sales = { ok: r.ok, books, bookOrders, bookMoney, plusSales, plusMoney, week, recent: recent.slice(0, 8), top };
    } catch (e) { out.sales = { ok: false }; }
  }
  // problem reports
  const P = l => (l || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
  const errs = P(await S.cmd('LRANGE', 'sf:errlog', -300, -1)).reverse();
  const fb = P(await S.cmd('LRANGE', 'sf:feedback', -100, -1)).reverse();
  const ai = P(await S.cmd('LRANGE', 'sf:aireports', 0, 99));
  const wk = x => now - (x.t || 0) < 7 * day;
  const groups = {}; errs.filter(wk).forEach(e => { const k = e.msg.slice(0, 120); (groups[k] = groups[k] || { msg: k, n: 0, page: e.page, last: 0 }).n++; groups[k].last = Math.max(groups[k].last, e.t); });
  out.reports = {
    errorsWeek: errs.filter(wk).length, feedbackWeek: fb.filter(wk).length, aiWeek: ai.filter(wk).length,
    topErrors: Object.values(groups).sort((a, b) => b.n - a.n).slice(0, 8),
    feedback: fb.slice(0, 10).map(f => ({ t: f.t, rating: f.rating, text: f.text })),
    ai: ai.slice(0, 8).map(a => ({ t: a.t, why: a.why, note: a.note, q: String(a.q || '').slice(0, 200), a: String(a.a || '').slice(0, 260), level: a.level, curriculum: a.curriculum }))
  };
  // what people use (anonymous feature counts, last 14 days, UTC days as they are stored)
  const use = {};
  for (let i = 0; i < 14; i++) { const d = new Date(now - i * day).toISOString().slice(0, 10); const h = await S.cmd('HGETALL', 'sf:usage:' + d); if (Array.isArray(h)) { for (let j = 0; j < h.length; j += 2) use[h[j]] = (use[h[j]] || 0) + (Number(h[j + 1]) || 0); } else if (h && typeof h === 'object') for (const k in h) use[k] = (use[k] || 0) + (Number(h[k]) || 0); }
  out.usage = use;
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return S.send(res, 200, { configured: S.configured(), google: S.configured() ? GOOGLE_ID() : '', emailReset: !!(String(process.env.RESEND_API_KEY || '').trim() && String(process.env.RESET_FROM || '').trim()), support: String(process.env.SUPPORT_EMAIL || '').trim().slice(0, 120) });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return S.send(res, 405, { error: 'Method not allowed.' }); }
  if (!S.configured()) return S.send(res, 503, { configured: false, error: 'Accounts are not switched on for this website yet.' });
  let body;
  try { body = await S.readBody(req); } catch (e) { return S.send(res, e.message === 'TOO_BIG' ? 413 : 400, { error: e.message === 'TOO_BIG' ? 'Your study data is too large to sync.' : 'Invalid request.' }); }
  const action = String(body.action || '');
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

  try {
    // Android app sign-in: Google sign-in happens in the phone's browser, which asks for a one-time code (valid 5 minutes)
    // and hands it to the app; the app swaps the code for its own session. The code works once only.
    if (action === 'appcode') {
      const email = S.readSession(req);
      if (!email) return S.send(res, 401, { error: 'Sign in first.' });
      const code = crypto.randomBytes(24).toString('hex');
      await S.cmd('SET', 'sf:appcode:' + code, email, 'EX', '300');
      return S.send(res, 200, { code });
    }
    if (action === 'appredeem') {
      const code = String(body.code || '').toLowerCase();
      if (!/^[a-f0-9]{48}$/.test(code)) return S.send(res, 400, { error: 'That sign-in link is not valid.' });
      if (Number(await S.cmd('GET', 'sf:ipfail:' + ip)) >= 40) return S.send(res, 429, { error: 'Too many attempts from this network. Wait 15 minutes and try again.' });
      const email = await S.cmd('GET', 'sf:appcode:' + code);
      if (!email) { await S.cmd('INCR', 'sf:ipfail:' + ip); await S.cmd('EXPIRE', 'sf:ipfail:' + ip, 900); return S.send(res, 401, { error: 'That sign-in link has expired. Press Continue with Google again.' }); }
      await S.cmd('DEL', 'sf:appcode:' + code);
      const u = await S.getJSON(S.userKey(email));
      if (!u) return S.send(res, 404, { error: 'Account not found.' });
      return S.send(res, 200, { token: S.signSession(email), google: !!u.google, ...(await me(email, u)) });
    }
    if (action === 'google') {
      if (Number(await S.cmd('GET', 'sf:ipfail:' + ip)) >= 40) return S.send(res, 429, { error: 'Too many attempts from this network. Wait 15 minutes and try again.' });
      let g;
      try { g = await verifyGoogle(String(body.credential || '')); } catch (e) { if (e.code === 401) { await S.cmd('INCR', 'sf:ipfail:' + ip); await S.cmd('EXPIRE', 'sf:ipfail:' + ip, 900); } return S.send(res, e.code || 401, { error: e.message }); }
      if (!validEmail(g.email)) return S.send(res, 400, { error: 'That Google account has no usable email address.' });
      const key = S.userKey(g.email);
      let u = await S.getJSON(key);
      if (!u) {
        const sk = 'sf:signup:' + ip; const sn = Number(await S.cmd('INCR', sk)) || 0; if (sn === 1) await S.cmd('EXPIRE', sk, 3600); if (sn > 10) return S.send(res, 429, { error: 'Too many new accounts from this network. Try again in an hour.' });
        u = { google: g.sub, created: Date.now(), plusUntil: null };
        const ok = await S.cmd('SET', key, JSON.stringify(u), 'NX');
        if (!ok) u = await S.getJSON(key);
      } else if (!u.google) { u.google = g.sub; await S.setJSON(key, u); }
      if (u.google && g.sub && u.google !== g.sub) return S.send(res, 401, { error: 'This email is linked to a different Google account.' });
      return S.send(res, 200, { token: S.signSession(g.email), name: g.name, google: true, ...(await me(g.email, u)) });
    }
    // Anonymous error reports from the app (no email or personal data), so problems can be found and fixed.
    if (action === 'errlog') {
      const rk = 'sf:errrate:' + ip; const rn = Number(await S.cmd('INCR', rk)) || 0; if (rn === 1) await S.cmd('EXPIRE', rk, 3600);
      if (rn > 30) return S.send(res, 200, { ok: true });
      const c = (v, n) => String(v == null ? '' : v).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').slice(0, n);
      const rec = { t: Date.now(), msg: c(body.msg, 300), src: c(body.src, 160), line: Number(body.line) || 0, page: c(body.page, 40), ua: c(body.ua, 160), v: c(body.v, 20) };
      if (!rec.msg) return S.send(res, 200, { ok: true });
      await S.cmd('RPUSH', 'sf:errlog', JSON.stringify(rec)); await S.cmd('LTRIM', 'sf:errlog', -300, -1);
      return S.send(res, 200, { ok: true });
    }
    // A student marks a coach answer as wrong (no email, no name): kept for the owner to check
    if (action === 'aireport') {
      const rk = 'sf:airrate:' + ip; const rn = Number(await S.cmd('INCR', rk)) || 0; if (rn === 1) await S.cmd('EXPIRE', rk, 3600);
      if (rn > 20) return S.send(res, 429, { error: 'Too many reports, try later.' });
      const scrub = v => String(v || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').slice(0, 3000);
      const item = { t: Date.now(), why: String(body.why || '').slice(0, 20), note: scrub(body.note).slice(0, 600), q: scrub(body.q).slice(0, 800), a: scrub(body.a), level: String(body.level || '').slice(0, 40), curriculum: String(body.curriculum || '').slice(0, 60), lang: String(body.lang || '').slice(0, 10) };
      await S.cmd('LPUSH', 'sf:aireports', JSON.stringify(item)); await S.cmd('LTRIM', 'sf:aireports', 0, 499);
      return S.send(res, 200, { ok: true });
    }
    // Anonymous visit counter (no id, no personal data): one count per page open, plus one per device per day
    if (action === 'visit') {
      const rk = 'sf:visrate:' + ip; const rn = Number(await S.cmd('INCR', rk)) || 0; if (rn === 1) await S.cmd('EXPIRE', rk, 3600);
      if (rn > 40) return S.send(res, 200, { ok: true });
      const day = S.today();
      await S.cmd('INCR', 'sf:visit:' + day); await S.cmd('EXPIRE', 'sf:visit:' + day, 60 * 60 * 24 * 120);
      if (body.first === true) { await S.cmd('INCR', 'sf:uvisit:' + day); await S.cmd('EXPIRE', 'sf:uvisit:' + day, 60 * 60 * 24 * 120); }
      return S.send(res, 200, { ok: true });
    }
    // Anonymous feature counts (no email, no personal data): which features people use, per day
    if (action === 'track') {
      const rk = 'sf:trkrate:' + ip; const rn = Number(await S.cmd('INCR', rk)) || 0; if (rn === 1) await S.cmd('EXPIRE', rk, 3600);
      if (rn > 60) return S.send(res, 200, { ok: true });
      const day = new Date().toISOString().slice(0, 10), key = 'sf:usage:' + day; let k = 0;
      const c = body.counts && typeof body.counts === 'object' ? body.counts : {};
      for (const name of Object.keys(c).slice(0, 30)) { const n = Math.min(50, Math.max(0, Math.floor(Number(c[name]) || 0))); if (!n || !/^[a-z0-9_]{1,32}$/.test(name)) continue; await S.cmd('HINCRBY', key, name, n); k++; }
      if (body.newUser === true) await S.cmd('HINCRBY', key, '_new_device', 1);
      await S.cmd('HINCRBY', key, '_active', 1);
      const did = String(body.did || ''); if (/^[a-z0-9]{8,32}$/.test(did)) { const dk = 'sf:dau:' + S.today(); await S.cmd('PFADD', dk, did); await S.cmd('EXPIRE', dk, 60 * 60 * 24 * 120); }
      if (k) await S.cmd('EXPIRE', key, 60 * 60 * 24 * 120);
      return S.send(res, 200, { ok: true });
    }
    // In-app feedback ("Help us improve") — saved for the owner to read
    if (action === 'feedback') {
      const rk = 'sf:fbrate:' + ip; const rn = Number(await S.cmd('INCR', rk)) || 0; if (rn === 1) await S.cmd('EXPIRE', rk, 3600);
      if (rn > 10) return S.send(res, 429, { error: 'Thanks! You have sent a lot of feedback this hour — try again later.' });
      const text = String(body.text || '').trim().slice(0, 2000); if (!text) return S.send(res, 400, { error: 'Write a few words first.' });
      const who = S.readSession(req) || '';
      await S.cmd('RPUSH', 'sf:feedback', JSON.stringify({ t: Date.now(), rating: Math.max(1, Math.min(5, Number(body.rating) || 0)), text, stats: String(body.stats || '').slice(0, 120), from: who }));
      await S.cmd('LTRIM', 'sf:feedback', -500, -1);
      return S.send(res, 200, { ok: true });
    }
    // Password reset by email (needs RESEND_API_KEY and RESET_FROM in Vercel). Without them, the recovery code is used instead.
    if (action === 'reset_request') {
      const email = cleanEmail(body.email);
      const KEY = String(process.env.RESEND_API_KEY || '').trim(), FROM = String(process.env.RESET_FROM || '').trim();
      if (!KEY || !FROM) return S.send(res, 501, { error: 'Email reset is not switched on yet. Use your recovery code.', useCode: true });
      if (!validEmail(email)) return S.send(res, 400, { error: 'Enter a valid email address.' });
      const rk = 'sf:resetrate:' + email; const rn = Number(await S.cmd('INCR', rk)) || 0; if (rn === 1) await S.cmd('EXPIRE', rk, 3600);
      const u = await S.getJSON(S.userKey(email));
      if (rn <= 3 && u && u.hash) {
        const tok = crypto.randomBytes(24).toString('hex');
        await S.cmd('SET', 'sf:reset:' + tok, email, 'EX', 3600);
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'study-flow-app-ecru.vercel.app').split(',')[0].trim();
        const link = 'https://' + host + '/?reset=' + tok;
        try {
          await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: FROM, to: [email], subject: 'Reset your StudyStarx password',
              html: '<p>Hi! Someone asked to reset the password for your StudyStarx account.</p><p><a href="' + link + '" style="background:#3b3fd6;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;display:inline-block">Choose a new password</a></p><p>This link works for 1 hour. If you did not ask for this, you can ignore this email.</p>' }) });
        } catch (e) { console.error('reset mail', e); }
      }
      return S.send(res, 200, { ok: true, sent: true });
    }
    if (action === 'reset_finish') {
      const tok = String(body.token || '').replace(/[^0-9a-f]/g, ''), pw = String(body.password || '');
      if (pw.length < 8 || pw.length > 200) return S.send(res, 400, { error: 'Use a password of at least 8 characters.' });
      const email = tok ? await S.cmd('GET', 'sf:reset:' + tok) : null;
      if (!email) return S.send(res, 400, { error: 'This reset link has expired. Ask for a new one.' });
      const key = S.userKey(email); const u = await S.getJSON(key);
      if (!u) return S.send(res, 400, { error: 'This account no longer exists.' });
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await scrypt(pw, u.salt);
      await S.setJSON(key, u); await S.cmd('DEL', 'sf:reset:' + tok);
      return S.send(res, 200, { token: S.signSession(email), ...(await me(email, u)) });
    }
    if (action === 'signup' || action === 'login' || action === 'recover') {
      const email = cleanEmail(body.email), pw = String(body.password || '');
      if (!validEmail(email)) return S.send(res, 400, { error: 'Enter a valid email address.' });
      if (pw.length < 8 || pw.length > 200) return S.send(res, 400, { error: 'Use a password of at least 8 characters.' });
      if (await tooManyFails(email, ip)) return S.send(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
      // Extra protection: limit failed logins from one internet address across all emails, and limit sign-ups.
      if (Number(await S.cmd('GET', 'sf:ipfail:' + ip)) >= 40) return S.send(res, 429, { error: 'Too many attempts from this network. Wait 15 minutes and try again.' });
      if (action === 'signup') { const sk = 'sf:signup:' + ip; const sn = Number(await S.cmd('INCR', sk)) || 0; if (sn === 1) await S.cmd('EXPIRE', sk, 3600); if (sn > 10) return S.send(res, 429, { error: 'Too many new accounts from this network. Try again in an hour.' }); }
      const key = S.userKey(email);
      if (action === 'signup') {
        const salt = crypto.randomBytes(16).toString('hex'), code = newCode(), cs = crypto.randomBytes(16).toString('hex');
        const u = { salt, hash: await scrypt(pw, salt), codeSalt: cs, codeHash: await scrypt(code.replace(/-/g, ''), cs), created: Date.now(), plusUntil: null };
        const ok = await S.cmd('SET', key, JSON.stringify(u), 'NX');
        if (!ok) return S.send(res, 409, { error: 'An account with this email already exists. Log in instead.' });
        return S.send(res, 200, { token: S.signSession(email), recoveryCode: code, ...(await me(email, u)) });
      }
      const u = await S.getJSON(key);
      if (action === 'login') {
        if (u && !u.hash) return S.send(res, 401, { error: 'This account uses Sign in with Google. Press “Continue with Google”.' });
        if (!u || !safeEq(await scrypt(pw, u.salt), u.hash)) { await noteFail(email, ip); return S.send(res, 401, { error: 'Email or password is incorrect.' }); }
        return S.send(res, 200, { token: S.signSession(email), ...(await me(email, u)) });
      }
      // recover: the one-time recovery code shown at sign-up resets the password
      const code = String(body.recoveryCode || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
      if (u && !u.codeHash) return S.send(res, 401, { error: 'This account uses Sign in with Google. Press “Continue with Google”.' });
      if (!u || !code || !safeEq(await scrypt(code, u.codeSalt), u.codeHash)) { await noteFail(email, ip); return S.send(res, 401, { error: 'That recovery code does not match this email.' }); }
      const fresh = newCode();
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await scrypt(pw, u.salt);
      u.codeSalt = crypto.randomBytes(16).toString('hex'); u.codeHash = await scrypt(fresh.replace(/-/g, ''), u.codeSalt);
      await S.setJSON(key, u);
      return S.send(res, 200, { token: S.signSession(email), recoveryCode: fresh, ...(await me(email, u)) });
    }

    const email = S.readSession(req);
    if (!email) return S.send(res, 401, { error: 'Please log in again.', signedOut: true });
    const u = await S.getJSON(S.userKey(email));
    if (!u) return S.send(res, 401, { error: 'This account no longer exists.', signedOut: true });

    // Record the student's (or parent's) agreement to the Privacy Policy and Terms
    if (action === 'consent') {
      const c = body.consent || {};
      const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
      u.consent = { adult: !!c.adult, parentName: c.adult ? '' : t(c.parentName, 80), parentEmail: c.adult ? '' : cleanEmail(c.parentEmail).slice(0, 254), agreed: true, version: t(c.version, 20) || '2026-11', at: Number(c.at) || Date.now(), savedAt: Date.now() };
      await S.setJSON(S.userKey(email), u);
      return S.send(res, 200, { ok: true });
    }
    // Delete the account and every bit of study data stored for it
    if (action === 'delete') {
      if (u.hash) { const pw = String(body.password || ''); if (!pw || !safeEq(await scrypt(pw, u.salt), u.hash)) { await noteFail(email, ip); return S.send(res, 401, { error: 'That password is not right.' }); } }
      else if (String(body.confirm || '') !== 'DELETE') return S.send(res, 400, { error: 'Type DELETE to confirm.' });
      if (S.isLifetime(email)) return S.send(res, 403, { error: 'The owner account cannot be deleted here.' });
      const keys = [S.userKey(email), 'sf:data:' + email, 'sf:datameta:' + email];
      let cur = '0', n = 0;
      do { const r = await S.cmd('SCAN', cur, 'MATCH', '*' + email + '*', 'COUNT', 500); cur = String(r && r[0] || '0'); (r && r[1] || []).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k) }); n++ } while (cur !== '0' && n < 50);
      for (let i = 0; i < keys.length; i += 50) await S.cmd('DEL', ...keys.slice(i, i + 50));
      await S.cmd('RPUSH', 'sf:deleted', JSON.stringify({ t: Date.now(), h: crypto.createHash('sha256').update(email).digest('hex').slice(0, 16) }));
      return S.send(res, 200, { ok: true, deleted: true });
    }
    // Owner only: recent error reports, and a full backup of the database
    if (action === 'errors' || action === 'backup' || action === 'usage' || action === 'aireports' || action === 'ownerstats') {
      if (!S.isLifetime(email)) return S.send(res, 403, { error: 'Owner only.' });
      if (action === 'ownerstats') return S.send(res, 200, await ownerStats());
      if (action === 'aireports') { const l = await S.cmd('LRANGE', 'sf:aireports', 0, 199); return S.send(res, 200, { items: (l || []).map(x => { try { return JSON.parse(x) } catch (e) { return null } }).filter(Boolean) }); }
      if (action === 'usage') { const days = []; for (let i = 0; i < 14; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); const h = await S.cmd('HGETALL', 'sf:usage:' + d); const o = {}; if (Array.isArray(h)) { for (let j = 0; j < h.length; j += 2) o[h[j]] = Number(h[j + 1]) || 0 } else if (h && typeof h === 'object') Object.assign(o, h); days.push({ day: d, counts: o }) } return S.send(res, 200, { days }); }
      if (action === 'errors') { const P = l => (l || []).map(x => { try { return JSON.parse(x) } catch (e) { return null } }).filter(Boolean).reverse(); const l = await S.cmd('LRANGE', 'sf:errlog', -100, -1); const f = await S.cmd('LRANGE', 'sf:feedback', -100, -1); return S.send(res, 200, { errors: P(l), feedback: P(f) }); }
      const out = {}; let cur = '0', n = 0;
      do {
        const r = await S.cmd('SCAN', cur, 'COUNT', 500); cur = String(r && r[0] || '0');
        for (const k of (r && r[1] || [])) {
          if (/^sf:(fail|ipfail|signup|errrate|resetrate|reset|appcode|fbrate):/.test(k)) continue;
          const ty = String(await S.cmd('TYPE', k));
          if (ty === 'string') out[k] = await S.cmd('GET', k);
          else if (ty === 'hash') out[k] = { hash: await S.cmd('HGETALL', k) };
          else if (ty === 'list') out[k] = { list: await S.cmd('LRANGE', k, 0, -1) };
          else if (ty === 'set') out[k] = { set: await S.cmd('SMEMBERS', k) };
        }
        n++;
      } while (cur !== '0' && n < 400);
      return S.send(res, 200, { app: 'studystarx', at: Date.now(), keys: Object.keys(out).length, data: out });
    }
    if (action === 'me') return S.send(res, 200, await me(email, u));
    if (action === 'pull') {
      const d = await S.getJSON('sf:data:' + email);
      return S.send(res, 200, d || { v: 0, updated: null, blob: null });
    }
    if (action === 'push') {
      const blob = body.blob;
      if (!blob || typeof blob !== 'object') return S.send(res, 400, { error: 'Nothing to sync.' });
      const text = JSON.stringify(blob);
      if (text.length > MAX_BLOB) return S.send(res, 413, { error: 'Your study data is too large to sync. Delete some old uploads or quizzes and try again.' });
      const meta = (await S.getJSON('sf:datameta:' + email)) || { v: 0, updated: null };
      if (!body.force && Number(body.baseV || 0) !== meta.v) return S.send(res, 409, { conflict: true, v: meta.v, updated: meta.updated, error: 'Your cloud copy was changed on another device.' });
      const next = { v: meta.v + 1, updated: Date.now() };
      await S.setJSON('sf:data:' + email, { ...next, blob });
      await S.setJSON('sf:datameta:' + email, next);
      return S.send(res, 200, next);
    }
    return S.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('account error', e);
    return S.send(res, 502, { error: 'The account service is not responding. Please try again.' });
  }
};
