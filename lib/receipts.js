'use strict';
// Studies Hub receipts. Every confirmed payment for a material gets a numbered receipt:
//   - emailed to the person who paid, automatically,
//   - kept in Settings > Receipts, where it can be opened and printed,
//   - checkable by anyone with the number at /receipts/check/<number> (shows no personal details).
// A receipt proves that the payer paid Studies Hub. It says nothing about what happens to the money afterwards (payouts are settled by Flutterwave later).
const cache = new WeakMap();
const lagos = (ms, o) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', ...o });
const naira = k => '₦' + (k / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => (process.env.BASE_URL || 'https://studieshub.org').replace(/\/$/, '');
const METHODS = { card: 'Card', banktransfer: 'Bank transfer', bank_transfer: 'Bank transfer', account: 'Bank account', ussd: 'USSD', mobilemoneyghana: 'Mobile money', opay: 'OPay', applepay: 'Apple Pay', googlepay: 'Google Pay' };

function receipts(db) {
  if (cache.has(db)) return cache.get(db);
  db.exec(`CREATE TABLE IF NOT EXISTS receipts(id INTEGER PRIMARY KEY AUTOINCREMENT, no TEXT UNIQUE, tx_ref TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, page_id INTEGER, title TEXT, amount_kobo INTEGER NOT NULL, method TEXT, flw_id TEXT, paid_at INTEGER NOT NULL, emailed INTEGER NOT NULL DEFAULT 0)`);
  for (const c of ['guest_name TEXT', 'guest_email TEXT', 'access_key TEXT', 'code TEXT']) { try { db.exec('ALTER TABLE receipts ADD COLUMN ' + c); } catch (err) { /* already there */ } } // visitors (no account) can pay for a sponsor post too
  db.exec('CREATE TABLE IF NOT EXISTS receipt_flags(k TEXT PRIMARY KEY)');
  const api = {
    mail: null,
    who: r => r.user_id ? db.prepare('SELECT name,email FROM users WHERE id=?').get(r.user_id) : { name: r.guest_name, email: r.guest_email },
    link: r => base() + (r.access_key ? '/receipts/g/' + r.access_key : '/receipts/' + r.no),
    // The receipt itself. Inline styles only, so it looks the same on the page, in print and in an email.
    // opts.email: no tilt on the stamp (some mail apps ignore it).
    card(r, who, opts = {}) {
      const paid = lagos(r.paid_at, { dateStyle: 'long', timeStyle: 'short' }) + ' WAT';
      const method = METHODS[String(r.method || '').toLowerCase()] || (r.method ? String(r.method) : '');
      const row = (k, v, strong, brk) => v ? `<tr><td style="padding:10px 0;color:#6b7686;font-size:13px;border-bottom:1px solid #e9edf3;width:38%;vertical-align:top">${e(k)}</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #e9edf3;font-size:14px;color:#1b2430;${strong ? 'font-weight:700' : ''}${brk ? ';overflow-wrap:anywhere;word-break:break-all' : ''}">${v}</td></tr>` : '';
      return `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe5ee;border-radius:18px;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1b2430;text-align:left">
<div style="background:#5b4bd5;background-image:linear-gradient(135deg,#4a3fc7,#7a5cf0);padding:22px 26px;color:#ffffff">
<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:middle"><div style="font-size:20px;font-weight:800;letter-spacing:.2px">🎓 Studies Hub</div><div style="font-size:11px;letter-spacing:2px;opacity:.85;margin-top:4px">OFFICIAL RECEIPT</div></td><td style="text-align:right;vertical-align:middle;font-size:12px;opacity:.9">No.<br><b style="font-size:15px;letter-spacing:.5px">${e(r.no)}</b></td></tr></table></div>
<div style="padding:26px 26px 8px;position:relative">
<div style="font-size:12px;color:#6b7686;letter-spacing:1.5px">AMOUNT PAID</div>
<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:middle"><div style="font-size:38px;font-weight:800;color:#1b2430;line-height:1.1;margin-top:4px">${e(naira(r.amount_kobo))}</div><div style="font-size:13px;color:#6b7686;margin-top:6px">Nigerian Naira (NGN)</div></td>
<td style="text-align:right;vertical-align:middle"><div style="display:inline-block;border:3px double #16a34a;color:#16a34a;border-radius:10px;padding:6px 16px;font-size:22px;font-weight:900;letter-spacing:4px;${opts.email ? '' : 'transform:rotate(-9deg);'}opacity:.92">PAID</div></td></tr></table>
<table style="width:100%;border-collapse:collapse;margin-top:18px">
${row('Received from', e(who.name || '') + (who.email ? '<br><span style="color:#6b7686;font-size:12px">' + e(who.email) + '</span>' : ''), true)}
${row('For', e(r.title || 'Studies Hub material'), true)}
${row('Date and time', e(paid))}
${row('Payment method', e(method))}
${row('Payment reference', e(r.tx_ref), false, true)}
${row('Flutterwave transaction ID', e(r.flw_id), false, true)}
${row('Payment code', e(r.code), false, true)}
${row('Receipt number', e(r.no))}
</table></div>
<div style="padding:14px 26px 24px">
<div style="background:#f4f6fb;border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.6;color:#5b6677">This receipt confirms that <b>Studies Hub received your payment</b> through Flutterwave. It is your proof of purchase. It is not a record of when or whether any seller has been paid; seller payouts are settled separately by Flutterwave.<br>Verify this receipt: <b>${e(base().replace(/^https?:\/\//, ''))}/receipts/check/${e(r.no)}</b></div>
<div style="text-align:center;font-size:11px;color:#8a94a4;margin-top:14px;letter-spacing:.5px">Studies Hub &middot; Study smarter, together &middot; ${e(base().replace(/^https?:\/\//, ''))}</div></div></div>`;
    },
    // Creates the receipt (once per payment) and emails it to the payer. Safe to call again for the same payment.
    issue(o, m) {
      m = m || api.mail || {};
      try {
        const paidAt = o.paidAt || Date.now();
        const g = !o.userId && o.guest ? o.guest : null; // a visitor without an account: kept under user 0 and opened with a private link
        const ins = db.prepare('INSERT OR IGNORE INTO receipts(tx_ref,user_id,page_id,title,amount_kobo,method,flw_id,paid_at,guest_name,guest_email,access_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(o.txRef, o.userId || 0, o.pageId || null, o.title || '', o.amountKobo, o.method || null, o.flwId == null ? null : String(o.flwId), paidAt, g ? g.name || '' : null, g ? g.email || '' : null, g ? require('crypto').randomBytes(16).toString('hex') : null);
        const r = db.prepare('SELECT * FROM receipts WHERE tx_ref=?').get(o.txRef);
        if (!r.no) { const no = 'SH-' + lagos(r.paid_at, { year: '2-digit', month: '2-digit', day: '2-digit' }).split('/').reverse().join('') + '-' + String(r.id).padStart(5, '0'); db.prepare('UPDATE receipts SET no=? WHERE id=?').run(no, r.id); r.no = no; }
        if (!r.code) { const f = db.prepare('SELECT code FROM flw_payments WHERE tx_ref=?').get(o.txRef), c = (f && f.code) || require('./pay_codes').make(db); if (c) { db.prepare('UPDATE receipts SET code=? WHERE id=?').run(c, r.id); r.code = c; } }
        if (!ins.changes && r.emailed) return r;
        const u = api.who(r);
        if (u && u.email && m.deliver && m.emailShell && db.prepare('UPDATE receipts SET emailed=1 WHERE id=? AND emailed=0').run(r.id).changes) {
          const html = m.emailShell(`<p style="margin:0 0 6px"><b>Dear ${e(String(u.name || '').trim().split(/\s+/).filter(w => !/^(prof|dr|mr|mrs|ms|engr)\.?$/i.test(w))[0] || 'there')},</b></p><p style="margin:0 0 18px;line-height:1.6">Thank you for your purchase. Here is your receipt.</p>${api.card(r, u, { email: true })}<p style="margin:20px 0 0;text-align:center"><a href="${api.link(r)}" style="background:#6c5ce7;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">View and print receipt</a></p>`);
          const text = `Studies Hub receipt ${r.no}\n\nAmount paid: ${naira(r.amount_kobo)}\nFor: ${r.title}\nDate: ${lagos(r.paid_at, { dateStyle: 'long', timeStyle: 'short' })}\nReference: ${r.tx_ref}\n\nView and print: ${api.link(r)}`;
          Promise.resolve(m.deliver(u.email, `Your Studies Hub receipt ${r.no} (${naira(r.amount_kobo)})`, text, html)).catch(err => console.error('Receipt email failed:', err.message));
        }
        return r;
      } catch (err) { console.error('Receipt failed:', err.message); return null; }
    },
    // Once, after this feature first starts: receipts for recent confirmed payments that were made before it existed.
    backfill() {
      const since = Date.now() - 72 * 3600e3;
      if (!db.prepare("SELECT 1 FROM receipt_flags WHERE k='backfill1'").get()) {
        db.prepare("INSERT INTO receipt_flags(k) VALUES('backfill1')").run();
        let rows = []; try { rows = db.prepare("SELECT f.*, p.title FROM flw_payments f LEFT JOIN pages p ON p.id=f.item_id WHERE f.status='paid' AND f.kind='cbt' AND f.created_at>? ORDER BY f.created_at").all(since); } catch (err) { return; }
        for (const f of rows) api.issue({ txRef: f.tx_ref, userId: f.user_id, pageId: f.item_id, title: f.title, amountKobo: f.amount_kobo, flwId: f.transaction_id, paidAt: f.created_at });
      }
      if (!db.prepare("SELECT 1 FROM receipt_flags WHERE k='backfill2'").get()) { // sponsor posts paid for in the same window
        db.prepare("INSERT INTO receipt_flags(k) VALUES('backfill2')").run();
        let rows = []; try { rows = db.prepare("SELECT f.*, s.title, s.guest_name, s.guest_email FROM flw_payments f LEFT JOIN sponsor_posts s ON s.id=f.item_id WHERE f.status='paid' AND f.kind='sponsor' AND f.created_at>? ORDER BY f.created_at").all(since); } catch (err) { return; }
        for (const f of rows) api.issue({ txRef: f.tx_ref, userId: f.user_id, title: 'Sponsor post: ' + (f.title || ''), amountKobo: f.amount_kobo, flwId: f.transaction_id, paidAt: f.created_at, guest: { name: f.guest_name, email: f.guest_email } });
      }
    },
  };
  cache.set(db, api);
  return api;
}

function register(app, ctx) {
  const { db, esc, layout, isCentral } = ctx;
  const R = receipts(db);
  // Visitors (no account) open their receipt with the private link from their email.
  setTimeout(() => { try { R.mail = require('./seller')(db).mail || R.mail; R.backfill(); } catch (err) { console.error('Receipt backfill failed:', err.message); } }, 30e3).unref();

  const sheet = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
body{margin:0;background:#eef1f7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1b2430}.bar{max-width:520px;margin:0 auto;padding:16px;display:flex;gap:10px;align-items:center;justify-content:space-between}.bar a,.bar button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:10px 16px;text-decoration:none;cursor:pointer}.bar a{background:#e0e5f0;color:#1b2430}.bar button{background:#5b4bd5;color:#fff}.wrap{padding:0 16px 40px}
@media print{body{background:#fff}.noprint{display:none!important}.wrap{padding:0}}</style></head><body>${body}</body></html>`;
  app.get('/receipts', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/receipts');
    const rows = db.prepare('SELECT * FROM receipts WHERE user_id=? ORDER BY paid_at DESC').all(req.user.id);
    res.send(layout('Receipts', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Receipts</h1><p class="mut">Your payment receipts. Open one to view and print it.</p>${rows.map(r => `<a class="card row" href="/receipts/${e(r.no)}" style="text-decoration:none;color:inherit"><div><b>${e(r.title || 'Material')}</b><br><span class="mut" style="font-size:13px">${e(r.no)} &middot; ${e(lagos(r.paid_at, { dateStyle: 'medium' }))}</span></div><b>${e(naira(r.amount_kobo))}</b></a>`).join('') || '<p class="mut">You have not paid for anything yet. Receipts appear here after a purchase.</p>'}`, req.user));
  });
  app.get('/receipts/check/:no', (req, res) => {
    const r = db.prepare('SELECT no,title,amount_kobo,paid_at FROM receipts WHERE no=?').get(String(req.params.no || '').toUpperCase());
    res.send(sheet('Verify receipt', `<div class="wrap" style="padding-top:40px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;padding:28px;text-align:center;border:1px solid #dfe5ee">${r ? `<div style="font-size:46px">✅</div><h2 style="margin:6px 0">Valid Studies Hub receipt</h2><p style="color:#5b6677;line-height:1.7">Receipt <b>${e(r.no)}</b><br>${e(naira(r.amount_kobo))} for <b>${e(r.title || 'a material')}</b><br>Paid on ${e(lagos(r.paid_at, { dateStyle: 'long' }))}</p>` : '<div style="font-size:46px">❌</div><h2 style="margin:6px 0">No receipt found</h2><p style="color:#5b6677">That receipt number does not exist. Check it and try again.</p>'}</div></div>`));
  });
  app.get('/receipts/g/:key', (req, res) => {
    const r = /^[a-f0-9]{32}$/.test(req.params.key) && db.prepare('SELECT * FROM receipts WHERE access_key=?').get(req.params.key);
    if (!r) return res.status(404).send(sheet('Receipt', '<div class="wrap" style="padding-top:40px;text-align:center"><h2>Receipt not found</h2></div>'));
    res.send(sheet('Receipt ' + r.no, `<div class="bar noprint"><a href="/">&larr; Studies Hub</a><button type="button" onclick="window.print()">🖨 Print</button></div><div class="wrap">${R.card(r, R.who(r))}</div>`));
  });
  app.get('/receipts/:no', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const r = db.prepare('SELECT * FROM receipts WHERE no=?').get(String(req.params.no || '').toUpperCase());
    if (!r || (r.user_id !== req.user.id && !isCentral(req.user))) return res.status(404).send(layout('Receipt', '<h1>Receipt not found</h1><p><a class="btn" href="/receipts">My receipts</a></p>', req.user));
    const who = R.who(r) || {};
    res.send(sheet('Receipt ' + r.no, `<div class="bar noprint"><a href="/receipts">&larr; Receipts</a><button type="button" onclick="window.print()">🖨 Print</button></div><div class="wrap">${R.card(r, who)}</div>`));
  });
  return R;
}
module.exports = receipts;
module.exports.register = register;
