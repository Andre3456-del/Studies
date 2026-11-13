// Payments (Flutterwave) and sponsor posts
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { FLW_ON, FLW_SECRET_KEY, PRICE_KOBO, SPONSOR_PRICE_NGN, admin, baseUrl, crypto, db, esc, fullAdminIds, hasPurchased, jsForScript, jsonSmall, layout, notify, sortedFor, upload, verifyFlutterwave, deliver } = ctx;
  app.post('/pay/verify', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Log in first.' });
    const page = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.body.slug);
    if (!page || !page.paid) return res.status(400).json({ error: 'Invalid item.' });
    const transactionId = req.body.transaction_id;
    if (!transactionId) return res.status(400).json({ error: 'Missing transaction.' });
    const priorUse = db.prepare('SELECT user_id, page_id FROM purchases WHERE reference=?').get(String(transactionId));
    if (priorUse) {
      if (priorUse.user_id === req.user.id && priorUse.page_id === page.id) return res.json({ ok: true }); // a duplicate callback for the SAME purchase -- not an error
      return res.status(400).json({ error: 'That transaction has already been used.' }); // a replay attempt against a different user/page -- rejected
    }
    const data = await verifyFlutterwave(transactionId);
    if (!data) return res.status(400).json({ error: 'Payment could not be verified.' });
    if (data.tx_ref && !String(data.tx_ref).startsWith(`cbt_${req.user.id}_${page.id}_`)) return res.status(400).json({ error: 'That payment was made for something else.' }); // a real payment for another item/user can't be reused here
    const expectedNgn = (page.price_kobo || PRICE_KOBO) / 100;
    if (data.currency !== 'NGN' || Number(data.amount) < expectedNgn) return res.status(400).json({ error: 'The amount paid does not match the price.' });
    const existing = db.prepare('SELECT id FROM purchases WHERE user_id=? AND page_id=?').get(req.user.id, page.id);
    if (existing) db.prepare("UPDATE purchases SET status='approved', reference=?, amount=? WHERE id=?").run(String(transactionId), Math.round(data.amount * 100), existing.id);
    else db.prepare("INSERT INTO purchases(user_id,page_id,reference,amount,status) VALUES(?,?,?,?,'approved')").run(req.user.id, page.id, String(transactionId), Math.round(data.amount * 100));
    res.json({ ok: true });
  });
  // ---------- Flutterwave: the person is sent to Flutterwave's own payment page, comes back, and is unlocked automatically ----------
  // Nobody has to approve anything by hand. Three things confirm a payment, and any one of them is enough: the person coming back
  // to the site, Flutterwave's own message to /flw/webhook, and a background check of anything still waiting. Every one of them asks
  // Flutterwave directly whether the money really arrived and for how much, so a forged request cannot unlock anything.
  db.exec(`CREATE TABLE IF NOT EXISTS flw_payments(tx_ref TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, item_id INTEGER NOT NULL, amount_kobo INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', transaction_id TEXT, created_at INTEGER NOT NULL)`);
  const FLW_HASH = process.env.FLUTTERWAVE_SECRET_HASH || '';
  const FLW_WINDOW = 15 * 60 * 1000; // each payment attempt lasts 15 minutes; after that, if Flutterwave has not confirmed it, it is cleared
  // A real payment that arrives after its record was cleared (a slow bank, say) must still unlock what was paid for.
  // The person, the item and the time are written in the payment's own reference, so the record can be rebuilt, and the price checked again.
  function flwRecover(txRef) {
    const m = /^(cbt|sponsor)_(\d+)_(\d+)_\d+$/.exec(String(txRef || ''));
    if (!m) return null;
    const uid = Number(m[2]), item = Number(m[3]);
    if (uid && !db.prepare('SELECT 1 FROM users WHERE id=?').get(uid)) return null; // uid 0 is a visitor advertising without an account
    let kobo;
    if (m[1] === 'sponsor') { const sp = db.prepare("SELECT amount_kobo FROM sponsor_posts WHERE id=? AND user_id=? AND status='pending_payment'").get(item, uid); if (!sp) return null; kobo = sp.amount_kobo; }
    else { const pg = db.prepare('SELECT price_kobo FROM pages WHERE id=? AND paid=1').get(item); if (!pg) return null; kobo = pg.price_kobo || PRICE_KOBO; }
    db.prepare('INSERT OR IGNORE INTO flw_payments(tx_ref,user_id,kind,item_id,amount_kobo,created_at) VALUES(?,?,?,?,?,?)').run(txRef, uid, m[1], item, kobo, Date.now());
    return db.prepare('SELECT * FROM flw_payments WHERE tx_ref=?').get(txRef);
  }
  async function flwGet(path) {
    try {
      const r = await fetch('https://api.flutterwave.com/v3/' + path, { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } });
      const j = await r.json();
      if (j && j.status === 'success' && j.data && j.data.status === 'successful') return j.data;
    } catch (e) { }
    return null;
  }
  // A member's advert is at /sponsor/<id>; a visitor's is at its private link.
  const sponsorUrl = id => { const sp = db.prepare('SELECT id,user_id,guest_key FROM sponsor_posts WHERE id=?').get(id); return sp && !sp.user_id && sp.guest_key ? '/sponsor/g/' + sp.guest_key : '/sponsor/' + id; };
  const flwItemUrl = row => row.kind === 'sponsor' ? sponsorUrl(row.item_id) : '/p/' + ((db.prepare('SELECT slug FROM pages WHERE id=?').get(row.item_id) || {}).slug || '');
  // Checks one payment with Flutterwave and, if it is real and the right amount, gives the person what they paid for. Safe to run many times.
  async function flwSettle(txRef, transactionId) {
    let row = db.prepare('SELECT * FROM flw_payments WHERE tx_ref=?').get(String(txRef || '')), data = null;
    if (!row) { // the record was cleared: only a payment Flutterwave itself confirms can bring it back
      if (!transactionId) return { ok: false, row: null };
      data = await flwGet('transactions/' + encodeURIComponent(transactionId) + '/verify');
      row = data && data.tx_ref === String(txRef) ? flwRecover(txRef) : null;
      if (!row) return { ok: false, row: null };
    }
    if (row.status === 'paid') return { ok: true, row };
    if (!data) data = transactionId ? await flwGet('transactions/' + encodeURIComponent(transactionId) + '/verify') : await flwGet('transactions/verify_by_reference?tx_ref=' + encodeURIComponent(row.tx_ref));
    if (!data || data.tx_ref !== row.tx_ref || data.currency !== 'NGN' || Number(data.amount) < row.amount_kobo / 100) return { ok: false, row };
    const tid = String(data.id);
    const used = db.prepare('SELECT 1 FROM flw_payments WHERE transaction_id=? AND tx_ref!=?').get(tid, row.tx_ref);
    if (used) return { ok: false, row };
    try {
      if (row.kind === 'sponsor') {
        const sp = db.prepare('SELECT * FROM sponsor_posts WHERE id=?').get(row.item_id);
        if (!sp) return { ok: false, row };
        if (sp.status !== 'approved') {
          db.prepare("UPDATE sponsor_posts SET status='approved', reference=?, expires_at=datetime('now','+' || ? || ' days') WHERE id=?").run(tid, sp.duration_days, sp.id);
          notify([sp.user_id], { title: 'Your sponsor post is live', body: `"${sp.title}" is now showing in News for ${sp.duration_days} days.`, url: sponsorUrl(sp.id), tag: 'sponsor' });
          if (!sp.user_id && sp.guest_email) Promise.resolve().then(() => deliver(sp.guest_email, 'Your Studies Hub advert is live', `Your advert "${sp.title}" is now live on Studies Hub for ${sp.duration_days} days.`, `<p>Your advert "${esc(sp.title)}" is now live on Studies Hub for ${sp.duration_days} days.</p>`)).catch(() => {});
        }
      } else {
        const pg = db.prepare('SELECT id,title,slug FROM pages WHERE id=?').get(row.item_id);
        if (!pg) return { ok: false, row };
        const had = db.prepare('SELECT id,status FROM purchases WHERE user_id=? AND page_id=?').get(row.user_id, pg.id);
        if (had) db.prepare("UPDATE purchases SET status='approved', reference=?, amount=? WHERE id=?").run(tid, Math.round(Number(data.amount) * 100), had.id);
        else db.prepare("INSERT INTO purchases(user_id,page_id,reference,amount,status) VALUES(?,?,?,?,'approved')").run(row.user_id, pg.id, tid, Math.round(Number(data.amount) * 100));
        if (!had || had.status !== 'approved') notify([row.user_id], { title: 'Payment confirmed', body: `${pg.title} is now unlocked for you`, url: '/p/' + pg.slug, tag: 'payment' });
      }
      db.prepare("UPDATE flw_payments SET status='paid', transaction_id=? WHERE tx_ref=?").run(tid, row.tx_ref);
      try {
        const who = (row.user_id ? (db.prepare('SELECT name FROM users WHERE id=?').get(row.user_id) || {}).name : (db.prepare('SELECT guest_name FROM sponsor_posts WHERE id=?').get(row.item_id) || {}).guest_name) || 'Someone';
        notify(fullAdminIds(), { title: 'Payment verified via Flutterwave', body: `${who} paid ₦${(row.amount_kobo / 100).toLocaleString()} for ${row.kind === 'sponsor' ? 'a sponsor post' : 'a locked page'}`, url: '/admin?tab=payments', tag: 'flw' });
      } catch (e) { }
      return { ok: true, row: Object.assign({}, row, { status: 'paid' }) };
    } catch (e) { console.error('Flutterwave settle failed:', e.message); return { ok: false, row }; }
  }
  // Sends the person to Flutterwave's payment page for one item.
  async function flwCheckout(req, res, o) {
    const fail = msg => res.status(502).send(layout('Payment', `<div style="max-width:460px;margin:40px auto;padding:0 16px;text-align:center"><h2>${esc(msg)}</h2><p><a href="${esc(o.back)}">&larr; Go back</a></p></div>`, req.user));
    if (!FLW_ON) return fail('Payments are not available right now. Please try again later.');
    const payer = o.payer || req.user, base = baseUrl(req), txRef = `${o.kind}_${payer.id}_${o.item}_${Date.now()}`; // payer: the signed-in member, or a visitor advertising without an account (id 0)
    try {
      const r = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST', headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: txRef, amount: o.kobo / 100, currency: 'NGN', redirect_url: base + '/pay/return',
          customer: { email: payer.email, name: payer.name },
          customizations: { title: 'Studies Hub', description: o.desc, logo: base + '/icon-192.png?v=2' }, meta: { kind: o.kind, item: o.item, user: payer.id } })
      });
      const j = await r.json();
      if (j && j.status === 'success' && j.data && j.data.link) {
        db.prepare('INSERT INTO flw_payments(tx_ref,user_id,kind,item_id,amount_kobo,created_at) VALUES(?,?,?,?,?,?)').run(txRef, payer.id, o.kind, o.item, o.kobo, Date.now());
        notify(fullAdminIds(), { title: 'Payment started via Flutterwave', body: `${payer.name} is paying ₦${(o.kobo / 100).toLocaleString()} for ${o.desc}`, url: '/admin?tab=payments', tag: 'flw' });
        return res.redirect(j.data.link);
      }
      console.error('Flutterwave did not give a payment link:', JSON.stringify(j).slice(0, 300));
    } catch (e) { console.error('Flutterwave checkout failed:', e.message); }
    return fail('Could not open the payment page. Please try again.');
  }
  app.post('/pay/start', async (req, res) => {
    if (!req.user) return res.redirect('/login');
    const page = db.prepare('SELECT * FROM pages WHERE slug=?').get(String(req.body.slug || ''));
    if (!page || !page.paid || !sortedFor(page, req.user)) return res.redirect('/');
    if (hasPurchased(req.user.id, page.id)) return res.redirect('/p/' + page.slug);
    await flwCheckout(req, res, { kind: 'cbt', item: page.id, kobo: page.price_kobo || PRICE_KOBO, desc: page.title, back: '/p/' + page.slug });
  });
  // Where Flutterwave sends the person back to after paying (or cancelling): a short page that asks Flutterwave, shows a tick or a cross, then goes on.
  const flwPage = (req, inner) => layout('Payment', `<div style="max-width:460px;margin:50px auto;padding:0 16px;text-align:center"><div class="card" style="padding:30px 22px">${inner}</div></div>`, req.user);
  app.get('/pay/return', (req, res) => {
    const txRef = String(req.query.tx_ref || ''); let row = db.prepare('SELECT * FROM flw_payments WHERE tx_ref=?').get(txRef);
    if (!row) { // cleared after its 15 minutes: build the address from the reference; a payment Flutterwave confirms still unlocks
      const m = /^(cbt|sponsor)_(\d+)_(\d+)_\d+$/.exec(txRef);
      if (!m || !req.query.transaction_id || String(req.query.status || '') === 'cancelled') return res.send(flwPage(req, `<div style="font-size:54px;color:#ef4444;line-height:1">&#10007;</div><h2 style="margin:12px 0 6px">Verification failed</h2><p class="mut" style="margin:0 0 18px">This payment time has ended. Please start again.</p><a class="btn" href="/">Back</a>`));
      row = { kind: m[1], item_id: Number(m[3]) };
    }
    const url = flwItemUrl(row);
    if (String(req.query.status || '') === 'cancelled') {
      db.prepare("UPDATE flw_payments SET status='cancelled' WHERE tx_ref=? AND status='pending'").run(txRef);
      return res.send(flwPage(req, `<div style="font-size:54px;color:#ef4444;line-height:1">&#10007;</div><h2 style="margin:12px 0 6px">Verification failed</h2><p class="mut" style="margin:0 0 18px">The payment was not completed.</p><a class="btn" href="${esc(url)}">Back</a>`));
    }
    res.send(flwPage(req, `<div id="fS"><div style="width:44px;height:44px;margin:0 auto 14px;border:4px solid rgba(255,255,255,.2);border-top-color:#5bc8ff;border-radius:50%;animation:fsp 1s linear infinite"></div><style>@keyframes fsp{to{transform:rotate(360deg)}}</style><h2 style="margin:0 0 6px">Verifying your payment</h2><p class="mut" style="margin:0">Checking with Flutterwave&hellip;</p></div>
<script>(function(){var n=0,box=document.getElementById('fS'),u=${jsForScript(url)},q=${jsForScript('tx_ref=' + encodeURIComponent(txRef) + '&transaction_id=' + encodeURIComponent(String(req.query.transaction_id || '')))};
function ok(){box.innerHTML='<div style="font-size:54px;color:#22c55e;line-height:1">&#10003;</div><h2 style="margin:12px 0 6px">Verification successful</h2><p class="mut" style="margin:0 0 18px">Your payment has been confirmed.</p><a class="btn" href="'+u+'?paid=ok">Continue</a>';setTimeout(function(){location.replace(u+'?paid=ok')},2500)}
function bad(){box.innerHTML='<div style="font-size:54px;color:#ef4444;line-height:1">&#10007;</div><h2 style="margin:12px 0 6px">Verification failed</h2><p class="mut" style="margin:0 0 18px">Flutterwave has not confirmed this payment. If money left your account, it will be confirmed by itself within a few minutes.</p><a class="btn" href="'+u+'?paid=1">Back</a>'}
function go(){n++;fetch('/pay/check?'+q,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok)ok();else if(n<6)setTimeout(go,2500);else bad()}).catch(function(){if(n<6)setTimeout(go,2500);else bad()})}
go()})()</script>`));
  });
  app.get('/pay/check', async (req, res) => {
    const r = await flwSettle(String(req.query.tx_ref || ''), req.query.transaction_id ? String(req.query.transaction_id) : '');
    res.json({ ok: !!r.ok });
  });
  // Flutterwave's own message that a payment happened (set this address and the secret hash in the Flutterwave dashboard).
  app.post('/flw/webhook', jsonSmall, async (req, res) => {
    const got = Buffer.from(String(req.headers['verif-hash'] || '')), want = Buffer.from(FLW_HASH);
    if (!FLW_HASH || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.sendStatus(401);
    res.sendStatus(200);
    try {
      const d = (req.body && req.body.data) || {};
      if (d.tx_ref && d.status === 'successful') await flwSettle(d.tx_ref, d.id);
    } catch (e) { console.error('Flutterwave webhook failed:', e.message); }
  });
  // Every half minute: attempts still inside their 15 minutes are checked with Flutterwave; attempts past 15 minutes get one last check
  // and, if Flutterwave still has no payment, are cleared completely, so nothing is left behind and the person simply starts a new one.
  setInterval(async () => {
    if (!FLW_ON) return;
    try {
      const now = Date.now();
      for (const w of db.prepare("SELECT tx_ref FROM flw_payments WHERE status='pending' AND created_at<? AND created_at>? ORDER BY created_at LIMIT 15").all(now - 20000, now - FLW_WINDOW)) await flwSettle(w.tx_ref);
      for (const w of db.prepare("SELECT tx_ref FROM flw_payments WHERE status!='paid' AND created_at<=? LIMIT 30").all(now - FLW_WINDOW)) {
        const r = await flwSettle(w.tx_ref);
        if (!r.ok) db.prepare("DELETE FROM flw_payments WHERE tx_ref=? AND status!='paid'").run(w.tx_ref);
      }
    } catch (e) { }
  }, 30000);
  // You can clear your own payment attempts that Flutterwave never confirmed. A verified payment, or anyone else's, cannot be deleted.
  app.post('/admin/flw/delete', admin, (req, res) => {
    const row = db.prepare('SELECT user_id,status FROM flw_payments WHERE tx_ref=?').get(String(req.body.ref || ''));
    if (!row || row.user_id !== req.user.id || row.status === 'paid') return res.redirect(ctx.back('That payment cannot be deleted.'));
    db.prepare('DELETE FROM flw_payments WHERE tx_ref=?').run(String(req.body.ref));
    res.redirect(ctx.back('Payment deleted.'));
  });
  app.post('/admin/payments/:id/approve', admin, (req, res) => {
    const claim = db.prepare('SELECT p.user_id, pg.title, pg.slug FROM purchases p JOIN pages pg ON pg.id=p.page_id WHERE p.id=?').get(req.params.id);
    db.prepare("UPDATE purchases SET status='approved' WHERE id=?").run(req.params.id);
    if (claim) notify([claim.user_id], { title: 'Payment confirmed', body: `${claim.title} is now unlocked for you`, url: '/p/' + claim.slug, tag: 'payment' });
    res.redirect(ctx.back('Payment approved -- unlocked for that user.'));
  });
  app.post('/admin/payments/:id/reject', admin, (req, res) => {
    db.prepare('DELETE FROM purchases WHERE id=?').run(req.params.id);
    res.redirect(ctx.back('Payment claim removed.'));
  });

  // The sponsor pages (form, advert page, edit, delete, pay, picture/video/audio) are in routes/sponsor.js.
  app.post('/sponsor/:id/verify', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Log in first.' });
    const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Not found.' });
    if (s.status === 'approved') return res.json({ ok: true }); // already live -- a duplicate callback is not an error
    const transactionId = req.body.transaction_id;
    if (!transactionId) return res.status(400).json({ error: 'Missing transaction.' });
    const data = await verifyFlutterwave(transactionId);
    if (!data) return res.status(400).json({ error: 'Payment could not be verified.' });
    if (data.tx_ref && !String(data.tx_ref).startsWith(`sponsor_${s.id}_`)) return res.status(400).json({ error: 'That payment was made for something else.' });
    if (data.currency !== 'NGN' || Number(data.amount) < s.amount_kobo / 100) return res.status(400).json({ error: 'The amount paid does not match the bill.' });
    try {
      db.prepare("UPDATE sponsor_posts SET status='approved', reference=?, expires_at=datetime('now','+' || ? || ' days') WHERE id=?").run(String(transactionId), s.duration_days, s.id);
    } catch { return res.status(400).json({ error: 'That transaction has already been used.' }); }
    notify([s.user_id], { title: 'Your sponsor post is live', body: `"${s.title}" is now showing in News for ${s.duration_days} days.`, url: '/sponsor/' + s.id, tag: 'sponsor' });
    res.json({ ok: true });
  });
  app.get('/sponsor-image/:id', (req, res) => {
    const row = db.prepare('SELECT image_data, image_mime FROM sponsor_posts WHERE id=?').get(req.params.id);
    if (!row || !row.image_data) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', row.image_mime || 'application/octet-stream');
    res.send(Buffer.from(row.image_data));
  });
  app.post('/admin/sponsors/:id/approve', admin, (req, res) => {
    const s = db.prepare('SELECT id, user_id, title, duration_days, guest_email FROM sponsor_posts WHERE id=?').get(req.params.id);
    if (!s) return res.redirect(ctx.back('Not found.'));
    db.prepare("UPDATE sponsor_posts SET status='approved', expires_at=datetime('now','+' || ? || ' days') WHERE id=?").run(s.duration_days, req.params.id);
    notify([s.user_id], { title: 'Your sponsor post is live', body: `"${s.title}" is now showing in News for ${s.duration_days} days.`, url: sponsorUrl(s.id), tag: 'sponsor' });
    if (!s.user_id && s.guest_email) Promise.resolve().then(() => deliver(s.guest_email, 'Your Studies Hub advert is live', `Your advert "${s.title}" is now live on Studies Hub for ${s.duration_days} days.`, `<p>Your advert "${esc(s.title)}" is now live on Studies Hub for ${s.duration_days} days.</p>`)).catch(() => {});
    res.redirect(ctx.back(`Sponsor post approved -- live for ${s.duration_days} days.`));
  });
  app.post('/admin/sponsors/:id/reject', admin, (req, res) => {
    const s = db.prepare('SELECT user_id, title FROM sponsor_posts WHERE id=?').get(req.params.id);
    db.prepare("UPDATE sponsor_posts SET status='rejected' WHERE id=?").run(req.params.id);
    if (s) notify([s.user_id], { title: 'Sponsor post not approved', body: `"${s.title}" could not be approved.`, url: '/sponsor/' + req.params.id, tag: 'sponsor' });
    res.redirect(ctx.back('Sponsor post rejected.'));
  });
  return { FLW_WINDOW, flwCheckout, flwSettle };
};
