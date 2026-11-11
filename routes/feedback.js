// Feedback form and the owner's feedback inbox
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db, esc, fullAdminIds, isCentral, layout, limited, notify } = ctx;
  const feedbackRecent = uid => !!db.prepare("SELECT 1 FROM feedback WHERE user_id=? AND created_at > datetime('now','-14 days')").get(uid);
  app.get('/api/feedback/status', (req, res) => {
    if (!req.user) return res.json({ show: false });
    res.json({ show: !isCentral(req.user) && !feedbackRecent(req.user.id) });
  });
  app.post('/api/feedback', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Log in first.' });
    if (isCentral(req.user)) return res.status(400).json({ error: 'The owner does not send feedback to themselves.' });
    if (feedbackRecent(req.user.id) || limited('fb:' + req.user.id, 3, 864e5)) return res.status(429).json({ error: 'You already sent feedback recently. Thank you!' });
    const t = v => String(v || '').trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 1000);
    const rating = [1, 2, 3, 4, 5].includes(Number(req.body.rating)) ? Number(req.body.rating) : null, liked = t(req.body.liked), suggest = t(req.body.suggest), other = t(req.body.other);
    if (!rating && !liked && !suggest && !other) return res.status(400).json({ error: 'Please answer at least one question.' });
    const u = db.prepare('SELECT id,name,university,department,level,is_lecturer,role FROM users WHERE id=?').get(req.user.id);
    const who = [u.role === 'uniadmin' ? 'University admin' : u.is_lecturer ? 'Lecturer' : 'Student', u.university, u.department, u.dept_option, u.level ? u.level + ' level' : ''].filter(Boolean).join(' · ');
    db.prepare('INSERT INTO feedback(user_id,name,who,rating,liked,suggest,other) VALUES(?,?,?,?,?,?,?)').run(u.id, u.name, who, rating, liked, suggest, other);
    notify(fullAdminIds(), { title: 'New feedback' + (rating ? ' ' + '★'.repeat(rating) : ''), body: `${u.name}: ${(liked || suggest || other || 'rated the site').slice(0, 90)}`, url: '/chat/feedback', tag: 'feedback' });
    res.json({ ok: true });
  });
  app.get('/chat/feedback', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/chat/feedback');
    if (!isCentral(req.user)) return res.redirect('/chat');
    const rows = db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT 300').all();
    db.prepare('UPDATE feedback SET read=1 WHERE read=0').run();
    const q = (label, v) => v ? `<p style="margin:6px 0 0"><span class="mut">${label}</span><br>${esc(v).replace(/\n/g, '<br>')}</p>` : '';
    const avg = rows.filter(r => r.rating).length ? (rows.filter(r => r.rating).reduce((a, r) => a + r.rating, 0) / rows.filter(r => r.rating).length).toFixed(1) : null;
    res.send(layout('Feedback', `<p class="mut"><a href="/chat">&larr; Chat</a></p><h1 style="margin-bottom:4px">What people say about the site</h1><p class="mut" style="margin-top:0">${rows.length} message${rows.length === 1 ? '' : 's'}${avg ? ' &middot; average rating ' + avg + ' / 5' : ''}. Read only: nobody has to be your friend to send you one.</p>` +
      (rows.map(r => `<div class="card"><div class="row" style="align-items:flex-start"><span><b>${r.user_id ? `<a href="/u/${r.user_id}" style="color:inherit">${esc(r.name)}</a>` : esc(r.name)}</b><br><span class="mut" style="font-size:13px">${esc(r.who || '')} &middot; ${esc(String(r.created_at).slice(0, 16))}</span></span><span style="font-size:18px;white-space:nowrap">${r.rating ? '★'.repeat(r.rating) + '<span class="mut">' + '★'.repeat(5 - r.rating) + '</span>' : ''}</span></div>${q('What they like', r.liked)}${q('What they would add or change', r.suggest)}${q('Anything else', r.other)}<form method="post" action="/chat/feedback/${r.id}/delete" style="margin:8px 0 0" onsubmit="return confirm('Delete this message?')"><button class="link">Delete</button></form></div>`).join('') || '<p class="mut">Nothing yet. The questionnaire appears for people after they have used a few parts of the site.</p>'), req.user));
  });
  app.post('/chat/feedback/:id/delete', (req, res) => {
    if (!req.user || !isCentral(req.user)) return res.redirect('/chat');
    db.prepare('DELETE FROM feedback WHERE id=?').run(Number(req.params.id));
    res.redirect('/chat/feedback');
  });
};
