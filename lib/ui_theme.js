// The look of the whole site, in one place: true black, thin lines, round pictures, big images, icons first, little text.
// It is added after the normal styles, so it only changes colours, spacing and shapes (nothing else is touched).
exports.css = require('./chat_theme').css + `
/* ===== New look: black, flat, picture-first ===== */
:root{--bg:#0a1530;--panel:rgba(26,52,104,.34);--line:rgba(130,185,255,.18);--fg:#f2f6ff;--mut:#9aa9c7;--blue:#3aa0f0;--blue2:#2488dc;--bar:rgba(8,16,36,.88);--W1:url("data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20800%20200%22%20preserveAspectRatio=%22none%22%3E%3Cpath%20d=%22M0%2090Q100%2030%20200%2090T400%2090T600%2090T800%2090V200H0Z%22%20fill=%22%232f86e8%22%20fill-opacity=%220.2%22/%3E%3C/svg%3E");--W2:url("data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20800%20200%22%20preserveAspectRatio=%22none%22%3E%3Cpath%20d=%22M0%20110Q100%2060%20200%20110T400%20110T600%20110T800%20110V200H0Z%22%20fill=%22%232f86e8%22%20fill-opacity=%220.32%22/%3E%3C/svg%3E");--W3:url("data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20800%20200%22%20preserveAspectRatio=%22none%22%3E%3Cpath%20d=%22M0%20130Q100%2086%20200%20130T400%20130T600%20130T800%20130V200H0Z%22%20fill=%22%233aa0f0%22%20fill-opacity=%220.3%22/%3E%3C/svg%3E");--bg2:#050c1c}
:root[data-theme="light"]{--bg:#f3f7fd;--panel:rgba(56,130,220,.08);--line:rgba(15,40,90,.14);--fg:#0f1a2e;--mut:#55647f;--blue:#1d82e6;--blue2:#1a72cc;--bar:rgba(255,255,255,.9);--W1:url("data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20800%20200%22%20preserveAspectRatio=%22none%22%3E%3Cpath%20d=%22M0%2090Q100%2030%20200%2090T400%2090T600%2090T800%2090V200H0Z%22%20fill=%22%237db2ee%22%20fill-opacity=%220.3%22/%3E%3C/svg%3E");--W2:url("data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20800%20200%22%20preserveAspectRatio=%22none%22%3E%3Cpath%20d=%22M0%20110Q100%2060%20200%20110T400%20110T600%20110T800%20110V200H0Z%22%20fill=%22%236aa6ea%22%20fill-opacity=%220.32%22/%3E%3C/svg%3E");--W3:url("data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20800%20200%22%20preserveAspectRatio=%22none%22%3E%3Cpath%20d=%22M0%20130Q100%2086%20200%20130T400%20130T600%20130T800%20130V200H0Z%22%20fill=%22%234f93e2%22%20fill-opacity=%220.3%22/%3E%3C/svg%3E");--bg2:#e1ecfb}
html{background:linear-gradient(180deg,var(--bg),var(--bg2)) fixed}
body{background:transparent}
.top{background:var(--bar)!important;border-bottom:1px solid var(--line)!important;backdrop-filter:blur(14px)}

.brand{font-weight:800;letter-spacing:-.2px}
/* Helper sentences under titles: gone (things label themselves). */
.hint,main>p.mut:not(:only-child):not(:has(a)),.pushbar span+span{display:none!important}
/* Cards: flat rows with thin lines, like X / Threads */
.card{background:transparent!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;padding:14px 4px!important;margin:0!important}
.news-card{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;margin:0;padding:14px 0}
.news-img{border-radius:16px;aspect-ratio:16/9;border:1px solid var(--line)}
.news-meta{font-size:13px}
/* Chat list: WhatsApp / Telegram rows, big round pictures */
.chat-item{border-radius:0;padding:10px 12px;border-bottom:1px solid var(--line)}
.chat-item:hover{background:rgba(255,255,255,.05)}
.chat-item .av .avatar,.chat-item .av img{width:54px;height:54px}
.chat-item .meta b{font-size:16px}
.chat-item .meta span{font-size:14px}
.chat-item .av .dot{width:13px;height:13px;border-color:var(--bg)}
/* Pills: like YouTube chips */
.chip-row{gap:8px}.chip{box-shadow:none;background:rgba(120,170,255,.14);border:0;color:var(--fg);padding:7px 14px}
.chip.on{background:var(--blue);color:#fff}
:root[data-theme="light"] .chip{background:rgba(15,25,40,.07)}
:root[data-theme="light"] .chip.on{background:#0f1419;color:#fff}
/* Buttons: round, one accent colour */
button,.btn{border-radius:999px;font-weight:700}
.chip,.chip.on{box-shadow:none!important}
/* Bottom bar: solid black, filled look when selected, small dot badge, no outline */
body.has-tabbar .tabbar{background:var(--bar);border-top:1px solid var(--line);backdrop-filter:none}
.tabbar a,.tabbar button{color:var(--mut);border-radius:0}
.tabbar a.on{color:var(--fg)}.tabbar a.on .ico{stroke-width:2.6;fill:currentColor;fill-opacity:.18}
.tabbar .nbadge{background:#f4212e;color:#fff;border:2px solid var(--bg);min-width:18px;height:18px;line-height:14px}
/* Full-screen phone menu: icon tiles instead of long boxes */
@media (max-width:1023px){
 .drawer{background:var(--bar)}
 .drawer-top{background:var(--bar)}
 .drawer-user{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;margin:0;padding:16px}
 .drawer-item{background:transparent;border-radius:12px;margin:0 8px;padding:14px 12px;font-size:19px;font-weight:700}
 .drawer-item.active{background:transparent;color:var(--fg)}
 .drawer-item .ico{width:26px;height:26px}
}
@media (min-width:1024px){.drawer{background:var(--bar);border-right:1px solid var(--line)}.drawer-item{font-weight:600}.drawer-item.active{background:transparent;font-weight:800}}
/* Pictures first: round avatars everywhere, no glow */
.avatar{box-shadow:none}
/* Chat bubbles: WhatsApp / Telegram colours */
:root:not([data-theme="light"]) .bubble.me{background:#005c4b;color:#fff}
/* Inputs: dark pill fields */
input:not([type=checkbox]):not([type=radio]),textarea,select{background:rgba(10,24,52,.7);border-color:var(--line)}
:root[data-theme="light"] input:not([type=checkbox]):not([type=radio]),:root[data-theme="light"] textarea,:root[data-theme="light"] select{background:#fff}
/* Page title is already in the top bar: no second big title */
main>h1:first-of-type{display:none}
@media (min-width:1024px){main>h1:first-of-type{display:block}}
/* Settings: round icon + one word, like Telegram */
.card.row .sub{display:none}
.sico{flex:none;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:20px}
.card.row b{font-size:17px;font-weight:600}
/* Profile header (dashboard): compact like a Threads profile */
.dash-hero{background:transparent!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;box-shadow:none!important;padding:8px 0 18px!important}
.dash-hero:before,.dash-hero:after{display:none!important}
.dash-top .avatar,.dash-top .drawer-av-img{width:64px!important;height:64px!important}
.dash-top h1{font-size:22px}
/* News: "What's happening?" composer row like X */
.composer{padding:10px 4px!important}
.composer summary{list-style:none;display:flex;align-items:center;gap:12px;cursor:pointer}
.composer summary::-webkit-details-marker{display:none}
.composer .avatar,.composer .drawer-av-img{width:42px;height:42px;font-size:16px;border-radius:50%;object-fit:cover;flex:none}
.cpill{flex:1;color:var(--mut);font-size:18px}
.cgo{width:38px;height:38px;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px}
/* Study materials: YouTube cards, big picture on top, title under it, no frames */
.box{border:0!important;background:transparent!important;padding:0!important;margin:10px 0!important}
.box>h2{font-size:19px;margin:.9em 0 .5em}
.pv{background:transparent;border:0;border-radius:0}
.pv:hover{transform:none}
.pv-img{border-radius:14px}
.pv-body{padding:10px 2px}
.pv-body h3{font-size:16px;font-weight:700}
@media (max-width:600px){html:not([data-pv="list"]) .pv-grid{grid-template-columns:1fr;gap:20px}}
/* News posts: who + when on top, then headline, text (3 lines), then the picture */
.news-card{gap:0}
.news-body{display:flex;flex-direction:column}
.news-meta{order:-1;margin-bottom:4px;font-size:14px;color:var(--mut)}
.news-meta span:first-child{color:var(--fg);font-weight:700}
.news-body h3{margin:0 0 4px;font-size:18px}
.news-snip{margin:0 0 10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.news-card .news-img{order:2;margin-top:0}
.news-card .news-img:not([src]){display:none}
/* Chat box: one round pill, plain icons, round send button (WhatsApp / Telegram) */
.chat-bar{background:var(--bar);border-top:1px solid var(--line);align-items:flex-end}
.chat-bar .ic{background:transparent!important;border:0!important;box-shadow:none!important;min-width:38px}
.chat-bar textarea,.chat-bar input{border-radius:22px;background:rgba(40,70,130,.35);border:0}
.chat-bar .sendb{width:46px;height:46px;min-width:46px;padding:0;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:none}
.chat-bar .sendb .ico{width:22px;height:22px;stroke:#fff}
.chat-bar>button:not(.ic):not(.sendb){padding:10px 14px}
.adbar{margin:0 0 14px}
.adbar a{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 14px;border-radius:14px;background:rgba(56,176,248,.14);border:1px solid rgba(91,200,255,.35);color:#5bc8ff;font-weight:700}
.adbar a:hover{text-decoration:none;background:rgba(56,176,248,.22)}
/* Bottom bar: icon + small word, easy to find your way (WhatsApp / Telegram) */
body.has-tabbar .tabbar a,body.has-tabbar .tabbar button{flex-direction:column;gap:2px;height:52px}
body.has-tabbar .tabbar a:after,body.has-tabbar .tabbar button:after{content:attr(aria-label);font-size:11px;font-weight:600;line-height:1}
body.has-tabbar .tabbar .ico{width:25px;height:25px}
body.has-tabbar .tabbar a.on{color:var(--blue)}
body.has-tabbar{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))}
/* Flowing water: three wave layers drift sideways all the time, each at its own speed */
html::before,body::before,body::after{content:"";position:fixed;left:0;bottom:0;width:200%;z-index:-1;pointer-events:none;background-repeat:repeat-x;background-size:50% 100%;will-change:transform}
html::before{height:34vh;background-image:var(--W1);animation:shwFlow 46s linear infinite}
body::before{height:26vh;background-image:var(--W2);animation:shwFlow 31s linear infinite reverse}
body::after{height:18vh;background-image:var(--W3);animation:shwFlow 21s linear infinite}
@keyframes shwFlow{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}
@media (prefers-reduced-motion:reduce){html::before,body::before,body::after{animation:none}}
html.has-wall::before,html.has-wall body::before,html.has-wall body::after{display:none}
/* Eye button on every password box */
.pwwrap{position:relative;max-width:100%}
.pwwrap>input{padding-right:46px!important;width:100%}
.pweye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:38px;height:38px;min-height:0;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;color:var(--mut);display:flex;align-items:center;justify-content:center;cursor:pointer}
.pweye .ico{width:22px;height:22px}
.pweye.on{color:var(--blue)}
`;

// Puts an eye button on every password box, so people can see what they typed and fix mistakes.
exports.js = `<script>(function(){
var OPEN='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var SHUT='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function add(i){if(i.__eye||i.type!=='password')return;i.__eye=1;var w=document.createElement('span');w.className='pwwrap';var cs=getComputedStyle(i);w.style.display=cs.display==='block'||i.offsetWidth>=(i.parentNode.clientWidth||0)*.9?'block':'inline-block';
 i.parentNode.insertBefore(w,i);w.appendChild(i);var b=document.createElement('button');b.type='button';b.className='pweye';b.tabIndex=-1;b.setAttribute('aria-label','Show password');b.innerHTML=OPEN;w.appendChild(b);
 b.addEventListener('mousedown',function(e){e.preventDefault()});
 b.addEventListener('click',function(){var show=i.type==='password';i.type=show?'text':'password';b.innerHTML=show?SHUT:OPEN;b.className='pweye'+(show?' on':'');b.setAttribute('aria-label',show?'Hide password':'Show password');i.focus()})}
function scan(){Array.prototype.forEach.call(document.querySelectorAll('input[type=password]'),add)}
scan();try{new MutationObserver(scan).observe(document.body,{childList:true,subtree:true})}catch(e){}
})()</script>`;
