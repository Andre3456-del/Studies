// Backup of the app's saved materials list and settings
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db, esc, inApp, layout } = ctx;
  // ---------- backup of the app's saved materials list and settings, kept in the person's account ----------
  // Only the list (names, courses, sizes) and the app settings are stored, a few KB. The files themselves are downloaded again from
  // Studies Hub when the person restores, so this never holds large files. Chats, profile and friends already live in the account.
  db.exec('CREATE TABLE IF NOT EXISTS app_backups(user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, items INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)');
  const BK_PREFS = ['auto', 'wifi', 'bkFreq', 'bkWifi'];
  app.get('/api/backup', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Log in first.' });
    const r = db.prepare('SELECT items,bytes,at FROM app_backups WHERE user_id=?').get(req.user.id);
    res.json(r ? { have: true, items: r.items, bytes: r.bytes, at: r.at, email: req.user.email } : { have: false, email: req.user.email });
  });
  app.get('/api/backup/data', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Log in first.' });
    const r = db.prepare('SELECT data,at FROM app_backups WHERE user_id=?').get(req.user.id);
    if (!r) return res.json({ have: false });
    let d = {}; try { d = JSON.parse(r.data); } catch (e) { }
    res.json({ have: true, at: r.at, items: d.items || [], prefs: d.prefs || {} });
  });
  app.post('/api/backup', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Log in first.' });
    const b = req.body || {}, src = Array.isArray(b.items) ? b.items.slice(0, 5000) : [];
    const items = src.map(o => ({ slug: String((o && o.slug) || '').slice(0, 120), title: String((o && o.title) || '').slice(0, 200), kind: String((o && o.kind) || '').slice(0, 20), course: String((o && o.course) || '').slice(0, 200), size: Math.max(0, Number(o && o.size) || 0) })).filter(o => o.slug);
    if (!items.length) return res.status(400).json({ error: 'Nothing to back up yet.' });
    const prefs = {}; for (const k of BK_PREFS) if (b.prefs && k in b.prefs) prefs[k] = typeof b.prefs[k] === 'boolean' ? b.prefs[k] : String(b.prefs[k]).slice(0, 20);
    const bytes = items.reduce((n, o) => n + o.size, 0), at = Date.now();
    db.prepare('INSERT INTO app_backups(user_id,data,items,bytes,at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, items=excluded.items, bytes=excluded.bytes, at=excluded.at').run(req.user.id, JSON.stringify({ items, prefs }), items.length, bytes, at);
    res.json({ ok: true, items: items.length, bytes, at });
  });
  app.get('/settings/backup', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/backup');
    if (!inApp(req)) return res.redirect('/settings');
    res.send(layout('Backup', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Backup</h1>
<p class="mut">Your materials saved in the app and your app settings are backed up to your Studies Hub account (<b>${esc(req.user.email)}</b>). If you delete the app and install it again, log in with this email and you can get them back. Your chats, profile and friends are already kept in your account, so they come back by themselves.</p>
<div class="card"><b>What is on this phone</b><div style="height:10px;border-radius:6px;background:rgba(127,127,127,.25);margin:10px 0;overflow:hidden"><div id="bkBar" style="height:100%;width:0;background:#5bc8ff"></div></div><p class="mut" id="bkUse" style="margin:0;font-size:14px">Checking&hellip;</p></div>
<div class="card"><b>What is backed up</b><p class="mut" id="bkWhat" style="margin:6px 0 0;font-size:14px">Checking&hellip;</p></div>
<div class="card"><label for="bkFreq"><b>Back up automatically</b></label><select id="bkFreq" style="width:100%;margin-top:8px"><option value="off">Off</option><option value="day">Every day</option><option value="week">Every week</option><option value="month">Every month</option></select>
<label class="swrow" style="margin-top:14px"><span><b>Back up on Wi-Fi only</b><br><span class="mut" id="bkWifiInfo" style="font-size:13px"></span></span><input type="checkbox" role="switch" class="shsw" id="bkWifi" aria-label="Back up on Wi-Fi only"></label></div>
<div class="card"><b>Google Drive</b><p class="mut" style="margin:6px 0 10px;font-size:14px">Keep your backup in your own Google storage (the same storage as your Gmail). Only Studies Hub can see it, and it works with Google accounts only.</p><p class="mut" id="gdInfo" style="margin:0 0 10px;font-size:14px"></p><div id="gdBtns"></div></div>
<div class="card"><button type="button" id="bkNow">Back up now</button> <button type="button" class="ghost" id="bkRestore">Restore from backup</button><p class="mut" id="bkMsg" style="margin:10px 0 0;font-size:14px"></p></div>
<script>(function(){var A=window.StudiesApp,$=function(i){return document.getElementById(i)};
if(!A||!A.bkGet){document.querySelector('main').insertAdjacentHTML('beforeend','<p class="mut">Backup is only available in the Studies Hub app. If you already have the app, update it from the app page.</p>');return}
function mb(n){return n>=1073741824?(n/1073741824).toFixed(1)+' GB':(n/1048576).toFixed(1)+' MB'}
function when(t){try{return new Date(t).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}catch(e){return ''}}
function list(){var l=[];try{l=JSON.parse(A.offList())}catch(e){}return l}
var cfg={};try{cfg=JSON.parse(A.bkGet())}catch(e){}
$('bkFreq').value=cfg.freq||'off';$('bkWifi').checked=cfg.wifiOnly!==false;
function wifiInfo(){$('bkWifiInfo').textContent=$('bkWifi').checked?'On. Backups wait for Wi-Fi so your mobile data is not used.':'Off. Backups can use mobile data.'}wifiInfo();
function save(){A.bkSet($('bkFreq').value,$('bkWifi').checked);wifiInfo()}
$('bkFreq').onchange=save;$('bkWifi').onchange=save;
function space(){var s={};try{s=JSON.parse(A.bkSpace())}catch(e){}var pct=s.total?Math.max(s.app>0?0.5:0,s.app/s.total*100):0;
 $('bkBar').style.width=Math.min(100,pct)+'%';
 $('bkUse').textContent='Studies Hub uses '+mb(s.app||0)+' on this phone ('+pct.toFixed(1)+'% of its storage). '+mb(s.free||0)+' is free.'}
function server(){fetch('/api/backup',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(b){var l=list(),sz=l.reduce(function(n,o){return n+(o.size||0)},0);
 $('bkWhat').innerHTML=(l.length?l.length+' saved material'+(l.length===1?'':'s')+' ('+mb(sz)+') and your app settings are ready to back up.':'No saved materials yet. Your app settings are backed up.')+'<br>'+(b.have?'Last backup: '+when(b.at)+' ('+b.items+' material'+(b.items===1?'':'s')+').':'No backup made yet.')}).catch(function(){$('bkWhat').textContent='Could not check. Connect to the internet and try again.'})}
space();server();
function prefs(){var p={bkFreq:$('bkFreq').value,bkWifi:$('bkWifi').checked};try{p.auto=!!A.offAutoOn();p.wifi=!!A.offWifiOn()}catch(e){}return p}
function msg(t,bad){var m=$('bkMsg');m.textContent=t;m.style.color=bad?'#ef4444':''}
$('bkNow').onclick=function(){var l=list();if(!l.length){msg('Nothing saved on this phone yet, so there is nothing to back up.',1);return}
 if(window.__netState==='offline'){msg('Check your internet connection and try again.',1);return}
 msg('Backing up…');fetch('/api/backup',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:l,prefs:prefs()})}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){if(!x.ok){msg(x.j.error||'Could not back up. Try again.',1);return}msg('Backed up. '+x.j.items+' material'+(x.j.items===1?'':'s')+'.');server()}).catch(function(){msg('Check your internet connection and try again.',1)})};
function gdi(){var g={};try{g=JSON.parse(A.gdInfo())}catch(e){}return g}
function btn(t,f,cls){var b=document.createElement('button');b.type='button';b.textContent=t;if(cls)b.className=cls;b.style.marginRight='8px';b.style.marginBottom='8px';b.onclick=f;return b}
function gdDraw(){var g=gdi(),box=$('gdBtns'),inf=$('gdInfo');if(!A.gdInfo){inf.textContent='Update the app to use Google Drive.';return}box.innerHTML='';
 if(!g.on){inf.textContent=g.msg||'Not connected.';box.appendChild(btn('Connect Google Drive',function(){A.gdConnect();inf.textContent='Opening Google…'}));return}
 var t='Connected.';if(g.last)t+=' Last backup to Drive: '+when(g.last)+'.';if(g.msg)t+=' '+g.msg;inf.textContent=t;
 if(g.found&&g.found.items)box.appendChild(btn('Restore from Drive ('+g.found.items+' material'+(g.found.items===1?'':'s')+')',function(){msg('Looking in your Google Drive…');A.gdRestore()}));
 box.appendChild(btn('Back up to Drive now',function(){if(window.__netState==='offline'){msg('Check your internet connection and try again.',1);return}A.gdBackup();msg('Backing up to Google Drive…')},'ghost'));
 box.appendChild(btn('Disconnect',function(){A.gdOff();gdDraw()},'ghost'))}
window.__gdData=function(t){if(!t){msg('No backup found in your Google Drive.',1);return}var d;try{d=JSON.parse(t)}catch(e){msg('That backup could not be read.',1);return}window.__bkRestoreData(d,function(x,bad){msg(x,bad)})};
gdDraw();setInterval(function(){if(!document.hidden)gdDraw()},2000);
$('bkRestore').onclick=function(){if(!window.__bkRestore){msg('Update the app to use this.',1);return}msg('Looking for your backup…');window.__bkRestore(function(t,bad){msg(t,bad)})}})()</script>`, req.user));
  });
};
