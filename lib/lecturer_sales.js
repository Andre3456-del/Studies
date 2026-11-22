'use strict';
// Sold materials (lecturer portal) and clean deletes.
//  - Before paying for a lecturer's material the buyer types their registration number. Name, department and level come from their profile.
//  - /lecturer/sold lists who bought what, grouped by course.
//  - When a page is deleted, everything tied to it goes with it (buyers' access, attempts, thumbnails, buyer details).
//    The money records stay, but are cut loose from the page number (it becomes negative), so a later upload that
//    happens to get the same number starts completely fresh: no buyers, no access, no sales.
const mod = {};
module.exports = mod;
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

mod.init = function init(db) {
  db.exec('CREATE TABLE IF NOT EXISTS buyer_details(user_id INTEGER NOT NULL, page_id INTEGER NOT NULL, reg_no TEXT, name TEXT, department TEXT, level TEXT, created_at INTEGER, PRIMARY KEY(user_id,page_id))');
  const have = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const wipe = ['purchases', 'buyer_details', 'cbt_attempts', 'cbt_starts', 'page_thumbs'].filter(have).map(t => `DELETE FROM ${t} WHERE page_id=OLD.id;`);
  const keep = ['receipts', 'seller_sales', 'seller_tx'].filter(have).map(t => `UPDATE ${t} SET page_id=-OLD.id WHERE page_id=OLD.id;`).concat(have('cbt_library') ? ['UPDATE cbt_library SET page_id=NULL WHERE page_id=OLD.id;'] : []);
  db.exec('DROP TRIGGER IF EXISTS pages_gone');
  db.exec(`CREATE TRIGGER pages_gone AFTER DELETE ON pages BEGIN ${wipe.concat(keep).join(' ')} END`);
  // Once: remove leftovers of materials deleted before this existed (buyers that point at a page number a newer upload reused).
  db.exec('CREATE TABLE IF NOT EXISTS sales_flags(k TEXT PRIMARY KEY)');
  if (!db.prepare("SELECT 1 FROM sales_flags WHERE k='stale1'").get()) {
    try {
      db.exec('DELETE FROM purchases WHERE page_id NOT IN (SELECT id FROM pages)');
      db.exec('DELETE FROM purchases WHERE EXISTS (SELECT 1 FROM pages p WHERE p.id=purchases.page_id AND p.created_at IS NOT NULL AND purchases.created_at IS NOT NULL AND purchases.created_at < p.created_at)');
      db.exec("INSERT INTO sales_flags(k) VALUES('stale1')");
    } catch (e) { console.error('Stale purchase cleanup failed:', e.message); }
  }
};

// Called when a buyer starts paying for a lecturer's material. False = the registration number is missing.
mod.saveBuyer = function saveBuyer(db, user, page, reg) {
  const r = clean(reg, 40); if (!r) return false;
  db.prepare('INSERT INTO buyer_details(user_id,page_id,reg_no,name,department,level,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,page_id) DO UPDATE SET reg_no=excluded.reg_no,name=excluded.name,department=excluded.department,level=excluded.level')
    .run(user.id, page.id, r, clean(user.name, 120), clean(user.department, 120), user.level ? String(user.level) : '', Date.now());
  return true;
};
// The form fields shown above the pay button.
mod.fields = (esc, user) => `<p class="mut" style="margin:0 0 8px">${esc([user.name, user.department, user.level ? user.level + ' level' : ''].filter(Boolean).join(' · '))}</p><input name="reg_no" placeholder="Registration number" required maxlength="40" autocomplete="off" style="margin-bottom:10px">`;

mod.register = function register(app, ctx) {
  const { db, esc, layout } = ctx;
  mod.init(db); setTimeout(() => { try { mod.init(db); } catch (e) { console.error('Page delete trigger failed:', e.message); } }, 8000); // again once every other table exists
  const lecturer = u => u && u.is_lecturer && u.lecturer_status === 'approved';
  const money = k => '₦' + Number(k || 0).toLocaleString('en-NG');
  app.get('/lecturer/sold', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/lecturer/sold');
    if (!lecturer(req.user)) return res.redirect('/lecturer');
    const rows = db.prepare(`SELECT p.id pid, p.title, c.name course, b.reg_no, b.name, b.department, b.level, pu.amount, pu.created_at paid
      FROM purchases pu JOIN pages p ON p.id=pu.page_id AND p.author_id=? LEFT JOIN courses c ON c.id=p.course_id LEFT JOIN buyer_details b ON b.user_id=pu.user_id AND b.page_id=pu.page_id ORDER BY c.name, p.title, pu.id DESC`).all(req.user.id);
    const byCourse = {};
    rows.forEach(r => { const c = r.course || 'No course'; ((byCourse[c] = byCourse[c] || {})[r.pid + '|' + r.title] = byCourse[c][r.pid + '|' + r.title] || []).push(r); });
    const html = Object.keys(byCourse).map(c => `<h3>${esc(c)}</h3>${Object.keys(byCourse[c]).map(k => { const list = byCourse[c][k]; return `<details class="card"><summary><b>${esc(k.split('|').slice(1).join('|'))}</b> <span class="mut">${list.length} bought</span></summary><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"><tr><th align="left">Name</th><th align="left">Reg. no.</th><th align="left">Department</th><th align="left">Level</th></tr>${list.map(r => `<tr><td>${esc(r.name || '')}</td><td>${esc(r.reg_no || '')}</td><td>${esc(r.department || '')}</td><td>${esc(r.level || '')}</td></tr>`).join('')}</table></div></details>`; }).join('')}`).join('');
    res.send(layout('Sold materials', `<p class="mut"><a href="/lecturer">&larr; Home</a></p><h1>Sold materials</h1><p><a class="btn ghost" href="/lecturer/sell">Bank account and prices</a></p>${html || '<p class="mut">Nothing sold yet.</p>'}`, req.user));
  });
};
