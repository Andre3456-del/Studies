'use strict';
// University admins. The site owner (central admin) invites people BY EMAIL, even if they have no account yet:
//   - "University central admin": runs that university's lecturer side (and can look over its students).
//   - "University full admin": runs that university's student side (e.g. the Student Union).
// Each works only inside one institution, always below the owner, and the owner can see what they do.
function registerUniversityAdmin(app, d) {
  const { db, crypto, bcrypt, esc, layout, deliver, emailShell, sha, insertUser, startSession, notify, fullAdminIds, isCentral, purgeUser, LEVELS, TOP_LEVEL, weakPw, baseUrl, usernameProblem, cleanUsername } = d;
  db.exec("CREATE TABLE IF NOT EXISTS admin_invites(id INTEGER PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, institution TEXT NOT NULL, token_hash TEXT NOT NULL, expires INTEGER NOT NULL, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, accepted_at TEXT);" +
          "CREATE TABLE IF NOT EXISTS admin_log(id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, actor INTEGER, actor_name TEXT, institution TEXT, action TEXT NOT NULL);");
  if (!db.prepare('PRAGMA table_info(admin_invites)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE admin_invites ADD COLUMN user_id INTEGER');
  // A "virtual account" is created the moment the owner invites someone. It cannot log in, has a placeholder email that nobody
  // can sign up or reset a password with, and is hidden from every list. Accepting makes it real; declining or expiry deletes it.
  const makeVirtual = (email, inst, kind) => {
    const ph = `pending-${crypto.randomBytes(8).toString('hex')}@invite.invalid`;
    return insertUser('name,email,hash,verified,role,virtual,lp_inst,uni_role,university', ['Invited controller', ph, bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 4), 0, 'uniadmin', 1, inst, kind, inst]);
  };
  const dropVirtual = userId => { if (userId && db.prepare('SELECT 1 FROM users WHERE id=? AND virtual=1').get(userId)) purgeUser(userId); };
  const sweepInvites = () => {
    for (const i of db.prepare('SELECT id,user_id FROM admin_invites WHERE accepted_at IS NULL AND expires<=?').all(Date.now())) { dropVirtual(i.user_id); db.prepare('DELETE FROM admin_invites WHERE id=?').run(i.id); }
    // virtual accounts that lost their invitation for any reason
    for (const u of db.prepare('SELECT id FROM users WHERE virtual=1 AND id NOT IN (SELECT user_id FROM admin_invites WHERE user_id IS NOT NULL AND accepted_at IS NULL)').all()) purgeUser(u.id);
  };
  // One-time conversion: people who already accepted become dedicated controller accounts (no student/lecturer side),
  // and invitations that were still waiting get their virtual account now.
  db.prepare("UPDATE users SET role='uniadmin', is_lecturer=0, uni_role=COALESCE(uni_role,'central') WHERE lp_inst IS NOT NULL AND role='user' AND virtual=0 AND COALESCE(uni_role,'central')!='full'").run();
  // a university FULL admin is an ordinary student with extra abilities, so give back the student side to any converted by mistake
  db.prepare("UPDATE users SET role='user' WHERE role='uniadmin' AND uni_role='full' AND virtual=0").run();
  for (const i of db.prepare("SELECT * FROM admin_invites WHERE accepted_at IS NULL AND user_id IS NULL AND kind!='full'").all()) {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(i.email)) db.prepare('DELETE FROM admin_invites WHERE id=?').run(i.id);
    else db.prepare('UPDATE admin_invites SET user_id=? WHERE id=?').run(makeVirtual(i.email, i.institution, i.kind), i.id);
  }
  sweepInvites(); setInterval(sweepInvites, 36e5).unref();
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
    const holders = db.prepare("SELECT id,name,email,lp_inst,uni_role FROM users WHERE lp_inst IS NOT NULL AND virtual=0 ORDER BY lp_inst,name").all();
    const pending = db.prepare('SELECT id,email,kind,institution,expires FROM admin_invites WHERE accepted_at IS NULL AND expires>? ORDER BY id DESC').all(Date.now());
    const log = db.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT 40').all();
    return `<h1>University admins</h1><p class="mut">Invite someone by email. <b>Central admin:</b> an account is created for them straight away but stays hidden. They open the link and choose to accept or decline; if they accept they pick a username and password and go straight to their university's page (no student or lecturer side). If they decline, the account deletes itself. <b>Full admin:</b> must be a normal student. They keep their student account and get the extra abilities once they accept. They only ever see their own institution, and they stay below you. For a central admin use an email with no Studies Hub account yet; for a full admin use the email of their student account (or a new student).</p>
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
    const have = db.prepare('SELECT id,role,is_lecturer,lp_inst FROM users WHERE email=?').get(email);
    if (kind === 'central' && have) return to('That email already has a Studies Hub account. A university central admin gets a dedicated account, so use a different email address.');
    if (kind === 'full' && have && (have.role !== 'user' || have.is_lecturer || have.lp_inst)) return to('A full admin must be a normal student account. That email belongs to someone else on the site (a lecturer or an admin).');
    const token = crypto.randomBytes(32).toString('hex');
    for (const o of db.prepare('SELECT id,user_id FROM admin_invites WHERE email=? AND accepted_at IS NULL').all(email)) { dropVirtual(o.user_id); db.prepare('DELETE FROM admin_invites WHERE id=?').run(o.id); }
    db.prepare('INSERT INTO admin_invites(email,kind,institution,token_hash,expires,created_by,user_id) VALUES(?,?,?,?,?,?,?)').run(email, kind, inst, sha(token), Date.now() + 7 * 864e5, req.user.id, kind === 'central' ? makeVirtual(email, inst, kind) : null);
    const link = `${baseUrl(req)}/invite/${token}`;
    const what = kind === 'full' ? 'run the student side' : 'run the lecturer side and look over the students';
    try {
      const sent = await deliver(email, `You are invited to run ${inst} on Studies Hub`,
        `You have been invited as ${LABEL[kind]} for ${inst} on Studies Hub. You will ${what} for that institution.\n\nOpen this link to accept or decline (it works for 7 days): ${link}`,
        emailShell(`<h2 style="margin:0 0 8px;font-size:20px">You are invited</h2><p style="margin:0 0 8px">You have been invited as <b>${LABEL[kind]}</b> for <b>${esc(inst)}</b> on Studies Hub. You will ${what} for that institution.</p><p style="margin:16px 0"><a href="${esc(link)}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Accept or decline</a></p><p style="color:#5b6675;font-size:13px;margin:0">The link works for 7 days. If you were not expecting this, just ignore it: nothing is created for you unless you accept.</p>`, baseUrl(req)));
      if (!sent) console.log(`[email not configured] Invitation link for ${email}: ${link}`);
    } catch (e) { console.error('Invitation email failed:', e.message); return to("The invitation was saved but the email could not be sent. Check your email settings, then cancel it and send it again."); }
    to(`Invitation sent to ${email}.`);
  });
  app.post('/lecturer/admin/uni/invite/:id/revoke', owner, (req, res) => { const o = db.prepare('SELECT user_id FROM admin_invites WHERE id=? AND accepted_at IS NULL').get(Number(req.params.id)); if (o) dropVirtual(o.user_id); db.prepare('DELETE FROM admin_invites WHERE id=? AND accepted_at IS NULL').run(Number(req.params.id)); res.redirect('/lecturer/admin?tab=admins&msg=' + encodeURIComponent('Invitation cancelled.')); });
  app.post('/lecturer/admin/uni/holder/:id/remove', owner, (req, res) => { const h = db.prepare("SELECT id FROM users WHERE id=? AND role='uniadmin' AND lp_inst IS NOT NULL").get(Number(req.params.id)); if (h) purgeUser(h.id); else db.prepare("UPDATE users SET lp_inst=NULL, uni_role=NULL WHERE id=? AND role!='admin'").run(Number(req.params.id)); res.redirect('/lecturer/admin?tab=admins&msg=' + encodeURIComponent('Controller removed.')); });

  // ----- accepting an invitation -----
  const findInvite = token => /^[0-9a-f]{64}$/.test(String(token)) ? db.prepare('SELECT * FROM admin_invites WHERE token_hash=? AND accepted_at IS NULL AND expires>?').get(sha(token), Date.now()) : null;
  const page = (req, title, body) => layout(title, `<div class="auth"><h1>${esc(title)}</h1>${body}</div>`, req.user);
  const acceptForm = (inv, user, err) => `${err ? `<p class="err">${esc(err)}</p>` : ''}<form method="post" class="card"><p style="margin:0 0 10px"><b>Do you accept to be the university controller for ${esc(inv.institution)}?</b></p><p class="mut" style="margin:0 0 10px">You will manage everyone registered in ${esc(inv.institution)} and all their affairs. This is its own account: you do not log in as a student or a lecturer. Choose a username and a password to keep, so you can log in again any time.</p>
<input name="username" placeholder="Choose a username" required minlength="3" maxlength="20" autocapitalize="none" value="${esc((user && user.username) || '')}"><input name="password" type="password" placeholder="Choose a password (8+ characters)" required minlength="8" autocomplete="new-password">
<div class="row" style="gap:8px;margin-top:10px"><button name="action" value="accept">Accept</button><button class="ghost" name="action" value="decline" formnovalidate onclick="return confirm('Decline? The account made for you will be deleted.')">Decline</button></div></form>`;
  const fullNewForm = (name, err) => `${err ? `<p class="err">${esc(err)}</p>` : ''}<form method="post" class="card"><input name="name" placeholder="Your name" required maxlength="80" value="${esc(name || '')}"><input name="password" type="password" placeholder="Password (8+ characters)" required minlength="8" autocomplete="new-password"><button>Accept</button></form>`;
  app.get('/invite/:token', (req, res) => {
    const inv = findInvite(req.params.token);
    const dead = () => res.status(404).send(page(req, 'Invitation not valid', '<p class="mut">This invitation has expired, was declined or was already used. Ask the site owner to send a new one.</p>'));
    if (!inv || (inv.kind === 'central' && !db.prepare('SELECT 1 FROM users WHERE id=? AND virtual=1').get(inv.user_id))) return dead();
    if (inv.kind === 'full') {
      const existing = db.prepare('SELECT id FROM users WHERE email=?').get(inv.email), intro = `<p>You are invited as <b>${LABEL.full}</b> for <b>${esc(inv.institution)}</b>. You stay a normal student and get extra abilities for your university.</p>`;
      if (existing) {
        if (!req.user) return res.send(page(req, 'Accept the invitation', `${intro}<p class="mut">Log in with your student account (${esc(inv.email)}) to accept.</p><a class="btn" href="/login?next=${encodeURIComponent('/invite/' + req.params.token)}">Log in to accept</a>`));
        if (req.user.id !== existing.id) return res.send(page(req, 'Wrong account', `${intro}<p class="err">You are logged in as someone else. Log out and use ${esc(inv.email)}.</p>`));
        return res.send(page(req, 'Accept the invitation', `${intro}<form method="post"><button>Accept</button></form>`));
      }
      return res.send(page(req, 'Accept the invitation', `${intro}<p class="mut">Create your student account for ${esc(inv.email)}. This email link already proves the address is yours.</p>${fullNewForm()}`));
    }
    res.send(page(req, 'You are invited', `<p>You are invited as <b>${LABEL[inv.kind]}</b> for <b>${esc(inv.institution)}</b>.</p>${acceptForm(inv)}`));
  });
  function acceptFull(req, res, inv) {
    let user = db.prepare('SELECT * FROM users WHERE email=?').get(inv.email);
    if (user) {
      if (!req.user || req.user.id !== user.id) return res.redirect('/login?next=' + encodeURIComponent('/invite/' + req.params.token));
      if (user.role !== 'user' || user.is_lecturer) return res.redirect('/');
    } else {
      const name = clean(req.body.name, 80), pw = String(req.body.password || '');
      const bad = m => res.status(400).send(page(req, 'Accept the invitation', fullNewForm(name, m)));
      if (!name) return bad('Enter your name.');
      if (pw.length < 8) return bad('Password must be at least 8 characters.');
      if (weakPw(pw, inv.email)) return bad('That password is too easy to guess. Please pick something less common.');
      user = db.prepare('SELECT * FROM users WHERE id=?').get(insertUser('name,email,hash,verified', [name, inv.email, bcrypt.hashSync(pw, 12), 1]));
    }
    db.prepare("UPDATE users SET lp_inst=?, uni_role='full', university=CASE WHEN university IS NULL OR university='' THEN ? ELSE university END WHERE id=?").run(inv.institution, inv.institution, user.id);
    db.prepare("UPDATE admin_invites SET accepted_at=datetime('now') WHERE id=?").run(inv.id);
    db.prepare('INSERT INTO admin_log(actor,actor_name,institution,action) VALUES(?,?,?,?)').run(user.id, user.name, inv.institution, `Accepted the invitation as ${LABEL.full}`);
    notify(fullAdminIds(), { title: 'Admin invitation accepted', body: `${user.name} (${inv.email}) is now ${LABEL.full} for ${inv.institution}`, url: '/lecturer/admin?tab=admins', tag: 'lecturer' });
    if (!req.user) startSession(res, user.id);
    res.redirect('/uni');
  }
  app.post('/invite/:token', (req, res) => {
    const inv = findInvite(req.params.token);
    if (inv && inv.kind === 'full') return acceptFull(req, res, inv);
    const user = inv && db.prepare('SELECT * FROM users WHERE id=? AND virtual=1').get(inv.user_id);
    if (!inv || !user) return res.status(404).send(page(req, 'Invitation not valid', '<p class="mut">This invitation has expired, was declined or was already used.</p>'));
    if (req.body.action === 'decline') {
      purgeUser(user.id); db.prepare('DELETE FROM admin_invites WHERE id=?').run(inv.id);
      db.prepare('INSERT INTO admin_log(actor,actor_name,institution,action) VALUES(?,?,?,?)').run(null, inv.email, inv.institution, `Declined the invitation as ${LABEL[inv.kind]}`);
      notify(fullAdminIds(), { title: 'Admin invitation declined', body: `${inv.email} declined to be ${LABEL[inv.kind]} for ${inv.institution}`, url: '/lecturer/admin?tab=admins', tag: 'lecturer' });
      return res.send(page(req, 'Invitation declined', '<p class="mut">Thank you. The account that was made for you has been deleted.</p>'));
    }
    const username = cleanUsername(req.body.username), pw = String(req.body.password || '');
    const bad = m => res.status(400).send(page(req, 'You are invited', `<p>You are invited as <b>${LABEL[inv.kind]}</b> for <b>${esc(inv.institution)}</b>.</p>${acceptForm(inv, { username }, m)}`));
    const up = usernameProblem(username, user.id); if (up) return bad(up);
    if (pw.length < 8) return bad('Password must be at least 8 characters.');
    if (weakPw(pw, inv.email)) return bad('That password is too easy to guess. Please pick something less common.');
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND id!=?').get(inv.email, user.id)) return bad('This email address now has another account. Decline, and ask the owner to use a different email.');
    db.prepare("UPDATE users SET virtual=0, verified=1, email=?, hash=?, username=?, name=? WHERE id=?").run(inv.email, bcrypt.hashSync(pw, 12), username, username, user.id);
    db.prepare("UPDATE admin_invites SET accepted_at=datetime('now') WHERE id=?").run(inv.id);
    db.prepare('INSERT INTO admin_log(actor,actor_name,institution,action) VALUES(?,?,?,?)').run(user.id, username, inv.institution, `Accepted the invitation as ${LABEL[inv.kind]}`);
    notify(fullAdminIds(), { title: 'Admin invitation accepted', body: `@${username} (${inv.email}) is now ${LABEL[inv.kind]} for ${inv.institution}`, url: '/lecturer/admin?tab=admins', tag: 'lecturer' });
    startSession(res, user.id);
    res.redirect('/uni');
  });

  // ----- /uni: the student-side tools for a university admin (the owner can open it for every university) -----
  const scopeOf = req => isCentral(req.user) ? 'all' : (req.user && req.user.lp_inst) || null;
  const need = (req, res, next) => { if (!req.user) return res.redirect('/login?next=/uni'); req.scope = scopeOf(req); return req.scope ? next() : res.redirect('/dashboard'); };
  const studentWhere = req => req.scope === 'all' ? ["role='user'", 'is_lecturer=0', 'virtual=0'] : ["role='user'", 'is_lecturer=0', 'virtual=0', 'university=?'];
  const sArgs = req => req.scope === 'all' ? [] : [req.scope];
  app.get('/uni', need, (req, res) => {
    const all = req.scope === 'all', tab = all ? 'students' : ['students', 'lecturers', 'levels'].includes(req.query.tab) ? req.query.tab : 'overview';
    const msg = req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : '';
    const head = `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>${all ? 'Students (all universities)' : esc(req.scope)}</h1><p class="mut" style="margin-top:0">${all ? '' : (LABEL[req.user.uni_role] || LABEL.central) + ' &middot; everyone registered here and all their affairs'}</p>${msg}
<div class="row" style="justify-content:flex-start;gap:6px;margin:8px 0;flex-wrap:wrap">${all ? `<a class="${tab === 'students' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=students">Students</a>` : `<a class="${tab === 'overview' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=overview">Overview</a><a class="${tab === 'students' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=students">Students</a><a class="${tab === 'lecturers' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=lecturers">Lecturers</a><a class="${tab === 'levels' ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/uni?tab=levels">Level promotion</a>`}</div>`;
    let body = '';
    if (tab === 'overview') {
      const c = sql => db.prepare(sql).get(req.scope).n;
      const stu = c("SELECT COUNT(*) n FROM users WHERE role='user' AND is_lecturer=0 AND university=?"), lecs = c("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='approved' AND university=?"), pend = c("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='pending' AND university=?");
      const lv = LEVELS.map(l => `${l}: <b>${db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND is_lecturer=0 AND university=? AND level=?").get(req.scope, l).n}</b>`).join(' &middot; ');
      const log = db.prepare('SELECT * FROM admin_log WHERE institution=? ORDER BY id DESC LIMIT 8').all(req.scope);
      const tile = (n, l, h) => `<a class="card" href="${h}" style="text-decoration:none;color:inherit;margin:0;flex:1;min-width:120px;text-align:center"><div style="font-size:26px;font-weight:700">${n}</div><div class="mut">${l}</div></a>`;
      body = `<div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-start">${tile(stu, 'Students', '/uni?tab=students')}${tile(lecs, 'Lecturers', '/uni?tab=lecturers')}${tile(pend, 'Lecturers waiting', '/uni?tab=lecturers')}</div>
<div class="card"><p class="mut" style="margin:0">Students by level &middot; ${lv}</p></div><h3>Recent activity</h3>${log.map(l => `<p class="mut" style="margin:4px 0">${timeStr(l.at)} &middot; <b>${esc(l.actor_name || '')}</b>: ${esc(l.action)}</p>`).join('') || '<p class="mut">Nothing yet.</p>'}`;
    } else if (tab === 'lecturers') {
      const rows = db.prepare("SELECT id,name,email,lecturer_reg_no,lecturer_status,created_at FROM users WHERE is_lecturer=1 AND university=? ORDER BY lecturer_status='pending' DESC, id DESC LIMIT 200").all(req.scope);
      const manage = req.user.uni_role !== 'full' ? '<p><a class="btn" href="/lecturer/admin?tab=verify" style="display:inline-block">Verify and manage lecturers</a></p>' : '';
      body = `${manage}<p class="mut">${rows.length} lecturer${rows.length === 1 ? '' : 's'} registered in ${esc(req.scope)}</p>` + rows.map(l => `<div class="card row"><span><b>${esc(l.name)}</b><br><span class="mut">${esc(l.email)} &middot; ${esc(l.lecturer_reg_no || 'no staff number')} &middot; ${esc(l.lecturer_status || '')}</span></span></div>`).join('');
    } else if (tab === 'students') {
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
    res.send(layout(all ? 'Students' : req.scope, head + body, req.user, { mode: all ? '' : 'uni' }));
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
