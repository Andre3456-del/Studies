'use strict';
// Studies Hub: semester system (self-contained, no dependency on server.js internals).
// Course code rule: GST 121 -> first digit = level (100), second digit = semester (2),
// third digit is ignored. Second digit 1 = first semester, 2 = second semester.

// Finds the first course code in a text (e.g. "GST 121 - Use of English") and reads level + semester.
function parseCourseCode(text) {
  const m = /(?:^|[^A-Za-z0-9])[A-Za-z]{2,5}\s*[-_]?\s*([1-9])([0-9])([0-9])(?![0-9])/.exec(String(text || ''));
  if (!m) return { level: null, semester: null };
  const sem = Number(m[2]);
  return { level: Number(m[1]) * 100, semester: sem === 1 || sem === 2 ? sem : null };
}

// Creates the one-row state table (current semester, default 1). Safe to call on every start.
function ensureSchema(db) {
  db.exec('CREATE TABLE IF NOT EXISTS semester_state(id INTEGER PRIMARY KEY CHECK(id=1), current INTEGER NOT NULL DEFAULT 1 CHECK(current IN (1,2)), updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  db.prepare('INSERT OR IGNORE INTO semester_state(id,current) VALUES(1,1)').run();
}

// Adds a nullable `semester` column to a table and fills it from the title column for rows that have none yet.
function addSemesterColumn(db, table, titleColumn) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(titleColumn)) throw new Error('Bad table or column name');
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name);
  if (!cols.includes('semester')) db.exec('ALTER TABLE ' + table + ' ADD COLUMN semester INTEGER');
  const rows = db.prepare('SELECT rowid AS rid, ' + titleColumn + ' AS title FROM ' + table + ' WHERE semester IS NULL').all();
  const set = db.prepare('UPDATE ' + table + ' SET semester=? WHERE rowid=?');
  let filled = 0;
  for (const r of rows) { const s = parseCourseCode(r.title).semester; if (s) { set.run(s, r.rid); filled++; } }
  return filled;
}

function getCurrent(db) {
  const r = db.prepare('SELECT current FROM semester_state WHERE id=1').get();
  return r ? Number(r.current) : 1;
}

// First and second semester never meet: an upload shows only in its own semester.
// An upload with no detectable semester (no course code) shows in both.
function visibleInSemester(uploadSemester, current) {
  return uploadSemester == null || Number(uploadSemester) === Number(current);
}

function semesterName(n) { return Number(n) === 2 ? 'Second semester' : 'First semester'; }

// "Move everyone to the next semester".
// From semester 1: only the semester changes (levels stay). From semester 2: promoteLevels() is called
// (pass in the site's existing "advance everyone one level" function), then the semester resets to 1.
function advance(db, promoteLevels) {
  const from = getCurrent(db);
  if (from === 1) {
    db.prepare('UPDATE semester_state SET current=2,updated_at=CURRENT_TIMESTAMP WHERE id=1').run();
    return { from: 1, to: 2, levelsPromoted: false };
  }
  if (typeof promoteLevels !== 'function') throw new Error('promoteLevels function is required when moving from second semester');
  db.exec('BEGIN');
  try {
    const result = promoteLevels();
    db.prepare('UPDATE semester_state SET current=1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run();
    db.exec('COMMIT');
    return { from: 2, to: 1, levelsPromoted: true, result };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { parseCourseCode, ensureSchema, addSemesterColumn, getCurrent, visibleInSemester, semesterName, advance };
