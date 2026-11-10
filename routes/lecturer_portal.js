// Lecturer portal (welcome, uploads, edit, courses)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { LEVELS, OTHER_UNI, announceUpload, applySemester, canLecturerAdmin, db, departmentCheckboxes, deptListOf, esc, institutionList, isImageUpload, layout, notifyLecturerAdmin, profileComplete, readAudience, semesterField, slugify, uniqueSlug, upload, videoMimeOf, youtubeId } = ctx;
  app.get('/lecturer/welcome', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/welcome');
    if (!req.user.is_lecturer) return res.redirect('/welcome');
    if (profileComplete(req.user)) return res.redirect('/lecturer');
    res.send(lecturerWelcomePage(req.user));
  });
  function lecturerWelcomePage(u, err = '') {
    const courses = db.prepare('SELECT id, name FROM courses ORDER BY name').all();
    const picked = db.prepare('SELECT course_id FROM lecturer_courses WHERE lecturer_id=?').all(u.id).map(r => r.course_id);
    const instList = institutionList(), uniKnown = u.university && instList.includes(u.university);
    return layout('Finish setting up', `<div class="auth"><h1>A few details</h1><p class="mut">This goes to a full admin to verify you're really on staff at the institution you name.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" class="card">
<input name="name" value="${esc(u.name || '')}" placeholder="Your name" required maxlength="80">
<select name="university" id="uniSelect" required>
<option value="">Institution you teach at&hellip;</option>
${instList.concat([OTHER_UNI]).map(n => `<option value="${esc(n)}"${u.university === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
</select>
<input name="university_other" id="uniOther" placeholder="Type your institution's name" maxlength="120" value="${!uniKnown ? esc(u.university || '') : ''}" style="${u.university && !uniKnown ? '' : 'display:none'}">
<script>(function(){var s=document.getElementById('uniSelect'),o=document.getElementById('uniOther');function sync(){var other=s.value==='Other (type it in below)';o.style.display=other?'':'none';o.required=other}s.addEventListener('change',sync);sync()})()</script>
<input name="reg_no" value="${esc(u.lecturer_reg_no || '')}" placeholder="Staff/registration number (optional)" maxlength="60">
<label class="mut">Which course(s) do you teach? (pick any that already exist -- you can pick more than one)</label>
<div style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0">${courses.map(c => `<label class="row" style="justify-content:flex-start;gap:8px;margin:4px 0;cursor:pointer"><input type="checkbox" name="course_id" value="${c.id}" style="width:auto"${picked.includes(c.id) ? ' checked' : ''}>${esc(c.name)}</label>`).join('') || '<p class="mut" style="margin:0">No courses listed yet -- add yours below.</p>'}</div>
<input name="new_course" placeholder="Course not listed? Type its name" maxlength="120">
<button>Submit for verification</button></form></div>`, u);
  }
  app.post('/lecturer/welcome', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/welcome');
    if (!req.user.is_lecturer) return res.redirect('/welcome');
    const name = String(req.body.name || '').trim().slice(0, 80);
    const uniChoice = String(req.body.university || '').trim();
    const university = (uniChoice === 'Other (type it in below)' ? String(req.body.university_other || '').trim() : uniChoice).slice(0, 120);
    const regNo = String(req.body.reg_no || '').trim().slice(0, 60) || null;
    const newCourseName = String(req.body.new_course || '').trim().slice(0, 120);
    const pickedIds = (Array.isArray(req.body.course_id) ? req.body.course_id : req.body.course_id ? [req.body.course_id] : []).map(Number).filter(Boolean);
    const fail = m => res.status(400).send(lecturerWelcomePage({ ...req.user, name, university, lecturer_reg_no: regNo }, m));
    if (!name || !university) return fail('Please fill in your name and institution.');
    let newCourseId = null;
    if (newCourseName) {
      const existing = db.prepare('SELECT id FROM courses WHERE name=?').get(newCourseName);
      newCourseId = existing ? existing.id : Number(db.prepare('INSERT INTO courses(name) VALUES(?)').run(newCourseName).lastInsertRowid);
    }
    const allCourseIds = [...new Set([...pickedIds, ...(newCourseId ? [newCourseId] : [])])];
    if (!allCourseIds.length) return fail('Pick at least one course, or add one that is not listed yet.');
    db.prepare('UPDATE users SET name=?, university=?, lecturer_reg_no=?, lecturer_status=? WHERE id=?').run(name, university, regNo, 'pending', req.user.id);
    db.prepare('DELETE FROM lecturer_courses WHERE lecturer_id=?').run(req.user.id);
    const ins = db.prepare('INSERT OR IGNORE INTO lecturer_courses(lecturer_id,course_id) VALUES(?,?)');
    allCourseIds.forEach(cid => ins.run(req.user.id, cid));
    const courseNames = db.prepare(`SELECT name FROM courses WHERE id IN (${allCourseIds.map(() => '?').join(',')})`).all(...allCourseIds).map(c => c.name).join(', ');
    notifyLecturerAdmin('Lecturer to verify', `${name} (${university}) -- ${courseNames}`, university);
    res.redirect('/lecturer');
  });
  app.get('/lecturer', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer');
    if (!req.user.is_lecturer) return res.redirect(canLecturerAdmin(req.user) ? '/lecturer/admin' : '/dashboard');
    if (!profileComplete(req.user)) return res.redirect('/lecturer/welcome');
    if (req.user.lecturer_status === 'pending') return res.send(layout('My courses', `<h1>My courses</h1><p class="pill pending">Waiting for a full admin to verify you teach at ${esc(req.user.university)}</p><p class="mut">You'll be able to upload once that's done.</p>`, req.user));
    if (req.user.lecturer_status === 'rejected') return res.send(layout('My courses', `<h1>My courses</h1><p class="err">This wasn't approved.</p><p class="mut"><a href="/lecturer/welcome">Edit your details and try again &rarr;</a></p>`, req.user));
    const myCourses = db.prepare('SELECT c.id, c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(req.user.id);
    const myPages = db.prepare("SELECT p.*, c.name AS course_name FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.author_id=? ORDER BY p.id DESC").all(req.user.id);
    const courseLinks = myCourses.map(c => `<a class="btn ghost" style="margin:4px 6px 0 0;display:inline-block" href="/lecturer/course/${c.id}">${esc(c.name)}</a>`).join('') || '<p class="mut">No courses linked to your account.</p>';
    const uploadForm = `<form class="card" id="upload" data-bgup method="post" action="/lecturer/upload" enctype="multipart/form-data"><h3>Upload for a course</h3>
<select name="course_id" required><option value="">Which course is this for?</option>${myCourses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
<select name="kind" id="lkindSelect"><option value="pdf">PDF document</option><option value="doc">Word document</option><option value="html">HTML page</option><option value="video">Video (YouTube link or from your phone)</option><option value="image">Image (JPG or PNG)</option></select>
<div id="lfileField"><input type="file" name="file" accept=".pdf" required></div>
<div id="lnameField" style="display:none"><input name="title" placeholder="Name of the image" maxlength="140"></div>
<div id="lvideoField" style="display:none"><input name="video_url" placeholder="https://youtube.com/watch?v=... (or choose a video from your phone above)"></div>
<label class="mut">Which departments is this for? (leave all unchecked for every department)</label>${departmentCheckboxes([])}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>
${semesterField('')}
<button>Publish -- goes live immediately</button></form>
<script>(function(){var k=document.getElementById('lkindSelect'),fi=document.querySelector('#lfileField input');var lv=document.getElementById('lvideoField'),nm=document.getElementById('lnameField');function sync(){var v=k.value==='video',im=k.value==='image';lv.style.display=v?'':'none';nm.style.display=im?'':'none';nm.querySelector('input').required=im;fi.required=!v;fi.accept=v?'video/*':im?'image/png,image/jpeg,.png,.jpg,.jpeg':k.value==='pdf'?'.pdf':k.value==='doc'?'.doc,.docx':'.html,.htm,text/html'}k.addEventListener('change',sync);sync()})()</script>`;
    const pagesList = myPages.map(p => {
      const [icon, label] = ctx.KIND_META[p.kind] || ctx.KIND_META.html;
      return `<div class="card row"><div><a href="/p/${p.slug}">${icon} ${esc(p.title)}</a><br><span class="mut">${esc(p.course_name || '')} &middot; ${label}</span></div>
<div class="row" style="gap:6px"><a href="/lecturer/pages/${p.id}/edit" class="link">Edit</a><form method="post" action="/lecturer/pages/${p.id}/delete" onsubmit="return confirm('Delete this upload?')"><button class="link">Delete</button></form></div></div>`;
    }).join('') || '<p class="mut">Nothing uploaded yet.</p>';
    const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const first = esc(String(req.user.name || '').replace(/^(dr|prof|mr|mrs|ms|engr)\.?\s+/i, '').split(' ')[0] || 'Lecturer');
    const recent = myPages.slice(0, 4).map(p => { const [icon, label] = ctx.KIND_META[p.kind] || ctx.KIND_META.html; return `<a class="lcc" href="/p/${p.slug}"><b>${icon} ${esc(p.title)}</b><span>${esc(p.course_name || '')} &middot; ${label}</span></a>`; }).join('') || '<p class="mut">Nothing uploaded yet. Tap "Upload a document" to start.</p>';
    res.send(layout('Home', `<style>.lhx{background:linear-gradient(135deg,var(--accent,#6d5efc),#22c1c3);color:#fff;border-radius:20px;padding:22px 20px;margin:4px 0 16px}.lhx h1{margin:0 0 4px;font-size:24px;color:#fff}.lhx p{margin:0;opacity:.9}.lst{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}.lst div{background:var(--card,rgba(127,127,127,.12));border-radius:16px;padding:14px 8px;text-align:center}.lst b{display:block;font-size:24px}.lst span{font-size:12px;opacity:.7}.lqa{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}.lqa a{display:block;text-decoration:none;color:inherit;background:var(--card,rgba(127,127,127,.12));border-radius:16px;padding:16px 14px;font-weight:600}.lqa a small{display:block;font-weight:400;opacity:.7;margin-top:4px}.lcc{display:block;text-decoration:none;color:inherit;background:var(--card,rgba(127,127,127,.12));border-radius:16px;padding:16px;margin-bottom:10px}.lcc b{display:block}.lcc span{font-size:13px;opacity:.7}</style><div class="lhx"><h1>${greet}, ${first} 👋</h1><p>${esc(req.user.university)}</p></div>
${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
<div class="lst"><div><b>${myCourses.length}</b><span>Courses</span></div><div><b>${myPages.length}</b><span>Uploads</span></div><div><b>${myPages.filter(p => p.kind === 'video').length}</b><span>Videos</span></div></div>
<div class="lqa"><a href="/lecturer/uploads#upload">⬆️ Upload a document<small>Share with your students</small></a><a href="/lecturer/course">📚 My courses<small>See what others posted</small></a></div>
<h3>Recently uploaded</h3>${recent}`, req.user));
  });
  app.get('/lecturer/course', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer');
    if (!req.user.is_lecturer) return res.redirect(canLecturerAdmin(req.user) ? '/lecturer/admin' : '/dashboard');
    if (!profileComplete(req.user)) return res.redirect('/lecturer/welcome');
    if (req.user.lecturer_status === 'pending') return res.send(layout('My courses', `<h1>My courses</h1><p class="pill pending">Waiting for a full admin to verify you teach at ${esc(req.user.university)}</p><p class="mut">You'll be able to upload once that's done.</p>`, req.user));
    if (req.user.lecturer_status === 'rejected') return res.send(layout('My courses', `<h1>My courses</h1><p class="err">This wasn't approved.</p><p class="mut"><a href="/lecturer/welcome">Edit your details and try again &rarr;</a></p>`, req.user));
    const myCourses = db.prepare('SELECT c.id, c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(req.user.id);
    const myPages = db.prepare("SELECT p.*, c.name AS course_name FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.author_id=? ORDER BY p.id DESC").all(req.user.id);
    const courseLinks = myCourses.map(c => `<a class="btn ghost" style="margin:4px 6px 0 0;display:inline-block" href="/lecturer/course/${c.id}">${esc(c.name)}</a>`).join('') || '<p class="mut">No courses linked to your account.</p>';
    const uploadForm = `<form class="card" id="upload" data-bgup method="post" action="/lecturer/upload" enctype="multipart/form-data"><h3>Upload for a course</h3>
<select name="course_id" required><option value="">Which course is this for?</option>${myCourses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
<select name="kind" id="lkindSelect"><option value="pdf">PDF document</option><option value="doc">Word document</option><option value="html">HTML page</option><option value="video">Video (YouTube link or from your phone)</option><option value="image">Image (JPG or PNG)</option></select>
<div id="lfileField"><input type="file" name="file" accept=".pdf" required></div>
<div id="lnameField" style="display:none"><input name="title" placeholder="Name of the image" maxlength="140"></div>
<div id="lvideoField" style="display:none"><input name="video_url" placeholder="https://youtube.com/watch?v=... (or choose a video from your phone above)"></div>
<label class="mut">Which departments is this for? (leave all unchecked for every department)</label>${departmentCheckboxes([])}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>
${semesterField('')}
<button>Publish -- goes live immediately</button></form>
<script>(function(){var k=document.getElementById('lkindSelect'),fi=document.querySelector('#lfileField input');var lv=document.getElementById('lvideoField'),nm=document.getElementById('lnameField');function sync(){var v=k.value==='video',im=k.value==='image';lv.style.display=v?'':'none';nm.style.display=im?'':'none';nm.querySelector('input').required=im;fi.required=!v;fi.accept=v?'video/*':im?'image/png,image/jpeg,.png,.jpg,.jpeg':k.value==='pdf'?'.pdf':k.value==='doc'?'.doc,.docx':'.html,.htm,text/html'}k.addEventListener('change',sync);sync()})()</script>`;
    const pagesList = myPages.map(p => {
      const [icon, label] = ctx.KIND_META[p.kind] || ctx.KIND_META.html;
      return `<div class="card row"><div><a href="/p/${p.slug}">${icon} ${esc(p.title)}</a><br><span class="mut">${esc(p.course_name || '')} &middot; ${label}</span></div>
<div class="row" style="gap:6px"><a href="/lecturer/pages/${p.id}/edit" class="link">Edit</a><form method="post" action="/lecturer/pages/${p.id}/delete" onsubmit="return confirm('Delete this upload?')"><button class="link">Delete</button></form></div></div>`;
    }).join('') || '<p class="mut">Nothing uploaded yet.</p>';
    const counts = {};
    db.prepare('SELECT course_id, COUNT(*) n FROM pages WHERE author_id=? GROUP BY course_id').all(req.user.id).forEach(r => counts[r.course_id] = r.n);
    const cards = myCourses.map(c => `<a class="lcc" href="/lecturer/course/${c.id}"><b>📚 ${esc(c.name)}</b><span>${counts[c.id] || 0} uploaded by you</span></a>`).join('') || '<p class="mut">No courses linked to your account.</p>';
    res.send(layout('Courses', `<style>.lhx{background:linear-gradient(135deg,var(--accent,#6d5efc),#22c1c3);color:#fff;border-radius:20px;padding:22px 20px;margin:4px 0 16px}.lhx h1{margin:0 0 4px;font-size:24px;color:#fff}.lhx p{margin:0;opacity:.9}.lst{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}.lst div{background:var(--card,rgba(127,127,127,.12));border-radius:16px;padding:14px 8px;text-align:center}.lst b{display:block;font-size:24px}.lst span{font-size:12px;opacity:.7}.lqa{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}.lqa a{display:block;text-decoration:none;color:inherit;background:var(--card,rgba(127,127,127,.12));border-radius:16px;padding:16px 14px;font-weight:600}.lqa a small{display:block;font-weight:400;opacity:.7;margin-top:4px}.lcc{display:block;text-decoration:none;color:inherit;background:var(--card,rgba(127,127,127,.12));border-radius:16px;padding:16px;margin-bottom:10px}.lcc b{display:block}.lcc span{font-size:13px;opacity:.7}</style><h1>Courses</h1>${cards}`, req.user));
  });
  app.get('/lecturer/uploads', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer');
    if (!req.user.is_lecturer) return res.redirect(canLecturerAdmin(req.user) ? '/lecturer/admin' : '/dashboard');
    if (!profileComplete(req.user)) return res.redirect('/lecturer/welcome');
    if (req.user.lecturer_status === 'pending') return res.send(layout('My courses', `<h1>My courses</h1><p class="pill pending">Waiting for a full admin to verify you teach at ${esc(req.user.university)}</p><p class="mut">You'll be able to upload once that's done.</p>`, req.user));
    if (req.user.lecturer_status === 'rejected') return res.send(layout('My courses', `<h1>My courses</h1><p class="err">This wasn't approved.</p><p class="mut"><a href="/lecturer/welcome">Edit your details and try again &rarr;</a></p>`, req.user));
    const myCourses = db.prepare('SELECT c.id, c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(req.user.id);
    const myPages = db.prepare("SELECT p.*, c.name AS course_name FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.author_id=? ORDER BY p.id DESC").all(req.user.id);
    const _unused = myCourses.map(c => `<a class="btn ghost" style="margin:4px 6px 0 0;display:inline-block" href="/lecturer/course/${c.id}">${esc(c.name)}</a>`).join('') || '<p class="mut">No courses linked to your account.</p>';
    const uploadForm = `<form class="card" id="upload" data-bgup method="post" action="/lecturer/upload" enctype="multipart/form-data"><h3>Upload for a course</h3>
<select name="course_id" required><option value="">Which course is this for?</option>${myCourses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
<select name="kind" id="lkindSelect"><option value="pdf">PDF document</option><option value="doc">Word document</option><option value="html">HTML page</option><option value="video">Video (YouTube link or from your phone)</option><option value="image">Image (JPG or PNG)</option></select>
<div id="lfileField"><input type="file" name="file" accept=".pdf" required></div>
<div id="lnameField" style="display:none"><input name="title" placeholder="Name of the image" maxlength="140"></div>
<div id="lvideoField" style="display:none"><input name="video_url" placeholder="https://youtube.com/watch?v=... (or choose a video from your phone above)"></div>
<label class="mut">Which departments is this for? (leave all unchecked for every department)</label>${departmentCheckboxes([])}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>
${semesterField('')}
<button>Publish -- goes live immediately</button></form>
<script>(function(){var k=document.getElementById('lkindSelect'),fi=document.querySelector('#lfileField input');var lv=document.getElementById('lvideoField'),nm=document.getElementById('lnameField');function sync(){var v=k.value==='video',im=k.value==='image';lv.style.display=v?'':'none';nm.style.display=im?'':'none';nm.querySelector('input').required=im;fi.required=!v;fi.accept=v?'video/*':im?'image/png,image/jpeg,.png,.jpg,.jpeg':k.value==='pdf'?'.pdf':k.value==='doc'?'.doc,.docx':'.html,.htm,text/html'}k.addEventListener('change',sync);sync()})()</script>`;
    const pagesList = myPages.map(p => {
      const [icon, label] = ctx.KIND_META[p.kind] || ctx.KIND_META.html;
      return `<div class="card row"><div><a href="/p/${p.slug}">${icon} ${esc(p.title)}</a><br><span class="mut">${esc(p.course_name || '')} &middot; ${label}</span></div>
<div class="row" style="gap:6px"><a href="/lecturer/pages/${p.id}/edit" class="link">Edit</a><form method="post" action="/lecturer/pages/${p.id}/delete" onsubmit="return confirm('Delete this upload?')"><button class="link">Delete</button></form></div></div>`;
    }).join('') || '<p class="mut">Nothing uploaded yet.</p>';
    res.send(layout('Uploaded documents', `<h1>Uploaded documents</h1>
${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
${uploadForm}<h3>Your uploads (${myPages.length})</h3><div id="upList">${pagesList}</div>`, req.user));
  });
  app.post('/lecturer/upload', upload.single('file'), (req, res) => {
    if (!req.user || !req.user.is_lecturer) return res.sendStatus(403);
    if (req.user.lecturer_status !== 'approved') return res.sendStatus(403);
    const courseId = Number(req.body.course_id);
    const owns = courseId && db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(req.user.id, courseId);
    if (!owns) return res.redirect(ctx.back('Pick one of your own courses.'));
    const kind = ['pdf', 'doc', 'html', 'video', 'image'].includes(req.body.kind) ? req.body.kind : 'pdf';
    const title = (req.body.title || '').trim();
    const vid = kind === 'video' ? youtubeId(req.body.video_url) : null;
    if (kind === 'video' && !vid && !req.file) return res.redirect(ctx.back('Paste a YouTube link, or choose a video from your phone.'));
    if (!req.file && !vid) return res.redirect(ctx.back('Choose a file first.'));
    const vmime = kind === 'video' && !vid ? videoMimeOf(req.file) : null;
    if (kind === 'video' && !vid && !vmime) return res.redirect(ctx.back('That file is not a video.'));
    if (kind === 'image' && !isImageUpload(req.file)) return res.redirect(ctx.back('Choose a JPG or PNG picture.'));
    const base = req.file ? req.file.originalname.replace(/\.[a-z0-9]+$/i, '') : 'Video';
    const slug = uniqueSlug(slugify(base)), aud = readAudience(req.body, title || base);
    if (kind === 'video') {
      if (vid) db.prepare('INSERT INTO pages(slug,title,html,kind,video_id,dept,level,author_id,course_id) VALUES(?,?,?,?,?,?,?,?,?)').run(slug, title || base, '', 'video', vid, aud.dept, aud.level, req.user.id, courseId);
      else db.prepare('INSERT INTO pages(slug,title,html,kind,file_data,file_mime,file_name,dept,level,author_id,course_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(slug, title || base, '', 'video', req.file.buffer, vmime, req.file.originalname, aud.dept, aud.level, req.user.id, courseId);
    } else if (kind === 'pdf' || kind === 'doc' || kind === 'image') {
      db.prepare('INSERT INTO pages(slug,title,html,kind,file_data,file_mime,file_name,dept,level,author_id,course_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(slug, title || base, '', kind, req.file.buffer, req.file.mimetype, req.file.originalname, aud.dept, aud.level, req.user.id, courseId);
    } else {
      db.prepare('INSERT INTO pages(slug,title,html,kind,dept,level,author_id,course_id) VALUES(?,?,?,?,?,?,?,?)')
        .run(slug, title || base, req.file.buffer.toString('utf8'), kind, aud.dept, aud.level, req.user.id, courseId);
    }
    applySemester({ slug }, req.body.semester);
    announceUpload({ title: title || base, slug, paid: 0, ...aud });
    res.redirect('/lecturer/uploads?msg=' + encodeURIComponent(`Published at /p/${slug}`));
  });
  app.get('/lecturer/pages/:id/edit', (req, res) => {
    if (!req.user || !req.user.is_lecturer) return res.redirect('/login');
    const p = db.prepare('SELECT * FROM pages WHERE id=? AND author_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).send(layout('Not found', '<p><a href="/lecturer/uploads">Back</a></p>', req.user));
    res.send(layout('Edit upload', `<p class="mut"><a href="/lecturer/uploads">&larr; Back</a></p><h1 style="font-size:24px">${esc(p.title)}</h1>
<form class="card" method="post" action="/lecturer/pages/${p.id}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(p.title)}" required maxlength="140">
<label class="mut">Replace the file (optional -- leave blank to keep the current one)</label>
<input type="file" name="file" accept="${p.kind === 'pdf' ? '.pdf' : p.kind === 'doc' ? '.doc,.docx' : p.kind === 'video' ? 'video/*' : p.kind === 'image' ? 'image/png,image/jpeg' : '.html,.htm'}">
${p.kind === 'video' ? '<label class="mut">Or use a YouTube link instead</label><input name="video_url" placeholder="https://youtube.com/watch?v=...">' : ''}
<label class="mut">Which departments? (leave all unchecked for every department)</label>${departmentCheckboxes(deptListOf(p))}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}"${Number(p.level) === l ? ' selected' : ''}>${l} level only</option>`).join('')}</select>
${semesterField(p.semester)}
<button>Save changes</button></form>`, req.user));
  });
  app.post('/lecturer/pages/:id/edit', upload.single('file'), (req, res) => {
    if (!req.user || !req.user.is_lecturer) return res.redirect('/login');
    const p = db.prepare('SELECT * FROM pages WHERE id=? AND author_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).send(layout('Not found', '<p><a href="/lecturer/uploads">Back</a></p>', req.user));
    const title = (req.body.title || '').trim() || p.title;
    const aud = readAudience(req.body, title);
    const newLink = p.kind === 'video' && !req.file ? youtubeId(req.body.video_url) : null;
    if (p.kind === 'video' && req.file && !videoMimeOf(req.file)) return res.redirect(ctx.back('That file is not a video.'));
    if (newLink) {
      db.prepare("UPDATE pages SET title=?, video_id=?, file_data=NULL, file_mime=NULL, file_name=NULL, dept=?, level=? WHERE id=?").run(title, newLink, aud.dept, aud.level, p.id);
    } else if (req.file) {
      if (p.kind === 'video') db.prepare('UPDATE pages SET title=?, file_data=?, file_mime=?, file_name=?, video_id=NULL, dept=?, level=? WHERE id=?').run(title, req.file.buffer, videoMimeOf(req.file), req.file.originalname, aud.dept, aud.level, p.id);
      else if (p.kind === 'pdf' || p.kind === 'doc' || p.kind === 'image') db.prepare('UPDATE pages SET title=?, file_data=?, file_mime=?, file_name=?, dept=?, level=? WHERE id=?').run(title, req.file.buffer, req.file.mimetype, req.file.originalname, aud.dept, aud.level, p.id);
      else db.prepare('UPDATE pages SET title=?, html=?, dept=?, level=? WHERE id=?').run(title, req.file.buffer.toString('utf8'), aud.dept, aud.level, p.id);
    } else {
      db.prepare('UPDATE pages SET title=?, dept=?, level=? WHERE id=?').run(title, aud.dept, aud.level, p.id);
    }
    applySemester({ id: p.id }, req.body.semester);
    res.redirect('/lecturer/uploads?msg=' + encodeURIComponent('Saved.'));
  });
  app.post('/lecturer/pages/:id/delete', (req, res) => {
    if (!req.user || !req.user.is_lecturer) return res.redirect('/login');
    const p = db.prepare('SELECT id FROM pages WHERE id=? AND author_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).send(layout('Not found', '<p><a href="/lecturer">Back</a></p>', req.user));
    db.prepare('DELETE FROM pages WHERE id=?').run(p.id);
    res.redirect('/lecturer/uploads?msg=' + encodeURIComponent('Deleted.'));
  });
  // Browse a course's uploads folder-style: university, then lecturer, then their files -- so one lecturer
  // never has to wade through a long flat list to find a colleague's (or another institution's) material.
  app.get('/lecturer/course/:id', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
    if (!course) return res.status(404).send(layout('Not found', '<p><a href="/lecturer">Back</a></p>', req.user));
    // What lecturers post to a course is for the lecturers who teach that same course (verified ones) and nobody else -- not students, and not admins
    // (the central admin is a student unless he registers as a lecturer). Students reach lecturer material through the normal pages meant for them.
    const owns = req.user.is_lecturer && req.user.lecturer_status === 'approved' && db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(req.user.id, course.id);
    if (!owns) return res.status(404).send(layout('Not found', `<p><a href="${req.user.is_lecturer ? '/lecturer' : '/dashboard'}">Back</a></p>`, req.user));
    const rows = db.prepare(`SELECT p.*, u.name AS author_name, u.university AS author_university FROM pages p JOIN users u ON u.id=p.author_id WHERE p.course_id=? ORDER BY u.university, u.name, p.id DESC`).all(course.id);
    const byUni = {};
    rows.forEach(r => { (byUni[r.author_university] = byUni[r.author_university] || {})[r.author_name] = (byUni[r.author_university][r.author_name] || []).concat(r); });
    const html = Object.keys(byUni).sort().map(uni => `<details class="card"><summary style="cursor:pointer;font-weight:600">${esc(uni)}</summary>
${Object.keys(byUni[uni]).sort().map(name => `<details style="margin:8px 0 0 10px"><summary style="cursor:pointer">${esc(name)}</summary>
${byUni[uni][name].map(p => { const [icon, label] = ctx.KIND_META[p.kind] || ctx.KIND_META.html; return `<p style="margin:6px 0 6px 14px"><a href="/p/${p.slug}">${icon} ${esc(p.title)}</a> <span class="mut">${label}</span></p>`; }).join('')}
</details>`).join('')}
</details>`).join('') || '<p class="mut">No uploads for this course yet.</p>';
    res.send(layout(course.name, `<p class="mut"><a href="/lecturer">&larr; Back</a></p><h1>${esc(course.name)}</h1>${html}`, req.user));
  });
};
