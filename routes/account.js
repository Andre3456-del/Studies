// Settings > Account: the email on the account, and the person's own "delete my account" button.
module.exports = function register(app, ctx) {
  const { bcrypt, db, esc, layout, purgeUser } = ctx;
  const row = id => db.prepare('SELECT id,email,hash,gsignup,role FROM users WHERE id=?').get(id) || {};
  const page = (req, msg) => {
    const u = row(req.user.id), needPw = !u.gsignup;
    return layout('Account', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Account</h1>
<div class="card"><p class="mut" style="margin:0">Email</p><b>${esc(u.email || '')}</b></div>
<div class="card" style="border-color:#e5393b66"><h2 style="margin-top:0;color:#ff6b6b">Delete my account</h2>
<p class="mut">This removes your profile, chats, saved items and stories for good. It cannot be undone.</p>
${u.role === 'admin' ? '<p class="mut">The main admin account cannot be deleted here.</p>' : `${msg ? `<p class="err">${esc(msg)}</p>` : ''}<form method="post" action="/settings/account/delete" autocomplete="off">
${needPw ? '<input type="password" name="password" placeholder="Your password" autocomplete="current-password" required style="margin-bottom:8px">' : ''}
<input name="confirm" placeholder="Type DELETE to confirm" autocomplete="off" required style="margin-bottom:10px">
<button style="background:#e5393b;color:#fff;width:100%">Delete my account</button></form>`}</div>`, req.user);
  };
  app.get('/settings/account', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/account');
    res.set('Cache-Control', 'no-store').send(page(req));
  });
  app.post('/settings/account/delete', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const u = row(req.user.id), b = req.body || {};
    if (u.role === 'admin') return res.status(403).send(page(req, 'The main admin account cannot be deleted here.'));
    if (String(b.confirm || '').trim().toUpperCase() !== 'DELETE') return res.status(400).send(page(req, 'Type the word DELETE to confirm.'));
    if (!u.gsignup && !(u.hash && bcrypt.compareSync(String(b.password || ''), u.hash))) return res.status(400).send(page(req, 'That password is not right.'));
    try { purgeUser(u.id); } catch (e) { return res.status(500).send(page(req, 'Something went wrong. Please try again.')); }
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.send(layout('Account deleted', '<h1>Your account has been deleted</h1><p class="mut">All your data was removed. You are welcome back any time.</p><p><a class="btn" href="/">Back to the home page</a></p>', null));
  });
};
