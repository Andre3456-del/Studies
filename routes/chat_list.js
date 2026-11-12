// Starred messages page and the chat list
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { atLink, avatarOr, badgeText, canSeeMsg, cleanUsername, db, decryptMsg, esc, friendActionHtml, friendIds, groupAvatarOr, isCentral, layout, pendingReceivedCount, prefsOf, snipFor, snippetOf, tickFor, tickSpan, timeAgo } = ctx;
  app.get('/chat/starred', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/chat/starred');
    const me = req.user.id;
    const rows = db.prepare('SELECT m.* FROM message_stars s JOIN messages m ON m.id=s.message_id WHERE s.user_id=? ORDER BY m.id DESC LIMIT 200').all(me).filter(m => canSeeMsg(me, m) && !m.deleted_at);
    const nameOf = id => (db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name || 'Someone';
    const items = rows.map(m => {
      const other = m.group_id ? null : (m.sender_id === me ? m.recipient_id : m.sender_id);
      const where = m.group_id ? (db.prepare('SELECT name FROM groups WHERE id=?').get(m.group_id) || {}).name || 'Group' : nameOf(other);
      const href = m.group_id ? `/chat/group/${m.group_id}` : `/chat/${other}`;
      const body = m.kind === 'text' || !m.kind ? esc(decryptMsg(m.body_enc, m.iv).slice(0, 300)) : snippetOf(m);
      return `<div class="card star-item" data-id="${m.id}"><a href="${href}" style="color:inherit;display:block"><b>${m.sender_id === me ? 'You' : esc(nameOf(m.sender_id))}</b> <span class="mut">&rsaquo; ${esc(where)} &middot; ${timeAgo(m.created_at)}</span><div style="margin-top:4px;white-space:pre-wrap;word-break:break-word">${body}</div></a><button type="button" class="link unstar" data-id="${m.id}">Remove star</button></div>`;
    }).join('') || '<p class="mut">No starred messages yet. Press and hold a message in a chat, then tap the star.</p>';
    res.send(layout('Starred messages', `<p class="mut" style="margin:0 0 4px"><a href="/chat">&larr; Chat</a></p><h1>Starred messages</h1>${items}<script>document.addEventListener('click',function(e){var b=e.target.closest('.unstar');if(!b)return;fetch('/api/messages/star',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[Number(b.getAttribute('data-id'))],on:false})}).then(function(){var c=b.closest('.star-item');if(c)c.remove()})})</script>`, req.user));
  });

  app.get('/chat', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/chat');
    const me = req.user.id, tab = req.query.tab === 'find' ? 'find' : 'friends';
    const reqCount = pendingReceivedCount(me);
    const tabs = `<div class="row" style="gap:0;border-bottom:1px solid var(--line);margin-bottom:14px">
<a class="tab-link${tab === 'friends' ? ' active' : ''}" href="/chat">Chats</a>
<a class="tab-link${tab === 'find' ? ' active' : ''}" href="/chat?tab=find">Find people${reqCount ? ` <b class="nbadge">${badgeText(reqCount)}</b>` : ''}</a>
</div>`;
    if (tab === 'find') {
      const q = String(req.query.q || '').trim();
      let results = '';
      if (q) {
        const rows = db.prepare("SELECT id,name,username,avatar_mime FROM users WHERE id != ? AND is_lecturer=0 AND role!='uniadmin' AND (lower(username) LIKE ? OR lower(name) LIKE ?) LIMIT 20")
          .all(me, '%' + cleanUsername(q) + '%', '%' + q.toLowerCase() + '%');
        results = rows.length ? rows.map(u => `<div class="chat-item row">${avatarOr(u)}<span class="meta" style="flex:1"><b><a href="/u/${u.id}" style="color:inherit">${esc(u.name)}</a></b><span>${u.username ? atLink(u.username) : ''}</span></span>${friendActionHtml(me, u.id)}</div>`).join('')
          : '<p class="mut">No one found. Try their exact @username.</p>';
      }
      const pending = db.prepare("SELECT u.id,u.name,u.username,u.avatar_mime FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.addressee_id=? AND f.status='pending' ORDER BY f.id DESC").all(me);
      const pendingHtml = pending.length ? `<p class="chat-label">Friend requests</p>${pending.map(u => `<div class="chat-item row">${avatarOr(u)}<span class="meta" style="flex:1"><b>${esc(u.name)}</b><span>${u.username ? atLink(u.username) : ''}</span></span>
<form method="post" action="/api/friends/${u.id}/accept" style="display:inline"><button>Accept</button></form>
<form method="post" action="/api/friends/${u.id}/decline" style="display:inline"><button class="link">Decline</button></form></div>`).join('')}` : '';
      return res.send(layout('Find people', `<h1>Chat</h1>${tabs}${pendingHtml}<form method="get" action="/chat"><input type="hidden" name="tab" value="find"><input name="q" value="${esc(q)}" placeholder="Search students and admins by @username or name" autocomplete="off"><button class="ghost">Search</button></form>${results}`, req.user));
    }
    const prefs = prefsOf(me);
    const friends = db.prepare('SELECT id,name,avatar_mime,last_seen,hide_active FROM users WHERE id IN (' + (friendIds(me).concat(me).join(',') || '0') + ')').all(); // you are in your own list too: your own space
    const lastVisible = (kind, id) => kind === 'group'
      ? db.prepare('SELECT * FROM messages WHERE group_id=? AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY id DESC LIMIT 1').get(id, me)
      : db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY id DESC LIMIT 1').get(me, id, id, me, me);
    const items = [];
    for (const u of friends) {
      const m = lastVisible('dm', u.id), p = prefs['dm:' + u.id] || {};
      const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE group_id IS NULL AND sender_id=? AND recipient_id=? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?) AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?)").get(u.id, me, me, me).n;
      const mine = m && m.sender_id === me && u.id !== me && !m.deleted_at && m.kind !== 'call' ? tickSpan(tickFor(m, u.id)) + ' ' : '';
      items.push({ kind: 'dm', id: u.id, name: u.id === me ? u.name + ' (You)' : u.name, av: avatarOr(u), m, p, unread, dot: null,
        sub: m ? `${mine}${snipFor(m, me)} &middot; ${timeAgo(m.created_at)}` : (u.id === me ? 'Message yourself' : 'No messages yet') });
    }
    for (const g of db.prepare('SELECT g.id,g.name,g.avatar_mime FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=?').all(me)) {
      const m = lastVisible('group', g.id), p = prefs['group:' + g.id] || {};
      const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE group_id=? AND sender_id != ? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?) AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?)").get(g.id, me, me, me).n;
      items.push({ kind: 'group', id: g.id, name: g.name, av: groupAvatarOr(g), m, p, unread, dot: null, sub: m ? `${snipFor(m, me)} &middot; ${timeAgo(m.created_at)}` : 'No messages yet' });
    }
    for (const it of items) it.archived = it.p.archived_upto != null && (!it.m || it.m.id <= it.p.archived_upto); // a new message brings an archived chat back
    items.sort((a, b) => ((b.p.pinned_at ? 1 : 0) - (a.p.pinned_at ? 1 : 0)) || ((b.p.pinned_at || 0) - (a.p.pinned_at || 0)) || ((b.m ? b.m.id : 0) - (a.m ? a.m.id : 0)) || a.name.localeCompare(b.name));
    const itemHtml = it => {
      const href = it.kind === 'group' ? `/chat/group/${it.id}` : `/chat/${it.id}`, p = it.p;
      const badge = it.unread ? `<b class="nbadge${p.muted ? ' nb-muted' : ''}">${badgeText(it.unread)}</b>` : (p.unread_mark ? '<b class="nbadge nb-dot"></b>' : '');
      const icons = (p.muted ? '<span class="ci-ic" title="Muted">&#128277;</span>' : '') + (p.pinned_at ? '<span class="ci-ic" title="Pinned">&#128204;</span>' : '');
      return `<a class="chat-item" href="${href}" data-key="${it.kind}:${it.id}" data-kind="${it.kind}" data-id="${it.id}" data-name="${esc(it.name.toLowerCase())}" data-unread="${it.unread}" data-mark="${p.unread_mark ? 1 : 0}" data-fav="${p.favorite ? 1 : 0}" data-pinned="${p.pinned_at ? 1 : 0}" data-muted="${p.muted ? 1 : 0}" data-archived="${it.archived ? 1 : 0}"><span class="av-wrap" style="position:relative">${it.av}${it.dot ? `<span class="dot" style="position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--bg);background:${it.dot}"></span>` : ''}</span><span class="meta"><b>${esc(it.name)}</b><span>${it.sub}</span></span><span class="ci-end">${icons}${badge}</span></a>`;
    };
    const archivedCount = items.filter(i => i.archived).length;
    const listHtml = `<a class="chat-item arch-row" href="#" id="archRow" data-count="${archivedCount}"><span class="arch-ic">&#128229;</span><span class="meta"><b>Archived</b></span><span class="ci-end"><span class="ci-ic" id="archCount">${archivedCount}</span></span></a>`
      + items.map(itemHtml).join('');
    const svg = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const listScript = `(function(){
var list=document.getElementById('chatList');if(!list)return;
var bar=document.getElementById('selBar'),cnt=document.getElementById('selCount'),menu=document.getElementById('selMenu'),search=document.getElementById('chatSearch'),empty=document.getElementById('chatEmpty'),archHead=document.getElementById('archHead'),chips=document.getElementById('chipRow');
var sel={},filter='all',query='',arch=false,pressed=false,timer=null,sx=0,sy=0;
function pending(){return new Promise(function(res){try{var rq=indexedDB.open('shq-pending',2);
rq.onupgradeneeded=function(){var d=rq.result;if(!d.objectStoreNames.contains('msgs'))d.createObjectStore('msgs',{keyPath:'id',autoIncrement:true});if(!d.objectStoreNames.contains('uploads'))d.createObjectStore('uploads',{keyPath:'id',autoIncrement:true})};
rq.onsuccess=function(){try{var g=rq.result.transaction('msgs','readonly').objectStore('msgs').getAll();g.onsuccess=function(){res(g.result||[])};g.onerror=function(){res([])}}catch(e){res([])}};rq.onerror=function(){res([])}}catch(e){res([])}})}
var CLOCK='<svg width="14" height="14" viewBox="0 0 24 24" style="vertical-align:-2px"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function outbox(){return new Promise(function(res){try{var rq=indexedDB.open('shq-outbox',1);rq.onupgradeneeded=function(){rq.result.createObjectStore('items',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){try{var g=rq.result.transaction('items','readonly').objectStore('items').getAll();g.onsuccess=function(){res(g.result||[])};g.onerror=function(){res([])}}catch(e){res([])}};rq.onerror=function(){res([])}}catch(e){res([])}})}
function mark(){Promise.all([pending(),window.StudiesApp?outbox():Promise.resolve([])]).then(function(r){var latest={};
r[0].forEach(function(it){var p=it.payload||{};if(!p.body)return;latest[p.group?'/chat/group/'+p.group:'/chat/'+p.to]=p.body});
r[1].forEach(function(it){var c=String(it.conv||'').split(':'),h=c[0]==='group'?'/chat/group/'+c[1]:'/chat/'+c[1];latest[h]=it.type==='voice'?'\\uD83C\\uDFA4 Voice note':(it.type==='sticker'||it.type==='lsticker')?'Sticker':(it.name||'File')});
Array.prototype.forEach.call(list.querySelectorAll('a.chat-item'),function(a){var b=latest[a.getAttribute('href')];if(!b)return;var sub=a.querySelector('.meta span');if(!sub)return;sub.innerHTML='';var c=document.createElement('span');c.className='tick tick-queued';c.title='Waiting for a connection';c.innerHTML=CLOCK;sub.appendChild(c);sub.appendChild(document.createTextNode(' '+String(b).slice(0,40)))})})}
function rows(){return Array.prototype.slice.call(list.querySelectorAll('a.chat-item[data-key]'))}
function keys(){return Object.keys(sel)}
function rowOf(k){return list.querySelector('a.chat-item[data-key="'+k+'"]')}
function applyView(){
var shown=0,ar=document.getElementById('archRow'),ac=ar?parseInt(ar.getAttribute('data-count'),10)||0:0;
rows().forEach(function(a){var ok=arch?a.getAttribute('data-archived')==='1':a.getAttribute('data-archived')==='0';
if(ok&&filter==='unread')ok=(parseInt(a.getAttribute('data-unread'),10)>0||a.getAttribute('data-mark')==='1');
if(ok&&filter==='fav')ok=a.getAttribute('data-fav')==='1';
if(ok&&filter==='groups')ok=a.getAttribute('data-kind')==='group';
if(ok&&query)ok=a.getAttribute('data-name').indexOf(query)>-1;
a.style.display=ok?'':'none';if(ok)shown++;a.classList.toggle('sel',!!sel[a.getAttribute('data-key')])});
if(ar){ar.style.display=(!arch&&ac>0&&filter==='all'&&!query)?'':'none'}
if(archHead)archHead.style.display=arch?'':'none';
if(chips)chips.style.display=arch?'none':'';
if(empty){empty.style.display=shown?'none':'';empty.textContent=arch?'No archived chats.':(query?'No chats match your search.':(filter==='unread'?'No unread chats.':(filter==='fav'?'No favorites yet. Select a chat and use the menu to add one.':(filter==='groups'?'No groups yet.':'No chats yet. Find friends in the other tab.'))))}
renderBar()}
function renderBar(){var n=keys().length;bar.style.display=n?'flex':'none';if(!n){menu.style.display='none';return}
cnt.textContent=n;var rs=keys().map(rowOf).filter(Boolean);
function all(attr){return rs.length&&rs.every(function(a){return a.getAttribute(attr)==='1'})}
var pin=document.getElementById('selPin'),mute=document.getElementById('selMute'),ar=document.getElementById('selArch');
pin.title=all('data-pinned')?'Unpin chat':'Pin chat';mute.title=all('data-muted')?'Unmute notifications':'Mute notifications';ar.title=arch?'Unarchive':'Archive';
var m=menu.querySelectorAll('button');Array.prototype.forEach.call(m,function(b){var a=b.getAttribute('data-act');
if(a==='view')b.style.display=(rs.length===1&&rs[0].getAttribute('data-kind')==='dm')?'':'none';
if(a==='unread')b.textContent=rs.some(function(a){return a.getAttribute('data-unread')!=='0'||a.getAttribute('data-mark')==='1'})?'Mark as read':'Mark as unread';
if(a==='fav')b.textContent=all('data-fav')?'Remove from favorites':'Add to favorites'})}
function toggle(k){if(sel[k])delete sel[k];else sel[k]=1;applyView()}
function act(action,ks){var items=(ks||keys()).map(function(k){var p=k.split(':');return{kind:p[0],id:parseInt(p[1],10)}});
fetch('/api/chats/prefs',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items,action:action})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(!x.ok){alert(x.j.error||'Something went wrong.');return}sel={};refresh(true)}).catch(function(){alert('Could not reach the server. Try again.')})}
function allSel(attr){var rs=keys().map(rowOf).filter(Boolean);return rs.length&&rs.every(function(a){return a.getAttribute(attr)==='1'})}
document.getElementById('selClose').onclick=function(){sel={};applyView()};
document.getElementById('selPin').onclick=function(){act(allSel('data-pinned')?'unpin':'pin')};
document.getElementById('selMute').onclick=function(){act(allSel('data-muted')?'unmute':'mute')};
document.getElementById('selArch').onclick=function(){act(arch?'unarchive':'archive')};
document.getElementById('selDel').onclick=function(){if(confirm('Clear the selected chat'+(keys().length>1?'s':'')+'? This only removes the messages for you.'))act('clear')};
document.getElementById('selMore').onclick=function(e){e.stopPropagation();menu.style.display=menu.style.display==='block'?'none':'block'};
document.addEventListener('click',function(e){if(menu&&!menu.contains(e.target))menu.style.display='none'});
menu.onclick=function(e){var b=e.target.closest('button');if(!b)return;var a=b.getAttribute('data-act');menu.style.display='none';
if(a==='view'){var k=keys()[0].split(':');location.href='/u/'+k[1]}
else if(a==='unread'){var rs=keys().map(rowOf).filter(Boolean);act(rs.some(function(r){return r.getAttribute('data-unread')!=='0'||r.getAttribute('data-mark')==='1'})?'mark_read':'mark_unread')}
else if(a==='all'){rows().forEach(function(r){if(r.style.display!=='none')sel[r.getAttribute('data-key')]=1});applyView()}
else if(a==='fav')act(allSel('data-fav')?'unfavorite':'favorite');
else if(a==='clear'){if(confirm('Clear the selected chat'+(keys().length>1?'s':'')+'? This only removes the messages for you.'))act('clear')}};
function cancelPress(){if(timer){clearTimeout(timer);timer=null}}
list.addEventListener('pointerdown',function(e){var a=e.target.closest('a.chat-item[data-key]');if(!a||(e.pointerType==='mouse'&&e.button!==0))return;sx=e.clientX;sy=e.clientY;cancelPress();pressed=false;
timer=setTimeout(function(){timer=null;pressed=true;var k=a.getAttribute('data-key');if(!sel[k])sel[k]=1;if(navigator.vibrate)try{navigator.vibrate(15)}catch(x){}applyView()},450)});
list.addEventListener('pointermove',function(e){if(timer&&(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10))cancelPress()});
['pointerup','pointercancel','pointerleave'].forEach(function(t){list.addEventListener(t,function(){cancelPress();if(pressed&&t!=='pointerleave')setTimeout(function(){pressed=false},80)})});
list.addEventListener('contextmenu',function(e){var a=e.target.closest('a.chat-item[data-key]');if(!a)return;e.preventDefault();pressed=true;sel[a.getAttribute('data-key')]=1;applyView()});
list.addEventListener('click',function(e){var ar=e.target.closest('#archRow');if(ar){e.preventDefault();arch=true;sel={};applyView();return}
var a=e.target.closest('a.chat-item[data-key]');if(!a)return;
if(pressed){e.preventDefault();pressed=false;return}
if(keys().length){e.preventDefault();toggle(a.getAttribute('data-key'))}});
document.getElementById('archBack').onclick=function(){arch=false;sel={};applyView()};
search.addEventListener('input',function(){query=search.value.trim().toLowerCase();applyView()});
chips.addEventListener('click',function(e){var c=e.target.closest('[data-f]');if(!c)return;filter=c.getAttribute('data-f');Array.prototype.forEach.call(chips.querySelectorAll('[data-f]'),function(x){x.classList.toggle('on',x===c)});applyView()});
function refresh(force){if(document.hidden&&force!==true)return;if(!force&&(keys().length||timer))return;fetch('/chat',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.text()}).then(function(h){var n=new DOMParser().parseFromString(h,'text/html').getElementById('chatList');if(n){list.innerHTML=n.innerHTML;Object.keys(sel).forEach(function(k){if(!rowOf(k))delete sel[k]});applyView();mark()}}).catch(function(){})}
applyView();mark();setInterval(refresh,4000);document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);
})();`;
    const selBar = `<div id="selBar" class="sel-bar" style="display:none"><button type="button" id="selClose" title="Cancel">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button><b id="selCount">0</b><span class="sel-sp"></span>
<button type="button" id="selPin" title="Pin chat">${svg('<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7"/>')}</button>
<button type="button" id="selMute" title="Mute notifications">${svg('<path d="M6 8a6 6 0 0 1 9-5M18 11c0 4 2 5 2 6H5M10 21h4M3 3l18 18"/>')}</button>
<button type="button" id="selArch" title="Archive">${svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>')}</button>
<button type="button" id="selDel" title="Clear chat">${svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>')}</button>
<button type="button" id="selMore" title="More">${svg('<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>')}</button>
<div id="selMenu" class="sel-menu" style="display:none"><button type="button" data-act="view">View contact</button><button type="button" data-act="unread">Mark as unread</button><button type="button" data-act="all">Select all</button><button type="button" data-act="fav">Add to favorites</button><button type="button" data-act="clear">Clear chat</button></div></div>`;
    res.send(layout('Chat', `${selBar}<h1>Chat</h1>${tabs}<p style="margin:0 0 10px"><a class="btn ghost" href="/chat/group/new">+ New group</a> <a class="btn ghost" href="/chat/starred">&#9733; Starred</a></p>
<input id="chatSearch" class="chat-search" type="search" placeholder="Search chats" autocomplete="off">
<div id="chipRow" class="chip-row"><button type="button" class="chip on" data-f="all">All</button><button type="button" class="chip" data-f="unread">Unread</button><button type="button" class="chip" data-f="fav">Favorites</button><button type="button" class="chip" data-f="groups">Groups</button></div>
<div id="archHead" class="arch-head" style="display:none"><button type="button" id="archBack" class="link">&larr; Archived chats</button></div>
${isCentral(req.user) ? (() => { const n = db.prepare('SELECT COUNT(*) n FROM feedback WHERE read=0').get().n; return `<a class="chat-item" href="/chat/feedback"><span class="avatar" style="width:44px;height:44px;font-size:20px">💬</span><span class="meta"><b>What people say about the site</b><span>${n ? n + ' new' : 'Feedback and suggestions'} &middot; read only</span></span>${n ? `<b class="nbadge">${badgeText(n)}</b>` : ''}</a>`; })() : ''}<div id="chatList">${listHtml}</div><p id="chatEmpty" class="mut" style="display:none"></p><script>${listScript}</script>`, req.user));
  });
};
