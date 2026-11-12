// Site structure: faculties, departments, institutions and courses
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { central, db, esc, layout } = ctx;
  const sback = (msg, anchor) => '/admin/structure?msg=' + encodeURIComponent(msg) + (anchor ? '#' + anchor : '');
  // Changes a name everywhere it is stored (people, uploads, news reach, logs) so nothing is left pointing at the old name.
  function renameValue(cols, from, to) {
    let n = 0;
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name))
      for (const c of db.prepare(`PRAGMA table_info("${t}")`).all())
        if (cols.includes(c.name)) n += Number(db.prepare(`UPDATE "${t}" SET "${c.name}"=? WHERE "${c.name}"=?`).run(to, from).changes);
    return n;
  }
  function renameInPageAudience(from, to) { // uploads keep their departments as a comma-separated list
    for (const r of db.prepare("SELECT id,dept FROM pages WHERE dept IS NOT NULL AND dept!=''").all()) {
      const parts = r.dept.split(','); if (!parts.includes(from)) continue;
      db.prepare('UPDATE pages SET dept=? WHERE id=?').run([...new Set(parts.map(x => x === from ? to : x))].join(','), r.id);
    }
  }
  const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  app.get('/admin/structure', central, (req, res) => {
    const depts = db.prepare('SELECT id,name,faculty FROM departments ORDER BY faculty,name').all(), facs = [...new Set(depts.map(d => d.faculty))];
    const people = db.prepare("SELECT department n, COUNT(*) c FROM users WHERE department IS NOT NULL AND department!='' GROUP BY department").all();
    const pc = Object.fromEntries(people.map(r => [r.n, r.c]));
    const facList = `<datalist id="facList">${facs.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`;
    const deptHtml = facs.map(f => `<div class="card"><form method="post" action="/admin/structure/faculty/rename" class="row" style="gap:6px"><input type="hidden" name="from" value="${esc(f)}"><input name="to" value="${esc(f)}" maxlength="80" required style="flex:1"><button>Rename faculty</button></form>
${depts.filter(d => d.faculty === f).map(d => `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)"><form method="post" action="/admin/structure/department/${d.id}/save" class="row" style="gap:6px"><input name="name" value="${esc(d.name)}" maxlength="120" required style="flex:2;min-width:160px"><input name="faculty" list="facList" value="${esc(d.faculty)}" maxlength="80" required style="flex:1;min-width:130px" title="Faculty this department belongs to"><button>Save</button></form>
<span class="mut" style="font-size:12px">${pc[d.name] || 0} student${(pc[d.name] || 0) === 1 ? '' : 's'}</span> <form method="post" action="/admin/structure/department/${d.id}/delete" style="display:inline" onsubmit="return confirm('Remove this department from the list?')"><button class="link">Remove</button></form></div>`).join('')}</div>`).join('');
    const instRows = db.prepare('SELECT i.id,i.name,(SELECT COUNT(*) FROM users u WHERE u.university=i.name) c FROM institutions i ORDER BY i.name').all();
    const strays = db.prepare("SELECT university n, COUNT(*) c FROM users WHERE university IS NOT NULL AND university!='' AND university NOT IN (SELECT name FROM institutions) GROUP BY university ORDER BY university").all();
    const instHtml = instRows.map(i => `<div class="card"><form method="post" action="/admin/structure/institution/${i.id}/save" class="row" style="gap:6px"><input name="name" value="${esc(i.name)}" maxlength="120" required style="flex:1;min-width:200px"><button>Rename</button></form><span class="mut" style="font-size:12px">${i.c} member${i.c === 1 ? '' : 's'}</span> <form method="post" action="/admin/structure/institution/${i.id}/delete" style="display:inline" onsubmit="return confirm('Take this institution off the picker list? Existing members keep it.')"><button class="link">Remove from list</button></form></div>`).join('')
      + (strays.length ? `<p class="mut">Typed in by members and not on the list:</p>${strays.map(x => `<div class="card row"><span>${esc(x.n)} <span class="mut">(${x.c})</span></span><form method="post" action="/admin/structure/institution/add"><input type="hidden" name="name" value="${esc(x.n)}"><button class="link">Add to list</button></form></div>`).join('')}` : '');
    const courses = db.prepare('SELECT c.id,c.name,(SELECT COUNT(*) FROM lecturer_courses lc WHERE lc.course_id=c.id) l,(SELECT COUNT(*) FROM pages p WHERE p.course_id=c.id) p FROM courses c ORDER BY c.name').all();
    const courseHtml = courses.map(c => `<div class="card"><form method="post" action="/admin/structure/course/${c.id}/rename" class="row" style="gap:6px"><input name="name" value="${esc(c.name)}" maxlength="120" required style="flex:1;min-width:180px"><button>Rename</button></form>
<span class="mut" style="font-size:12px">${c.l} lecturer${c.l === 1 ? '' : 's'} &middot; ${c.p} upload${c.p === 1 ? '' : 's'}</span>
<div class="row" style="gap:6px;margin-top:6px"><form method="post" action="/admin/structure/course/${c.id}/merge" class="row" style="gap:6px"><select name="into" style="width:auto"><option value="">Move everything into&hellip;</option>${courses.filter(o => o.id !== c.id).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="link">Merge</button></form>
<form method="post" action="/admin/structure/course/${c.id}/delete" onsubmit="return confirm('Delete this course? Lecturers lose it from their list and its uploads become unfiled.')"><button class="link">Delete</button></form></div></div>`).join('');
    res.send(layout('Site structure', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Site structure</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}${facList}
<p class="mut" style="margin-top:0">Changing a name here changes it for everyone it is attached to.</p>
<details id="faculties" class="card" open><summary style="cursor:pointer;font-weight:600">Faculties &amp; departments (${depts.length})</summary>
<form class="card row" method="post" action="/admin/structure/department/add" style="gap:6px;margin-top:10px"><input name="name" placeholder="New department" required maxlength="120" style="flex:2;min-width:160px"><input name="faculty" list="facList" placeholder="Faculty" required maxlength="80" style="flex:1;min-width:130px"><button>Add</button></form>${deptHtml}</details>
<script>(function(){var h=location.hash.slice(1),d=h&&document.getElementById(h);if(d&&d.tagName==='DETAILS'){d.open=true;d.scrollIntoView()}})()</script>`, req.user));
  });
  app.post('/admin/structure/faculty/rename', central, (req, res) => {
    const from = clean(req.body.from, 80), to = clean(req.body.to, 80);
    if (!from || !to) return res.redirect(sback('Type the new faculty name.'));
    if (from !== to) renameValue(['faculty', 'scope_faculty'], from, to);
    res.redirect(sback(from === to ? 'No change.' : `Faculty renamed to ${to}.`, 'faculties'));
  });
  app.post('/admin/structure/department/add', central, (req, res) => {
    const name = clean(req.body.name, 120), faculty = clean(req.body.faculty, 80) || 'Other';
    if (!name) return res.redirect(sback('Type a department name.'));
    if (db.prepare('SELECT 1 FROM departments WHERE name=?').get(name)) return res.redirect(sback('That department already exists.', 'faculties'));
    db.prepare('INSERT INTO departments(name,faculty) VALUES(?,?)').run(name, faculty);
    res.redirect(sback(`Added ${name} under ${faculty}.`, 'faculties'));
  });
  app.post('/admin/structure/department/:id/save', central, (req, res) => {
    const d = db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id), name = clean(req.body.name, 120), faculty = clean(req.body.faculty, 80) || 'Other';
    if (!d || !name) return res.redirect(sback('Could not save that department.', 'faculties'));
    if (name !== d.name) {
      if (db.prepare('SELECT 1 FROM departments WHERE name=? AND id!=?').get(name, d.id)) return res.redirect(sback('Another department already has that name.', 'faculties'));
      db.prepare('UPDATE departments SET name=? WHERE id=?').run(name, d.id);
      renameValue(['department', 'scope_department'], d.name, name); renameInPageAudience(d.name, name);
    }
    if (faculty !== d.faculty) db.prepare('UPDATE departments SET faculty=? WHERE id=?').run(faculty, d.id);
    res.redirect(sback(`Saved ${name}${faculty !== d.faculty ? ` (now under ${faculty})` : ''}.`, 'faculties'));
  });
  app.post('/admin/structure/department/:id/delete', central, (req, res) => {
    const d = db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id);
    if (!d) return res.redirect(sback('Not found.', 'faculties'));
    const n = db.prepare('SELECT COUNT(*) n FROM users WHERE department=?').get(d.name).n;
    if (n) return res.redirect(sback(`${n} student${n === 1 ? ' is' : 's are'} in ${d.name}. Rename it or move it instead of removing it.`, 'faculties'));
    db.prepare('DELETE FROM departments WHERE id=?').run(d.id);
    res.redirect(sback(`Removed ${d.name}.`, 'faculties'));
  });
  app.post('/admin/structure/institution/add', central, (req, res) => {
    const name = clean(req.body.name, 120);
    if (!name || /^Other\b/i.test(name)) return res.redirect(sback('Type an institution name.', 'institutions'));
    db.prepare('INSERT OR IGNORE INTO institutions(name) VALUES(?)').run(name);
    res.redirect(sback(`Added ${name}.`, 'institutions'));
  });
  app.post('/admin/structure/institution/:id/save', central, (req, res) => {
    const i = db.prepare('SELECT * FROM institutions WHERE id=?').get(req.params.id), name = clean(req.body.name, 120);
    if (!i || !name) return res.redirect(sback('Could not save that institution.', 'institutions'));
    if (name !== i.name) {
      if (db.prepare('SELECT 1 FROM institutions WHERE name=? AND id!=?').get(name, i.id)) return res.redirect(sback('Another institution already has that name.', 'institutions'));
      db.prepare('UPDATE institutions SET name=? WHERE id=?').run(name, i.id); renameValue(['university'], i.name, name);
    }
    res.redirect(sback(`Saved ${name}.`, 'institutions'));
  });
  app.post('/admin/structure/institution/:id/delete', central, (req, res) => {
    db.prepare('DELETE FROM institutions WHERE id=?').run(req.params.id);
    res.redirect(sback('Removed from the picker list.', 'institutions'));
  });
  app.post('/admin/structure/course/add', central, (req, res) => {
    const name = clean(req.body.name, 120);
    if (!name) return res.redirect(sback('Type a course name.', 'courses'));
    db.prepare('INSERT OR IGNORE INTO courses(name) VALUES(?)').run(name);
    res.redirect(sback(`Added ${name}.`, 'courses'));
  });
  app.post('/admin/structure/course/:id/rename', central, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id), name = clean(req.body.name, 120);
    if (!c || !name) return res.redirect(sback('Could not save that course.', 'courses'));
    if (db.prepare('SELECT 1 FROM courses WHERE name=? AND id!=?').get(name, c.id)) return res.redirect(sback('Another course already has that name. Use Merge instead.', 'courses'));
    db.prepare('UPDATE courses SET name=? WHERE id=?').run(name, c.id);
    res.redirect(sback(`Saved ${name}.`, 'courses'));
  });
  app.post('/admin/structure/course/:id/delete', central, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
    if (!c) return res.redirect(sback('Not found.', 'courses'));
    db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id); db.prepare('UPDATE pages SET course_id=NULL WHERE course_id=?').run(c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
    res.redirect(sback(`Deleted ${c.name}.`, 'courses'));
  });
  app.post('/admin/structure/course/:id/merge', central, (req, res) => {
    const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id), to = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.body.into) || 0);
    if (!c || !to || c.id === to.id) return res.redirect(sback('Choose the course to move everything into.', 'courses'));
    db.prepare('UPDATE OR IGNORE lecturer_courses SET course_id=? WHERE course_id=?').run(to.id, c.id); db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id);
    db.prepare('UPDATE pages SET course_id=? WHERE course_id=?').run(to.id, c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
    res.redirect(sback(`${c.name} was merged into ${to.name}.`, 'courses'));
  });
  return { renameValue };
};
