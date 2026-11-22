'use strict';
// Manual help desk. Shown instead of "Ask AI" while no AI key is set.
//   People send a message at /help (visitors give a name and email). It is emailed to the admin and lands in /admin/help,
//   where the owner and any assistant admins can read and reply. Replies reach the person by notification and email.
//   The owner picks assistant admins at /admin/help/staff, only while AI is off. When AI is on the button is "Ask AI" again.

// The floating Help box: same look and behaviour as the "Ask AI" box. Replies from the team appear in it.
module.exports.widget = `<button id="ai-open" class="ai-fab" aria-label="Help">Help</button><div id="ai-box" class="ai-box" hidden><div class="ai-head"><b>Studies Hub help</b><button id="ai-close" class="link" aria-label="Close">&times;</button></div><div id="ai-log" class="ai-log"></div><form id="ai-form" class="ai-form"><input id="ai-in" placeholder="Write your message" maxlength="1000" autocomplete="off"><button>Send</button></form></div><script>(function(){var box=document.getElementById('ai-box'),log=document.getElementById('ai-log'),inp=document.getElementById('ai-in'),btn=document.getElementById('ai-open'),n=-1,tm=null;
function add(c,t){var d=document.createElement('div');d.className='ai-m '+c;d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
function draw(ms){log.innerHTML='';add('bot','Hi! How can we help you?');ms.forEach(function(m){add(m.staff?'bot':'me',m.body)});n=ms.length}
function load(){fetch('/help/thread',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j.messages.length!==n)draw(j.messages);btn.textContent='Help'}).catch(function(){})}
function peek(){fetch('/help/unread',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j.n&&box.hidden)btn.textContent='Help \\u25CF'}).catch(function(){})}
btn.onclick=function(){box.hidden=!box.hidden;if(!box.hidden){load();inp.focus();tm=setInterval(function(){if(box.hidden){clearInterval(tm);return}load()},10000)}};
document.getElementById('ai-close').onclick=function(){box.hidden=true};
document.getElementById('ai-form').onsubmit=function(e){e.preventDefault();var q=inp.value.trim();if(!q)return;inp.value='';add('me',q);n++;fetch('/help/send',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:q})}).then(function(r){return r.json()}).then(function(j){if(!j.ok)add('bot',j.error||'Not sent. Try again.')}).catch(function(){add('bot','Not sent. Try again.')})};
peek();setInterval(peek,60000)})()</script>`;
module.exports.register = function register(app, ctx) {
  const { db, esc, layout, notify, deliver, emailShell, isCentral, AI } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS help_threads(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, guest_name TEXT, guest_email TEXT, guest_key TEXT, status TEXT DEFAULT 'open', unread_staff INTEGER DEFAULT 1, unread_user INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS help_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, from_staff INTEGER DEFAULT 0, staff_id INTEGER, body TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS help_staff(user_id INTEGER PRIMARY KEY)`);
  const base = () => (process.env.BASE_URL || 'https://studieshub.org').replace(/\/$/, '');
  const isStaff = u => !!u && (isCentral(u) || !!db.prepare('SELECT 1 FROM help_staff WHERE user_id=?').get(u.id));
  const staffOnly = (req, res, next) => isStaff(req.user) ? next() : res.sendStatus(403);
  const owner = (req, res, next) => isCentral(req.user) ? next() : res.sendStatus(403);
  const ago = t => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
  const nameOf = t => t.user_id ? ((db.prepare('SELECT name FROM users WHERE id=?').get(t.user_id) || {}).name || 'Member') : (t.guest_name || 'Visitor');
  const emailOf = t => t.user_id ? ((db.prepare('SELECT email FROM users WHERE id=?').get(t.user_id) || {}).email || '') : (t.guest_email || '');
  const clean = s => String(s || '').replace(/\r\n?/g, '\n').trim().slice(0, 3000);
  const bubble = m => `<div style="margin:8px 0;display:flex;justify-content:${m.from_staff ? 'flex-start' : 'flex-end'}"><div class="card" style="max-width:86%;margin:0;white-space:pre-wrap;${m.from_staff ? '' : 'background:#6c5ce7;color:#fff'}">${esc(m.body)}<div style="font-size:11px;opacity:.7;margin-top:4px">${m.from_staff ? 'Studies Hub' : ''} ${ago(m.created_at)}</div></div></div>`;
  const msgsOf = id => db.prepare('SELECT * FROM help_messages WHERE thread_id=? ORDER BY id').all(id);
  const staffIds = () => db.prepare('SELECT user_id FROM help_staff').all().map(r => r.user_id).concat(db.prepare('SELECT id FROM users WHERE email=?').all((process.env.ADMIN_EMAIL || 'studieshub.org@gmail.com').toLowerCase()).map(r => r.id));

  async function tellStaff(t, body) {
    try { notify(staffIds(), { title: 'Help: ' + nameOf(t), body: body.slice(0, 120), url: '/admin/help/' + t.id }); } catch (e) { /* never block the sender */ }
    try {
      const to = (process.env.ADMIN_EMAIL || 'studieshub.org@gmail.com').toLowerCase();
      await deliver(to, 'Help message from ' + nameOf(t), `${nameOf(t)} (${emailOf(t) || 'no email'}) wrote:\n\n${body}\n\nReply: ${base()}/admin/help/${t.id}`, emailShell(`<h2 style="margin:0 0 14px;font-size:20px;color:#1b2430">Help message</h2><p style="margin:0 0 6px"><b>${esc(nameOf(t))}</b> ${esc(emailOf(t))}</p><p style="margin:0 0 16px;white-space:pre-wrap;line-height:1.6">${esc(body)}</p><a href="${base()}/admin/help/${t.id}" style="background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">Reply</a>`));
    } catch (e) { console.error('Help email failed:', e.message); }
  }

  // ---- the person ----
  const mine = req => req.user ? db.prepare('SELECT * FROM help_threads WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id) : (/(?:^|;\s*)hk=([a-f0-9]{24})/.exec(req.headers.cookie || '') ? db.prepare('SELECT * FROM help_threads WHERE guest_key=?').get(RegExp.$1) : null);
  app.get('/help', (req, res) => {
    if (AI && req.user) return res.redirect('/dashboard');
    const t = mine(req), ms = t ? msgsOf(t.id) : [];
    if (t && t.unread_user) db.prepare('UPDATE help_threads SET unread_user=0 WHERE id=?').run(t.id);
    res.send(layout('Help', `<h1>Help</h1>${req.query.sent ? '<p class="pill">Sent.</p>' : ''}${ms.map(bubble).join('')}
<form class="card" method="post" action="/help">${req.user ? '' : '<input name="name" placeholder="Your name" required maxlength="80"><input name="email" type="email" placeholder="Your email" required maxlength="160">'}<textarea name="body" rows="4" maxlength="3000" required placeholder="Write your message"></textarea><button>Send</button></form>
${isStaff(req.user) ? '<p><a href="/admin/help">Help inbox</a></p>' : ''}`, req.user, { noAI: true }));
  });
  app.post('/help', (req, res) => {
    const body = clean(req.body.body); if (!body) return res.redirect('/help');
    let t = mine(req), now = Date.now();
    if (!t || t.status === 'closed') {
      if (req.user) { const r = db.prepare('INSERT INTO help_threads(user_id,created_at,updated_at) VALUES(?,?,?)').run(req.user.id, now, now); t = db.prepare('SELECT * FROM help_threads WHERE id=?').get(r.lastInsertRowid); }
      else {
        const name = String(req.body.name || '').trim().slice(0, 80), email = String(req.body.email || '').trim().slice(0, 160);
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect('/help');
        const key = require('crypto').randomBytes(12).toString('hex');
        const r = db.prepare('INSERT INTO help_threads(guest_name,guest_email,guest_key,created_at,updated_at) VALUES(?,?,?,?,?)').run(name, email, key, now, now);
        t = db.prepare('SELECT * FROM help_threads WHERE id=?').get(r.lastInsertRowid);
        res.setHeader('Set-Cookie', `hk=${key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
      }
    }
    db.prepare('INSERT INTO help_messages(thread_id,from_staff,body,created_at) VALUES(?,?,?,?)').run(t.id, 0, body, now);
    db.prepare("UPDATE help_threads SET unread_staff=1, status='open', updated_at=? WHERE id=?").run(now, t.id);
    tellStaff(t, body);
    res.redirect('/help?sent=1');
  });


  // ---- the floating box (logged-in people) ----
  app.get('/help/thread', (req, res) => {
    if (!req.user) return res.json({ messages: [] });
    const t = db.prepare('SELECT * FROM help_threads WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (t && t.unread_user) db.prepare('UPDATE help_threads SET unread_user=0 WHERE id=?').run(t.id);
    res.json({ messages: t ? msgsOf(t.id).map(m => ({ staff: !!m.from_staff, body: m.body })) : [] });
  });
  app.get('/help/unread', (req, res) => res.json({ n: req.user ? db.prepare('SELECT COUNT(*) n FROM help_threads WHERE user_id=? AND unread_user=1').get(req.user.id).n : 0 }));
  app.post('/help/send', (req, res) => {
    if (!req.user) return res.json({ error: 'Log in first.' });
    const body = clean(req.body && req.body.body); if (!body) return res.json({ error: 'Write a message.' });
    const now = Date.now();
    let t = db.prepare('SELECT * FROM help_threads WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (!t) { const r = db.prepare('INSERT INTO help_threads(user_id,created_at,updated_at) VALUES(?,?,?)').run(req.user.id, now, now); t = db.prepare('SELECT * FROM help_threads WHERE id=?').get(r.lastInsertRowid); }
    db.prepare('INSERT INTO help_messages(thread_id,from_staff,body,created_at) VALUES(?,?,?,?)').run(t.id, 0, body, now);
    db.prepare("UPDATE help_threads SET unread_staff=1, status='open', updated_at=? WHERE id=?").run(now, t.id);
    tellStaff(t, body);
    res.json({ ok: true });
  });

  // ---- the team ----
  app.get('/admin/help', staffOnly, (req, res) => {
    const rows = db.prepare('SELECT * FROM help_threads ORDER BY (status=\'open\') DESC, updated_at DESC LIMIT 200').all();
    res.send(layout('Help inbox', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Help inbox</h1>${!AI && isCentral(req.user) ? '<p><a href="/admin/help/staff">Assistant admins</a></p>' : ''}
${rows.map(t => { const last = db.prepare('SELECT body FROM help_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1').get(t.id); return `<a class="card" href="/admin/help/${t.id}" style="display:block;text-decoration:none;color:inherit"><b>${esc(nameOf(t))}</b> ${t.unread_staff ? '<span class="pill">New</span>' : ''} ${t.status === 'closed' ? '<span class="mut">Closed</span>' : ''}<div class="mut" style="font-size:13px">${esc((last && last.body || '').slice(0, 100))} · ${ago(t.updated_at)}</div></a>`; }).join('') || '<p class="mut">No messages.</p>'}`, req.user));
  });
  app.get('/admin/help/staff', owner, (req, res) => {
    if (AI) return res.redirect('/admin/help');
    const rows = db.prepare('SELECT u.id,u.name FROM help_staff s JOIN users u ON u.id=s.user_id').all();
    res.send(layout('Assistant admins', `<p class="mut"><a href="/admin/help">&larr; Help inbox</a></p><h1>Assistant admins</h1>${req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : ''}
<form class="card" method="post" action="/admin/help/staff"><input name="who" placeholder="@username or email" required maxlength="120" autocapitalize="none"><button>Add</button></form>
${rows.map(u => `<form class="card row" method="post" action="/admin/help/staff/${u.id}/remove"><span>${esc(u.name)}</span><button class="ghost">Remove</button></form>`).join('')}`, req.user));
  });
  app.post('/admin/help/staff', owner, (req, res) => {
    if (AI) return res.redirect('/admin/help');
    const w = String(req.body.who || '').trim().replace(/^@/, '').toLowerCase();
    const u = w && db.prepare('SELECT id,name FROM users WHERE lower(email)=? OR lower(username)=?').get(w, w);
    if (!u) return res.redirect('/admin/help/staff?msg=' + encodeURIComponent('No member found.'));
    db.prepare('INSERT OR IGNORE INTO help_staff(user_id) VALUES(?)').run(u.id);
    res.redirect('/admin/help/staff?msg=' + encodeURIComponent(u.name + ' added.'));
  });
  app.post('/admin/help/staff/:id/remove', owner, (req, res) => { db.prepare('DELETE FROM help_staff WHERE user_id=?').run(Number(req.params.id)); res.redirect('/admin/help/staff'); });
  app.get('/admin/help/:id', staffOnly, (req, res) => {
    const t = db.prepare('SELECT * FROM help_threads WHERE id=?').get(Number(req.params.id)); if (!t) return res.sendStatus(404);
    db.prepare('UPDATE help_threads SET unread_staff=0 WHERE id=?').run(t.id);
    res.send(layout('Help', `<p class="mut"><a href="/admin/help">&larr; Help inbox</a></p><h1 style="font-size:22px">${esc(nameOf(t))}</h1><p class="mut">${esc(emailOf(t))}</p>${req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : ''}
${msgsOf(t.id).map(m => bubble({ ...m, from_staff: m.from_staff ? 0 : 1 })).join('')}
<form class="card" method="post" action="/admin/help/${t.id}/reply"><textarea name="body" rows="4" maxlength="3000" required placeholder="Write a reply"></textarea><button>Send</button></form>
<form method="post" action="/admin/help/${t.id}/${t.status === 'closed' ? 'reopen' : 'close'}"><button class="ghost">${t.status === 'closed' ? 'Reopen' : 'Close'}</button></form>`, req.user));
  });
  app.post('/admin/help/:id/reply', staffOnly, async (req, res) => {
    const t = db.prepare('SELECT * FROM help_threads WHERE id=?').get(Number(req.params.id)), body = clean(req.body.body); if (!t) return res.sendStatus(404);
    if (!body) return res.redirect('/admin/help/' + t.id);
    const now = Date.now();
    db.prepare('INSERT INTO help_messages(thread_id,from_staff,staff_id,body,created_at) VALUES(?,?,?,?,?)').run(t.id, 1, req.user.id, body, now);
    db.prepare('UPDATE help_threads SET unread_user=1, updated_at=? WHERE id=?').run(now, t.id);
    if (t.user_id) { try { notify([t.user_id], { title: 'Studies Hub help', body: body.slice(0, 120), url: '/help' }); } catch (e) { /* ignore */ } }
    const to = emailOf(t);
    if (to) { try { await deliver(to, 'Reply from Studies Hub', `${body}\n\n${base()}${t.user_id ? '/help' : ''}`, emailShell(`<p style="margin:0 0 16px;white-space:pre-wrap;line-height:1.6">${esc(body)}</p>${t.user_id ? `<a href="${base()}/help" style="background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">Open</a>` : ''}`)); } catch (e) { console.error('Help reply email failed:', e.message); } }
    res.redirect('/admin/help/' + t.id + '?msg=' + encodeURIComponent('Sent.'));
  });
  app.post('/admin/help/:id/:act(close|reopen)', staffOnly, (req, res) => { db.prepare('UPDATE help_threads SET status=? WHERE id=?').run(req.params.act === 'close' ? 'closed' : 'open', Number(req.params.id)); res.redirect('/admin/help'); });
};
