// Delivers a purchased book only after Razorpay confirms the cart payment is paid
// and that this book was part of that payment.
// Needs env vars RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (set in Vercel, never in code).
const fs = require('fs');
const path = require('path');
const PRICES = require('./_catalog.js');
const S = require('./_store.js');
// Books are PDFs in api/_books/<book id>.pdf (bundled with this function by vercel.json).
const bookPath = id => path.join(__dirname, '_books', id + '.pdf');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const { pack, plink } = req.query || {};
  if (!PRICES[pack] || !/^[a-z0-9-]+$/.test(String(pack)) || !fs.existsSync(bookPath(pack))) return send(res, 404, { error: 'This book is not available yet.' });
  if (!plink || !/^[A-Za-z0-9_]{6,64}$/.test(plink)) return send(res, 400, { error: 'Missing payment reference.' });

  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return send(res, 500, { error: 'Payments are not set up on the server yet.' });

  try {
    const r = await fetch('https://api.razorpay.com/v1/payment_links/' + encodeURIComponent(plink), {
      headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, 403, { error: 'We could not confirm this payment.' });

    const bought = Object.values(j.notes || {}).map(String);
    if (!bought.includes(pack)) return send(res, 403, { error: 'This book was not part of that payment.' });
    const expected = bought.reduce((n, p) => n + (PRICES[p] || 0), 0) * 100;
    const paid = Number(j.amount_paid || 0);
    if (j.status !== 'paid' || paid < expected || paid <= 0) return send(res, 403, { error: 'Payment not completed for this book.' });

    // A paid link can download each of its books a limited number of times, so it can't be shared publicly.
    if (S.configured()) {
      try {
        const dk = 'sf:dl:' + plink + ':' + pack;
        const n = Number(await S.cmd('INCR', dk)) || 0;
        if (n > Number(process.env.BOOK_DOWNLOADS_PER_PURCHASE || 15)) return send(res, 429, { error: 'This book has been downloaded the maximum number of times for this purchase. Contact us if you need help.' });
      } catch (e) {}
    }
    const pdf = fs.readFileSync(bookPath(pack));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="StudyStarx-' + pack + '.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  } catch (e) {
    console.error('download error', e);
    send(res, 502, { error: 'Could not deliver the book. Please try again.' });
  }
};
