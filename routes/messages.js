// Chat messages: send, voice, stickers, attachments, media, polling, reactions, edit, delete
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { MEDIA_KINDS, callInfo, canSeeMsg, db, decryptBytes, decryptMsg, encryptBytes, encryptMsg, express, friendStatus, fs, groupMembers, isGroupMember, isHiddenFor, isMutedChat, isOnline, isPendingMedia, isStarred, limited, markDelivered, markRead, mediaSizeOf, messageReplyInfo, notify, path, reactionsFor, tickFor, upDir, upload } = ctx;
  // Your own space: messages you send to yourself are delivered and read the moment they are saved, so they never count as unread.
  db.exec('CREATE TRIGGER IF NOT EXISTS msg_self_read AFTER INSERT ON messages WHEN NEW.sender_id = NEW.recipient_id AND NEW.group_id IS NULL BEGIN INSERT OR IGNORE INTO message_reads(message_id, user_id) VALUES(NEW.id, NEW.sender_id); UPDATE messages SET delivered_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END');
  function validateReplyTarget(req, target) {
    const replyId = Number(req.body && req.body.reply_to_id) || null;
    if (!replyId) return { id: null };
    const parent = db.prepare('SELECT * FROM messages WHERE id=?').get(replyId);
    const sameConversation = parent && (target.group_id
      ? parent.group_id === target.group_id
      : !parent.group_id && ((parent.sender_id === req.user.id && parent.recipient_id === target.recipient_id) || (parent.sender_id === target.recipient_id && parent.recipient_id === req.user.id)));
    if (!sameConversation || parent.deleted_at || isHiddenFor(parent.id, req.user.id)) {
      return { error: 'Choose a message from this conversation to reply to.' };
    }
    return { id: replyId };
  }

  app.post('/api/messages/send', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const text = String((req.body && req.body.body) || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'Invalid message.' });
    const target = resolveTarget(req);
    if (!target) return res.status(400).json({ error: 'Invalid message.' });
    const reply = validateReplyTarget(req, target);
    if (reply.error) return res.status(400).json({ error: reply.error });
    const replyId = reply.id;
    const { body_enc, iv } = encryptMsg(text);
    const info = db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,reply_to_id) VALUES(?,?,?,?,?,?)').run(req.user.id, target.recipient_id, target.group_id, body_enc, iv, replyId);
    const row = db.prepare('SELECT created_at FROM messages WHERE id=?').get(info.lastInsertRowid);
    notifyNewMessage(req.user, target, text.slice(0, 120), Number(info.lastInsertRowid));
    res.json({ id: Number(info.lastInsertRowid), created_at: row.created_at });
  });

  // Resolves ?to= (a friend) or ?group= (a group you belong to) from either the JSON body or a multipart body, into {recipient_id, group_id}.
  function resolveTarget(req) {
    const b = req.body || {};
    if (b.group !== undefined && b.group !== '') {
      const gid = Number(b.group);
      if (!gid || !isGroupMember(gid, req.user.id)) return null;
      return { recipient_id: 0, group_id: gid };
    }
    const to = Number(b.to);
    if (!to || (to !== req.user.id && friendStatus(req.user.id, to) !== 'friends')) return null; // to === you is your own space ("You")
    return { recipient_id: to, group_id: null };
  }
  function notifyNewMessage(sender, target, preview, messageId) {
    if (!target.group_id && target.recipient_id === sender.id) return; // a note to yourself needs no notification
    if (target.group_id) {
      const others = db.prepare('SELECT user_id FROM group_members WHERE group_id=? AND user_id != ?').all(target.group_id, sender.id).map(r => r.user_id).filter(id => !isMutedChat(id, 'group', target.group_id));
      const g = db.prepare('SELECT name FROM groups WHERE id=?').get(target.group_id);
      if (others.length) notify(others, { title: g.name, body: `${sender.name}: ${preview}`, url: '/chat/group/' + target.group_id + (messageId ? '?reply_to=' + messageId : ''), tag: 'group-' + target.group_id, quickReply: { group: target.group_id, reply_to_id: messageId || null } });
    } else if (!isMutedChat(target.recipient_id, 'dm', sender.id)) {
      notify([target.recipient_id], { title: sender.name, body: preview, url: '/chat/' + sender.id + (messageId ? '?reply_to=' + messageId : ''), tag: 'dm-' + sender.id, quickReply: { to: sender.id, reply_to_id: messageId || null } });
    }
  }

  // Sends bytes with Range support -- iPhones refuse to play audio without it.
  function sendBytes(req, res, buf, mime) {
    // Only ordinary pictures, video, audio and PDFs are shown as such; anything else (HTML, SVG, scripts) is sent as a
    // plain download and fenced off, so a file someone sends in chat can never run on the site.
    const okType = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf)(;.*)?$/i.test(String(mime || ''));
    mime = okType ? mime : 'application/octet-stream';
    if (!/^application\/pdf/i.test(mime)) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
    if (m && (m[1] !== '' || m[2] !== '')) {
      const start = m[1] === '' ? Math.max(0, buf.length - Number(m[2])) : Number(m[1]);
      const end = (m[1] === '' || m[2] === '') ? buf.length - 1 : Math.min(Number(m[2]), buf.length - 1);
      if (start > end || start >= buf.length) { res.setHeader('Content-Range', `bytes */${buf.length}`); return res.sendStatus(416); }
      res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
      return res.status(206).send(buf.subarray(start, end + 1));
    }
    res.send(buf);
  }
  let lastPendingSweep = 0;
  const AUDIO_MIME = /^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,+-]+)?$/i;
  const STICKER_MIMES = ['image/png', 'image/webp', 'image/gif', 'image/jpeg'];
  const MAX_STICKERS = 60;
  const insertMedia = (from, target, kind, buf, mime, ms, name, replyId) => {
    const t = encryptMsg(''), m = encryptBytes(buf);
    const info = db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,kind,media_enc,media_iv,media_mime,media_ms,media_name,reply_to_id,media_size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(from, target.recipient_id, target.group_id, t.body_enc, t.iv, kind, m.enc, m.iv, mime, ms || null, name || null, replyId || null, buf.length);
    return { id: Number(info.lastInsertRowid), created_at: db.prepare('SELECT created_at FROM messages WHERE id=?').get(info.lastInsertRowid).created_at };
  };

  // Voice notes: a recording made in the chat page, stored encrypted like every other message.
  app.post('/api/messages/voice', upload.single('audio'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const target = resolveTarget(req);
    if (!target) return res.status(400).json({ error: 'Invalid message.' });
    if (!req.file || !AUDIO_MIME.test(req.file.mimetype)) return res.status(400).json({ error: 'That is not a voice recording.' });
    if (req.file.buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'That voice note is too long.' });
    if (limited('voice:' + req.user.id, 30, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
    const ms = Math.max(0, Math.min(Number(req.body.ms) || 0, 300000));
    const reply = validateReplyTarget(req, target);
    if (reply.error) return res.status(400).json({ error: reply.error });
    const result = insertMedia(req.user.id, target, 'voice', req.file.buffer, req.file.mimetype, ms, null, reply.id);
    notifyNewMessage(req.user, target, '🎤 Voice note', result.id);
    res.json(result);
  });
  // Stickers: sent from your own sticker board; the picture is copied into the message so it never breaks if you later delete it.
  app.post('/api/messages/sticker', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const target = resolveTarget(req);
    const sid = Number(req.body && req.body.sticker_id);
    const st = sid ? db.prepare('SELECT * FROM stickers WHERE id=? AND user_id=?').get(sid, req.user.id) : null;
    if (!target || !st) return res.status(400).json({ error: 'Invalid sticker.' });
    if (limited('sticker:' + req.user.id, 60, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
    const reply = validateReplyTarget(req, target);
    if (reply.error) return res.status(400).json({ error: reply.error });
    const result = insertMedia(req.user.id, target, 'sticker', Buffer.from(st.data), st.mime, null, null, reply.id);
    notifyNewMessage(req.user, target, 'Sticker', result.id);
    res.json(result);
  });
  // A sticker that only ever lived on the sender's device: the recipient still needs the bytes themselves, so
  // this uploads it fresh (no server-side sticker board involved) but keeps it tagged as a sticker to send.
  app.post('/api/messages/local-sticker', upload.single('sticker'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const target = resolveTarget(req);
    if (!target || !req.file || !STICKER_MIMES.includes(req.file.mimetype)) return res.status(400).json({ error: 'Invalid sticker.' });
    if (limited('sticker:' + req.user.id, 60, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
    const reply = validateReplyTarget(req, target);
    if (reply.error) return res.status(400).json({ error: reply.error });
    const result = insertMedia(req.user.id, target, 'sticker', req.file.buffer, req.file.mimetype, null, null, reply.id);
    notifyNewMessage(req.user, target, 'Sticker', result.id);
    res.json(result);
  });
  // A photo or any other file picked from the gallery or phone storage -- same encrypted storage as everything else.
  app.post('/api/messages/attachment', upload.single('file'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const target = resolveTarget(req);
    if (!target) return res.status(400).json({ error: 'Invalid message.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file first.' });
    if (limited('attach:' + req.user.id, 20, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
    const kind = /^image\//.test(req.file.mimetype) ? 'image' : /^video\//.test(req.file.mimetype) ? 'video' : 'file';
    const result = insertMedia(req.user.id, target, kind, req.file.buffer, req.file.mimetype, null, req.file.originalname.slice(0, 150));
    notifyNewMessage(req.user, target, kind === 'image' ? '📷 Photo' : kind === 'video' ? '🎬 Video' : `📄 ${req.file.originalname.slice(0, 60)}`, result.id);
    res.json(result);
  });
  // Two-step sending: the message is dropped on the server straight away as an empty placeholder (so it shows in the chat at once),
  // then the file itself is uploaded into it. Everyone in the chat sees "Sending..." until the file has arrived.
  app.post('/api/messages/attachment/start', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const target = resolveTarget(req);
    if (!target) return res.status(400).json({ error: 'Invalid message.' });
    if (limited('attach:' + req.user.id, 20, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
    const b = req.body || {}, size = Math.max(0, Math.floor(Number(b.size) || 0));
    if (size > 200 * 1024 * 1024) return res.status(413).json({ error: 'That file is too big (200 MB is the limit).' });
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(b.mime || '')) ? String(b.mime).slice(0, 100) : 'application/octet-stream';
    const name = String(b.name || 'file').replace(/[\r\n"]/g, '').slice(0, 150) || 'file';
    const kind = /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : 'file';
    const t = encryptMsg('');
    const info = db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,kind,media_mime,media_name,media_size) VALUES(?,?,?,?,?,?,?,?,?)').run(req.user.id, target.recipient_id, target.group_id, t.body_enc, t.iv, kind, mime, name, size);
    res.json({ id: Number(info.lastInsertRowid), kind, created_at: db.prepare('SELECT created_at FROM messages WHERE id=?').get(info.lastInsertRowid).created_at });
  });
  app.post('/api/upload/chunk/:id/:idx', express.raw({ type: () => true, limit: '3mb' }), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3999 || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Bad piece.' });
    const d = upDir(req.user.id, req.params.id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, idx + '.part'), req.body);
    res.json({ ok: true });
  });
  app.get('/api/upload/status/:id', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    let have = [];
    try { have = fs.readdirSync(upDir(req.user.id, req.params.id)).filter(n => /^\d+\.part$/.test(n)).map(n => parseInt(n, 10)); } catch (e) {}
    res.json({ have });
  });
  app.post('/api/messages/attachment/:id', upload.single('file'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const m = db.prepare('SELECT id,sender_id,recipient_id,group_id,kind,deleted_at,(media_enc IS NOT NULL) AS filled FROM messages WHERE id=?').get(Number(req.params.id));
    if (!m || m.sender_id !== req.user.id || m.deleted_at || m.filled || !MEDIA_KINDS.includes(m.kind)) return res.status(404).json({ error: 'This message is no longer waiting for a file.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file first.' });
    const kind = /^image\//.test(req.file.mimetype) ? 'image' : /^video\//.test(req.file.mimetype) ? 'video' : 'file';
    const enc = encryptBytes(req.file.buffer);
    db.prepare('UPDATE messages SET media_enc=?, media_iv=?, media_mime=?, media_size=?, media_name=?, kind=? WHERE id=?').run(enc.enc, enc.iv, req.file.mimetype, req.file.buffer.length, String(req.file.originalname || 'file').slice(0, 150), kind, m.id);
    notifyNewMessage(req.user, { recipient_id: m.recipient_id, group_id: m.group_id }, kind === 'image' ? '📷 Photo' : kind === 'video' ? '🎬 Video' : `📄 ${String(req.file.originalname).slice(0, 60)}`, m.id);
    res.json({ ok: true, id: m.id, kind, size: req.file.buffer.length });
  });
  // A voice note or sticker's file -- only people in that conversation can fetch it.
  app.get('/api/messages/media/:id', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
    if (!m || !m.media_enc) return res.sendStatus(404);
    const allowed = m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id);
    if (!allowed) return res.sendStatus(404);
    const buf = decryptBytes(m.media_enc, m.media_iv);
    if (!buf) return res.sendStatus(404);
    if (req.query.dl) {
      const ext = ((m.media_mime || '').split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5);
      res.setHeader('Content-Disposition', `attachment; filename="${String(m.media_name || ('studies-hub-' + (m.kind || 'file') + '.' + ext)).replace(/[^\w .()-]/g, '_')}"`);
    }
    sendBytes(req, res, buf, m.media_mime);
  });

  app.get('/api/messages/poll', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    markDelivered(req.user.id);
    const after = Number(req.query.after) || 0;
    let rows, meta = {};
    if (req.query.group) {
      const gid = Number(req.query.group);
      if (!gid || !isGroupMember(gid, req.user.id)) return res.status(400).json({ error: 'Missing conversation.' });
      rows = db.prepare('SELECT * FROM messages WHERE group_id=? AND id>? ORDER BY id ASC').all(gid, after);
      const names = Object.fromEntries(groupMembers(gid).map(m => [m.id, m.name]));
      rows.forEach(m => { meta[m.id] = { from_name: names[m.sender_id] }; });
    } else {
      const withId = Number(req.query.with || req.query.to);
      if (!withId) return res.status(400).json({ error: 'Missing conversation.' });
      rows = db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND id>? AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY id ASC')
        .all(after, req.user.id, withId, withId, req.user.id);
    }
    rows = rows.filter(m => !isHiddenFor(m.id, req.user.id));
    // Read receipts: a message only counts as viewed while the chat tab is actually showing (the page sends seen=0 when it is in the
    // background). The moment it is showing again, everything still unread in this conversation is marked read, so the sender's ticks turn green.
    if (req.query.seen !== '0') {
      markRead(rows, req.user.id);
      const unreadSql = 'AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id=messages.id AND r.user_id=?)';
      const waiting = req.query.group
        ? db.prepare('SELECT * FROM messages WHERE group_id=? AND sender_id!=? ' + unreadSql).all(Number(req.query.group), req.user.id, req.user.id)
        : db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND sender_id=? AND recipient_id=? ' + unreadSql).all(Number(req.query.with || req.query.to), req.user.id, req.user.id);
      markRead(waiting, req.user.id);
    }
    const messages = rows.map(m => ({
      id: m.id, from: m.sender_id, from_name: (meta[m.id] || {}).from_name, kind: m.kind || 'text',
      deleted: !!m.deleted_at, edited: !!m.edited_at,
      body: m.deleted_at ? '' : (m.kind === 'text' || !m.kind ? decryptMsg(m.body_enc, m.iv) : ''),
      ms: m.media_ms || 0, name: m.media_name || '', size: mediaSizeOf(m), pending: isPendingMedia(m), created_at: m.created_at,
      reactions: reactionsFor(m.id),
      reply: messageReplyInfo(m, req.user.id, !!m.group_id), fwd: !!m.forwarded, starred: isStarred(m.id, req.user.id), call: m.kind === 'call' ? callInfo(m, req.user.id) : undefined,
      tick: m.sender_id === req.user.id && !m.group_id ? tickFor(m, m.recipient_id) : undefined,
    }));
    // Tick refresh for messages I sent earlier in this conversation, so the sender's ticks update live even with no new messages.
    let receipts = [];
    if (!req.query.group) {
      const withId = Number(req.query.with || req.query.to);
      const mine = db.prepare("SELECT id,recipient_id,delivered_at FROM messages WHERE group_id IS NULL AND sender_id=? AND recipient_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30").all(req.user.id, withId);
      receipts = mine.map(m => ({ id: m.id, status: tickFor(m, m.recipient_id) }));
    }
    // Uploads the page is still waiting on: tell it which have now arrived (or were cancelled).
    const ready = [];
    String(req.query.pend || '').split(',').slice(0, 20).map(Number).filter(n => Number.isSafeInteger(n) && n > 0).forEach(id => {
      const r = db.prepare('SELECT id,sender_id,recipient_id,group_id,kind,media_size,deleted_at,(media_enc IS NOT NULL) AS filled FROM messages WHERE id=?').get(id);
      if (!r || r.deleted_at || !canSeeMsg(req.user.id, r)) ready.push({ id, gone: true });
      else if (r.filled) ready.push({ id, kind: r.kind, size: r.media_size || 0 });
    });
    if (Date.now() - lastPendingSweep > 60e3) { lastPendingSweep = Date.now(); db.prepare("DELETE FROM messages WHERE media_enc IS NULL AND kind IN ('image','video','file') AND created_at < datetime('now','-60 minutes')").run(); }
    let online = false;
    if (!req.query.group) { const o = db.prepare('SELECT last_seen,hide_active FROM users WHERE id=?').get(Number(req.query.with || req.query.to)); online = !!o && isOnline(o); }
    res.json({ messages, receipts, ready, online });
  });

  app.post('/api/messages/:id/react', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
    const allowed = m && (m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id));
    if (!allowed) return res.status(404).json({ error: 'Message not found.' });
    const emoji = String((req.body && req.body.emoji) || '').slice(0, 8);
    if (!emoji) return res.status(400).json({ error: 'Choose a reaction.' });
    const existing = db.prepare('SELECT emoji FROM message_reactions WHERE message_id=? AND user_id=?').get(m.id, req.user.id);
    if (existing && existing.emoji === emoji) db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=?').run(m.id, req.user.id);
    else db.prepare('INSERT INTO message_reactions(message_id,user_id,emoji) VALUES(?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji').run(m.id, req.user.id, emoji);
    res.json({ ok: true, reactions: reactionsFor(m.id) });
  });
  app.post('/api/messages/:id/edit', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
    if (!m || m.sender_id !== req.user.id) return res.status(404).json({ error: 'Message not found.' });
    if (m.kind !== 'text' && m.kind !== undefined) { /* only text is editable */ }
    if (m.kind && m.kind !== 'text') return res.status(400).json({ error: 'Only text messages can be edited.' });
    if (m.deleted_at) return res.status(400).json({ error: 'That message was deleted.' });
    const text = String((req.body && req.body.body) || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
    const { body_enc, iv } = encryptMsg(text);
    db.prepare('UPDATE messages SET body_enc=?, iv=?, edited_at=CURRENT_TIMESTAMP WHERE id=?').run(body_enc, iv, m.id);
    res.json({ ok: true });
  });
  app.post('/api/messages/:id/delete', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
    const allowed = m && (m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id));
    if (!allowed) return res.status(404).json({ error: 'Message not found.' });
    const scope = req.body && req.body.scope === 'everyone' ? 'everyone' : 'me';
    if (scope === 'everyone') {
      if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
      const t = encryptMsg('');
      // Remove reply links to this message so its deleted content is not left behind as a reply preview.
      db.prepare('UPDATE messages SET reply_to_id=NULL WHERE reply_to_id=?').run(m.id);
      db.prepare('UPDATE messages SET body_enc=?, iv=?, media_enc=NULL, media_iv=NULL, media_mime=NULL, media_ms=NULL, deleted_at=CURRENT_TIMESTAMP, deleted_by=? WHERE id=?').run(t.body_enc, t.iv, req.user.id, m.id);
      return res.json({ ok: true, created_at: m.created_at });
    }
    db.prepare('INSERT OR IGNORE INTO message_hidden(message_id,user_id) VALUES(?,?)').run(m.id, req.user.id);
    res.json({ ok: true });
  });
  return { MAX_STICKERS, STICKER_MIMES, insertMedia, notifyNewMessage, sendBytes };
};
