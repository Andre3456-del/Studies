// Settings pages (profile, picture, active status, appearance, notifications)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { UNAME_JS, canLecturerAdmin, canPromote, db, esc, inApp, layout, lockedOf, profileFields, readProfile, saveProfile, upload } = ctx;
  const PL = require('../lib/profile_lock'); PL.register(app, ctx); const PH = require('../lib/position_handover'); PH.register(app, ctx);
  const doneOf = u => { const k = lockedOf(u); return k.username && k.university && k.department && k.level; };
  const tellOld = (u, what) => ctx.deliver(u.email, 'Your Studies Hub details were changed', 'Your ' + what + ' on Studies Hub was just changed. If this was not you, change your password now.', ctx.emailShell('<h2 style="margin:0 0 18px;font-size:24px;color:#1b2430">Your details were changed</h2><p>Your ' + esc(what) + ' was just changed. If this was not you, change your password now.</p>')).catch(() => {});
  require('./chat_theme')(app, ctx);
  const wantsApp = req => !inApp(req) && ctx.deviceOf(req) !== 'laptop';
  const SETTINGS_PAGES = [
    ['/settings/appearance', '🎨', 'Appearance', 'Light, dark or your device default'],
    ['/settings/profile', '👤', 'Profile', 'Your picture, name, and details'],
    ['/settings/active-status', '🟢', 'Active status', 'Whether others see when you\u2019re online'],
    ['/settings/chat', '🖼️', 'Chat', 'Your chat background'],
    ['/settings/notifications', '🔔', 'Notifications', 'Get alerted on this device'],
    ['/settings/devices', '💻', 'Linked devices', 'Log in on a laptop by scanning a code'],
    ['/settings/security', '🔒', 'Security', 'App lock and change your password'],
    ['/settings/account', '👤', 'Account', 'Email and deleting your account'],
    ['/receipts', '🧾', 'Receipts', 'Your payment receipts, to view and print'],
    ['/saved', '📥', 'Saved offline', 'Materials kept on this phone, open without internet'],
    ['/settings/backup', '☁️', 'Backup', 'Keep your saved materials and app settings safe in your account'],
    ['/app', '📲', 'Download the app', 'Get Studies Hub as an Android app'],
  ];
  // The tools a university admin gave this person (or that a full admin has by default).
  const UNI_TOOLS = { news: ['/uni/news', '📰', 'University news', 'Post news to everyone in '], uploads: ['/uni/uploads', '📤', 'University uploads', 'Upload files and videos for everyone in '], support: ['/uni/support', '🛟', 'Login help', 'Help students who cannot sign in at '] };
  const uniToolRows = u => {
    const inst = (u.uni_role === 'full' && u.lp_inst) || u.sub_inst;
    if (!inst || u.role !== 'user') return [];
    const keys = u.uni_role === 'full' && u.lp_inst ? Object.keys(UNI_TOOLS) : String(u.sub_perms || '').split(',').filter(k => UNI_TOOLS[k]);
    return keys.map(k => [UNI_TOOLS[k][0], UNI_TOOLS[k][1], UNI_TOOLS[k][2], (u.sub_title && u.sub_inst ? u.sub_title + ' - ' : '') + UNI_TOOLS[k][3] + inst]);
  };
  app.get('/settings', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings');
    res.set({ 'Cache-Control': 'no-store', Vary: 'User-Agent' });
    const links = SETTINGS_PAGES.filter(x => !(req.user.is_lecturer && (x[0] === '/settings/chat' || x[0] === '/settings/active-status')) && (x[0] !== '/settings/devices' || ctx.canLinkOthers(req)) && (x[0] !== '/app' || wantsApp(req)) && ((x[0] !== '/saved' && x[0] !== '/settings/backup') || inApp(req))).concat(canPromote(req.user) ? [['/admin/levels', '🎓', 'Level promotion', 'Move students up to the next level']] : [], canLecturerAdmin(req.user) && req.user.role !== 'uniadmin' ? [['/lecturer/admin', '🔁', 'Switch to lecturer portal', 'Manage lecturers, courses and uploads, then switch back']] : [], req.user.lp_inst && req.user.role !== 'uniadmin' ? [['/uni', '🏫', 'University admin', 'Students and levels for ' + req.user.lp_inst]] : [], uniToolRows(req.user)).map(([href, icon, label, sub]) => `<a class="srow" href="${href}"><div><b>${esc(label)}</b><span>${esc(sub)}</span></div><i>&rsaquo;</i></a>`).join('');
    const t0 = (db.prepare('SELECT theme FROM users WHERE id=?').get(req.user.id) || {}).theme, cur = t0 === 'light' ? 'light' : t0 === 'dark' ? 'dark' : 'auto';
    res.send(layout('Settings', `<h1>Settings</h1><div class="srows">${links}</div><form method="post" action="/logout" id="soForm"><button type="button" class="signout" id="soBtn">Sign out</button></form>
<div id="soAsk" hidden style="position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:24px"><div class="card" style="max-width:340px;width:100%;margin:0;text-align:center"><h2 style="margin:0 0 6px">Sign out?</h2><p class="mut" style="margin:0 0 16px">You will need to log in again to use Studies Hub.</p><div style="display:flex;gap:10px"><button type="button" id="soNo" class="ghost" style="flex:1">No, stay</button><button type="button" id="soYes" style="flex:1;background:#e5393b;color:#fff">Yes, sign out</button></div></div></div>
<script>(function(){var a=document.getElementById('soAsk');function show(v){a.style.display=v?'flex':'none'}document.getElementById('soBtn').onclick=function(){show(1)};document.getElementById('soNo').onclick=function(){show(0)};a.onclick=function(e){if(e.target===a)show(0)};document.getElementById('soYes').onclick=function(){document.getElementById('soForm').submit()}})()</script>`, req.user));
  });
  app.get('/settings/profile', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const avatarPreview = u.avatar_mime ? `<img src="/avatar/${u.id}" class="drawer-av-img" style="width:64px;height:64px">` : `<span class="avatar" style="width:64px;height:64px;font-size:22px">${esc((u.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
    const avatarForm = `<div class="card row" style="align-items:center;gap:16px">${avatarPreview}<form method="post" action="/settings/avatar" enctype="multipart/form-data" style="flex:1;min-width:180px"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required><button class="ghost">Upload picture</button></form></div>`;
    const msg = req.query.msg ? `<p class="${req.query.err ? 'err' : 'mut'}">${esc(req.query.msg)}</p>` : '';
    if (u.is_lecturer) {
      const open = PL.unlocked(db, u.id);
      return res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}` + (open
        ? `<form method="post" action="/settings/profile" class="card"><label class="mut">Your name</label><input name="name" value="${esc(u.name || '')}" required maxlength="80">
<label class="mut">Staff/registration number</label><input name="reg_no" value="${esc(u.lecturer_reg_no || '')}" maxlength="60">
<label class="mut">Institution</label><input name="university" value="${esc(u.university || '')}" maxlength="120">
<p class="mut" style="margin:4px 0">Your name must match the name on your bank account.</p><button>Save</button></form>`
        : `<div class="card">${PL.rows(esc, [['Name', u.name], ['Staff/registration number', u.lecturer_reg_no], ['Institution', u.university]])}${PL.button}</div>`), req.user));
    }
    if (doneOf(u) && !PL.unlocked(db, u.id)) {
      const lk = [['Name', u.name], ['Username', u.username && '@' + u.username], ['University', u.university], ['Department', u.department], ['Course', u.dept_option], ['Level', u.level && u.level + ' level']];
      return res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}
