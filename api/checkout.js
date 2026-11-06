// Creates ONE Razorpay payment link for everything in the student's cart.
// Prices come from _catalog.js on the server, never from the browser.
// Needs env vars RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (set in Vercel).
const PRICES = require('./_catalog.js');
const fs = require('fs');
const path = require('path');
const hasBook = id => /^[a-z0-9-]+$/.test(id) && fs.existsSync(path.join(__dirname, '_books', id + '.pdf'));
const MAX_ITEMS = 12;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Method not allowed.' }); }
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return send(res, 500, { error: 'Payments are not set up on the server yet.' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Invalid request.' }); }
  const items = [...new Set(Array.isArray(body.items) ? body.items.map(String) : [])];
  if (!items.length) return send(res, 400, { error: 'Your cart is empty.' });
  if (items.length > MAX_ITEMS) return send(res, 400, { error: `You can buy up to ${MAX_ITEMS} books at once.` });
  const bad = items.filter(p => !PRICES[p] || !hasBook(p));
  if (bad.length) return send(res, 400, { error: 'Some books in your cart are not available yet.', unavailable: bad });

  const total = items.reduce((n, p) => n + PRICES[p], 0);
  const notes = {};
  items.forEach((p, i) => { notes['p' + (i + 1)] = p; });
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const callback = 'https://' + host + '/?paid=cart';

  try {
    const r = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64')
      },
      body: JSON.stringify({
        amount: total * 100,
        currency: 'INR',
        description: `StudyFlow books (${items.length})`,
        notes,
        callback_url: callback,
        callback_method: 'get'
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.short_url) {
      console.error('Razorpay create link failed', r.status, j && j.error);
      return send(res, 502, { error: 'Could not start the payment. Please try again.' });
    }
    return send(res, 200, { url: j.short_url, linkId: j.id, total, items });
  } catch (e) {
    console.error('checkout error', e);
    return send(res, 502, { error: 'Could not reach the payment service.' });
  }
};
