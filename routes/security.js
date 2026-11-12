// Security: app lock (phone app) and change password
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { bcrypt, db, layout, limited, sidKey, weakPw } = ctx;
  // ---------- Security: app lock (phone app) and change password ----------
  const hasOwnPw = uid => { const r = db.prepare('SELECT gsignup FROM users WHERE id=?').get(uid); return !(r && r.gsignup); };
  app.get('/settings/security', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/security');
    const needPw = hasOwnPw(req.user.id);
    res.send(layout('Security', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Security</h1>
<div class="card" id="lockCard" hidden><style>.lkrow{display:flex;align-items:center;gap:14px;cursor:pointer}.lkrow input.lksw{appearance:none!important;-webkit-appearance:none!important;display:block!important;flex:none!important;width:54px!important;min-width:54px!important;max-width:54px!important;height:32px!important;border-radius:16px!important;background:#000!important;box-shadow:inset 0 0 0 1.5px #3a3a48!important;position:relative!important;transition:background .2s;border:0!important;padding:0!important;margin:0!important;cursor:pointer}.lkrow input.lksw::before{content:'';position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .2s}.lkrow input.lksw:checked{background:#6c63ff!important}.lkrow input.lksw:checked::before{transform:translateX(22px)}.lkchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.lkchips button{border-radius:999px;padding:8px 14px;font-size:14px}.lkchips button.on{background:#6c63ff;color:#fff;border-color:#6c63ff}</style>
<label class="lkrow" for="lkSw"><span style="flex:1"><b>App lock</b><br><span class="mut" id="lkState" style="font-size:13px"></span><br><span class="mut" id="lkHow" style="font-size:13px"></span></span><input type="checkbox" role="switch" id="lkSw" class="lksw" aria-label="App lock"></label>

<div id="lkTime" hidden><p class="mut" style="margin:14px 0 0;font-size:13px">Lock the app</p><div class="lkchips"><button type="button" class="ghost" data-m="0">Right away</button><button type="button" class="ghost" data-m="1">1 minute</button><button type="button" class="ghost" data-m="3">3 minutes</button><button type="button" class="ghost" data-m="5">5 minutes</button></div></div></div>
<form class="card" id="pwForm"><h2 style="margin-top:0">Change password</h2>
<p class="mut">${needPw ? 'You stay logged in. The new password must be different from the old one.' : 'You signed up with Google, so you have no password yet. Set one here if you want one.'}</p>
${needPw ? '<input type="password" id="pwOld" placeholder="Current password" autocomplete="current-password" required style="margin-bottom:8px">' : ''}
<input type="password" id="pwNew" placeholder="New password (8+ characters)" autocomplete="new-password" required minlength="8" style="margin-bottom:8px">
<input type="password" id="pwNew2" placeholder="New password again" autocomplete="new-password" required minlength="8" style="margin-bottom:10px">
<button>Change password</button>
<p style="text-align:center;margin:14px 0 0"><a href="/forgot" style="color:#5bc8ff;font-weight:600">Forgot password?</a></p></form>
<script>(function(){var A=window.StudiesApp,$=function(i){return document.getElementById(i)};
function post(u,b){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()})}
$('pwForm').onsubmit=function(e){e.preventDefault();var n=$('pwNew').value;if(n!==$('pwNew2').value)return alert('The two new passwords are not the same.');post('/settings/security/password',{current:$('pwOld')?$('pwOld').value:'',next:n}).then(function(j){if(j.ok){alert('Your password was changed.');$('pwForm').reset()}else alert(j.error||'Could not change the password.')}).catch(function(){alert('No connection. Please try again.')})};
if(!A)return;$('lockCard').hidden=false;var pick=0,info={};
function chips(){var c=document.querySelectorAll('#lkTime button');for(var k=0;k<c.length;k++)c[k].className=(+c[k].getAttribute('data-m')===pick)?'on':'ghost'}
function show(){try{info=JSON.parse(A.lockInfo())}catch(e){info={}}var w=[];if(info.fp)w.push('fingerprint');if(info.face)w.push('face unlock');if(info.iris)w.push('iris');w.push('your phone PIN, pattern or password');$('lkHow').textContent='Unlocks with: '+w.join(', ')+'. The phone uses whichever you have set up in its own settings.';$('lkSw').checked=!!info.on;$('lkTime').hidden=!info.on;if(info.on)pick=info.min||0;chips();$('lkState').textContent=info.on?'On. Locks '+(pick?'after '+pick+' minute'+(pick>1?'s':''):'right away')+' after you leave.':(info.secure===false?'Set a screen lock (PIN, pattern or fingerprint) in your phone settings first.':'Off.')}
window.studiesLockDone=function(k,ok){if(!ok&&k==='on')$('lkSw').checked=false;if(!ok)alert('That was not confirmed, so nothing changed.');show()};
$('lkSw').onchange=function(){if(this.checked){if(info.secure===false){this.checked=false;return alert('Set a screen lock (PIN, pattern or fingerprint) in your phone settings first.')}A.lockEnable(pick)}else{if(info.on)A.lockDisable();else show()}};
$('lkTime').onclick=function(e){var m=e.target.getAttribute&&e.target.getAttribute('data-m');if(m===null||m===undefined)return;pick=+m;chips();if(info.on)A.lockEnable(pick)};
show()})()</script>`, req.user));
  });
  app.post('/settings/security/verify', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (limited('lockpw:' + req.user.id, 8, 10 * 60e3)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
    if (!hasOwnPw(req.user.id)) return res.json({ ok: true });
    const u = db.prepare('SELECT hash FROM users WHERE id=?').get(req.user.id);
    if (!u || !bcrypt.compareSync(String((req.body && req.body.password) || ''), u.hash)) return res.json({ error: 'That is not your password.' });
    res.json({ ok: true });
  });
  app.post('/settings/security/password', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (limited('chpw:' + req.user.id, 8, 10 * 60e3)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
    const u = db.prepare('SELECT hash,email FROM users WHERE id=?').get(req.user.id), cur = String((req.body && req.body.current) || ''), pw = String((req.body && req.body.next) || '');
    if (hasOwnPw(req.user.id) && !bcrypt.compareSync(cur, u.hash)) return res.json({ error: 'Your current password is not right.' });
    if (pw.length < 8) return res.json({ error: 'Password must be at least 8 characters.' });
    if (pw.length > 200) return res.json({ error: 'That password is too long.' });
    if (weakPw(pw, u.email)) return res.json({ error: 'That password is too easy to guess. Please pick something less common.' });
    if (bcrypt.compareSync(pw, u.hash)) return res.json({ error: 'Pick a different password from the old one.' });
    db.prepare('UPDATE users SET hash=?, gsignup=0 WHERE id=?').run(bcrypt.hashSync(pw, 12), req.user.id);
    if (req.sid) db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(req.user.id, sidKey(req.sid)); // other devices must log in again
    res.json({ ok: true });
  });
};
