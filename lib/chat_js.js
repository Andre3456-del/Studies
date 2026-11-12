// The browser script that runs a chat page
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { fmtBytes, linkTokens } = ctx;
  const CHAT_JS = `(function(){
var myId=__MY__,convType='__CTYPE__',convId=__CID__;
var qs=convType==='group'?('group='+convId):('to='+convId);
var thread=document.getElementById('thread'),form=document.getElementById('sendForm'),input=document.getElementById('msgInput');
function resizeInput(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px'}
input.addEventListener('input',resizeInput);
var panel=document.getElementById('panel'),pBtn=document.getElementById('panelBtn'),micBtn=document.getElementById('micBtn');
var recBar=document.getElementById('recBar'),recTime=document.getElementById('recTime'),recSend=document.getElementById('recSend'),recCancel=document.getElementById('recCancel');
var pEmoji=document.getElementById('pEmoji'),pStickers=document.getElementById('pStickers'),ec=document.getElementById('ecats'),eg=document.getElementById('egrid'),sg=document.getElementById('sgrid'),stFile=document.getElementById('stFile'),stZip=document.getElementById('stZip'),upStatus=document.getElementById('upStatus');
var editingId=null,replyTarget=null,replyBar=document.getElementById('replyBar'),replyWho=document.getElementById('replyWho'),replyWhat=document.getElementById('replyWhat'),replyCancel=document.getElementById('replyCancel'),lastId=parseInt(thread.getAttribute('data-last-id'),10)||0,seen={};
Array.prototype.forEach.call(thread.querySelectorAll('[data-id]'),function(n){seen[n.getAttribute('data-id')]=1});
function fmt(iso){return new Date(iso+'Z').toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function dur(ms){var t=Math.round((ms||0)/1000);return Math.floor(t/60)+':'+('0'+(t%60)).slice(-2)}
function stamp(t){var iso=t.getAttribute('data-t');if(!iso)return;var txt=(t.getAttribute('data-pre')||'')+fmt(iso),n=t.firstChild;if(n&&n.nodeType===3)n.nodeValue=txt;else t.insertBefore(document.createTextNode(txt),t.firstChild)}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
${linkTokens.toString()}
${fmtBytes.toString()}
function linkifyInto(container,text){
  linkTokens(text).forEach(function(k){
    if(k.t==='text'){container.appendChild(document.createTextNode(k.v));return}
    var a=document.createElement('a');a.href=k.href;a.className='autolink'+(k.t==='user'?' mention':'');a.textContent=k.v;
    if(k.t==='url'){a.target='_blank';a.rel='noopener noreferrer'}
    container.appendChild(a);
  });
}
function toBottom(){window.scrollTo(0,document.body.scrollHeight)}
function tickHtml(t){if(!t)return'';if(t==='queued')return' <span class="tick tick-queued" title="Waiting for a connection"><svg width="14" height="14" viewBox="0 0 24 24" style="vertical-align:-2px"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>';if(convType==='group')return'';if(t==='read')return' <span class="tick tick-read">&#10003;&#10003;</span>';if(t==='delivered')return' <span class="tick tick-un">&#10003;&#10003;</span>';return' <span class="tick tick-un">&#10003;</span>'}
function clearReply(){replyTarget=null;replyBar.hidden=true;var t=document.getElementById('replyThumb');if(t)t.hidden=true}
var replyThumb=document.getElementById('replyThumb');
function startReply(id){
  var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;
  var kind=b.getAttribute('data-kind')||'text',textEl=b.querySelector('.msg-text'),fileEl=b.querySelector('.file-name'),tm=b.querySelector('time'),dm=/(\\d+:\\d\\d)/.exec((tm&&tm.getAttribute('data-pre'))||'');
  var text=kind==='voice'?('🎤 Voice note'+(dm?' · '+dm[1]:'')):kind==='sticker'?'Sticker':kind==='image'?'📷 Photo':kind==='video'?'🎬 Video':kind==='file'?('📄 '+(fileEl?fileEl.textContent.trim():'File')):(textEl?textEl.textContent.trim():'Message');
  var author=b.classList.contains('me')?'You':(b.querySelector('.sender-name')?b.querySelector('.sender-name').textContent:(convType==='group'?'Group member':((document.querySelector('.chat-head b')||{}).textContent||'Member')));
  replyTarget={id:Number(id),from_name:author,text:text.slice(0,160)||'Message',kind:kind};
  replyWho.textContent='Replying to '+author;replyWhat.textContent=replyTarget.text;
  replyThumb.hidden=true;replyThumb.removeAttribute('src');
  replyBar.hidden=false;input.focus();
}
replyCancel.addEventListener('click',clearReply);
var REACT_SET=['👍','❤️','😂','😮','😢','🙏'];
function react(id,emoji){fetch('/api/messages/'+id+'/react',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emoji:emoji})}).then(function(r){return r.json()}).then(function(j){if(j&&j.reactions)renderReactions(id,j.reactions)}).catch(function(){})}
function renderReactions(id,reactions){var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;var old=b.querySelector('.reactions');if(old)old.remove();
  var keys=Object.keys(reactions||{});if(!keys.length)return;var row=el('div','reactions');keys.forEach(function(em){row.appendChild(el('span','rchip',em+' '+reactions[em]))});
  var t=b.querySelector('time');b.insertBefore(row,t)}
function startEdit(id){var b=thread.querySelector('[data-id="'+id+'"]'),span=b.querySelector('.msg-text');if(!span)return;editingId=id;input.value=span.textContent;resizeInput();input.focus()}
function doDelete(id,scope,skip){if(!skip&&!confirm(scope==='everyone'?'Delete this message for everyone?':'Delete this message for you?'))return;
  fetch('/api/messages/'+id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:scope})}).then(function(r){return r.json()}).then(function(j){
    var previews=thread.querySelectorAll('.reply-preview[data-reply-to="'+id+'"]');
    Array.prototype.forEach.call(previews,function(p){p.parentNode.removeChild(p)});
    var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;
    if(scope==='me'){b.parentNode.removeChild(b)}else{b.classList.add('deleted');b.innerHTML='';b.appendChild(el('span','mut','This message was deleted'));var t=el('time');t.setAttribute('data-t',j.created_at||'');stamp(t);b.appendChild(t)}
  }).catch(function(){})}
function senderTag(m){if(convType!=='group'||m.from===myId)return'';return el('div','sender-name',m.from_name||'')}
function replyBox(r){var rp=el('div','reply-preview'),bd=el('div','rp-body');rp.setAttribute('data-reply-to',r.id||'');bd.appendChild(el('b','rp-name',r.from_name||'Reply'));bd.appendChild(el('span','rp-text',r.text||'Message'));rp.appendChild(bd);
  var ric={image:'🖼️',video:'🎬',sticker:'😀'}[r.kind];if(ric)rp.appendChild(el('span','rp-ico',ric))
  return rp}
function bubble(m){
  if(seen[m.id]){if(m.reactions)renderReactions(m.id,m.reactions);return}
  seen[m.id]=1;
  if(m.from===myId&&m.pending&&startingUps>0){delete seen[m.id];return}
  var hello=thread.querySelector('.hello');if(hello)hello.parentNode.removeChild(hello);
  var mine=m.from===myId,side=mine?'me':'them',d,t=el('time');t.setAttribute('data-t',m.created_at);
  if(m.kind==='call'&&m.call){d=el('div','call-entry'+(m.call.bad?' missed':''));d.appendChild(el('span',null,m.call.icon));d.appendChild(el('span',null,m.call.text))}
  else if(m.deleted){d=el('div','bubble '+side+' deleted');d.appendChild(el('span','mut','This message was deleted'))}
  else if(m.kind==='voice'){d=el('div','bubble '+side);var st=senderTag(m);if(st)d.appendChild(st);var a=document.createElement('audio');a.controls=true;a.preload='none';a.src='/api/messages/media/'+m.id;d.appendChild(a);t.setAttribute('data-pre','🎤 '+dur(m.ms)+' · ')}
  else if(m.kind==='sticker'){d=el('div','sticker-msg '+side);var st2=senderTag(m);if(st2)d.appendChild(st2);d.appendChild(mcard(m));if(!mine){var sb=el('button','link save-st','+ Save sticker');sb.type='button';sb.setAttribute('data-save',m.id);d.appendChild(sb)}}
  else if(m.kind==='image'||m.kind==='video'){if(mine&&m.pending&&startingUps>0)return;d=el('div','bubble '+side+' img-msg');var st4=senderTag(m);if(st4)d.appendChild(st4);d.appendChild(mcard(m))}
  else if(m.kind==='file'){if(mine&&m.pending&&startingUps>0)return;d=el('div','bubble '+side);var st5=senderTag(m);if(st5)d.appendChild(st5);d.appendChild(fileChip(m))}
  else{d=el('div','bubble '+side);var st3=senderTag(m);if(st3)d.appendChild(st3);var sp=el('span','msg-text');linkifyInto(sp,m.body);d.appendChild(sp);if(m.edited)d.appendChild(el('span','mut',' (edited)'))}
  function topRef(){var r=d.firstChild;while(r&&(r.className==='sender-name'||r.className==='fwd'))r=r.nextSibling;return r}
  if(m.fwd&&!m.deleted)d.insertBefore(el('div','fwd','\u21AA Forwarded'),topRef());
  if(m.reply&&!m.deleted)d.insertBefore(replyBox(m.reply),topRef());
  d.setAttribute('data-id',m.id);d.setAttribute('data-kind',m.kind);
  if(m.reactions&&Object.keys(m.reactions).length){var row=el('div','reactions');Object.keys(m.reactions).forEach(function(em){row.appendChild(el('span','rchip',em+' '+m.reactions[em]))});d.appendChild(row)}
  d.appendChild(t);stamp(t);
  if(mine&&m.kind!=='call'){var tk=document.createElement('span');tk.className='tickwrap';tk.setAttribute('data-tick','1');t.appendChild(tk);tk.innerHTML=tickHtml(m.tick||'sent')}
  var stick=mine||nearBottom();thread.appendChild(d);decorateVoice(d);if(m.starred&&!m.deleted)setStar(d,true);if(stick)toBottom();else bumpNew();
}
function updateTick(id,status){var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;var tk=b.querySelector('[data-tick]');if(!tk)return;tk.innerHTML=tickHtml(status)}
Array.prototype.forEach.call(thread.querySelectorAll('time[data-t]'),stamp);
var polling=false;
function poll(){if(polling)return;polling=true;fetch('/api/messages/poll?'+qs+'&after='+lastId+'&seen='+(document.hidden?'0':'1')+pendQ(),{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
  (j.messages||[]).forEach(function(m){bubble(m);if(m.id>lastId)lastId=m.id});
  (j.receipts||[]).forEach(function(r){updateTick(r.id,r.status)});
  var pr=document.getElementById('chatPresence');if(pr&&typeof j.online==='boolean')pr.textContent=j.online?'online':'';
  (j.ready||[]).forEach(readyMsg);
  polling=false;
}).catch(function(){polling=false})}
document.addEventListener('visibilitychange',function(){if(!document.hidden)poll()});
window.addEventListener('focus',poll);
window.addEventListener('online',poll);
function post(url,obj,cb){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}).then(function(r){return r.json()}).then(function(j){if(j&&j.id)cb(j);else alert((j&&j.error)||'Could not send.')}).catch(function(){alert('Could not send. Check your connection.')})}
toBottom();setTimeout(initialScroll,0);var initialReplyId=Number(new URLSearchParams(location.search).get('reply_to'));if(initialReplyId)setTimeout(function(){startReply(initialReplyId)},180);setInterval(poll,1500);
form.addEventListener('submit',function(e){e.preventDefault();var text=input.value.trim();if(!text)return;
  if(editingId){var id=editingId;editingId=null;input.value='';resizeInput();fetch('/api/messages/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){var b=thread.querySelector('[data-id="'+id+'"]'),span=b&&b.querySelector('.msg-text');if(span){span.innerHTML='';linkifyInto(span,text);if(!b.querySelector('.mut'))b.insertBefore(el('span','mut',' (edited)'),b.querySelector('time'))}}else alert((j&&j.error)||'Could not edit.')}).catch(function(){alert('Could not edit.')});return}
  var selectedReply=replyTarget;input.value='';resizeInput();var body=Object.assign({body:text,reply_to_id:selectedReply?selectedReply.id:null},convType==='group'?{group:convId}:{to:convId});
  if(window.StudiesApp?obxOff():!navigator.onLine){queueAndShow(body,text,selectedReply);clearReply();if(window.StudiesApp&&!obxHard())setTimeout(flushPendingHere,700);return}
  fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){
    if(j&&j.id){bubble({id:j.id,from:myId,kind:'text',body:text,reply:selectedReply,created_at:j.created_at,tick:'sent'});if(j.id>lastId)lastId=j.id;clearReply()}
    else alert((j&&j.error)||'Could not send.')
  }).catch(function(){queueAndShow(body,text,selectedReply);clearReply()})});

/* ---- send while offline: queue in IndexedDB, auto-send once a connection is back ---- */
function queueAndShow(body,text,selectedReply){
  var tempId='q'+Date.now()+Math.random().toString(36).slice(2);
  bubble({id:tempId,from:myId,kind:'text',body:text,reply:selectedReply||null,created_at:new Date().toISOString().slice(0,19).replace('T',' '),tick:'queued'});
  pendingAdd({tempId:tempId,at:new Date().toISOString(),payload:body}).then(registerBackgroundSync);
}
function pendingDB(){return new Promise(function(res,rej){var rq=indexedDB.open('shq-pending',2);rq.onupgradeneeded=function(){var db=rq.result;if(!db.objectStoreNames.contains('msgs'))db.createObjectStore('msgs',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('uploads'))db.createObjectStore('uploads',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})}
function pendingAdd(item){return pendingDB().then(function(db){return new Promise(function(res,rej){var tx=db.transaction('msgs','readwrite'),rq=tx.objectStore('msgs').add(item);rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})})}
function pendingList(){return pendingDB().then(function(db){return new Promise(function(res){var rq=db.transaction('msgs','readonly').objectStore('msgs').getAll();rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){res([])}})})}
function pendingRemove(id){return pendingDB().then(function(db){return new Promise(function(res){var tx=db.transaction('msgs','readwrite');tx.objectStore('msgs').delete(id);tx.oncomplete=function(){res()}})})}
function registerBackgroundSync(){
  if(!('serviceWorker' in navigator)||!('SyncManager' in window))return;
  navigator.serviceWorker.ready.then(function(reg){return reg.sync.register('send-queued-messages')}).catch(function(){});
}
function flushPendingHere(){ // fallback for browsers without Background Sync: only works while this page is open
  return pendingList().then(function(items){
    return items.reduce(function(p,it){return p.then(function(){
      return fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(it.payload)}).then(function(r){return r.json()}).then(function(j){
        if(j&&j.id){var b=thread.querySelector('[data-id="'+it.tempId+'"]');if(b)b.parentNode.removeChild(b);return pendingRemove(it.id)}
      }).catch(function(){});
    })},Promise.resolve());
  });
}
window.addEventListener('online',flushPendingHere);
window.addEventListener('shnet',function(){flushPendingHere();if(typeof obxFlush==='function')obxFlush();poll()});
function showPending(){ // a message still waiting for a connection keeps its clock after a refresh, until it is really sent
  return pendingList().then(function(items){items.forEach(function(it){var p=it.payload||{};
    var here=convType==='group'?String(p.group)===String(convId):String(p.to)===String(convId);
    if(here&&p.body&&!thread.querySelector('[data-id="'+it.tempId+'"]'))bubble({id:it.tempId,from:myId,kind:'text',body:p.body,created_at:(it.at||new Date().toISOString()).slice(0,19).replace('T',' '),tick:'queued'})})}).catch(function(){});
}
showPending().then(function(){if(navigator.onLine)flushPendingHere()});
/* ---- App only: voice notes, stickers and files sent with no steady internet wait here with a clock.
   Voice notes and stickers go by themselves once the internet is back; a file waits for a tap on it (retry). ---- */
var APPOBX=!!(window.StudiesApp&&window.indexedDB),NOINET_MSG='No internet connection. Check your internet connection and try again.';
function noInet(){if(window.__noInet)window.__noInet();else alert(NOINET_MSG)}
function netNow(){try{return String(StudiesApp.netState())}catch(e){return navigator.onLine?'online':'offline'}}
function obxOff(){return !navigator.onLine||netNow()!=='online'}
function obxHard(){return !navigator.onLine||netNow()==='offline'}
function obxDB(){return new Promise(function(res,rej){var rq=indexedDB.open('shq-outbox',1);rq.onupgradeneeded=function(){rq.result.createObjectStore('items',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})}
function obxAdd(it){return obxDB().then(function(db){return new Promise(function(res,rej){var rq=db.transaction('items','readwrite').objectStore('items').add(it);rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})})}
function obxAll(){return obxDB().then(function(db){return new Promise(function(res){var rq=db.transaction('items','readonly').objectStore('items').getAll();rq.onsuccess=function(){res(rq.result||[])};rq.onerror=function(){res([])}})}).catch(function(){return []})}
function obxDel(id){return obxDB().then(function(db){return new Promise(function(res){var tx=db.transaction('items','readwrite');tx.objectStore('items').delete(id);tx.oncomplete=function(){res()};tx.onerror=function(){res()}})}).catch(function(){})}
function obxDest(){return convType==='group'?{group:convId}:{to:convId}}
function obxReply(r){return r?{id:r.id,from_name:r.from_name,text:r.text,kind:r.kind}:null}
function obxShow(it){
  var id='o'+it.id;if(seen[id]||thread.querySelector('[data-id="'+id+'"]'))return;seen[id]=1;
  var hello=thread.querySelector('.hello');if(hello)hello.parentNode.removeChild(hello);
  var st=it.type==='sticker'||it.type==='lsticker',d=el('div',st?'sticker-msg me':'bubble me'),t=el('time'),mm=it.mime||'';t.setAttribute('data-t',it.at.slice(0,19).replace('T',' '));
  if(it.reply)d.appendChild(replyBox(it.reply));
  if(it.type==='voice'){d.appendChild(el('span','msg-text','🎤 Voice note · '+dur(it.ms)))}
  else if(st){var im=document.createElement('img');im.alt='sticker';im.style.cssText='width:120px;height:120px;object-fit:contain';im.src=it.blob?URL.createObjectURL(it.blob):'/api/stickers/'+it.sticker_id;d.appendChild(im)}
  else{
    if(it.blob&&mm.indexOf('image/')===0){var pi=document.createElement('img');pi.style.cssText='max-width:220px;max-height:220px;border-radius:10px;display:block';pi.src=URL.createObjectURL(it.blob);d.appendChild(pi)}
    d.appendChild(el('div','msg-text',(mm.indexOf('video/')===0?'🎬 ':mm.indexOf('image/')===0?'':'📄 ')+(it.name||'File')+' · '+fmtBytes(it.size||0)));
    var rt=el('div','mut','Not sent. Tap to retry');rt.style.cssText='color:#fff;opacity:.95;font-size:12px;font-weight:600';d.appendChild(rt);d.setAttribute('data-oretry',String(it.id));d.style.cursor='pointer'}
  d.setAttribute('data-id',id);d.setAttribute('data-kind',it.type);
  d.appendChild(t);stamp(t);var tk=document.createElement('span');tk.className='tickwrap';tk.setAttribute('data-tick','1');t.appendChild(tk);tk.innerHTML=tickHtml('queued');
  thread.appendChild(d);toBottom()}
function obxQueue(it){
  it.conv=convType+':'+convId;it.at=new Date().toISOString();
  obxAdd(it).then(function(id){it.id=id;obxShow(it);if(it.type!=='file')setTimeout(obxFlush,700)}).catch(function(){noInet()})}
function obxQSticker(base,selectedReply){base.dest=obxDest();base.reply_to_id=selectedReply?selectedReply.id:null;base.reply=obxReply(selectedReply);obxQueue(base);clearReply();panel.hidden=true;document.body.classList.remove('panel-open')}
function obxQVoice(blob,ms,type,selectedReply){obxQueue({type:'voice',blob:blob,ms:ms,mime:type,dest:obxDest(),reply_to_id:selectedReply?selectedReply.id:null,reply:obxReply(selectedReply)});clearReply()}
var obxBusy=false;
function obxDone(it,j){
  var b=thread.querySelector('[data-id="o'+it.id+'"]');if(b&&b.parentNode)b.parentNode.removeChild(b);obxDel(it.id);
  if(it.conv===convType+':'+convId){bubble({id:j.id,from:myId,kind:it.type==='voice'?'voice':'sticker',ms:it.ms,created_at:j.created_at,tick:'sent',reply:it.reply||null});if(j.id>lastId)lastId=j.id}}
function obxSend(it){
  var p;
  if(it.type==='voice'){var fd=new FormData(),ext=(it.mime||'').indexOf('mp4')>-1?'m4a':(it.mime||'').indexOf('ogg')>-1?'ogg':'webm';
    Object.keys(it.dest).forEach(function(k){fd.append(k,it.dest[k])});fd.append('ms',it.ms);if(it.reply_to_id)fd.append('reply_to_id',String(it.reply_to_id));fd.append('audio',it.blob,'voice.'+ext);
    p=fetch('/api/messages/voice',{method:'POST',body:fd})}
  else if(it.type==='lsticker'){var f2=new FormData();f2.append('sticker',it.blob,'sticker');Object.keys(it.dest).forEach(function(k){f2.append(k,it.dest[k])});if(it.reply_to_id)f2.append('reply_to_id',String(it.reply_to_id));
    p=fetch('/api/messages/local-sticker',{method:'POST',body:f2})}
  else p=fetch('/api/messages/sticker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({sticker_id:it.sticker_id,reply_to_id:it.reply_to_id||null},it.dest))});
  return p.then(function(r){return r.json()}).then(function(j){
    if(j&&j.id)obxDone(it,j);
    else if(j&&j.error){var b=thread.querySelector('[data-id="o'+it.id+'"]');if(b&&b.parentNode)b.parentNode.removeChild(b);obxDel(it.id);alert(j.error)}
  }).catch(function(){})}
function obxFlush(){
  if(!APPOBX||obxBusy||obxHard())return;obxBusy=true;
  obxAll().then(function(items){return items.filter(function(it){return it.type!=='file'}).reduce(function(pr,it){return pr.then(function(){return obxSend(it)})},Promise.resolve())})
   .then(function(){obxBusy=false},function(){obxBusy=false})}
if(APPOBX){
  thread.addEventListener('click',function(e){var n=e.target.closest?e.target.closest('[data-oretry]'):null;if(!n)return;e.stopPropagation();
    if(obxHard()){noInet();return}
    var iid=Number(n.getAttribute('data-oretry'));
    obxAll().then(function(items){var it=items.filter(function(x){return x.id===iid})[0];if(!it)return;
      if(n.parentNode)n.parentNode.removeChild(n);obxDel(iid);
      sendFile(new File([it.blob],it.name||'file',{type:it.mime||''}),it.cap||'')})},true);
  obxAll().then(function(items){items.forEach(function(it){if(it.conv===convType+':'+convId)obxShow(it)});if(!obxHard())obxFlush()});
  setInterval(function(){if(!obxHard())obxFlush()},6000);
}
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='chat-synced')return;
    (e.data.tempIds||[]).forEach(function(tid){var b=thread.querySelector('[data-id="'+tid+'"]');if(b)b.parentNode.removeChild(b)});
  });
}

/* ---- emoji + stickers panel ---- */
var EMO={'😀':'😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😴 🤤 😷 🤒 🤕 🤢 🤮 🤧 😈 💀 👻 🤡',
'👍':'👍 👎 👌 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ✋ 🤚 👋 🤝 🙏 👏 🙌 👐 🤲 💪 🫶',
'❤️':'❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 🔥 💯 💥 💫 🎉 🎊 🎁 🏆 🥇',
'🍔':'🍔 🍕 🌭 🍟 🍗 🍖 🍚 🍜 🍝 🍞 🧀 🥚 🍳 🥞 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍿 ☕ 🍵 🥤 🍺 🍻 🍎 🍌 🍉 🍇 🍓 🍍 🥭',
'📚':'📚 📖 📝 🎓 🏫 💻 📱 🎧 🎵 🎶 ⚽ 🏀 🎮 🚀 ✈️ 🚗 🏠 ⏰ 📅 💡 🔔 ✅ ❌ ⚠️ ❓ ❗ 💬'};
function ins(ch){var s=typeof input.selectionStart==='number'?input.selectionStart:input.value.length,e=typeof input.selectionEnd==='number'?input.selectionEnd:s;input.value=input.value.slice(0,s)+ch+input.value.slice(e);var p=s+ch.length;input.focus();try{input.setSelectionRange(p,p)}catch(_){}}
function showCat(k){eg.innerHTML='';EMO[k].split(' ').forEach(function(ch){var b=el('button',null,ch);b.type='button';b.addEventListener('click',function(){ins(ch)});eg.appendChild(b)})}
Object.keys(EMO).forEach(function(k){var b=el('button',null,k);b.type='button';b.addEventListener('click',function(){showCat(k)});ec.appendChild(b)});
showCat(Object.keys(EMO)[0]);
function tab(name){var isE=name==='emoji';pEmoji.hidden=!isE;pStickers.hidden=isE;Array.prototype.forEach.call(panel.querySelectorAll('[data-tab]'),function(b){b.className=(b.getAttribute('data-tab')===name?'ghost on':'ghost')});if(!isE)loadStickers()}
Array.prototype.forEach.call(panel.querySelectorAll('[data-tab]'),function(b){b.addEventListener('click',function(){tab(b.getAttribute('data-tab'))})});
pBtn.addEventListener('click',function(){panel.hidden=!panel.hidden;document.body.classList.toggle('panel-open',!panel.hidden);if(!panel.hidden){tab('emoji');toBottom()}});
/* ---- sticker board: lives on this device (IndexedDB), no count or size cap -- only bounded by the phone's
   own storage. Stickers added before this change are still listed (from the server) so nothing old is lost;
   every new sticker from here on is saved locally instead. ---- */
function stickerDB(){return new Promise(function(res,rej){var rq=indexedDB.open('shq-stickers',1);rq.onupgradeneeded=function(){rq.result.createObjectStore('board',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})}
function stickerAdd(mime,blob){return stickerDB().then(function(db){return new Promise(function(res,rej){var rq=db.transaction('board','readwrite').objectStore('board').add({mime:mime,blob:blob});rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})})}
function stickerList(){return stickerDB().then(function(db){return new Promise(function(res){var rq=db.transaction('board','readonly').objectStore('board').getAll();rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){res([])}})})}
function stickerDelete(id){return stickerDB().then(function(db){return new Promise(function(res){var tx=db.transaction('board','readwrite');tx.objectStore('board').delete(id);tx.oncomplete=function(){res()}})})}
function sendSticker(key){
  var selectedReply=replyTarget;
  var isLocal=typeof key==='string'&&key.indexOf('local:')===0;
  if(!isLocal){
    var body=Object.assign({sticker_id:key,reply_to_id:selectedReply?selectedReply.id:null},convType==='group'?{group:convId}:{to:convId});
    if(APPOBX){
      if(obxOff()){obxQSticker({type:'sticker',sticker_id:key},selectedReply);return}
      fetch('/api/messages/sticker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){
        if(j&&j.id){bubble({id:j.id,from:myId,kind:'sticker',created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply();panel.hidden=true;document.body.classList.remove('panel-open')}
        else alert((j&&j.error)||'Could not send.')}).catch(function(){obxQSticker({type:'sticker',sticker_id:key},selectedReply)});
      return}
    post('/api/messages/sticker',body,function(j){bubble({id:j.id,from:myId,kind:'sticker',created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply();panel.hidden=true;document.body.classList.remove('panel-open')});
    return;
  }
  var localId=Number(key.slice(6));
  stickerList().then(function(list){
    var s=list.filter(function(x){return x.id===localId})[0];
    if(!s)return;
    if(APPOBX&&obxOff()){obxQSticker({type:'lsticker',blob:s.blob,mime:s.mime||''},selectedReply);return}
    var fd=new FormData();fd.append('sticker',s.blob,'sticker');if(convType==='group')fd.append('group',convId);else fd.append('to',convId);
    if(selectedReply)fd.append('reply_to_id',String(selectedReply.id));
    fetch('/api/messages/local-sticker',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){
      if(j&&j.id){bubble({id:j.id,from:myId,kind:'sticker',created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply();panel.hidden=true;document.body.classList.remove('panel-open')}
      else alert((j&&j.error)||'Could not send that sticker.');
    }).catch(function(){if(APPOBX)obxQSticker({type:'lsticker',blob:s.blob,mime:s.mime||''},selectedReply);else alert('Could not send that sticker -- check your connection.')});
  });
}
function loadStickers(){
  Promise.all([fetch('/api/stickers').then(function(r){return r.json()}).catch(function(){return {stickers:[]}}),stickerList()]).then(function(r){
    var serverList=(r[0]&&r[0].stickers)||[],localList=r[1]||[];
    sg.innerHTML='';
    if(!serverList.length&&!localList.length){sg.appendChild(el('p','mut','No stickers yet. Add a picture to start your sticker board.'));return}
    serverList.forEach(function(s){addStickerTile('/api/stickers/'+s.id,s.id,function(){
      if(confirm('Delete this sticker from your board?'))fetch('/api/stickers/'+s.id+'/delete',{method:'POST'}).then(loadStickers);
    })});
    localList.forEach(function(s){var url=URL.createObjectURL(s.blob);addStickerTile(url,'local:'+s.id,function(){
      if(confirm('Delete this sticker from your board?'))stickerDelete(s.id).then(loadStickers);
    })});
  });
}
function addStickerTile(src,sendKey,onDelete){
  var w=el('div','st'),im=document.createElement('img');im.src=src;im.alt='sticker';im.addEventListener('click',function(){sendSticker(sendKey)});
  var x=el('button','st-x','×');x.type='button';x.addEventListener('click',onDelete);
  w.appendChild(im);w.appendChild(x);sg.appendChild(w);
}
function upStatusShow(t){upStatus.hidden=false;upStatus.textContent=t}
function upStatusHide(){upStatus.hidden=true}
stFile.addEventListener('change',function(){var files=Array.prototype.slice.call(stFile.files||[]);if(!files.length)return;
  var i=0,errs=[];
  function next(){
    if(i>=files.length){stFile.value='';upStatusHide();loadStickers();if(errs.length)alert(errs.join('\\n'));return}
    var f=files[i++];
    if(!/^image\\//.test(f.type)){errs.push(f.name+': not a picture');next();return}
    upStatusShow('Adding sticker '+i+' of '+files.length+'\u2026');
    stickerAdd(f.type,f).then(function(){next()}).catch(function(){errs.push(f.name+': could not be saved');next()});
  }
  next();
});
stZip.addEventListener('change',function(){var f=stZip.files&&stZip.files[0];if(!f)return;
  upStatusShow('Unzipping your stickers\u2026');
  var fd=new FormData();fd.append('zip',f,f.name);
  fetch('/api/stickers/zip',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){
    stZip.value='';
    if(!j||j.error){upStatusHide();alert((j&&j.error)||'Could not read that zip file.');return}
    var imgs=j.images||[];
    return Promise.all(imgs.map(function(im){
      return fetch('data:'+im.mime+';base64,'+im.data).then(function(r){return r.blob()}).then(function(blob){return stickerAdd(im.mime,blob)});
    })).then(function(){
      upStatusHide();loadStickers();
      alert('Added '+imgs.length+' sticker'+(imgs.length===1?'':'s')+(j.skipped?' (skipped '+j.skipped+' file'+(j.skipped===1?'':'s')+' that were not pictures)':'')+'.');
    });
  }).catch(function(){upStatusHide();alert('Could not read that zip file.')});
});
/* ---- photos, videos, stickers and files: nothing downloads until you tap, and what you send appears at once ---- */
var DLKEY='sh_dl',dlSet={};try{JSON.parse(localStorage.getItem(DLKEY)||'[]').forEach(function(i){dlSet[i]=1})}catch(e){}
function isDl(id){return !!dlSet[id]}
function markDl(id){dlSet[id]=1;try{var a=Object.keys(dlSet);if(a.length>3000)a=a.slice(-3000);localStorage.setItem(DLKEY,JSON.stringify(a))}catch(e){}}
var pend={},ups={},startingUps=0;
var M_ICO={image:'🖼️',video:'🎬',sticker:'😀'},M_LBL={image:'Photo',video:'Video',sticker:'Sticker'};
function pendQ(){var k=Object.keys(pend);return k.length?'&pend='+k.slice(0,20).join(','):''}
function mUrl(id){return '/api/messages/media/'+id}
function mSize(c){return Number(c.getAttribute('data-size'))||0}
function mState(c,st){c.className=c.className.replace(/ ?mc-state-[a-z]+/g,'').replace(/ ?done/g,'')+' mc-state-'+st}
function mSet(c,st,pct,note){
  mState(c,st);var k=c.getAttribute('data-mk'),h='<div class="mc-ph"><span class="mc-ico">'+(st==='wait'?'<span class="mc-spin"></span>':M_ICO[k])+'</span><span class="mc-lbl">'+(st==='wait'?'Sending… ':'')+M_LBL[k]+'</span></div>';
  if(st==='idle')h+='<button type="button" class="mc-dl">⬇ '+fmtBytes(mSize(c))+'</button>';
  else if(st==='err')h+='<button type="button" class="mc-dl">⟳ Try again · '+fmtBytes(mSize(c))+'</button>';
  else if(st==='load'||st==='up')h+='<div class="mc-prog"><div class="mc-bar"><i style="width:'+(pct||0)+'%"></i></div><span class="mc-pct">'+(note||'')+'</span>'+(st==='up'?'<button type="button" class="mc-cancel" aria-label="Cancel">✕</button>':'')+'</div>';
  c.innerHTML=h;
  if(c.__prev&&st==='up'){c.firstChild.style.backgroundImage='url('+c.__prev+')';c.firstChild.className+=' has-prev'}}
function mProg(c,pct,note){var i=c.querySelector('.mc-bar i'),t=c.querySelector('.mc-pct');if(i)i.style.width=pct+'%';if(t)t.textContent=note||''}
function mShow(c,url){
  var id=c.getAttribute('data-mid'),k=c.getAttribute('data-mk');mState(c,'done');c.className+=' done';c.innerHTML='';
  if(k==='video'){var v=document.createElement('video');v.className='mc-vid';v.src=url;v.controls=true;v.playsInline=true;v.preload='metadata';c.appendChild(v);var a=document.createElement('a');a.className='mc-save';a.href=mUrl(id)+'?dl=1';a.setAttribute('download','');a.textContent='⬇ Save to phone';c.appendChild(a)}
  else{var im=document.createElement('img');im.className='mc-img';im.alt=M_LBL[k];im.src=url;im.setAttribute('data-view',url);c.appendChild(im)}}
function mInit(c){
  var id=c.getAttribute('data-mid');
  if(c.getAttribute('data-pending')==='1'){c.removeAttribute('data-pending');pend[id]=1;mSet(c,'wait');return}
  if(isDl(id)){mShow(c,mUrl(id));return}
  mSet(c,'idle')}
function mcard(m){
  var c=el('div','mcard mc-'+m.kind);c.setAttribute('data-mid',m.id);c.setAttribute('data-mk',m.kind);c.setAttribute('data-size',m.size||0);c.setAttribute('data-name',m.name||'');
  if(m.uploading){if(m.kind==='image')c.__prev=URL.createObjectURL(m.uploading);mSet(c,'up',0,'Sending… 0%')}
  else{if(m.pending)c.setAttribute('data-pending','1');mInit(c)}
  return c}
function mDownload(c){
  var id=c.getAttribute('data-mid'),x=new XMLHttpRequest(),sz=mSize(c);x.open('GET',mUrl(id));x.responseType='blob';mSet(c,'load',0,'0%');
  x.onprogress=function(e){var tot=e.lengthComputable?e.total:sz;if(tot)mProg(c,Math.min(100,Math.round(e.loaded*100/tot)),fmtBytes(e.loaded)+' / '+fmtBytes(tot))};
  x.onload=function(){if(x.status===200&&x.response){markDl(id);mShow(c,URL.createObjectURL(x.response))}else mSet(c,'err')};
  x.onerror=function(){mSet(c,'err')};x.send()}
function fileChip(m){
  var wait=!!(m.pending||m.uploading),d=document.createElement(wait?'div':'a');d.className='file-chip'+(wait?' pending':'');
  if(!wait){d.href=mUrl(m.id)+'?dl=1';d.setAttribute('download',m.name||'file')}
  d.appendChild(el('span','fc-ico','📄'));var mn=el('span','fc-main');mn.appendChild(el('span','file-name',m.name||'File'));
  mn.appendChild(el('span','fc-size',fmtBytes(m.size)+(wait?' · Sending…':'')));
  if(m.uploading){var bar=el('span','fc-bar');bar.appendChild(document.createElement('i'));mn.appendChild(bar)}
  d.appendChild(mn);
  if(m.uploading){var cb=el('button','mc-cancel','✕');cb.type='button';d.appendChild(cb)}else if(wait)d.appendChild(el('span','mc-spin'));else d.appendChild(el('span','fc-dl','⬇'));
  return d}
function readyMsg(r){
  delete pend[r.id];var b=thread.querySelector('[data-id="'+r.id+'"]');if(!b)return;
  if(r.gone){b.parentNode.removeChild(b);return}
  var c=b.querySelector('.mcard');if(c){if(r.size)c.setAttribute('data-size',r.size);mInit(c)}
  var fc=b.querySelector('.file-chip.pending');if(fc){var nm=(b.querySelector('.file-name')||{}).textContent;fc.parentNode.replaceChild(fileChip({id:r.id,name:nm,size:r.size}),fc)}}
var viewer=null;
function closeViewer(){if(viewer){viewer.parentNode.removeChild(viewer);viewer=null}}
function openViewer(url,id){
  closeViewer();viewer=el('div','mviewer');var im=document.createElement('img');im.src=url;viewer.appendChild(im);
  var bar=el('div','mv-bar'),cl=el('button','mv-x','✕');cl.type='button';cl.setAttribute('data-vclose','1');
  var sv=el('a','mv-save','⬇ Save to phone');sv.href=mUrl(id)+'?dl=1';sv.setAttribute('download','');bar.appendChild(cl);bar.appendChild(sv);viewer.appendChild(bar);
  viewer.addEventListener('click',function(e){if(e.target===viewer||(e.target.getAttribute&&e.target.getAttribute('data-vclose')))closeViewer()});document.body.appendChild(viewer)}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeViewer()});
thread.addEventListener('click',function(e){
  var cb=e.target.closest?e.target.closest('.mc-cancel'):null;
  if(cb){var bb=cb.closest('[data-id]'),u=bb&&ups[bb.getAttribute('data-id')];if(u)u.cancel();return}
  var c=e.target.closest?e.target.closest('.mcard'):null;if(!c)return;
  if(e.target.closest('.mc-save'))return;
  var im=e.target.closest('.mc-img');
  if(im){if(c.getAttribute('data-mk')!=='sticker')openViewer(im.getAttribute('data-view')||im.src,c.getAttribute('data-mid'));return}
  if(/mc-state-(idle|err)/.test(c.className))mDownload(c)});
Array.prototype.forEach.call(thread.querySelectorAll('.mcard'),mInit);
Array.prototype.forEach.call(thread.querySelectorAll('.file-chip.pending[data-fid]'),function(n){pend[n.getAttribute('data-fid')]=1});
function sendFile(f,cap){
  if(f.size>200*1024*1024){alert('That file is too big (200 MB is the limit).');return}
  if(APPOBX&&obxHard()){obxQueue({type:'file',blob:f,name:f.name,mime:f.type||'',size:f.size,cap:cap||''});return}
  var kind=f.type.indexOf('image/')===0?'image':f.type.indexOf('video/')===0?'video':'file',tmp='u'+Date.now()+Math.floor(Math.random()*1000),up={xhr:null,dead:false,id:0};
  startingUps++;ups[tmp]=up;
  bubble({id:tmp,from:myId,kind:kind,name:f.name,size:f.size,created_at:new Date().toISOString().slice(0,19).replace('T',' '),tick:'sent',uploading:f});
  var b=thread.querySelector('[data-id="'+tmp+'"]'),c=b&&b.querySelector('.mcard');
  function prog(pct){if(c)mProg(c,pct,'Sending… '+pct+'%');else if(b){var t=b.querySelector('.fc-size'),bi=b.querySelector('.fc-bar i');if(t)t.textContent=fmtBytes(f.size)+' · Sending… '+pct+'%';if(bi)bi.style.width=pct+'%'}}
  function clean(){delete ups[tmp];if(up.id)delete ups[up.id];if(b&&b.parentNode)b.parentNode.removeChild(b)}
  up.cancel=function(){up.dead=true;if(up.xhr)up.xhr.abort();if(up.id)fetch('/api/messages/'+up.id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'everyone'})}).catch(function(){});clean()};
  function finish(id,nocap){
    delete ups[id];markDl(id);
    if(c){c.setAttribute('data-size',f.size);mShow(c,URL.createObjectURL(f))}
    else{var fc=b.querySelector('.file-chip');if(fc)fc.parentNode.replaceChild(fileChip({id:id,name:f.name,size:f.size}),fc)}
    updateTick(id,'sent');
    if(cap&&!nocap){var cb2=Object.assign({body:cap,reply_to_id:null},convType==='group'?{group:convId}:{to:convId});fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cb2)}).then(function(r){return r.json()}).then(function(j){if(j&&j.id){bubble({id:j.id,from:myId,kind:'text',body:cap,created_at:j.created_at,tick:'sent'});if(j.id>lastId)lastId=j.id}}).catch(function(){})}}
  var sb=Object.assign({name:f.name,size:f.size,mime:f.type||'application/octet-stream'},convType==='group'?{group:convId}:{to:convId});
  fetch('/api/messages/attachment/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sb)}).then(function(r){return r.json()}).then(function(j){
    startingUps--;if(up.dead)return;
    if(!j||!j.id){alert((j&&j.error)||'Could not send that file.');clean();return}
    up.id=j.id;ups[j.id]=up;seen[j.id]=1;if(j.id>lastId)lastId=j.id;
    if(b){b.setAttribute('data-id',j.id);if(c)c.setAttribute('data-mid',j.id)}
    if(window.StudiesApp&&StudiesApp.upBegin){
      var cj=Object.assign({body:cap||'',reply_to_id:null},convType==='group'?{group:convId}:{to:convId});
      var nu=shNativeUp(f,{id:'m'+j.id,open:location.pathname+location.search,url:'/api/messages/attachment/'+j.id,fields:[['__file','file']],title:f.name,afterUrl:cap?'/api/messages/send':'',afterJson:cap?JSON.stringify(cj):''},function(p){if(!up.dead)prog(p)},function(ok,why){if(up.dead)return;if(ok)finish(j.id,true);else{if(c)mProg(c,0,'Not sent'+(why?' ('+why+')':'')+'. Tap to retry');else if(b){var t2=b.querySelector('.fc-size');if(t2)t2.textContent='Not sent. Tap to retry'}if(b){b.style.cursor='pointer';b.onclick=function(){if(nu.retry()){b.onclick=null;b.style.cursor='';prog(0)}}}}});
      var oc=up.cancel;up.cancel=function(){nu.cancel();oc()};
      return}
    var x=new XMLHttpRequest(),fd=new FormData();up.xhr=x;fd.append('file',f,f.name);
    x.open('POST','/api/messages/attachment/'+j.id);
    x.upload.onprogress=function(e){if(e.lengthComputable)prog(Math.min(100,Math.round(e.loaded*100/e.total)))};
    x.onload=function(){if(up.dead)return;if(x.status===200)finish(j.id);else{var m='Could not send that file.';try{m=JSON.parse(x.responseText).error||m}catch(er){}alert(m);up.cancel()}};
    x.onerror=function(){if(up.dead)return;alert('Could not send that file. Check your connection and try again.');up.cancel()};
    x.send(fd)
  }).catch(function(){startingUps--;if(up.dead)return;clean();if(APPOBX)obxQueue({type:'file',blob:f,name:f.name,mime:f.type||'',size:f.size,cap:cap||''});else alert('Could not send that file. Check your connection and try again.')})}

(function(){var A=window.StudiesApp;if(!A||!A.upStatus)return;
function watch(mid,ui){var id='m'+mid,lost=0;(function t(){if(!document.querySelector('[data-id="'+mid+'"]'))return;var s=String(A.upStatus(id)).split('|'),st=+s[0],p=+s[1]||0;
 if(st===1||st===2){lost=0;ui('run',p);setTimeout(t,600)}else if(st===3){ui('done')}else if(st===4||st===5){lost=0;ui('paused',0,s[2]||'');setTimeout(t,2500)}else{if(++lost>=3){ui('lost');return}setTimeout(t,2000)}})()}
function lostFix(mid){fetch('/api/messages/'+mid+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'everyone'})}).catch(function(){});var b=thread.querySelector('[data-id="'+mid+'"]');if(b&&b.parentNode)b.parentNode.removeChild(b)}
Array.prototype.forEach.call(thread.querySelectorAll('.bubble.me,.sticker-msg.me'),function(b){var mid=b.getAttribute('data-id');if(!/^\\d+$/.test(mid||''))return;var c=b.querySelector('.mcard.mc-state-wait'),fc=b.querySelector('.file-chip.pending');if(!c&&!fc)return;
 var st0=b.getAttribute('data-nw');if(st0)return;b.setAttribute('data-nw','1');
 watch(mid,function(kind,p,why){
  if(c){if(kind==='run'){if(!/mc-state-up/.test(c.className))mSet(c,'up',p,'Sending… '+p+'%');else mProg(c,p,'Sending… '+p+'%')}
   else if(kind==='paused'){if(!/mc-state-err/.test(c.className)){mSet(c,'err');c.setAttribute('data-nretry',mid)}var bt=c.querySelector('.mc-dl');if(bt)bt.textContent='⟳ Not sent'+(why?' ('+why+')':'')+'. Tap to retry'}
   else if(kind==='lost')lostFix(mid)}
  else if(fc){var sz=fc.querySelector('.fc-size');if(kind==='run'){if(sz)sz.textContent='Sending… '+p+'%'}else if(kind==='paused'){if(sz)sz.textContent='Not sent'+(why?' ('+why+')':'')+'. Tap to retry';fc.setAttribute('data-nretry',mid);fc.style.cursor='pointer'}else if(kind==='lost')lostFix(mid)}})});
thread.addEventListener('click',function(e){var n=e.target.closest?e.target.closest('[data-nretry]'):null;if(!n)return;e.stopPropagation();var mid=n.getAttribute('data-nretry');if(A.upRetry('m'+mid)){n.removeAttribute('data-nretry');if(n.classList.contains('mcard'))mSet(n,'up',0,'Sending… 0%');var b=n.closest('[data-id]');if(b){b.removeAttribute('data-nw');
 // re-arm the watcher by reloading the status loop
 setTimeout(function(){location.reload()},300)}}},true);
})();
var attachInput=document.getElementById('fileInput');
attachInput.addEventListener('change',function(){var fs=Array.prototype.slice.call(attachInput.files||[]);attachInput.value='';fs=fs.slice(0,10);if(!fs.length)return;if(window.shPreview)shPreview(fs,{caption:true},function(list,cap){list.forEach(function(f,k){sendFile(f,k===0?cap:'')})});else fs.forEach(function(f){sendFile(f)})});
thread.addEventListener('click',function(e){
  var save=e.target.closest?e.target.closest('[data-save]'):null;
  if(save){fetch('/api/stickers/from-message/'+save.getAttribute('data-save'),{method:'POST'}).then(function(r){return r.json()}).then(function(j){save.textContent=(j&&j.ok)?'✓ Saved to your stickers':((j&&j.error)||'Could not save');save.disabled=true}).catch(function(){save.textContent='Could not save'});return}
});

/* ---- mobile reply gestures: swipe a message horizontally or long-press it ---- */
var touchStart=null,pressTimer=null;
thread.addEventListener('touchstart',function(e){
  var b=e.target.closest?e.target.closest('[data-id]'):null;
  if(!b||e.target.closest('button,input,audio,textarea'))return;
  var t=e.touches[0];touchStart={id:b.getAttribute('data-id'),x:t.clientX,y:t.clientY};
  clearTimeout(pressTimer);
  pressTimer=setTimeout(function(){if(touchStart){selectAdd(touchStart.id);touchStart=null}},450);
},{passive:true});
thread.addEventListener('touchmove',function(e){
  if(!touchStart)return;
  var t=e.touches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;
  if(Math.abs(dx)>12||Math.abs(dy)>12)clearTimeout(pressTimer);
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.3){
    var id=touchStart.id;touchStart=null;clearTimeout(pressTimer);startReply(id);
  }
},{passive:true});
thread.addEventListener('touchend',function(){clearTimeout(pressTimer);touchStart=null},{passive:true});
thread.addEventListener('touchcancel',function(){clearTimeout(pressTimer);touchStart=null},{passive:true});

/* ---- press-and-hold a message to select it: top bar (reply, copy, forward, star, info, delete) + floating reactions ---- */
var sel={},pressed=false,selBar=document.getElementById('msgSelBar'),selCnt=document.getElementById('msgSelCount'),rbar=document.getElementById('reactBar'),toastEl=document.getElementById('toast'),sheet=document.getElementById('sheet'),sheetBox=document.getElementById('sheetBox'),msgMenu=document.getElementById('msgMenu'),btm=document.getElementById('toBtm'),btmN=document.getElementById('toBtmN'),newCount=0;
function selIds(){return Object.keys(sel)}
function bubOf(id){return thread.querySelector('[data-id="'+id+'"]')}
function isMine(b){return b.classList.contains('me')}
function show(id,on){document.getElementById(id).style.display=on?'':'none'}
function toast(t){toastEl.textContent=t;toastEl.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(function(){toastEl.style.display='none'},1800)}
function copyText(t){function fb(){var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}document.body.removeChild(ta)}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(fb);else fb()}
function fullTime(iso){return iso?new Date(iso+'Z').toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}
function setStar(b,on){if(on)b.setAttribute('data-starred','1');else b.removeAttribute('data-starred');var tm=b.querySelector('time');if(!tm)return;var ex=tm.querySelector('.starmark');
  if(on&&!ex){tm.insertBefore(el('span','starmark',' ★'),tm.querySelector('.tickwrap'))}else if(!on&&ex)ex.remove()}
function placeReact(b){rbar.style.display='flex';var r=b.getBoundingClientRect(),w=rbar.offsetWidth||280,top=Math.max(70,r.top-54);rbar.style.top=top+'px';
  var left=isMine(b)?Math.min(window.innerWidth-w-8,Math.max(8,r.right-w)):Math.max(8,Math.min(window.innerWidth-w-8,r.left));rbar.style.left=left+'px'}
function renderSel(){
  var ids=selIds();
  Array.prototype.forEach.call(thread.querySelectorAll('[data-id]'),function(b){b.classList.toggle('msg-sel',!!sel[b.getAttribute('data-id')])});
  document.body.classList.toggle('msg-selecting',ids.length>0);
  selBar.style.display=ids.length?'flex':'none';rbar.style.display='none';msgMenu.style.display='none';
  if(!ids.length)return;
  selCnt.textContent=ids.length;
  var bs=ids.map(bubOf).filter(Boolean),one=bs.length===1,deleted=bs.some(function(b){return b.classList.contains('deleted')||b.getAttribute('data-kind')==='call'});
  show('mReply',one&&!deleted);show('mFwd',!deleted);show('mStar',!deleted);
  show('mCopy',bs.some(function(b){return b.getAttribute('data-kind')==='text'&&!!b.querySelector('.msg-text')}));
  show('mInfo',one&&isMine(bs[0])&&!deleted);
  var canEdit=one&&isMine(bs[0])&&!deleted&&bs[0].getAttribute('data-kind')==='text';show('mMore',canEdit);
  document.getElementById('mStar').title=bs.every(function(b){return b.getAttribute('data-starred')==='1'})?'Remove star':'Star';
  if(one&&!deleted)placeReact(bs[0]);
}
function selectAdd(id){if(!bubOf(id))return;pressed=true;if(navigator.vibrate)try{navigator.vibrate(15)}catch(x){}sel[id]=1;renderSel()}
function selToggle(id){if(sel[id])delete sel[id];else sel[id]=1;renderSel()}
function selClear(){sel={};renderSel()}
thread.addEventListener('pointerdown',function(){pressed=false},true);
thread.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('[data-id]'):null;
  if(pressed){e.preventDefault();e.stopPropagation();pressed=false;return}
  if(selIds().length&&b){e.preventDefault();e.stopPropagation();selToggle(b.getAttribute('data-id'))}},true);
thread.addEventListener('contextmenu',function(e){var b=e.target.closest?e.target.closest('[data-id]'):null;if(!b)return;e.preventDefault();selectAdd(b.getAttribute('data-id'))});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(sheet.style.display!=='none')closeSheet();else selClear()}});
window.addEventListener('scroll',function(){var ids=selIds();if(ids.length===1){var b=bubOf(ids[0]);if(b)placeReact(b)}},{passive:true});
REACT_SET.forEach(function(em){var bt=el('button',null,em);bt.type='button';bt.addEventListener('click',function(){var ids=selIds();if(ids.length===1)react(ids[0],em);selClear()});rbar.appendChild(bt)});
function openSheet(node){sheetBox.innerHTML='';sheetBox.appendChild(node);sheet.style.display='flex'}
function closeSheet(){sheet.style.display='none'}
sheet.addEventListener('click',function(e){if(e.target===sheet)closeSheet()});
function sbtn(text,fn,cls){var b=el('button',cls||'ghost',text);b.type='button';b.addEventListener('click',fn);return b}
document.getElementById('mClose').onclick=selClear;
document.getElementById('mReply').onclick=function(){var ids=selIds();if(ids.length===1)startReply(ids[0]);selClear()};
document.getElementById('mCopy').onclick=function(){var t=selIds().map(bubOf).filter(Boolean).map(function(b){var m=b.querySelector('.msg-text');return b.getAttribute('data-kind')==='text'&&m?m.textContent:''}).filter(Boolean).join('\\n');if(t){copyText(t);toast('Copied')}selClear()};
document.getElementById('mMore').onclick=function(e){e.stopPropagation();msgMenu.style.display=msgMenu.style.display==='block'?'none':'block'};
document.getElementById('mEdit').onclick=function(){var ids=selIds();selClear();if(ids.length===1)startEdit(ids[0])};
document.addEventListener('click',function(e){if(!msgMenu.contains(e.target))msgMenu.style.display='none'});
document.getElementById('mStar').onclick=function(){var ids=selIds(),bs=ids.map(bubOf).filter(Boolean),on=!bs.every(function(b){return b.getAttribute('data-starred')==='1'});
  fetch('/api/messages/star',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids.map(Number),on:on})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){bs.forEach(function(b){setStar(b,on)});toast(on?'Starred':'Star removed')}}).catch(function(){toast('Could not reach the server')});selClear()};
document.getElementById('mInfo').onclick=function(){var ids=selIds();if(ids.length!==1)return;var id=ids[0];selClear();
  var box=el('div');box.appendChild(el('b',null,'Message info'));box.appendChild(el('p','mut','Loading…'));openSheet(box);
  fetch('/api/messages/'+id+'/info',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
    var o=el('div');o.appendChild(el('b',null,'Message info'));
    function line(k,v){var p=el('p');p.style.margin='10px 0 0';p.appendChild(el('b',null,k+': '));p.appendChild(document.createTextNode(v));o.appendChild(p)}
    if(j.group){line('Sent',fullTime(j.sent));line('Read by',j.read.length?'':'nobody yet');j.read.forEach(function(r){line('✓✓ '+r.name,fullTime(r.at))});if(j.waiting.length)line('Not read yet',j.waiting.join(', '))}
    else{line('Read',j.read?fullTime(j.read):'not yet');line('Delivered',j.delivered?fullTime(j.delivered):'not yet');line('Sent',fullTime(j.sent))}
    o.appendChild(sbtn('Close',closeSheet));openSheet(o)}).catch(function(){var o=el('div');o.appendChild(el('p','mut','Could not load the info.'));o.appendChild(sbtn('Close',closeSheet));openSheet(o)})};
function delMany(ids,scope){ids.forEach(function(id){doDelete(id,scope,true)});closeSheet();selClear()}
document.getElementById('mDel').onclick=function(){var ids=selIds(),bs=ids.map(bubOf).filter(Boolean),allMine=bs.length&&bs.every(function(b){return isMine(b)&&!b.classList.contains('deleted')});
  var o=el('div');o.appendChild(el('b',null,'Delete '+(ids.length>1?ids.length+' messages':'message')+'?'));
  if(allMine)o.appendChild(sbtn('Delete for everyone',function(){delMany(ids,'everyone')},'danger'));
  o.appendChild(sbtn('Delete for me',function(){delMany(ids,'me')}));o.appendChild(sbtn('Cancel',closeSheet));openSheet(o)};
document.getElementById('mFwd').onclick=function(){var ids=selIds().map(Number);
  var o=el('div');o.appendChild(el('b',null,'Forward to…'));var list=el('div');o.appendChild(list);list.appendChild(el('p','mut','Loading…'));
  var chosen={},go=sbtn('Forward',function(){var t=Object.keys(chosen).map(function(k){var p=k.split(':');return{kind:p[0],id:Number(p[1])}});if(!t.length)return;go.disabled=true;
    fetch('/api/messages/forward',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids,targets:t})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){toast('Forwarded');closeSheet();selClear();poll()}else{go.disabled=false;alert((j&&j.error)||'Could not forward.')}}).catch(function(){go.disabled=false;alert('Could not forward. Check your connection.')})},'');
  o.appendChild(go);o.appendChild(sbtn('Cancel',closeSheet));openSheet(o);
  fetch('/api/chats/targets',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){list.innerHTML='';var ts=j.targets||[];if(!ts.length)list.appendChild(el('p','mut','No chats to forward to yet.'));
    ts.forEach(function(t){var l=el('label','fw-row'),c=document.createElement('input');c.type='checkbox';c.addEventListener('change',function(){var k=t.kind+':'+t.id;if(c.checked){if(Object.keys(chosen).length>=5){c.checked=false;toast('You can pick up to 5 chats');return}chosen[k]=1}else delete chosen[k]});l.appendChild(c);l.appendChild(el('span',null,(t.kind==='group'?'👥 ':'')+t.name));list.appendChild(l)})}).catch(function(){list.innerHTML='';list.appendChild(el('p','mut','Could not load your chats.'))})};
/* ---- scroll-to-latest button with a count of new messages ---- */
function nearBottom(){return document.documentElement.scrollHeight-(window.scrollY+window.innerHeight)<220}
function updBtm(){var far=!nearBottom();btm.style.display=far?'flex':'none';if(!far)newCount=0;btmN.style.display=newCount?'':'none';btmN.textContent=newCount}
function bumpNew(){newCount++;updBtm()}
window.addEventListener('scroll',updBtm,{passive:true});
btm.onclick=function(){newCount=0;toBottom();updBtm()};
function initialScroll(){var d=document.getElementById('unreadDiv');if(d){window.scrollTo(0,Math.max(0,d.getBoundingClientRect().top+window.scrollY-90))}else toBottom();updBtm()}
/* ---- voice notes: playback speed 1x / 1.5x / 2x ---- */
function decorateVoice(d){if(!d||d.getAttribute('data-kind')!=='voice'||d.querySelector('.vspeed'))return;var a=d.querySelector('audio');if(!a)return;var b=el('button','vspeed','1x'),rates=[1,1.5,2],i=0;b.type='button';
  b.addEventListener('click',function(e){e.stopPropagation();i=(i+1)%3;a.playbackRate=rates[i];b.textContent=rates[i]+'x'});a.addEventListener('play',function(){a.playbackRate=rates[i]});a.parentNode.insertBefore(b,a.nextSibling)}
Array.prototype.forEach.call(thread.querySelectorAll('[data-kind="voice"]'),decorateVoice);

/* ---- voice notes: tap the mic to record, tap Send to deliver ---- */
var rec=null,chunks=[],stream=null,t0=0,tick=null,cancelled=false;
function pickMime(){var c=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];for(var i=0;i<c.length;i++){if(window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(c[i]))return c[i]}return ''}
function stopTracks(){if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null}}
function endRec(){clearInterval(tick);recBar.hidden=true;form.hidden=false}
function finish(cancel){cancelled=cancel;endRec();if(rec&&rec.state!=='inactive')rec.stop();else stopTracks()}
function sendVoice(blob,ms,type){var selectedReply=replyTarget,fd=new FormData();if(APPOBX&&obxOff()){obxQVoice(blob,ms,type,selectedReply);return}if(convType==='group')fd.append('group',convId);else fd.append('to',convId);fd.append('ms',ms);if(selectedReply)fd.append('reply_to_id',String(selectedReply.id));var ext=/mp4/.test(type)?'m4a':/ogg/.test(type)?'ogg':'webm';fd.append('audio',blob,'voice.'+ext);
  fetch('/api/messages/voice',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){if(j&&j.id){bubble({id:j.id,from:myId,kind:'voice',ms:ms,created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply()}else alert((j&&j.error)||'Could not send the voice note.')}).catch(function(){if(APPOBX){obxQVoice(blob,ms,type,selectedReply)}else alert('Could not send the voice note.')})}
micBtn.addEventListener('click',function(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){alert('Voice notes are not supported in this browser.');return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
    stream=s;cancelled=false;chunks=[];var mt=pickMime();
    try{rec=mt?new MediaRecorder(s,{mimeType:mt}):new MediaRecorder(s)}catch(err){stopTracks();alert('Could not start recording.');return}
    rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};
    rec.onstop=function(){var ms=Date.now()-t0,type=rec.mimeType||mt||'audio/webm';stopTracks();if(cancelled||!chunks.length)return;sendVoice(new Blob(chunks,{type:type}),ms,type)};
    rec.start();t0=Date.now();panel.hidden=true;document.body.classList.remove('panel-open');form.hidden=true;recBar.hidden=false;recTime.textContent='0:00';
    tick=setInterval(function(){var ms=Date.now()-t0;recTime.textContent=dur(ms);if(ms>=120000)finish(false)},250);
  }).catch(function(){alert('Allow microphone access to send voice notes.')})});
recSend.addEventListener('click',function(){finish(false)});
recCancel.addEventListener('click',function(){finish(true)});
})();`;
  return { CHAT_JS };
};
