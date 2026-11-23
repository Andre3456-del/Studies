// CBT tests with a time limit, "one attempt only" or "practice as often as you like", automatic submit when the time ends
// or the student leaves the page, and a results list for whoever uploaded the test.
// The test itself runs in a sealed box (it cannot act as the student), so a trusted frame around it keeps the clock and sends the result.
module.exports = function register(app, ctx) {
  const { db, esc, isCentral, layout } = ctx;
  const express = require('express');
  for (const c of ['cbt_minutes INTEGER DEFAULT 0', 'cbt_once INTEGER DEFAULT 0']) { try { db.exec('ALTER TABLE pages ADD COLUMN ' + c); } catch (e) { /* already there */ } }
  db.exec('CREATE TABLE IF NOT EXISTS cbt_attempts (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL, user_id INTEGER NOT NULL, score INTEGER, total INTEGER, seconds INTEGER, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  db.exec('CREATE TABLE IF NOT EXISTS cbt_starts (page_id INTEGER NOT NULL, user_id INTEGER NOT NULL, started_at INTEGER NOT NULL, done INTEGER DEFAULT 0, PRIMARY KEY(page_id,user_id))');
  const ownsTest = (user, p) => user && (isCentral(user) || p.admin_id === user.id || p.author_id === user.id);
  const note = (t, b) => `<div class="card"><h2 style="margin-top:0">${t}</h2><p class="mut">${b}</p><p><a class="btn" href="/materials">Back to materials</a></p></div>`;

  // Called from the page route for kind "cbt": returns the HTML to send, or null to send the test itself.
  exports_shell = (p, req) => {
    const u = req.user, preview = !u || ownsTest(u, p), once = !!p.cbt_once, mins = Number(p.cbt_minutes) || 0;
    let remaining = mins * 60;
    if (!preview) {
      const att = db.prepare('SELECT id FROM cbt_attempts WHERE page_id=? AND user_id=?').get(p.id, u.id), st = db.prepare('SELECT * FROM cbt_starts WHERE page_id=? AND user_id=?').get(p.id, u.id);
      if (once && att) return layout(p.title, note('You have already taken this test', 'This test can only be done once. Your result has gone to the person who set it.'), u);
      if (once && st && !st.done) { db.prepare('INSERT INTO cbt_attempts(page_id,user_id,score,total,seconds,reason) VALUES(?,?,?,?,?,?)').run(p.id, u.id, null, null, Math.round((Date.now() - st.started_at) / 1000), 'left'); db.prepare('UPDATE cbt_starts SET done=1 WHERE page_id=? AND user_id=?').run(p.id, u.id); return layout(p.title, note('This test was already started', 'It can only be done once, and it was closed before it was finished, so what you had done was sent to the person who set it.'), u); }
      db.prepare('INSERT INTO cbt_starts(page_id,user_id,started_at,done) VALUES(?,?,?,0) ON CONFLICT(page_id,user_id) DO UPDATE SET started_at=excluded.started_at,done=0').run(p.id, u.id, Date.now());
    }
    const cfg = JSON.stringify({ id: p.id, once, mins, remaining, preview, src: '/p/' + p.slug + '?raw=1' + (once ? '&once=1' : '') + '&embed=1' }).replace(/</g, '\\u003c');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><style>
html,body{margin:0;height:100%;background:#0b1530;color:#f1f5ff;font-family:system-ui,sans-serif}#bar{position:fixed;left:0;right:0;top:0;height:50px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#0f1f45;border-bottom:1px solid #ffffff22;z-index:3;box-sizing:border-box}
#bar b{font-size:20px;font-variant-numeric:tabular-nums}#bar span{font-size:13px;opacity:.8;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#fin{background:#2a7fff;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-weight:700}
#t{position:fixed;top:50px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 50px);border:0;background:#fff}#ov{position:fixed;inset:50px 0 0;background:#0b1530f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;z-index:4}#ov[hidden]{display:none}#ov a,#ov button{background:#2a7fff;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-weight:700;text-decoration:none;font-size:16px}
</style><div id="bar"><b id="clk">${mins ? '' : '&infin;'}</b><span id="note"></span><button id="fin" type="button">Finish</button></div><iframe id="t" title="Test" sandbox="allow-scripts allow-forms allow-popups allow-modals"></iframe><div id="ov" hidden><h2 id="ovh" style="margin:0"></h2><p id="ovp" style="margin:0;opacity:.85"></p><div id="ovb"></div></div>
<script>(function(){var C=${cfg},f=document.getElementById('t'),clk=document.getElementById('clk'),ov=document.getElementById('ov'),last={score:0,total:0},done=false,left=C.remaining,tm=null;
document.getElementById('note').textContent=C.preview?'Preview (not recorded)':(C.once?'One attempt only':'Practice: you can repeat it');
f.src=C.src;window.addEventListener('message',function(e){if(e.source===f.contentWindow&&e.data&&e.data.sh==='cbt')last={score:e.data.score|0,total:e.data.total|0}});
function fmt(s){var m=Math.floor(s/60),x=s%60;return(m<10?'0':'')+m+':'+(x<10?'0':'')+x}
function send(why){if(done)return false;done=true;clearInterval(tm);if(!C.preview){try{navigator.sendBeacon('/api/cbt/'+C.id+'/submit',new Blob([JSON.stringify({score:last.score,total:last.total,reason:why})],{type:'application/json'}))}catch(e){}}return true}
function end(why){if(!send(why))return;f.style.display='none';var h=document.getElementById('ovh'),p=document.getElementById('ovp'),b=document.getElementById('ovb');
 h.textContent=why==='time'?'Time is up':'Test submitted';
 p.textContent=C.once?'Your answers have gone to the person who set this test.':'Your score: '+last.score+' / '+last.total;
 b.innerHTML=(C.once?'':'<button type="button" onclick="location.reload()">Try again</button> ')+'<a class="btn ghost" href="/materials">Back</a>';ov.hidden=false}
document.getElementById('fin').onclick=function(){end('finished')};
if(C.mins){clk.textContent=fmt(left);tm=setInterval(function(){left--;clk.textContent=fmt(Math.max(0,left));if(left<=60)clk.style.color='#ff6b6b';if(left<=0)end('time')},1000)}
document.addEventListener('visibilitychange',function(){if(document.hidden&&!done)send('left')});window.addEventListener('pagehide',function(){if(!done)send('left')})})()</script>`;
  };
  // The test inside the box: reports its score to the frame around it.
  exports_inject = (html, once) => {
    const rep = `<script>(function(){function f(){var e=document.getElementById('sc')||document.querySelector('.score,#score,#result');var t=e?e.textContent:'',m=/(\\d+)\\s*(?:\\/|out of|of)\\s*(\\d+)/i.exec(t),tot=Number(document.body&&document.body.getAttribute('data-total'))||0;if(m)parent.postMessage({sh:'cbt',score:+m[1],total:tot||+m[2]},'*')}setInterval(f,1000)})()</script>${once ? '<style>#sc,.score,#score{display:none!important}</style>' : ''}`;
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, rep + '</body>') : html + rep;
  };
  module.exports.shell = (p, req) => exports_shell(p, req);
  module.exports.inject = (h, o) => exports_inject(h, o);

  app.post('/api/cbt/:id/submit', express.json({ limit: '2kb' }), (req, res) => {
    const p = req.user && db.prepare('SELECT id,kind FROM pages WHERE id=?').get(Number(req.params.id));
    if (!p || p.kind !== 'cbt') return res.status(400).end();
    const st = db.prepare('SELECT * FROM cbt_starts WHERE page_id=? AND user_id=?').get(p.id, req.user.id);
    if (!st || st.done) return res.json({ ok: true });
    const b = req.body || {}, n = v => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 100000) ? Math.round(Number(v)) : null, reason = ['time', 'finished', 'left'].includes(b.reason) ? b.reason : 'finished';
    db.prepare('INSERT INTO cbt_attempts(page_id,user_id,score,total,seconds,reason) VALUES(?,?,?,?,?,?)').run(p.id, req.user.id, n(b.score), n(b.total), Math.round((Date.now() - st.started_at) / 1000), reason);
    db.prepare('UPDATE cbt_starts SET done=1 WHERE page_id=? AND user_id=?').run(p.id, req.user.id);
    res.json({ ok: true });
  });
  // Results for whoever set the test.
  const rowsFor = id => db.prepare('SELECT a.*, u.name, u.email FROM cbt_attempts a JOIN users u ON u.id=a.user_id WHERE a.page_id=? ORDER BY a.created_at DESC').all(id);
  app.get('/admin/pages/:id/results', (req, res) => {
    const p = req.user && db.prepare('SELECT * FROM pages WHERE id=?').get(Number(req.params.id));
    if (!p || p.kind !== 'cbt' || !ownsTest(req.user, p)) return res.sendStatus(403);
    const rows = rowsFor(p.id), mm = s => s == null ? '' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    if (req.query.csv) { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="results.csv"' }); const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; return res.send(['Name,Email,Score,Out of,Percent,Time,How it ended,When'].concat(rows.map(r => [r.name, r.email, r.score, r.total, r.total ? Math.round(100 * r.score / r.total) : '', mm(r.seconds), r.reason, r.created_at].map(q).join(','))).join('\n')); }
    res.send(layout('Results', `<p class="mut"><a href="/admin/pages/${p.id}/edit">&larr; Back</a></p><h1 style="font-size:26px">${esc(p.title)}</h1><p class="mut">${p.cbt_once ? 'One attempt only' : 'Practice (can be repeated)'} &middot; ${p.cbt_minutes ? p.cbt_minutes + ' minutes' : 'no time limit'} &middot; ${rows.length} result${rows.length === 1 ? '' : 's'} &middot; <a href="/admin/pages/${p.id}/results?csv=1">Download</a></p>
<div style="overflow-x:auto"><table><tr><th>Name</th><th>Score</th><th>Time</th><th>Ended</th><th>When</th></tr>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.score == null ? '-' : r.score + ' / ' + r.total + (r.total ? ' (' + Math.round(100 * r.score / r.total) + '%)' : '')}</td><td>${mm(r.seconds)}</td><td>${esc(r.reason)}</td><td>${esc(r.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="mut">Nobody has taken it yet.</td></tr>'}</table></div>`, req.user));
  });
};
var exports_shell, exports_inject;
