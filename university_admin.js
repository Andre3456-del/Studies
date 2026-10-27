'use strict';
// University admins. The site owner (central admin) invites people BY EMAIL, even if they have no account yet:
//   - "University central admin": runs that university's lecturer side (and can look over its students).
//   - "University full admin": runs that university's student side (e.g. the Student Union).
// Each works only inside one institution, always below the owner, and the owner can see what they do.
function registerUniversityAdmin(app, d) {
  const { db, crypto, bcrypt, esc, layout, deliver, emailShell, sha, insertUser, startSession, notify, fullAdminIds, isCentral, purgeUser, LEVELS, TOP_LEVEL, weakPw, baseUrl } = d;
  db.exec("CREATE TABLE IF NOT EXISTS admin_invites(id INTEGER PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, institution TEXT NOT NULL, token_hash TEXT NOT NULL, expires INTEGER NOT NULL, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, accepted_at TEXT);" +
          "CREATE TABLE IF NOT EXISTS admin_log(id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, actor INTEGER, actor_name TEXT, institution TEXT, action TEXT NOT NULL);");
  const LABEL = { central: 'University central admin', full: 'University full admin' };
  const clean = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
  const owner = (req, res, next) => req.user && isCentral(req.user) ? next() : res.redirect('/dashboard');
  const timeStr = t => esc(String(t || '').slice(0, 16));

  // What the owner can see: everything the university admins do.
  function logAdmin(req, inst, action) {
    if (!req.user || isCentral(req.user)) return;
    db.prepare('INSERT INTO admin_log(actor,actor_name,institution,action) VALUES(?,?,?,?)').run(req.user.id, req.user.name, inst || req.user.lp_inst || null, String(action).slice(0, 300));
  }

  function panel(req) {
    const insts = db.prepare('SELECT name FROM institutions ORDER BY name').all().map(r => r.name);
    const holders = db.prepare("SELECT id,name,email,lp_inst,uni_role FROM users WHERE lp_inst IS NOT NULL ORDER BY lp_inst,name").all();
    const pending = db.prepare('SELECT id,email,kind,institution,expires FROM admin_invites WHERE accepted_at IS NULL AND expires>? ORDER BY id DESC').all(Date.now());
    const log = db.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT 40').all();
    return `<h1>University admins</h1><p class="mut">Invite someone by email. They do not need an account: they open the link in the email, set a password if they are new, and they are in. They only ever see their own institution, and they stay below you.</p>
<form method="post" action="/lecturer/admin/uni/invite" class="card"><input name="email" type="email" placeholder="Their email address" required>
<select name="institution" required><option value="">Which institution?</option>${insts.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('')}</select>
<select name="kind"><option value="central">University central admin (lecturer side, can look over students)</option><option value="full">University full admin (student side, e.g. Student Union)</option></select><button>Send invitation</button></form>
${pending.length ? `<h3>Waiting to accept</h3>` + pending.map(i => `<div class="card row"><span><b>${esc(i.email)}</b><br><span class="mut">${LABEL[i.kind]} &middot; ${esc(i.institution)}</span></span><form method="post" action="/lecturer/admin/uni/invite/${i.id}/revoke" style="margin:0"><button class="link">Cancel</button></form></div>`).join('') : ''}
<h3>Current university admins</h3>${holders.map(h => `<div class="card row"><span><b>${esc(h.name)}</b> <span class="mut">${esc(h.email)}</span><br><span class="mut">${LABEL[h.uni_role] || LABEL.central} &middot; ${esc(h.lp_inst)}</span></span><form method="post" action="/lecturer/admin/uni/holder/${h.id}/remove" style="margin:0" onsubmit="return confirm('Take away their admin access?')"><button class="link">Remove access</button></form></div>`).join('') || '<p class="mut">None yet.</p>'}
<h3>What they have been doing</h3>${log.map(l => `<p class="mut" style="margin:4px 0">${timeStr(l.at)} &middot; <b>${esc(l.actor_name || '')}</b>${l.institution ? ' (' + esc(l.institution) + ')' : ''}: ${esc(l.action)}</p>`).join('') || '<p class="mut">Nothing yet.</p>'}`;
  }

  app.post('/lecturer/admin/uni/invite', owner, async (req, res) => {
    const to = m => res.redirect('/lecturer/admin?tab=admins&msg=' + encodeURIComponent(m));
    const email = clean(req.body.email, 200).toLowerCase(), inst = clean(req.body.institution, 120), kind = req.body.kind === 'full' ? 'full' : 'central';
    if (!/^\S+@\S+\.\S+$/.test(email)) return to('Enter a valid email address.');
    if (!db.prepare('SELECT 1 FROM institutions WHERE name=?').get(inst)) return to('Pick an institution from the list.');
    if (db.prepare("SELECT 1 FROM users WHERE email=? AND role='admin'").get(email)) return to('That is a site admin already.');
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM admin_invites WHERE email=? AND institution=? AND kind=? AND accepted_at IS NULL').run(email, inst, kind);
    db.prepare('INSERT INTO admin_invites(email,kind,institution,token_hash,expires,created_by) VALUES(?,?,?,?,?,?)').run(email, kind, inst, sha(token), Date.now() + 7 * 864e5, req.user.id);
    const link = `${baseUrl(req)}/invite/${token}`;
    const what = kind === 'full' ? 'run the student side' : 'run the lecturer side and look over the students';
    try {
      const sent = await deliver(email, `You are invited to run ${inst} on Studies Hub`,
        `You have been invited as ${LABEL[kind]} for ${inst} on Studies Hub. You will ${what} for that institution.\n\nAccept here (the link works for 7 days): ${link}`,
        emailShell(`<h2 style="margin:0 0 8px;font-size:20px">You are invited</h2><p style="margin:0 0 8px">You have been invited as <b>${LABEL[kind]}</b> for <b>${esc(inst)}</b> on Studies Hub. You will ${what} for that institution.</p><p style="margin:16px 0"><a href="${esc(link)}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Accept the invitation</a></p><p style="color:#5b6675;font-size:13px;margin:0">The link works for 7 days. If you were not expecting this, ignore this email.</p>`, baseUrl(req)));
      if (!sent) console.log(`[email not configured] Invitation link for ${email}: ${link}`);
    } catch (e) { console.error('Invitation email failed:', e.message); return to("The invitation was saved but the email could not be sent. Check your email settings, then cancel it and send it again."); }
    to(`Invitation sent to ${email}.`);
  });
  app.post('/lecturer/admin/uni/invite/:id/revoke', owner, (req, res) => { db.prepare('DELETE FROM admin_invites WHERE id=? AND accepted_at IS NULL').run(Number(req.params.id)); res.redirect('/lecturer/admin?tab=admins&msg=' + encodeURIComponent('Invitation cancelled.')); });
  app.post('/lecturer/admin/uni/holder/:id/remove', owner, (req, res) => { db.prepare("UPDATE users SET lp_inst=NULL, uni_role=NULL WHERE id=? AND role!='admin'").run(Number(req.params.id)); res.redirect('/lecturer/admin?tab=admins&msg=' + encodeURIComponent('Access removed.')); });

  // ----- accepting an invitation -----
  const findInvite = token => /^[0-9a-f]{64}$/.test(String(token)) ? db.prepare('SELECT * FROM admin_invites WHERE token_hash=? AND accepted_at IS NULL AND expires>?').get(sha(token), Date.now()) : null;
  const page = (req, title, body) => layout(title, `<div class="auth"><h1>${esc(title)}</h1>${body}</div>`, req.user);
  app.get('/invite/:token', (req, res) => {
    const inv = findInvite(req.params.token);
    if (!inv) return res.status(404).send(page(req, 'Invitation not valid', '<p class="mut">This invitation has expired or was already used. Ask the site owner to send a new one.</p>'));
    const existing = db.prepare('SELECT id,name FROM users WHERE email=?').get(inv.email);
    const intro = `<p>You are invited as <b>${LABEL[inv.kind]}</b> for <b>${esc(inv.institution)}</b>.</p>`;
    if (existing) {
      if (!req.user) return res.send(page(req, 'Accept the invitation', `${intro}<p class="mut">There is already an account for ${esc(inv.email)}. Log in with it to accept.</p><a class="btn" href="/login?next=${encodeURIComponent('/invite/' + req.params.token)}">Log in to accept</a>`));
      if (req.user.id !== existing.id) return res.send(page(req, 'Wrong account', `${intro}<p class="err">You are logged in as someone else. Log out and use ${esc(inv.email)}.</p>`));
      return res.send(page(req, 'Accept the invitation', `${intro}<form method="post"><button>Accept</button></form>`));
    }
    res.send(page(req, 'Accept the invitation', `${intro}<p class="mut">Create your password for ${esc(inv.email)}. This email link already proves the address is yours.</p><form method="post" class="card"><input name="name" placeholder="Your name" required maxlength="80"><input name="password" type="password" placeholder="Password (8+ characters)" required minlength="8" autocomplete="new-password"><button>Accept and create my account</button></form>`));
  });
  app.post('/invite/:token', (req, res) => {
    const inv = findInvite(req.params.token);
    if (!inv) return res.status(404).send(page(req, 'Invitation not valid', '<p class="mut">This invitation has expired or was already used.</p>'));
    let user = db.prepare('SELECT * FROM users WHERE email=?').get(inv.email);
    if (user) {
      if (!req.user || req.user.id !== user.id) return res.redirect('/login?next=' + encodeURIComponent('/invite/' + req.params.token));
      if (user.role === 'admin') return res.redirect('/');
    } else {
      const name = clean(req.body.name, 80), pw = String(req.body.password || '');
      const bad = m => res.status(400).send(page(req, 'Accept the invitation', `<p class="err">${esc(m)}</p><form method="post" class="card"><input name="name" placeholder="Your name" required maxlength="80" value="${esc(name)}"><input name="password" type="password" placeholder="Password (8+ characters)" required minlength="8"><button>Accept and create my account</button></form>`));
      if (!name) return bad('Enter your name.');
      if (pw.length < 8) return bad('Password must be at least 8 characters.');
      if (weakPw(pw, inv.email)) return bad('That password is too easy to guess. Please pick something less common.');
      const id = insertUser('name,email,hash,verified', [name, inv.email, bcrypt.hashSync(pw, 12), 1]);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }
    db.prepare("UPDATE users SET lp_inst=?, uni_role=?, university=CASE WHEN university IS NULL OR university='' THEN ? ELSE university END WHERE id=?").run(inv.institution, inv.kind, inv.institution, user.id);
    db.prepare("UPDATE admin_invites SET accepted_at=datetime('now') WHERE id=?").run(inv.id);
    db.prepare('INSERT INTO admin_log(actor,actor_name,institution,action) VALUES(?,?,?,?)').run(user.id, user.name, inv.institution, `Accepted the invitation as ${LABEL[inv.kind]}`);
    notify(fullAdminIds(), { title: 'Admin invitation accepted', body: `${user.name} (${inv.email}) is now ${LABEL[inv.kind]} for ${inv.institution}`, url: '/lecturer/admin?tab=admins', tag: 'lecturer' });
    if (!req.user) startSession(res, user.id);
    res.redirect(inv.kind === 'full' ? '/uni' : '/lecturer/admin');
  });

  // ----- /uni: the student-side tools for a university admin (the owner can open it for every university) -----
  const scopeOf = req => isCentral(req.user) ? 'all' : (req.user && req.user.lp_inst) || null;
  const need = (req, res, next) => { if (!req.user) return res.redirect('/login?next=/uni'); req.scope = scopeOf(req); return req.scope ? next() : res.redirect('/dashboard'); };
  const studentWhere = req => req.scope === 'all' ? ["role='user'", 'is_lecturer=0'] : ["role='user'", 'is_lecturer=0', 'university=?'];
  const sArgs = req => req.scope === 'all' ? [] : [req.scope];
  app.get('/uni', need, (req, res) => {
    const all = req.scope === 'all', tab = req.query.tab === 'levels' && !all ? 'levels' : 'students';
    const msg = req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : '';
    const head = `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>${all ? 'Students (all universities)' : 'University admin'}</h1><p class="mut" style="margin-top:0">${all ? '' : esc(req.scope) + ' &middot; ' + (LABEL[req.user.uni_role] || LABEL.central)}</p>${msg}
<div class="row" style="justify-content:flex-start;gap:6px;margin:8px 0"><a class="${tab === 'students' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=students">Students</a>${all ? '' : `<a class="${tab === 'levels' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=levels">Level promotion</a>`}${!all && req.user.uni_role !== 'full' ? '<a class="btn ghost" style="padding:7px 12px;margin:0" href="/lecturer/admin">Lecturer portal</a>' : ''}</div>`;
    let body = '';
    if (tab === 'students') {
      const q = clean(req.query.q, 60).toLowerCase();
      const where = studentWhere(req), args = sArgs(req);
      if (q) { where.push('(lower(name) LIKE ? OR lower(username) LIKE ? OR lower(email) LIKE ?)'); args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
      const rows = db.prepare(`SELECT id,name,username,email,department,level,university,created_at FROM users WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args);
      body = `<form method="get" class="row" style="gap:6px"><input type="hidden" name="tab" value="students"><input name="q" value="${esc(q)}" placeholder="Search name, @username or email" style="flex:1"><button class="ghost">Search</button></form><p class="mut">${rows.length} shown</p>` +
        rows.map(u => `<div class="card row"><span><b>${esc(u.name)}</b> <span class="mut">${u.username ? '@' + esc(u.username) : ''}</span><br><span class="mut">${esc(u.email)} &middot; ${esc(u.department || 'no department')} &middot; ${u.level ? u.level + ' level' : 'no level'}${all ? ' &middot; ' + esc(u.university || '') : ''}</span></span><form method="post" action="/uni/student/${u.id}/remove" style="margin:0" onsubmit="return confirm('Remove this student completely? Chats, friends and sign-ins are all deleted.')"><button class="link">Remove</button></form></div>`).join('') || '<p class="mut">No students found.</p>';
    } else {
      const counts = LEVELS.map(l => `${l}: <b>${db.prepare(`SELECT COUNT(*) n FROM users WHERE ${studentWhere(req).join(' AND ')} AND level=?`).get(...sArgs(req), l).n}</b>`).join(' &middot; ');
      const depts = db.prepare(`SELECT DISTINCT department d FROM users WHERE ${studentWhere(req).join(' AND ')} AND department IS NOT NULL AND department!='' ORDER BY department`).all(...sArgs(req)).map(r => r.d);
      body = `<p class="mut">Students cannot change their own level. A level only moves when you do it here, and it only affects ${esc(req.scope)}.</p><div class="card"><p class="mut" style="margin:0 0 8px">${counts}</p>
<form method="post" action="/uni/levels/advance" onsubmit="return confirm('Move these students up one level? This cannot be undone.')"><label class="mut">Department</label><select name="department"><option value="">Every department</option>${depts.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
<label class="mut">Which level moves up</label><select name="level"><option value="">Every level</option>${LEVELS.slice(0, -1).map(l => `<option value="${l}">Only ${l} level &rarr; ${l + 100}</option>`).join('')}</select><button style="margin-top:10px">Move students up one level</button></form></div>`;
    }
    res.send(layout('University admin', head + body, req.user));
  });
  app.post('/uni/student/:id/remove', need, (req, res) => {
    const w = studentWhere(req).concat('id=?'), t = db.prepare(`SELECT id,name FROM users WHERE ${w.join(' AND ')}`).get(...sArgs(req), Number(req.params.id));
    if (!t) return res.redirect('/uni?msg=' + encodeURIComponent('Not found.'));
    purgeUser(t.id); logAdmin(req, req.scope, `Removed student ${t.name}`);
    res.redirect('/uni?msg=' + encodeURIComponent(`${t.name} was removed completely.`));
  });
  app.post('/uni/levels/advance', need, (req, res) => {
    if (req.scope === 'all') return res.redirect('/admin/levels');
    const dept = clean(req.body.department, 120) || null, from = LEVELS.includes(Number(req.body.level)) && Number(req.body.level) < TOP_LEVEL ? Number(req.body.level) : null;
    const where = studentWhere(req).concat('level IS NOT NULL', `level < ${TOP_LEVEL}`), args = sArgs(req);
    if (dept) { where.push('department=?'); args.push(dept); }
    if (from) { where.push('level=?'); args.push(from); }
    const ids = db.prepare(`SELECT id FROM users WHERE ${where.join(' AND ')}`).all(...args).map(r => r.id);
    const info = db.prepare(`UPDATE users SET level = level + 100 WHERE ${where.join(' AND ')}`).run(...args);
    db.prepare('INSERT INTO level_log(by_user,department,from_level,moved) VALUES(?,?,?,?)').run(req.user.id, dept, from, info.changes);
    if (ids.length) notify(ids, { title: 'You moved up a level', body: 'Your level has been updated by your school admin.', url: '/dashboard', tag: 'level' });
    logAdmin(req, req.scope, `Moved ${info.changes} student${info.changes === 1 ? '' : 's'} up a level${dept ? ' in ' + dept : ''}`);
    res.redirect('/uni?tab=levels&msg=' + encodeURIComponent(`${info.changes} student${info.changes === 1 ? '' : 's'} moved up a level.`));
  });
  return { panel, logAdmin };
}
module.exports = { registerUniversityAdmin };
