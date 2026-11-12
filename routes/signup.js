// Sign-up pages (students and lecturers) and the lecturer portal
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { GOOGLE_ON, authForm, bcrypt, checkEmailPage, db, esc, insertUser, layout, limited, sendSafely, weakPw } = ctx;
  app.get('/signup', (req, res) => !ctx.isLaptop(req) ? res.send(authForm('signup')) : res.send(ctx.linkPage(req, '')));
  app.post('/signup', async (req, res) => {
    if (limited('signup-ip:' + req.ip, 12, 3600e3)) return res.status(429).send('Too many sign-ups from this connection. Please try again later.');
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase();
    const pw = String(req.body.password || '');
    const bad = m => res.status(400).send(authForm('signup', m));
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return bad('Enter your name and a valid email.');
    if (pw.length < 8) return bad('Password must be at least 8 characters.');
    if (weakPw(pw, email)) return bad('That password is too easy to guess. Please pick something less common.');
    let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u && u.verified) return bad('That email is already registered. Try logging in.');
    if (!u) { // an existing unverified account is never modified here, only re-sent a link
      const id = insertUser('name,email,hash', [name, email, bcrypt.hashSync(pw, 12)]);
      u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }
    if ((await sendSafely(req, u)) === 'fail') return bad("We couldn't send the verification email. Please try again in a minute.");
    res.send(checkEmailPage(email));
  });

  // Public lecturer portal landing page: discoverable without exposing lecturer-only content.
  app.get('/lecturer/portal', (req, res) => {
    if (ctx.isLaptop(req) && req.user) return res.redirect('/lecturer');
    if (!req.user && ctx.isLaptop(req)) return res.send(ctx.linkPage(req, '/lecturer'));
    res.send(layout('Lecturer Portal | Studies Hub', `<div class="auth" style="max-width:720px">
<h1>Studies Hub Lecturer Portal</h1>
<p>Lecturers can register, sign in, manage their linked courses, and share learning materials with students through Studies Hub.</p>
<div class="card">
<h2>New lecturer?</h2>
<p class="mut">Create a lecturer account and complete your institution details. A full admin must verify your lecturer status before uploads are enabled.</p>
<a class="btn" href="/lecturer/signup">Register as a lecturer</a>
</div>
<div class="card">
<h2>Already registered?</h2>
<p class="mut">Sign in to continue to your lecturer courses and uploads.</p>
<a class="btn ghost" href="/lecturer/login">Lecturer log in</a>
</div>
<p class="mut">Students should use the regular <a href="/signup">student sign-up</a>.</p>
</div>`, null, { description: 'Official Studies Hub lecturer portal. Register or sign in to manage courses and share educational materials with students.' }));
  });
  app.get('/lecturer/login', (req, res) => res.redirect('/login?next=%2Flecturer'));

  app.get('/lecturer/signup', (req, res) => ctx.isLaptop(req) ? res.send(ctx.linkPage(req, '/lecturer')) : res.send(layout('Lecturer sign up', `<div class="auth"><h1>Lecturer sign up</h1>
<p class="mut">For teaching staff only. Students should use the regular <a href="/signup">sign up</a> instead.</p>
<form method="post" class="card">
<input name="name" placeholder="Your name" required maxlength="80">
<input name="email" type="email" placeholder="Email address" required>
<input name="password" type="password" placeholder="Password (8+ characters)" required>
<button>Create lecturer account</button></form>
${GOOGLE_ON ? '<a class="btn ghost gbtn" href="/auth/google?as=lecturer">Continue with Google</a>' : ''}
<p class="mut">Already registered? <a href="/lecturer/login">Lecturer log in</a></p></div>`, null, { footer: true })));
  app.post('/lecturer/signup', async (req, res) => {
    if (limited('signup-ip:' + req.ip, 12, 3600e3)) return res.status(429).send('Too many sign-ups from this connection. Please try again later.');
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase();
    const pw = String(req.body.password || '');
    const bad = m => res.status(400).send(layout('Lecturer sign up', `<div class="auth"><h1>Lecturer sign up</h1><p class="err">${esc(m)}</p>
<form method="post" class="card"><input name="name" placeholder="Your name" required maxlength="80" value="${esc(name)}"><input name="email" type="email" placeholder="Email address" required value="${esc(email)}"><input name="password" type="password" placeholder="Password (8+ characters)" required><button>Create lecturer account</button></form></div>`, null, { footer: true }));
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return bad('Enter your name and a valid email.');
    if (pw.length < 8) return bad('Password must be at least 8 characters.');
    if (weakPw(pw, email)) return bad('That password is too easy to guess. Please pick something less common.');
    let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u && u.verified) return bad('That email is already registered. Try logging in.');
    if (!u) {
      const id = insertUser('name,email,hash,is_lecturer', [name, email, bcrypt.hashSync(pw, 12), 1]);
      u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }
    if ((await sendSafely(req, u)) === 'fail') return bad("We couldn't send the verification email. Please try again in a minute.");
    res.send(checkEmailPage(email));
  });
};
