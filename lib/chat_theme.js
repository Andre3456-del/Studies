// A personal chat wallpaper. It is saved only in this person's own browser/app, so nobody else sees it or is told about it.
// One wallpaper for all chats (Settings > Chat) and an optional different one for a single chat (paint button in that chat).
// The text colour follows the picture: light text on dark pictures, dark text on light ones.
exports.css = `
#shwWall{position:fixed;inset:0;z-index:-1;background-size:cover;background-position:center;pointer-events:none}
html.has-wall{--fg:var(--wfg);--mut:var(--wmut)}
html.has-wall body{background:transparent!important}
html.has-wall .chat-head{background:var(--wbar)!important;backdrop-filter:blur(12px);padding-left:8px}
html.has-wall .chat-bar{background:var(--wbar)!important;border-top:0}
html.has-wall .bubble.them,html.has-wall .sticker-msg .bubble{background:var(--wbub)!important;color:var(--wfg)!important;border:0!important}
html.has-wall .chat-bar textarea{background:var(--wbub)!important;color:var(--wfg)}
html.has-wall .mut,html.has-wall .hello{color:var(--wmut)}
.shw-btn{margin-left:auto;background:transparent;border:0;box-shadow:none;color:var(--fg);width:42px;height:42px;min-height:42px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%}
.shw-sheet{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}
.shw-box{width:100%;max-width:520px;background:#0d1a33;color:#eaf2ff;border-radius:22px 22px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));border:1px solid rgba(120,180,255,.2)}
.shw-pick{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.shw-t{width:68px;height:96px;border-radius:14px;border:2px solid transparent;background-size:cover;background-position:center;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;padding:0;box-shadow:none;position:relative;overflow:hidden}
.shw-t.on{border-color:#38b0f8}
.shw-t.none{background:#15233f}
.shw-t input{position:absolute;inset:0;opacity:0;cursor:pointer}
.shw-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 4px 0;font-size:15px}
.shw-row .ic{font-size:20px}
.shw-sw{width:46px;height:28px;border-radius:99px;background:#33445f;position:relative;border:0;padding:0;min-height:0;box-shadow:none}
.shw-sw:after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.15s}
.shw-sw.on{background:#1d9bf0}.shw-sw.on:after{left:21px}
`;

