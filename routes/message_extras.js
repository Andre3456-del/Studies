// Starred, forwarded messages and message info
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db, decryptBytes, decryptMsg, encryptMsg, friendIds, friendStatus, groupMembers, isGroupMember, isHiddenFor, limited } = ctx;
  const canSeeMsg = (uid, m) => !!m && !isHiddenFor(m.id, uid) && (m.group_id ? isGroupMember(m.group_id, uid) : (m.sender_id === uid || m.recipient_id === uid));
  const cleanIds = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, max);
  app.post('/api/messages/star', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const on = !!(req.body && req.body.on), me = req.user.id;
    let n = 0;
    for (const id of cleanIds(req.body && req.body.ids, 50)) {
      const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
      if (!canSeeMsg(me, m) || m.deleted_at || m.kind === 'call') continue;
      if (on) db.prepare('INSERT OR IGNORE INTO message_stars(user_id,message_id) VALUES(?,?)').run(me, id);
      else db.prepare('DELETE FROM message_stars WHERE user_id=? AND message_id=?').run(me, id);
      n++;
    }
    res.json({ ok: true, count: n });
  });
  app.get('/api/chats/targets', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const me = req.user.id;
    const dms = db.prepare('SELECT id,name FROM users WHERE id IN (' + (friendIds(me).join(',') || '0') + ') ORDER BY name').all().map(u => ({ kind: 'dm', id: u.id, name: u.name }));
    const groups = db.prepare('SELECT g.id,g.name FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY g.name').all(me).map(g => ({ kind: 'group', id: g.id, name: g.name }));
    const self = { kind: 'dm', id: me, name: req.user.name + ' (You)' };
    res.json({ targets: [self].concat(groups, dms) });
  });
  app.post('/api/messages/forward', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const me = req.user.id;
    if (limited('fwd:' + me, 10, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
    const targets = (Array.isArray(req.body && req.body.targets) ? req.body.targets : []).slice(0, 5).map(t => t && t.kind === 'group'
      ? (isGroupMember(Number(t.id), me) ? { recipient_id: 0, group_id: Number(t.id) } : null)
      : (t && (Number(t.id) === me || friendStatus(me, Number(t.id)) === 'friends') ? { recipient_id: Number(t.id), group_id: null } : null)).filter(Boolean);
    const msgs = cleanIds(req.body && req.body.ids, 10).map(id => db.prepare('SELECT * FROM messages WHERE id=?').get(id)).filter(m => canSeeMsg(me, m) && !m.deleted_at).sort((a, b) => a.id - b.id);
    if (!targets.length || !msgs.length) return res.status(400).json({ error: 'Choose who to forward to.' });
    let count = 0;
    for (const t of targets) for (const m of msgs) {
      let newId = 0, preview = '';
      if (m.kind === 'text' || !m.kind) {
        const text = decryptMsg(m.body_enc, m.iv), enc = encryptMsg(text);
        newId = Number(db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,forwarded) VALUES(?,?,?,?,?,1)').run(me, t.recipient_id, t.group_id, enc.body_enc, enc.iv).lastInsertRowid);
        preview = text.slice(0, 120);
      } else if (m.media_enc) {
        const buf = decryptBytes(m.media_enc, m.media_iv);
        if (!buf) continue;
        newId = ctx.insertMedia(me, t, m.kind, buf, m.media_mime, m.media_ms, m.media_name, null).id;
        db.prepare('UPDATE messages SET forwarded=1 WHERE id=?').run(newId);
        preview = m.kind === 'voice' ? '🎤 Voice note' : m.kind === 'sticker' ? 'Sticker' : m.kind === 'image' ? '📷 Photo' : m.kind === 'video' ? '🎬 Video' : `📄 ${(m.media_name || 'File').slice(0, 60)}`;
      } else continue;
      count++;
      ctx.notifyNewMessage(req.user, t, '↪ ' + preview, newId);
    }
    res.json({ ok: true, count });
  });
  // Message info: who has received / read a message you sent.
  app.get('/api/messages/:id/info', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const me = req.user.id, m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
    if (!canSeeMsg(me, m) || m.sender_id !== me || m.deleted_at) return res.sendStatus(404);
    if (m.group_id) {
      const reads = Object.fromEntries(db.prepare('SELECT user_id,read_at FROM message_reads WHERE message_id=?').all(m.id).map(r => [r.user_id, r.read_at]));
      const others = groupMembers(m.group_id).filter(u => u.id !== me);
      return res.json({ group: true, sent: m.created_at, read: others.filter(u => reads[u.id]).map(u => ({ name: u.name, at: reads[u.id] })), waiting: others.filter(u => !reads[u.id]).map(u => u.name) });
    }
    const r = db.prepare('SELECT read_at FROM message_reads WHERE message_id=? AND user_id=?').get(m.id, m.recipient_id);
    res.json({ group: false, sent: m.created_at, delivered: m.delivered_at || (r ? r.read_at : null), read: r ? r.read_at : null });
  });
  return { canSeeMsg };
};
