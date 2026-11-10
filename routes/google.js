// Continue with Google
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const ROOT_DIR = require('path').join(__dirname, '..'); // the site's main folder (this file lives one folder deeper)
  const { GOOGLE_ON, SECURE, baseUrl, bcrypt, crypto, db, fs, insertUser, isLaptop, limited, notice, path, startSession } = ctx;
  // ---------- Continue with Google ----------
  const gRedirect = req => process.env.GOOGLE_REDIRECT_URI || `${baseUrl(req)}/auth/google/callback`;
  app.get('/auth/google', (req, res) => {
    if (!GOOGLE_ON) return res.redirect('/login');
    const state = crypto.randomBytes(16).toString('hex');
    const cookies = [`gstate=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${SECURE}`];
    if (req.query.as === 'lecturer') cookies.push(`gaslecturer=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${SECURE}`);
    res.setHeader('Set-Cookie', cookies);
    res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: gRedirect(req), response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account'
    }));
  });
  app.get('/auth/google/callback', async (req, res) => {
    try {
      const c = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('gstate='));
      if (!GOOGLE_ON || !req.query.code || !c || c.slice(7) !== req.query.state) throw new Error('state mismatch');
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: gRedirect(req), grant_type: 'authorization_code' })
      });
      const t = await tr.json();
      if (!tr.ok) throw new Error(t.error_description || t.error);
      const g = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
      if (!g.email || !g.email_verified) throw new Error('Google email not verified');
      const email = g.email.toLowerCase(), rnd = () => bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
      const asLecturer = (req.headers.cookie || '').split(';').map(x => x.trim()).some(x => x === 'gaslecturer=1');
      let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!u) {
        const id = insertUser('name,email,hash,verified,is_lecturer,gsignup', [String(g.name || email.split('@')[0]).slice(0, 80), email, rnd(), 1, asLecturer ? 1 : 0, 1]);
        u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      } else if (!u.verified) { // drop any password someone set before the real owner proved the email
        db.prepare('UPDATE users SET verified=1, hash=?, gsignup=1 WHERE id=?').run(rnd(), u.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      }
      if (isLaptop(req) && u.role !== 'admin') return res.redirect('/login');
      startSession(res, u.id);
      res.redirect('/');
    } catch (e) {
      console.error('Google sign-in failed:', e.message);
      res.status(400).send(notice('Google sign-in failed', 'Please try again, or use your email and password.', '<p><a class="btn" href="/login">Back to log in</a></p>'));
    }
  });

  // Android app: the phone's own Google account picker gives the app an ID token; we check it with Google and sign the person in.
  const APP_GOOGLE_IDS = (() => {
    const ids = [process.env.GOOGLE_APP_CLIENT_ID, process.env.GOOGLE_CLIENT_ID].filter(Boolean);
    try { const j = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'google-services.json'), 'utf8')); for (const c of j.client || []) for (const o of c.oauth_client || []) if (o.client_type === 3 && o.client_id) ids.push(o.client_id); } catch (e) { /* file missing: fine */ }
    return [...new Set(ids)];
  })();
  app.post('/auth/google/app', async (req, res) => {
    try {
      if (!/StudiesHubApp/.test(req.headers['user-agent'] || '') || !APP_GOOGLE_IDS.length) throw new Error('not the app / not set up');
      if (limited('gapp:' + (req.ip || ''), 20, 10 * 60 * 1000)) throw new Error('too many tries');
      const idToken = String((req.body && req.body.idToken) || '');
      if (idToken.length < 100 || idToken.length > 4000) throw new Error('bad token');
      const gr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
      const g = await gr.json();
      if (!gr.ok || !APP_GOOGLE_IDS.includes(g.aud) || !/^(https:\/\/)?accounts\.google\.com$/.test(g.iss || '') || String(g.email_verified) !== 'true' || !g.email) throw new Error('Google did not accept the token');
      const email = String(g.email).toLowerCase(), rnd = () => bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
      let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!u) {
        const id = insertUser('name,email,hash,verified,is_lecturer,gsignup', [String(g.name || email.split('@')[0]).slice(0, 80), email, rnd(), 1, req.body.lecturer ? 1 : 0, 1]);
        u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      } else if (!u.verified) {
        db.prepare('UPDATE users SET verified=1, hash=?, gsignup=1 WHERE id=?').run(rnd(), u.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      }
      startSession(res, u.id);
      res.json({ ok: true, url: req.body.lecturer ? '/lecturer' : '/' });
    } catch (e) {
      console.error('App Google sign-in failed:', e.message);
      res.status(400).json({ error: 'Google sign-in failed. Please try again, or use your email and password.' });
    }
  });
  return { APP_GOOGLE_IDS };
};
