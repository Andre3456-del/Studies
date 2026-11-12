// Admin: upload a page or file, and reorder pages
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { LEVELS, NOT_YOURS, PRICE_KOBO, announceUpload, applySemester, back, can, db, departmentCheckboxes, deptListOf, esc, isImageUpload, layout, ownsAdminPage, pagesAdmin, readAudience, semesterField, slugify, uniqueSlug, upload, videoMimeOf, youtubeId } = ctx;
  app.post('/admin/upload', pagesAdmin, upload.single('file'), (req, res) => {
    const kind = ['html', 'cbt', 'pdf', 'doc', 'video', 'image'].includes(req.body.kind) ? req.body.kind : 'html';
    if (kind !== 'html' && !can.allKinds(req.user)) return res.sendStatus(403);
    const paid = can.full(req.user) && kind === 'cbt' && req.body.visibility === 'paid' ? 1 : 0; // only CBT can be pay-to-view
    const membersOnly = req.body.members_only ? 1 : 0;
    const title = (req.body.title || '').trim();

    if (kind === 'video') {
      const vid = youtubeId(req.body.video_url);
      if (!vid && !req.file) return res.redirect(back('Paste a YouTube link, or choose a video from your phone.'));
      const vmime = !vid && videoMimeOf(req.file);
      if (!vid && !vmime) return res.redirect(back('That file is not a video.'));
      const slug = uniqueSlug(slugify(title || (req.file ? req.file.originalname.replace(/\.[a-z0-9]+$/i, '') : 'video'))), aud = readAudience(req.body, title);
      if (vid) db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,video_id,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(slug, title || 'Video', '', membersOnly, 'video', paid, PRICE_KOBO, vid, aud.dept, aud.level, req.user.id);
      else db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,file_data,file_mime,file_name,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(slug, title || req.file.originalname.replace(/\.[a-z0-9]+$/i, ''), '', membersOnly, 'video', paid, PRICE_KOBO, req.file.buffer, vmime, req.file.originalname, aud.dept, aud.level, req.user.id);
      applySemester({ slug }, req.body.semester);
      announceUpload({ title: title || 'Video', slug, paid, ...aud });
      return res.redirect(back(`Published at /p/${slug}`));
    }
    if (!req.file) return res.redirect(back('Choose a file first.'));
    const base = req.file.originalname.replace(/\.[a-z0-9]+$/i, '');
    const slug = uniqueSlug(slugify(base)), aud = readAudience(req.body, title || base);
    if (kind === 'image' && !isImageUpload(req.file)) return res.redirect(back('Choose a JPG or PNG picture.'));
    if (kind === 'pdf' || kind === 'doc' || kind === 'image') {
      db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,file_data,file_mime,file_name,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(slug, title || base, '', membersOnly, kind, paid, PRICE_KOBO, req.file.buffer, req.file.mimetype, req.file.originalname, aud.dept, aud.level, req.user.id);
    } else {
      db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(slug, title || base, req.file.buffer.toString('utf8'), membersOnly, kind, paid, PRICE_KOBO, aud.dept, aud.level, req.user.id);
    }
    applySemester({ slug }, req.body.semester);
    announceUpload({ title: title || base, slug, paid, ...aud });
    res.redirect(back(`Published at /p/${slug}`));
  });
  // Change who an existing upload is for.
  app.get('/admin/pages/:id/sort', pagesAdmin, (req, res) => {
    const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
    if (!p) return res.redirect(back('Page not found.'));
    if (!ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
    res.send(layout('Who is this for?', `<p class="mut"><a href="/admin?tab=pages">&larr; Admin</a></p><h1 style="font-size:26px">${esc(p.title)}</h1>
<form class="card" method="post" action="/admin/pages/${p.id}/sort"><label class="mut">Which departments? (leave all unchecked for every department)</label>${departmentCheckboxes(deptListOf(p))}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}"${Number(p.level) === l ? ' selected' : ''}>${l} level only</option>`).join('')}</select>${semesterField(p.semester)}<button>Save</button></form>`, req.user));
  });
  app.post('/admin/pages/:id/sort', pagesAdmin, (req, res) => {
    const p = db.prepare('SELECT id, author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
    if (!p) return res.redirect(back('Page not found.'));
    if (p.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can change it.'));
    if (!ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
    const aud = readAudience({ dept: req.body.dept, level: req.body.level === '' ? 'all' : req.body.level }, '');
    db.prepare('UPDATE pages SET dept=?, level=? WHERE id=?').run(aud.dept, aud.level, p.id);
    if (req.body.semester) applySemester({ id: p.id }, req.body.semester);
    res.redirect(back('Saved who this upload is for.'));
  });
};
