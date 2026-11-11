// Share target, open links and member profile pages
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { cleanUsername, db, esc, isOnline, layout, timeAgo, upload } = ctx;
  app.post('/share-target', upload.single('photo'), (req, res) => {
    if (!req.user) return res.redirect('/login?next=/news');
    const title = String(req.body.title || '').trim().slice(0, 140);
    const text = String(req.body.text || '').trim();
    const url = String(req.body.url || '').trim();
    const body = [text, url].filter(Boolean).join('\n').trim().slice(0, 2000000);
    const img = req.file && /^image\//.test(req.file.mimetype);
    const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const imgTag = img ? `<p class="mut" style="margin:10px 0 2px">Photo you shared:</p><img id="shareImgPreview" src="data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}" style="max-width:100%;border-radius:12px;margin-bottom:10px">
<input type="file" name="image" id="shareImg" accept="image/*" style="display:none">
<script>fetch(document.getElementById('shareImgPreview').src).then(function(r){return r.blob()}).then(function(b){var f=new File([b],'shared.${EXT[req.file.mimetype] || 'jpg'}',{type:'${req.file.mimetype}'});var dt=new DataTransfer();dt.items.add(f);document.getElementById('shareImg').files=dt.files})</script>` : '';
    res.send(layout('Share to News', `<p class="mut"><a href="/news">&larr; Back</a></p><h1 style="font-size:24px">Share to News</h1>
<p class="mut">Finish this up and it'll go to a news admin for approval, same as posting from the News page.</p>
<form class="card" method="post" action="/news" enctype="multipart/form-data">
<input name="title" placeholder="Headline" required maxlength="140" value="${esc(title)}">
<textarea name="body" required maxlength="2000000" style="width:100%;min-height:100px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(body)}</textarea>
${imgTag}
<button>Submit for review</button></form>`, req.user));
  });
  // Protocol handler target: web+studieshub://... links land here and get redirected to the matching page.
  app.get('/open', (req, res) => {
    const raw = String(req.query.u || '');
    const m = raw.match(/^web\+studieshub:\/\/(.*)$/i);
    let dest = m ? '/' + m[1].replace(/^\/+/, '') : raw;
    if (!dest.startsWith('/') || dest.startsWith('//') || dest.includes('://')) dest = '/dashboard';
    res.redirect(dest);
  });

  // A member's profile: what they've chosen to share (university, department, level, their verified position) plus their approved news.
  // /@username opens that member's profile (this is where every tapped @username in chat, news and posts leads).
  app.get('/@:username', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const u = db.prepare('SELECT id FROM users WHERE lower(username)=?').get(cleanUsername(req.params.username));
    if (!u) return res.status(404).send(layout('Not found', `<p class="mut"><a href="javascript:history.back()">&larr; Back</a></p><h2>No member with that username</h2><p class="mut">@${esc(cleanUsername(req.params.username))} does not exist (or has not finished signing up).</p>`, req.user));
    res.redirect('/u/' + u.id);
  });
  app.get('/u/:id', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const u = db.prepare('SELECT id,name,title,position_auto_role,avatar_mime,username,department,university,level,graduated,last_seen,hide_active FROM users WHERE id=?').get(Number(req.params.id));
    if (!u) return res.status(404).send(layout('Not found', '<h2>Member not found</h2>', req.user));
    const facts = [['University', u.university], ['Department', u.department], ['Course', u.dept_option], ['Level', u.level ? u.level + ' level' : null], ['Status', u.graduated ? '🎓 Graduate' : null]].filter(r => r[1])
      .map(r => `<tr><td class="mut">${r[0]}</td><td>${esc(String(r[1]))}</td></tr>`).join('');
    const posts = db.prepare("SELECT id,title,created_at FROM news WHERE author_id=? AND status='approved' ORDER BY id DESC LIMIT 5").all(u.id);
    const me = u.id === req.user.id, areFriends = !me && ctx.friendStatus(req.user.id, u.id) === 'friends';
    const action = me ? '<a class="btn ghost" href="/settings/profile">Edit my profile</a>'
      : areFriends ? `<a class="btn" href="/chat/${u.id}">Message ${esc(u.name.split(' ')[0])}</a>`
      : ctx.friendActionHtml(req.user.id, u.id);
    res.send(layout(u.name, `<p class="mut" style="margin:0 0 12px"><a href="javascript:history.back()">&larr; Back</a></p>
<div class="card"><div class="prof">${ctx.avatarOr(u, 88)}<div><h1 style="margin:0;font-size:26px">${esc(u.name)}</h1><p class="mut" style="margin:2px 0 0">${u.username ? `@${esc(u.username)}` : ''}</p>${u.title ? `<span class="role-tag" style="margin:4px 0 0">${esc(u.title)}</span>${ctx.verifiedBadge(u.position_auto_role)}` : ''}<div class="mut" style="margin-top:6px">${isOnline(u) ? 'Online now' : ''}</div></div></div>
${facts ? `<table style="margin-top:14px">${facts}</table>` : '<p class="mut" style="margin:14px 0 0">No department, university or level added yet.</p>'}
<p style="margin:14px 0 0">${action}</p></div>
${posts.length ? `<h3>News from ${esc(u.name.split(' ')[0])}</h3>${posts.map(p => `<div class="card row"><a href="/news/${p.id}">${esc(p.title)}</a><span class="mut">${timeAgo(p.created_at)}</span></div>`).join('')}` : ''}`, req.user));
  });
};
