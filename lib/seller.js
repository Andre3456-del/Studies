'use strict';
// Lecturers sell their own materials. A lecturer adds a bank account once; the site checks the account name against the lecturer's
// profile name (no one approves anything by hand), then creates a Flutterwave "subaccount". When a student pays, Flutterwave itself
// splits the money: the lecturer's price goes to the lecturer, the rest (the system charge, set by the owner) stays with the site.
// The student pays: lecturer's price + system charge.
const cache = new WeakMap();
const KEY = () => process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY || '';
const WAIT_MS = 24 * 3600 * 1000; // a changed bank account only starts taking money after this long

async function flw(method, path, body) {
  const r = await fetch('https://api.flutterwave.com/v3/' + path, { method, signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + KEY(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.status === 'success', j };
}

// Do the two names belong to the same person? Order, case, titles and punctuation do not matter.
const TITLES = /^(prof|dr|mr|mrs|ms|engr|rev|pastor|chief|hon|barr|alh|alhaji|mal|sir|miss)$/;
const tokens = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !TITLES.test(w));
function namesMatch(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return false;
  let common = 0; for (const w of A) if (B.has(w)) common++;
  return common >= Math.min(2, A.size, B.size);
}

function seller(db) {
  if (cache.has(db)) return cache.get(db);
  db.exec(`CREATE TABLE IF NOT EXISTS seller_accounts(user_id INTEGER PRIMARY KEY, bank_code TEXT, bank_name TEXT, account_number TEXT, account_name TEXT, subaccount_id TEXT,
    p_bank_code TEXT, p_bank_name TEXT, p_account_number TEXT, p_account_name TEXT, p_at INTEGER, blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER)`);
  db.exec('CREATE TABLE IF NOT EXISTS seller_settings(key TEXT PRIMARY KEY, value REAL NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS seller_sales(tx_ref TEXT PRIMARY KEY, page_id INTEGER, lecturer_id INTEGER, buyer_id INTEGER, lecturer_kobo INTEGER, fee_kobo INTEGER, created_at INTEGER)');
  db.exec('CREATE TABLE IF NOT EXISTS seller_tx(tx_ref TEXT PRIMARY KEY, page_id INTEGER, lecturer_id INTEGER, sub_id TEXT, total_kobo INTEGER, lecturer_kobo INTEGER, sent TEXT, flw_fee REAL, settled REAL, charged REAL, status TEXT, created_at INTEGER)');
  const setting = (k, d) => { const r = db.prepare('SELECT value FROM seller_settings WHERE key=?').get(k); return r ? r.value : d; };
  const api = {
    namesMatch,
    // The system charge: a flat amount in naira plus a percentage of the lecturer's price. Both set by the owner.
    feeSettings: () => ({ flat: setting('fee_flat', 0), pct: setting('fee_pct', 5) }),
    setFee(flat, pct) {
      flat = Number(flat); pct = Number(pct);
      if (!(flat >= 0 && flat <= 5000) || !(pct >= 0 && pct <= 50)) return false;
      for (const [k, v] of [['fee_flat', flat], ['fee_pct', pct]]) db.prepare('INSERT INTO seller_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
      return true;
    },
    // The system charge. It is never lower than a safety floor (5% + 50 naira stamp duty on big sales), because Flutterwave's own fee
    // (up to about 4.1% with VAT on foreign cards) is taken out of the site's share first. If the site's share cannot cover that, Flutterwave
    // does not split the payment at all and the lecturer is paid nothing.
    floorKobo(lecturerKobo) { return Math.round(lecturerKobo * 0.05) + (lecturerKobo > 950000 ? 5000 : 0); },
    feeKobo(lecturerKobo) { const s = api.feeSettings(); return Math.max(Math.round(s.flat * 100 + lecturerKobo * s.pct / 100), api.floorKobo(lecturerKobo)); },
    account: userId => db.prepare('SELECT * FROM seller_accounts WHERE user_id=?').get(userId) || null,
    active(userId) { const a = api.account(userId); return a && a.subaccount_id && !a.blocked ? a : null; },
    // What a student pays for a page: the lecturer's price plus the system charge (just the price when no lecturer is selling it).
    total(page, def) {
      const base = page.price_kobo || def;
      return page.author_id && api.active(page.author_id) ? base + api.feeKobo(base) : base;
    },
    // The Flutterwave split for a page, or null.
    split(page, def) {
      const a = page.author_id ? api.active(page.author_id) : null;
      return a ? { id: a.subaccount_id, lecturerKobo: page.price_kobo || def } : null;
    },
    // A lecturer sets (or clears) the price of one of their own uploads. Returns an error text, or '' when saved.
    setPrice(pageId, userId, ngn) {
      const p = db.prepare('SELECT id FROM pages WHERE id=? AND author_id=?').get(pageId, userId);
      if (!p) return 'That upload is not yours.';
      ngn = Math.round(Number(ngn) || 0);
      if (ngn === 0) { db.prepare('UPDATE pages SET paid=0, price_kobo=NULL WHERE id=?').run(pageId); return ''; }
      if (!api.active(userId)) return 'Add your bank account first (Sell your materials) before setting a price.';
      if (ngn < 100 || ngn > 100000) return 'Choose a price between ₦100 and ₦100,000, or 0 to make it free.';
      db.prepare('UPDATE pages SET paid=1, price_kobo=? WHERE id=?').run(ngn * 100, pageId);
      return '';
    },
    // Remember exactly what we asked Flutterwave to split (the check page shows it).
    logSent(txRef, page, split, totalKobo, sent) {
      try { db.prepare('INSERT OR REPLACE INTO seller_tx(tx_ref,page_id,lecturer_id,sub_id,total_kobo,lecturer_kobo,sent,created_at) VALUES(?,?,?,?,?,?,?,?)').run(txRef, page.id, page.author_id, split.id, totalKobo, split.lecturerKobo, JSON.stringify(sent), Date.now()); } catch (e) { console.error('Split log failed:', e.message); }
    },
    // What Flutterwave reported when the payment was verified.
    logVerified(txRef, data) {
      try { db.prepare('UPDATE seller_tx SET flw_fee=?, settled=?, charged=?, status=? WHERE tx_ref=?').run(Number(data.app_fee) || 0, Number(data.amount_settled) || 0, Number(data.charged_amount || data.amount) || 0, String(data.status || ''), txRef); } catch (e) { }
    },
    recentTx: () => db.prepare('SELECT t.*, p.title, u.name lecturer FROM seller_tx t LEFT JOIN pages p ON p.id=t.page_id LEFT JOIN users u ON u.id=t.lecturer_id ORDER BY t.created_at DESC LIMIT 25').all(),
    // Called when Flutterwave has confirmed a payment: keep the sale on record and tell the lecturer.
    onPaid(pageId, txRef, buyerId, amountKobo, notify) {
      try {
        const p = db.prepare('SELECT id,title,slug,author_id,price_kobo FROM pages WHERE id=?').get(pageId);
        if (!p || !p.author_id || !api.account(p.author_id)) return;
        const lec = p.price_kobo || 0, fee = Math.max(0, amountKobo - lec);
        const r = db.prepare('INSERT OR IGNORE INTO seller_sales(tx_ref,page_id,lecturer_id,buyer_id,lecturer_kobo,fee_kobo,created_at) VALUES(?,?,?,?,?,?,?)').run(txRef, p.id, p.author_id, buyerId, lec, fee, Date.now());
        if (r.changes) notify([p.author_id], { title: 'You made a sale', body: `Someone bought "${p.title}". ₦${(lec / 100).toLocaleString()} is on its way to your bank account.`, url: '/lecturer/sell', tag: 'sale' });
      } catch (e) { console.error('Seller sale record failed:', e.message); }
    },
    earnings: userId => db.prepare('SELECT COUNT(*) n, COALESCE(SUM(lecturer_kobo),0) k FROM seller_sales WHERE lecturer_id=?').get(userId),
    sales: userId => db.prepare('SELECT s.*, p.title FROM seller_sales s LEFT JOIN pages p ON p.id=s.page_id WHERE s.lecturer_id=? ORDER BY s.created_at DESC LIMIT 30').all(userId),
    async banks() {
      if (api._banks && Date.now() - api._banksAt < 6 * 3600e3) return api._banks;
      const r = await flw('GET', 'banks/NG');
      if (!r.ok || !Array.isArray(r.j.data)) throw new Error('Could not load the bank list.');
      api._banks = r.j.data.map(b => ({ code: b.code, name: b.name })).sort((a, b) => a.name.localeCompare(b.name)); api._banksAt = Date.now();
      return api._banks;
    },
    async resolve(bank, number) {
      const r = await flw('POST', 'accounts/resolve', { account_number: number, account_bank: bank });
      if (!r.ok || !r.j.data || !r.j.data.account_name) throw new Error('Could not find that account. Check the bank and the number.');
      return String(r.j.data.account_name);
    },
    async makeSub(user, bank, number, name) {
      const r = await flw('POST', 'subaccounts', { account_bank: bank, account_number: number, business_name: name, business_email: user.email, business_mobile: process.env.SELLER_PHONE || '08000000000', country: 'NG', split_type: 'percentage', split_value: Math.round(100 / (100 + api.feeSettings().pct)) / 100 });
      if (!r.ok || !r.j.data || !r.j.data.subaccount_id) throw new Error((r.j && r.j.message) || 'Flutterwave could not set up the account.');
      return String(r.j.data.subaccount_id);
    },
    // Moves any changed account whose waiting time is over into use.
    async activatePending() {
      const due = db.prepare('SELECT * FROM seller_accounts WHERE p_at IS NOT NULL AND p_at<?').all(Date.now() - WAIT_MS);
      for (const a of due) {
        try {
          const u = db.prepare('SELECT id,email FROM users WHERE id=?').get(a.user_id);
          const sub = await api.makeSub(u, a.p_bank_code, a.p_account_number, a.p_account_name);
          db.prepare('UPDATE seller_accounts SET bank_code=p_bank_code, bank_name=p_bank_name, account_number=p_account_number, account_name=p_account_name, subaccount_id=?, p_bank_code=NULL, p_bank_name=NULL, p_account_number=NULL, p_account_name=NULL, p_at=NULL WHERE user_id=?').run(sub, a.user_id);
        } catch (e) { console.error('Seller account change failed:', e.message); }
      }
    },
  };
  cache.set(db, api);
  return api;
}

const mask = n => '••••••' + String(n || '').slice(-4);

function register(app, ctx) {
  const { db, esc, layout, isCentral } = ctx;
  const bcrypt = ctx.bcrypt || require('bcryptjs');
  const S = seller(db);
  const lecturer = req => req.user && req.user.is_lecturer && req.user.lecturer_status === 'approved';
  const money = k => '₦' + (k / 100).toLocaleString();
  setInterval(() => S.activatePending().catch(() => {}), 10 * 60e3).unref();

  app.get('/lecturer/sell/banks', async (req, res) => {
    if (!lecturer(req)) return res.sendStatus(403);
    try { res.json({ banks: await S.banks() }); } catch (e) { res.json({ error: e.message }); }
  });
  app.post('/lecturer/sell/check', async (req, res) => {
    if (!lecturer(req)) return res.sendStatus(403);
    const bank = String(req.body.bank || ''), number = String(req.body.number || '').replace(/\D/g, '');
    if (!bank || number.length !== 10) return res.json({ error: 'Choose the bank and enter the 10-digit account number.' });
    try { const name = await S.resolve(bank, number); res.json({ name, match: S.namesMatch(name, req.user.name) }); } catch (e) { res.json({ error: e.message }); }
  });
  app.post('/lecturer/sell/save', async (req, res) => {
    if (!lecturer(req)) return res.sendStatus(403);
    const back = (m, err) => res.redirect('/lecturer/sell?' + (err ? 'err=1&' : '') + 'msg=' + encodeURIComponent(m));
    const bank = String(req.body.bank || ''), number = String(req.body.number || '').replace(/\D/g, '');
    if (!bank || number.length !== 10) return back('Choose the bank and enter the 10-digit account number.', 1);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!u.gsignup && !(u.hash && bcrypt.compareSync(String(req.body.password || ''), u.hash))) return back('That password is not right.', 1);
    const cur = S.account(u.id);
    if (cur && cur.blocked) return back('Selling is switched off for your account. Contact the Studies Hub team.', 1);
    try {
      const name = await S.resolve(bank, number);
      if (!S.namesMatch(name, u.name)) return back(`The account name "${name}" does not match your profile name "${u.name}". Use your own account, or correct your profile name.`, 1);
      const bankName = ((await S.banks().catch(() => [])).find(b => b.code === bank) || {}).name || bank;
      if (cur && cur.subaccount_id) { // changing an account that already works: wait 24 hours before it takes money
        db.prepare('UPDATE seller_accounts SET p_bank_code=?, p_bank_name=?, p_account_number=?, p_account_name=?, p_at=? WHERE user_id=?').run(bank, bankName, number, name, Date.now(), u.id);
        return back('Saved. For your safety the new account starts taking payments in 24 hours. Until then the old one is used.');
      }
      const sub = await S.makeSub(u, bank, number, name);
      db.prepare('INSERT INTO seller_accounts(user_id,bank_code,bank_name,account_number,account_name,subaccount_id,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bank_code=excluded.bank_code, bank_name=excluded.bank_name, account_number=excluded.account_number, account_name=excluded.account_name, subaccount_id=excluded.subaccount_id').run(u.id, bank, bankName, number, name, sub, Date.now());
      back('Done. You can now put a price on your uploads.');
    } catch (e) { back(e.message, 1); }
  });
  app.get('/lecturer/sell', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/sell');
    if (!lecturer(req)) return res.redirect('/lecturer');
    const a = S.account(req.user.id), fee = S.feeSettings(), e = S.earnings(req.user.id);
    const msg = req.query.msg ? `<p class="${req.query.err ? 'err' : 'pill'}">${esc(req.query.msg)}</p>` : '';
    const status = a && a.blocked ? '<p class="err">Selling is switched off for your account.</p>' : a && a.subaccount_id ? `<div class="card"><b>✅ Payments go to</b><br>${esc(a.account_name)}<br><span class="mut">${esc(a.bank_name)} &middot; ${mask(a.account_number)}</span>${a.p_at ? `<p class="mut" style="margin:8px 0 0">A new account (${esc(a.p_bank_name)} ${mask(a.p_account_number)}) starts in ${Math.max(1, Math.ceil((a.p_at + WAIT_MS - Date.now()) / 3600e3))} hour(s).</p>` : ''}</div>` : '<p class="mut">You have not added a bank account yet.</p>';
    const sales = S.sales(req.user.id).filter(s => s.page_id).map(s => `<div class="card row"><div>${esc(s.title || 'Material')}<br><span class="mut" style="font-size:13px">${new Date(s.created_at).toLocaleDateString('en-GB')}</span></div><b>${money(s.lecturer_kobo)}</b></div>`).join('');
    res.send(layout('Sell your materials', `<p class="mut"><a href="/lecturer/uploads">&larr; Uploaded documents</a></p><h1>Sell your materials</h1>${msg}
<p class="mut">Put a price on any of your uploads. When a student pays, your price goes straight to your bank account. The student pays your price plus a small system charge (${fee.flat ? '₦' + fee.flat + ' + ' : ''}${fee.pct}%) that goes to Studies Hub.</p>
${status}
<form class="card" method="post" action="/lecturer/sell/save" id="sf"><h3 style="margin-top:0">${a && a.subaccount_id ? 'Change bank account' : 'Add your bank account'}</h3>
<select name="bank" id="sb" required><option value="">Loading banks...</option></select>
<input name="number" id="sn" inputmode="numeric" maxlength="10" placeholder="10-digit account number" required>
<button type="button" id="sc" class="ghost">Check account name</button>
<p id="sr" class="mut" style="margin:8px 0"></p>
${req.user.gsignup ? '' : '<input type="password" name="password" placeholder="Your password" autocomplete="current-password" required>'}
<button id="ss" disabled>Save bank account</button>
<p class="mut" style="font-size:13px">The account name must match your profile name (${esc(req.user.name)}). Only your own account works.</p></form>
<div class="card"><b>Your sales</b><br><span class="mut">${e.n} sale(s) &middot; ${money(e.k)} earned</span></div>${sales}
<script>(function(){var b=document.getElementById('sb'),n=document.getElementById('sn'),r=document.getElementById('sr'),s=document.getElementById('ss');
fetch('/lecturer/sell/banks',{credentials:'same-origin'}).then(function(x){return x.json()}).then(function(j){if(j.error){b.innerHTML='<option value="">'+j.error+'</option>';return}b.innerHTML='<option value="">Choose your bank</option>'+j.banks.map(function(k){var o=document.createElement('option');o.value=k.code;o.textContent=k.name;return o.outerHTML}).join('')}).catch(function(){b.innerHTML='<option value="">Could not load banks</option>'});
function reset(){s.disabled=true;r.textContent=''}b.onchange=reset;n.oninput=reset;
document.getElementById('sc').onclick=function(){r.textContent='Checking...';fetch('/lecturer/sell/check',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bank:b.value,number:n.value})}).then(function(x){return x.json()}).then(function(j){if(j.error){r.textContent='❌ '+j.error;s.disabled=true;return}r.textContent=(j.match?'✅ ':'❌ ')+j.name+(j.match?' - matches your profile name.':' - does not match your profile name, so it cannot be used.');s.disabled=!j.match}).catch(function(){r.textContent='❌ No connection.'})};})();</script>`, req.user));
  });

  // The owner sets the system charge.
  app.get('/admin/seller-fee', (req, res) => {
    if (!isCentral(req.user)) return res.sendStatus(403);
    const f = S.feeSettings();
    res.send(layout('System charge', `<p class="mut"><a href="/admin/prices">&larr; Prices</a></p><h1>System charge on lecturer sales</h1>${req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : ''}
<p class="mut">Added on top of the lecturer's price. The lecturer always receives exactly the price they set. Flutterwave's own fee is taken from your share first. So the site never charges less than <b>5%</b> (plus ₦50 on sales above ₦9,500), even if you set it lower: below that, Flutterwave cannot split the payment and the lecturer would get nothing. <a href="/admin/seller-check">Check recent payments &rarr;</a></p>
<form class="card" method="post" action="/admin/seller-fee"><label class="mut">Flat amount (₦)</label><input name="flat" type="number" step="1" min="0" max="5000" value="${f.flat}"><label class="mut">Percentage of the lecturer's price (%)</label><input name="pct" type="number" step="0.5" min="0" max="50" value="${f.pct}"><button>Save</button></form>
<p class="mut">Example: a ₦1,000 material costs the student ₦${(1000 + S.feeKobo(100000) / 100).toLocaleString()}; the lecturer gets ₦1,000.</p>`, req.user));
  });
  app.post('/admin/seller-fee', (req, res) => {
    if (!isCentral(req.user)) return res.sendStatus(403);
    res.redirect('/admin/seller-fee?msg=' + encodeURIComponent(S.setFee(req.body.flat, req.body.pct) ? 'Saved.' : 'Use a flat amount from 0 to 5000 and a percentage from 0 to 50.'));
  });
  // The owner's check page: for every recent split payment, what we asked Flutterwave and what Flutterwave said back.
  app.get('/admin/seller-check', async (req, res) => {
    if (!isCentral(req.user)) return res.sendStatus(403);
    const rows = S.recentTx(), money = n => '₦' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const verdict = t => {
      if (t.status === null || t.status === undefined || t.status === '') return ['⏳', 'Not confirmed by Flutterwave yet.'];
      if (t.settled && t.settled < t.lecturer_kobo / 100) return ['❌', `Flutterwave will settle only ${money(t.settled)} to you, which is less than the lecturer's ${money(t.lecturer_kobo / 100)}. When that happens Flutterwave does NOT split and everything goes to your account. Raise the system charge.`];
      return ['✅', `Asked Flutterwave to pay the lecturer ${money(t.lecturer_kobo / 100)} and keep the rest. Flutterwave's fee: ${money(t.flw_fee)}; settles to the site (before the lecturer's part): ${money(t.settled)}.`];
    };
    let subs = ''; try { const r = await flw('GET', 'subaccounts'); subs = r.ok && Array.isArray(r.j.data) ? r.j.data : []; } catch (e) { subs = []; }
    const accs = db.prepare('SELECT a.*, u.name FROM seller_accounts a JOIN users u ON u.id=a.user_id').all();
    res.send(layout('Seller payments check', `<p class="mut"><a href="/admin/prices">&larr; Prices</a></p><h1>Lecturer payments check</h1>
<p class="mut">Flutterwave pays lecturers on <b>its settlement schedule</b> (usually the next working day), not the moment the student pays. Same-day tests show as pending. In your Flutterwave dashboard open Settings → Settlements and make sure settlement is <b>automatic</b>, not manual: split payments need that.</p>
<h3>Lecturer bank accounts</h3>${accs.map(a => { const f = Array.isArray(subs) ? subs.find(x => x.subaccount_id === a.subaccount_id) : null; return `<div class="card"><b>${esc(a.name)}</b> &middot; ${esc(a.bank_name || '')} ${mask(a.account_number)}<br><span class="mut" style="font-size:13px">${a.subaccount_id ? 'Subaccount ' + esc(a.subaccount_id) + (f ? ' &middot; Flutterwave default rule: ' + esc(f.split_type) + ' ' + esc(f.split_value) : Array.isArray(subs) && subs.length ? ' &middot; <b style="color:#ff6b6b">not found on Flutterwave</b>' : '') : 'No subaccount yet'}${a.blocked ? ' &middot; selling switched off' : ''}</span></div>`; }).join('') || '<p class="mut">No lecturer has added a bank account yet.</p>'}
<h3>Recent split payments</h3>${rows.map(t => { const [i, m] = verdict(t); return `<div class="card"><b>${i} ${esc(t.title || 'Material')}</b> &middot; ${esc(t.lecturer || '')}<br>Student paid ${money(t.total_kobo / 100)} &middot; lecturer's price ${money(t.lecturer_kobo / 100)}<br><span class="mut" style="font-size:13px">${esc(m)}<br>Sent to Flutterwave: <code>${esc(t.sent)}</code></span></div>`; }).join('') || '<p class="mut">No split payment yet.</p>'}`, req.user));
  });
  // The owner can switch one lecturer's selling off.
  app.post('/admin/seller/:id/block', (req, res) => {
    if (!isCentral(req.user)) return res.sendStatus(403);
    db.prepare('UPDATE seller_accounts SET blocked=? WHERE user_id=?').run(req.body.on ? 1 : 0, Number(req.params.id));
    res.redirect(req.get('referer') || '/admin');
  });
}
module.exports = seller;
module.exports.register = register;
module.exports.namesMatch = namesMatch;
