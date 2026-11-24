// Changing an upload after it is posted (its name, its file, and whether it is paid and for how much),
// and the owner's page for the standing prices. Only the owner can touch money.
module.exports = function register(app, ctx) {
  const { NOT_YOURS, applySemester, back, can, db, esc, isCentral, layout, ownsAdminPage, pagesAdmin, youtubeId } = ctx;
  const P = require('../lib/prices')(db);
  const owner = (req, res, next) => (req.user && isCentral(req.user)) ? next() : res.sendStatus(403);
  const find = (req, res) => {
    const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
    if (!p) { res.redirect(back('Page not found.')); return null; }
    if (p.author_id && !isCentral(req.user)) { res.redirect(back('That was uploaded by a lecturer -- only they can change it.')); return null; }
    if (!ownsAdminPage(req.user, p)) { res.redirect(back(NOT_YOURS)); return null; }
    return p;
  };
  app.get('/admin/pages/:id/edit', pagesAdmin, (req, res) => {
    const p = find(req, res); if (!p) return;
    const own = isCentral(req.user), ngn = (p.price_kobo || P.defKobo(p.kind)) / 100;
    const money = own ? `<label class="mut">Payment</label><label><input type="radio" name="paid" value="0"${p.paid ? '' : ' checked'}> Free to view</label><br><label><input type="radio" name="paid" value="1"${p.paid ? ' checked' : ''}> People pay to view</label>
<label class="mut">Price in naira (used when payment is on)</label><input name="price" type="number" min="1" max="10000000" step="1" value="${ngn}">` : '<p class="mut">Only the owner can set a price.</p>';
    const cbt = p.kind === 'cbt' ? `<p><a class="btn" href="/cbt/${p.id}/settings">CBT settings (practice or test, time, open and close)</a> <a class="btn ghost" href="/admin/pages/${p.id}/results">Results</a></p>` : '';
    const swap = p.kind === 'video'
      ? `<form method="post" action="/admin/pages/${p.id}/video" class="card"><label class="mut">Change the YouTube link</label><input name="video_url" placeholder="https://youtube.com/watch?v=..."><button>Update link</button></form>`
      : `<form method="post" action="/admin/pages/${p.id}/replace" enctype="multipart/form-data" class="card"><label class="mut">Change the file</label><input type="file" name="file" required><button>Replace file</button></form>`;
    res.send(layout('Edit', `<p class="mut"><a href="/admin?tab=pages">&larr; Admin</a></p><h1 style="font-size:26px">Edit upload</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
<form class="card" method="post" action="/admin/pages/${p.id}/edit"><label class="mut">Name</label><input name="title" value="${esc(p.title)}" required maxlength="140"><input name="code" value="${esc(p.code || '')}" placeholder="Course code" maxlength="30">${money}${cbt}<button>Save</button></form>${swap}`, req.user));
  });
  app.post('/admin/pages/:id/edit', pagesAdmin, (req, res) => {
    const p = find(req, res); if (!p) return;
    const title = String(req.body.title || '').trim().slice(0, 140);
    if (!title) return res.redirect('/admin/pages/' + p.id + '/edit?msg=' + encodeURIComponent('Give it a name.'));
    db.prepare('UPDATE pages SET title=? WHERE id=?').run(title, p.id);
    if (req.body.code !== undefined && String(req.body.code).trim() !== String(p.code || '')) applySemester({ id: p.id }, 'auto', req.body.code);
    if (p.kind === 'cbt' && req.body.cbt_once !== undefined) db.prepare('UPDATE pages SET cbt_minutes=?, cbt_once=? WHERE id=?').run(Math.max(0, Math.min(600, Math.round(Number(req.body.cbt_minutes)) || 0)), req.body.cbt_once === '1' ? 1 : 0, p.id);
    if (isCentral(req.user) && (req.body.paid === '0' || req.body.paid === '1')) {
      const ngn = Math.round(Number(req.body.price));
      if (req.body.paid === '1' && !(ngn >= 1 && ngn <= 10000000)) return res.redirect('/admin/pages/' + p.id + '/edit?msg=' + encodeURIComponent('Enter a price in naira.'));
      db.prepare('UPDATE pages SET paid=?, price_kobo=? WHERE id=?').run(Number(req.body.paid), ngn >= 1 ? ngn * 100 : (p.price_kobo || P.defKobo(p.kind)), p.id);
    }
    res.redirect('/admin?tab=pages&msg=' + encodeURIComponent('Saved.'));
  });
  app.get('/admin/prices', owner, (req, res) => {
    const row = (k, t, d) => `<label class="mut"><b>${t}</b> &middot; ${d}</label><input name="${k}" type="number" min="1" max="10000000" step="1" value="${P[k]()}" required>`;
    res.send(layout('Prices', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Prices</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}<a class="card row" href="/admin/seller-fee" style="text-decoration:none;color:inherit"><div><b>System charge on lecturer sales</b><br><span class="mut" style="font-size:13px">What the site keeps when a lecturer sells a material</span></div><span>&rsaquo;</span></a>
<form class="card" method="post" action="/admin/prices">${row('sponsor', 'Sponsor post', 'naira per month')}${row('cbt', 'CBT test', 'naira to open one')}${row('material', 'Other paid materials', 'naira to open one')}
<p class="hint">A new price shows everywhere straight away (the advert page, the news page, the payment page). Paid items still at the old standing price move to the new one; an item you gave its own price keeps it.</p><button>Save prices</button></form>`, req.user));
  });
  app.post('/admin/prices', owner, (req, res) => {
    const bad = ['sponsor', 'cbt', 'material'].filter(k => req.body[k] !== undefined && String(req.body[k]) !== String(P[k]()) && !P.set(k, req.body[k]));
    res.redirect('/admin/prices?msg=' + encodeURIComponent(bad.length ? 'Enter whole naira amounts from 1 up.' : 'Prices saved.'));
  });
};
