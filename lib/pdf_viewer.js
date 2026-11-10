'use strict';
// PDF viewer for Studies Hub: crisp pages (drawn at the screen's real sharpness), tap any page to open it big
// in a full-screen reader (pinch or double-tap to zoom, swipe or arrows for next/previous page).
// Uses PDF.js from cdnjs, same as before; the file still comes through /p/:slug/raw so access rules still apply.
const TEMPLATE = String.raw`<div id="pdfViewer" class="pdfv"><p class="mut">Loading PDF&hellip;</p></div>
<div id="pdfLb" class="pdflb" hidden>
 <div class="pdflb-bar"><button type="button" id="lbClose" aria-label="Close">&#10005;</button><span id="lbCount"></span><span class="pdflb-sp"></span><button type="button" id="lbMinus" aria-label="Zoom out">&minus;</button><button type="button" id="lbFit" aria-label="Fit to screen">Fit</button><button type="button" id="lbPlus" aria-label="Zoom in">+</button></div>
 <div id="lbScroll" class="pdflb-scroll"><canvas id="lbCanvas"></canvas></div>
 <button type="button" id="lbPrev" class="pdflb-nav" style="left:8px" aria-label="Previous page">&lsaquo;</button><button type="button" id="lbNext" class="pdflb-nav" style="right:8px" aria-label="Next page">&rsaquo;</button>
</div>
<style>
.pdfv .hint{margin:0 0 10px;font-size:14px;color:var(--mut)}
.pdfv .pgw{position:relative;margin:0 0 14px;cursor:zoom-in;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent}
.pdfv .pgw canvas{display:block;width:100%;height:auto}
.pdfv .pgw .pn{position:absolute;left:8px;bottom:8px;background:rgba(15,20,40,.78);color:#fff;font:600 12px system-ui,sans-serif;padding:3px 9px;border-radius:99px}
.pdflb{position:fixed;inset:0;z-index:2147483000;background:#0b0d14;display:flex;flex-direction:column}
.pdflb[hidden]{display:none}
.pdflb-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;padding-top:calc(8px + env(safe-area-inset-top,0px));background:#12121c;border-bottom:1px solid rgba(255,255,255,.12);color:#fff;font:600 15px system-ui,sans-serif}
.pdflb-bar button{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:10px;min-width:44px;height:44px;font-size:20px;cursor:pointer;padding:0 12px;box-shadow:none}
.pdflb-sp{flex:1}
.pdflb-scroll{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;text-align:center;overscroll-behavior:contain}
.pdflb-scroll canvas{display:block;margin:0 auto;background:#fff}
.pdflb-nav{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:64px;border:0;border-radius:12px;background:rgba(18,18,28,.72);color:#fff;font-size:34px;line-height:1;cursor:pointer;padding:0;box-shadow:none}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.min.js"></script>
<script>(function(){
var box=document.getElementById('pdfViewer'),lb=document.getElementById('pdfLb'),sc=document.getElementById('lbScroll'),cv=document.getElementById('lbCanvas'),cnt=document.getElementById('lbCount');
var doc=null,total=0,cur=1,zoom=1,tok=0,dpr=Math.min(window.devicePixelRatio||1,3),open=false,tmr=null;
function fail(){box.innerHTML='<p class="mut">Could not preview this PDF here -- try the download link below.</p>'}
function fitCanvas(page,cssW,canvas){var base=page.getViewport({scale:1}),scale=cssW/base.width*dpr;var maxPx=16e6,px=base.width*scale*base.height*scale;if(px>maxPx)scale*=Math.sqrt(maxPx/px);var vp=page.getViewport({scale:scale});canvas.width=Math.floor(vp.width);canvas.height=Math.floor(vp.height);canvas.style.width=cssW+'px';canvas.style.height=(cssW*base.height/base.width)+'px';return vp}
// ---- the pages in the list (drawn only as they come into view) ----
function build(){
  box.innerHTML='<p class="hint">Tap a page to open it bigger.</p>';
  var obs='IntersectionObserver' in window?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){obs.unobserve(e.target);drawThumb(e.target)}})},{rootMargin:'700px 0px'}):null;
  for(var n=1;n<=total;n++){var w=document.createElement('div');w.className='pgw';w.setAttribute('data-n',n);w.style.minHeight='260px';w.innerHTML='<span class="pn">Page '+n+' of '+total+'</span>';w.addEventListener('click',function(){openLb(Number(this.getAttribute('data-n')))});box.appendChild(w);if(obs)obs.observe(w);else drawThumb(w)}
}
function drawThumb(w){var n=Number(w.getAttribute('data-n'));doc.getPage(n).then(function(page){var c=document.createElement('canvas');var cssW=Math.max(200,w.clientWidth||box.clientWidth||320);fitCanvas(page,cssW,c);c.style.width='100%';c.style.height='auto';w.style.minHeight='';w.insertBefore(c,w.firstChild);return page.render({canvasContext:c.getContext('2d'),viewport:page.getViewport({scale:c.width/page.getViewport({scale:1}).width})}).promise}).catch(function(){})}
// ---- the big reader ----
function renderLb(keepCenter){var my=++tok,cx=0.5,cy=0.5;if(keepCenter&&sc.scrollWidth>sc.clientWidth){cx=(sc.scrollLeft+sc.clientWidth/2)/sc.scrollWidth}if(keepCenter&&sc.scrollHeight>sc.clientHeight){cy=(sc.scrollTop+sc.clientHeight/2)/sc.scrollHeight}
  cnt.textContent=cur+' / '+total;
  doc.getPage(cur).then(function(page){if(my!==tok)return;var fitW=sc.clientWidth||window.innerWidth,cssW=fitW*zoom;
    var tmp=document.createElement('canvas');var vp=fitCanvas(page,cssW,tmp);return page.render({canvasContext:tmp.getContext('2d'),viewport:vp}).promise.then(function(){if(my!==tok)return;cv.width=tmp.width;cv.height=tmp.height;cv.style.width=tmp.style.width;cv.style.height=tmp.style.height;cv.getContext('2d').drawImage(tmp,0,0);
      if(keepCenter){sc.scrollLeft=cx*sc.scrollWidth-sc.clientWidth/2;sc.scrollTop=cy*sc.scrollHeight-sc.clientHeight/2}else{sc.scrollLeft=0;sc.scrollTop=0}})}).catch(function(){})}
function setZoom(z,keep){zoom=Math.max(1,Math.min(5,z));renderLb(keep!==false)}
function openLb(n){cur=n;zoom=1;lb.hidden=false;open=true;document.documentElement.style.overflow='hidden';try{history.pushState({pdflb:1},'')}catch(e){}renderLb(false)}
function closeLb(fromPop){if(!open)return;open=false;lb.hidden=true;document.documentElement.style.overflow='';tok++;if(fromPop!==true){try{if(history.state&&history.state.pdflb)history.back()}catch(e){}}}
function go(d){var n=cur+d;if(n<1||n>total)return;cur=n;zoom=1;renderLb(false)}
document.getElementById('lbClose').onclick=function(){closeLb()};
document.getElementById('lbPlus').onclick=function(){setZoom(zoom*1.5)};
document.getElementById('lbMinus').onclick=function(){setZoom(zoom/1.5)};
document.getElementById('lbFit').onclick=function(){setZoom(1,false)};
document.getElementById('lbPrev').onclick=function(){go(-1)};
document.getElementById('lbNext').onclick=function(){go(1)};
window.addEventListener('popstate',function(){if(open)closeLb(true)});
document.addEventListener('keydown',function(e){if(!open)return;if(e.key==='Escape')closeLb();else if(e.key==='ArrowRight')go(1);else if(e.key==='ArrowLeft')go(-1);else if(e.key==='+'||e.key==='=')setZoom(zoom*1.5);else if(e.key==='-')setZoom(zoom/1.5)});
// double-tap: zoom in / back to fit
var lastTap=0;cv.addEventListener('click',function(e){var now=Date.now();if(now-lastTap<320){if(zoom>1)setZoom(1,false);else{var r=cv.getBoundingClientRect(),fx=(e.clientX-r.left)/r.width,fy=(e.clientY-r.top)/r.height;zoom=2.5;renderLb(false);setTimeout(function(){sc.scrollLeft=fx*sc.scrollWidth-sc.clientWidth/2;sc.scrollTop=fy*sc.scrollHeight-sc.clientHeight/2},60)}lastTap=0}else lastTap=now});
// pinch to zoom; swipe sideways (when not zoomed) for next / previous page
var d0=0,z0=1,sx=0,sy=0,sw=false;
function dist(t){var a=t[0],b=t[1];return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)}
sc.addEventListener('touchstart',function(e){if(e.touches.length===2){d0=dist(e.touches);z0=zoom;sw=false}else if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY;sw=zoom===1}},{passive:true});
sc.addEventListener('touchmove',function(e){if(e.touches.length===2&&d0){var z=Math.max(1,Math.min(5,z0*dist(e.touches)/d0));cv.style.width=((sc.clientWidth||320)*z)+'px';cv.style.height='auto';zoom=z;clearTimeout(tmr);tmr=setTimeout(function(){renderLb(true)},220)}},{passive:true});
sc.addEventListener('touchend',function(e){if(d0&&e.touches.length<2){d0=0;return}if(sw&&e.changedTouches.length===1){var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.6)go(dx<0?1:-1)}},{passive:true});
window.addEventListener('resize',function(){if(open)renderLb(true)});
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.worker.min.js';
fetch('/p/__SLUG__/raw').then(function(r){return r.arrayBuffer()}).then(function(buf){return pdfjsLib.getDocument({data:buf}).promise}).then(function(d){doc=d;total=d.numPages;build()}).catch(fail);
})()</script>`;
module.exports = { pdfViewerHtml: slug => TEMPLATE.replace('__SLUG__', String(slug).replace(/[^A-Za-z0-9_-]/g, '')) };
