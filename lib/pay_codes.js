// Payment codes. A code is made when a payment starts and is only valid once Flutterwave confirms the money.
// If the payment is not confirmed within its window the record is cleared, the code goes with it, and the same
// letters may later be given to a different payment. A paid code stays on its receipt for good.
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const init = db => { try { db.exec('ALTER TABLE flw_payments ADD COLUMN code TEXT'); } catch (e) { /* already there */ } };
function make(db) {
  const rb = require('crypto').randomBytes(8);
  for (let tries = 0; tries < 20; tries++) {
    const b = tries ? require('crypto').randomBytes(8) : rb;
    let s = ''; for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
    const code = 'SH-' + s.slice(0, 4) + '-' + s.slice(4);
    let taken = db.prepare('SELECT 1 FROM flw_payments WHERE code=?').get(code);
    if (!taken) { try { taken = db.prepare('SELECT 1 FROM receipts WHERE code=?').get(code); } catch (e) { /* no receipts table yet */ } }
    if (!taken) return code;
  }
  return null;
}
const assign = (db, txRef) => { const c = make(db); if (c) db.prepare('UPDATE flw_payments SET code=? WHERE tx_ref=? AND code IS NULL').run(c, txRef); return c; };
const norm = v => { const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^SH/, ''); return s.length === 8 ? 'SH-' + s.slice(0, 4) + '-' + s.slice(4) : ''; };
const line = (row, esc) => row && row.code ? `<p class="mut" style="margin:0 0 14px">Payment code <b style="letter-spacing:1px">${esc(row.code)}</b></p>` : '';

function register(app, ctx) {
  const { db, esc, layout, flwSettle, flwItemUrl, FLW_WINDOW } = ctx;
  try { // every receipt that exists gets a code
    require('./receipts')(db);
    for (const r of db.prepare('SELECT id FROM receipts WHERE code IS NULL').all()) { const c = make(db); if (c) db.prepare('UPDATE receipts SET code=? WHERE id=?').run(c, r.id); }
  } catch (e) { console.error('Receipt code backfill failed:', e.message); }
  const hits = new Map(); // a guess limit per address: 20 tries in 10 minutes
  const limited = ip => { const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 600e3); a.push(now); hits.set(ip, a); if (hits.size > 5000) hits.clear(); return a.length > 20; };
  const box = (inner, user) => layout('Verify a payment', `<div style="max-width:460px;margin:40px auto;padding:0 16px"><h1 style="margin:0 0 12px">Verify a payment</h1>${inner}</div>`, user);
  const form = v => `<form method="get" action="/pay/code" class="card" autocomplete="off"><label class="mut">Payment code</label><input name="c" value="${esc(v || '')}" placeholder="SH-XXXX-XXXX" required maxlength="20" autocapitalize="characters"><button>Verify</button></form>`;
  app.get('/pay/code', async (req, res) => {
    if (!req.query.c) return res.send(box(form(), req.user));
    if (limited(req.ip)) return res.status(429).send(box('<p class="err">Too many tries. Wait a few minutes.</p>' + form(), req.user));
    const code = norm(req.query.c);
    const no = m => res.send(box(`<p class="err">${m}</p>` + form(req.query.c), req.user));
    if (!code) return no('That is not a payment code. It looks like SH-XXXX-XXXX.');
    let row = db.prepare('SELECT * FROM flw_payments WHERE code=?').get(code);
    if (row && row.status !== 'paid' && Date.now() - row.created_at > FLW_WINDOW) row = null; // past its window: the code is gone
    if (row && row.status !== 'paid') { const r = await flwSettle(row.tx_ref); if (!r.ok) return res.send(box(`<div class="card"><b>Not paid yet.</b><p class="mut" style="margin:6px 0 0">Flutterwave has not confirmed this payment. If you have paid, wait a minute and try again. This code stays valid for ${Math.round(FLW_WINDOW / 60000)} minutes after the payment started.</p></div>` + form(req.query.c), req.user)); row = r.row || row; }
    let rc = null; try { rc = db.prepare('SELECT no,title FROM receipts WHERE code=?').get(code); } catch (e) { /* none */ }
    if (!row && !rc) return no('That code is not valid. It may have expired, because a code only lasts while its payment is being made.');
    if (!row && rc) row = db.prepare('SELECT f.* FROM flw_payments f JOIN receipts r ON r.tx_ref=f.tx_ref WHERE r.code=?').get(code);
    const mine = !!(row && req.user && row.user_id === req.user.id);
    let opened = false;
    if (mine && row.kind !== 'sponsor') { db.prepare('UPDATE purchases SET needs_code=0 WHERE user_id=? AND page_id=?').run(row.user_id, row.item_id); opened = true; }
    const title = (rc && rc.title) || '';
    res.send(box(`<div class="card" style="text-align:center"><div style="font-size:48px;color:#22c55e;line-height:1">&#10003;</div><h2 style="margin:8px 0">Payment confirmed</h2>${title ? `<p style="margin:0 0 8px"><b>${esc(title)}</b></p>` : ''}<p class="mut" style="margin:0 0 14px">${rc ? 'Receipt ' + esc(rc.no) + '. ' : ''}${opened ? 'It is now unlocked on your account.' : mine ? 'Thank you.' : 'Sign in to the account that paid to open it.'}</p>${mine ? `<a class="btn" href="${esc(flwItemUrl(row))}">${opened ? 'Open it' : 'Continue'}</a>` : '<a class="btn" href="/login?next=' + encodeURIComponent(req.originalUrl) + '">Sign in</a>'}</div>`, req.user));
  });
}
module.exports = { init, make, assign, norm, line, register };
