// StudyFlow Plus: Razorpay payment, verified on the server, stored on the account.
// POST /api/plus (Bearer token)
//   {action:'start', plan:'monthly'|'quarterly'|'annual'} -> {url}  (Razorpay payment link)
//   {action:'verify', plink}                    -> {plan, plusUntil, ...}
// Needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and the Redis/KV env vars.
const S = require('./_store.js');
const PLANS = {
  monthly: { amount: Number(process.env.PLUS_MONTHLY_INR || 249), days: 31, label: 'StudyFlow Plus (1 month)' },
  quarterly: { amount: Number(process.env.PLUS_QUARTERLY_INR || 649), days: 93, label: 'StudyFlow Plus (3 months)' },
  annual: { amount: Number(process.env.PLUS_ANNUAL_INR || 1999), days: 366, label: 'StudyFlow Plus (1 year)' }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return S.send(res, 405, { error: 'Method not allowed.' }); }
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!S.configured()) return S.send(res, 503, { error: 'Accounts are not switched on for this website yet, so Plus cannot be bought.' });
  if (!id || !secret) return S.send(res, 503, { error: 'Payments are not set up on the server yet.' });
  const email = S.readSession(req);
  if (!email) return S.send(res, 401, { error: 'Log in first so Plus can be added to your account.', signedOut: true });
  let body;
  try { body = await S.readBody(req, 20000); } catch (e) { return S.send(res, 400, { error: 'Invalid request.' }); }
  const auth = 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
  const key = S.userKey(email);

  try {
    const u = await S.getJSON(key);
    if (!u) return S.send(res, 401, { error: 'Please log in again.', signedOut: true });

    if (body.action === 'start') {
      const plan = PLANS[body.plan];
      if (!plan) return S.send(res, 400, { error: 'Choose monthly, 3 months or yearly.' });
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const r = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ amount: plan.amount * 100, currency: 'INR', description: plan.label, notes: { plus: body.plan, email }, callback_url: 'https://' + host + '/?plus=1', callback_method: 'get' })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.short_url) { console.error('plus link failed', r.status, j && j.error); return S.send(res, 502, { error: 'Could not start the payment. Please try again.' }); }
      return S.send(res, 200, { url: j.short_url, linkId: j.id });
    }

    if (body.action === 'verify') {
      const plink = String(body.plink || '');
      if (!/^[A-Za-z0-9_]{6,64}$/.test(plink)) return S.send(res, 400, { error: 'Missing payment reference.' });
      const r = await fetch('https://api.razorpay.com/v1/payment_links/' + encodeURIComponent(plink), { headers: { Authorization: auth } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return S.send(res, 403, { error: 'We could not confirm this payment.' });
      const plan = PLANS[j.notes && j.notes.plus];
      if (!plan || String(j.notes.email || '') !== email) return S.send(res, 403, { error: 'This payment is not for StudyFlow Plus on this account.' });
      if (j.status !== 'paid' || Number(j.amount_paid || 0) < plan.amount * 100) return S.send(res, 402, { error: 'The payment is not complete yet.' });
      const first = await S.cmd('SET', 'sf:plusused:' + plink, email, 'NX');
      if (first) {
        const from = Math.max(Date.now(), u.plusUntil || 0);
        u.plusUntil = from + plan.days * 864e5;
        u.plusHistory = (u.plusHistory || []).concat({ plink, plan: j.notes.plus, at: Date.now() }).slice(-24);
        await S.setJSON(key, u);
      }
      return S.send(res, 200, { plan: 'plus', plusUntil: u.plusUntil, limit: S.LIMITS.plus, already: !first });
    }
    return S.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('plus error', e);
    return S.send(res, 502, { error: 'Could not reach the payment service.' });
  }
};
