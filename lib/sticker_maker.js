// Sticker maker for the chat: pick a picture (or a plain colour), move and zoom it, write on it with coloured
// letters and coloured boxes behind the letters, then save it to the sticker board on this phone.
// Plain script text that is placed inside the chat page script (it uses stickerAdd, loadStickers and el from there).
exports.js = `
/* ---- sticker maker ---- */
(function(){
  var mk=document.getElementById('stMake');if(!mk)return;
  var COLS=['#ffffff','#000000','#1e90ff','#ef4444','#facc15','#22c55e','#a855f7','#f97316','#ec4899'];
  var S=512,ov=null,cv,cx,img=null,sc=1,ox=0,oy=0,zoom=1,back='#1e293b',texts=[],sel=-1,drag=null;
  function row(label,cols,none,cur,pick){
    var r=el('div','sm-row'),l=el('span','sm-l',label);r.appendChild(l);
    if(none){var n=el('button','sm-sw sm-none','\\u2715');n.type='button';n.setAttribute('aria-label','No colour');n.onclick=function(){pick(null)};r.appendChild(n)}
    cols.forEach(function(c){var b=el('button','sm-sw');b.type='button';b.style.background=c;b.setAttribute('aria-label',c);b.onclick=function(){pick(c)};r.appendChild(b)});
    return r}
  function fit(){if(!img)return;var m=Math.max(S/img.width,S/img.height);sc=m;ox=0;oy=0;zoom=1}
  function draw(exp){
    cx.clearRect(0,0,S,S);cx.fillStyle=back;cx.fillRect(0,0,S,S);
    if(img){var w=img.width*sc*zoom,h=img.height*sc*zoom;cx.drawImage(img,S/2-w/2+ox,S/2-h/2+oy,w,h)}
    texts.forEach(function(t,i){
      var lines=t.t.split(String.fromCharCode(10)),w=0,z=t.size;
      cx.font='bold '+z+'px sans-serif';cx.textAlign='center';cx.textBaseline='middle';
      lines.forEach(function(s){w=Math.max(w,cx.measureText(s).width)});
      if(w+z*0.7>S-16){z=z*(S-16)/(w+z*0.7);cx.font='bold '+z+'px sans-serif';w=0;lines.forEach(function(s){w=Math.max(w,cx.measureText(s).width)})}
      var lh=z*1.2;
      t.w=w+z*0.7;t.h=lines.length*lh+z*0.4;
      if(t.bg){cx.fillStyle=t.bg;var x=t.x-t.w/2,y=t.y-t.h/2,r=z*0.3;cx.beginPath();cx.moveTo(x+r,y);cx.arcTo(x+t.w,y,x+t.w,y+t.h,r);cx.arcTo(x+t.w,y+t.h,x,y+t.h,r);cx.arcTo(x,y+t.h,x,y,r);cx.arcTo(x,y,x+t.w,y,r);cx.fill()}
      lines.forEach(function(s,k){var yy=t.y-(lines.length-1)*lh/2+k*lh;
        if(!t.bg){cx.lineWidth=z*0.14;cx.strokeStyle=(t.color==='#000000')?'#ffffff':'#000000';cx.lineJoin='round';cx.strokeText(s,t.x,yy)}
        cx.fillStyle=t.color;cx.fillText(s,t.x,yy)});
      if(!exp&&i===sel){cx.setLineDash([8,6]);cx.lineWidth=2;cx.strokeStyle='#38b0f8';cx.strokeRect(t.x-t.w/2,t.y-t.h/2,t.w,t.h);cx.setLineDash([])}
    });
  }
  function pos(ev){var r=cv.getBoundingClientRect();return {x:(ev.clientX-r.left)*S/r.width,y:(ev.clientY-r.top)*S/r.height}}
  function hit(p){for(var i=texts.length-1;i>=0;i--){var t=texts[i];if(Math.abs(p.x-t.x)<=t.w/2&&Math.abs(p.y-t.y)<=t.h/2)return i}return -1}
  function open(){
    img=null;texts=[];sel=-1;zoom=1;ox=0;oy=0;back='#1e293b';
    ov=el('div','sm-ov');
    var hd=el('div','sm-head'),cl=el('button','sm-x','\\u2715');cl.type='button';cl.onclick=close;
    var ti=el('b',null,'Create sticker'),sv=el('button','sm-save','Save');sv.type='button';hd.appendChild(cl);hd.appendChild(ti);hd.appendChild(sv);ov.appendChild(hd);
    cv=document.createElement('canvas');cv.width=S;cv.height=S;cv.className='sm-cv';cx=cv.getContext('2d');
    var wrap=el('div','sm-wrap');wrap.appendChild(cv);ov.appendChild(wrap);
    var tools=el('div','sm-tools');ov.appendChild(tools);
    var bar=el('div','sm-bar');
    var pick=el('label','sm-btn','\\ud83d\\uddbc\\ufe0f Picture');var fi=document.createElement('input');fi.type='file';fi.accept='image/*';fi.style.display='none';pick.appendChild(fi);
    var addT=el('button','sm-btn','\\uff21 Add text');addT.type='button';
    bar.appendChild(pick);bar.appendChild(addT);tools.appendChild(bar);
    var zr=el('div','sm-row');zr.appendChild(el('span','sm-l','Zoom'));var zs=document.createElement('input');zs.type='range';zs.min='100';zs.max='300';zs.value='100';zs.className='sm-rng';zr.appendChild(zs);tools.appendChild(zr);
    var back_=row('Background',COLS,false,back,function(c){back=c;draw()});tools.appendChild(back_);
    var tp=el('div','sm-text');tp.hidden=true;tools.appendChild(tp);
    var ta=document.createElement('textarea');ta.rows=2;ta.maxLength=120;ta.placeholder='Write something';ta.className='sm-ta';tp.appendChild(ta);
    tp.appendChild(row('Letters',COLS,false,null,function(c){if(sel>-1){texts[sel].color=c;draw()}}));
    tp.appendChild(row('Box behind',COLS,true,null,function(c){if(sel>-1){texts[sel].bg=c;draw()}}));
    var sr=el('div','sm-row');sr.appendChild(el('span','sm-l','Size'));var ss=document.createElement('input');ss.type='range';ss.min='24';ss.max='160';ss.value='72';ss.className='sm-rng';sr.appendChild(ss);
    var del=el('button','sm-btn sm-del','Delete text');del.type='button';sr.appendChild(del);tp.appendChild(sr);
    document.body.appendChild(ov);document.body.classList.add('sm-open');
    function showText(){tp.hidden=(sel<0);if(sel>-1){ta.value=texts[sel].t;ss.value=String(texts[sel].size)}}
    fi.onchange=function(){var f=fi.files&&fi.files[0];if(!f)return;var u=URL.createObjectURL(f),im=new Image();im.onload=function(){img=im;fit();zs.value='100';draw()};im.onerror=function(){alert('Could not open that picture.')};im.src=u};
    zs.oninput=function(){zoom=parseInt(zs.value,10)/100;draw()};
    addT.onclick=function(){texts.push({t:'Text',x:S/2,y:S/2,size:72,color:'#ffffff',bg:null});sel=texts.length-1;showText();draw();ta.focus();ta.select()};
    ta.oninput=function(){if(sel>-1){texts[sel].t=ta.value||' ';draw()}};
    ss.oninput=function(){if(sel>-1){texts[sel].size=parseInt(ss.value,10);draw()}};
    del.onclick=function(){if(sel>-1){texts.splice(sel,1);sel=-1;showText();draw()}};
    cv.addEventListener('pointerdown',function(ev){var p=pos(ev),i=hit(p);try{cv.setPointerCapture(ev.pointerId)}catch(_){}
      if(i>-1){sel=i;drag={k:'t',i:i,dx:p.x-texts[i].x,dy:p.y-texts[i].y}}
      else{sel=-1;drag={k:'i',x:p.x-ox,y:p.y-oy}}
      showText();draw();ev.preventDefault()});
    cv.addEventListener('pointermove',function(ev){if(!drag)return;var p=pos(ev);
      if(drag.k==='t'){texts[drag.i].x=p.x-drag.dx;texts[drag.i].y=p.y-drag.dy}else if(img){ox=p.x-drag.x;oy=p.y-drag.y}
      draw()});
    function up(){drag=null}cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
    sv.onclick=function(){sel=-1;draw(true);sv.disabled=true;sv.textContent='Saving\\u2026';
      cv.toBlob(function(b){if(!b){sv.disabled=false;sv.textContent='Save';alert('Could not make the sticker.');return}
        stickerAdd('image/png',b).then(function(){close();loadStickers()}).catch(function(){sv.disabled=false;sv.textContent='Save';alert('Could not save the sticker on this phone.')})},'image/png')};
    draw();
  }
  function close(){if(ov){ov.remove();ov=null}document.body.classList.remove('sm-open')}
  mk.addEventListener('click',open);
})();
`;