<div class="card">${PL.rows(esc, lk)}${PL.button}</div>
<form method="post" action="/settings/profile" class="card"><label class="mut">Position held in school (optional)</label><input name="position" value="${esc(u.position || '')}" maxlength="60" placeholder="e.g. Director of Socials"><p class="mut" style="margin:6px 0">${u.position_status === 'pending' ? 'Waiting for verification.' : u.position_status === 'approved' ? '&#10003; Verified' : ''}</p><button>Save</button></form>${PH.card(u, esc, db)}${PH.queueLink(u, esc)}`, req.user));
    }
    const posNote = u.position_status === 'pending' ? '<p class="pill pending">Position waiting for verification</p>' : u.position_status === 'approved' ? '<p class="pill">&#10003; Position verified</p>' : u.position_status === 'rejected' ? '<p class="err">Your position could not be verified.</p>' : '';
    res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}
<form method="post" action="/settings/profile" class="card">${profileFields(u, u.role === 'user', doneOf(u) ? { edit: true } : lockedOf(u))}${posNote}<button>Save</button></form>
<script>${UNAME_JS}</script>`, req.user));
  });
  app.post('/settings/profile', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const open = PL.unlocked(db, u.id), need = m => res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent(m));
    if (u.is_lecturer) {
      if (!open) return need('Verify with a code first to change your details.');
      const name = String(req.body.name || '').trim().slice(0, 80);
      const regNo = String(req.body.reg_no || '').trim().slice(0, 60) || null;
      const uni = String(req.body.university || '').trim().slice(0, 120) || u.university;
      if (!name) return need('Enter your name.');
      db.prepare('UPDATE users SET name=?, lecturer_reg_no=?, university=? WHERE id=?').run(name, regNo, uni, u.id);
      PL.relock(db, u.id);
      if (name !== u.name || regNo !== u.lecturer_reg_no || uni !== u.university) tellOld(u, 'name or registration details');
      let note = 'Saved.';
      try { const a = db.prepare('SELECT account_name FROM seller_accounts WHERE user_id=?').get(u.id); if (a && a.account_name && !require('../lib/seller').namesMatch(a.account_name, name)) note = 'Saved. Your bank account name no longer matches your name, so add an account in your name on the Sell page.'; } catch {}
      return res.redirect('/settings/profile?msg=' + encodeURIComponent(note));
    }
    if (doneOf(u) && !open) req.body.name = u.name;
    if (doneOf(u) && open) {
      const { d, problem } = readProfile({ ...u, username: null, university: null, department: null, level: null, dept_option: null }, req.body);
      if (problem) return need(problem);
      try { db.prepare('UPDATE users SET name=?, username=?, university=?, department=?, level=?, dept_option=? WHERE id=?').run(d.name, d.username, d.university, d.department, d.level, d.dept_option || null, u.id); }
      catch { return need('That username is already taken.'); }
      const err = saveProfile(db.prepare('SELECT * FROM users WHERE id=?').get(u.id), d);
      PL.relock(db, u.id);
      if (err) return need(err);
      tellOld(u, 'name or school details');
      return res.redirect('/settings/profile?msg=' + encodeURIComponent('Saved.'));
    }
    const { d, problem } = readProfile(u, req.body);
    if (problem) return res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent(problem));
    const err = saveProfile(u, d);
    if (err) return res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent(err));
    res.redirect('/settings/profile?msg=' + encodeURIComponent('Saved.'));
  });
  app.post('/settings/avatar', upload.single('file'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!req.file || !/^image\//.test(req.file.mimetype)) return res.redirect('/settings/profile?msg=' + encodeURIComponent('Choose an image file.'));
    db.prepare('UPDATE users SET avatar_data=?, avatar_mime=? WHERE id=?').run(req.file.buffer, req.file.mimetype, req.user.id);
    res.redirect('/settings/profile?msg=' + encodeURIComponent('Picture updated.'));
  });
  app.get('/settings/active-status', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/active-status');
    const hidden = !!db.prepare('SELECT hide_active FROM users WHERE id=?').get(req.user.id).hide_active;
    res.send(layout('Active status', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Active status</h1>
<p class="mut">When this is on, your Studikins can see when you're online in chat. Turn it off to always appear offline to them.</p>
<form method="post" action="/settings/active-status" class="card" id="actForm"><input type="hidden" name="hide" id="actHide" value="${hidden ? '0' : '1'}"><label class="swrow"><span><b>Show when I'm online</b><br><span class="mut" style="font-size:13px">${hidden ? 'Off. You always appear offline.' : 'On. Friends can see when you are online.'}</span></span><input type="checkbox" role="switch" class="shsw" id="actSw" aria-label="Show when I'm online"${hidden ? '' : ' checked'}></label></form><script>document.getElementById('actSw').onchange=function(){document.getElementById('actHide').value=this.checked?'0':'1';document.getElementById('actForm').submit()}</script>`, req.user));
  });
  app.post('/settings/active-status', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('UPDATE users SET hide_active=? WHERE id=?').run(req.body.hide === '1' ? 1 : 0, req.user.id);
    res.redirect('/settings/active-status');
  });
  app.get('/settings/appearance', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/appearance');
    const t0 = (db.prepare('SELECT theme FROM users WHERE id=?').get(req.user.id) || {}).theme, cur = t0 === 'light' ? 'light' : t0 === 'auto' ? 'auto' : 'dark';
    const ap = `<div class="apc" id="apc">${[['light', 'Light', 'Bright background'], ['dark', 'Dark', 'Easier on the eyes at night'], ['auto', 'Device default', 'Match your phone or computer']].map(([v, t, d]) => `<label class="${cur === v ? 'on' : ''}"><input type="radio" name="theme" value="${v}"${cur === v ? ' checked' : ''}><i></i><span><b>${t}</b><span>${d}</span></span></label>`).join('')}</div>
<script>(function(){var h=document.documentElement,m=matchMedia('(prefers-color-scheme: light)');document.getElementById('apc').onchange=function(e){var v=e.target.value;[].forEach.call(this.children,function(l){l.className=l.firstChild.checked?'on':''});if(v==='auto'){h.setAttribute('data-auto','1');h.setAttribute('data-theme',m.matches?'light':'dark')}else{h.removeAttribute('data-auto');h.setAttribute('data-theme',v)}fetch('/settings/appearance',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'theme='+v}).then(function(){try{localStorage.setItem('sh_tv',String(Date.now()))}catch(x){}})}})()</script>`;
    res.send(layout('Appearance', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Appearance</h1>${ap}`, req.user));
  });
  app.post('/settings/appearance', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('UPDATE users SET theme=? WHERE id=?').run(['light', 'auto'].includes(req.body.theme) ? req.body.theme : 'dark', req.user.id);
    res.redirect('/settings/appearance');
  });
  app.get('/settings/notifications', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/notifications');
    res.send(layout('Notifications', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Notifications</h1>
<div class="card"><label class="swrow"><span><b>Notifications on this device</b><br><span class="mut" id="ntState" style="font-size:13px">Messages, calls, friend requests and new uploads.</span></span><input type="checkbox" role="switch" class="shsw" id="ntSw" aria-label="Notifications"></label></div>
<script>(function(){var A=window.StudiesApp,sw=document.getElementById('ntSw'),st=document.getElementById('ntState');
function cur(){try{if(A&&A.notifOn)return !!A.notifOn();if(A)return null;return window.Notification&&Notification.permission==='granted'}catch(e){return false}}
function show(){var c=cur();if(c!==null)sw.checked=c;st.textContent=sw.checked?'On. You will be told about messages, calls and new uploads.':'Off. Turn it on to get messages, calls and new uploads.'}
sw.onchange=function(){if(sw.checked){if(A){A.notifications();setTimeout(show,1500)}else if(window.enablePush)window.enablePush().then(function(ok){if(!ok){sw.checked=false;alert('Notifications were not allowed. You can allow them in your browser settings.')}show()});else{sw.checked=false}}else{if(A){A.notifications()}else alert('To turn notifications off, use your browser settings for this site.');setTimeout(show,1500)}};
show();document.addEventListener('visibilitychange',function(){setTimeout(show,500)});window.addEventListener('focus',function(){setTimeout(show,500)})})()</script>
<div class="card" id="sndCard" hidden><h2 style="margin-top:0">Sounds</h2><p class="mut" style="margin:0 0 6px">Pick a sound for each kind of notification, and a ringing tone for calls.</p><div id="sndRows"></div></div>
<style>.sndr{display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid rgba(127,127,127,.25)}.sndr:first-child{border-top:0}.sndr .t{flex:1;min-width:0}.sndr .t span{display:block;font-size:13px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sndr button{padding:8px 12px}</style>
<script>(function(){var A=window.StudiesApp;if(!A||!A.soundInfo)return;var L=[['messages','Chat messages'],['news','News'],['uploads','New uploads'],['general','Other notifications'],['calls','Call ringing tone']];
function draw(){var n={};try{n=JSON.parse(A.soundInfo())}catch(e){}var h='';L.forEach(function(r){h+='<div class="sndr"><div class="t"><b>'+r[1]+'</b><span>'+(n[r[0]]||'')+'</span></div><button type="button" class="ghost" data-p="'+r[0]+'" aria-label="Play">&#9654;</button><button type="button" class="ghost" data-c="'+r[0]+'">Change</button></div>'});document.getElementById('sndRows').innerHTML=h;document.getElementById('sndCard').hidden=false}
document.getElementById('sndRows').onclick=function(e){var b=e.target.closest('button');if(!b)return;if(b.getAttribute('data-p'))A.playSound(b.getAttribute('data-p'));else if(b.getAttribute('data-c'))A.pickSound(b.getAttribute('data-c'))};
draw();document.addEventListener('visibilitychange',function(){setTimeout(draw,400)});window.addEventListener('focus',function(){setTimeout(draw,400)});setInterval(draw,3000)})()</script>`, req.user));
  });
};
