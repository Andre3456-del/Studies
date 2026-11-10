// Levels, news, page and user admin actions
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { LAST_LEVEL_SQL, LEVELS, NOT_YOURS, ROLES, SEM, admin, back, bcrypt, broadcastNews, can, central, cleanUsername, crypto, db, esc, filesAdmin, isCentral, isImageUpload, layout, limited, mayManageNews, newsAdmin, notify, ownsAdminPage, pagesAdmin, promoter, purgeUser, sendResetCode, sendSafely, supportAdmin, timeAgo, upload, videoMimeOf, youtubeId } = ctx;
  // ---------- Levels: only the central admin and the people they appoint can move students up ----------
  const TOP_LEVEL = LEVELS[LEVELS.length - 1];
  // Moves students up one level; anyone already at their department's last level is flagged as a graduate instead.
  // `where`/`args` select the students (they must already exclude graduates). Returns who moved and who graduated.
  function promoteStudents(where, args) {
    const base = `${where} AND graduated=0 AND level IS NOT NULL`;
    const gradIds = db.prepare(`SELECT id FROM users WHERE ${base} AND level >= ${LAST_LEVEL_SQL}`).all(...args).map(r => r.id);
    const moveIds = db.prepare(`SELECT id FROM users WHERE ${base} AND level < ${LAST_LEVEL_SQL}`).all(...args).map(r => r.id);
    let own = true; try { db.exec('BEGIN'); } catch (_) { own = false; } // the semester switch already runs inside its own transaction
    try {
      db.prepare(`UPDATE users SET graduated=1, graduated_at=datetime('now') WHERE ${base} AND level >= ${LAST_LEVEL_SQL}`).run(...args);
      db.prepare(`UPDATE users SET level = level + 100 WHERE ${base} AND level < ${LAST_LEVEL_SQL}`).run(...args);
      if (own) db.exec('COMMIT');
    } catch (e) { if (own) { try { db.exec('ROLLBACK'); } catch (_) {} } throw e; }
    if (moveIds.length) notify(moveIds, { title: 'You moved up a level', body: 'Your level has been updated by your school admin.', url: '/dashboard', tag: 'level' });
    if (gradIds.length) notify(gradIds, { title: 'Congratulations, graduate! 🎓', body: 'You have finished your last level. You are now flagged as a graduate on Studies Hub.', url: '/dashboard', tag: 'level' });
    return { moved: moveIds.length, graduated: gradIds.length };
  }
  const promoMsg = r => `${r.moved} student${r.moved === 1 ? '' : 's'} moved up a level` + (r.graduated ? ` and ${r.graduated} graduated 🎓` : '') + '.';
  function promotionTargets(dept, fromLevel) {
    const where = ["role='user'", 'is_lecturer=0', 'graduated=0', 'level IS NOT NULL'], args = [];
    if (dept) { where.push('department=?'); args.push(dept); }
    if (fromLevel) { where.push('level=?'); args.push(fromLevel); }
    return { where: where.join(' AND '), args };
  }
  app.get('/admin/levels', promoter, (req, res) => {
    const msg = req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : '';
    const counts = LEVELS.map(l => `${l} level: <b>${db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND is_lecturer=0 AND graduated=0 AND level=?").get(l).n}</b>`).join(' &middot; ') + ` &middot; graduates: <b>${db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND is_lecturer=0 AND graduated=1").get().n}</b>`;
    const depts = db.prepare("SELECT DISTINCT department d FROM users WHERE role='user' AND department IS NOT NULL ORDER BY department").all().map(r => r.d);
    const log = db.prepare("SELECT l.*, u.name FROM level_log l LEFT JOIN users u ON u.id=l.by_user ORDER BY l.id DESC LIMIT 8").all();
    const helpers = isCentral(req.user) ? db.prepare("SELECT id,name,username,email FROM users WHERE can_promote=1 ORDER BY name").all() : [];
    res.send(layout('Level promotion', `<p class="mut"><a href="${can.anyAdmin(req.user) ? '/admin' : '/settings'}">&larr; Back</a></p><h1>Level promotion</h1>${msg}
<p class="mut">Students cannot change their own level, department or username. A level only moves when it is done here.</p>
<div class="card"><p class="mut" style="margin:0 0 8px">${counts}</p>
<form method="post" action="/admin/levels/advance" id="advForm">
<label class="mut">Department</label><select name="department"><option value="">Every department</option>${depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
<label class="mut">Which level moves up</label><select name="level"><option value="">Every level (100&rarr;200, 200&rarr;300 ...)</option>${LEVELS.map(l => `<option value="${l}">Only ${l} level &rarr; ${l + 100 <= 500 ? l + 100 : 'graduates'}</option>`).join('')}</select>
<button style="margin-top:10px">Move students up one level</button></form>
<p class="hint">A student already at their department's last level (500, or 400 where you set it so) is flagged as a <b>graduate</b> instead of moving up. This cannot be undone, so check the choice above before you press the button.</p></div>
${isCentral(req.user) ? (() => { const cur = SEM.getCurrent(db); return `<h3>Semester</h3><div class="card"><p style="margin:0 0 6px">Now showing: <b>${SEM.semesterName(cur)}</b></p><p class="mut" style="margin:0 0 8px">Students only see uploads for the current semester. The course code decides it: the middle digit of a code like GST 1<b>2</b>1 is the semester. An upload with no course code shows in both.</p>
<form method="post" action="/admin/semester/advance" onsubmit="return confirm('${cur === 1 ? 'Open second semester? First semester uploads will be hidden from students.' : 'End the session? Second semester uploads will be hidden, first semester opens again, and EVERY student moves up one level. This cannot be undone.'}')"><button>${cur === 1 ? 'Move everyone to second semester' : 'Start new session: first semester + move everyone up a level'}</button></form></div>`; })() : ''}
${isCentral(req.user) ? `<h3>People allowed to promote students</h3><p class="mut" style="margin-top:0">Only you (the central admin) can add or remove them.</p>
${helpers.length ? helpers.map(h => `<div class="card row" style="align-items:center"><span style="flex:1"><b>${esc(h.name)}</b> <span class="mut">${h.username ? '@' + esc(h.username) : esc(h.email)}</span></span><form method="post" action="/admin/levels/promoters/${h.id}/remove"><button class="link">Remove</button></form></div>`).join('') : '<p class="mut">Nobody else yet.</p>'}
<form method="post" action="/admin/levels/promoters/add" class="card row" style="align-items:center"><input name="who" placeholder="@username or email of the person" required style="flex:1"><button>Allow</button></form>` : ''}
<h3>Recent promotions</h3>${log.length ? log.map(l => `<p class="mut" style="margin:4px 0">${timeAgo(l.at)}: <b>${esc(l.name || 'Admin')}</b> moved ${l.moved} student${l.moved === 1 ? '' : 's'} up${l.department ? ' in ' + esc(l.department) : ''}${l.from_level ? ' from ' + l.from_level + ' level' : ''}.</p>`).join('') : '<p class="mut">Nothing yet.</p>'}
<script>document.getElementById('advForm').addEventListener('submit',function(e){var f=e.target,d=f.department.value||'every department',l=f.level.value?f.level.value+' level':'every level';if(!confirm('Move '+l+' in '+d+' up one level? This cannot be undone.'))e.preventDefault()})</script>`, req.user));
  });
  app.post('/admin/levels/advance', promoter, (req, res) => {
    const dept = String(req.body.department || '').trim() || null, from = LEVELS.includes(Number(req.body.level)) ? Number(req.body.level) : null;
    const t = promotionTargets(dept, from);
    const r = promoteStudents(t.where, t.args);
    db.prepare('INSERT INTO level_log(by_user,department,from_level,moved) VALUES(?,?,?,?)').run(req.user.id, dept, from, r.moved + r.graduated);
    res.redirect('/admin/levels?msg=' + encodeURIComponent(promoMsg(r)));
  });
  app.post('/admin/semester/advance', central, (req, res) => {
    const from = SEM.getCurrent(db);
    let moved = 0, grads = 0;
    const r = SEM.advance(db, () => { // end of second semester: everyone moves up one level
      const t = promotionTargets(null, null);
      const pr = promoteStudents(t.where, t.args);
      moved = pr.moved + pr.graduated; grads = pr.graduated;
      db.prepare('INSERT INTO level_log(by_user,department,from_level,moved) VALUES(?,?,?,?)').run(req.user.id, null, null, moved);
      return moved;
    });
    const everyone = db.prepare("SELECT id FROM users WHERE verified=1 AND is_lecturer=0 AND role!='admin'").all().map(x => x.id);
    notify(everyone, r.levelsPromoted
      ? { title: 'A new session has begun', body: 'First semester is open and you have moved up a level.', url: '/dashboard', tag: 'semester' }
      : { title: 'Second semester is open', body: 'Second semester uploads are now available.', url: '/dashboard', tag: 'semester' });
    console.log(`Audit: ${req.user.email} moved the site from ${SEM.semesterName(from)} to ${SEM.semesterName(r.to)}${r.levelsPromoted ? ' and promoted ' + moved + ' students' : ''}`);
    res.redirect('/admin/levels?msg=' + encodeURIComponent(r.levelsPromoted ? `New session started: first semester is open and ${moved - grads} student${moved - grads === 1 ? '' : 's'} moved up a level` + (grads ? ` and ${grads} graduated 🎓.` : '.') : 'Second semester is now open. First semester uploads are hidden.'));
  });
  app.post('/admin/levels/promoters/add', central, (req, res) => {
    const who = String(req.body.who || '').trim();
    const u = db.prepare('SELECT id,name FROM users WHERE lower(username)=? OR lower(email)=?').get(cleanUsername(who), who.toLowerCase());
    if (!u) return res.redirect('/admin/levels?msg=' + encodeURIComponent('No member found with that username or email.'));
    db.prepare('UPDATE users SET can_promote=1 WHERE id=?').run(u.id);
    notify([u.id], { title: 'You can promote students', body: 'The central admin allowed you to move students up a level (Settings > Level promotion).', url: '/admin/levels', tag: 'level' });
    res.redirect('/admin/levels?msg=' + encodeURIComponent(`${u.name} can now promote students.`));
  });
  app.post('/admin/levels/promoters/:id/remove', central, (req, res) => {
    db.prepare('UPDATE users SET can_promote=0 WHERE id=?').run(Number(req.params.id));
    res.redirect('/admin/levels?msg=' + encodeURIComponent('Removed.'));
  });

  app.post('/admin/pages/:id/replace', pagesAdmin, upload.single('file'), (req, res) => {
    const page = db.prepare('SELECT kind, author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
    if (!page) return res.redirect(back('Page not found.'));
    if (page.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can change it.'));
    if (!ownsAdminPage(req.user, page)) return res.redirect(back(NOT_YOURS));
    if (page.kind !== 'html' && !can.allKinds(req.user)) return res.sendStatus(403);
    if (!req.file) return res.redirect(back('Choose a file first.'));
    if (page.kind === 'video') {
      const vmime = videoMimeOf(req.file);
      if (!vmime) return res.redirect(back('That file is not a video.'));
      db.prepare('UPDATE pages SET file_data=?, file_mime=?, file_name=?, video_id=NULL WHERE id=?').run(req.file.buffer, vmime, req.file.originalname, req.params.id);
    } else if (page.kind === 'pdf' || page.kind === 'doc' || page.kind === 'image') {
      if (page.kind === 'image' && !isImageUpload(req.file)) return res.redirect(back('Choose a JPG or PNG picture.'));
      db.prepare('UPDATE pages SET file_data=?, file_mime=?, file_name=? WHERE id=?').run(req.file.buffer, req.file.mimetype, req.file.originalname, req.params.id);
    } else {
      db.prepare('UPDATE pages SET html=? WHERE id=?').run(req.file.buffer.toString('utf8'), req.params.id);
    }
    res.redirect(back('File replaced.'));
  });
  app.post('/admin/pages/:id/video', filesAdmin, (req, res) => {
    const vid = youtubeId(req.body.video_url);
    if (!vid) return res.redirect(back('Enter a valid YouTube link.'));
    const own = db.prepare('SELECT author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
    if (!own || !ownsAdminPage(req.user, own)) return res.redirect(back(NOT_YOURS));
    db.prepare("UPDATE pages SET video_id=?, file_data=NULL, file_mime=NULL, file_name=NULL WHERE id=? AND kind='video'").run(vid, req.params.id);
    res.redirect(back('Video link updated.'));
  });
  app.post('/admin/news', newsAdmin, upload.single('image'), (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 140);
    const body = String(req.body.body || '').trim().slice(0, 2000000);
    if (!title || !body) return res.redirect(back('Enter a headline and a summary.'));
    if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect(back('That file is not an image.'));
    const info = db.prepare('INSERT INTO news(title,body,image_data,image_mime,author_id,status) VALUES(?,?,?,?,?,?)')
      .run(title, body, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, req.user.id, 'approved');
    broadcastNews(Number(info.lastInsertRowid), req.user.id);
    res.redirect(back('News posted.'));
  });
  app.post('/admin/news/:id/approve', newsAdmin, (req, res) => {
    const wasPending = db.prepare("SELECT author_id FROM news WHERE id=? AND status='pending'").get(req.params.id);
    db.prepare("UPDATE news SET status='approved' WHERE id=?").run(req.params.id);
    if (wasPending) {
      if (wasPending.author_id && wasPending.author_id !== req.user.id) notify([wasPending.author_id], { title: 'Your news is live', body: 'An admin approved what you shared.', url: '/news/' + req.params.id, tag: 'news-approved' });
      broadcastNews(Number(req.params.id), wasPending.author_id);
    }
    res.redirect(back('News approved.'));
  });
  app.post('/news/:id/approver-approve', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const n = db.prepare("SELECT author_id FROM news WHERE id=? AND status='pending_approver' AND approver_id=?").get(req.params.id, req.user.id);
    if (!n) return res.redirect(back('That item is not waiting on you.'));
    db.prepare("UPDATE news SET status='approved' WHERE id=?").run(req.params.id);
    if (n.author_id && n.author_id !== req.user.id) notify([n.author_id], { title: 'Your news is live', body: `${req.user.name} approved what you shared.`, url: '/news/' + req.params.id, tag: 'news-approved' });
    broadcastNews(Number(req.params.id), n.author_id);
    res.redirect(back('Approved -- it is live.'));
  });
  app.post('/news/:id/approver-reject', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const n = db.prepare("SELECT id FROM news WHERE id=? AND status='pending_approver' AND approver_id=?").get(req.params.id, req.user.id);
    if (!n) return res.redirect(back('That item is not waiting on you.'));
    db.prepare("UPDATE news SET status='rejected' WHERE id=?").run(req.params.id);
    res.redirect(back('Rejected.'));
  });
  app.post('/admin/news/:id/delete', newsAdmin, (req, res) => {
    const own = db.prepare('SELECT author_id FROM news WHERE id=?').get(req.params.id);
    if (own && !mayManageNews(req.user, own)) return res.redirect(back(NOT_YOURS));
    db.prepare('DELETE FROM news WHERE id=?').run(req.params.id);
    res.redirect(back('News deleted.'));
  });
  app.get('/admin/news/:id/edit', newsAdmin, (req, res) => {
    const n = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
    if (!n) return res.redirect(back('News item not found.'));
    if (!mayManageNews(req.user, n)) return res.redirect(back(NOT_YOURS));
    res.send(layout('Edit news', `<p class="mut"><a href="/admin?tab=news">&larr; Admin</a></p><h1 style="font-size:26px">Edit news</h1>
${n.image_data ? `<img src="/news-image/${n.id}" style="max-width:220px;border-radius:10px;display:block;margin-bottom:10px">` : ''}
<form class="card" method="post" action="/admin/news/${n.id}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(n.title)}" required maxlength="140">
<input type="file" name="image" accept="image/*" style="padding:9px 0">
<p class="hint">Choose a picture only if you want to replace the current one.</p>
<textarea name="body" required maxlength="2000000" style="width:100%;min-height:120px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(n.body)}</textarea>
<button>Save changes</button></form>`, req.user));
  });
  app.post('/admin/news/:id/edit', newsAdmin, upload.single('image'), (req, res) => {
    const n = db.prepare('SELECT id, author_id FROM news WHERE id=?').get(req.params.id);
    if (!n) return res.redirect(back('News item not found.'));
    if (!mayManageNews(req.user, n)) return res.redirect(back(NOT_YOURS));
    const title = String(req.body.title || '').trim().slice(0, 140);
    const body = String(req.body.body || '').trim().slice(0, 2000000);
    if (!title || !body) return res.redirect(`/admin/news/${n.id}/edit`);
    if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect(back('That file is not an image.'));
    if (req.file) db.prepare('UPDATE news SET title=?, body=?, image_data=?, image_mime=? WHERE id=?').run(title, body, req.file.buffer, req.file.mimetype, n.id);
    else db.prepare('UPDATE news SET title=?, body=? WHERE id=?').run(title, body, n.id);
    res.redirect(back('News updated.'));
  });
  app.post('/admin/pages/:id/toggle', pagesAdmin, (req, res) => {
    const p = db.prepare('SELECT author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
    if (p && p.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can change it.'));
    if (p && !ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
    db.prepare('UPDATE pages SET members_only = 1 - members_only WHERE id=?').run(req.params.id);
    res.redirect('/admin');
  });
  app.post('/admin/pages/:id/delete', pagesAdmin, (req, res) => {
    const p = db.prepare('SELECT author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
    if (p && p.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can delete it.'));
    if (p && !ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
    db.prepare('DELETE FROM pages WHERE id=?').run(req.params.id);
    res.redirect(back('Page deleted.'));
  });
  // Login-help actions. Login-help admins can help anyone except full admins; full admins can help everyone.
  const helpTarget = (req, res) => {
    const t = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!t) { res.redirect(back('User not found.')); return null; }
    if (t.role === 'admin' && !can.full(req.user)) { res.sendStatus(403); return null; }
    return t;
  };
  app.post('/admin/users/:id/verify', supportAdmin, (req, res) => {
    const t = helpTarget(req, res); if (!t) return;
    db.prepare('UPDATE users SET verified=1, verify_hash=NULL, verify_expires=NULL WHERE id=?').run(t.id);
    res.redirect(back('User verified.'));
  });
  app.post('/admin/users/:id/resend-verification', supportAdmin, async (req, res) => {
    const t = helpTarget(req, res); if (!t) return;
    if (t.verified) return res.redirect(back('That account is already verified.'));
    const r = await sendSafely(req, t);
    res.redirect(back(r === 'sent' ? `Verification link sent to ${t.email}.` : r === 'wait' ? 'A link was sent a moment ago. Wait a minute and try again.' : 'The email could not be sent. Check the email settings.'));
  });
  app.post('/admin/users/:id/reset-code', supportAdmin, async (req, res) => {
    const t = helpTarget(req, res); if (!t) return;
    if (limited('help-reset:' + t.id, 3, 15 * 60e3)) return res.redirect(back('Too many codes sent to this person. Try again in a few minutes.'));
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare('UPDATE users SET reset_hash=?, reset_expires=?, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(code, 10), Date.now() + 600000, t.id);
    try { await sendResetCode(t.email, code); } catch (e) { console.error('Reset email failed:', e.message); }
    res.redirect(back(`A reset code was emailed to ${t.email}. It goes only to their inbox.`)); // the code is never shown to the admin
  });
  app.post('/admin/users/:id/signout', supportAdmin, (req, res) => {
    const t = helpTarget(req, res); if (!t) return;
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);
    res.redirect(back(`${t.name} was signed out everywhere.`));
  });
  app.post('/admin/users/:id/delete', admin, (req, res) => {
    const t = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(Number(req.params.id));
    if (!t) return res.redirect(back('That person is already gone.'));
    if (t.role === 'admin') return res.redirect(back('The main admin account cannot be removed.'));
    purgeUser(t.id);
    console.log(`Audit: ${req.user.email} removed account #${t.id} completely`);
    res.redirect(back(`${t.name} was removed completely: chats, friends, uploads, sign-ins and the Google link are all gone.`));
  });
  // Only the central admin (the ADMIN_EMAIL account) can create or change any kind of admin (files, news, login-help, partial, full),
  // and only for users who have already registered.
  app.post('/admin/users/:id/role', central, (req, res) => {
    const role = ROLES.includes(req.body.role) ? req.body.role : 'user';
    const target = db.prepare('SELECT email FROM users WHERE id=?').get(req.params.id);
    if (target && target.email !== ctx.ADMIN_EMAIL) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
    res.redirect(back('Role updated.'));
  });
  return { TOP_LEVEL, promoMsg, promoteStudents };
};
