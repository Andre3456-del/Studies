// Payments (Flutterwave) and sponsor posts
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { FLW_ON, FLW_SECRET_KEY, PRICE_KOBO, SPONSOR_PRICE_NGN, admin, baseUrl, crypto, db, esc, fullAdminIds, hasPurchased, jsForScript, jsonSmall, layout, notify, sortedFor, upload, verifyFlutterwave } = ctx;
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
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(uid)) return null;
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
  const flwItemUrl = row => row.kind === 'sponsor' ? '/sponsor/' + row.item_id : '/p/' + ((db.prepare('SELECT slug FROM pages WHERE id=?').get(row.item_id) || {}).slug || '');
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
          notify([sp.user_id], { title: 'Your sponsor post is live', body: `"${sp.title}" is now showing in News for ${sp.duration_days} days.`, url: '/sponsor/' + sp.id, tag: 'sponsor' });
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
        const who = (db.prepare('SELECT name FROM users WHERE id=?').get(row.user_id) || {}).name || 'Someone';
        notify(fullAdminIds(), { title: 'Payment verified via Flutterwave', body: `${who} paid ₦${(row.amount_kobo / 100).toLocaleString()} for ${row.kind === 'sponsor' ? 'a sponsor post' : 'a locked page'}`, url: '/admin?tab=payments', tag: 'flw' });
      } catch (e) { }
      return { ok: true, row: Object.assign({}, row, { status: 'paid' }) };
    } catch (e) { console.error('Flutterwave settle failed:', e.message); return { ok: false, row }; }
  }
  // Sends the person to Flutterwave's payment page for one item.
  async function flwCheckout(req, res, o) {
    const fail = msg => res.status(502).send(layout('Payment', `<div style="max-width:460px;margin:40px auto;padding:0 16px;text-align:center"><h2>${esc(msg)}</h2><p><a href="${esc(o.back)}">&larr; Go back</a></p></div>`, req.user));
    if (!FLW_ON) return fail('Payments are not available right now. Please try again later.');
    const base = baseUrl(req), txRef = `${o.kind}_${req.user.id}_${o.item}_${Date.now()}`;
    try {
      const r = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST', headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: txRef, amount: o.kobo / 100, currency: 'NGN', redirect_url: base + '/pay/return',
          customer: { email: req.user.email, name: req.user.name },
          customizations: { title: 'Studies Hub', description: o.desc, logo: base + '/icon-192.png' }, meta: { kind: o.kind, item: o.item, user: req.user.id } })
      });
      const j = await r.json();
      if (j && j.status === 'success' && j.data && j.data.link) {
        db.prepare('INSERT INTO flw_payments(tx_ref,user_id,kind,item_id,amount_kobo,created_at) VALUES(?,?,?,?,?,?)').run(txRef, req.user.id, o.kind, o.item, o.kobo, Date.now());
        notify(fullAdminIds(), { title: 'Payment started via Flutterwave', body: `${req.user.name} is paying ₦${(o.kobo / 100).toLocaleString()} for ${o.desc}`, url: '/admin?tab=payments', tag: 'flw' });
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
  app.post('/sponsor/:id/pay', async (req, res) => {
    if (!req.user) return res.redirect('/login');
    const sp = db.prepare("SELECT * FROM sponsor_posts WHERE id=? AND user_id=? AND status='pending_payment'").get(req.params.id, req.user.id);
    if (!sp) return res.redirect('/sponsor/' + req.params.id);
    await flwCheckout(req, res, { kind: 'sponsor', item: sp.id, kobo: sp.amount_kobo, desc: sp.title, back: '/sponsor/' + sp.id });
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

  // Paid promotional posts: any logged-in member can pay to advertise a business or service in News for a month.
  app.get('/sponsor', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/sponsor');
    res.send(layout('Advertise on Studies Hub', `<p class="mut"><a href="/news">&larr; Back to News</a></p><h1>Advertise here</h1>
<p class="mut">₦${SPONSOR_PRICE_NGN.toLocaleString()} per month</p>
<form class="card" method="post" action="/sponsor" enctype="multipart/form-data">
<input name="title" placeholder="What are you advertising?" required maxlength="140">
<textarea name="body" placeholder="Describe it" required maxlength="2000" style="width:100%;min-height:80px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea>
<input name="contact" placeholder="How should people reach you? (phone, @username, etc.)" maxlength="140">
<input type="file" name="image" accept="image/*" style="padding:9px 0">
<label class="mut">Start date</label><input type="date" name="start_date" id="sponsorStart" required>
<label class="mut">End date</label><input type="date" name="end_date" id="sponsorEnd" required>
<p class="pill" id="sponsorBill" style="margin:8px 0">Pick your dates</p>
<button>Continue to payment</button>
</form>
<script>(function(){
  var sd=document.getElementById('sponsorStart'),ed=document.getElementById('sponsorEnd'),bp=document.getElementById('sponsorBill'),rate=${SPONSOR_PRICE_NGN};
  var today=new Date();today.setHours(0,0,0,0);var todayStr=today.toISOString().slice(0,10);
  sd.min=todayStr;
  function sync(){
    if(!sd.value){ed.min=todayStr;return}
    var startD=new Date(sd.value+'T00:00:00'),minEnd=new Date(startD.getTime()+86400000),minEndStr=minEnd.toISOString().slice(0,10);
    ed.min=minEndStr;
    if(ed.value&&ed.value<minEndStr)ed.value=minEndStr;
    if(sd.value&&ed.value){
      var days=Math.round((new Date(ed.value+'T00:00:00')-startD)/86400000);
      var price=Math.ceil((days/30)*rate);
      bp.textContent='₦'+price.toLocaleString()+' for '+days+' day'+(days===1?'':'s')+' ('+sd.value+' to '+ed.value+')';
    } else bp.textContent='Pick your dates';
  }
  sd.addEventListener('change',sync);ed.addEventListener('change',sync);sync();
})()</script>`, req.user));
  });
  app.post('/sponsor', upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login?next=/sponsor');
    const title = String(req.body.title || '').trim().slice(0, 140);
    const body = String(req.body.body || '').trim().slice(0, 2000);
    const contact = String(req.body.contact || '').trim().slice(0, 140);
    if (!title || !body) return res.redirect('/sponsor');
    if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect('/sponsor');
    const startDate = new Date(String(req.body.start_date || '') + 'T00:00:00');
    const endDate = new Date(String(req.body.end_date || '') + 'T00:00:00');
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    if (isNaN(startDate) || isNaN(endDate) || startDate < todayMid || endDate <= startDate) return res.redirect('/sponsor');
    const days = Math.round((endDate - startDate) / 86400000);
    if (days < 1 || days > 366) return res.redirect('/sponsor'); // a year is a generous, sane ceiling
    const amountKobo = Math.round(Math.ceil((days / 30) * SPONSOR_PRICE_NGN) * 100);
    const reference = `sponsor_${req.user.id}_${Date.now()}`;
    const info = db.prepare("INSERT INTO sponsor_posts(user_id,title,body,contact,image_data,image_mime,reference,amount_kobo,duration_days,status) VALUES(?,?,?,?,?,?,?,?,?,'pending_payment')")
      .run(req.user.id, title, body, contact, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, reference, amountKobo, days);
    notify(fullAdminIds(), { title: 'Sponsor post payment claim', body: `${req.user.name} wants to advertise "${title}" for ${days} days`, url: '/admin#sponsors', tag: 'sponsor' });
    res.redirect('/sponsor/' + info.lastInsertRowid);
  });
  app.get('/sponsor/:id', async (req, res) => {
    if (!req.user) return res.redirect('/login');
    let s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (s && s.status === 'pending_payment') { const pend = db.prepare("SELECT tx_ref FROM flw_payments WHERE kind='sponsor' AND item_id=? AND status='pending' AND created_at>?").get(s.id, Date.now() - FLW_WINDOW); if (pend) { await flwSettle(pend.tx_ref); s = db.prepare('SELECT * FROM sponsor_posts WHERE id=?').get(s.id); } }
    if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
    const statusLine = s.status === 'approved' ? `<p class="pill">&#10003; Live until ${esc((s.expires_at || '').slice(0, 10))}</p>` : s.status === 'rejected' ? '<p class="err">This submission was not approved.</p>' : '<p class="pill pending">Waiting for payment to be confirmed</p>';
    res.send(layout('Your sponsor post', `<p class="mut"><a href="/news">&larr; Back to News</a></p><h1>${esc(s.title)}</h1>${statusLine}
<p class="mut">${s.duration_days} day${s.duration_days === 1 ? '' : 's'} &middot; ₦${(s.amount_kobo / 100).toLocaleString()}</p>
${s.status === 'approved' ? '' : `<p class="mut"><a href="/sponsor/${s.id}/edit">Edit this post &rarr;</a></p>`}
${s.status === 'pending_payment' ? (FLW_ON ? `<div class="card" style="text-align:center">${req.query.paid === 'cancelled' ? '<p class="mut" style="margin:0 0 10px">The payment was not completed. You can try again.</p>' : ''}${req.query.paid === '1' ? '<p class="mut" style="margin:0 0 10px">Confirming your payment. This page updates by itself.</p><script>setTimeout(function(){location.reload()},7000)</script>' : ''}<form method="post" action="/sponsor/${s.id}/pay"><button class="btn" style="width:100%">Continue to payment &middot; ₦${(s.amount_kobo / 100).toLocaleString()}</button></form></div>` : '<div class="card"><p class="err" style="margin:0">Payments are not available right now. Please try again a little later.</p></div>') : ''}
${s.status === 'approved' ? `<a class="btn" href="/sponsor/${s.id}/edit" style="display:block;text-align:center;margin-top:14px">Edit post</a>` : ''}
<form method="post" action="/sponsor/${s.id}/delete" onsubmit="return confirm('Delete this sponsor post? This cannot be undone.')" style="margin-top:14px"><button class="link">Delete this post</button></form>`, req.user));
  });
  app.get('/sponsor/:id/edit', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
    res.send(layout('Edit your sponsor post', `<p class="mut"><a href="/sponsor/${s.id}">&larr; Back</a></p><h1>Edit your sponsor post</h1>
${s.status === 'approved' ? '<p class="mut">This is already live -- changes show right away, no need to pay again.</p>' : ''}
<form class="card" method="post" action="/sponsor/${s.id}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(s.title)}" required maxlength="140">
<textarea name="body" required maxlength="2000" style="width:100%;min-height:80px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(s.body)}</textarea>
<input name="contact" value="${esc(s.contact || '')}" placeholder="How should people reach you?" maxlength="140">
${s.image_data ? `<img src="/sponsor-image/${s.id}" style="max-width:100%;border-radius:10px;margin:6px 0;display:block">` : ''}
<label class="mut">${s.image_data ? 'Replace photo (optional)' : 'Add a photo (optional)'}</label>
<input type="file" name="image" accept="image/*" style="padding:9px 0">
<button>Save changes</button>
</form>`, req.user));
  });
  app.post('/sponsor/:id/edit', upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    const s = db.prepare('SELECT id FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
    const title = String(req.body.title || '').trim().slice(0, 140);
    const body = String(req.body.body || '').trim().slice(0, 2000);
    const contact = String(req.body.contact || '').trim().slice(0, 140);
    if (!title || !body) return res.redirect(`/sponsor/${s.id}/edit`);
    if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect(`/sponsor/${s.id}/edit`);
    if (req.file) db.prepare('UPDATE sponsor_posts SET title=?, body=?, contact=?, image_data=?, image_mime=? WHERE id=?').run(title, body, contact, req.file.buffer, req.file.mimetype, s.id);
    else db.prepare('UPDATE sponsor_posts SET title=?, body=?, contact=? WHERE id=?').run(title, body, contact, s.id);
    res.redirect('/sponsor/' + s.id);
  });
  app.post('/sponsor/:id/delete', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const s = db.prepare('SELECT id FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
    db.prepare('DELETE FROM sponsor_posts WHERE id=?').run(s.id);
    res.redirect('/news');
  });
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
    const s = db.prepare('SELECT user_id, title, duration_days FROM sponsor_posts WHERE id=?').get(req.params.id);
    if (!s) return res.redirect(ctx.back('Not found.'));
    db.prepare("UPDATE sponsor_posts SET status='approved', expires_at=datetime('now','+' || ? || ' days') WHERE id=?").run(s.duration_days, req.params.id);
    notify([s.user_id], { title: 'Your sponsor post is live', body: `"${s.title}" is now showing in News for ${s.duration_days} days.`, url: '/sponsor/' + req.params.id, tag: 'sponsor' });
    res.redirect(ctx.back(`Sponsor post approved -- live for ${s.duration_days} days.`));
  });
  app.post('/admin/sponsors/:id/reject', admin, (req, res) => {
    const s = db.prepare('SELECT user_id, title FROM sponsor_posts WHERE id=?').get(req.params.id);
    db.prepare("UPDATE sponsor_posts SET status='rejected' WHERE id=?").run(req.params.id);
    if (s) notify([s.user_id], { title: 'Sponsor post not approved', body: `"${s.title}" could not be approved.`, url: '/sponsor/' + req.params.id, tag: 'sponsor' });
    res.redirect(ctx.back('Sponsor post rejected.'));
  });
  return { FLW_WINDOW, flwSettle };
};
