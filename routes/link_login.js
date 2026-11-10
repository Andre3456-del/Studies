// Linking a laptop from the phone, devices, sign-in, email verification
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { DUMMY_HASH, authForm, baseUrl, bcrypt, canLecturerAdmin, crypto, db, esc, fails, layout, noteFail, notice, resendForm, safeNext, sendSafely, sha, sidKey, startSession, tooMany } = ctx;
  // ---------- link a laptop from your phone (like WhatsApp Web) ----------
  // A laptop cannot log in with a password. It shows a QR code; a phone that is already logged in scans it and approves.
  // The phone can cut the laptop off at any time from Settings > Linked devices.
  const { qrSvg } = require('../lib/qr');
  const isPhoneAgent = req => /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(String(req.headers['user-agent'] || ''));
  // A laptop = a computer browser, or any screen wide enough for the laptop layout (the page tells us its width in a cookie).
  const cookieOf = (req, name) => { const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(String(req.headers.cookie || '')); return m ? decodeURIComponent(m[1]) : ''; };
  // What kind of device is this? phone | tablet | laptop (the page also reports it in a cookie after its first load, which is how
  // an iPad that pretends to be a Mac, or a phone set to "desktop site", is recognised).
  function deviceOf(req) {
    const ua = String(req.headers['user-agent'] || '');
    if (/iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return 'phone';
    const c = cookieOf(req, 'dev');
    if (c === 'phone' || c === 'tablet' || c === 'laptop') return c;
    if (/iPad|Android/i.test(ua)) return 'tablet';
    return 'laptop';
  }
  const isLaptop = req => deviceOf(req) === 'laptop';
  const isWideScreen = req => deviceOf(req) !== 'phone' && /(^|;\s*)wide=1/.test(String(req.headers.cookie || ''));
  const deviceLabel = req => {
    const ua = String(req.headers['user-agent'] || '');
    const app = /StudiesHubApp\/[\d.]+(?: \(([^)]{2,60})\))?/.exec(ua);
    if (app) return `${app[1] ? app[1].trim() : 'Android phone'} (Studies Hub app)`; // the phone's own name
    const os = /iPhone|iPod/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) ? 'iPad' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /CrOS/i.test(ua) ? 'Chromebook' : /Linux/i.test(ua) ? 'Linux' : 'a computer';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const model = os === 'Android' ? ((/Android [\d.]+; ([^;)]+)/.exec(ua) || [])[1] || '').trim() : '';
    return `${br} on ${os}${model && model !== 'K' ? ' (' + model + ')' : ''}`;
  };
  // A device that was logged in by scanning a code is a "linked" device: it cannot see or use Linked devices (only the main phone can).
  const isLinkedSession = req => !!req.sid && !!db.prepare('SELECT 1 FROM linked_devices WHERE sid=?').get(sidKey(req.sid));
  const canLinkOthers = req => !isLaptop(req) && !isLinkedSession(req);
  const LINK_TTL = 5 * 60 * 1000;
  // A code made on the Lecturer Portal can only be approved by a lecturer / school-staff account; a student code only by a non-lecturer account.
  const linkKindOf = next => /^\/(lecturer|uni)/.test(String(next || '')) ? 'lecturer' : 'student';
  const staffAccount = u => !!u && (!!u.is_lecturer || u.role === 'uniadmin' || u.role === 'admin' || canLecturerAdmin(u));
  const studentAccount = u => !!u && !u.is_lecturer && u.role !== 'uniadmin';
  const mayApproveKind = (u, kind) => kind === 'lecturer' ? staffAccount(u) : studentAccount(u);
  function linkPage(req, next, note) {
    db.prepare('DELETE FROM device_links WHERE created<?').run(Date.now() - 3600e3);
    const token = crypto.randomBytes(16).toString('hex');
    const kind = linkKindOf(next);
    db.prepare('INSERT INTO device_links(token,created,label,kind) VALUES(?,?,?,?)').run(sha(token), Date.now(), deviceLabel(req), kind);
    const origin = baseUrl(req).replace(/\/$/, '');
    const svg = qrSvg(`${origin}/link/${token}`, 6);
    return layout('Log in', `<div class="card auth" style="text-align:center"><h1 style="margin-top:0">${kind === 'lecturer' ? 'Lecturer Portal: log in with your phone' : 'Log in with your phone'}</h1>${kind === 'lecturer' ? '<p class="mut" style="margin-top:0">For lecturers and school staff.</p>' : ''}
${note ? `<p class="err">${esc(note)}</p>` : ''}
<div style="display:inline-block;background:#fff;padding:6px;border-radius:14px;max-width:100%"><div id="qrBox" style="width:min(300px,80vw)">${svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="auto"')}</div></div>
<p id="linkMsg" class="mut" style="margin:10px 0 0">Waiting for your phone&hellip;</p>
<ol style="text-align:left;line-height:1.7;margin:14px auto 6px;max-width:340px;padding-left:20px"><li>Open Studies Hub on your ${isLaptop(req) ? 'phone' : 'main phone (already logged in)'}.</li><li>Go to <b>Settings &rarr; Linked devices</b>.</li><li>Tap <b>Link a device</b> and point the phone at this code.</li></ol>${isLaptop(req) ? '' : '<p style="margin:10px 0 0"><a href="/login">Use email and password instead</a></p>'}
</div>
<script>(function(){var t=${JSON.stringify(token)},next=${JSON.stringify(next || '/dashboard')},m=document.getElementById('linkMsg'),stop=false;
function tick(){if(stop)return;fetch('/link/status/'+t,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){
if(j.state==='ok'){stop=true;m.textContent='Linked! Opening…';location.href=next}
else if(j.state==='expired'){stop=true;m.innerHTML='This code timed out. <a href="/login">Get a new one</a>'}
else setTimeout(tick,2000)}).catch(function(){setTimeout(tick,3000)})}
tick()})()</script>`, null);
  }
  app.get('/link/status/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const row = db.prepare('SELECT * FROM device_links WHERE token=?').get(sha(String(req.params.token)));
    if (!row || row.done || Date.now() - row.created > LINK_TTL) return res.json({ state: 'expired' });
    if (!row.approved || !row.user_id) return res.json({ state: 'wait' });
    const claimed = db.prepare('UPDATE device_links SET done=1 WHERE token=? AND done=0').run(row.token);
    if (!claimed.changes) return res.json({ state: 'expired' });
    const key = startSession(res, row.user_id);
    db.prepare('INSERT OR REPLACE INTO linked_devices(sid,user_id,label,created) VALUES(?,?,?,?)').run(key, row.user_id, row.label || 'Computer', Date.now());
    res.json({ state: 'ok' });
  });
  app.get('/link/:token', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || req.url));
    if (!canLinkOthers(req)) return res.status(403).send(notice('Not from this device', 'This device was linked by a code, so it cannot link other devices. Use your main phone.', '<p><a href="/">Home</a></p>'));
    const row = db.prepare('SELECT * FROM device_links WHERE token=?').get(sha(String(req.params.token)));
    if (!row || row.done || Date.now() - row.created > LINK_TTL) return res.status(404).send(notice('Code expired', 'This code is no longer valid. Ask the laptop to show a fresh one.', '<p><a href="/settings/devices">Back</a></p>'));
    const kindNow = row.kind === 'lecturer' ? 'lecturer' : 'student';
    if (!mayApproveKind(req.user, kindNow)) return res.status(403).send(notice(kindNow === 'lecturer' ? 'Lecturer Portal code' : 'Student code', kindNow === 'lecturer' ? 'This laptop is on the Lecturer Portal, which needs a lecturer account. You are logged in with a student account, so you cannot link it.' : 'This laptop is on the student login. You are logged in with a lecturer account, so use the Lecturer Portal code on the laptop instead.', '<p><a href="/settings/devices">Back</a></p>'));
    res.send(layout('Link a device', `<div class="card auth"><h1 style="margin-top:0">Link this laptop?</h1><p>A computer (<b>${esc(row.label || 'Computer')}</b>) wants to log in as <b>${esc(req.user.name)}</b>.</p><p class="mut">Only continue if you are looking at that laptop right now and it is yours. Anyone you link can see your account until you remove them.</p>
<form method="post" action="/link/${esc(req.params.token)}"><button>Yes, link it</button> <a class="btn ghost" href="/settings/devices" style="margin-left:8px">Cancel</a></form></div>`, req.user));
  });
  app.post('/link/:token', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!canLinkOthers(req)) return res.sendStatus(403);
    const h = sha(String(req.params.token));
    const row = db.prepare('SELECT * FROM device_links WHERE token=?').get(h);
    if (!row || row.done || Date.now() - row.created > LINK_TTL) return res.status(404).send(notice('Code expired', 'This code is no longer valid. Ask the laptop to show a fresh one.', '<p><a href="/settings/devices">Back</a></p>'));
    if (!mayApproveKind(req.user, row.kind === 'lecturer' ? 'lecturer' : 'student')) return res.status(403).send(notice('Wrong portal', row.kind === 'lecturer' ? 'This code is for the Lecturer Portal. It needs a lecturer account.' : 'This code is for the student login. Use the Lecturer Portal code with a lecturer account.', '<p><a href="/settings/devices">Back</a></p>'));
    db.prepare('UPDATE device_links SET user_id=?, approved=1 WHERE token=? AND approved IS NULL').run(req.user.id, h);
    res.send(notice('Linked', 'Your laptop is opening Studies Hub now. You can remove it any time from Settings → Linked devices.', '<p><a href="/settings/devices">Linked devices</a></p>'));
  });
  app.get('/settings/devices', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/devices');
    if (!canLinkOthers(req)) return res.redirect('/settings');
    db.prepare('DELETE FROM linked_devices WHERE sid NOT IN (SELECT id FROM sessions WHERE expires>?)').run(Date.now());
    const list = db.prepare('SELECT * FROM linked_devices WHERE user_id=? ORDER BY created DESC').all(req.user.id);
    const rows = list.length ? list.map(d => `<div class="card row" style="align-items:center;justify-content:space-between;gap:12px"><div><b>${esc(d.label)}</b><br><span class="mut" style="font-size:13px">Linked ${esc(new Date(d.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</span></div><form method="post" action="/settings/devices/remove"><input type="hidden" name="sid" value="${esc(d.sid)}"><button class="ghost">Log out</button></form></div>`).join('') : '<p class="mut">No devices are linked yet.</p>';
    res.send(layout('Linked devices', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Linked devices</h1>
<div class="card"><p style="margin-top:0">To use Studies Hub on a laptop, phone or tablet: open it there, choose <b>Log in with a QR code</b>, then scan the code it shows.</p><button id="scanBtn" type="button">Link a device</button>
<div id="scanBox" hidden style="margin-top:12px"><video id="scanVid" playsinline muted style="width:100%;max-width:360px;border-radius:12px;background:#000"></video><p id="scanMsg" class="mut"></p></div></div>
<h2 style="font-size:18px">Linked devices</h2>${rows}${list.length > 1 ? '<form method="post" action="/settings/devices/remove"><input type="hidden" name="sid" value="all"><button class="ghost">Log out of all linked devices</button></form>' : ''}
<script>(function(){var b=document.getElementById('scanBtn'),box=document.getElementById('scanBox'),v=document.getElementById('scanVid'),m=document.getElementById('scanMsg'),stream=null,go=false;
function end(){go=false;if(stream)stream.getTracks().forEach(function(t){t.stop()})}
b.onclick=function(){box.hidden=false;
if(!('BarcodeDetector' in window)||!navigator.mediaDevices){m.textContent='This browser cannot scan inside the page. Open your phone\\u2019s Camera app and point it at the code on the laptop; it will open here.';return}
var det=new BarcodeDetector({formats:['qr_code']});
navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(s){stream=s;v.srcObject=s;v.play();go=true;m.textContent='Point at the code on your laptop\\u2026';
(function loop(){if(!go)return;det.detect(v).then(function(r){for(var i=0;i<r.length;i++){var x=/\\/link\\/([0-9a-f]{32})/.exec(r[i].rawValue||'');if(x){end();location.href='/link/'+x[1];return}}setTimeout(loop,250)}).catch(function(){setTimeout(loop,400)})})()
}).catch(function(){m.textContent='Camera permission was blocked. Allow the camera, or use your phone\\u2019s Camera app on the laptop code.'})};
window.addEventListener('pagehide',end)})()</script>`, req.user));
  });
  app.post('/settings/devices/remove', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!canLinkOthers(req)) return res.sendStatus(403);
    const sid = String(req.body.sid || '');
    const mine = sid === 'all' ? db.prepare('SELECT sid FROM linked_devices WHERE user_id=?').all(req.user.id).map(r => r.sid) : db.prepare('SELECT sid FROM linked_devices WHERE user_id=? AND sid=?').all(req.user.id, sid).map(r => r.sid);
    for (const k of mine) { db.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').run(k, req.user.id); db.prepare('DELETE FROM linked_devices WHERE sid=?').run(k); }
    res.redirect('/settings/devices');
  });

  app.get('/login', (req, res) => {
    const next = safeNext(req.query.next);
    if ((isLaptop(req) && !req.query.admin) || req.query.qr) return res.send(linkPage(req, next));
    res.send(authForm('login', '', next));
  });
  app.post('/login', (req, res) => {
    const next = safeNext(req.body.next);
    if (tooMany(req.ip)) return res.status(429).send(authForm('login', 'Too many attempts. Try again in 15 minutes.', next));
    const who = String(req.body.email || '').trim().toLowerCase().slice(0, 200), acct = 'acct:' + who;
    if (tooMany(acct)) return res.status(429).send(authForm('login', 'Too many attempts on this account. Try again in 15 minutes, or reset your password.', next));
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(who);
    if (!u) bcrypt.compareSync(String(req.body.password || ''), DUMMY_HASH); // same waiting time whether or not the email exists
    if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.hash)) {
      noteFail(req.ip); noteFail(acct);
      return res.status(401).send(authForm('login', 'Wrong email or password.', next));
    }
    if (!u.verified) return res.status(403).send(notice('Verify your email', 'Your email is not verified yet. Check your inbox for the link, or request a new one.', resendForm(u.email)));
    if (isLaptop(req) && u.role !== 'admin') return res.status(403).send(linkPage(req, next, 'Laptops log in by linking with your phone. Scan the code below.'));
    fails.delete('acct:' + who);
    startSession(res, u.id);
    res.redirect(next || '/');
  });

  app.get('/verify', (req, res) => {
    const token = String(req.query.token || '');
    const u = token && db.prepare('SELECT id FROM users WHERE verify_hash=? AND verify_expires>?').get(sha(token), Date.now());
    if (!u) return res.status(400).send(notice('Link invalid or expired', 'Request a new verification email below.', resendForm()));
    db.prepare('UPDATE users SET verified=1, verify_hash=NULL, verify_expires=NULL WHERE id=?').run(u.id);
    res.send(notice('Email verified', 'Your account is active.', '<p><a href="/login">Log in</a></p>'));
  });

  app.post('/resend', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email=? AND verified=0').get(email);
    if (u) await sendSafely(req, u);
    res.send(notice('Check your email', 'If that address has an unverified account, a new link is on its way.', resendForm(email)));
  });
  return { canLinkOthers, deviceOf, isLaptop, isWideScreen, linkPage };
};
