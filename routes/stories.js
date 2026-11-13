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
  const mu = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('photo');
  const take = (req, res, next) => mu(req, res, err => { if (err) req.uploadError = 'That picture is too big (8 MB at most).'; next(); });
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
    res.send(layout('New story', `<p class="mut"><a href="/chat">&larr; Chat</a></p><h1>New story</h1>
<form method="post" action="/stories" enctype="multipart/form-data" class="card" style="margin-top:12px">
<label class="st-pick"><span>&#128247;</span><input type="file" name="photo" accept="image/*" id="stPhoto" style="display:none"><b id="stName">Picture</b></label>
<textarea name="text" maxlength="200" placeholder="Say something" style="width:100%;min-height:90px;font:inherit;padding:12px;margin:10px 0"></textarea>
<button>Share</button></form>
<script>document.getElementById('stPhoto').onchange=function(){document.getElementById('stName').textContent=this.files[0]?this.files[0].name:'Picture'}</script>`, req.user));
  });
  app.post('/stories', take, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const text = String(req.body.text || '').trim().slice(0, 200), f = req.file;
    if (req.uploadError || (f && !/^image\/(jpeg|png|webp|gif)$/i.test(f.mimetype || ''))) return res.status(400).send(layout('New story', `<p class="err">${esc(req.uploadError || 'Use a picture.')}</p><p><a href="/stories/new">Try again</a></p>`, req.user));
    if (!text && !f) return res.redirect('/stories/new');
    const id = db.prepare('INSERT INTO stories(user_id,text,bg,media_data,media_mime,created_at) VALUES(?,?,?,?,?,?)').run(req.user.id, text, Math.floor(Math.random() * BG.length), f ? f.buffer : null, f ? f.mimetype : null, Date.now()).lastInsertRowid;
    res.redirect('/stories/' + req.user.id);
  });
  app.get('/stories/media/:id', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const s = db.prepare('SELECT user_id,media_data,media_mime,created_at FROM stories WHERE id=?').get(Number(req.params.id));
    if (!s || !s.media_data || s.created_at < live() || !canSee(req.user.id, s.user_id)) return res.sendStatus(404);
    res.set({ 'Content-Type': s.media_mime, 'Cache-Control': 'private, max-age=3600' }).send(s.media_data);
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
    const data = list.map(s => ({ id: s.id, text: s.text || '', bg: BG[s.bg % BG.length], img: s.media_mime ? '/stories/media/' + s.id : '', at: s.created_at }));
    const mine = uid === req.user.id;
    res.set('Cache-Control', 'no-store').send(layout('Story', `<div id="stv" style="position:fixed;inset:0;z-index:200;background:#000;color:#fff;display:flex;flex-direction:column">
<div id="stBars" style="display:flex;gap:4px;padding:calc(10px + env(safe-area-inset-top,0px)) 10px 8px"></div>
<div style="display:flex;align-items:center;gap:10px;padding:4px 14px"><a href="/chat" style="color:#fff;font-size:22px;text-decoration:none" aria-label="Close">&times;</a><b>${esc(owner.name)}${mine ? ' (You)' : ''}</b><span id="stAgo" style="opacity:.7;font-size:13px"></span><span style="flex:1"></span>${mine ? '<form method="post" id="stDel" style="margin:0"><button aria-label="Delete this story" style="background:transparent;border:0;color:#fff;font-size:20px;padding:6px;box-shadow:none">&#128465;</button></form><a href="/stories/new" style="color:#fff;font-size:24px;text-decoration:none" aria-label="Add another">+</a>' : ''}</div>
<div id="stBody" style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-size:26px;font-weight:600;overflow:hidden"><img id="stImg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none"><div id="stTxt" style="position:relative;z-index:1;text-shadow:0 2px 12px rgba(0,0,0,.6);max-width:90%;overflow-wrap:anywhere"></div>
<div id="stPrev" style="position:absolute;left:0;top:0;bottom:0;width:35%;z-index:2"></div><div id="stNext" style="position:absolute;right:0;top:0;bottom:0;width:65%;z-index:2"></div></div></div>
<script>(function(){var NEXT=${JSON.stringify(onward())},L=${JSON.stringify(data).replace(/</g, '\\u003c')},i=0,t=null,bars=document.getElementById('stBars'),mine=${mine ? 'true' : 'false'};
L.forEach(function(){var b=document.createElement('div');b.style.cssText='flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.3);overflow:hidden';b.innerHTML='<i style="display:block;height:100%;width:0;background:#fff"></i>';bars.appendChild(b)});
function ago(ms){var m=Math.max(1,Math.round((Date.now()-ms)/60000));return m<60?m+'m':Math.round(m/60)+'h'}
function show(n){clearTimeout(t);if(n<0)n=0;if(n>=L.length){location.href=NEXT;return}i=n;var s=L[n],img=document.getElementById('stImg'),body=document.getElementById('stBody');
 body.style.background=s.img?'#000':s.bg;img.style.display=s.img?'block':'none';if(s.img)img.src=s.img;document.getElementById('stTxt').textContent=s.text;document.getElementById('stAgo').textContent=ago(s.at);
 Array.prototype.forEach.call(bars.children,function(b,k){var f=b.firstChild;f.style.transition='none';f.style.width=k<n?'100%':'0';if(k===n){void f.offsetWidth;f.style.transition='width 5s linear';f.style.width='100%'}});
 var d=document.getElementById('stDel');if(d)d.action='/stories/'+s.id+'/delete';
 if(!mine)try{fetch('/stories/'+s.id+'/seen',{method:'POST',credentials:'same-origin'})}catch(e){}
 t=setTimeout(function(){show(n+1)},5000)}
document.getElementById('stNext').onclick=function(){show(i+1)};document.getElementById('stPrev').onclick=function(){show(i-1)};show(0)})()</script>`, req.user, { hideTop: true, noAI: true, noFeedback: true }));
  });
};
