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
.pwwrap>input{padding-right:46px!important;width:100%;display:block;margin:0!important}
.pweye{margin:0!important;position:absolute;right:4px;top:50%;transform:translateY(-50%);width:38px;height:38px;min-height:0;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;color:var(--mut);display:flex;align-items:center;justify-content:center;cursor:pointer}
.pweye .ico{width:22px;height:22px}
.pweye.on{color:var(--blue)}
/* Chat list: friend circles, time on the right, green unread badge, round new-group button */
.stories{display:flex;gap:14px;padding:6px 2px 12px;overflow-x:auto;scrollbar-width:none}
.stories::-webkit-scrollbar{display:none}
.st{display:flex;flex-direction:column;align-items:center;gap:5px;flex:none;position:relative;color:var(--mut);text-decoration:none;width:62px}
.st:hover{text-decoration:none}
.st .ring{position:relative;padding:3px;border-radius:50%;background:conic-gradient(var(--blue),#8b7bff,var(--blue));display:block}
.st .ring.seen{background:rgba(150,170,205,.45)}
.st .ring.none{background:transparent;padding:3px}
.st .ring .avatar,.st .ring img{width:54px;height:54px;border:2px solid var(--bg);border-radius:50%;object-fit:cover;display:flex;font-size:20px}
.st-on{position:absolute;right:2px;bottom:2px;width:13px;height:13px;border-radius:50%;background:#25d366;border:2px solid var(--bg)}
.st-plus{position:absolute;right:4px;top:40px;width:20px;height:20px;border-radius:50%;background:var(--blue);color:#fff;font-weight:700;font-size:15px;line-height:19px;text-align:center;border:2px solid var(--bg)}
.st-n{font-size:12px;max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-pick{display:flex;align-items:center;gap:10px;padding:12px;border:1px dashed var(--line);border-radius:14px;cursor:pointer;font-size:18px}
.chat-tools{display:flex;justify-content:flex-end;gap:6px;margin:-4px 0 4px}
.ct{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:transparent;border:0;color:var(--fg);padding:0;box-shadow:none}
.ct:hover{background:rgba(120,170,255,.14);text-decoration:none}
.chat-search.hide{display:none}
.ci-end{flex-direction:column;align-items:flex-end;gap:5px}
.ci-time{font-size:12px;color:var(--mut)}.ci-time.un{color:#25d366}
.ci-row{display:flex;align-items:center;gap:6px;min-height:20px}
.chat-item .nbadge{background:#25d366;color:#04210f;border:0}
.chat-item .nbadge.nb-muted{background:#5d6b86;color:#fff}
.fab{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:30;width:56px;height:56px;border-radius:18px;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(0,0,0,.4)}
.fab:hover{text-decoration:none;filter:brightness(1.08)}
.fab .ico,.fab svg{width:26px;height:26px;stroke:#fff}
@media (min-width:1024px){.fab{bottom:28px}}

/* News posts: icon row (comment, like, share, save) */
.news-post{border-bottom:1px solid var(--line)}
.news-post .news-card{border-bottom:0}
.acts{display:flex;justify-content:space-between;padding:2px 14px 12px 4px;max-width:420px}
.act{display:flex;align-items:center;gap:6px;background:transparent;border:0;box-shadow:none;color:var(--mut);padding:6px 8px;min-height:0;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;border-radius:99px}
.act:hover{background:rgba(120,170,255,.12);text-decoration:none;color:var(--fg)}
.act .ic{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.act.on{color:var(--blue)}
.act[data-a="like"].on{color:#f91880}.act[data-a="like"].on .ic{fill:#f91880}
.act[data-a="save"].on .ic{fill:currentColor}
/* Comments */
.cm{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.cm-b{flex:1;min-width:0}.cm-b p{margin:2px 0 0;overflow-wrap:anywhere}
.cm-x{background:transparent;border:0;box-shadow:none;color:var(--mut);font-size:20px;padding:2px 8px;min-height:0}
.cm-form{display:flex;gap:8px;margin-top:14px;position:sticky;bottom:calc(76px + env(safe-area-inset-bottom,0px))}
.cm-form input{flex:1;border-radius:22px}
.cm-form button{width:44px;height:44px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center}
.cm-form .ic{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2}
.ct .ic,.fab .ic,.act .ic{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}

/* Library cards: picture first, kind badge, lock badge, author round photo + title + details */
.pv-th{position:relative;display:block}
.pv-th .pv-img{width:100%;aspect-ratio:16/9;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:44px}
.pv-badge{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.72);color:#fff;border-radius:6px;font-size:11px;font-weight:700;padding:2px 7px}
.pv-lock{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.65);color:#fff;border-radius:99px;font-size:11px;font-weight:700;padding:3px 9px}
.pv-body{display:flex;gap:10px;align-items:flex-start}
.pv-av{width:36px;height:36px;font-size:14px;flex:none}
.pv-tx{min-width:0}.pv-tx h3{margin:0 0 2px;font-size:15px;line-height:1.3}.pv-tx .mut{font-size:12.5px}
html[data-pv="list"] .pv-th{display:contents}
html[data-pv="list"] .pv-badge,html[data-pv="list"] .pv-lock,html[data-pv="list"] .pv-av{display:none}
html[data-pv="list"] .pv-th .pv-img{width:64px}
.lib-chips{overflow-x:auto;flex-wrap:nowrap;margin:4px 0 6px;scrollbar-width:none}.lib-chips::-webkit-scrollbar{display:none}

/* Profile (dashboard top): wave cover, big round photo, three numbers, icon tiles */
.dash-hero{padding:0!important}
.cover{height:120px;border-radius:18px;background:linear-gradient(160deg,#1d5fb5,#0b2a5c);position:relative;overflow:hidden}
.cover:after{content:"";position:absolute;left:0;right:0;bottom:0;height:60px;background:var(--W3) repeat-x;background-size:50% 100%;animation:shwFlow 18s linear infinite;width:200%}
.prof{display:flex;align-items:flex-end;gap:14px;margin:-38px 8px 0;position:relative}
.prof-av{width:80px!important;height:80px!important;border-radius:50%;border:4px solid var(--bg);object-fit:cover;font-size:30px;flex:none;display:flex;align-items:center;justify-content:center}
.prof-tx{padding-bottom:6px;min-width:0}.prof-tx h1{margin:0;font-size:22px}.prof-tx p{margin:0;font-size:13px}
.prof-pills{margin:12px 4px 0;display:flex;gap:6px;flex-wrap:wrap}
.stats{display:flex;margin:14px 0;border:1px solid var(--line);border-radius:16px;background:var(--panel)}
.stats a{flex:1;text-align:center;padding:10px 4px;color:var(--fg);text-decoration:none}
.stats b{display:block;font-size:20px}.stats span{font-size:12px;color:var(--mut)}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tile{border-radius:16px;background:var(--panel);border:1px solid var(--line);padding:12px;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:var(--fg);text-decoration:none}
.tile:hover{text-decoration:none;background:rgba(58,160,240,.16)}
.tile .ci{width:38px;height:38px;border-radius:12px;background:rgba(58,160,240,.2);color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none}
.tile .ic{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.prof{align-items:flex-start}.prof-tx{padding:44px 0 0}
.tiles .tile{flex-direction:row;justify-content:flex-start;text-align:left}
.ct .ic,.tile .ic{width:22px;height:22px}
.vtoggle{display:flex;gap:6px;justify-content:flex-end;margin:0 0 6px}
.vtoggle button{width:40px;height:36px;min-height:0;padding:0;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none}
`;

// Puts an eye button on every password box, so people can see what they typed and fix mistakes.
exports.js = `<script>(function(){
var OPEN='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var SHUT='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function add(i){if(i.__eye||i.type!=='password')return;i.__eye=1;var w=document.createElement('span');w.className='pwwrap';var cs=getComputedStyle(i);w.style.display=cs.display==='block'||i.offsetWidth>=(i.parentNode.clientWidth||0)*.9?'block':'inline-block';
 w.style.margin=cs.margin;w.style.flex=cs.flex;i.style.margin='0';i.parentNode.insertBefore(w,i);w.appendChild(i);var b=document.createElement('button');b.type='button';b.className='pweye';b.tabIndex=-1;b.setAttribute('aria-label','Show password');b.innerHTML=OPEN;w.appendChild(b);
 b.addEventListener('mousedown',function(e){e.preventDefault()});
 b.addEventListener('click',function(){var show=i.type==='password';i.type=show?'text':'password';b.innerHTML=show?SHUT:OPEN;b.className='pweye'+(show?' on':'');b.setAttribute('aria-label',show?'Hide password':'Show password');i.focus()})}
function scan(){Array.prototype.forEach.call(document.querySelectorAll('input[type=password]'),add)}
scan();try{new MutationObserver(scan).observe(document.body,{childList:true,subtree:true})}catch(e){}
})()</script>
`;
