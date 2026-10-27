'use strict';
// The lecturer platform's own control room: its own login (separate from the student site), its own session cookie
// that is only ever sent to /lecturer/admin, and its own tools -- verifying lecturers, courses, institutions and uploads.
// It shares the server and database with the student site, but nothing here is reachable from a student/admin login.
function registerLecturerAdmin(app, d) {
  const { db, bcrypt, crypto, esc, sidKey, tooMany, noteFail, fails, DUMMY_HASH, purgeUser, notify, weakPw, adminEmail, renameValue } = d;
  db.exec("CREATE TABLE IF NOT EXISTS lp_admin(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT 'Lecturer admin', hash TEXT NOT NULL);" +
          "CREATE TABLE IF NOT EXISTS lp_sessions(id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, expires INTEGER NOT NULL);");
  db.prepare('DELETE FROM lp_sessions WHERE expires<?').run(Date.now());
  const email = String(process.env.LECTURER_ADMIN_EMAIL || adminEmail).toLowerCase();
  const row = db.prepare('SELECT * FROM lp_admin ORDER BY id LIMIT 1').get();
  if (!row) {
    const generated = !process.env.LECTURER_ADMIN_PASSWORD;
    const pass = process.env.LECTURER_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO lp_admin(email,hash) VALUES(?,?)').run(email, bcrypt.hashSync(pass, 12));
    console.log(`Lecturer platform admin created: ${email}` + (generated ? `  password: ${pass}  (set LECTURER_ADMIN_PASSWORD to choose your own)` : ''));
  } else {
    if (row.email !== email) db.prepare('UPDATE lp_admin SET email=? WHERE id=?').run(email, row.id);
    if (process.env.LECTURER_ADMIN_PASSWORD) db.prepare('UPDATE lp_admin SET hash=? WHERE id=?').run(bcrypt.hashSync(process.env.LECTURER_ADMIN_PASSWORD, 12), row.id);
  }

  const cookieOf = req => { const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('lsid=')); const v = c ? c.slice(5) : ''; return /^[0-9a-f]{64}$/.test(v) ? v : null; };
  const adminOf = req => { const v = cookieOf(req); return v ? db.prepare('SELECT a.id,a.email,a.name FROM lp_sessions s JOIN lp_admin a ON a.id=s.admin_id WHERE s.id=? AND s.expires>?').get(sidKey(v), Date.now()) || null : null; };
  const need = (req, res, next) => { const a = adminOf(req); if (!a) return res.redirect('/lecturer/admin/login'); req.lp = a; next(); };
  const clean = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
  const to = (tab, msg) => '/lecturer/admin?tab=' + tab + '&msg=' + encodeURIComponent(msg);

  const CSS = `:root{--bg:#f4f6fa;--card:#fff;--ink:#17202b;--mut:#5d6b7c;--line:#dde3ec;--blue:#1a73e8;--red:#c5221f}
@media(prefers-color-scheme:dark){:root{--bg:#10141b;--card:#181e28;--ink:#e8edf4;--mut:#93a1b3;--line:#2a3342;--blue:#6ea8fe;--red:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--blue)}header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header b{margin-right:auto}main{max-width:960px;margin:0 auto;padding:16px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}nav a{padding:7px 12px;border-radius:9px;text-decoration:none;color:var(--ink);border:1px solid var(--line);background:var(--card);font-size:14px}nav a.on{background:var(--blue);color:#fff;border-color:var(--blue)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}.row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.mut{color:var(--mut)}.err{color:var(--red)}h1{font-size:24px;margin:8px 0}h2{font-size:18px;margin:14px 0 6px}
input,select{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:10px;margin:5px 0}
button{font:inherit;font-weight:600;background:var(--blue);color:#fff;border:0;border-radius:9px;padding:10px 16px;cursor:pointer}button.ghost{background:none;color:var(--blue);border:1px solid var(--blue)}button.link{background:none;color:var(--blue);padding:4px 6px}button.danger{background:none;color:var(--red);padding:4px 6px}
form.inline{display:inline;margin:0}.pill{display:inline-block;background:var(--line);border-radius:99px;padding:2px 10px;font-size:12px}.stats{display:flex;gap:10px;flex-wrap:wrap}.stat{flex:1;min-width:120px}.stat b{font-size:26px;display:block}
.auth{max-width:380px;margin:40px auto}`;
  const shell = (title, body, admin, tab = '') => {
    const pend = admin ? db.prepare("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='pending'").get().n : 0;
    const tabs = [['overview', 'Overview'], ['verify', 'Verify' + (pend ? ` (${pend})` : '')], ['lecturers', 'Lecturers'], ['courses', 'Courses'], ['institutions', 'Institutions'], ['uploads', 'Uploads'], ['account', 'Account']];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Lecturer platform control</title><link rel="icon" href="/icon-192.png"><style>${CSS}</style></head><body>
<header><b>Lecturer platform &middot; Control</b>${admin ? `<span class="mut">${esc(admin.email)}</span><form method="post" action="/lecturer/admin/logout" class="inline"><button class="ghost">Sign out</button></form>` : ''}</header>
<main>${admin ? `<nav>${tabs.map(([k, l]) => `<a href="/lecturer/admin?tab=${k}"${tab === k ? ' class="on"' : ''}>${l}</a>`).join('')}</nav>` : ''}${body}</main></body></html>`;
  };
  const loginPage = (err = '') => shell('Log in', `<div class="auth"><h1>Lecturer platform control</h1><p class="mut">Sign in to manage lecturers, courses and uploads.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" class="card"><input name="email" type="email" placeholder="Email address" required autocomplete="username"><input name="password" type="password" placeholder="Password" required autocomplete="current-password"><button>Log in</button></form></div>`, null);

  app.get('/lecturer/admin/login', (req, res) => adminOf(req) ? res.redirect('/lecturer/admin') : res.send(loginPage()));
  app.post('/lecturer/admin/login', (req, res) => {
    const who = clean(req.body.email, 200).toLowerCase(), acct = 'lp:' + who;
    if (tooMany(req.ip) || tooMany(acct)) return res.status(429).send(loginPage('Too many attempts. Try again in 15 minutes.'));
    const a = db.prepare('SELECT * FROM lp_admin WHERE email=?').get(who);
    if (!a) bcrypt.compareSync(String(req.body.password || ''), DUMMY_HASH);
    if (!a || !bcrypt.compareSync(String(req.body.password || ''), a.hash)) { noteFail(req.ip); noteFail(acct); return res.status(401).send(loginPage('Wrong email or password.')); }
    fails.delete(acct);
    const raw = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO lp_sessions VALUES(?,?,?)').run(sidKey(raw), a.id, Date.now() + 12 * 3600e3);
    const secure = process.env.NODE_ENV === 'production' || req.secure;
    res.setHeader('Set-Cookie', `lsid=${raw}; HttpOnly; SameSite=Lax; Path=/lecturer/admin; Max-Age=43200${secure ? '; Secure' : ''}`);
    res.redirect('/lecturer/admin');
  });
  app.post('/lecturer/admin/logout', (req, res) => {
    const v = cookieOf(req); if (v) db.prepare('DELETE FROM lp_sessions WHERE id=?').run(sidKey(v));
    res.setHeader('Set-Cookie', 'lsid=; HttpOnly; Path=/lecturer/admin; Max-Age=0');
    res.redirect('/lecturer/admin/login');
  });

  const statusPill = s => s === 'approved' ? '<span class="pill">Verified</span>' : s === 'pending' ? '<span class="pill">Waiting</span>' : s === 'rejected' ? '<span class="pill err">Rejected</span>' : '<span class="pill">Not finished</span>';
  const lecturerRows = where => db.prepare(`SELECT u.id,u.name,u.email,u.university,u.lecturer_reg_no,u.lecturer_status,u.created_at,(SELECT COUNT(*) FROM pages p WHERE p.author_id=u.id) up,(SELECT group_concat(c.name,', ') FROM lecturer_courses lc JOIN courses c ON c.id=lc.course_id WHERE lc.lecturer_id=u.id) courses FROM users u WHERE u.is_lecturer=1 ${where} ORDER BY u.id DESC`).all();

  app.get('/lecturer/admin', need, (req, res) => {
    const tab = ['overview', 'verify', 'lecturers', 'courses', 'institutions', 'uploads', 'account'].includes(req.query.tab) ? req.query.tab : 'overview';
    const msg = req.query.msg ? `<p class="card">${esc(req.query.msg)}</p>` : '';
    let body = '';
    if (tab === 'overview') {
      const n = sql => db.prepare(sql).get().n;
      body = `<h1>Overview</h1><div class="stats">${[['Verified lecturers', n("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='approved'")], ['Waiting for you', n("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='pending'")], ['Courses', n('SELECT COUNT(*) n FROM courses')], ['Uploads', n('SELECT COUNT(*) n FROM pages WHERE author_id IS NOT NULL')]].map(([l, v]) => `<div class="card stat"><b>${v}</b><span class="mut">${l}</span></div>`).join('')}</div>`;
    } else if (tab === 'verify') {
      const rows = lecturerRows("AND u.lecturer_status='pending'");
      body = `<h1>Verify lecturers</h1><p class="mut">Check each person really teaches at the institution they named.</p>` + (rows.map(u => `<div class="card"><div class="row"><div><b>${esc(u.name)}</b> <span class="mut">${esc(u.email)}</span><br>${esc(u.university || '')}${u.lecturer_reg_no ? ' &middot; ' + esc(u.lecturer_reg_no) : ''}<br><span class="mut">Courses: ${esc(u.courses || 'none')}</span></div>
<div><form class="inline" method="post" action="/lecturer/admin/lecturer/${u.id}/approve"><button>Verify</button></form> <form class="inline" method="post" action="/lecturer/admin/lecturer/${u.id}/reject"><button class="danger">Reject</button></form></div></div></div>`).join('') || '<p class="mut">Nobody is waiting.</p>');
    } else if (tab === 'lecturers') {
      const rows = lecturerRows('');
      body = `<h1>Lecturers (${rows.length})</h1>` + (rows.map(u => `<div class="card"><div class="row"><div><b>${esc(u.name)}</b> ${statusPill(u.lecturer_status)}<br><span class="mut">${esc(u.email)} &middot; ${esc(u.university || 'no institution yet')}</span><br><span class="mut">Courses: ${esc(u.courses || 'none')} &middot; ${u.up} upload${u.up === 1 ? '' : 's'}</span></div>
<div>${u.lecturer_status !== 'approved' ? `<form class="inline" method="post" action="/lecturer/admin/lecturer/${u.id}/approve"><button class="link">Verify</button></form>` : `<form class="inline" method="post" action="/lecturer/admin/lecturer/${u.id}/reject"><button class="link">Unverify</button></form>`}<form class="inline" method="post" action="/lecturer/admin/lecturer/${u.id}/remove" onsubmit="return confirm('Remove this lecturer completely? Their chats, uploads and sign-ins are all deleted.')"><button class="danger">Remove</button></form></div></div></div>`).join('') || '<p class="mut">No lecturers yet.</p>');
    } else if (tab === 'courses') {
      const courses = db.prepare('SELECT c.id,c.name,(SELECT COUNT(*) FROM lecturer_courses lc WHERE lc.course_id=c.id) l,(SELECT COUNT(*) FROM pages p WHERE p.course_id=c.id) p FROM courses c ORDER BY c.name').all();
      body = `<h1>Courses (${courses.length})</h1><p class="mut">Lecturers pick and upload under these. If something is not really a course, rename it, delete it, or merge it into the right one.</p>
<form class="card row" method="post" action="/lecturer/admin/course/add"><input name="name" placeholder="New course" required maxlength="120" style="flex:1"><button>Add</button></form>` + courses.map(c => `<div class="card"><form method="post" action="/lecturer/admin/course/${c.id}/rename" class="row"><input name="name" value="${esc(c.name)}" maxlength="120" required style="flex:1;min-width:180px"><button class="ghost">Rename</button></form>
<span class="mut">${c.l} lecturer${c.l === 1 ? '' : 's'} &middot; ${c.p} upload${c.p === 1 ? '' : 's'}</span>
<div class="row"><form method="post" action="/lecturer/admin/course/${c.id}/merge" class="row"><select name="into" style="width:auto"><option value="">Move everything into&hellip;</option>${courses.filter(o => o.id !== c.id).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="ghost">Merge</button></form>
<form method="post" action="/lecturer/admin/course/${c.id}/delete" onsubmit="return confirm('Delete this course? Lecturers lose it and its uploads become unfiled.')"><button class="danger">Delete</button></form></div></div>`).join('');
    } else if (tab === 'institutions') {
      const inst = db.prepare('SELECT i.id,i.name,(SELECT COUNT(*) FROM users u WHERE u.university=i.name AND u.is_lecturer=1) c FROM institutions i ORDER BY i.name').all();
      body = `<h1>Institutions (${inst.length})</h1><p class="mut">The list lecturers choose from when they register.</p><form class="card row" method="post" action="/lecturer/admin/institution/add"><input name="name" placeholder="New institution" required maxlength="120" style="flex:1"><button>Add</button></form>` + inst.map(i => `<div class="card"><form method="post" action="/lecturer/admin/institution/${i.id}/save" class="row"><input name="name" value="${esc(i.name)}" maxlength="120" required style="flex:1;min-width:200px"><button class="ghost">Save</button></form><div class="row"><span class="mut">${i.c} lecturer${i.c === 1 ? '' : 's'}</span><form method="post" action="/lecturer/admin/institution/${i.id}/delete" onsubmit="return confirm('Remove from the list? Existing lecturers keep their entry.')"><button class="danger">Remove</button></form></div></div>`).join('');
    } else if (tab === 'uploads') {
      const rows = db.prepare('SELECT p.id,p.title,p.kind,p.created_at,u.name author,c.name course FROM pages p JOIN users u ON u.id=p.author_id LEFT JOIN courses c ON c.id=p.course_id WHERE p.author_id IS NOT NULL ORDER BY p.id DESC LIMIT 200').all();
      body = `<h1>Lecturer uploads (${rows.length})</h1>` + (rows.map(p => `<div class="card row"><div><b>${esc(p.title)}</b><br><span class="mut">${esc(p.author)} &middot; ${esc(p.course || 'no course')} &middot; ${esc(p.kind)} &middot; ${esc(String(p.created_at || '').slice(0, 10))}</span></div><form method="post" action="/lecturer/admin/upload/${p.id}/delete" onsubmit="return confirm('Delete this upload for everyone?')"><button class="danger">Delete</button></form></div>`).join('') || '<p class="mut">No uploads yet.</p>');
    } else {
      body = `<h1>Account</h1><form method="post" action="/lecturer/admin/account" class="card"><h2 style="margin-top:0">Change password</h2><input name="current" type="password" placeholder="Current password" required autocomplete="current-password"><input name="password" type="password" placeholder="New password (8+ characters)" required minlength="8" autocomplete="new-password"><button>Save</button></form>`;
    }
    res.send(shell('Control', msg + body, req.lp, tab));
  });

  app.post('/lecturer/admin/lecturer/:id/approve', need, (req, res) => {
    const t = db.prepare('SELECT id FROM users WHERE id=? AND is_lecturer=1').get(Number(req.params.id));
    if (!t) return res.redirect(to('verify', 'Not found.'));
    db.prepare("UPDATE users SET lecturer_status='approved' WHERE id=?").run(t.id);
    notify([t.id], { title: 'You are verified', body: 'You can now upload for your courses.', url: '/lecturer', tag: 'lecturer' });
    res.redirect(to(req.get('referer') && /tab=lecturers/.test(req.get('referer')) ? 'lecturers' : 'verify', 'Lecturer verified.'));
  });
  app.post('/lecturer/admin/lecturer/:id/reject', need, (req, res) => {
    const t = db.prepare('SELECT id FROM users WHERE id=? AND is_lecturer=1').get(Number(req.params.id));
    if (!t) return res.redirect(to('verify', 'Not found.'));
    db.prepare("UPDATE users SET lecturer_status='rejected' WHERE id=?").run(t.id);
    res.redirect(to(req.get('referer') && /tab=lecturers/.test(req.get('referer')) ? 'lecturers' : 'verify', 'Lecturer rejected.'));
  });
  app.post('/lecturer/admin/lecturer/:id/remove', need, (req, res) => {
    const t = db.prepare('SELECT id,name FROM users WHERE id=? AND is_lecturer=1').get(Number(req.params.id));
    if (!t) return res.redirect(to('lecturers', 'Not found.'));
    purgeUser(t.id);
    res.redirect(to('lecturers', `${t.name} was removed completely.`));
  });
  app.post('/lecturer/admin/course/add', need, (req, res) => { const n = clean(req.body.name, 120); if (!n) return res.redirect(to('courses', 'Type a course name.')); db.prepare('INSERT OR IGNORE INTO courses(name) VALUES(?)').run(n); res.redirect(to('courses', `Added ${n}.`)); });
  app.post('/lecturer/admin/course/:id/rename', need, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.params.id)), n = clean(req.body.name, 120);
    if (!c || !n) return res.redirect(to('courses', 'Could not save that course.'));
    if (db.prepare('SELECT 1 FROM courses WHERE name=? AND id!=?').get(n, c.id)) return res.redirect(to('courses', 'Another course already has that name. Use Merge instead.'));
    db.prepare('UPDATE courses SET name=? WHERE id=?').run(n, c.id); res.redirect(to('courses', `Saved ${n}.`));
  });
  app.post('/lecturer/admin/course/:id/delete', need, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.params.id)); if (!c) return res.redirect(to('courses', 'Not found.'));
    db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id); db.prepare('UPDATE pages SET course_id=NULL WHERE course_id=?').run(c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
    res.redirect(to('courses', `Deleted ${c.name}.`));
  });
  app.post('/lecturer/admin/course/:id/merge', need, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.params.id)), t = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.body.into) || 0);
    if (!c || !t || c.id === t.id) return res.redirect(to('courses', 'Choose the course to move everything into.'));
    db.prepare('UPDATE OR IGNORE lecturer_courses SET course_id=? WHERE course_id=?').run(t.id, c.id); db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id);
    db.prepare('UPDATE pages SET course_id=? WHERE course_id=?').run(t.id, c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
    res.redirect(to('courses', `${c.name} was merged into ${t.name}.`));
  });
  app.post('/lecturer/admin/institution/add', need, (req, res) => { const n = clean(req.body.name, 120); if (!n || /^Other\b/i.test(n)) return res.redirect(to('institutions', 'Type an institution name.')); db.prepare('INSERT OR IGNORE INTO institutions(name) VALUES(?)').run(n); res.redirect(to('institutions', `Added ${n}.`)); });
  app.post('/lecturer/admin/institution/:id/save', need, (req, res) => {
    const i = db.prepare('SELECT * FROM institutions WHERE id=?').get(Number(req.params.id)), n = clean(req.body.name, 120);
    if (!i || !n) return res.redirect(to('institutions', 'Could not save that institution.'));
    if (n !== i.name) {
      if (db.prepare('SELECT 1 FROM institutions WHERE name=? AND id!=?').get(n, i.id)) return res.redirect(to('institutions', 'Another institution already has that name.'));
      db.prepare('UPDATE institutions SET name=? WHERE id=?').run(n, i.id); renameValue(['university'], i.name, n);
    }
    res.redirect(to('institutions', `Saved ${n}.`));
  });
  app.post('/lecturer/admin/institution/:id/delete', need, (req, res) => { db.prepare('DELETE FROM institutions WHERE id=?').run(Number(req.params.id)); res.redirect(to('institutions', 'Removed from the list.')); });
  app.post('/lecturer/admin/upload/:id/delete', need, (req, res) => {
    const p = db.prepare('SELECT id FROM pages WHERE id=? AND author_id IS NOT NULL').get(Number(req.params.id)); if (!p) return res.redirect(to('uploads', 'Not found.'));
    db.prepare('DELETE FROM purchases WHERE page_id=?').run(p.id); db.prepare('DELETE FROM pages WHERE id=?').run(p.id);
    res.redirect(to('uploads', 'Upload deleted.'));
  });
  app.post('/lecturer/admin/account', need, (req, res) => {
    const a = db.prepare('SELECT * FROM lp_admin WHERE id=?').get(req.lp.id), pw = String(req.body.password || '');
    if (!bcrypt.compareSync(String(req.body.current || ''), a.hash)) return res.redirect(to('account', 'Your current password is wrong.'));
    if (pw.length < 8) return res.redirect(to('account', 'Use at least 8 characters.'));
    if (weakPw(pw, a.email)) return res.redirect(to('account', 'That password is too easy to guess.'));
    db.prepare('UPDATE lp_admin SET hash=? WHERE id=?').run(bcrypt.hashSync(pw, 12), a.id);
    db.prepare('DELETE FROM lp_sessions WHERE admin_id=? AND id!=?').run(a.id, sidKey(cookieOf(req)));
    res.redirect(to('account', 'Password changed.' + (process.env.LECTURER_ADMIN_PASSWORD ? ' Note: LECTURER_ADMIN_PASSWORD in Railway will set it back on the next restart, so update it there too.' : '')));
  });
}
module.exports = { registerLecturerAdmin };
