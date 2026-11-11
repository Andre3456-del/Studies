// News feed, news pages and news posting
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { ADSENSE_CLIENT, ADSENSE_FEED_SLOT, SPONSOR_PRICE_NGN, canSeeNewsItem, db, esc, feedAdCard, layout, linkify, newsReachFor, notify, timeAgo, upload } = ctx;
  function newsFeedBody(req, home = false) {
    const all = db.prepare("SELECT n.*, u.name AS author, u.title AS author_title, u.position_auto_role AS author_auto_role FROM news n LEFT JOIN users u ON u.id = n.author_id WHERE n.status='approved' ORDER BY n.id DESC").all();
    const items = all.filter(n => canSeeNewsItem(n, req.user));
    const newsImg = n => n.image_data ? `<img class="news-img" src="/news-image/${n.id}" alt="">` : n.image_url ? `<img class="news-img" src="${esc(n.image_url)}" alt="">` : '<div class="news-img"></div>';
    const cardList = items.map(n => `<a class="news-card" href="/news/${n.id}">${newsImg(n)}<div class="news-body"><h3>${esc(n.title)}</h3><p class="mut news-snip">${esc(n.body)}</p><div class="news-meta"><span>${ctx.byline(n)}</span><span>&middot;</span><span>${timeAgo(n.created_at)}</span></div></div></a>`);
    const cards = cardList.join('');
    const empty = '<p class="mut">No news yet. Check back soon.</p>';
    if (home) return ADSENSE_FEED_SLOT && cardList.length ? cardList.flatMap((c, i) => i === 0 || i % 4 === 3 ? [c, feedAdCard()] : [c]).join('') : (cards || empty);
    // News section only (not the home page): the sponsor-ad script, any active paid promotional posts, and the
    // link to buy one.
    const adScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`;
    const sponsors = db.prepare("SELECT * FROM sponsor_posts WHERE status='approved' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 3").all();
    const sponsorCards = sponsors.map(s => `<div class="card" style="border-color:#ffd166"><p class="pill" style="background:#ffd16622;border-color:#ffd16655;color:#ffd166">Sponsored</p>${s.image_data ? `<img class="news-img" src="/sponsor-image/${s.id}" alt="" style="margin-bottom:8px">` : ''}<h3 style="margin:4px 0">${esc(s.title)}</h3><p class="mut" style="white-space:pre-wrap">${linkify(s.body)}</p>${s.contact ? `<p class="mut" style="margin:4px 0 0">${linkify(s.contact)}</p>` : ''}${req.user && req.user.id === s.user_id ? `<a class="btn" href="/sponsor/${s.id}/edit" style="display:block;text-align:center;margin-top:12px">Edit post</a>` : ''}</div>`).join('');
    const submitForm = req.user
      ? `<details class="card" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:600">Share something</summary><form method="post" action="/news" enctype="multipart/form-data" style="margin-top:10px"><input name="title" placeholder="Headline" required maxlength="140"><input type="file" name="image" accept="image/*" style="padding:9px 0"><textarea name="body" placeholder="What's happening?" required maxlength="2000000" style="width:100%;min-height:70px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea><button>Submit for review</button></form><p class="mut" style="margin:6px 0 0">An admin checks it before it goes live.</p></details>`
      : '<p class="mut"><a href="/login?next=/news">Log in</a> to share something.</p>';
    const approverQueue = req.user ? (() => {
      const waiting = db.prepare("SELECT n.*, u.name AS author FROM news n JOIN users u ON u.id=n.author_id WHERE n.status='pending_approver' AND n.approver_id=?").all(req.user.id);
      if (!waiting.length) return '';
      return `<h3>Waiting for your approval (${waiting.length})</h3>${waiting.map(n => `<div class="card"><b>${esc(n.author)}</b> wrote: <b>${esc(n.title)}</b><p class="mut">${esc(n.body.slice(0, 200))}${n.body.length > 200 ? '…' : ''}</p><div class="row" style="gap:6px"><form method="post" action="/news/${n.id}/approver-approve"><button>Approve</button></form><form method="post" action="/news/${n.id}/approver-reject"><button class="link">Reject</button></form></div></div>`).join('')}`;
    })() : '';
    const sponsorLink = req.user ? `<p class="mut" style="margin:0 0 16px"><a href="/sponsor">Advertise here &middot; ₦${SPONSOR_PRICE_NGN.toLocaleString()}/month &rarr;</a></p>` : '';
    return `${adScript}<h1>News</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}${approverQueue}${submitForm}${sponsorLink}${sponsorCards}${cards || empty}`;
  }
  app.get('/news', (req, res) => res.send(layout('News', newsFeedBody(req), req.user)));
  app.get('/news-image/:id', (req, res) => {
    const row = db.prepare('SELECT image_data, image_mime FROM news WHERE id=?').get(req.params.id);
    if (!row || !row.image_data) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', row.image_mime || 'application/octet-stream');
    res.send(Buffer.from(row.image_data));
  });
  // The bigger, tap-through view of one news item: full picture, and the text exactly as it was
  // typed or pasted -- real line breaks kept (via the .news-full CSS rule), nothing squashed together.
  app.get('/news/:id', (req, res) => {
    const n = db.prepare("SELECT n.*, u.id AS author_uid, u.name AS author, u.title AS author_title, u.position_auto_role AS author_auto_role, u.avatar_mime FROM news n LEFT JOIN users u ON u.id = n.author_id WHERE n.id=? AND n.status='approved'").get(req.params.id);
    if (!n || !canSeeNewsItem(n, req.user)) return res.status(404).send(layout('Not found', '<h2>News item not found</h2><p><a href="/news">Back to News</a></p>', req.user));
    const img = n.image_data ? `<img src="/news-image/${n.id}" style="width:100%;border-radius:14px;margin-bottom:16px">` : n.image_url ? `<img src="${esc(n.image_url)}" style="width:100%;border-radius:14px;margin-bottom:16px">` : '';
    const who = n.author_uid ? ctx.avatarOr({ id: n.author_uid, name: n.author, avatar_mime: n.avatar_mime }, 40) : '';
    const nameHtml = n.author_uid && req.user ? `<a href="/u/${n.author_uid}"><b>${esc(n.author)}</b></a>` : `<b>${esc(n.author || 'Studies Hub')}</b>`;
    const posted = `<div class="row" style="justify-content:flex-start;gap:10px;margin-top:16px">${who}<div>${nameHtml}${n.author_title ? `<span class="role-tag">${esc(n.author_title)}</span>` : ''}${ctx.verifiedBadge(n.author_auto_role)}<br><span class="mut" style="font-size:12px">${timeAgo(n.created_at)} ago</span></div></div>`;
    const adScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`;
    res.send(layout(n.title, `${adScript}<p class="mut" style="margin:0 0 12px"><a href="/news">&larr; Back to News</a></p><div class="card">${img}<h1 style="margin-top:0">${esc(n.title)}</h1><p class="news-full">${linkify(n.body)}</p>${posted}</div>`, req.user));
  });
  app.post('/news', upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login?next=/news');
    const title = String(req.body.title || '').trim().slice(0, 140);
    const body = String(req.body.body || '').trim().slice(0, 2000000);
    if (!title || !body) return res.redirect('/news?msg=' + encodeURIComponent('Enter a headline and a summary.'));
    if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect('/news?msg=' + encodeURIComponent('That file is not an image.'));
    const reach = newsReachFor(req.user);
    const hasApprover = req.user.position_status === 'approved' && req.user.position_approver_id;
    const status = hasApprover ? 'pending_approver' : 'pending';
    db.prepare("INSERT INTO news(title,body,image_data,image_mime,author_id,status,scope_type,scope_department,scope_level,scope_faculty,approver_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(title, body, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, req.user.id, status, reach.scope_type, reach.scope_department, reach.scope_level, reach.scope_faculty, hasApprover ? req.user.position_approver_id : null);
    if (hasApprover) notify([req.user.position_approver_id], { title: 'News to review', body: `${req.user.name}: ${title}`, url: '/news', tag: 'news-review' });
    else notify(db.prepare("SELECT id FROM users WHERE role IN ('admin','news')").all().map(r => r.id), { title: 'News to review', body: `${req.user.name}: ${title}`, url: '/admin#pending-news', tag: 'news-review' });
    res.redirect('/news?msg=' + encodeURIComponent("Thanks -- we'll review it shortly."));
  });
  return { newsFeedBody };
};
