// A position holder (class rep, director of socials...) can hand the position over to one other person in the same reach.
// Everything moves with it: the title, the reach, the extra role and the right to verify. The giver keeps none of it.
const card = (u, esc) => u.position_status === 'approved' && u.position && !['admin', 'uniadmin'].includes(u.role) && !u.is_lecturer
  ? `<form method="post" action="/settings/position/handover" class="card" autocomplete="off"><h3 style="margin:0 0 6px">Hand over my position</h3>
<p class="mut" style="margin:0 0 8px">Pass ${esc(u.position)} to someone else. You lose everything that comes with it and they get it. There can only be one.</p>
<input name="to" placeholder="Their username" required maxlength="40" autocapitalize="none">
${u.gsignup ? '' : '<input type="password" name="password" placeholder="Your password" required>'}<button>Hand over</button></form>` : '';
function register(app, ctx) {
  const { db, bcrypt, notify } = ctx;
  const back = (res, m, e) => res.redirect('/settings/profile?' + (e ? 'err=1&' : '') + 'msg=' + encodeURIComponent(m));
  const fac = d => (db.prepare('SELECT faculty FROM departments WHERE name=?').get(d) || {}).faculty || null;
  app.post('/settings/position/handover', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (u.position_status !== 'approved' || !u.position || ['admin', 'uniadmin'].includes(u.role) || u.is_lecturer) return back(res, 'You do not hold a position to hand over.', 1);
    if (!u.gsignup && !(u.hash && bcrypt.compareSync(String(req.body.password || ''), u.hash))) return back(res, 'That password is not right.', 1);
    const name = String(req.body.to || '').trim().replace(/^@+/, '').toLowerCase();
    const t = name && db.prepare('SELECT * FROM users WHERE lower(username)=? AND id!=?').get(name, u.id);
    if (!t || t.is_lecturer || t.role !== 'user') return back(res, 'No student found with that username.', 1);
    const sc = u.position_scope || 'own';
    const inReach = t.university === u.university && (sc === 'school' || (sc === 'faculty' ? fac(t.department) === fac(u.department) : t.department === u.department && (sc === 'department' || Number(t.level) === Number(u.level))));
    if (!inReach) return back(res, sc === 'own' ? 'They must be in your department and level.' : 'They must be within your reach.', 1);
    if (t.position && t.position_status !== 'rejected') return back(res, 'They already hold or have asked for a position.', 1);
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE users SET position=?, title=?, position_status='approved', position_scope=?, position_auto_role=?, position_approver_id=?, position_can_verify=? WHERE id=?").run(u.position, u.title || u.position, u.position_scope, u.position_auto_role, u.position_approver_id, u.position_can_verify ? 1 : 0, t.id);
      if (u.position_auto_role && t.role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(u.position_auto_role, t.id);
      db.prepare("UPDATE users SET position=NULL, title=NULL, position_status=NULL, position_scope=NULL, position_auto_role=NULL, position_approver_id=NULL, position_can_verify=0 WHERE id=?").run(u.id);
      if (u.position_auto_role && u.role === u.position_auto_role) db.prepare("UPDATE users SET role='user' WHERE id=?").run(u.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); console.error('Position hand-over failed:', e.message); return back(res, 'Could not hand it over. Try again.', 1); }
    notify([t.id], { title: 'You are now ' + u.position, body: u.name + ' handed the position over to you.', url: '/settings', tag: 'position' });
    notify([u.id], { title: 'Position handed over', body: 'You are no longer ' + u.position + '.', url: '/settings', tag: 'position' });
    back(res, 'Done. ' + t.name + ' now holds ' + u.position + '.');
  });
}
module.exports = { card, register };
