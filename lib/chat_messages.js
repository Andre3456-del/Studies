// Chat messages: ticks, reactions, edit, delete (shared by DMs and groups)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db, decryptMsg, esc, isReachable, linkify } = ctx;
  // ---------- messages: ticks, reactions, edit, delete (shared by DMs and groups) ----------
  const lastMessageWith = (me, other) => db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY id DESC LIMIT 1').get(me, other, other, me);
  const lastGroupMessage = gid => db.prepare('SELECT * FROM messages WHERE group_id=? ORDER BY id DESC LIMIT 1').get(gid);
  const isRead = (mid, uid) => !!db.prepare('SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?').get(mid, uid);
  const isHiddenFor = (mid, uid) => !!db.prepare('SELECT 1 FROM message_hidden WHERE message_id=? AND user_id=?').get(mid, uid);
  // Delivered is permanent: the first time the recipient is online after a message was sent, it is stamped on the message, so the
  // double tick never goes back to a single tick when they go offline again (or when the page is refreshed).
  function markDelivered(recipientId) {
    db.prepare('UPDATE messages SET delivered_at=CURRENT_TIMESTAMP WHERE recipient_id=? AND group_id IS NULL AND delivered_at IS NULL').run(recipientId);
  }
  function tickFor(m, recipientId) {
    if (isRead(m.id, recipientId)) return 'read';
    if (m.delivered_at) return 'delivered';
    const other = db.prepare('SELECT last_seen FROM users WHERE id=?').get(recipientId);
    if (other && isReachable(other)) { markDelivered(recipientId); return 'delivered'; }
    return 'sent';
  }
  const fmtCallSecs = n => n >= 60 ? `${Math.floor(n / 60)} min${n % 60 ? ` ${n % 60} sec` : ''}` : `${n} sec`;
  function callInfo(m, meId) {
    let d = {}; try { d = JSON.parse(decryptMsg(m.body_enc, m.iv)); } catch (e) { /* unreadable log line */ }
    const video = d.k === 'video', name = video ? 'Video call' : 'Voice call', mine = m.sender_id === meId;
    const out = { icon: video ? '📹' : '📞', bad: false };
    if (d.s === 'ended') out.text = `${name} · ${fmtCallSecs(d.d || 1)}`;
    else if (d.s === 'declined') out.text = `${name} · Declined`;
    else if (mine) out.text = `${name} · No answer`;
    else { out.text = `Missed ${video ? 'video' : 'voice'} call`; out.bad = true; }
    return out;
  }
  const snipFor = (m, me) => m.kind === 'call' ? (c => c.icon + ' ' + c.text)(callInfo(m, me)) : snippetOf(m);
  const isStarred = (mid, uid) => !!db.prepare('SELECT 1 FROM message_stars WHERE message_id=? AND user_id=?').get(mid, uid);
  const tickSpan = st => ({ read: '<span class="tick tick-read">&#10003;&#10003;</span>', delivered: '<span class="tick tick-un">&#10003;&#10003;</span>', sent: '<span class="tick tick-un">&#10003;</span>' })[st] || '';
  function reactionsFor(mid) {
    const rows = db.prepare('SELECT emoji, COUNT(*) n FROM message_reactions WHERE message_id=? GROUP BY emoji').all(mid);
    const out = {}; for (const r of rows) out[r.emoji] = r.n; return out;
  }
  function markRead(rows, viewerId) {
    const ins = db.prepare('INSERT OR IGNORE INTO message_reads(message_id,user_id) VALUES(?,?)');
    for (const m of rows) if (m.sender_id !== viewerId && !isRead(m.id, viewerId)) ins.run(m.id, viewerId);
  }
  const clock = iso => new Date(iso + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function fmtBytes(n) { n = Number(n) || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'; return (n / 1073741824).toFixed(1) + ' GB'; }
  const MEDIA_KINDS = ['image', 'video', 'file'];
  const mediaSizeOf = m => m.media_size || (m.media_enc ? Math.max(0, m.media_enc.length - 16) : 0);
  const isPendingMedia = m => MEDIA_KINDS.includes(m.kind) && !m.media_enc && !m.deleted_at;
  const MEDIA_ICON = { image: '&#128444;&#65039;', video: '&#127916;', sticker: '&#128512;' };
  const MEDIA_LABEL = { image: 'Photo', video: 'Video', sticker: 'Sticker' };
  const fmtDur = ms => { const t = Math.round((ms || 0) / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const fmtSize = b => b == null ? '' : b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / (1024 * 1024)).toFixed(1) + ' MB';
  const snippetOf = m => m.deleted_at ? 'Message deleted' : m.kind === 'call' ? '📞 Call' : m.kind === 'voice' ? '🎤 Voice note' : m.kind === 'sticker' ? 'Sticker' : m.kind === 'image' ? '📷 Photo' : m.kind === 'video' ? '🎬 Video' : m.kind === 'file' ? `📄 ${m.media_name || 'File'}` : decryptMsg(m.body_enc, m.iv).slice(0, 40);
  function messageReplyInfo(m, viewerId, isGroup) {
    if (!m.reply_to_id || m.deleted_at) return null;
    const parent = db.prepare('SELECT * FROM messages WHERE id=?').get(m.reply_to_id);
    if (!parent || parent.deleted_at) return null;
    const sameConversation = isGroup
      ? !!m.group_id && parent.group_id === m.group_id
      : !m.group_id && !parent.group_id && (
          (parent.sender_id === m.sender_id && parent.recipient_id === m.recipient_id) ||
          (parent.sender_id === m.recipient_id && parent.recipient_id === m.sender_id)
        );
    if (!sameConversation || isHiddenFor(parent.id, viewerId)) return null;
    const author = db.prepare('SELECT name FROM users WHERE id=?').get(parent.sender_id);
    return {
      id: parent.id,
      from_name: parent.sender_id === viewerId ? 'You' : (author ? author.name : 'Member'),
      text: parent.kind === 'voice' ? '🎤 Voice note · ' + fmtDur(parent.media_ms) : snippetOf(parent),
      kind: parent.kind || 'text'
    };
  }
  function replyPreviewHtml(m, viewerId, isGroup) {
    const reply = messageReplyInfo(m, viewerId, isGroup);
    if (!reply) return '';
    const thumb = MEDIA_ICON[reply.kind] ? `<span class="rp-ico">${MEDIA_ICON[reply.kind]}</span>` : '';
    return `<div class="reply-preview" data-reply-to="${reply.id}"><div class="rp-body"><b class="rp-name">${esc(reply.from_name)}</b><span class="rp-text">${esc(reply.text)}</span></div>${thumb}</div>`;
  }
  function bubbleHtml(m, meId, isGroup) {
    const side = m.sender_id === meId ? 'me' : 'them';
    if (m.kind === 'call') { const c = callInfo(m, meId); return `<div class="call-entry${c.bad ? ' missed' : ''}" data-id="${m.id}" data-kind="call"><span>${c.icon}</span><span>${esc(c.text)}</span><time data-t="${esc(m.created_at)}">${clock(m.created_at)}</time></div>`; }
    const reactions = reactionsFor(m.id);
    const reactHtml = Object.keys(reactions).length ? `<div class="reactions">${Object.entries(reactions).map(([e, n]) => `<span class="rchip">${e} ${n}</span>`).join('')}</div>` : '';
    const senderTag = isGroup && side === 'them' ? `<div class="sender-name">${esc(m.sender_name || '')}</div>` : '';
    const tick = side === 'me' && !isGroup ? `<span class="tickwrap" data-tick="1">${(() => { const html = { read: ' <span class="tick tick-read">&#10003;&#10003;</span>', delivered: ' <span class="tick tick-un">&#10003;&#10003;</span>', sent: ' <span class="tick tick-un">&#10003;</span>' }; return html[tickFor(m, m.recipient_id)] || ''; })()}</span>` : '';
    const fwd = m.forwarded ? '<div class="fwd">&#8618; Forwarded</div>' : '';
    const starred = isStarred(m.id, meId), starAttr = starred ? ' data-starred="1"' : '', starMark = starred ? '<span class="starmark"> &#9733;</span>' : '';
    if (m.deleted_at) return `<div class="bubble ${side} deleted" data-id="${m.id}"${starAttr} data-kind="${m.kind}">${senderTag}<span class="mut">This message was deleted</span><time data-t="${esc(m.created_at)}">${clock(m.created_at)}</time></div>`;
    if (m.kind === 'voice') return `<div class="bubble ${side}" data-id="${m.id}"${starAttr} data-kind="voice">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}<audio controls preload="none" src="/api/messages/media/${m.id}"></audio>${reactHtml}<time data-t="${esc(m.created_at)}" data-pre="🎤 ${fmtDur(m.media_ms)} &middot; ">🎤 ${fmtDur(m.media_ms)} &middot; ${clock(m.created_at)}${starMark}${tick}</time></div>`;
    const mcard = `<div class="mcard mc-${m.kind}" data-mid="${m.id}" data-mk="${m.kind}" data-size="${mediaSizeOf(m)}" data-name="${esc(m.media_name || '')}"${isPendingMedia(m) ? ' data-pending="1"' : ''}><div class="mc-ph"><span class="mc-ico">${MEDIA_ICON[m.kind] || ''}</span><span class="mc-lbl">${MEDIA_LABEL[m.kind] || ''} &middot; ${fmtBytes(mediaSizeOf(m))}</span></div></div>`;
    const stamp = `<time data-t="${esc(m.created_at)}">${clock(m.created_at)}${starMark}${tick}</time>`;
    if (m.kind === 'sticker') return `<div class="sticker-msg ${side}" data-id="${m.id}"${starAttr} data-kind="sticker">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}${mcard}${side === 'them' ? `<button type="button" class="link save-st" data-save="${m.id}">+ Save sticker</button>` : ''}${reactHtml}${stamp}</div>`;
    if (m.kind === 'image' || m.kind === 'video') return `<div class="bubble ${side} img-msg" data-id="${m.id}"${starAttr} data-kind="${m.kind}">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}${mcard}${reactHtml}${stamp}</div>`;
    if (m.kind === 'file') {
      const nm = esc(m.media_name || 'File'), sz = fmtBytes(mediaSizeOf(m));
      const chip = isPendingMedia(m)
        ? `<div class="file-chip pending" data-fid="${m.id}"><span class="fc-ico">&#128196;</span><span class="fc-main"><span class="file-name">${nm}</span><span class="fc-size">${sz} &middot; Sending&hellip;</span></span><span class="mc-spin"></span></div>`
        : `<a class="file-chip" href="/api/messages/media/${m.id}?dl=1" download="${nm}"><span class="fc-ico">&#128196;</span><span class="fc-main"><span class="file-name">${nm}</span><span class="fc-size">${sz}</span></span><span class="fc-dl">&#11015;</span></a>`;
      return `<div class="bubble ${side}" data-id="${m.id}"${starAttr} data-kind="file">${senderTag}${fwd}${chip}${reactHtml}${stamp}</div>`;
    }
    return `<div class="bubble ${side}" data-id="${m.id}"${starAttr} data-kind="text">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}<span class="msg-text">${linkify(decryptMsg(m.body_enc, m.iv))}</span>${m.edited_at ? '<span class="mut"> (edited)</span>' : ''}${reactHtml}<time data-t="${esc(m.created_at)}">${clock(m.created_at)}${starMark}${tick}</time></div>`;
  }
  return { MEDIA_KINDS, bubbleHtml, callInfo, fmtBytes, isHiddenFor, isPendingMedia, isRead, isStarred, markDelivered, markRead, mediaSizeOf, messageReplyInfo, reactionsFor, snipFor, snippetOf, tickFor, tickSpan };
};
