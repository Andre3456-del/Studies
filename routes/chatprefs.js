// Chat list preferences: pin, archive, mute, favourites, mark as read
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db, friendStatus, isGroupMember, markRead } = ctx;
  // ---------- chat list preferences: pin (max 3), archive, mute, favourites, mark as unread, clear chat ----------
  const prefsOf = uid => { const m = {}; for (const p of db.prepare('SELECT * FROM chat_prefs WHERE user_id=?').all(uid)) m[p.kind + ':' + p.target_id] = p; return m; };
  const isMutedChat = (uid, kind, target) => !!db.prepare('SELECT 1 FROM chat_prefs WHERE user_id=? AND kind=? AND target_id=? AND muted=1').get(uid, kind, target);
  const setChatPref = (uid, kind, target, col, val) => {
    if (!['pinned_at', 'archived_upto', 'muted', 'favorite', 'unread_mark'].includes(col)) return;
    db.prepare('INSERT OR IGNORE INTO chat_prefs(user_id,kind,target_id) VALUES(?,?,?)').run(uid, kind, target);
    db.prepare(`UPDATE chat_prefs SET ${col}=? WHERE user_id=? AND kind=? AND target_id=?`).run(val, uid, kind, target);
  };
  const clearUnreadMark = (uid, kind, target) => db.prepare('UPDATE chat_prefs SET unread_mark=0 WHERE user_id=? AND kind=? AND target_id=? AND unread_mark=1').run(uid, kind, target);
  const convMessages = (uid, kind, target) => kind === 'group'
    ? db.prepare('SELECT * FROM messages WHERE group_id=?').all(target)
    : db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))').all(uid, target, target, uid);
  app.post('/api/chats/prefs', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const me = req.user.id, action = String((req.body && req.body.action) || '');
    const items = (Array.isArray(req.body && req.body.items) ? req.body.items : []).slice(0, 50).map(i => ({ kind: i && i.kind === 'group' ? 'group' : (i && i.kind === 'dm' ? 'dm' : ''), id: Number(i && i.id) })).filter(i => i.kind && Number.isSafeInteger(i.id) && i.id > 0)
      .filter(i => i.kind === 'group' ? isGroupMember(i.id, me) : (i.id !== me && friendStatus(me, i.id) === 'friends'));
    if (!items.length) return res.status(400).json({ error: 'Choose a chat first.' });
    if (action === 'pin') {
      const already = db.prepare('SELECT kind,target_id FROM chat_prefs WHERE user_id=? AND pinned_at IS NOT NULL').all(me).filter(p => !items.some(i => i.kind === p.kind && i.id === p.target_id)).length;
      if (already + items.length > 3) return res.status(400).json({ error: 'You can pin up to 3 chats.' });
    }
    const now = Date.now();
    for (const it of items) {
      if (action === 'pin') setChatPref(me, it.kind, it.id, 'pinned_at', now);
      else if (action === 'unpin') setChatPref(me, it.kind, it.id, 'pinned_at', null);
      else if (action === 'archive') { const last = convMessages(me, it.kind, it.id).reduce((n, m) => Math.max(n, m.id), 0); setChatPref(me, it.kind, it.id, 'archived_upto', last); setChatPref(me, it.kind, it.id, 'pinned_at', null); }
      else if (action === 'unarchive') setChatPref(me, it.kind, it.id, 'archived_upto', null);
      else if (action === 'mute') setChatPref(me, it.kind, it.id, 'muted', 1);
      else if (action === 'unmute') setChatPref(me, it.kind, it.id, 'muted', 0);
      else if (action === 'favorite') setChatPref(me, it.kind, it.id, 'favorite', 1);
      else if (action === 'unfavorite') setChatPref(me, it.kind, it.id, 'favorite', 0);
      else if (action === 'mark_unread') setChatPref(me, it.kind, it.id, 'unread_mark', 1);
      else if (action === 'mark_read') { setChatPref(me, it.kind, it.id, 'unread_mark', 0); markRead(convMessages(me, it.kind, it.id), me); }
      else if (action === 'clear') { // clear chat = hide every message for this person only (the other side keeps theirs)
        const msgs = convMessages(me, it.kind, it.id), hide = db.prepare('INSERT OR IGNORE INTO message_hidden(message_id,user_id) VALUES(?,?)');
        for (const m of msgs) hide.run(m.id, me);
        markRead(msgs, me); setChatPref(me, it.kind, it.id, 'unread_mark', 0);
      } else return res.status(400).json({ error: 'Unknown action.' });
    }
    res.json({ ok: true });
  });
  return { clearUnreadMark, isMutedChat, prefsOf };
};
