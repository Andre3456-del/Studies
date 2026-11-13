// Stories: a picture or a few words that your friends can see for 24 hours (the round circles at the top of the chat list).
const multer = require('multer');
module.exports = function register(app, ctx) {
  const { db, esc, friendIds, layout } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS stories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT, bg INTEGER DEFAULT 0, media_data BLOB, media_mime TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS stories_user ON stories(user_id, created_at);
CREATE TABLE IF NOT EXISTS story_views (story_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(story_id, user_id))`);
  const DAY = 24 * 3600 * 1000;
  const BG = ['linear-gradient(135deg,#1d5fb5,#0b2a5c)', 'linear-gradient(135deg,#7a2f6e,#1c1038)', 'linear-gradient(135deg,#0f4a3c,#06201b)', 'linear-gradient(135deg,#b8501f,#4a1a0a)', 'linear-gradient(135deg,#3b3f9a,#161a4a)'];
  const live = () => Date.now() - DAY;
  const mu = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 1 } }).single('photo');
  const take = (req, res, next) => mu(req, res, err => { if (err) req.uploadError = 'That file is too big (pictures 10 MB, videos 40 MB at most).'; next(); });
  const canSee = (me, owner) => me === owner || friendIds(me).includes(owner);
  setInterval(() => { try { db.prepare('DELETE FROM stories WHERE created_at<?').run(live()); db.exec('DELETE FROM story_views WHERE story_id NOT IN (SELECT id FROM stories)'); } catch (e) {} }, 3600 * 1000).unref();

  // Who has a story right now, and whether the viewer has seen all of it: { userId: { first, seen } }
  module.exports.storiesFor = (me, ids) => {
    const out = {}; if (!ids.length) return out;
    const rows = db.prepare(`SELECT s.id,s.user_id,(SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=?) seen FROM stories s WHERE s.created_at>? AND s.user_id IN (${ids.map(Number).join(',') || '0'}) ORDER BY s.id`).all(me, live());
    for (const r of rows) { const o = out[r.user_id] || (out[r.user_id] = { first: r.id, seen: true }); if (!r.seen) { if (o.seen) o.first = r.id; o.seen = false; } }
    return out;
  };

  app.get('/stories/new', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/stories/new');
    res.set('Cache-Control', 'no-store').send(layout('New story', `<style>.stnew [hidden]{display:none!important}.stnew{display:flex;flex-direction:column;gap:12px;max-width:460px;margin:0 auto}.stprev{position:relative;aspect-ratio:9/14;max-height:68vh;border-radius:20px;overflow:hidden;background:linear-gradient(160deg,#0b2a5b,#0a1020);display:flex;align-items:center;justify-content:center}.stprev img,.stprev video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}.stpick{display:flex;flex-direction:column;align-items:center;gap:10px;color:#fff;cursor:pointer;padding:30px}.stpick .ic{width:56px;height:56px;fill:none;stroke:#fff;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.stx{position:absolute;top:10px;right:10px;z-index:3;width:36px;height:36px;border-radius:50%;padding:0;background:rgba(0,0,0,.55);color:#fff;font-size:22px;box-shadow:none;border:0}.stcap{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:30px 12px 12px;background:linear-gradient(transparent,rgba(0,0,0,.7))}.stcap textarea{width:100%;resize:none;border:0;border-radius:22px;background:rgba(255,255,255,.18);color:#fff;padding:11px 16px;font:inherit;margin:0;box-sizing:border-box;max-height:120px}.stcap textarea::placeholder{color:rgba(255,255,255,.75)}.stbar{display:flex;align-items:center;gap:12px}.stbar .ic{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.stchg{display:flex;width:46px;height:46px;border-radius:50%;align-items:center;justify-content:center;background:var(--panel,#16233f);cursor:pointer}.stbar #stInfo{flex:1}#stGo{width:54px;height:54px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;margin:0}#stGo .ic{stroke:#fff}</style><form method="post" action="/stories" enctype="multipart/form-data" id="stForm" class="stnew">
<div class="stprev" id="stPrev"><div class="stempty" id="stEmpty"><label class="stpick" for="stFile"><svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-5-8 8"/></svg><b>Photo or video</b></label></div>
<img id="stImg" alt="" hidden><video id="stVid" playsinline muted loop hidden></video>
<button type="button" id="stX" class="stx" aria-label="Remove" hidden>&times;</button>
<div class="stcap"><textarea name="text" id="stText" maxlength="200" rows="1" placeholder="Add a caption"></textarea></div></div>
<input type="file" name="photo" id="stFile" accept="image/*,video/*" hidden>
<div class="stbar"><label for="stFile" class="stchg" aria-label="Choose another"><svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-5-8 8"/></svg></label><span id="stInfo" class="mut"></span><button id="stGo" aria-label="Share"><svg class="ic" viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button></div></form>
<script>(function(){var f=document.getElementById('stFile'),img=document.getElementById('stImg'),vid=document.getElementById('stVid'),em=document.getElementById('stEmpty'),x=document.getElementById('stX'),info=document.getElementById('stInfo'),url=null;
function clear(){if(url)URL.revokeObjectURL(url);url=null;f.value='';img.hidden=vid.hidden=x.hidden=true;em.hidden=false;vid.removeAttribute('src');info.textContent='';document.getElementById('stPrev').classList.remove('has')}
f.onchange=function(){var a=f.files[0];if(!a)return;var v=/^video\//.test(a.type);if(a.size>(v?40:10)*1048576){alert(v?'Videos can be 40 MB at most.':'Pictures can be 10 MB at most.');clear();return}
 if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(a);em.hidden=true;x.hidden=false;document.getElementById('stPrev').classList.add('has');
 if(v){img.hidden=true;vid.hidden=false;vid.src=url;vid.play().catch(function(){});vid.onloadedmetadata=function(){info.textContent=Math.round(vid.duration)+' s'}}else{vid.hidden=true;vid.pause();img.hidden=false;img.src=url;info.textContent=''}};
x.onclick=clear;
var t=document.getElementById('stText');t.oninput=function(){t.style.height='auto';t.style.height=Math.min(t.scrollHeight,120)+'px'};
document.getElementById('stForm').onsubmit=function(e){if(!f.files[0]&&!t.value.trim()){e.preventDefault();t.focus()}else document.getElementById('stGo').disabled=true}})()</script>`, req.user));
  });
  app.post('/stories', take, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const text = String(req.body.text || '').trim().slice(0, 200), f = req.file;
    const isVid = f && /^video\/(mp4|webm|quicktime|3gpp)$/i.test(f.mimetype || ''), isImg = f && /^image\/(jpeg|png|webp|gif)$/i.test(f.mimetype || '');
    if (req.uploadError || (f && !isVid && !isImg) || (isImg && f.size > 10 * 1024 * 1024)) return res.status(400).send(layout('New story', `<p class="err">${esc(req.uploadError || 'Use a picture or a video.')}</p><p><a href="/stories/new">Try again</a></p>`, req.user));
    if (!text && !f) return res.redirect('/stories/new');
    const id = db.prepare('INSERT INTO stories(user_id,text,bg,media_data,media_mime,created_at) VALUES(?,?,?,?,?,?)').run(req.user.id, text, Math.floor(Math.random() * BG.length), f ? f.buffer : null, f ? f.mimetype : null, Date.now()).lastInsertRowid;
    res.redirect('/stories/' + req.user.id);
  });
  app.get('/stories/media/:id', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const s = db.prepare('SELECT user_id,media_data,media_mime,created_at FROM stories WHERE id=?').get(Number(req.params.id));
    if (!s || !s.media_data || s.created_at < live() || !canSee(req.user.id, s.user_id)) return res.sendStatus(404);
    const buf = s.media_data, total = buf.length, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const h = { 'Content-Type': s.media_mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    if (!m) return res.set({ ...h, 'Content-Length': total }).send(buf);
    let a = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]), b = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (a > b || a >= total) return res.status(416).set('Content-Range', 'bytes */' + total).end();
    res.status(206).set({ ...h, 'Content-Range': `bytes ${a}-${b}/${total}`, 'Content-Length': b - a + 1 }).send(buf.subarray(a, b + 1));
  });
  app.post('/stories/:id/delete', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('DELETE FROM stories WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
    res.redirect('/chat');
  });
  app.post('/stories/:id/seen', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('INSERT OR IGNORE INTO story_views(story_id,user_id) VALUES(?,?)').run(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app.get('/stories/:uid', (req, res) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    const uid = Number(req.params.uid);
    const queue = String(req.query.q || '').split(',').map(Number).filter(n => n > 0).slice(0, 40);
    const onward = () => queue.length ? '/stories/' + queue[0] + (queue.length > 1 ? '?q=' + queue.slice(1).join(',') : '') : '/chat';
    if (!canSee(req.user.id, uid)) return res.redirect(onward());
    const owner = db.prepare('SELECT id,name FROM users WHERE id=?').get(uid);
    const list = owner ? db.prepare('SELECT id,text,bg,media_mime,created_at FROM stories WHERE user_id=? AND created_at>? ORDER BY id').all(uid, live()) : [];
    if (!list.length) return res.redirect(uid === req.user.id && !queue.length ? '/stories/new' : onward());
    const data = list.map(s => ({ id: s.id, text: s.text || '', bg: BG[s.bg % BG.length], img: s.media_mime && !/^video\//.test(s.media_mime) ? '/stories/media/' + s.id : '', vid: s.media_mime && /^video\//.test(s.media_mime) ? '/stories/media/' + s.id : '', at: s.created_at }));
    const mine = uid === req.user.id;
    res.set('Cache-Control', 'no-store').send(layout('Story', `<div id="stv" style="position:fixed;inset:0;z-index:200;background:#000;color:#fff;display:flex;flex-direction:column">
<div id="stBars" style="display:flex;gap:4px;padding:calc(10px + env(safe-area-inset-top,0px)) 10px 8px"></div>
<div style="display:flex;align-items:center;gap:10px;padding:4px 14px"><a href="/chat" style="color:#fff;font-size:22px;text-decoration:none" aria-label="Close">&times;</a><b>${esc(owner.name)}${mine ? ' (You)' : ''}</b><span id="stAgo" style="opacity:.7;font-size:13px"></span><span style="flex:1"></span>${mine ? '<form method="post" id="stDel" style="margin:0"><button aria-label="Delete this story" style="background:transparent;border:0;color:#fff;font-size:20px;padding:6px;box-shadow:none">&#128465;</button></form><a href="/stories/new" style="color:#fff;font-size:24px;text-decoration:none" aria-label="Add another">+</a>' : ''}</div>
<div id="stBody" style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-size:26px;font-weight:600;overflow:hidden"><img id="stImg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none"><video id="stVid" playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none"></video><div id="stTxt" style="position:relative;z-index:1;text-shadow:0 2px 12px rgba(0,0,0,.6);max-width:90%;overflow-wrap:anywhere"></div>
<div id="stPrev" style="position:absolute;left:0;top:0;bottom:0;width:35%;z-index:2"></div><div id="stNext" style="position:absolute;right:0;top:0;bottom:0;width:65%;z-index:2"></div></div></div>
<script>(function(){var NEXT=${JSON.stringify(onward())},L=${JSON.stringify(data).replace(/</g, '\\u003c')},i=0,t=null,bars=document.getElementById('stBars'),mine=${mine ? 'true' : 'false'};
L.forEach(function(){var b=document.createElement('div');b.style.cssText='flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.3);overflow:hidden';b.innerHTML='<i style="display:block;height:100%;width:0;background:#fff"></i>';bars.appendChild(b)});
function ago(ms){var m=Math.max(1,Math.round((Date.now()-ms)/60000));return m<60?m+'m':Math.round(m/60)+'h'}
function show(n){clearTimeout(t);if(n<0)n=0;if(n>=L.length){location.href=NEXT;return}i=n;var s=L[n],img=document.getElementById('stImg'),vid=document.getElementById('stVid'),body=document.getElementById('stBody'),dur=5000;
 body.style.background=(s.img||s.vid)?'#000':s.bg;img.style.display=s.img?'block':'none';if(s.img)img.src=s.img;vid.onloadedmetadata=null;vid.pause();vid.style.display=s.vid?'block':'none';
 var txt=document.getElementById('stTxt');txt.textContent=s.text;if(s.img||s.vid){txt.style.cssText='position:absolute;z-index:1;left:0;right:0;bottom:0;max-width:none;padding:40px 18px calc(22px + env(safe-area-inset-bottom,0px));font-size:17px;font-weight:500;background:linear-gradient(transparent,rgba(0,0,0,.7));text-shadow:none;overflow-wrap:anywhere;text-align:center'+(s.text?'':';display:none')}else txt.style.cssText='position:relative;z-index:1;text-shadow:0 2px 12px rgba(0,0,0,.6);max-width:90%;overflow-wrap:anywhere';
 document.getElementById('stAgo').textContent=ago(s.at);
 var d=document.getElementById('stDel');if(d)d.action='/stories/'+s.id+'/delete';
 if(!mine)try{fetch('/stories/'+s.id+'/seen',{method:'POST',credentials:'same-origin'})}catch(e){}
 function run(ms){Array.prototype.forEach.call(bars.children,function(b,k){var f=b.firstChild;f.style.transition='none';f.style.width=k<n?'100%':'0';if(k===n){void f.offsetWidth;f.style.transition='width '+ms+'ms linear';f.style.width='100%'}});t=setTimeout(function(){show(n+1)},ms)}
 if(s.vid){Array.prototype.forEach.call(bars.children,function(b,k){b.firstChild.style.transition='none';b.firstChild.style.width=k<n?'100%':'0'});vid.src=s.vid;vid.currentTime=0;
  vid.onloadedmetadata=function(){var ms=Math.min(60000,Math.max(3000,Math.round((vid.duration||5)*1000)));run(ms);vid.play().catch(function(){vid.muted=true;vid.play().catch(function(){})})};
  t=setTimeout(function(){show(n+1)},65000)}else run(dur)}
document.getElementById('stNext').onclick=function(){show(i+1)};document.getElementById('stPrev').onclick=function(){show(i-1)};show(0)})()</script>`, req.user, { hideTop: true, noAI: true, noFeedback: true }));
  });
};
