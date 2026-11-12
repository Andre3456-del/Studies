// Chat conversation pages and group info
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { CHAT_JS, avatarOr, bubbleHtml, clearUnreadMark, db, esc, friendActionHtml, friendIds, friendStatus, groupAvatarOr, groupMembers, isGroupAdmin, isGroupMember, isHiddenFor, isOnline, isRead, layout, markRead } = ctx;
  function withUnreadDivider(rows, me, mk) {
    const unread = rows.filter(m => m.sender_id !== me && !m.deleted_at && !isRead(m.id, me)), first = unread[0];
    return rows.map(m => (first && m.id === first.id ? `<div class="unread-div" id="unreadDiv">${unread.length} unread message${unread.length === 1 ? '' : 's'}</div>` : '') + mk(m)).join('');
  }
  const ic = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const MSG_SEL_BAR = `<div id="msgSelBar" class="sel-bar" style="display:none"><button type="button" id="mClose" title="Cancel">${ic('<path d="M6 6l12 12M18 6L6 18"/>')}</button><b id="msgSelCount">0</b><span class="sel-sp"></span>
<button type="button" id="mReply" title="Reply">${ic('<path d="M9 14L4 9l5-5M4 9h9a7 7 0 0 1 7 7v2"/>')}</button>
<button type="button" id="mCopy" title="Copy">${ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>')}</button>
<button type="button" id="mFwd" title="Forward">${ic('<path d="M15 14l5-5-5-5M20 9h-9a7 7 0 0 0-7 7v2"/>')}</button>
<button type="button" id="mStar" title="Star">${ic('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>')}</button>
<button type="button" id="mInfo" title="Message info">${ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>')}</button>
<button type="button" id="mDel" title="Delete">${ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>')}</button>
<button type="button" id="mMore" title="More">${ic('<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>')}</button>
<div id="msgMenu" class="sel-menu" style="display:none"><button type="button" id="mEdit">Edit</button></div></div>
<div id="reactBar" class="react-bar" style="display:none"></div>
<button type="button" id="toBtm" class="to-btm" style="display:none" aria-label="Scroll to latest message">${ic('<path d="M6 9l6 6 6-6"/>')}<b id="toBtmN" class="nbadge" style="display:none"></b></button>
<div id="sheet" class="sheet" style="display:none"><div id="sheetBox" class="sheet-box"></div></div>
<div id="toast" class="toast" style="display:none"></div>`;
  function threadPage(req, res, { isGroup, convId, title, headHtml, bubbles, lastId, self }) {
    const script = CHAT_JS.replace('__CTYPE__', isGroup ? 'group' : 'dm').replace('__CID__', String(convId)).replace('__MY__', String(req.user.id));
    res.send(layout(title, `${MSG_SEL_BAR}${headHtml}
${self ? '<style>.self-chat .tickwrap{display:none}</style>' : ''}<div id="thread" class="thread${self ? ' self-chat' : ''}"${self ? ' data-selfchat="1"' : ''} data-last-id="${lastId}">${bubbles || (self ? '<p class="mut hello">Notes, files and links to yourself. Only you can see this space.</p>' : '<p class="mut hello">Say hello 👋</p>')}</div>
<div id="panel" class="chat-panel" hidden><div class="ptabs"><button type="button" class="ghost on" data-tab="emoji">😊 Emoji</button><button type="button" class="ghost" data-tab="stickers">Stickers</button></div>
<div id="pEmoji" class="pbody"><div id="ecats" class="ecats"></div><div id="egrid" class="egrid"></div></div>
<div id="pStickers" class="pbody" hidden><label class="btn ghost st-add">+ Add sticker(s)<input type="file" id="stFile" accept="image/png,image/webp,image/gif,image/jpeg" multiple></label>
<label class="btn ghost st-add">+ Add a .zip of pictures<input type="file" id="stZip" accept=".zip,application/zip,application/x-zip-compressed"></label><div id="sgrid" class="sgrid"></div></div></div>
<div id="replyBar" class="reply-bar" hidden><div class="rp-body"><b id="replyWho" class="rp-name">Replying</b><span id="replyWhat" class="rp-text"></span></div><img id="replyThumb" class="rp-thumb" alt="" hidden><button type="button" id="replyCancel" class="link" aria-label="Cancel reply">&#10005;</button></div>
<form id="sendForm" class="chat-bar"><button type="button" id="panelBtn" class="ic" aria-label="Emoji and stickers">😊</button><label class="ic" id="attachBtn" aria-label="Attach a photo or file"><input type="file" id="fileInput" multiple style="display:none">📎</label><textarea id="msgInput" placeholder="Message" maxlength="2000" autocomplete="off" required rows="1"></textarea><button type="button" id="micBtn" class="ic" aria-label="Record a voice note">🎤</button><button class="sendb" aria-label="Send"><svg class="ico" viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button></form>
<div id="recBar" class="chat-bar rec" hidden><span class="rec-dot"></span><b id="recTime">0:00</b><span class="mut" style="flex:1">Recording&hellip;</span><button type="button" id="recCancel" class="ghost">Cancel</button><button type="button" id="recSend">Send</button></div>
<p id="upStatus" class="mut" style="margin:4px 0 0" hidden></p>
<script>${script}</script>`, req.user, { noAI: true, hideTop: true }));
  }

  app.get('/chat/:id', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const otherId = Number(req.params.id);
    const self = otherId === req.user.id; // your own space
    const other = db.prepare('SELECT id,name,title,avatar_mime,last_seen,hide_active FROM users WHERE id=?').get(otherId);
    if (!other) return res.status(404).send(layout('Not found', '<h2>User not found</h2>', req.user));
    if (!self && friendStatus(req.user.id, otherId) !== 'friends') return res.status(403).send(layout('Not friends yet', `<p class="mut"><a href="/chat">&larr; Chat</a></p><h2>You are not friends with ${esc(other.name)} yet</h2><p>${friendActionHtml(req.user.id, otherId)}</p>`, req.user));
    const rows = db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY id ASC').all(req.user.id, otherId, otherId, req.user.id)
      .filter(m => !isHiddenFor(m.id, req.user.id));
    const bubbles = withUnreadDivider(rows, req.user.id, m => bubbleHtml(m, req.user.id, false));
    markRead(rows, req.user.id); clearUnreadMark(req.user.id, 'dm', otherId);
    const lastId = rows.length ? rows[rows.length - 1].id : 0;
    const headHtml = `<div class="chat-head"><a href="/chat" class="link" style="font-size:20px">&larr;</a><a href="${self ? '/settings/profile' : '/u/' + other.id}" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none">${avatarOr(other)}<div><b>${esc(other.name)}${self ? ' (You)' : ''}</b>${other.title ? `<span class="role-tag">${esc(other.title)}</span>` : ''}<br><span class="mut" id="chatPresence" style="font-size:12px;min-height:14px;display:inline-block">${self ? 'Message yourself' : isOnline(other) ? 'online' : ''}</span></div></a></div>`;
    threadPage(req, res, { isGroup: false, convId: otherId, title: other.name, headHtml, bubbles, lastId, self });
  });

  app.get('/chat/group/:id', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const gid = Number(req.params.id);
    const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
    if (!g) return res.status(404).send(layout('Not found', '<h2>Group not found</h2>', req.user));
    if (!isGroupMember(gid, req.user.id)) return res.sendStatus(403);
    const members = groupMembers(gid);
    const byId = Object.fromEntries(members.map(m => [m.id, m.name]));
    const rows = db.prepare('SELECT * FROM messages WHERE group_id=? ORDER BY id ASC').all(gid).filter(m => !isHiddenFor(m.id, req.user.id)).map(m => ({ ...m, sender_name: byId[m.sender_id] || 'Former member' }));
    const bubbles = withUnreadDivider(rows, req.user.id, m => bubbleHtml(m, req.user.id, true));
    markRead(rows, req.user.id); clearUnreadMark(req.user.id, 'group', gid);
    const lastId = rows.length ? rows[rows.length - 1].id : 0;
    const headHtml = `<div class="chat-head"><a href="/chat" class="link" style="font-size:20px">&larr;</a><a href="/chat/group/${gid}/info" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none">${groupAvatarOr(g)}<div><b>${esc(g.name)}</b><br><span class="mut" style="font-size:12px">${members.length} members &middot; tap for group info</span></div></a></div>`;
    threadPage(req, res, { isGroup: true, convId: gid, title: g.name, headHtml, bubbles, lastId });
  });

  // Group info -- a full page styled after a familiar group-settings screen: big picture, name, member
  // count, then a plain list of members and actions. Any admin can rename, add/remove members, change the
  // picture, or make another member an admin too (a group can have more than one admin).
  app.get('/chat/group/:id/info', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const gid = Number(req.params.id);
    const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
    if (!g) return res.status(404).send(layout('Not found', '<h2>Group not found</h2>', req.user));
    if (!isGroupMember(gid, req.user.id)) return res.sendStatus(403);
    const members = groupMembers(gid);
    const amAdmin = isGroupAdmin(gid, req.user.id);
    const friendsNotIn = db.prepare('SELECT id,name FROM users WHERE id IN (' + (friendIds(req.user.id).join(',') || '0') + ') AND id NOT IN (' + (members.map(m => m.id).join(',') || '0') + ')').all();
    const avatarBlock = `<div style="text-align:center;margin:6px 0 18px">
${amAdmin ? `<label style="cursor:pointer;display:inline-block;position:relative">${groupAvatarOr(g, 96)}<form id="avF" method="post" action="/chat/group/${gid}/avatar" enctype="multipart/form-data" style="display:none"><input type="file" name="file" id="avI" accept="image/png,image/jpeg,image/webp"></form><span class="role-tag" style="position:absolute;bottom:0;right:-6px">Edit</span></label><script>document.getElementById('avI').addEventListener('change',function(){document.getElementById('avF').submit()})</script>`
      : groupAvatarOr(g, 96)}
<h1 style="margin:10px 0 2px;font-size:22px">${esc(g.name)}</h1><p class="mut" style="margin:0">Group &middot; ${members.length} members</p></div>`;
    const memberRow = m => {
      const isMe = m.id === req.user.id;
      const actions = !amAdmin || isMe ? '' : `${m.role === 'admin'
          ? `<form method="post" action="/chat/group/${gid}/demote/${m.id}"><button class="link">Remove admin</button></form>`
          : `<form method="post" action="/chat/group/${gid}/promote/${m.id}"><button class="link">Make admin</button></form>`}
<form method="post" action="/chat/group/${gid}/remove/${m.id}" onsubmit="return confirm('Remove ${esc(m.name)} from the group?')"><button class="link">Remove</button></form>`;
      return `<div class="card row">${avatarOr(m, 36)}<span style="flex:1">${esc(m.name)}${isMe ? ' (you)' : ''}${m.role === 'admin' ? ' <span class="role-tag">Group admin</span>' : ''}</span>${actions}</div>`;
    };
    res.send(layout(g.name, `<p class="mut" style="margin:0 0 4px"><a href="/chat/group/${gid}">&larr; Back to chat</a></p>
${avatarBlock}
${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
${amAdmin ? `<form method="post" action="/chat/group/${gid}/rename" class="card row"><input name="name" placeholder="Rename group" value="${esc(g.name)}" style="width:auto;flex:1"><button>Save</button></form>` : ''}
${amAdmin && friendsNotIn.length ? `<form method="post" action="/chat/group/${gid}/add" class="card row"><select name="user_id">${friendsNotIn.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select><button>Add to group</button></form>` : ''}
<p class="chat-label">${members.length} members</p>
${members.map(memberRow).join('')}
<form method="post" action="/chat/group/${gid}/leave" onsubmit="return confirm('Leave this group?')" style="margin-top:14px"><button class="link">Leave group</button></form>`, req.user));
  });
};
