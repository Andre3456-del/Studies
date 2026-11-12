// Settings pages (profile, picture, active status, appearance, notifications)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { UNAME_JS, canLecturerAdmin, canPromote, db, esc, inApp, layout, lockedOf, profileFields, readProfile, saveProfile, upload } = ctx;
  const wantsApp = req => !inApp(req) && ctx.deviceOf(req) !== 'laptop';
  const SETTINGS_PAGES = [
    ['/settings/profile', '👤', 'Profile', 'Your picture, name, and details'],
    ['/settings/active-status', '🟢', 'Active status', 'Whether others see when you\u2019re online'],
    ['/settings/appearance', '🎨', 'Appearance', 'Light or dark mode'],
    ['/settings/notifications', '🔔', 'Notifications', 'Get alerted on this device'],
    ['/settings/devices', '💻', 'Linked devices', 'Log in on a laptop by scanning a code'],
    ['/settings/security', '🔒', 'Security', 'App lock and change your password'],
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
    const links = SETTINGS_PAGES.filter(x => (x[0] !== '/settings/devices' || ctx.canLinkOthers(req)) && (x[0] !== '/app' || wantsApp(req)) && ((x[0] !== '/saved' && x[0] !== '/settings/backup') || inApp(req))).concat(canPromote(req.user) ? [['/admin/levels', '🎓', 'Level promotion', 'Move students up to the next level']] : [], canLecturerAdmin(req.user) && req.user.role !== 'uniadmin' ? [['/lecturer/admin', '🔁', 'Switch to lecturer portal', 'Manage lecturers, courses and uploads, then switch back']] : [], req.user.lp_inst && req.user.role !== 'uniadmin' ? [['/uni', '🏫', 'University admin', 'Students and levels for ' + req.user.lp_inst]] : [], uniToolRows(req.user)).map(([href, icon, label, sub]) => `<a class="card row" href="${href}" style="align-items:center;gap:14px;text-decoration:none;color:inherit"><span class="sico">${icon}</span><div style="flex:1"><b>${esc(label)}</b><span class="sub">${esc(sub)}</span></div><span class="mut">&rsaquo;</span></a>`).join('');
    res.send(layout('Settings', `<h1>Settings</h1>${links}`, req.user));
  });
  app.get('/settings/profile', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const avatarPreview = u.avatar_mime ? `<img src="/avatar/${u.id}" class="drawer-av-img" style="width:64px;height:64px">` : `<span class="avatar" style="width:64px;height:64px;font-size:22px">${esc((u.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
    const avatarForm = `<div class="card row" style="align-items:center;gap:16px">${avatarPreview}<form method="post" action="/settings/avatar" enctype="multipart/form-data" style="flex:1;min-width:180px"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required><button class="ghost">Upload picture</button></form></div>`;
    const msg = req.query.msg ? `<p class="${req.query.err ? 'err' : 'mut'}">${esc(req.query.msg)}</p>` : '';
    if (u.is_lecturer) {
      return res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}
<form method="post" action="/settings/profile" class="card">
<input name="name" value="${esc(u.name || '')}" placeholder="Your name" required maxlength="80">
<input name="reg_no" value="${esc(u.lecturer_reg_no || '')}" placeholder="Staff/registration number (optional)" maxlength="60">
<p class="mut" style="margin:4px 0">Institution: <b>${esc(u.university || '')}</b> (set once, verified -- contact a full admin to change it)</p>
<button>Save</button></form>`, req.user));
    }
    const posNote = u.position_status === 'pending' ? '<p class="pill pending">Position waiting for verification</p>' : u.position_status === 'approved' ? '<p class="pill">&#10003; Position verified</p>' : u.position_status === 'rejected' ? '<p class="err">Your position could not be verified.</p>' : '';
    res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}
<form method="post" action="/settings/profile" class="card">${profileFields(u, u.role === 'user', lockedOf(u))}${posNote}<button>Save</button></form>
<script>${UNAME_JS}</script>`, req.user));
  });
  app.post('/settings/profile', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (u.is_lecturer) {
      const name = String(req.body.name || '').trim().slice(0, 80);
      const regNo = String(req.body.reg_no || '').trim().slice(0, 60) || null;
      if (!name) return res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent('Enter your name.'));
      db.prepare('UPDATE users SET name=?, lecturer_reg_no=? WHERE id=?').run(name, regNo, u.id);
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
<p class="mut">When this is on, friends can see when you're online in chat. Turn it off to always appear offline to them.</p>
<form method="post" action="/settings/active-status" class="card" id="actForm"><input type="hidden" name="hide" id="actHide" value="${hidden ? '0' : '1'}"><label class="swrow"><span><b>Show when I'm online</b><br><span class="mut" style="font-size:13px">${hidden ? 'Off. You always appear offline.' : 'On. Friends can see when you are online.'}</span></span><input type="checkbox" role="switch" class="shsw" id="actSw" aria-label="Show when I'm online"${hidden ? '' : ' checked'}></label></form><script>document.getElementById('actSw').onchange=function(){document.getElementById('actHide').value=this.checked?'0':'1';document.getElementById('actForm').submit()}</script>`, req.user));
  });
  app.post('/settings/active-status', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('UPDATE users SET hide_active=? WHERE id=?').run(req.body.hide === '1' ? 1 : 0, req.user.id);
    res.redirect('/settings/active-status');
  });
  app.get('/settings/appearance', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/appearance');
    const theme = db.prepare('SELECT theme FROM users WHERE id=?').get(req.user.id).theme || 'dark';
    res.send(layout('Appearance', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Appearance</h1>
<form method="post" action="/settings/appearance" class="card" id="apForm"><input type="hidden" name="theme" id="apTheme" value="${theme}"><label class="swrow"><span><b>Dark mode</b><br><span class="mut" style="font-size:13px">${theme === 'dark' ? 'On. Switch it off for light mode.' : 'Off. The site is in light mode.'}</span></span><input type="checkbox" role="switch" class="shsw" id="apSw" aria-label="Dark mode"${theme === 'dark' ? ' checked' : ''}></label></form>
<script>document.getElementById('apSw').onchange=function(){document.getElementById('apTheme').value=this.checked?'dark':'light';document.getElementById('apForm').submit()}</script>`, req.user));
  });
  app.post('/settings/appearance', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('UPDATE users SET theme=? WHERE id=?').run(req.body.theme === 'light' ? 'light' : 'dark', req.user.id);
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
