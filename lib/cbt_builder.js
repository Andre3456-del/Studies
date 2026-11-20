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

  app.get('/lecturer/cbt/new', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/cbt/new');
    if (!lecturer(req.user)) return res.redirect('/lecturer');
    const courses = db.prepare('SELECT c.id, c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(req.user.id);
    res.send(layout('New CBT test', `<p class="mut"><a href="/lecturer/uploads">&larr; Uploaded documents</a></p><h1>Create a CBT test</h1>${req.query.msg ? `<p class="err">${esc(req.query.msg)}</p>` : ''}
<form class="card" method="post" action="/lecturer/cbt/new"><input name="title" placeholder="Name of the test" required maxlength="140">
<select name="course_id" required><option value="">Which course is this for?</option>${courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
<label class="mut">Which departments? (leave all unchecked for every department)</label>${departmentCheckboxes([])}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>${semesterField('')}
${T().settingsFields({ cbt_shuffle: 1 })}
<h3>Questions</h3>${editor([])}<button>Publish the test</button></form>`, req.user));
  });
  app.post('/lecturer/cbt/new', (req, res) => {
    if (!lecturer(req.user)) return res.sendStatus(403);
    const bad = m => res.redirect('/lecturer/cbt/new?msg=' + encodeURIComponent(m));
    const courseId = Number(req.body.course_id), owns = courseId && db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(req.user.id, courseId);
    if (!owns) return bad('Pick one of your own courses.');
    const title = String(req.body.title || '').trim().slice(0, 140); if (!title) return bad('Give the test a name.');
    const r = parseQs(req.body.qs); if (r.error) return bad(r.error + ' (your questions were not saved; please add them again)');
    const s = T().readSettings(req.body); if (s.error) return bad(s.error);
    const aud = readAudience(req.body, title), slug = uniqueSlug(slugify(title));
    db.prepare("INSERT INTO pages(slug,title,html,kind,dept,level,author_id,course_id,cbt_qs) VALUES(?,?,'','cbt',?,?,?,?,?)").run(slug, title, aud.dept, aud.level, req.user.id, courseId, JSON.stringify(r.qs));
    const id = db.prepare('SELECT id FROM pages WHERE slug=?').get(slug).id;
    T().saveSettings(id, s); applySemester({ slug }, req.body.semester);
    announceUpload({ title, slug, paid: 0, ...aud });
    res.redirect('/lecturer/uploads?msg=' + encodeURIComponent('Your test is published.'));
  });
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