// Runs in the page. cid is the chat key like "dm:12" or "group:5", or "" on the Settings page.
exports.js = `(function(){
var D='shw:all',W=window;
function svg(a,b,c){var s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+a+'"/><stop offset="1" stop-color="'+b+'"/></linearGradient></defs><rect width="400" height="800" fill="url(#g)"/><path d="M0 560C80 520 140 600 220 570S340 520 400 560V800H0z" fill="'+c+'" fill-opacity=".35"/><path d="M0 640C90 600 150 690 240 650S350 610 400 650V800H0z" fill="'+c+'" fill-opacity=".5"/><path d="M0 100C100 60 150 150 250 110S350 70 400 100V0H0z" fill="'+c+'" fill-opacity=".25"/></svg>';return 'data:image/svg+xml;utf8,'+encodeURIComponent(s)}
var PRE=[
{id:'wave',u:svg('#0a1730','#050a16','#2a7be0'),fg:'#f2f6ff'},
{id:'sky',u:svg('#1d5fb5','#0b2a5c','#5bc8ff'),fg:'#ffffff'},
{id:'sunset',u:svg('#7a2f6e','#1c1038','#ff8a5c'),fg:'#fff4f0'},
{id:'forest',u:svg('#0f4a3c','#06201b','#3ddc97'),fg:'#effff8'},
{id:'paper',u:svg('#f3f6fc','#dce6f5','#8db8ee'),fg:'#101827'}];
function get(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
function put(k,v){try{if(v)localStorage.setItem(k,JSON.stringify(v));else localStorage.removeItem(k);return true}catch(e){return false}}
function dark(fg){return fg==='#101827'||/^#(0|1|2|3)/.test(fg)}
function apply(w){var h=document.documentElement,el=document.getElementById('shwWall');
 if(!w){h.classList.remove('has-wall');if(el)el.remove();return}
 if(!el){el=document.createElement('div');el.id='shwWall';document.body.insertBefore(el,document.body.firstChild)}
 el.style.backgroundImage='url("'+w.u+'")';var d=dark(w.fg);
 h.style.setProperty('--wfg',w.fg);h.style.setProperty('--wmut',d?'#3b4658':'#cbd6ea');h.style.setProperty('--wbar',d?'rgba(255,255,255,.7)':'rgba(8,14,28,.55)');h.style.setProperty('--wbub',d?'rgba(255,255,255,.85)':'rgba(8,14,28,.6)');h.classList.add('has-wall')}
function mine(cid){return (cid&&get('shw:'+cid))||get(D)}
function fromFile(f,done){var r=new FileReader();r.onload=function(){var im=new Image();im.onload=function(){var s=Math.min(1,1080/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);var x=c.getContext('2d');x.drawImage(im,0,0,c.width,c.height);
 var t=document.createElement('canvas');t.width=t.height=16;var y=t.getContext('2d');y.drawImage(im,0,0,16,16);var p=y.getImageData(0,0,16,16).data,l=0;for(var i=0;i<p.length;i+=4)l+=.299*p[i]+.587*p[i+1]+.114*p[i+2];l/=256;
 done({u:c.toDataURL('image/jpeg',.72),fg:l>140?'#101827':'#ffffff'})};im.onerror=function(){done(null)};im.src=r.result};r.readAsDataURL(f)}
function picker(box,cid,onDone){
 var cur=mine(cid),own=cid&&get('shw:'+cid),all=!cid;
 var h='<div class="shw-pick"><button type="button" class="shw-t none" data-n="1" aria-label="No wallpaper">&#10005;</button>';
 PRE.forEach(function(p,i){h+='<button type="button" class="shw-t" data-i="'+i+'" aria-label="Wallpaper" style="background-image:url(\\''+p.u+'\\')"></button>'});
 h+='<label class="shw-t none" aria-label="Your own picture">&#128247;<input type="file" accept="image/*"></label></div>';
 if(cid)h+='<div class="shw-row"><span><span class="ic">&#127760;</span> Use for all my chats</span><button type="button" class="shw-sw" id="shwAll" aria-label="Use for all my chats"></button></div>';
 box.innerHTML=h;var sw=box.querySelector('#shwAll'),useAll=false;if(sw)sw.onclick=function(){useAll=!useAll;sw.className='shw-sw'+(useAll?' on':'')};
 function save(w){var ok;if(all||useAll){ok=put(D,w);if(useAll&&cid)put('shw:'+cid,null)}else ok=put('shw:'+cid,w||{none:1});if(!ok){alert('This picture is too big to keep on this device. Try a smaller one.');return}apply(mine(cid)&&mine(cid).none?null:mine(cid));if(onDone)onDone()}
 box.onclick=function(e){var b=e.target.closest&&e.target.closest('button.shw-t');if(!b)return;if(b.getAttribute('data-n'))save(null);else save(PRE[+b.getAttribute('data-i')])};
 box.querySelector('input[type=file]').onchange=function(){var f=this.files[0];if(!f)return;fromFile(f,function(w){if(!w){alert('That picture could not be opened.');return}save(w)})}}
W.SHW={apply:apply,mine:mine,picker:picker};
})()`;

// The thread page: apply it, and add the paint button to the chat header.
exports.thread = key => `<script>${exports.js};(function(){var k=${JSON.stringify(key)};function cur(){var w=SHW.mine(k);return w&&w.none?null:w}SHW.apply(cur());
var hd=document.querySelector('.chat-head');if(!hd)return;var b=document.createElement('button');b.type='button';b.className='shw-btn';b.setAttribute('aria-label','Chat theme');b.innerHTML='<svg class="ico" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.6-2-.5-1.2.3-2.5 1.7-2.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>';hd.appendChild(b);
b.onclick=function(){var s=document.createElement('div');s.className='shw-sheet';var bx=document.createElement('div');bx.className='shw-box';s.appendChild(bx);document.body.appendChild(s);s.onclick=function(e){if(e.target===s)s.remove()};SHW.picker(bx,k,function(){s.remove()})}})()</script>`;
