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

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return S.send(res, 200, { configured: S.configured(), google: S.configured() ? GOOGLE_ID() : '' });
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
