// The study bot, admin side. No keys and no outside access: the admin downloads a zip of waiting uploads, gives it to Claude in a chat,
// brings back the zip Claude makes, checks it here, and only then does anything go live. (Repo for the bot's own tools: Studies-hub1.)
const zip = require('../lib/zip'), quiz = require('../lib/bot_quiz'), crypto = require('crypto');
module.exports = function register(app, ctx) {
  const { db, esc, layout, admin, upload, slugify, uniqueSlug } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS bot_handled(page_id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bot_made(page_id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  const PART_BYTES = 20 * 1024 * 1024, PART_ITEMS = 30, previews = new Map(); // a batch is split into parts of about 20 MB so each zip stays easy to hand over; one big file simply gets a part of its own
  const pending = () => db.prepare(`SELECT p.id,p.title,p.kind,p.dept,p.level,p.file_name,p.file_mime,p.created_at,COALESCE(length(p.file_data),length(p.html),0) AS size,c.name AS course
    FROM pages p LEFT JOIN courses c ON c.id=p.course_id
    WHERE p.kind IN ('pdf','doc','image','html') AND p.id NOT IN (SELECT page_id FROM bot_handled) AND p.id NOT IN (SELECT page_id FROM bot_made)
    ORDER BY COALESCE(c.name,'~'),p.level,p.id`).all();
  const msg = req => req.query.msg ? `<div class="card" style="border-color:var(--blue)">${esc(req.query.msg)}</div>` : '';
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  // One CBT page and one summary page per course: every lecture goes into them, and questions are mixed at random when opened.
  const upsertCourse = (kind, dest, course, add) => {
    const title = course.code + (kind === 'cbt' ? ': CBT practice (all lectures)' : ': summaries (all lectures)');
    const ex = db.prepare('SELECT id,html FROM pages WHERE title=? AND kind=? AND course_id IS ? AND dept IS ? AND level IS ?').get(title, kind, dest.course_id, dest.dept, dest.level);
    let bank = (ex && quiz.readBank(ex.html)) || [];
    if (kind === 'cbt') { const seen = new Set(bank.map(x => x.q)); add.forEach(x => { if (!seen.has(x.q)) { seen.add(x.q); bank.push(x); } }); }
    else { bank = bank.filter(s => !add.some(a => a.topic === s.topic)).concat(add); }
    const html = kind === 'cbt' ? quiz.combinedQuiz(course, bank) : quiz.combinedSummary(course, bank);
    if (ex) { db.prepare('UPDATE pages SET html=? WHERE id=?').run(html, ex.id); return ex.id; }
    const id = Number(db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,dept,level,course_id,admin_id) VALUES(?,?,?,?,?,0,?,?,?,?)').run(uniqueSlug(slugify(title)), title, html, 1, kind === 'cbt' ? 'cbt' : 'html', dest.dept, dest.level, dest.course_id, null).lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO bot_made(page_id) VALUES(?)').run(id); return id;
  };
  const ids = v => [].concat(v || []).join(',').split(',').map(x => parseInt(x, 10)).filter(Number.isInteger);

  app.get('/admin/bot', admin, (req, res) => {
    const rows = pending(), groups = {};
    rows.forEach(r => (groups[r.course || 'No course set'] = groups[r.course || 'No course set'] || []).push(r));
    const done = db.prepare('SELECT COUNT(*) n FROM bot_handled').get().n, made = db.prepare('SELECT COUNT(*) n FROM bot_made').get().n;
    const list = Object.entries(groups).map(([c, rs]) => `<div class="card"><h3 style="margin:0 0 8px">${esc(c)}</h3>${rs.map(r => `<label class="botrow"><input type="checkbox" name="ids" value="${r.id}"><span><b>${esc(r.title)}</b><br><span class="mut">${esc(r.kind.toUpperCase())} · ${r.level ? esc(r.level) + ' level · ' : ''}${kb(r.size)}</span></span></label>`).join('')}</div>`).join('');
    res.send(layout('Study bot', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Study bot</h1>${msg(req)}<form class="card" method="post" action="/admin/bot/combine" onsubmit="return confirm('Fold every one-lecture bot page into one CBT and one summary per course? The small pages are removed.')"><b>Tidy up</b><p class="mut" style="margin:6px 0">Joins all the small one-lecture pages the bot made into one CBT and one summary page for each course.</p><button>Combine into one per course</button></form>
<style>.botrow{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);cursor:pointer}.botrow:first-of-type{border-top:0}.botrow input{width:22px;height:22px;margin:2px 0 0;flex:none}.botsteps{counter-reset:s;list-style:none;padding:0;margin:0}.botsteps li{counter-increment:s;display:flex;gap:12px;margin:0 0 12px}.botsteps li:before{content:counter(s);flex:none;width:28px;height:28px;border-radius:50%;background:var(--blue);color:#04122b;font-weight:800;display:flex;align-items:center;justify-content:center}</style>
<div class="card"><ol class="botsteps"><li><span><b>Download a batch</b><br><span class="mut">Pick the uploads below. You get one zip.</span></span></li><li><span><b>Give the zip to Claude</b><br><span class="mut">Attach it in the chat and say "process the batch".</span></span></li><li><span><b>Bring back what Claude makes</b><br><span class="mut">Upload Claude's zip in the box at the bottom. You check everything before it goes live.</span></span></li></ol></div>
<form method="get" action="/admin/bot/batch" data-noload><div class="card row" style="gap:10px;flex-wrap:wrap"><b>${rows.length} waiting</b><span class="mut">${done} handled · ${made} pages made by the bot</span><span style="flex:1"></span><button type="button" class="ghost" onclick="document.querySelectorAll('.botrow input').forEach(function(c){c.checked=true})">Select all</button><button>Download batch</button></div>${list || '<div class="card mut">Nothing is waiting. New uploads appear here.</div>'}</form>
<h2>Bring Claude's work back</h2><form class="card" method="post" action="/admin/bot/import" enctype="multipart/form-data"><p class="mut" style="margin-top:0">Choose the zip Claude gave you. Nothing is published yet: you see everything first and approve it.</p><input type="file" name="zip" accept=".zip,application/zip" required><button style="margin-top:12px">Check the zip</button></form>`, req.user));
  });

  // GET as well as POST: the Android app's downloader can only fetch a file with GET.
  // Every selected upload is included whatever its size; a big selection is cut into parts (about 20 MB each) and the admin downloads them one by one.
  const batch = (req, res) => {
    const raw = req.method === 'GET' ? req.query.ids : req.body && req.body.ids, want = new Set(ids(raw));
    if (!want.size) return res.redirect('/admin/bot?msg=' + encodeURIComponent('Tick at least one upload first.'));
    const rows = pending().filter(r => want.has(r.id)).sort((a, b) => a.id - b.id), parts = [[]]; let bytes = 0;
    for (const r of rows) {
      const cur = parts[parts.length - 1];
      if (cur.length && (bytes + r.size > PART_BYTES || cur.length >= PART_ITEMS)) { parts.push([]); bytes = 0; }
      parts[parts.length - 1].push(r); bytes += r.size;
    }
    if (!rows.length) return res.redirect('/admin/bot?msg=' + encodeURIComponent('Those uploads are already handled.'));
    const q = 'ids=' + rows.map(r => r.id).join(','), part = parseInt(req.query && req.query.part, 10) || (parts.length === 1 ? 1 : 0);
    if (!part) return res.send(layout('Download batch', `<p class="mut"><a href="/admin/bot">&larr; Study bot</a></p><h1>Download batch</h1><p class="mut">That is ${rows.length} upload(s), ${kb(rows.reduce((t, r) => t + r.size, 0))} in all. It is cut into ${parts.length} zips so each stays easy to hand over. Download each one and give them to Claude one after the other (one per chat message is fine).</p>${parts.map((p, i) => `<div class="card row" style="gap:12px;flex-wrap:wrap"><span><b>Part ${i + 1} of ${parts.length}</b><br><span class="mut">${p.length} upload(s) · ${kb(p.reduce((t, r) => t + r.size, 0))}</span></span><span style="flex:1"></span><a class="btn" href="/admin/bot/batch?${q}&part=${i + 1}" download data-noload>Download</a></div>`).join('')}`, req.user));
    if (part < 1 || part > parts.length) return res.redirect('/admin/bot?msg=' + encodeURIComponent('That part does not exist.'));
    const items = [], files = [];
    for (const r of parts[part - 1]) {
      const p = db.prepare('SELECT file_data,html FROM pages WHERE id=?').get(r.id);
      const data = p.file_data ? Buffer.from(p.file_data) : Buffer.from(String(p.html || ''), 'utf8');
      const ext = (p.file_data ? (String(r.file_name || '').match(/\.([a-z0-9]{1,5})$/i) || [])[1] || (r.file_mime || '').split('/')[1] : 'html') || 'bin', f = 'files/' + r.id + '.' + String(ext).toLowerCase().replace(/[^a-z0-9]/g, '');
      files.push({ name: f, data });
      items.push({ id: r.id, title: r.title, kind: r.kind, course: r.course || null, dept: r.dept || null, level: r.level || null, mime: r.file_mime || 'text/html', file: f, size: data.length, uploaded: r.created_at });
    }
    const out = zip.write([{ name: 'batch.json', data: Buffer.from(JSON.stringify({ version: 1, created: new Date().toISOString(), part, parts: parts.length, items }, null, 2)) }, ...files]);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="studies-hub-batch-${new Date().toISOString().slice(0, 10)}${parts.length > 1 ? `-part${part}of${parts.length}` : ''}.zip"`);
    res.send(out);
  };
  app.get('/admin/bot/batch', admin, batch); app.post('/admin/bot/batch', admin, batch);

  app.post('/admin/bot/import', admin, upload.single('zip'), (req, res) => {
    const fail = m => res.redirect('/admin/bot?msg=' + encodeURIComponent(m));
    if (!req.file) return fail('Choose the zip first.');
    let entries, results;
    try { entries = zip.read(req.file.buffer); const r = entries.find(e => e.name === 'results.json'); if (!r) return fail('That zip has no results.json. Use the zip Claude gave back.'); results = JSON.parse(r.data.toString('utf8')); }
    catch (e) { return fail('Could not open that zip: ' + e.message); }
    if (!results || !Array.isArray(results.items) || !results.items.length) return fail('The zip has no items in it.');
    const items = results.items.slice(0, 100).map(d => ({ d, errs: quiz.check(d) }));
    const tok = crypto.randomBytes(16).toString('hex'); previews.set(tok, { uid: req.user.id, items: items.map(i => i.d), exp: Date.now() + 3600e3 });
    for (const [k, v] of previews) if (v.exp < Date.now()) previews.delete(k);
    const courses = db.prepare('SELECT id,name FROM courses ORDER BY name').all(), depts = db.prepare('SELECT name FROM departments ORDER BY name').all();
    const card = ({ d, errs }, i) => {
      const src = (Array.isArray(d.source_ids) ? d.source_ids : []).map(Number).filter(Number.isInteger), sp = src.length ? db.prepare(`SELECT p.dept,p.level,c.name course FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.id=?`).get(src[0]) : null;
      const guess = courses.find(c => d.course && d.course.code && c.name.toLowerCase().includes(String(d.course.code).toLowerCase()));
      const where = sp ? `<p class="mut" style="margin:6px 0">Goes to: <b>${esc(sp.course || 'no course set')}</b>${sp.level ? ' · ' + esc(sp.level) + ' level' : ''}${sp.dept ? ' · ' + esc(sp.dept) : ''} (same as the uploaded file)</p>`
        : `<p class="mut" style="margin:6px 0">No uploaded file behind this one, so choose where it goes:</p><div class="row" style="gap:8px;flex-wrap:wrap"><select name="course_${i}" required><option value="">Course…</option>${courses.map(c => `<option value="${c.id}"${guess && guess.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select><select name="dept_${i}" required><option value="">Department…</option>${depts.map(x => `<option>${esc(x.name)}</option>`).join('')}</select><input name="level_${i}" type="number" min="100" max="700" step="100" value="${esc(d.level || '')}" placeholder="Level" style="width:100px" required></div>`;
      if (errs.length) return `<div class="card" style="opacity:.8"><b>${esc((d.course && d.course.code) || 'Item ' + (i + 1))} · not usable</b><p class="mut" style="margin:6px 0 0">${errs.map(esc).join('<br>')}</p></div>`;
      return `<div class="card"><label class="row" style="gap:12px;cursor:pointer;justify-content:flex-start;text-align:left"><input type="checkbox" name="ok_${i}" value="1" checked style="width:22px;height:22px;flex:none"><b>${esc(d.course.code)} · ${esc(d.topic)}</b></label><p class="mut" style="margin:6px 0">${esc(d.course.title)} · ${esc(d.level)} level · ${esc(d.kind)} · ${d.questions.length} question${d.questions.length === 1 ? '' : 's'}${d.source === 'draft-from-knowledge' ? ' · <span class="chip pay">written from knowledge, check carefully</span>' : ''}</p>${where}<details><summary>Read it</summary><ul>${d.summary.map(s => `<li>${esc(s)}</li>`).join('')}</ul>${d.questions.map((q, n) => `<p style="margin:10px 0 4px"><b>${n + 1}. ${esc(q.q)}</b></p>${q.options.map((o, j) => `<div class="mut">${'ABCD'[j]}. ${esc(o)}${j === q.answer ? ' ✓' : ''}</div>`).join('')}<div class="mut"><i>${esc(q.explain)}</i></div>`).join('')}</details></div>`;
    };
    const usable = items.filter(i => !i.errs.length).length;
    res.send(layout('Check the bot\'s work', `<p class="mut"><a href="/admin/bot">&larr; Study bot</a></p><h1>Check the bot's work</h1><p class="mut">${usable} of ${items.length} item(s) are usable. Untick anything you do not want. Only ticked items are published, as a summary page and a practice test marked as written with the bot.</p><form method="post" action="/admin/bot/approve"><input type="hidden" name="tok" value="${tok}">${items.map(card).join('')}<button>Approve ticked items</button></form>`, req.user));
  });

  // Folds the one-lecture pages made earlier into one CBT and one summary page per course, then removes the old ones.
  app.post('/admin/bot/combine', admin, (req, res) => {
    const rows = db.prepare("SELECT p.id,p.kind,p.html,p.dept,p.level,p.course_id FROM pages p JOIN bot_made b ON b.page_id=p.id WHERE p.title LIKE '%(bot-assisted)'").all();
    const groups = new Map(); let gone = 0;
    for (const r of rows) {
      const o = quiz.readOld(r.html); if (!o) continue;
      const k = [r.course_id, r.dept, r.level, o.code].join('|'); if (!groups.has(k)) groups.set(k, { dest: { course_id: r.course_id, dept: r.dept, level: r.level }, course: { code: o.code, title: o.qs ? ((db.prepare('SELECT name FROM courses WHERE id=?').get(r.course_id) || {}).name || '') : o.title, level: r.level }, qs: [], secs: [], ids: [] });
      const g = groups.get(k); g.ids.push(r.id); if (!o.qs && o.title) g.course.title = o.title;
      if (o.qs) g.qs.push(...o.qs); else g.secs.push({ topic: o.topic, lines: o.lines });
    }
    for (const g of groups.values()) {
      if (g.qs.length) upsertCourse('cbt', g.dest, g.course, g.qs);
      if (g.secs.length) upsertCourse('html', g.dest, g.course, g.secs);
      g.ids.forEach(id => { db.prepare('DELETE FROM pages WHERE id=?').run(id); db.prepare('DELETE FROM bot_made WHERE page_id=?').run(id); gone++; });
    }
    // refresh the course CBT pages made earlier so they get the newest quiz page layout
    for (const r of db.prepare("SELECT id,title,html,level,course_id FROM pages WHERE kind='cbt' AND title LIKE '%: CBT practice (all lectures)'").all()) {
      const bank = quiz.readBank(r.html); if (!bank) continue;
      db.prepare('UPDATE pages SET html=? WHERE id=?').run(quiz.combinedQuiz({ code: r.title.replace(': CBT practice (all lectures)', ''), title: (db.prepare('SELECT name FROM courses WHERE id=?').get(r.course_id) || {}).name || '', level: r.level }, bank), r.id);
    }
    res.redirect('/admin/bot?msg=' + encodeURIComponent(gone ? `Done: ${gone} small page(s) folded into ${groups.size} course group(s).` : 'Nothing to combine.'));
  });

  app.post('/admin/bot/approve', admin, (req, res) => {
    const pv = previews.get(String((req.body || {}).tok || ''));
    if (!pv || pv.uid !== req.user.id || pv.exp < Date.now()) return res.redirect('/admin/bot?msg=' + encodeURIComponent('That check expired. Upload the zip again.'));
    previews.delete(req.body.tok);
    const ins = db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,dept,level,course_id,admin_id) VALUES(?,?,?,?,?,0,?,?,?,?)'), mark = db.prepare('INSERT OR IGNORE INTO bot_made(page_id) VALUES(?)'), handled = db.prepare('INSERT OR IGNORE INTO bot_handled(page_id) VALUES(?)');
    let n = 0, bad = 0;
    pv.items.forEach((d, i) => {
      if (!req.body['ok_' + i] || quiz.check(d).length) return;
      const src = (Array.isArray(d.source_ids) ? d.source_ids : []).map(Number).filter(Number.isInteger);
      let dest = src.length ? db.prepare('SELECT dept,level,course_id FROM pages WHERE id=?').get(src[0]) : null;
      if (!dest) { const cid = parseInt(req.body['course_' + i], 10), lv = parseInt(req.body['level_' + i], 10), dp = String(req.body['dept_' + i] || '');
        if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(cid) || !(lv >= 100 && lv <= 700) || !db.prepare('SELECT 1 FROM departments WHERE name=?').get(dp)) { bad++; return; }
        dest = { dept: dp, level: lv, course_id: cid }; }
      const course = { code: d.course.code, title: d.course.title, level: d.level };
      upsertCourse('html', dest, course, [{ topic: d.topic, lines: d.summary }]);
      if (d.questions.length) upsertCourse('cbt', dest, course, d.questions.map(q => ({ q: q.q, o: q.options, a: q.answer, e: q.explain })));
      src.forEach(id => handled.run(id)); n++;
    });
    res.redirect('/admin/bot?msg=' + encodeURIComponent(`${n} item(s) published${bad ? `, ${bad} skipped because no valid course, department and level were chosen` : ''}.`));
  });
};
