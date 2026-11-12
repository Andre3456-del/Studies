// Position and lecturer approvals, departments and level limits (admin actions)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { SCOPE_RANK, admin, back, canVerifyClaim, db, departmentNames, notify, optionsOf, positionTaken } = ctx;
  app.post('/positions/:id/verify', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const t = db.prepare("SELECT id,position,role,department,level,university FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
    if (!t || !canVerifyClaim(req.user, t)) return res.redirect(back('You cannot verify that claim.'));
    if (positionTaken(t.university, t.position, t.id)) return res.redirect(back('Another person at that university already holds exactly that position name.'));
    const myRank = SCOPE_RANK[req.user.position_scope] || 1;
    let scope = ['own', 'department', 'faculty', 'school'].includes(req.body.scope) ? req.body.scope : 'own';
    if (SCOPE_RANK[scope] > myRank) scope = req.user.position_scope;
    const autoRole = ['news', 'content'].includes(req.body.auto_role) ? req.body.auto_role : null;
    const canVerify = req.body.can_verify ? 1 : 0;
    db.prepare("UPDATE users SET title=position, position_status='approved', position_scope=?, position_auto_role=?, position_can_verify=? WHERE id=?").run(scope, autoRole, canVerify, t.id);
    if (autoRole && t.role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(autoRole, t.id);
    notify([t.id], { title: 'Position verified', body: `${t.position} now shows beside your name.`, url: '/settings', tag: 'position' });
    res.redirect(back('Position verified.'));
  });
  app.post('/positions/:id/verify-reject', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const t = db.prepare("SELECT id,department,level,university FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
    if (!t || !canVerifyClaim(req.user, t)) return res.redirect(back('You cannot act on that claim.'));
    db.prepare("UPDATE users SET position_status='rejected' WHERE id=?").run(req.params.id);
    res.redirect(back('Rejected.'));
  });
  app.post('/admin/lecturers/:id/approve', admin, (req, res) => {
    const t = db.prepare("SELECT id FROM users WHERE id=? AND is_lecturer=1 AND lecturer_status='pending'").get(req.params.id);
    if (!t) return res.redirect(back('Nothing to verify.'));
    db.prepare("UPDATE users SET lecturer_status='approved' WHERE id=?").run(t.id);
    notify([t.id], { title: 'You are verified', body: 'You can now upload for your courses.', url: '/lecturer', tag: 'lecturer' });
    res.redirect(back('Lecturer verified.'));
  });
  app.post('/admin/lecturers/:id/reject', admin, (req, res) => {
    const t = db.prepare("SELECT id FROM users WHERE id=? AND is_lecturer=1 AND lecturer_status='pending'").get(req.params.id);
    if (!t) return res.redirect(back('Nothing to reject.'));
    db.prepare("UPDATE users SET lecturer_status='rejected' WHERE id=?").run(t.id);
    res.redirect(back('Lecturer rejected.'));
  });
  app.post('/admin/positions/:id/approve', admin, (req, res) => {
    const t = db.prepare("SELECT id,position,role,university FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
    if (!t) return res.redirect(back('Nothing to verify.'));
    if (positionTaken(t.university, t.position, t.id)) return res.redirect(back('Another person at that university already holds exactly that position name.'));
    const scope = ['own', 'department', 'faculty', 'school'].includes(req.body.scope) ? req.body.scope : 'own';
    const autoRole = ['news', 'content', 'observer'].includes(req.body.auto_role) ? req.body.auto_role : null;
    const approverId = req.body.approver_id ? Number(req.body.approver_id) : null;
    const canVerify = req.body.can_verify ? 1 : 0;
    db.prepare("UPDATE users SET title=position, position_status='approved', position_scope=?, position_auto_role=?, position_approver_id=?, position_can_verify=? WHERE id=?").run(scope, autoRole, approverId, canVerify, t.id);
    if (autoRole && t.role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(autoRole, t.id);
    notify([t.id], { title: 'Position verified', body: `${t.position} now shows beside your name.`, url: '/settings', tag: 'position' });
    res.redirect(back('Position verified.'));
  });
  app.post('/admin/positions/:id/reject', admin, (req, res) => {
    const t = db.prepare("SELECT id,position FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
    if (!t) return res.redirect(back('Nothing to reject.'));
    db.prepare("UPDATE users SET title=NULL, position_status='rejected' WHERE id=?").run(t.id);
    notify([t.id], { title: 'Position not verified', body: 'School authorities could not verify the position you entered.', url: '/settings', tag: 'position' });
    res.redirect(back('Position rejected.'));
  });
  app.post('/admin/departments/add', admin, (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120), faculty = String(req.body.faculty || '').trim().slice(0, 80) || 'Other';
    if (!name) return res.redirect(back('Enter a department name.'));
    const ml = [300, 400, 500, 600].includes(Number(req.body.max_level)) ? Number(req.body.max_level) : 500;
    db.prepare('INSERT OR IGNORE INTO departments(name,faculty,max_level) VALUES(?,?,?)').run(name, faculty, ml);
    res.redirect(back(`Added ${name}.`));
  });
  app.post('/admin/departments/:id/maxlevel', admin, (req, res) => {
    const ml = [300, 400, 500, 600].includes(Number(req.body.max_level)) ? Number(req.body.max_level) : null;
    if (ml) db.prepare('UPDATE departments SET max_level=? WHERE id=?').run(ml, Number(req.params.id));
    res.redirect(back(ml ? `Last level set to ${ml}.` : 'Pick a last level.'));
  });
  app.post('/admin/faculties/maxlevel', admin, (req, res) => {
    const ml = [300, 400, 500, 600].includes(Number(req.body.max_level)) ? Number(req.body.max_level) : null, f = String(req.body.faculty || '').trim();
    if (!ml || !f) return res.redirect(back('Choose a faculty and a last level.'));
    const n = db.prepare('UPDATE departments SET max_level=? WHERE faculty=?').run(ml, f).changes;
    res.redirect(back(`Last level for ${f} is now ${ml} (${n} department${n === 1 ? '' : 's'}).`));
  });
  app.post('/admin/departments/breakdown', admin, (req, res) => {
    const dept = String(req.body.department || '').trim();
    if (!departmentNames().includes(dept)) return res.redirect(back('Choose the department from the list.'));
    const names = [...new Set(String(req.body.names || '').split(/[,\n;]+/).map(s => s.trim().replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean))].slice(0, 60);
    if (!names.length) return res.redirect(back('Type at least one course.'));
    let n = 0; for (const x of names) n += db.prepare('INSERT OR IGNORE INTO department_options(department,name) VALUES(?,?)').run(dept, x).changes;
    res.redirect(back(`${dept} now has ${optionsOf(dept).length} courses (${n} added).`));
  });
  app.post('/admin/departments/breakdown/remove', admin, (req, res) => {
    db.prepare('DELETE FROM department_options WHERE department=? AND name=?').run(String(req.body.department || ''), String(req.body.name || ''));
    res.redirect(back('Course removed. Students who already chose it keep it.'));
  });
  app.post('/admin/departments/:id/delete', admin, (req, res) => {
    const gone = db.prepare('SELECT name FROM departments WHERE id=?').get(req.params.id);
    if (gone) db.prepare('DELETE FROM department_options WHERE department=?').run(gone.name);
    db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
    res.redirect(back('Department removed from the list.'));
  });
};
