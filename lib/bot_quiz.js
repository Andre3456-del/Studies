// Study-bot output -> two ordinary pages: a summary page and a self-contained CBT practice page (same sandboxed kind the site already serves).
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STYLE = `<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:dark light}body{margin:0;padding:18px 16px 60px;font:16px/1.55 system-ui,sans-serif;background:#0b1220;color:#e8ecf6}@media(prefers-color-scheme:light){body{background:#f5f7fb;color:#13203a}.q{background:#fff!important;border-color:#d8deea!important}.o{border-color:#cfd6e6!important}}main{max-width:720px;margin:0 auto}h1{font-size:22px;line-height:1.25;margin:0 0 4px}.m{opacity:.7;font-size:14px;margin:0 0 18px}.q{border:1px solid #243049;background:#111a2e;border-radius:16px;padding:16px;margin:0 0 14px}.q p{margin:0 0 10px;font-weight:600}.o{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:1.5px solid #2c3a58;border-radius:12px;padding:11px 13px;margin:0 0 8px;cursor:pointer}.o.ok{border-color:#2fbf71;background:rgba(47,191,113,.16)}.o.no{border-color:#e5484d;background:rgba(229,72,77,.16)}.e{display:none;margin:6px 2px 0;font-size:14px;opacity:.85}.done .e{display:block}.sc{position:sticky;bottom:12px;margin-top:10px;text-align:center;padding:12px;border-radius:14px;background:#2a7fff;color:#fff;font-weight:700}li{margin:0 0 6px}</style>`;
exports.summaryHtml = d => `<!doctype html><meta charset="utf-8"><title>${esc(d.course.code)} ${esc(d.topic)}</title>${STYLE}<main><h1>${esc(d.course.code)}: ${esc(d.topic)}</h1><p class="m">${esc(d.course.title)} · ${esc(d.level)} level · written with the study bot and checked by an admin</p><ul>${d.summary.map(s => `<li>${esc(s)}</li>`).join('')}</ul></main>`;
exports.quizHtml = d => {
  const data = JSON.stringify(d.questions.map(q => ({ q: q.q, o: q.options, a: q.answer, e: q.explain }))).replace(/</g, '\\u003c').split(String.fromCharCode(8232)).join('').split(String.fromCharCode(8233)).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(d.course.code)} ${esc(d.topic)} practice</title>${STYLE}<main><h1>${esc(d.course.code)}: ${esc(d.topic)} practice</h1><p class="m">${d.questions.length} question${d.questions.length === 1 ? '' : 's'} · tap an answer to see if you are right · written with the study bot and checked by an admin</p><div id="qs"></div><div class="sc" id="sc">Score: 0 / 0</div></main><script>(function(){var D=${data},qs=document.getElementById('qs'),sc=document.getElementById('sc'),right=0,done=0;D.forEach(function(x,i){var b=document.createElement('div');b.className='q';var p=document.createElement('p');p.textContent=(i+1)+'. '+x.q;b.appendChild(p);var os=[];x.o.forEach(function(t,j){var o=document.createElement('button');o.type='button';o.className='o';o.textContent='ABCD'.charAt(j)+'. '+t;o.onclick=function(){if(b.className.indexOf('done')>-1)return;b.className+=' done';done++;os.forEach(function(z,k){if(k===x.a)z.className+=' ok'});if(j===x.a)right++;else o.className+=' no';sc.textContent='Score: '+right+' / '+done+(done===D.length?' (finished)':'')};os.push(o);b.appendChild(o)});var e=document.createElement('div');e.className='e';e.textContent=x.e;b.appendChild(e);qs.appendChild(b)});sc.textContent='Score: 0 / 0'})();</script>`;
};
// The same checks as the bot repo's tools/validate.js, run again here so nothing malformed is ever imported.
exports.check = d => {
  const e = [];
  if (!d || typeof d !== 'object') return ['not an item'];
  if (!['upload', 'draft-from-knowledge'].includes(d.source)) e.push('source must be upload or draft-from-knowledge');
  if (d.status === 'needs-better-file') return ['the bot could not read the file: ' + String(d.notes || '').slice(0, 200)];
  if (d.status !== 'ready') e.push('status must be ready');
  if (!d.course || !String(d.course.code || '').trim() || !String(d.course.title || '').trim()) e.push('course code and title are required');
  if (!Number.isInteger(d.level) || d.level < 100 || d.level > 700) e.push('level must be a number like 200');
  if (!String(d.topic || '').trim()) e.push('topic is required');
  if (!['past-question', 'lecture-note', 'test', 'other'].includes(d.kind)) e.push('kind is not one of the allowed values');
  if (!Array.isArray(d.summary) || !d.summary.length || d.summary.some(s => typeof s !== 'string')) e.push('summary needs at least 1 line');
  if (!Array.isArray(d.questions)) e.push('questions must be a list');
  else d.questions.slice(0, 200).forEach((q, i) => {
    const t = 'question ' + (i + 1) + ': ';
    if (!q || !String(q.q || '').trim()) e.push(t + 'empty question');
    if (!q || !Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options.map(String)).size !== 4) e.push(t + 'needs exactly 4 different options');
    if (!q || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) e.push(t + 'answer must be 0 to 3');
    if (!q || !String(q.explain || '').trim()) e.push(t + 'explanation is required');
  });
  if (Array.isArray(d.questions) && d.questions.length > 200) e.push('too many questions (200 at most)');
  return e;
};

// ---- one CBT and one summary page per course (all lectures together) ----
const jsonSafe = o => JSON.stringify(o).replace(/</g, '\\u003c').split(String.fromCharCode(8232)).join('').split(String.fromCharCode(8233)).join('');
exports.combinedQuiz = (c, qs) => `<!doctype html><meta charset="utf-8"><title>${esc(c.code)} CBT</title>${STYLE}<main><h1>${esc(c.code)}: CBT practice</h1><p class="m">${esc(c.title || '')}${c.level ? ' · ' + esc(c.level) + ' level' : ''} · ${qs.length} questions from all lectures, mixed in a new random order every time · tap an answer to see if you are right</p><p><button type="button" class="o" id="mix" style="width:auto;display:inline-block">&#8635; Mix again</button></p><div id="qs"></div><div class="sc" id="sc">Score: 0 / 0</div></main><script type="application/json" id="bank">${jsonSafe(qs)}</script><script>(function(){var B=JSON.parse(document.getElementById('bank').textContent),qs=document.getElementById('qs'),sc=document.getElementById('sc');
function sh(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a}
function run(){qs.innerHTML='';var right=0,done=0,D=sh(B).map(function(x){var idx=sh([0,1,2,3]);return{q:x.q,o:idx.map(function(k){return x.o[k]}),a:idx.indexOf(x.a),e:x.e}});
D.forEach(function(x,i){var b=document.createElement('div');b.className='q';var p=document.createElement('p');p.textContent=(i+1)+'. '+x.q;b.appendChild(p);var os=[];x.o.forEach(function(t,j){var o=document.createElement('button');o.type='button';o.className='o';o.textContent='ABCD'.charAt(j)+'. '+t;o.onclick=function(){if(b.className.indexOf('done')>-1)return;b.className+=' done';done++;os.forEach(function(z,k){if(k===x.a)z.className+=' ok'});if(j===x.a)right++;else o.className+=' no';sc.textContent='Score: '+right+' / '+done+(done===D.length?' (finished)':'')};os.push(o);b.appendChild(o)});var e=document.createElement('div');e.className='e';e.textContent=x.e;b.appendChild(e);qs.appendChild(b)});sc.textContent='Score: 0 / 0';window.scrollTo(0,0)}
document.getElementById('mix').onclick=run;run()})();</script>`;
exports.combinedSummary = (c, secs) => `<!doctype html><meta charset="utf-8"><title>${esc(c.code)} summaries</title>${STYLE}<main><h1>${esc(c.code)}: summaries</h1><p class="m">${esc(c.title || '')}${c.level ? ' · ' + esc(c.level) + ' level' : ''} · all lectures together</p>${secs.map(s => `<h2 style="font-size:18px;margin:22px 0 8px">${esc(s.topic)}</h2><ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}</main><script type="application/json" id="bank">${jsonSafe(secs)}</script>`;
exports.readBank = html => { const m = /<script type="application\/json" id="bank">([\s\S]*?)<\/script>/.exec(html || ''); if (!m) return null; try { return JSON.parse(m[1]); } catch (e) { return null; } };
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// Reads the older one-lecture pages this bot made before, so they can be folded into the course pages.
exports.readOld = html => {
  const h = /<h1>([^<]*?):\s([^<]*?)(?: practice)?<\/h1>/.exec(html || ''); if (!h) return null;
  const code = unesc(h[1]), topic = unesc(h[2]), lv = /(\d{3}) level/.exec(html), ti = /<p class="m">([^<]*?) ·/.exec(html);
  const out = { code, topic, title: ti ? unesc(ti[1]) : '', level: lv ? Number(lv[1]) : null };
  const d = /var D=(\[[\s\S]*?\]),qs=document/.exec(html);
  if (d) { try { out.qs = JSON.parse(d[1]).map(x => ({ q: x.q, o: x.o, a: x.a, e: x.e })); } catch (e) { return null; } return out; }
  const li = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => unesc(m[1])); if (!li.length) return null; out.lines = li; return out;
};
