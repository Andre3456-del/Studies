'use strict';
// Lecturer portal, admin view. No separate login: the central admin (or a lecturer admin he appoints for one institution)
// taps a switch in their normal menu and enters the lecturer portal in admin mode, looking and working like the lecturer portal,
// with a Back button to the student side. The central admin sees every institution; an institution's lecturer admin sees only theirs.
function registerLecturerAdmin(app, d) {
  const { db, esc, layout, isCentral, purgeUser, notify, renameValue, cleanUsername, uni } = d;
  const log = (req, text) => uni.logAdmin(req, req.scope === 'all' ? null : req.scope, text);
  const scopeOf = u => !u ? null : isCentral(u) ? 'all' : (u.lp_inst && u.uni_role !== 'full' ? u.lp_inst : null);
  const need = (req, res, next) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/lecturer/admin'));
    const sc = scopeOf(req.user);
    if (!sc) return res.redirect('/dashboard');
    req.scope = sc; next();
  };
  const central = (req, res, next) => req.scope === 'all' ? next() : res.redirect(to('overview', 'Only the central admin can do that.'));
  const clean = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
  const to = (tab, msg) => '/lecturer/admin?tab=' + tab + '&msg=' + encodeURIComponent(msg);
  const send = (req, res, title, body) => res.send(layout(title, body, req.user, { mode: 'lecturer-admin' }));
  const inScope = (req, uni) => req.scope === 'all' || uni === req.scope;
  const lecturer = (req, id) => { const u = db.prepare('SELECT id,name,email,university,lecturer_status FROM users WHERE id=? AND is_lecturer=1').get(Number(id)); return u && inScope(req, u.university) ? u : null; };
  const scopeSql = req => req.scope === 'all' ? ['', []] : ['AND u.university=?', [req.scope]];
  const statusPill = s => s === 'approved' ? '<span class="pill">Verified</span>' : s === 'pending' ? '<span class="pill pending">Waiting</span>' : s === 'rejected' ? '<span class="err">Rejected</span>' : '<span class="pill">Not finished</span>';
  const lecturerRows = (req, extra = '') => { const [w, a] = scopeSql(req); return db.prepare(`SELECT u.id,u.name,u.email,u.university,u.lecturer_reg_no,u.lecturer_status,u.created_at,u.last_seen,(SELECT COUNT(*) FROM pages p WHERE p.author_id=u.id) up,(SELECT group_concat(c.name,', ') FROM lecturer_courses lc JOIN courses c ON c.id=lc.course_id WHERE lc.lecturer_id=u.id) courses FROM users u WHERE u.is_lecturer=1 ${w} ${extra} ORDER BY u.id DESC`).all(...a); };

  const TABS = [['overview', 'Overview'], ['verify', 'Verify'], ['lecturers', 'Lecturers'], ['students', 'Students'], ['uploads', 'Uploads'], ['courses', 'Courses', 1], ['institutions', 'Institutions', 1], ['admins', 'University admins', 1]];
  app.get('/lecturer/admin', need, (req, res) => {
    const central = req.scope === 'all';
    const tabs = TABS.filter(t => !t[2] || central);
    const tab = tabs.some(t => t[0] === req.query.tab) ? req.query.tab : 'overview';
    const pend = lecturerRows(req, "AND u.lecturer_status='pending'").length;
    const nav = `<p style="margin:0 0 6px"><a class="btn ghost" href="/dashboard" style="display:inline-block">&larr; Back to student portal</a></p><p class="mut" style="margin:6px 0">Lecturer portal &middot; admin view${central ? '' : ' &middot; ' + esc(req.scope)}</p>
<div class="row" style="justify-content:flex-start;gap:6px;margin:8px 0">${tabs.map(([k, l]) => `<a class="${k === tab ? 'btn' : 'btn ghost'}" style="padding:7px 12px;margin:0" href="/lecturer/admin?tab=${k}">${l}${k === 'verify' && pend ? ' (' + pend + ')' : ''}</a>`).join('')}</div>`;
    if (tab === 'students') return res.redirect('/uni?tab=students');
    const msg = req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : '';
    let body = '';
    if (tab === 'overview') {
      const rows = lecturerRows(req);
      const nUp = db.prepare(`SELECT COUNT(*) n FROM pages p JOIN users u ON u.id=p.author_id WHERE u.is_lecturer=1 ${scopeSql(req)[0]}`).get(...scopeSql(req)[1]).n;
      body = `<h1>Overview</h1><div class="row" style="justify-content:flex-start;gap:10px">${[['Verified lecturers', rows.filter(r => r.lecturer_status === 'approved').length], ['Waiting for you', pend], ['Uploads', nUp], ...(central ? [['Courses', db.prepare('SELECT COUNT(*) n FROM courses').get().n]] : [])].map(([l, v]) => `<div class="card" style="min-width:130px;margin:0"><b style="font-size:26px">${v}</b><br><span class="mut">${l}</span></div>`).join('')}</div>
<p class="mut">This is the lecturer portal as you manage it. Open any lecturer in <a href="/lecturer/admin?tab=lecturers">Lecturers</a> to see exactly what they see.</p>`;
    } else if (tab === 'verify') {
      const rows = lecturerRows(req, "AND u.lecturer_status='pending'");
      body = `<h1>Verify lecturers</h1><p class="mut">Check each person really teaches at the institution they named.</p>` + (rows.map(u => `<div class="card"><div class="row"><div><b>${esc(u.name)}</b> <span class="mut">${esc(u.email)}</span><br>${esc(u.university || '')}${u.lecturer_reg_no ? ' &middot; ' + esc(u.lecturer_reg_no) : ''}<br><span class="mut">Courses: ${esc(u.courses || 'none')}</span></div>
<div class="row" style="gap:6px"><form method="post" action="/lecturer/admin/lecturer/${u.id}/approve" style="margin:0"><button>Verify</button></form><form method="post" action="/lecturer/admin/lecturer/${u.id}/reject" style="margin:0"><button class="link">Reject</button></form></div></div></div>`).join('') || '<p class="mut">Nobody is waiting.</p>');
    } else if (tab === 'lecturers') {
      const rows = lecturerRows(req);
      body = `<h1>Registered lecturers (${rows.length})</h1><p class="mut">Everyone who registered through the lecturer portal. They are kept separate from the student users list.</p>` + (rows.map(u => `<div class="card"><div class="row"><div><b>${esc(u.name)}</b> ${statusPill(u.lecturer_status)}<br><span class="mut">${esc(u.email)} &middot; ${esc(u.university || 'no institution yet')}</span><br><span class="mut">Courses: ${esc(u.courses || 'none')} &middot; ${u.up} upload${u.up === 1 ? '' : 's'} &middot; joined ${esc(String(u.created_at || '').slice(0, 10))}${u.last_seen ? ' &middot; last seen ' + new Date(u.last_seen).toISOString().slice(0, 10) : ''}</span></div>
<div class="row" style="gap:6px"><a class="btn ghost" style="margin:0;padding:7px 12px" href="/lecturer/admin/view/${u.id}">Open their view</a>${u.lecturer_status !== 'approved' ? `<form method="post" action="/lecturer/admin/lecturer/${u.id}/approve" style="margin:0"><button class="link">Verify</button></form>` : `<form method="post" action="/lecturer/admin/lecturer/${u.id}/reject" style="margin:0"><button class="link">Unverify</button></form>`}<form method="post" action="/lecturer/admin/lecturer/${u.id}/remove" style="margin:0" onsubmit="return confirm('Remove this lecturer completely? Their chats, uploads and sign-ins are all deleted.')"><button class="link">Remove</button></form></div></div></div>`).join('') || '<p class="mut">No lecturers yet.</p>');
    } else if (tab === 'uploads') {
      const [w, a] = scopeSql(req);
      const rows = db.prepare(`SELECT p.id,p.title,p.kind,p.created_at,u.name author,c.name course FROM pages p JOIN users u ON u.id=p.author_id LEFT JOIN courses c ON c.id=p.course_id WHERE u.is_lecturer=1 ${w} ORDER BY p.id DESC LIMIT 200`).all(...a);
      body = `<h1>Lecturer uploads (${rows.length})</h1>` + (rows.map(p => uploadRow(p, true)).join('') || '<p class="mut">No uploads yet.</p>');
    } else if (tab === 'courses') {
      const courses = db.prepare('SELECT c.id,c.name,(SELECT COUNT(*) FROM lecturer_courses lc WHERE lc.course_id=c.id) l,(SELECT COUNT(*) FROM pages p WHERE p.course_id=c.id) p FROM courses c ORDER BY c.name').all();
      body = `<h1>Courses (${courses.length})</h1><p class="mut">Lecturers pick and upload under these. If something is not really a course, rename it, delete it, or merge it into the right one.</p>
<form class="card row" method="post" action="/lecturer/admin/course/add"><input name="name" placeholder="New course" required maxlength="120" style="flex:1;min-width:180px"><button>Add</button></form>` + courses.map(c => `<div class="card"><form method="post" action="/lecturer/admin/course/${c.id}/rename" class="row" style="gap:6px"><input name="name" value="${esc(c.name)}" maxlength="120" required style="flex:1;min-width:180px"><button class="ghost">Rename</button></form>
<span class="mut" style="font-size:12px">${c.l} lecturer${c.l === 1 ? '' : 's'} &middot; ${c.p} upload${c.p === 1 ? '' : 's'}</span>
<div class="row" style="gap:6px;margin-top:6px"><form method="post" action="/lecturer/admin/course/${c.id}/merge" class="row" style="gap:6px;margin:0"><select name="into" style="width:auto"><option value="">Move everything into&hellip;</option>${courses.filter(o => o.id !== c.id).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="ghost">Merge</button></form>
<form method="post" action="/lecturer/admin/course/${c.id}/delete" style="margin:0" onsubmit="return confirm('Delete this course? Lecturers lose it and its uploads become unfiled.')"><button class="link">Delete</button></form></div></div>`).join('');
    } else if (tab === 'institutions') {
      const inst = db.prepare('SELECT i.id,i.name,(SELECT COUNT(*) FROM users u WHERE u.university=i.name AND u.is_lecturer=1) c FROM institutions i ORDER BY i.name').all();
      body = `<h1>Institutions (${inst.length})</h1><p class="mut">The list lecturers choose from when they register.</p><form class="card row" method="post" action="/lecturer/admin/institution/add"><input name="name" placeholder="New institution" required maxlength="120" style="flex:1;min-width:200px"><button>Add</button></form>` + inst.map(i => `<div class="card"><form method="post" action="/lecturer/admin/institution/${i.id}/save" class="row" style="gap:6px"><input name="name" value="${esc(i.name)}" maxlength="120" required style="flex:1;min-width:200px"><button class="ghost">Save</button></form><div class="row"><span class="mut">${i.c} lecturer${i.c === 1 ? '' : 's'}</span><form method="post" action="/lecturer/admin/institution/${i.id}/delete" style="margin:0" onsubmit="return confirm('Remove from the list? Existing lecturers keep their entry.')"><button class="link">Remove</button></form></div></div>`).join('');
    } else {
      body = uni.panel(req);
    }
    send(req, res, 'Lecturer admin', nav + msg + body);
  });

  function uploadRow(p, showView) {
    return `<div class="card"><form method="post" action="/lecturer/admin/upload/${p.id}/title" class="row" style="gap:6px"><input name="title" value="${esc(p.title)}" maxlength="140" required style="flex:1;min-width:200px"><button class="ghost">Save title</button></form>
<div class="row"><span class="mut">${esc(p.author || '')}${p.author ? ' &middot; ' : ''}${esc(p.course || 'no course')} &middot; ${esc(p.kind)} &middot; ${esc(String(p.created_at || '').slice(0, 10))}</span><form method="post" action="/lecturer/admin/upload/${p.id}/delete" style="margin:0" onsubmit="return confirm('Delete this upload for everyone?')"><button class="link">Delete</button></form></div></div>`;
  }
  // The lecturer's own dashboard as they see it, with the admin's edit tools on top.
  app.get('/lecturer/admin/view/:id', need, (req, res) => {
    const u = lecturer(req, req.params.id); if (!u) return res.redirect(to('lecturers', 'Not found.'));
    const full = db.prepare('SELECT university,lecturer_reg_no FROM users WHERE id=?').get(u.id);
    const courses = db.prepare('SELECT c.id,c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(u.id);
    const pages = db.prepare('SELECT p.id,p.title,p.kind,p.created_at,c.name course FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.author_id=? ORDER BY p.id DESC').all(u.id);
    send(req, res, 'Lecturer view', `<p style="margin:0 0 6px"><a class="btn ghost" href="/lecturer/admin?tab=lecturers" style="display:inline-block">&larr; Back to lecturers</a></p><p class="pill">Viewing as ${esc(u.name)} &mdash; admin view, you are not posting as them</p>
<h1>My courses</h1><p class="mut" style="margin-top:0">${esc(full.university || '')}${full.lecturer_reg_no ? ' &middot; ' + esc(full.lecturer_reg_no) : ''} &middot; ${statusPill(u.lecturer_status)}</p>
<div>${courses.map(c => `<span class="btn ghost" style="margin:4px 6px 0 0;display:inline-block">${esc(c.name)}</span>`).join('') || '<p class="mut">No courses linked.</p>'}</div>
<h3>Their uploads (${pages.length})</h3>${pages.map(p => uploadRow(p)).join('') || '<p class="mut">Nothing uploaded yet.</p>'}`);
  });

  app.post('/lecturer/admin/lecturer/:id/approve', need, (req, res) => {
    const t = lecturer(req, req.params.id); if (!t) return res.redirect(to('verify', 'Not found.'));
    db.prepare("UPDATE users SET lecturer_status='approved' WHERE id=?").run(t.id);
    notify([t.id], { title: 'You are verified', body: 'You can now upload for your courses.', url: '/lecturer', tag: 'lecturer' });
    log(req, `Verified lecturer ${t.name}`);
    res.redirect(to('verify', `${t.name} is verified.`));
  });
  app.post('/lecturer/admin/lecturer/:id/reject', need, (req, res) => {
    const t = lecturer(req, req.params.id); if (!t) return res.redirect(to('verify', 'Not found.'));
    db.prepare("UPDATE users SET lecturer_status='rejected' WHERE id=?").run(t.id);
    log(req, `Marked lecturer ${t.name} as not verified`);
    res.redirect(to('lecturers', `${t.name} was marked not verified.`));
  });
  app.post('/lecturer/admin/lecturer/:id/remove', need, (req, res) => {
    const t = lecturer(req, req.params.id); if (!t) return res.redirect(to('lecturers', 'Not found.'));
    purgeUser(t.id); log(req, `Removed lecturer ${t.name}`);
    res.redirect(to('lecturers', `${t.name} was removed completely.`));
  });
  const ownUpload = (req, id) => { const p = db.prepare('SELECT p.id,u.university FROM pages p JOIN users u ON u.id=p.author_id WHERE p.id=? AND u.is_lecturer=1').get(Number(id)); return p && inScope(req, p.university) ? p : null; };
  app.post('/lecturer/admin/upload/:id/title', need, (req, res) => {
    const p = ownUpload(req, req.params.id), title = clean(req.body.title, 140); if (!p || !title) return res.redirect(to('uploads', 'Could not save that.'));
    db.prepare('UPDATE pages SET title=?, semester=NULL WHERE id=?').run(title, p.id); d.stampSemesters && d.stampSemesters();
    res.redirect(req.get('referer') || to('uploads', 'Saved.'));
  });
  app.post('/lecturer/admin/upload/:id/delete', need, (req, res) => {
    const p = ownUpload(req, req.params.id); if (!p) return res.redirect(to('uploads', 'Not found.'));
    db.prepare('DELETE FROM purchases WHERE page_id=?').run(p.id); db.prepare('DELETE FROM pages WHERE id=?').run(p.id); log(req, 'Deleted a lecturer upload');
    res.redirect(req.get('referer') || to('uploads', 'Upload deleted.'));
  });
  // central admin only
  app.post('/lecturer/admin/course/add', need, central, (req, res) => { const n = clean(req.body.name, 120); if (!n) return res.redirect(to('courses', 'Type a course name.')); db.prepare('INSERT OR IGNORE INTO courses(name) VALUES(?)').run(n); res.redirect(to('courses', `Added ${n}.`)); });
  app.post('/lecturer/admin/course/:id/rename', need, central, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.params.id)), n = clean(req.body.name, 120);
    if (!c || !n) return res.redirect(to('courses', 'Could not save that course.'));
    if (db.prepare('SELECT 1 FROM courses WHERE name=? AND id!=?').get(n, c.id)) return res.redirect(to('courses', 'Another course already has that name. Use Merge instead.'));
    db.prepare('UPDATE courses SET name=? WHERE id=?').run(n, c.id); res.redirect(to('courses', `Saved ${n}.`));
  });
  app.post('/lecturer/admin/course/:id/delete', need, central, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.params.id)); if (!c) return res.redirect(to('courses', 'Not found.'));
    db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id); db.prepare('UPDATE pages SET course_id=NULL WHERE course_id=?').run(c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
    res.redirect(to('courses', `Deleted ${c.name}.`));
  });
  app.post('/lecturer/admin/course/:id/merge', need, central, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.params.id)), t = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.body.into) || 0);
    if (!c || !t || c.id === t.id) return res.redirect(to('courses', 'Choose the course to move everything into.'));
    db.prepare('UPDATE OR IGNORE lecturer_courses SET course_id=? WHERE course_id=?').run(t.id, c.id); db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id);
    db.prepare('UPDATE pages SET course_id=? WHERE course_id=?').run(t.id, c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
    res.redirect(to('courses', `${c.name} was merged into ${t.name}.`));
  });
  app.post('/lecturer/admin/institution/add', need, central, (req, res) => { const n = clean(req.body.name, 120); if (!n || /^Other\b/i.test(n)) return res.redirect(to('institutions', 'Type an institution name.')); db.prepare('INSERT OR IGNORE INTO institutions(name) VALUES(?)').run(n); res.redirect(to('institutions', `Added ${n}.`)); });
  app.post('/lecturer/admin/institution/:id/save', need, central, (req, res) => {
    const i = db.prepare('SELECT * FROM institutions WHERE id=?').get(Number(req.params.id)), n = clean(req.body.name, 120);
    if (!i || !n) return res.redirect(to('institutions', 'Could not save that institution.'));
    if (n !== i.name) {
      if (db.prepare('SELECT 1 FROM institutions WHERE name=? AND id!=?').get(n, i.id)) return res.redirect(to('institutions', 'Another institution already has that name.'));
      db.prepare('UPDATE institutions SET name=? WHERE id=?').run(n, i.id); renameValue(['university', 'lp_inst'], i.name, n);
    }
    res.redirect(to('institutions', `Saved ${n}.`));
  });
  app.post('/lecturer/admin/institution/:id/delete', need, central, (req, res) => { db.prepare('DELETE FROM institutions WHERE id=?').run(Number(req.params.id)); res.redirect(to('institutions', 'Removed from the list.')); });
}
module.exports = { registerLecturerAdmin };
