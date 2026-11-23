'use strict';
// Remembers each person's last upload choices (departments, level, semester, members only) and fills them in next time.
// Nothing to press: saved automatically when something is uploaded, kept until they change it.
exports.init = db => db.exec('CREATE TABLE IF NOT EXISTS upload_prefs(user_id INTEGER PRIMARY KEY, dept TEXT, level TEXT, semester TEXT, members_only INTEGER DEFAULT 0)');
exports.get = (db, user) => {
  exports.init(db);
  const r = user && db.prepare('SELECT * FROM upload_prefs WHERE user_id=?').get(user.id);
  let dept = []; try { dept = JSON.parse((r && r.dept) || '[]') || []; } catch (e) { /* none */ }
  return { dept, level: r && r.level || '', semester: r && r.semester || '', members_only: !!(r && r.members_only) };
};
exports.save = (db, user, body) => {
  if (!user || !body) return;
  try {
    exports.init(db);
    const dept = [].concat(body.dept || []).map(String).slice(0, 200), level = String(body.level || '').slice(0, 10), sem = String(body.semester || '').slice(0, 10);
    db.prepare('INSERT INTO upload_prefs(user_id,dept,level,semester,members_only) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET dept=excluded.dept, level=excluded.level, semester=excluded.semester, members_only=excluded.members_only')
      .run(user.id, JSON.stringify(dept), level, sem, body.members_only ? 1 : 0);
  } catch (e) { console.error('Upload settings not saved:', e.message); }
};
// Level choices with the remembered one selected. extra = the "automatic" choice (admin form only).
exports.levels = (db, user, LEVELS, auto) => {
  const l = exports.get(db, user).level;
  return (auto ? `<option value="auto"${l === 'auto' || !l ? ' selected' : ''}>Level: automatic</option>` : '') + `<option value="all"${l === 'all' || (!auto && !l) ? ' selected' : ''}>All levels</option>` + LEVELS.map(x => `<option value="${x}"${String(l) === String(x) ? ' selected' : ''}>${x} level only</option>`).join('');
};
