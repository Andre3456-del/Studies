'use strict';
// CBT tests, the new way.
//  - A lecturer can TYPE the questions (builder), or upload an HTML test. Either one is run as "practice" or as a "test".
//  - Practice: nothing is recorded, the right answer shows straight away, repeat as often as you like.
//  - Test: the student gives a registration number first, answers are not shown, it is recorded once, it can only be opened between
//    an open time and a close time, the clock starts when they enter, and when time (or the close time) is up it is submitted for them.
//    When the test closes, each student is emailed their result. The lecturer gets a table with a CSV download.
// Typed tests are marked here on the server, from the saved answers, so a student can never read the key from the page.
module.exports = function register(app, ctx) {
  const { db, esc, isCentral, layout, deliver, emailShell } = ctx;
  const express = require('express');
  for (const c of ['cbt_mode TEXT', 'cbt_open INTEGER', 'cbt_close INTEGER', 'cbt_shuffle INTEGER DEFAULT 1', 'cbt_qs TEXT']) { try { db.exec('ALTER TABLE pages ADD COLUMN ' + c); } catch (e) { /* already there */ } }
  for (const c of ['student_reg TEXT']) { try { db.exec('ALTER TABLE users ADD COLUMN ' + c); } catch (e) { } }
  for (const c of ['reg TEXT', 'answers TEXT']) { try { db.exec('ALTER TABLE cbt_starts ADD COLUMN ' + c); } catch (e) { } }
  for (const c of ['reg TEXT', 'answered INTEGER', 'emailed INTEGER DEFAULT 0', 'answers TEXT']) { try { db.exec('ALTER TABLE cbt_attempts ADD COLUMN ' + c); } catch (e) { } }
  const TZ = 'Africa/Lagos'; // Nigeria is UTC+1 all year
  const at = ms => new Date(ms).toLocaleString('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
  const toInput = ms => ms ? new Date(ms + 3600000).toISOString().slice(0, 16) : '';
  const fromInput = v => { const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v || '')) ? Date.parse(v + ':00+01:00') : NaN; return Number.isFinite(t) ? t : null; };
  const ownsTest = (u, p) => u && (isCentral(u) || p.admin_id === u.id || p.author_id === u.id);
  const note = (t, b) => `<div class="card"><h2 style="margin-top:0">${t}</h2><p class="mut">${b}</p><p><a class="btn" href="/materials">Back to materials</a></p></div>`;
  const getPage = id => db.prepare("SELECT * FROM pages WHERE id=? AND kind='cbt'").get(Number(id));
  const questionsOf = p => { try { const q = JSON.parse(p.cbt_qs || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } };
  const isTest = p => p.cbt_mode === 'test';

  // Marks typed answers: answers is { questionNumber: chosenOptionNumber }.
  function mark(p, answers) {
    const qs = questionsOf(p); let score = 0, answered = 0; answers = answers && typeof answers === 'object' ? answers : {};
    qs.forEach((q, i) => { const a = answers[i]; if (Number.isInteger(a) && a >= 0 && a < q.o.length) { answered++; if (a === q.a) score++; } });
    return { score, total: qs.length, answered };
  }
  const cleanAnswers = (a, n) => { const o = {}; if (a && typeof a === 'object') for (const k of Object.keys(a)) { const i = Number(k), v = a[k]; if (Number.isInteger(i) && i >= 0 && i < n && Number.isInteger(v) && v >= 0 && v < 10) o[i] = v; } return o; };

  // Writes the result of one test sitting.
  function finish(p, st, body, reason) {
    const built = questionsOf(p).length > 0;
    let score = null, total = null, answered = null, answers = null;
    if (built) { const a = cleanAnswers(body.answers, questionsOf(p).length); const m = mark(p, a); score = m.score; total = m.total; answered = m.answered; answers = JSON.stringify(a); }
    else { const n = v => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 100000) ? Math.round(Number(v)) : null; score = n(body.score); total = n(body.total); answered = n(body.answered); }
    db.prepare('INSERT INTO cbt_attempts(page_id,user_id,score,total,seconds,reason,reg,answered,answers) VALUES(?,?,?,?,?,?,?,?,?)').run(p.id, st.user_id, score, total, Math.round((Date.now() - st.started_at) / 1000), reason, st.reg, answered, answers);
    db.prepare('UPDATE cbt_starts SET done=1 WHERE page_id=? AND user_id=?').run(p.id, st.user_id);
  }

  // ---------- the page a student first lands on ----------
  function shell(p, req) {
    const u = req.user, owner = !u || ownsTest(u, p), test = isTest(p) && !owner, mins = Number(p.cbt_minutes) || 0, now = Date.now();
    let remaining = mins ? mins * 60 : 0;
    if (test) {
      if (p.cbt_open && now < p.cbt_open) return layout(p.title, note('This test is not open yet', 'It opens on ' + at(p.cbt_open) + '.'), u);
      if (p.cbt_close && now >= p.cbt_close) return layout(p.title, note('This test has closed', 'It closed on ' + at(p.cbt_close) + '.'), u);
      if (db.prepare('SELECT 1 FROM cbt_attempts WHERE page_id=? AND user_id=?').get(p.id, u.id)) return layout(p.title, note('You have already taken this test', 'Your result will be emailed to you ' + (p.cbt_close ? 'when the test closes (' + at(p.cbt_close) + ').' : 'shortly.')), u);
      const st = db.prepare('SELECT * FROM cbt_starts WHERE page_id=? AND user_id=?').get(p.id, u.id);
      if (!st || st.done) {
        const me = db.prepare('SELECT student_reg, department, name FROM users WHERE id=?').get(u.id) || {};
        return layout(p.title, `<div class="card" style="max-width:460px;margin:20px auto"><h2 style="margin-top:0">${esc(p.title)}</h2>
<p class="mut">This is a test. ${mins ? 'You have <b>' + mins + ' minutes</b> once you start. ' : ''}${p.cbt_close ? 'The test closes at <b>' + at(p.cbt_close) + '</b>. ' : ''}Answers are not shown while you take it and you can only take it once. Leaving the page submits it. Your result is emailed to you when the test is over.</p>
<form method="post" action="/cbt/${p.id}/enter"><label class="mut">Your registration number</label><input name="reg" value="${esc(me.student_reg || '')}" required maxlength="30" placeholder="e.g. 20/52HA001" autocomplete="off">
<p class="mut" style="font-size:13px">Name: ${esc(me.name || '')} &middot; Department: ${esc(me.department || 'not set (add it in Settings → Profile)')}</p><button>Start the test</button></form></div>`, u);
      }
      const used = (now - st.started_at) / 1000;
      remaining = mins ? mins * 60 - used : 1e9;
      if (p.cbt_close) remaining = Math.min(remaining, (p.cbt_close - now) / 1000);
      if (remaining <= 1) { finish(p, st, { answers: safeJson(st.answers) }, 'time'); return layout(p.title, note('Time is up', 'Your test was submitted. Your result will be emailed to you when the test closes.'), u); }
      remaining = Math.floor(remaining); if (remaining > 1e8) remaining = 0;
    }
    const cfg = JSON.stringify({ id: p.id, mins, remaining, test, practice: !test, src: '/p/' + p.slug + '?raw=1&embed=1' }).replace(/</g, '\\u003c');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><style>
html,body{margin:0;height:100%;background:#0b1530;color:#f1f5ff;font-family:system-ui,sans-serif}#bar{position:fixed;left:0;right:0;top:0;height:50px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#0f1f45;border-bottom:1px solid #ffffff22;z-index:3;box-sizing:border-box}
#bar b{font-size:20px;font-variant-numeric:tabular-nums}#bar span{font-size:13px;opacity:.8;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#fin{background:#2a7fff;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-weight:700}
#t{position:fixed;top:50px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 50px);border:0;background:#fff}#ov{position:fixed;inset:50px 0 0;background:#0b1530f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;z-index:4}#ov[hidden]{display:none}#ov a,#ov button{background:#2a7fff;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700;text-decoration:none}
</style><div id="bar"><b id="clk">&infin;</b><span id="note"></span><button id="fin" type="button">Finish</button></div><iframe id="t" title="Test" sandbox="allow-scripts allow-forms allow-popups allow-modals"></iframe><div id="ov" hidden><h2 id="ovh" style="margin:0"></h2><p id="ovp" style="margin:0;opacity:.85"></p><div id="ovb"></div></div>${require('./calculator')}
<script>(function(){var C=${cfg},f=document.getElementById('t'),clk=document.getElementById('clk'),ov=document.getElementById('ov'),last={score:0,total:0,answers:{}},done=false,left=C.remaining,tm=null,pt=null;
document.getElementById('note').textContent=C.test?'Test: answers are not shown':'Practice: not recorded';
f.src=C.src;window.addEventListener('message',function(e){if(e.source===f.contentWindow&&e.data&&e.data.sh==='cbt'){last={score:e.data.score|0,total:e.data.total|0,answers:e.data.answers||{}};if(C.test){clearTimeout(pt);pt=setTimeout(function(){fetch('/api/cbt/'+C.id+'/progress',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:last.answers})}).catch(function(){})},3000)}}});
function fmt(s){var m=Math.floor(s/60),x=s%60;return(m<10?'0':'')+m+':'+(x<10?'0':'')+x}
function send(why){if(done)return false;done=true;clearInterval(tm);if(C.test){try{navigator.sendBeacon('/api/cbt/'+C.id+'/submit',new Blob([JSON.stringify({answers:last.answers,score:last.score,total:last.total,reason:why})],{type:'application/json'}))}catch(e){}}return true}
function end(why){if(!send(why))return;f.style.display='none';var h=document.getElementById('ovh'),p=document.getElementById('ovp'),b=document.getElementById('ovb');
 h.textContent=why==='time'?'Time is up':(C.test?'Test submitted':'Finished');
 p.textContent=C.test?'Your answers are saved. Your result will be emailed to you when the test is over.':'Your score: '+last.score+' / '+last.total;
 b.innerHTML=(C.test?'':'<button type="button" onclick="location.reload()">Try again</button> ')+'<a class="btn ghost" href="/materials">Back</a>';ov.hidden=false}
document.getElementById('fin').onclick=function(){if(C.test&&!confirm('Submit your test now?'))return;end('finished')};
if(C.mins||(C.test&&left)){if(left){clk.textContent=fmt(left);tm=setInterval(function(){left--;clk.textContent=fmt(Math.max(0,left));if(left<=60)clk.style.color='#ff6b6b';if(left<=0)end('time')},1000)}}
if(C.test){document.addEventListener('visibilitychange',function(){if(document.hidden&&!done)send('left')});window.addEventListener('pagehide',function(){if(!done)send('left')})}})()</script>`;
  }
  const safeJson = s => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };

  // ---------- typed tests: the page the student answers on ----------
  function render(p, req) {
    const owner = !req.user || ownsTest(req.user, p), showKey = owner || !isTest(p);
    const qs = questionsOf(p).map((q, i) => ({ n: i, q: q.q, o: q.o, a: showKey ? q.a : undefined }));
    const data = JSON.stringify({ qs, shuffle: p.cbt_shuffle !== 0, key: showKey }).replace(/</g, '\\u003c');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;padding:14px 14px 80px;font-family:system-ui,sans-serif;background:#fff;color:#14213d;line-height:1.5}.q{border:1px solid #d9e0ee;border-radius:14px;padding:14px;margin:0 0 12px}.q h3{margin:0 0 10px;font-size:16px}
.o{display:block;width:100%;text-align:left;border:1.5px solid #c9d3e8;background:#f7f9ff;border-radius:10px;padding:10px 12px;margin:6px 0;font:inherit;color:inherit}.o.sel{border-color:#2a7fff;background:#e6f0ff}.o.ok{border-color:#16a34a;background:#dcfce7}.o.bad{border-color:#dc2626;background:#fee2e2}
#sc{position:sticky;top:0;background:#fff;padding:6px 0;font-weight:700}</style><div id="sc"></div><div id="qs"></div>
<script>(function(){var D=${data},ans={},qs=D.qs.slice();function sh(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a}
if(D.shuffle)sh(qs);var root=document.getElementById('qs'),sc=document.getElementById('sc'),right=0,got=0;
function post(){parent.postMessage({sh:'cbt',score:right,total:D.qs.length,answers:ans},'*')}
function upd(){sc.textContent=D.key?('Score: '+right+' / '+D.qs.length):('Answered: '+got+' / '+D.qs.length)}
qs.forEach(function(q,k){var d=document.createElement('div');d.className='q';var h=document.createElement('h3');h.textContent=(k+1)+'. '+q.q;d.appendChild(h);
 var idx=q.o.map(function(_,i){return i});if(D.shuffle)sh(idx);var btns=[];
 idx.forEach(function(i,pos){var b=document.createElement('button');b.type='button';b.className='o';b.textContent=String.fromCharCode(65+pos)+'. '+q.o[i];btns.push([b,i]);
  b.onclick=function(){if(D.key&&ans[q.n]!==undefined)return;if(ans[q.n]===undefined)got++;ans[q.n]=i;
   btns.forEach(function(x){x[0].classList.remove('sel')});
   if(D.key){if(i===q.a)right++;btns.forEach(function(x){if(x[1]===q.a)x[0].classList.add('ok');else if(x[1]===i)x[0].classList.add('bad')})}else b.classList.add('sel');
   upd();post()};d.appendChild(b)});root.appendChild(d)});upd();post()})()</script>`;
  }

  // ---------- starting a test ----------
  app.post('/cbt/:id/enter', (req, res) => {
    const p = getPage(req.params.id);
    if (!req.user || !p || !isTest(p) || !ctx.sortedFor(p, req.user) || !ctx.canViewPage(p, req.user)) return res.redirect('/');
    const back = '/p/' + p.slug, reg = String(req.body.reg || '').trim().replace(/\s+/g, ' '), now = Date.now();
    if (!/^[A-Za-z0-9\/\-_. ]{3,30}$/.test(reg)) return res.send(layout(p.title, note('Check your registration number', 'Use 3 to 30 letters, numbers, / or -.').replace('/materials', back).replace('Back to materials', 'Try again'), req.user));
    if ((p.cbt_open && now < p.cbt_open) || (p.cbt_close && now >= p.cbt_close)) return res.redirect(back);
    if (db.prepare('SELECT 1 FROM cbt_attempts WHERE page_id=? AND user_id=?').get(p.id, req.user.id)) return res.redirect(back);
    const had = db.prepare('SELECT done FROM cbt_starts WHERE page_id=? AND user_id=?').get(p.id, req.user.id);
    if (!had || had.done) db.prepare('INSERT INTO cbt_starts(page_id,user_id,started_at,done,reg,answers) VALUES(?,?,?,0,?,NULL) ON CONFLICT(page_id,user_id) DO UPDATE SET started_at=excluded.started_at, done=0, reg=excluded.reg, answers=NULL').run(p.id, req.user.id, now, reg);
    db.prepare('UPDATE users SET student_reg=? WHERE id=?').run(reg, req.user.id);
    res.redirect(back);
  });
  app.post('/api/cbt/:id/progress', express.json({ limit: '20kb' }), (req, res) => {
    const p = req.user && getPage(req.params.id), st = p && db.prepare('SELECT * FROM cbt_starts WHERE page_id=? AND user_id=? AND done=0').get(p.id, req.user.id);
    if (!st || !isTest(p)) return res.json({ ok: true });
    db.prepare('UPDATE cbt_starts SET answers=? WHERE page_id=? AND user_id=?').run(JSON.stringify(cleanAnswers(req.body && req.body.answers, questionsOf(p).length)), p.id, req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/cbt/:id/submit', express.json({ limit: '20kb' }), (req, res, next) => {
    const p = getPage(req.params.id);
    if (!p || !p.cbt_mode) return next(); // an older test: the old handler deals with it
    if (!req.user || !isTest(p)) return res.json({ ok: true }); // practice is never recorded
    const st = db.prepare('SELECT * FROM cbt_starts WHERE page_id=? AND user_id=?').get(p.id, req.user.id);
    if (!st || st.done) return res.json({ ok: true });
    const b = req.body || {}; finish(p, st, b, ['time', 'finished', 'left'].includes(b.reason) ? b.reason : 'finished');
    setImmediate(job);
    res.json({ ok: true });
  });

  // ---------- results ----------
  const rowsFor = id => db.prepare('SELECT a.*, u.name, u.username, u.email, u.department FROM cbt_attempts a JOIN users u ON u.id=a.user_id WHERE a.page_id=? ORDER BY a.created_at DESC').all(id);
  const mm = s => s == null ? '' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const pct = r => r.total ? Math.round(100 * r.score / r.total) : '';
  app.get('/admin/pages/:id/results', (req, res) => {
    const p = req.user && getPage(req.params.id);
    if (!p || !ownsTest(req.user, p)) return res.sendStatus(403);
    const rows = rowsFor(p.id), HEAD = ['Name', 'Username', 'Reg number', 'Department', 'Questions answered', 'Score', 'Out of', 'Percent', 'Time used', 'How it ended', 'When'];
    const cells = r => [r.name, r.username ? '@' + r.username : '', r.reg || '', r.department || '', r.answered == null ? '' : r.answered, r.score == null ? '' : r.score, r.total == null ? '' : r.total, pct(r) === '' ? '' : pct(r) + '%', mm(r.seconds), r.reason, r.created_at];
    if (req.query.csv) { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="results.csv"' }); const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; return res.send('﻿' + [HEAD].concat(rows.map(cells)).map(r => r.map(q).join(',')).join('\n')); }
    res.send(layout('Results', `<p class="mut"><a href="/cbt/${p.id}/settings">&larr; Settings</a></p><h1 style="font-size:26px">${esc(p.title)}</h1><p class="mut">${isTest(p) ? 'Test' : 'Practice (not recorded)'} &middot; ${p.cbt_minutes ? p.cbt_minutes + ' minutes' : 'no time limit'}${p.cbt_close ? ' &middot; closes ' + esc(at(p.cbt_close)) : ''} &middot; ${rows.length} result${rows.length === 1 ? '' : 's'}</p>
<p><a class="btn" href="/admin/pages/${p.id}/results?csv=1">Download for Excel (CSV)</a></p>
<div style="overflow-x:auto"><table><tr>${HEAD.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${cells(r).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="11" class="mut">Nobody has taken it yet.</td></tr>'}</table></div>`, req.user));
  });

  // ---------- settings (the lecturer's, and the owner's) ----------
  app.get('/cbt/:id/settings', (req, res) => {
    const p = req.user && getPage(req.params.id);
    if (!p || !ownsTest(req.user, p)) return res.sendStatus(403);
    res.send(layout('CBT settings', `<p class="mut"><a href="${req.user.is_lecturer ? '/lecturer/cbt' : '/admin'}">&larr; Back</a></p><h1 style="font-size:26px">${esc(p.title)}</h1>${req.query.msg ? `<p class="${req.query.err ? 'err' : 'pill'}">${esc(req.query.msg)}</p>` : ''}
<p><a class="btn" href="/admin/pages/${p.id}/results">Results</a> ${questionsOf(p).length ? `<a class="btn ghost" href="/cbt/${p.id}/questions">Edit questions</a>` : ''} <a class="btn ghost" href="${req.user.is_lecturer ? '/lecturer/pages/' + p.id + '/edit' : '/admin/pages/' + p.id + '/edit'}">Edit name, department and level${questionsOf(p).length ? '' : ', file'}</a> <a class="btn ghost" href="/p/${esc(p.slug)}">Try it (not recorded)</a></p>
<p class="mut" style="font-size:13px">Changed your mind? Switch Test to Practice below and save: students can then open it again after the test is over. Recorded results stay.</p>
<form class="card" method="post" action="/cbt/${p.id}/settings">${settingsFields(p)}<button>Save settings</button></form>
<form method="post" action="/cbt/${p.id}/delete" onsubmit="return confirm('Delete this test and everything students did on it?')"><button class="ghost" style="color:#e5484d">Delete</button></form>
${isCentral(req.user) ? `<p class="mut"><a href="/admin/pages/${p.id}/edit">Name, file and price (pay to view) &rarr;</a></p>` : '<p class="mut">Pay to view is not available for CBT tests yet.</p>'}`, req.user));
  });
  const settingsFields = p => `<label class="mut">What is this?</label>
<label><input type="radio" name="mode" value="practice"${isTest(p) ? '' : ' checked'}> Practice: not recorded, answers shown straight away, repeat as often as you like</label><br>
<label><input type="radio" name="mode" value="test"${isTest(p) ? ' checked' : ''}> Test: recorded, registration number asked, one attempt, answers hidden, result emailed to students</label>
<label class="mut">Time allowed once a student starts (minutes, 0 = no limit)</label><input name="mins" type="number" min="0" max="600" step="1" value="${Number(p.cbt_minutes) || 0}">
<label class="mut">Test opens (Nigeria time, optional)</label><input name="open" type="datetime-local" value="${toInput(p.cbt_open)}">
<label class="mut">Test closes (optional). After this nobody can start, and anyone still writing is submitted automatically.</label><input name="close" type="datetime-local" value="${toInput(p.cbt_close)}">
<label><input type="checkbox" name="shuffle" value="1"${p.cbt_shuffle === 0 ? '' : ' checked'}> Shuffle the questions and the options for every student (typed tests)</label>`;
  const readSettings = b => {
    const mins = Math.max(0, Math.min(600, Math.round(Number(b.mins) || 0))), open = fromInput(b.open), close = fromInput(b.close);
    if (open && close && close <= open) return { error: 'The closing time must be after the opening time.' };
    return { mode: b.mode === 'test' ? 'test' : 'practice', mins, open, close, shuffle: b.shuffle ? 1 : 0 };
  };
  const saveSettings = (id, s) => db.prepare('UPDATE pages SET cbt_mode=?, cbt_minutes=?, cbt_once=?, cbt_open=?, cbt_close=?, cbt_shuffle=? WHERE id=?').run(s.mode, s.mins, s.mode === 'test' ? 1 : 0, s.mode === 'test' ? s.open : null, s.mode === 'test' ? s.close : null, s.shuffle, id);
  app.post('/cbt/:id/delete', (req, res) => {
    const p = req.user && getPage(req.params.id);
    if (!p || !ownsTest(req.user, p)) return res.sendStatus(403);
    try { db.prepare('DELETE FROM cbt_library WHERE page_id=?').run(p.id); } catch (e) { /* no library yet */ }
    db.prepare('DELETE FROM pages WHERE id=?').run(p.id);
    res.redirect(req.user.is_lecturer ? '/lecturer/cbt?msg=' + encodeURIComponent('Deleted.') : '/admin');
  });
  app.post('/cbt/:id/settings', (req, res) => {
    const p = req.user && getPage(req.params.id);
    if (!p || !ownsTest(req.user, p)) return res.sendStatus(403);
    const s = readSettings(req.body);
    if (s.error) return res.redirect(`/cbt/${p.id}/settings?err=1&msg=` + encodeURIComponent(s.error));
    saveSettings(p.id, s);
    res.redirect(`/cbt/${p.id}/settings?msg=` + encodeURIComponent('Saved.'));
  });

  // ---------- when a test is over: submit what is left, then email the results ----------
  let busy = false;
  async function job() {
    if (busy) return; busy = true;
    try {
      const now = Date.now();
      for (const st of db.prepare("SELECT s.*, p.id pid FROM cbt_starts s JOIN pages p ON p.id=s.page_id WHERE s.done=0 AND p.cbt_mode='test'").all()) {
        const p = getPage(st.pid), limit = Math.min(p.cbt_close || Infinity, p.cbt_minutes ? st.started_at + (p.cbt_minutes * 60 + 90) * 1000 : Infinity);
        if (now >= limit) finish(p, st, { answers: safeJson(st.answers) }, 'time');
      }
      const due = db.prepare("SELECT a.*, p.title, p.cbt_close, u.email, u.name FROM cbt_attempts a JOIN pages p ON p.id=a.page_id JOIN users u ON u.id=a.user_id WHERE a.emailed=0 AND p.cbt_mode='test' AND (p.cbt_close IS NULL OR p.cbt_close<=?) LIMIT 150").all(now);
      for (const a of due) {
        db.prepare('UPDATE cbt_attempts SET emailed=1 WHERE id=?').run(a.id); // first, so a slow mail can never send twice
        if (!a.email || !deliver) continue;
        const first = String(a.name || '').trim().split(/\s+/).filter(w => !/^(prof|dr|mr|mrs|ms|engr)\.?$/i.test(w))[0] || 'there';
        const line = a.total ? `${a.score} out of ${a.total} (${Math.round(100 * a.score / a.total)}%)` : 'Your answers were received';
        const body = `Your result for "${a.title}": ${line}.${a.answered != null ? ' Questions answered: ' + a.answered + '.' : ''} Time used: ${mm(a.seconds)}.`;
        try { await deliver(a.email, 'Your result: ' + a.title, `Dear ${first},\n\n${body}\n\nStudies Hub`, emailShell(`<h2 style="margin:0 0 14px;font-size:22px;color:#1b2430">Your test result</h2><p style="margin:0 0 12px"><b>Dear ${esc(first)},</b></p><p style="margin:0 0 6px">${esc(a.title)}</p><p style="margin:0 0 18px;font-size:22px"><b>${esc(line)}</b></p><p style="margin:0;color:#5b6677">${a.answered != null ? 'Questions answered: ' + a.answered + '<br>' : ''}Time used: ${esc(mm(a.seconds))}</p>`)); } catch (e) { console.error('Result email failed:', e.message); }
        await new Promise(r => setTimeout(r, 700));
      }
    } catch (e) { console.error('CBT job failed:', e.message); } finally { busy = false; }
  }
  setInterval(job, 60e3).unref();
  // A typed or uploaded test in "test" mode may only be fetched by a student who has entered (given the registration number) and is still writing.
  const rawAllowed = (p, req) => !isTest(p) || !req.user || ownsTest(req.user, p) || !!db.prepare('SELECT 1 FROM cbt_starts WHERE page_id=? AND user_id=? AND done=0').get(p.id, req.user.id);
  module.exports.api = { shell, render, mark, questionsOf, settingsFields, readSettings, saveSettings, ownsTest, isTest, rawAllowed };
};
