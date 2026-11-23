'use strict';
// Lecturers type their own CBT questions here: question, options, the correct option. The result is a normal CBT page (kind "cbt")
// that runs through lib/cbt_test.js (shuffle, practice or test, results, emails).
module.exports = function register(app, ctx) {
  const { db, esc, layout, LEVELS, departmentCheckboxes, readAudience, semesterField, applySemester, uniqueSlug, slugify, announceUpload } = ctx;
  const T = () => require('./cbt_test').api;
  const lecturer = u => u && u.is_lecturer && u.lecturer_status === 'approved';

  // Reads and checks the typed questions (a JSON list from the form).
  function parseQs(raw) {
    let a; try { a = JSON.parse(String(raw || '[]')); } catch (e) { return { error: 'The questions could not be read. Please try again.' }; }
    if (!Array.isArray(a) || !a.length) return { error: 'Add at least one question.' };
    if (a.length > 300) return { error: 'A test can have at most 300 questions.' };
    const out = [];
    for (let i = 0; i < a.length; i++) {
      const q = String((a[i] && a[i].q) || '').trim().slice(0, 1000);
      const o = (Array.isArray(a[i] && a[i].o) ? a[i].o : []).map(x => String(x || '').trim().slice(0, 300));
      const keep = []; let ans = -1;
      o.forEach((t, k) => { if (t) { if (k === a[i].a) ans = keep.length; keep.push(t); } });
      if (!q) return { error: `Question ${i + 1} has no text.` };
      if (keep.length < 2) return { error: `Question ${i + 1} needs at least two options.` };
      if (keep.length > 6) return { error: `Question ${i + 1} has more than 6 options.` };
      if (ans < 0) return { error: `Question ${i + 1}: choose the correct option.` };
      out.push({ q, o: keep, a: ans });
    }
    return { qs: out };
  }

  // The question editor (shared by "new test" and "edit questions").
  const editor = init => `<div id="qb"></div><button type="button" id="addq" class="ghost">+ Add a question</button><input type="hidden" name="qs" id="qsj">
<script>(function(){var init=${JSON.stringify(init).replace(/</g, '\\u003c')},box=document.getElementById('qb');
function opt(d,qi,text,ck){var r=document.createElement('div');r.style.cssText='display:flex;gap:8px;align-items:center;margin:4px 0';var rd=document.createElement('input');rd.type='radio';rd.name='c'+qi;rd.checked=!!ck;rd.title='Correct answer';rd.style.cssText='width:auto;flex:none';var t=document.createElement('input');t.type='text';t.value=text||'';t.placeholder='Option';t.maxLength=300;r.appendChild(rd);r.appendChild(t);d.querySelector('.ops').appendChild(r)}
var n=0;function add(q){var qi=n++,d=document.createElement('div');d.className='card';d.innerHTML='<b class="qn"></b> <button type="button" class="link rm" style="float:right">Remove</button><textarea rows="2" maxlength="1000" placeholder="Type the question" style="width:100%"></textarea><div class="ops"></div><button type="button" class="link ao">+ option</button><p class="mut" style="font-size:12px;margin:4px 0 0">Tick the circle beside the correct option.</p>';
 d.querySelector('textarea').value=q?q.q:'';var os=q?q.o:['','','',''];os.forEach(function(t,k){opt(d,qi,t,q&&q.a===k)});
 d.querySelector('.ao').onclick=function(){if(d.querySelectorAll('.ops input[type=text]').length<6)opt(d,qi,'',false)};d.querySelector('.rm').onclick=function(){d.remove();num()};box.appendChild(d);num()}
function num(){[].forEach.call(box.children,function(d,i){d.querySelector('.qn').textContent='Question '+(i+1)})}
document.getElementById('addq').onclick=function(){add()};(init.length?init:[null]).forEach(add);
var f=document.getElementById('qb').closest('form');f.addEventListener('submit',function(){var out=[];[].forEach.call(box.children,function(d){var o=[],a=-1;[].forEach.call(d.querySelectorAll('.ops > div'),function(r,k){o.push(r.querySelector('input[type=text]').value);if(r.querySelector('input[type=radio]').checked)a=k});out.push({q:d.querySelector('textarea').value,o:o,a:a})});document.getElementById('qsj').value=JSON.stringify(out)})})()</script>`;

  // ---- The lecturer's CBT box: tests are kept here (Save) and sent to students when ready (Upload). A sent test can still be edited here. ----
  db.exec('CREATE TABLE IF NOT EXISTS cbt_library(id INTEGER PRIMARY KEY AUTOINCREMENT, lecturer_id INTEGER NOT NULL, title TEXT, course_id INTEGER, qs TEXT, form TEXT, page_id INTEGER, updated_at INTEGER)');
  const mine = (u, id) => db.prepare('SELECT * FROM cbt_library WHERE id=? AND lecturer_id=?').get(Number(id), u.id);
  const jparse = (x, d) => { try { return JSON.parse(x) || d; } catch (e) { return d; } };
  const liveOf = l => l.page_id ? db.prepare("SELECT * FROM pages WHERE id=? AND kind='cbt' AND author_id=?").get(l.page_id, l.lecturer_id) : null;
  const myCourses = u => db.prepare('SELECT c.id, c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(u.id);
  const form = (u, l, msg) => {
    const f = l ? jparse(l.form, {}) : Object.assign({}, require('./upload_prefs').get(db, u), { s: undefined }), live = l && liveOf(l), courses = myCourses(u);
    return `<p class="mut"><a href="/lecturer/cbt">&larr; CBT</a></p><h1>${l ? 'Edit test' : 'New test'}</h1>${msg ? `<p class="err">${esc(msg)}</p>` : ''}
<form class="card" method="post" action="${l ? '/lecturer/cbt/' + l.id : '/lecturer/cbt/new'}"><input name="title" placeholder="Name of the test" required maxlength="140" value="${esc(l ? l.title : '')}">
<select name="course_id" required><option value="">Which course is this for?</option>${courses.map(c => `<option value="${c.id}"${l && l.course_id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
<details><summary>Departments</summary>${departmentCheckboxes([].concat(f.dept || []))}</details>
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(x => `<option value="${x}"${String(f.level) === String(x) ? ' selected' : ''}>${x} level only</option>`).join('')}</select>${semesterField(f.semester || '')}
${T().settingsFields(f.s || { cbt_shuffle: 1 })}
<h3>Questions</h3>${editor(l ? jparse(l.qs, []) : [])}
<div class="row" style="gap:8px;margin-top:10px"><button name="act" value="save" class="ghost">Save</button><button name="act" value="upload">${live ? 'Update' : 'Upload'}</button></div></form>
${l ? `<form method="post" action="/lecturer/cbt/${l.id}/delete" onsubmit="return confirm('${live ? 'Delete this test and everything students did on it?' : 'Delete this test?'}')"><button class="link">Delete</button></form>` : ''}`;
  };
  app.get('/lecturer/cbt', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/cbt');
    if (!lecturer(req.user)) return res.redirect('/lecturer');
    const rows = db.prepare('SELECT l.*, c.name course FROM cbt_library l LEFT JOIN courses c ON c.id=l.course_id WHERE l.lecturer_id=? ORDER BY l.updated_at DESC').all(req.user.id);
    res.send(layout('CBT', `<p class="mut"><a href="/lecturer">&larr; Home</a></p><h1>CBT</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}<p><a class="btn" href="/lecturer/cbt/new">+ New test</a></p>
${rows.map(l => { const live = liveOf(l); return `<div class="card"><a href="/lecturer/cbt/${l.id}"><b>${esc(l.title)}</b></a><br><span class="mut">${esc(l.course || '')} &middot; ${jparse(l.qs, []).length} questions &middot; ${live ? 'Sent' : 'Saved'}</span>${live ? `<div class="row" style="gap:12px;margin-top:6px"><a href="/admin/pages/${live.id}/results">Results</a><a href="/cbt/${live.id}/settings">Settings</a></div>` : ''}</div>`; }).join('') || '<p class="mut">No tests yet.</p>'}`, req.user));
  });
  app.get('/lecturer/cbt/new', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/cbt/new');
    if (!lecturer(req.user)) return res.redirect('/lecturer');
    res.send(layout('New test', form(req.user, null, req.query.msg), req.user));
  });
  app.get('/lecturer/cbt/:id', (req, res) => {
    if (!req.user || !lecturer(req.user)) return res.redirect('/login?next=/lecturer/cbt');
    const l = mine(req.user, req.params.id); if (!l) return res.redirect('/lecturer/cbt');
    res.send(layout('Edit test', form(req.user, l, req.query.msg), req.user));
  });
  const store = (req, res, lid) => {
    if (!lecturer(req.user)) return res.sendStatus(403);
    const l = lid ? mine(req.user, lid) : null; if (lid && !l) return res.sendStatus(404);
    const bad = m => res.redirect((l ? '/lecturer/cbt/' + l.id : '/lecturer/cbt/new') + '?msg=' + encodeURIComponent(m));
    const courseId = Number(req.body.course_id), owns = courseId && db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(req.user.id, courseId);
    if (!owns) return bad('Pick one of your own courses.');
    const title = String(req.body.title || '').trim().slice(0, 140); if (!title) return bad('Give the test a name.');
    const r = parseQs(req.body.qs); if (r.error) return bad(r.error);
    const s = T().readSettings(req.body); if (s.error) return bad(s.error);
    const aud = readAudience(req.body, title); require('./upload_prefs').save(db, req.user, req.body);
    const f = JSON.stringify({ dept: [].concat(req.body.dept || []), level: req.body.level, semester: req.body.semester, s: { cbt_mode: s.mode, cbt_minutes: s.mins, cbt_open: s.open, cbt_close: s.close, cbt_shuffle: s.shuffle } }), now = Date.now();
    let id = l && l.id;
    if (l) db.prepare('UPDATE cbt_library SET title=?, course_id=?, qs=?, form=?, updated_at=? WHERE id=?').run(title, courseId, JSON.stringify(r.qs), f, now, l.id);
    else id = db.prepare('INSERT INTO cbt_library(lecturer_id,title,course_id,qs,form,updated_at) VALUES(?,?,?,?,?,?)').run(req.user.id, title, courseId, JSON.stringify(r.qs), f, now).lastInsertRowid;
    if (req.body.act !== 'upload') return res.redirect('/lecturer/cbt?msg=' + encodeURIComponent('Saved.'));
    const live = l && liveOf(l);
    if (live) {
      db.prepare('UPDATE pages SET title=?, dept=?, level=?, course_id=?, cbt_qs=? WHERE id=?').run(title, aud.dept, aud.level, courseId, JSON.stringify(r.qs), live.id);
      T().saveSettings(live.id, s); applySemester({ id: live.id }, req.body.semester);
      return res.redirect('/lecturer/cbt?msg=' + encodeURIComponent('Updated.'));
    }
    const slug = uniqueSlug(slugify(title));
    db.prepare("INSERT INTO pages(slug,title,html,kind,dept,level,author_id,course_id,cbt_qs) VALUES(?,?,'','cbt',?,?,?,?,?)").run(slug, title, aud.dept, aud.level, req.user.id, courseId, JSON.stringify(r.qs));
    const pid = db.prepare('SELECT id FROM pages WHERE slug=?').get(slug).id;
    T().saveSettings(pid, s); applySemester({ slug }, req.body.semester);
    db.prepare('UPDATE cbt_library SET page_id=? WHERE id=?').run(pid, id);
    announceUpload({ title, slug, paid: 0, ...aud });
    res.redirect('/lecturer/cbt?msg=' + encodeURIComponent('Sent to students.'));
  };
  app.post('/lecturer/cbt/new', (req, res) => store(req, res, null));
  app.post('/lecturer/cbt/:id/delete', (req, res) => {
    const l = req.user && lecturer(req.user) && mine(req.user, req.params.id); if (!l) return res.sendStatus(403);
    if (l.page_id) db.prepare("DELETE FROM pages WHERE id=? AND kind='cbt' AND author_id=?").run(l.page_id, req.user.id);
    db.prepare('DELETE FROM cbt_library WHERE id=?').run(l.id);
    res.redirect('/lecturer/cbt?msg=' + encodeURIComponent('Deleted.'));
  });
  app.post('/lecturer/cbt/:id', (req, res) => store(req, res, req.params.id));
  // Change the questions of a typed test (the lecturer who made it, or the owner).
  app.get('/cbt/:id/questions', (req, res) => {
    const p = req.user && db.prepare("SELECT * FROM pages WHERE id=? AND kind='cbt'").get(Number(req.params.id));
    if (!p || !T().ownsTest(req.user, p) || !T().questionsOf(p).length) return res.sendStatus(403);
    res.send(layout('Edit questions', `<p class="mut"><a href="/cbt/${p.id}/settings">&larr; Settings</a></p><h1 style="font-size:24px">${esc(p.title)}</h1>${req.query.msg ? `<p class="err">${esc(req.query.msg)}</p>` : ''}
<p class="mut">Changing questions does not change results already recorded.</p><form class="card" method="post" action="/cbt/${p.id}/questions">${editor(T().questionsOf(p))}<button>Save questions</button></form>`, req.user));
  });
  app.post('/cbt/:id/questions', (req, res) => {
    const p = req.user && db.prepare("SELECT * FROM pages WHERE id=? AND kind='cbt'").get(Number(req.params.id));
    if (!p || !T().ownsTest(req.user, p) || !T().questionsOf(p).length) return res.sendStatus(403);
    const r = parseQs(req.body.qs); if (r.error) return res.redirect(`/cbt/${p.id}/questions?msg=` + encodeURIComponent(r.error));
    db.prepare('UPDATE pages SET cbt_qs=? WHERE id=?').run(JSON.stringify(r.qs), p.id);
    res.redirect(`/cbt/${p.id}/settings?msg=` + encodeURIComponent('Questions saved.'));
  });
  module.exports.parseQs = parseQs;
};
