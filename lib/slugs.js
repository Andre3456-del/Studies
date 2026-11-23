'use strict';
// Page addresses (/p/xxxxxxxx) are short random codes, never the material's name.
// Older pages that still have a name-based address are given a code once; their old links keep working (they forward to the new one).
const crypto = require('crypto');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz', ALL = LETTERS + '0123456789';
const GOOD = /^(?=.*[0-9])(?=.*[a-z])[a-z0-9]{8}$/;
exports.code = function code() {
  for (;;) {
    const b = crypto.randomBytes(8); let s = '';
    for (let i = 0; i < 8; i++) s += (i === 0 ? LETTERS : ALL)[b[i] % (i === 0 ? 26 : 36)];
    if (GOOD.test(s)) return s;
  }
};
exports.moved = function moved(db, old) {
  try { const r = db.prepare('SELECT p.slug FROM slug_alias a JOIN pages p ON p.id=a.page_id WHERE a.old=?').get(String(old)); return r && r.slug; } catch (e) { return null; }
};
exports.init = function init(db) {
  db.exec('CREATE TABLE IF NOT EXISTS slug_alias(old TEXT PRIMARY KEY, page_id INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sales_flags(k TEXT PRIMARY KEY)');
  if (db.prepare("SELECT 1 FROM sales_flags WHERE k='slugs1'").get()) return;
  try {
    db.exec('BEGIN');
    const taken = new Set(db.prepare('SELECT slug FROM pages').all().map(r => r.slug));
    const up = db.prepare('UPDATE pages SET slug=? WHERE id=?'), al = db.prepare('INSERT OR REPLACE INTO slug_alias(old,page_id) VALUES(?,?)');
    db.prepare('SELECT id, slug FROM pages').all().forEach(r => {
      if (GOOD.test(r.slug)) return;
      let n; do n = exports.code(); while (taken.has(n));
      taken.add(n); up.run(n, r.id); al.run(r.slug, r.id);
    });
    db.exec("INSERT INTO sales_flags(k) VALUES('slugs1')");
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* ignore */ } console.error('Address change failed:', e.message); }
};
