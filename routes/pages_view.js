// Saved pages, opening a page, and the raw page file
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { canViewPage, db, esc, inApp, layout, offBarHtml, paywallBody, pdfViewerHtml, preparePage, sortedFor, videoMimeOf } = ctx;
  function shFileName(p) {
    const ext = (/\.[A-Za-z0-9]{1,6}$/.exec(String(p.file_name || '')) || [''])[0];
    const stem = String(p.title || '').replace(/[^\w .()-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
    return stem ? stem + ext : String(p.file_name || p.slug).replace(/[^\w. -]/g, '_');
  }
  app.get('/saved', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/saved');
    // Saved offline belongs to the app only; the website never shows it.
    if (!inApp(req)) return res.redirect('/settings');
    res.send(layout('Saved offline', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Saved offline</h1>
<p class="mut">Saved materials live inside the Studies Hub app only, like downloads in a video app. You can open them with no internet, but you cannot take them out of the app. Saving runs in the background, so you can leave this page or the app.</p>
<div class="card"><label class="swrow"><span><b>Save all materials</b><br><span class="mut" id="autoInfo" style="font-size:13px"></span></span><input type="checkbox" role="switch" class="shsw" id="autoSw" aria-label="Save all materials"></label></div>
<div class="card"><label class="swrow"><span><b>Download on Wi-Fi only</b><br><span class="mut" id="wifiInfo" style="font-size:13px"></span></span><input type="checkbox" role="switch" class="shsw" id="wifiSw" aria-label="Wi-Fi only"></label><p class="mut" id="useInfo" style="margin:10px 0 0;font-size:13px"></p></div>
<div id="pick"><h3>Or choose what to save</h3><p class="mut" id="bulkInfo">Looking for materials&hellip;</p><div id="bulkList"></div></div>
<h3>On this phone</h3>
<div id="savedList"><p class="mut">Loading&hellip;</p></div>
<script>(function(){var A=window.StudiesApp,box=document.getElementById('savedList'),info=document.getElementById('bulkInfo'),bl=document.getElementById('bulkList'),sw=document.getElementById('autoSw'),ai=document.getElementById('autoInfo');
if(!A||!A.offList){box.innerHTML='<p class="mut">This is only available in the Studies Hub app.</p>';document.getElementById('pick').hidden=true;sw.disabled=true;return}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function mb(n){return (n/1048576).toFixed(1)+' MB'}
var avail=[],wsw=document.getElementById('wifiSw'),wi=document.getElementById('wifiInfo'),ui=document.getElementById('useInfo');
function wifi(){var on=false;try{on=!!A.offWifiOn()}catch(e){}wsw.checked=on;wi.textContent=on?'On. Downloads wait until you are on Wi-Fi, so your mobile data is not used.':'Off. Downloads use Wi-Fi or mobile data, whichever you have.'}
wsw.onchange=function(){A.offWifi(wsw.checked);wifi()};
function use(){var l=[];try{l=JSON.parse(A.offList())}catch(e){}var t=l.reduce(function(s,o){return s+(o.size||0)},0);ui.textContent=l.length?l.length+' saved, using about '+(t/1048576).toFixed(1)+' MB on this phone.':''}
function saved(){var l=[];try{l=JSON.parse(A.offList())}catch(e){}return l}
function drawSaved(){var l=saved();
 if(!l.length){box.innerHTML='<div class="card"><p class="mut" style="margin:0">Nothing saved yet.</p></div>';return}
 l.sort(function(a,b){return b.savedAt-a.savedAt});
 box.innerHTML=l.map(function(o){var ic=o.kind==='pdf'?'\u{1F4D5}':o.kind==='video'?'\u{1F3AC}':'\u{1F4C4}';return '<div class="card row"><div><a href="/p/'+esc(o.slug)+'">'+ic+' '+esc(o.title)+'</a><br><span class="mut">'+esc(o.course||'')+(o.course?' &middot; ':'')+mb(o.size)+'</span></div><button type="button" class="ghost" data-rm="'+esc(o.slug)+'">Remove</button></div>'}).join('')}
function label(p){var s=String(A.offStatus(p.slug));if(s==='saved')return '\u2713 Saved';if(s==='queued')return 'Waiting\u2026';if(s.indexOf('saving')===0)return (s.split(':')[1]||'0')+'%';if(s.indexOf('error')===0)return 'Try again';return 'Save'}
function drawPick(){var have={};saved().forEach(function(o){have[o.slug]=1});
 var t=avail.filter(function(p){return !have[p.slug]});
 if(!avail.length){info.textContent='No materials found for you yet.';bl.innerHTML='';return}
 if(!t.length){info.textContent='Everything available to you is already on this phone.';bl.innerHTML='';return}
 info.textContent=t.length+' not on this phone yet. Tap Save on any, or turn on Save all above.';
 bl.innerHTML=t.slice(0,80).map(function(p){var l=label(p),busy=l!=='Save'&&l!=='Try again';return '<div class="card row" style="margin-top:8px"><div>'+esc(p.title)+'<br><span class="mut">'+esc(p.course||'')+(p.course?' &middot; ':'')+mb(p.size)+'</span></div><button type="button" class="ghost" data-one="'+esc(p.slug)+'"'+(busy?' disabled':'')+'>'+l+'</button></div>'}).join('')}
function auto(){var on=false;try{on=!!A.offAutoOn()}catch(e){}sw.checked=on;ai.textContent=on?'On. Every material you can see is saved in the background, and new ones too whenever you open the app.':'Off. Turn it on to save everything, or choose below.';document.getElementById('pick').hidden=on}
sw.onchange=function(){if(sw.checked){var tot=avail.reduce(function(s,p){return s+p.size},0);if(!confirm('Save all materials to this phone (about '+mb(tot)+')? It downloads in the background'+(wsw.checked?' on Wi-Fi only.':' and uses your data or Wi-Fi.'))){sw.checked=false;return}}A.offAuto(sw.checked);auto()};
bl.onclick=function(e){var b=e.target.closest('[data-one]');if(!b)return;var p=avail.filter(function(x){return x.slug===b.getAttribute('data-one')})[0];if(p){A.offSave(p.slug,p.title,p.kind,p.course||'');drawPick()}};
box.onclick=function(e){var b=e.target.closest('[data-rm]');if(b&&confirm('Remove this from your phone?')){A.offRemove(b.getAttribute('data-rm'));drawSaved();drawPick()}};
fetch('/api/saved/available',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){avail=j.items||[];drawPick()}).catch(function(){info.textContent='Could not look for materials. Check your connection.'});
auto();wifi();use();drawSaved();setInterval(function(){drawSaved();drawPick();use()},2000)})()</script>`, req.user));
  });
  app.get('/p/:slug', async (req, res) => {
    const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
    if (!p) return res.status(404).send(layout('Not found', '<h2>Page not found</h2>', req.user));
    if (!sortedFor(p, req.user)) {
      if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
      return res.status(403).send(layout(p.title, '<div class="card"><h2>Not for your department or level</h2><p class="mut">This upload is sorted for a different department or level, so it is not available to you.</p><p><a class="btn ghost" href="/dashboard">Back to my dashboard</a></p></div>', req.user));
    }
    if (!canViewPage(p, req.user)) {
      if (p.members_only && !p.paid) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
      if (req.user) { // paid a moment ago and left before coming back? Ask Flutterwave now, so it opens straight away
        const pend = db.prepare("SELECT tx_ref FROM flw_payments WHERE user_id=? AND kind='cbt' AND item_id=? AND status='pending' AND created_at>?").get(req.user.id, p.id, Date.now() - ctx.FLW_WINDOW);
        if (pend) { await ctx.flwSettle(pend.tx_ref); if (canViewPage(p, req.user)) return res.redirect(req.path); }
      }
      return res.send(layout(p.title, paywallBody(p, req), req.user));
    }
    if (!req.query.embed && req.user && String(req.headers['sec-fetch-dest'] || '') === 'document' && ctx.isWideScreen(req)) return res.send(layout(p.title, `<iframe class="reader" src="/p/${esc(p.slug)}?embed=1" title="${esc(p.title)}" allow="fullscreen"></iframe>`, req.user));
    res.setHeader('Cache-Control', 'private, no-cache');
    if (p.kind === 'html' || p.kind === 'cbt') {
      // Uploaded pages run in a sealed box: they work normally but cannot reach this site's sign-in or act as the person viewing.
      res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
      return res.type('html').send(preparePage(p.html, req.query.embed ? null : '/'));
    }
    if (p.kind === 'video' && !p.video_id && p.file_data) {
      // Uploaded from a phone: played right here with the browser's own player (it fetches pieces as needed, so it starts quickly and can be skipped around).
      return res.send(layout(p.title, `<div class="card"><h1 style="margin-top:0">${esc(p.title)}</h1>${offBarHtml(p)}<video controls playsinline preload="metadata" style="width:100%;max-height:78vh;border-radius:12px;background:#000" src="/p/${esc(p.slug)}/raw"></video><p class="mut" style="margin:10px 0 0">If it does not start, <a href="/p/${esc(p.slug)}/raw?dl=1">download it</a> and play it on your phone.</p></div>`, req.user));
    }
    if (p.kind === 'video') {
      return res.send(layout(p.title, `<div class="card"><h1 style="margin-top:0">${esc(p.title)}</h1><div style="position:relative;padding-top:56.25%;border-radius:12px;overflow:hidden"><iframe src="https://www.youtube.com/embed/${esc(p.video_id)}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></div></div>`, req.user));
    }
    // pdf: rendered page-by-page onto <canvas> with PDF.js -- the browser's native <embed> PDF viewer does not
    // reliably work on mobile Chrome/Android, which is why this needed replacing rather than just embedding.
    // doc: converted to HTML right in the browser (Mammoth.js). Both fetch through the same authenticated route
    // everything else here uses, so department/level access control still applies either way.
    if (p.kind === 'image' && p.file_data) return res.send(layout(p.title, `<div class="card"><h1 style="margin-top:0">${esc(p.title)}</h1>${offBarHtml(p)}<img src="/p/${esc(p.slug)}/raw" alt="${esc(p.title)}" style="width:100%;height:auto;border-radius:12px;display:block"></div>`, req.user));
    const embed = p.kind === 'pdf'
      ? pdfViewerHtml(p.slug)
      : `<div id="docViewer" class="doc-viewer"><p class="mut">Loading document&hellip;</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
<script>fetch('/p/${p.slug}/raw').then(function(r){return r.arrayBuffer()}).then(function(buf){return mammoth.convertToHtml({arrayBuffer:buf})}).then(function(result){document.getElementById('docViewer').innerHTML=result.value||'<p class="mut">This document has no readable text to preview.</p>'}).catch(function(){document.getElementById('docViewer').innerHTML='<p class="mut">Could not preview this document here -- try the download link below.</p>'})</script>`;
    res.send(layout(p.title, `<div class="card"><h1 style="margin-top:0">${esc(p.title)}</h1>${offBarHtml(p)}${embed}<p style="margin-top:14px"><a class="btn ghost" href="/p/${p.slug}/raw">Download ${p.kind === 'pdf' ? 'PDF' : 'document'}</a></p></div>`, req.user));
  });

  app.get('/p/:slug/raw', (req, res) => {
    // The file itself is read separately, so a video can be sent in small pieces without loading the whole thing each time.
    const cols = db.prepare('PRAGMA table_info(pages)').all().map(c => c.name).filter(c => c !== 'file_data' && c !== 'html');
    const p = db.prepare(`SELECT ${cols.join(',')}, length(file_data) AS file_len FROM pages WHERE slug=?`).get(req.params.slug);
    if (!p || !p.file_len || !sortedFor(p, req.user)) return res.status(404).send('Not found');
    if (!canViewPage(p, req.user)) return res.status(p.members_only && !p.paid ? 401 : 402).send('Not available');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (p.kind === 'video') {
      const total = Number(p.file_len), vmime = videoMimeOf({ mimetype: p.file_mime, originalname: p.file_name }) || 'application/octet-stream';
      let start = 0, end = total - 1, partial = false;
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (m && (m[1] || m[2])) {
        if (m[1] === '') start = Math.max(0, total - Number(m[2]));
        else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
        if (start > end || start >= total) { res.status(416).setHeader('Content-Range', `bytes */${total}`); return res.end(); }
        end = Math.min(end, start + 8 * 1024 * 1024 - 1); // pieces of at most 8 MB; the player simply asks for the next one
        partial = true;
      }
      const row = db.prepare('SELECT substr(file_data, ?, ?) AS b FROM pages WHERE id=?').get(start + 1, end - start + 1, p.id);
      const buf = Buffer.from(row.b);
      res.setHeader('Content-Type', vmime);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="${shFileName(p)}"`);
      if (partial) { res.status(206); res.setHeader('Content-Range', `bytes ${start}-${start + buf.length - 1}/${total}`); }
      res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    }
    const safeMime = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|image\/(png|jpe?g|gif|webp))$/i.test(String(p.file_mime || ''));
    res.setHeader('Content-Type', safeMime ? p.file_mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${(p.kind === 'pdf' || p.kind === 'image') && safeMime && !req.query.dl ? 'inline' : 'attachment'}; filename="${shFileName(p)}"`);
    res.send(Buffer.from(db.prepare('SELECT file_data FROM pages WHERE id=?').get(p.id).file_data));
  });
};
