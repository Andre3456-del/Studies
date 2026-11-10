// Groups
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { avatarOr, db, esc, friendIds, layout, notify, upload } = ctx;
  // ---------- groups ----------
  const isGroupMember = (gid, uid) => !!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, uid);
  const isGroupAdmin = (gid, uid) => { const r = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, uid); return !!r && r.role === 'admin'; };
  const groupMembers = gid => db.prepare('SELECT u.id,u.name,u.avatar_mime,u.last_seen,gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? ORDER BY gm.role DESC, u.name').all(gid);
  app.get('/chat/group/new', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/chat/group/new');
    const friends = db.prepare('SELECT id,name,avatar_mime FROM users WHERE id IN (' + (friendIds(req.user.id).join(',') || '0') + ') ORDER BY name').all();
    if (!friends.length) return res.send(layout('New group', '<p class="mut"><a href="/chat">&larr; Chat</a></p><h1>New group</h1><p class="mut">Add some friends first -- a group is made from your friends list.</p>', req.user));
    res.send(layout('New group', `<p class="mut"><a href="/chat">&larr; Chat</a></p><h1>New group</h1>
<form method="post" action="/chat/group/new" class="card"><input name="name" placeholder="Group name" required maxlength="60">
${friends.map(f => `<label class="row" style="justify-content:flex-start;gap:10px"><input type="checkbox" name="member" value="${f.id}" style="width:auto">${avatarOr(f, 32)}${esc(f.name)}</label>`).join('')}
<button>Create group</button></form>`, req.user));
  });
  app.post('/chat/group/new', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/chat/group/new');
    const name = String(req.body.name || '').trim().slice(0, 60);
    const picked = (Array.isArray(req.body.member) ? req.body.member : req.body.member ? [req.body.member] : []).map(Number).filter(id => friendIds(req.user.id).includes(id));
    if (!name || !picked.length) return res.redirect('/chat/group/new');
    const info = db.prepare('INSERT INTO groups(name,created_by) VALUES(?,?)').run(name, req.user.id);
    const gid = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'admin')").run(gid, req.user.id);
    const addMember = db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'member')");
    for (const uid of picked) addMember.run(gid, uid);
    notify(picked, { title: 'Added to a group', body: `${req.user.name} added you to "${name}"`, url: '/chat/group/' + gid, tag: 'group' });
    res.redirect('/chat/group/' + gid);
  });
  app.post('/chat/group/:id/add', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id);
    if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
    const uid = Number(req.body.user_id);
    if (!friendIds(req.user.id).includes(uid)) return res.redirect(`/chat/group/${gid}?msg=` + encodeURIComponent('Only your friends can be added.'));
    db.prepare("INSERT OR IGNORE INTO group_members(group_id,user_id,role) VALUES(?,?,'member')").run(gid, uid);
    const g = db.prepare('SELECT name FROM groups WHERE id=?').get(gid);
    notify([uid], { title: 'Added to a group', body: `You were added to "${g.name}"`, url: '/chat/group/' + gid, tag: 'group' });
    res.redirect('/chat/group/' + gid);
  });
  app.post('/chat/group/:id/remove/:uid', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id), uid = Number(req.params.uid);
    if (!isGroupAdmin(gid, req.user.id) || uid === req.user.id) return res.sendStatus(403);
    db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, uid);
    res.redirect('/chat/group/' + gid);
  });
  app.post('/chat/group/:id/leave', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id);
    const wasAdmin = isGroupAdmin(gid, req.user.id); // must check BEFORE deleting -- the row won't exist after
    db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, req.user.id);
    if (wasAdmin) {
      const next = db.prepare('SELECT user_id FROM group_members WHERE group_id=? ORDER BY added_at, user_id LIMIT 1').get(gid);
      if (next) db.prepare("UPDATE group_members SET role='admin' WHERE group_id=? AND user_id=?").run(gid, next.user_id);
    }
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id=?').get(gid)) db.prepare('DELETE FROM groups WHERE id=?').run(gid);
    res.redirect('/chat');
  });
  app.post('/chat/group/:id/rename', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id);
    if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
    const name = String(req.body.name || '').trim().slice(0, 60);
    if (name) db.prepare('UPDATE groups SET name=? WHERE id=?').run(name, gid);
    res.redirect('/chat/group/' + gid);
  });
  // A group can have more than one admin -- any admin can make another member an admin too.
  app.post('/chat/group/:id/promote/:uid', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id), uid = Number(req.params.uid);
    if (!isGroupAdmin(gid, req.user.id) || !isGroupMember(gid, uid)) return res.sendStatus(403);
    db.prepare("UPDATE group_members SET role='admin' WHERE group_id=? AND user_id=?").run(gid, uid);
    notify([uid], { title: 'You are now a group admin', body: db.prepare('SELECT name FROM groups WHERE id=?').get(gid).name, url: '/chat/group/' + gid, tag: 'group' });
    res.redirect('/chat/group/' + gid);
  });
  app.post('/chat/group/:id/demote/:uid', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id), uid = Number(req.params.uid);
    if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
    const adminCount = db.prepare("SELECT COUNT(*) n FROM group_members WHERE group_id=? AND role='admin'").get(gid).n;
    if (adminCount <= 1) return res.redirect(`/chat/group/${gid}?msg=` + encodeURIComponent('A group needs at least one admin.'));
    db.prepare("UPDATE group_members SET role='member' WHERE group_id=? AND user_id=?").run(gid, uid);
    res.redirect('/chat/group/' + gid);
  });
  app.post('/chat/group/:id/avatar', upload.single('file'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const gid = Number(req.params.id);
    if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
    if (!req.file || !/^image\/(png|jpeg|webp)$/.test(req.file.mimetype)) return res.redirect(`/chat/group/${gid}?msg=` + encodeURIComponent('Choose a PNG, JPEG or WebP picture.'));
    db.prepare('UPDATE groups SET avatar_data=?, avatar_mime=? WHERE id=?').run(req.file.buffer, req.file.mimetype, gid);
    res.redirect('/chat/group/' + gid);
  });
  app.get('/group-avatar/:id', (req, res) => {
    const g = db.prepare('SELECT avatar_data, avatar_mime FROM groups WHERE id=?').get(req.params.id);
    if (!g || !g.avatar_data) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', g.avatar_mime || 'application/octet-stream');
    res.send(Buffer.from(g.avatar_data));
  });
  return { groupMembers, isGroupAdmin, isGroupMember };
};
