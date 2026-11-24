// A position holder (class rep, director of socials...) can ask to hand the position over to one other person in the same reach.
// The request goes to the president above them (or to the main admin when there is none). When that person approves, everything
// moves at once: the title, the reach, the extra role and the right to verify. The giver keeps none of it.
const RANK = { own: 1, department: 2, faculty: 3, school: 4 };
const init = db => db.exec("CREATE TABLE IF NOT EXISTS position_transfers(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER, decided_by INTEGER, decided_at INTEGER)");
const holds = u => u.position_status === 'approved' && u.position && !['admin', 'uniadmin'].includes(u.role) && !u.is_lecturer;
const pendingOf = (db, id) => db.prepare("SELECT * FROM position_transfers WHERE from_id=? AND status='pending'").get(id);

function register(app, ctx) {
  const { db, bcrypt, notify, esc, layout } = ctx;
  init(db);
  const fac = d => (db.prepare('SELECT faculty FROM departments WHERE name=?').get(d) || {}).faculty || null;
  const inReach = (g, t) => { const sc = g.position_scope || 'own'; return t.university === g.university && (sc === 'school' || (sc === 'faculty' ? fac(t.department) === fac(g.department) : t.department === g.department && (sc === 'department' || Number(t.level) === Number(g.level)))); };
  // Who may approve this person's hand-over: the main admin, or a verifier ranked above them whose reach covers their department.
  const mayDecide = (me, g) => {
    if (me.role === 'admin') return true;
    if (!me.position_can_verify || me.position_status !== 'approved' || me.university !== g.university) return false;
    const r = RANK[me.position_scope] || 1;
    if (r <= (RANK[g.position_scope] || 1)) return false;
    return r >= 4 || (r === 3 ? fac(me.department) === fac(g.department) : me.department === g.department);
  };
  const approversOf = g => db.prepare("SELECT * FROM users WHERE position_status='approved' AND position_can_verify=1 AND virtual=0").all().filter(v => v.id !== g.id && mayDecide(v, g)).map(v => v.id);
  const adminIds = () => db.prepare("SELECT id FROM users WHERE role='admin' AND virtual=0").all().map(r => r.id);
  const back = (res, m, e) => res.redirect('/settings/profile?' + (e ? 'err=1&' : '') + 'msg=' + encodeURIComponent(m));
  const move = (g, t) => {
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE users SET position=?, title=?, position_status='approved', position_scope=?, position_auto_role=?, position_approver_id=?, position_can_verify=? WHERE id=?").run(g.position, g.title || g.position, g.position_scope, g.position_auto_role, g.position_approver_id, g.position_can_verify ? 1 : 0, t.id);
      if (g.position_auto_role && t.role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(g.position_auto_role, t.id);
      db.prepare("UPDATE users SET position=NULL, title=NULL, position_status=NULL, position_scope=NULL, position_auto_role=NULL, position_approver_id=NULL, position_can_verify=0 WHERE id=?").run(g.id);
      if (g.position_auto_role && g.role === g.position_auto_role) db.prepare("UPDATE users SET role='user' WHERE id=?").run(g.id);
      db.exec('COMMIT'); return true;
    } catch (e) { db.exec('ROLLBACK'); console.error('Position hand-over failed:', e.message); return false; }
  };
  // The giver asks.
  app.post('/settings/position/handover', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!holds(u)) return back(res, 'You do not hold a position to hand over.', 1);
    if (pendingOf(db, u.id)) return back(res, 'You already have a hand-over waiting for approval.', 1);
    if (!u.gsignup && !(u.hash && bcrypt.compareSync(String(req.body.password || ''), u.hash))) return back(res, 'That password is not right.', 1);
    const name = String(req.body.to || '').trim().replace(/^@+/, '').toLowerCase();
    const t = name && db.prepare('SELECT * FROM users WHERE lower(username)=? AND id!=?').get(name, u.id);
    if (!t || t.is_lecturer || t.role !== 'user') return back(res, 'No student found with that username.', 1);
    if (!inReach(u, t)) return back(res, (u.position_scope || 'own') === 'own' ? 'They must be in your department and level.' : 'They must be within your reach.', 1);
    if (t.position && t.position_status !== 'rejected') return back(res, 'They already hold or have asked for a position.', 1);
    db.prepare("INSERT INTO position_transfers(from_id,to_id,status,created_at) VALUES(?,?, 'pending', ?)").run(u.id, t.id, Date.now());
    const who = approversOf(u), to = who.length ? who : adminIds();
    notify(to, { title: 'Position hand-over to approve', body: `${u.name} wants to hand ${u.position} to ${t.name}.`, url: '/position/transfers', tag: 'position' });
    back(res, who.length ? 'Sent to your president for approval.' : 'Sent to the Studies Hub team for approval.');
  });
  app.post('/settings/position/cancel', (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.prepare("UPDATE position_transfers SET status='cancelled', decided_at=? WHERE from_id=? AND status='pending'").run(Date.now(), req.user.id);
    back(res, 'Cancelled.');
  });
  // The approver decides.
  const queue = me => db.prepare("SELECT x.id, g.name AS gname, g.username AS gun, g.position, g.department, g.level, t.name AS tname, t.username AS tun FROM position_transfers x JOIN users g ON g.id=x.from_id JOIN users t ON t.id=x.to_id WHERE x.status='pending' ORDER BY x.id").all().filter(r => { const g = db.prepare('SELECT * FROM users WHERE id=(SELECT from_id FROM position_transfers WHERE id=?)').get(r.id); return mayDecide(me, g); });
  app.get('/position/transfers', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/position/transfers');
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id), rows = queue(me);
    const msg = req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : '';
    res.send(layout('Position hand-overs', `<p class="mut"><a href="/settings/profile">&larr; Profile</a></p><h1>Position hand-overs</h1>${msg}${rows.map(r => `<div class="card"><b>${esc(r.gname)}</b> <span class="mut">@${esc(r.gun || '')} ${esc(r.department || '')} ${r.level ? r.level + ' level' : ''}</span><p style="margin:6px 0">wants to hand <b>${esc(r.position)}</b> to <b>${esc(r.tname)}</b> <span class="mut">@${esc(r.tun || '')}</span></p>
<form method="post" action="/position/transfers/${r.id}/approve" style="display:inline"><button>Approve</button></form> <form method="post" action="/position/transfers/${r.id}/decline" style="display:inline"><button class="ghost">Decline</button></form></div>`).join('') || '<p class="mut">Nothing waiting.</p>'}`, req.user));
  });
  const decide = (yes) => (req, res) => {
    if (!req.user) return res.redirect('/login');
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const x = db.prepare("SELECT * FROM position_transfers WHERE id=? AND status='pending'").get(req.params.id);
    const to = m => res.redirect('/position/transfers?msg=' + encodeURIComponent(m));
    const g = x && db.prepare('SELECT * FROM users WHERE id=?').get(x.from_id), t = x && db.prepare('SELECT * FROM users WHERE id=?').get(x.to_id);
    if (!x || !g || !t || !mayDecide(me, g)) return to('You cannot act on that.');
    const done = st => db.prepare('UPDATE position_transfers SET status=?, decided_by=?, decided_at=? WHERE id=?').run(st, me.id, Date.now(), x.id);
    if (!yes) { done('declined'); notify([g.id], { title: 'Hand-over declined', body: 'Your request to hand over ' + g.position + ' was not approved.', url: '/settings/profile', tag: 'position' }); return to('Declined.'); }
    // Check again at the moment of approval: nothing may have changed since the request was made.
    if (!holds(g) || !inReach(g, t) || (t.position && t.position_status !== 'rejected') || t.role !== 'user') { done('void'); return to('That hand-over is no longer possible, so it was dropped.'); }
    if (!move(g, t)) return to('Could not do it. Try again.');
    done('approved');
    notify([t.id], { title: 'You are now ' + g.position, body: g.name + ' handed the position over to you.', url: '/settings', tag: 'position' });
    notify([g.id], { title: 'Position handed over', body: 'You are no longer ' + g.position + '.', url: '/settings', tag: 'position' });
    to('Approved. ' + t.name + ' now holds ' + g.position + '.');
  };
  app.post('/position/transfers/:id/approve', decide(true));
  app.post('/position/transfers/:id/decline', decide(false));
  module.exports.mayDecide = mayDecide; module.exports.queueSize = me => queue(me).length;
}
const card = (u, esc, db) => {
  if (!holds(u)) return '';
  const p = pendingOf(db, u.id);
  if (p) return `<form method="post" action="/settings/position/cancel" class="card"><h3 style="margin:0 0 6px">Hand over my position</h3><p class="mut" style="margin:0 0 8px">Waiting for approval. Nothing changes until it is approved.</p><button class="ghost">Cancel the request</button></form>`;
  return `<form method="post" action="/settings/position/handover" class="card" autocomplete="off"><h3 style="margin:0 0 6px">Hand over my position</h3>
<p class="mut" style="margin:0 0 8px">Pass ${esc(u.position)} to someone else. Your president approves it first. Then you lose everything that comes with it and they get it. There can only be one.</p>
<input name="to" placeholder="Their username" required maxlength="40" autocapitalize="none">
${u.gsignup ? '' : '<input type="password" name="password" placeholder="Your password" required>'}<button>Ask to hand over</button></form>`;
};
// A line for people who approve hand-overs.
const queueLink = (u, esc) => { try { const n = module.exports.queueSize ? module.exports.queueSize(u) : 0; return n ? `<a class="btn" href="/position/transfers">Position hand-overs waiting for you (${n})</a>` : ''; } catch { return ''; } };
module.exports = { card, queueLink, register, init };
