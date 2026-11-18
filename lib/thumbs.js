// Small preview pictures for uploads (the first page of a PDF, the picture itself, or the first words of a written page).
// The first person's phone to see a tile without one draws it and sends it up; after that everyone just sees it, with nothing to tap.
const ensure = db => db.exec('CREATE TABLE IF NOT EXISTS page_thumbs (page_id INTEGER PRIMARY KEY, img BLOB NOT NULL)');
exports.ensure = ensure;
exports.register = (app, ctx) => {
  const { canViewPage, db, sortedFor } = ctx;
  ensure(db);
  const express = require('express');
  const get = (req, res) => { const p = db.prepare('SELECT id,members_only,paid,dept,level,university,author_id,admin_id,kind FROM pages WHERE id=?').get(Number(req.params.id)); return p && sortedFor(p, req.user) && canViewPage(p, req.user) ? p : null; };
  app.get('/thumb/:id', (req, res) => {
    const p = get(req, res), r = p && db.prepare('SELECT img FROM page_thumbs WHERE page_id=?').get(p.id);
    if (!r) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(Buffer.from(r.img));
  });
  app.post('/api/thumb/:id', express.raw({ type: 'image/jpeg', limit: '160kb' }), (req, res) => {
    const p = req.user && get(req, res), b = req.body;
    if (!p || !Buffer.isBuffer(b) || b.length < 500 || b.length > 160000 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return res.status(400).end();
    db.prepare('INSERT OR IGNORE INTO page_thumbs(page_id,img) VALUES(?,?)').run(p.id, b);
    res.json({ ok: true });
  });
};
exports.js = `<script>(function(){if(window.__thv)return;window.__thv=1;
var els=[].slice.call(document.querySelectorAll('[data-th]'));if(!els.length)return;
function mk(){var c=document.createElement('canvas');c.width=480;c.height=270;return c}
function show(el,id){var i=document.createElement('img');i.className='pv-img';i.alt='';i.style.objectPosition='top';i.src='/thumb/'+id+'?t='+Date.now();if(el.parentNode)el.parentNode.replaceChild(i,el)}
function send(el,id,c){return new Promise(function(ok){c.toBlob(function(b){if(!b)return ok();fetch('/api/thumb/'+id,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:b,credentials:'same-origin'}).then(function(r){if(r.ok)show(el,id);ok()}).catch(ok)},'image/jpeg',0.8)})}
function wrap(x,t,w,max){var ws=String(t).split(/\\s+/),ln=[],cur='';ws.forEach(function(s){var n=cur?cur+' '+s:s;if(x.measureText(n).width>w&&cur){ln.push(cur);cur=s}else cur=n});if(cur)ln.push(cur);return ln.slice(0,max)}
function card(el,id){var c=mk(),x=c.getContext('2d'),g=x.createLinearGradient(0,0,480,270);g.addColorStop(0,'#16315f');g.addColorStop(1,'#0b1530');x.fillStyle=g;x.fillRect(0,0,480,270);
 x.fillStyle='#f1f5ff';x.font='bold 26px sans-serif';var t=wrap(x,el.getAttribute('data-title')||'',432,2);t.forEach(function(s,i){x.fillText(s,24,48+i*32)});
 var sn=el.getAttribute('data-snip');if(sn){x.fillStyle='rgba(241,245,255,.78)';x.font='19px sans-serif';wrap(x,sn,432,5).forEach(function(s,i){x.fillText(s,24,48+t.length*32+14+i*26)})}return send(el,id,c)}
function cover(el,id,im,w,h){var c=mk(),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,480,270);var s=Math.max(480/w,270/h);if(el.getAttribute('data-k')==='pdf')s=480/w;x.drawImage(im,0,0,w*s,h*s);return send(el,id,c)}
function pdf(el,id,slug){return new Promise(function(ok,no){if(window.pdfjsLib)return ok();var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.min.js';s.onload=ok;s.onerror=no;document.head.appendChild(s)}).then(function(){pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.worker.min.js';return fetch('/p/'+slug+'/raw',{credentials:'same-origin'})}).then(function(r){if(!r.ok)throw 0;return r.arrayBuffer()}).then(function(b){return pdfjsLib.getDocument({data:b}).promise}).then(function(d){return d.getPage(1)}).then(function(pg){var v=pg.getViewport({scale:1}),sc=480/v.width,vp=pg.getViewport({scale:sc*1.5}),c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;return pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise.then(function(){return cover(el,id,c,c.width/1.5,c.height/1.5)})})}
function img(el,id,slug){return fetch('/p/'+slug+'/raw',{credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.blob()}).then(function(b){return createImageBitmap(b)}).then(function(im){return cover(el,id,im,im.width,im.height)})}
var q=[],busy=0;function pump(){if(busy||!q.length)return;busy=1;var el=q.shift(),id=el.getAttribute('data-th'),k=el.getAttribute('data-k'),sl=el.getAttribute('data-slug');
 var p=k==='pdf'?pdf(el,id,sl):k==='image'?img(el,id,sl):card(el,id);Promise.resolve(p).catch(function(){}).then(function(){busy=0;setTimeout(pump,120)})}
var go=function(el){q.push(el);pump()};
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){io.unobserve(e.target);go(e.target)}})},{rootMargin:'200px'});els.forEach(function(e){io.observe(e)})}else els.forEach(go)})()</script>`;
