// Sponsor posts: anyone -- a member or a visitor with no account -- can pay to advertise a product or service with a picture, a video or audio.
// A member manages the post from their account. A visitor manages it through a private link (/sponsor/g/<key>) that is shown after they
// submit it and emailed to them. Payment goes through the same Flutterwave checkout as everything else (routes/payments.js).
const multer = require('multer');
module.exports = function register(app, ctx) {
  const { FLW_ON, FLW_WINDOW, SPONSOR_PRICE_NGN, admin, baseUrl, crypto, db, deliver, esc, flwCheckout, flwSettle, fullAdminIds, layout, limited, notify } = ctx;
  for (const [col, def] of [['guest_name', 'TEXT'], ['guest_email', 'TEXT'], ['guest_key', 'TEXT'], ['media_data', 'BLOB'], ['media_mime', 'TEXT'], ['media_kind', 'TEXT']]) {
    if (!db.prepare('PRAGMA table_info(sponsor_posts)').all().some(c => c.name === col)) db.exec(`ALTER TABLE sponsor_posts ADD COLUMN ${col} ${def}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS sponsor_guest_key ON sponsor_posts(guest_key)');

  // ---------- what can be uploaded ----------
  const KINDS = [[/^image\/(jpeg|png|webp|gif)$/, 'image', 10], [/^video\/(mp4|webm|quicktime|3gpp|x-m4v)$/, 'video', 60], [/^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|ogg|wav|x-wav|webm|opus)$/, 'audio', 20]];
  const SIZE_NOTE = 'Pictures up to 10 MB, audio up to 20 MB, video up to 60 MB.';
  const mu = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 1 } }).single('media');
  const takeUpload = (req, res, next) => mu(req, res, err => { if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big. ' + SIZE_NOTE : 'The file could not be uploaded. Please try again.'; next(); });
  // Returns { kind } for an acceptable file, { error } for a bad one, {} when there is none.
  function checkFile(req) {
    if (req.uploadError) return { error: req.uploadError };
    const f = req.file; if (!f) return {};
    const k = KINDS.find(x => x[0].test(String(f.mimetype || '').toLowerCase()));
    if (!k) return { error: 'That kind of file is not accepted. Use a picture, a video or an audio file.' };
    if (f.size > k[2] * 1024 * 1024) return { error: `That ${k[1]} is too big. ${SIZE_NOTE}` };
    return { kind: k[1] };
  }

  // ---------- small helpers ----------
  const baseOf = s => s.user_id ? '/sponsor/' + s.id : '/sponsor/g/' + s.guest_key;
  const homeOf = s => s.user_id ? '/news' : '/';
  const text = (v, n) => String(v || '').trim().slice(0, n);
  const area = (name, val, ph) => `<textarea name="${name}" placeholder="${ph}" required maxlength="2000" style="width:100%;min-height:80px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(val || '')}</textarea>`;
  const notFound = req => layout('Not found', '<p><a href="/">Back to Studies Hub</a></p>', req.user);
  const tellGuest = (s, subject, body) => { if (s.user_id || !s.guest_email) return; Promise.resolve().then(() => deliver(s.guest_email, subject, body, `<p>${esc(body).replace(/\n/g, '<br>')}</p>`)).catch(() => {}); };

  // ---------- the form to start an advert (open to everyone) ----------
  function createForm(req, v = {}, err = '') {
    const guest = !req.user;
    return layout('Advertise on Studies Hub', `<p class="mut"><a href="${guest ? '/' : '/news'}">&larr; Back</a></p><h1>Advertise your product</h1>
<p class="mut">₦${SPONSOR_PRICE_NGN.toLocaleString()} per month.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form class="card" method="post" action="/sponsor" enctype="multipart/form-data">
${guest ? `<input name="guest_name" placeholder="Your name or business name" required maxlength="80" value="${esc(v.guest_name || '')}"><input name="guest_email" type="email" placeholder="Your email (we send your private link here)" required maxlength="120" value="${esc(v.guest_email || '')}">` : ''}
<input name="title" placeholder="What are you advertising?" required maxlength="140" value="${esc(v.title || '')}">
${area('body', v.body, 'Describe it')}
<input name="contact" placeholder="How should people reach you? (phone, WhatsApp, link, @username)" maxlength="140" value="${esc(v.contact || '')}">
<label class="mut">Picture, video or audio (optional)</label><input type="file" name="media" accept="image/*,video/*,audio/*" style="padding:9px 0"><p class="mut" style="margin:0 0 6px;font-size:13px">${SIZE_NOTE}</p>
<label class="mut">Start date</label><input type="date" name="start_date" id="sponsorStart" required value="${esc(v.start_date || '')}">
<label class="mut">End date</label><input type="date" name="end_date" id="sponsorEnd" required value="${esc(v.end_date || '')}">
<p class="pill" id="sponsorBill" style="margin:8px 0">Pick your dates</p>
<button id="sponsorGo">Continue to payment</button><p class="mut" id="sponsorWait" style="display:none;margin:8px 0 0">Uploading… please wait, big videos take a little while.</p>
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
  document.querySelector('form.card').addEventListener('submit',function(){var b=document.getElementById('sponsorGo');b.disabled=true;document.getElementById('sponsorWait').style.display='block'});
})()</script>`, req.user);
  }
  app.get('/sponsor', (req, res) => res.send(createForm(req)));
  app.post('/sponsor', takeUpload, (req, res) => {
    const v = { guest_name: text(req.body.guest_name, 80), guest_email: text(req.body.guest_email, 120).toLowerCase(), title: text(req.body.title, 140), body: text(req.body.body, 2000), contact: text(req.body.contact, 140), start_date: String(req.body.start_date || ''), end_date: String(req.body.end_date || '') };
    const bad = msg => res.status(400).send(createForm(req, v, msg));
    if (!req.user && limited('ad:' + req.ip, 8, 3600e3)) return bad('Too many adverts from this connection. Please try again in a little while.');
    if (!req.user && (!v.guest_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.guest_email))) return bad('Please give your name and a working email.');
    if (!v.title || !v.body) return bad('Please fill in what you are advertising and describe it.');
    const f = checkFile(req); if (f.error) return bad(f.error);
    const startDate = new Date(v.start_date + 'T00:00:00'), endDate = new Date(v.end_date + 'T00:00:00');
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    if (isNaN(startDate) || isNaN(endDate) || startDate < todayMid || endDate <= startDate) return bad('Please pick a start date from today and an end date after it.');
    const days = Math.round((endDate - startDate) / 86400000);
    if (days < 1 || days > 366) return bad('An advert can run for up to a year.');
    const amountKobo = Math.round(Math.ceil((days / 30) * SPONSOR_PRICE_NGN) * 100);
    const key = req.user ? null : crypto.randomBytes(16).toString('hex');
    const info = db.prepare("INSERT INTO sponsor_posts(user_id,title,body,contact,media_data,media_mime,media_kind,reference,amount_kobo,duration_days,status,guest_name,guest_email,guest_key) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_payment',?,?,?)")
      .run(req.user ? req.user.id : 0, v.title, v.body, v.contact, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, f.kind || null, `sponsor_${req.user ? req.user.id : 0}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, amountKobo, days, req.user ? null : v.guest_name, req.user ? null : v.guest_email, key);
    const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=?').get(info.lastInsertRowid);
    notify(fullAdminIds(), { title: 'Sponsor post payment claim', body: `${req.user ? req.user.name : v.guest_name + ' (visitor)'} wants to advertise "${v.title}" for ${days} days`, url: '/admin#sponsors', tag: 'sponsor' });
    tellGuest(s, 'Your Studies Hub advert', `Your advert "${s.title}" is saved. Pay to put it live, or come back to edit it, at:\n${baseUrl(req)}${baseOf(s)}\nKeep this link private: it is how you manage your advert.`);
    res.redirect(baseOf(s));
  });

  // ---------- one advert, managed by its owner (member account) or by its private link (visitor) ----------
  function mount(prefix, find) {
    app.get(prefix, async (req, res) => {
      let s = find(req, res); if (!s) return;
      if (s.status === 'pending_payment') { const pend = db.prepare("SELECT tx_ref FROM flw_payments WHERE kind='sponsor' AND item_id=? AND status='pending' AND created_at>?").get(s.id, Date.now() - FLW_WINDOW); if (pend) { await flwSettle(pend.tx_ref); s = db.prepare('SELECT * FROM sponsor_posts WHERE id=?').get(s.id); } }
      const b = baseOf(s);
      const statusLine = s.status === 'approved' ? `<p class="pill">&#10003; Live until ${esc((s.expires_at || '').slice(0, 10))}</p>` : s.status === 'rejected' ? '<p class="err">This submission was not approved.</p>' : '<p class="pill pending">Waiting for payment to be confirmed</p>';
      const media = s.media_data && s.media_kind === 'video' ? `<video controls playsinline preload="metadata" src="/sponsor-media/${s.id}?k=${esc(s.guest_key || '')}" style="width:100%;max-height:360px;background:#000;border-radius:10px"></video>`
        : s.media_data && s.media_kind === 'audio' ? `<audio controls src="/sponsor-media/${s.id}?k=${esc(s.guest_key || '')}" style="width:100%"></audio>`
        : s.media_data ? `<img src="/sponsor-media/${s.id}?k=${esc(s.guest_key || '')}" alt="" style="max-width:100%;border-radius:10px">` : s.image_data ? `<img src="/sponsor-image/${s.id}" alt="" style="max-width:100%;border-radius:10px">` : '';
      res.send(layout('Your sponsor post', `<p class="mut"><a href="${homeOf(s)}">&larr; Back</a></p><h1>${esc(s.title)}</h1>${statusLine}
<p class="mut">${s.duration_days} day${s.duration_days === 1 ? '' : 's'} &middot; ₦${(s.amount_kobo / 100).toLocaleString()}</p>
${media}
${s.user_id ? '' : '<p class="mut">Keep this page\'s link. It is how you come back to pay, edit or delete your advert. We also emailed it to you.</p>'}
${s.status === 'approved' ? '' : `<p class="mut"><a href="${b}/edit">Edit this post &rarr;</a></p>`}
${s.status === 'pending_payment' ? (FLW_ON ? `<div class="card" style="text-align:center">${req.query.paid === 'cancelled' ? '<p class="mut" style="margin:0 0 10px">The payment was not completed. You can try again.</p>' : ''}${req.query.paid === '1' ? '<p class="mut" style="margin:0 0 10px">Confirming your payment. This page updates by itself.</p><script>setTimeout(function(){location.reload()},7000)</script>' : ''}<form method="post" action="${b}/pay"><button class="btn" style="width:100%">Continue to payment &middot; ₦${(s.amount_kobo / 100).toLocaleString()}</button></form></div>` : '<div class="card"><p class="err" style="margin:0">Payments are not available right now. Please try again a little later.</p></div>') : ''}
${s.status === 'approved' ? `<a class="btn" href="${b}/edit" style="display:block;text-align:center;margin-top:14px">Edit post</a>` : ''}
<form method="post" action="${b}/delete" onsubmit="return confirm('Delete this sponsor post? This cannot be undone.')" style="margin-top:14px"><button class="link">Delete this post</button></form>`, req.user));
    });
    app.post(prefix + '/pay', async (req, res) => {
      const s = find(req, res); if (!s) return;
      if (s.status !== 'pending_payment') return res.redirect(baseOf(s));
      const payer = s.user_id ? { id: req.user.id, email: req.user.email, name: req.user.name } : { id: 0, email: s.guest_email, name: s.guest_name };
      await flwCheckout(req, res, { kind: 'sponsor', item: s.id, kobo: s.amount_kobo, desc: s.title, back: baseOf(s), payer });
    });
    function editForm(req, s, err = '') {
      const has = s.media_data || s.image_data;
      return layout('Edit your sponsor post', `<p class="mut"><a href="${baseOf(s)}">&larr; Back</a></p><h1>Edit your sponsor post</h1>
${s.status === 'approved' ? '<p class="mut">This is already live -- changes show right away, no need to pay again.</p>' : ''}${err ? `<p class="err">${esc(err)}</p>` : ''}
<form class="card" method="post" action="${baseOf(s)}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(s.title)}" required maxlength="140">
${area('body', s.body, 'Describe it')}
<input name="contact" value="${esc(s.contact || '')}" placeholder="How should people reach you?" maxlength="140">
<label class="mut">${has ? 'Replace the picture, video or audio (optional)' : 'Add a picture, video or audio (optional)'}</label>
<input type="file" name="media" accept="image/*,video/*,audio/*" style="padding:9px 0"><p class="mut" style="margin:0 0 6px;font-size:13px">${SIZE_NOTE}</p>
<button>Save changes</button>
</form>`, req.user);
    }
    app.get(prefix + '/edit', (req, res) => { const s = find(req, res); if (s) res.send(editForm(req, s)); });
    app.post(prefix + '/edit', takeUpload, (req, res) => {
      const s = find(req, res); if (!s) return;
      const title = text(req.body.title, 140), body = text(req.body.body, 2000), contact = text(req.body.contact, 140);
      if (!title || !body) return res.status(400).send(editForm(req, s, 'Please fill in the title and the description.'));
      const f = checkFile(req); if (f.error) return res.status(400).send(editForm(req, s, f.error));
      if (req.file) db.prepare('UPDATE sponsor_posts SET title=?, body=?, contact=?, media_data=?, media_mime=?, media_kind=?, image_data=NULL, image_mime=NULL WHERE id=?').run(title, body, contact, req.file.buffer, req.file.mimetype, f.kind, s.id);
      else db.prepare('UPDATE sponsor_posts SET title=?, body=?, contact=? WHERE id=?').run(title, body, contact, s.id);
      res.redirect(baseOf(s));
    });
    app.post(prefix + '/delete', (req, res) => {
      const s = find(req, res); if (!s) return;
      db.prepare('DELETE FROM sponsor_posts WHERE id=?').run(s.id);
      res.redirect(homeOf(s));
    });
  }
  // the visitor's private link first, then the member's own pages
  mount('/sponsor/g/:key', (req, res) => {
    const s = /^[a-f0-9]{32}$/.test(req.params.key) ? db.prepare('SELECT * FROM sponsor_posts WHERE guest_key=? AND user_id=0').get(req.params.key) : null;
    if (!s) { res.status(404).send(notFound(req)); return null; }
    return s;
  });
  mount('/sponsor/:id', (req, res) => {
    if (!req.user) { res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/sponsor')); return null; }
    const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(Number(req.params.id) || 0, req.user.id);
    if (!s) { res.status(404).send(notFound(req)); return null; }
    return s;
  });

  // ---------- the picture / video / audio itself (video and audio can be skipped through, so byte ranges are supported) ----------
  app.get('/sponsor-media/:id', (req, res) => {
    const row = db.prepare("SELECT media_data, media_mime, status, expires_at, user_id, guest_key, expires_at > datetime('now') AS live FROM sponsor_posts WHERE id=?").get(Number(req.params.id) || 0);
    if (!row || !row.media_data) return res.sendStatus(404);
    const live = row.status === 'approved' && row.live;
    const key = String(req.query.k || '');
    const mine = (req.user && row.user_id === req.user.id) || (row.guest_key && key.length === 32 && key === row.guest_key) || (req.user && fullAdminIds().includes(req.user.id));
    if (!live && !mine) return res.sendStatus(404);
    const buf = Buffer.from(row.media_data), total = buf.length;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', row.media_mime || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', live ? 'public, max-age=3600' : 'private, no-store');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let a = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]), z = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (a > z || a >= total) { res.setHeader('Content-Range', `bytes */${total}`); return res.sendStatus(416); }
      res.status(206); res.setHeader('Content-Range', `bytes ${a}-${z}/${total}`); res.setHeader('Content-Length', z - a + 1);
      return res.end(buf.subarray(a, z + 1));
    }
    res.setHeader('Content-Length', total);
    res.end(buf);
  });

  // ---------- the central admin can take a live advert down ----------
  app.post('/admin/sponsors/:id/remove', admin, (req, res) => {
    const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=?').get(Number(req.params.id) || 0);
    if (!s) return res.redirect(ctx.back('Not found.'));
    db.prepare("UPDATE sponsor_posts SET status='rejected', expires_at=datetime('now') WHERE id=?").run(s.id);
    notify([s.user_id], { title: 'Sponsor post taken down', body: `"${s.title}" was taken down.`, url: baseOf(s), tag: 'sponsor' });
    tellGuest(s, 'Your Studies Hub advert was taken down', `Your advert "${s.title}" was taken down.`);
    res.redirect(ctx.back('Sponsor post taken down.'));
  });

  // Visitors who never paid: their saved advert (and its big video) is removed after three days.
  setInterval(() => { try { db.prepare("DELETE FROM sponsor_posts WHERE user_id=0 AND status='pending_payment' AND created_at < datetime('now','-3 days')").run(); } catch (e) { } }, 6 * 3600e3).unref();
};
