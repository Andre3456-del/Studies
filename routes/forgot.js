// Forgot password: 6-digit email code
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { bcrypt, crypto, db, esc, forgotForm, layout, limited, notice, resetForm, sendResetCode, sidKey, weakPw } = ctx;
  // When the person is already logged in (Settings > Security > Forgot password) they stay logged in and inside the app:
  // the pages look like the rest of the app, the email is their own, and the reset does not sign them out.
  const mask = e => String(e || '').replace(/^(.).*(@.*)$/, (m, a, b) => a + '•••' + b);
  const inAppForgot = (u, err = '') => layout('Reset password', `<p class="mut"><a href="/settings/security">&larr; Security</a></p><h1>Reset your password</h1>${err ? `<p class="err">${esc(err)}</p>` : ''}<form method="post" action="/forgot" class="card"><p class="mut" style="margin-top:0">We will send a 6-digit code to <b>${esc(mask(u.email))}</b>. You stay logged in.</p><button>Send code</button></form>`, u);
  const inAppReset = (u, err = '') => layout('Enter your code', `<p class="mut"><a href="/settings/security">&larr; Security</a></p><h1>Enter your code</h1><p class="mut">A 6-digit code was sent to ${esc(mask(u.email))}. It expires in 10 minutes.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}<form method="post" action="/reset" class="card"><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" required><input name="password" type="password" placeholder="New password (8+ characters)" minlength="8" autocomplete="new-password" required><button>Set new password</button></form><p class="mut"><a href="/forgot">Send a new code</a></p>`, u);
  // ---------- forgot password: 6-digit email code (same flow for every account, admin included) ----------
  app.get('/forgot', (req, res) => res.send(req.user && req.user.email ? inAppForgot(req.user) : forgotForm()));
  app.post('/forgot', async (req, res) => {
    if (limited('forgot-ip:' + req.ip, 10, 15 * 60e3)) return res.status(429).send('Too many requests. Please try again in a few minutes.');
    const email = String(req.user && req.user.email ? req.user.email : req.body.email || '').trim().toLowerCase(); // logged in: always their own email
    if (limited('forgot-ip:' + req.ip, 8, 15 * 60e3)) return res.status(429).send(forgotForm('Too many requests. Try again in a few minutes.'));
    const u = email && db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u && !limited('forgot-em:' + email, 3, 15 * 60e3)) {
      const code = String(crypto.randomInt(100000, 1000000));
      db.prepare('UPDATE users SET reset_hash=?, reset_expires=?, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(code, 10), Date.now() + 600000, u.id);
      try { await sendResetCode(u.email, code); } catch (e) { console.error('Reset email failed:', e.message); }
    }
    res.redirect('/reset?email=' + encodeURIComponent(email)); // identical whether or not the account exists
  });

  app.get('/reset', (req, res) => res.send(req.user && req.user.email ? inAppReset(req.user) : resetForm(String(req.query.email || ''))));
  app.post('/reset', (req, res) => {
    const email = String(req.user && req.user.email ? req.user.email : req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim(), pw = String(req.body.password || '');
    const own = !!(req.user && req.user.email && req.user.email.toLowerCase() === email); // changing the password of the account they are logged in to
    const bad = m => res.status(400).send(own ? inAppReset(req.user, m) : resetForm(email, m));
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
    require('../lib/account_mail').passwordChanged(u.id);
    if (own && req.sid) { // keep this device logged in, sign the others out, and go back into the app
      db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(u.id, sidKey(req.sid));
      return res.send(layout('Password updated', '<h1>Password updated</h1><p class="mut">Your new password is saved. You are still logged in.</p><p><a class="btn" href="/settings/security">Back to Security</a></p>', req.user));
    }
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    res.send(notice('Password updated', 'You can now log in with your new password.', '<p><a class="btn" href="/login">Log in</a></p>'));
  });
};
