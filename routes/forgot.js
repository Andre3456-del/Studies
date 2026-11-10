// Forgot password: 6-digit email code
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { bcrypt, crypto, db, forgotForm, limited, notice, resetForm, sendResetCode, weakPw } = ctx;
  // ---------- forgot password: 6-digit email code (same flow for every account, admin included) ----------
  app.get('/forgot', (req, res) => res.send(forgotForm()));
  app.post('/forgot', async (req, res) => {
    if (limited('forgot-ip:' + req.ip, 10, 15 * 60e3)) return res.status(429).send('Too many requests. Please try again in a few minutes.');
    const email = String(req.body.email || '').trim().toLowerCase();
    if (limited('forgot-ip:' + req.ip, 8, 15 * 60e3)) return res.status(429).send(forgotForm('Too many requests. Try again in a few minutes.'));
    const u = email && db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u && !limited('forgot-em:' + email, 3, 15 * 60e3)) {
      const code = String(crypto.randomInt(100000, 1000000));
      db.prepare('UPDATE users SET reset_hash=?, reset_expires=?, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(code, 10), Date.now() + 600000, u.id);
      try { await sendResetCode(u.email, code); } catch (e) { console.error('Reset email failed:', e.message); }
    }
    res.redirect('/reset?email=' + encodeURIComponent(email)); // identical whether or not the account exists
  });

  app.get('/reset', (req, res) => res.send(resetForm(String(req.query.email || ''))));
  app.post('/reset', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim(), pw = String(req.body.password || '');
    const bad = m => res.status(400).send(resetForm(email, m));
    if (limited('reset-ip:' + req.ip, 10, 15 * 60e3)) return res.status(429).send(resetForm(email, 'Too many attempts. Try again in a few minutes.'));
    if (pw.length < 8) return bad('Password must be at least 8 characters.');
    if (weakPw(pw, email)) return bad('That password is too easy to guess. Please pick something less common.');
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u || !u.reset_hash || !u.reset_expires) return bad('Invalid or expired code.');
    const clear = () => db.prepare('UPDATE users SET reset_hash=NULL, reset_expires=NULL, reset_attempts=0 WHERE id=?').run(u.id);
    if (Date.now() > u.reset_expires) { clear(); return bad('That code expired. Request a new one.'); }
    const attempts = (u.reset_attempts || 0) + 1;
    if (attempts > 5) { clear(); return bad('Too many wrong codes. Request a new one.'); }
    db.prepare('UPDATE users SET reset_attempts=? WHERE id=?').run(attempts, u.id);
    if (!bcrypt.compareSync(code, u.reset_hash)) return bad('Invalid or expired code.');
    db.prepare('UPDATE users SET hash=?, verified=1, reset_hash=NULL, reset_expires=NULL, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(pw, 12), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    res.send(notice('Password updated', 'You can now log in with your new password.', '<p><a class="btn" href="/login">Log in</a></p>'));
  });
};
