'use strict';
// Scientific calculator for the CBT pages: a small button in the corner opens a panel over the lower part of the screen.
// Plain page code (no outside libraries). Expressions are parsed here, never passed to eval.
module.exports = String.raw`<style>
#cbtn{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));width:48px;height:48px;border-radius:50%;border:0;background:#2a7fff;color:#fff;z-index:6;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px #0006;padding:0}
#cbtn svg{width:26px;height:26px}
#calc{position:fixed;left:0;right:0;bottom:0;height:46vh;z-index:5;background:#101a36;border-top:1px solid #ffffff33;display:none;flex-direction:column;padding:6px 8px calc(6px + env(safe-area-inset-bottom,0px));box-sizing:border-box}
body.cbo #calc{display:flex}body.cbo #cbtn{bottom:calc(46vh + 8px)}body.cbo #t{height:calc(100% - 50px - 46vh)}
#cdis{text-align:right;padding:2px 62px 4px 4px;min-height:44px;overflow:hidden}#cex{font-size:13px;opacity:.7;min-height:16px;white-space:nowrap;overflow-x:auto}#cva{font-size:26px;font-weight:700;white-space:nowrap;overflow-x:auto;font-variant-numeric:tabular-nums}
#cva sup{font-size:.62em;vertical-align:super;line-height:0}#cva .fr,#cex .fr{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 3px}#cva .fr>span,#cex .fr>span{padding:0 3px;line-height:1.15;font-size:.85em}#cva .fr>span:first-child,#cex .fr>span:first-child{border-bottom:2px solid currentColor}#cva .ov,#cex .ov{border-top:2px solid currentColor;padding:0 2px;margin-left:1px}
#ckeys{flex:1;display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:1fr;gap:4px;min-height:0}
#ckeys button{border:0;border-radius:8px;background:#1d2b57;color:#f1f5ff;font-size:15px;font-weight:600;padding:0;min-width:0}
#ckeys button.n{background:#26376c}#ckeys button.o{background:#2a7fff}#ckeys button.x{background:#5a2a3a}#ckeys button.w{grid-column:span 3}
</style><button id="cbtn" type="button" aria-label="Calculator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="3.5" rx=".8"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/></svg></button><div id="calc"><div id="cdis"><div id="cex"></div><div id="cva">0</div></div><div id="ckeys"></div></div>
<script>(function(){var K=[['DEG','','o'],['(','(','n'],[')',')','n'],['%','%','n'],['AC','','x'],['⌫','','x'],
['sin','sin(',''],['cos','cos(',''],['tan','tan(',''],['ln','ln(',''],['log','log(',''],['n!','!',''],
['sin⁻¹','asin(',''],['cos⁻¹','acos(',''],['tan⁻¹','atan(',''],['√','√(',''],['x²','^2',''],['1/x','^(-1)',''],
['7','7','n'],['8','8','n'],['9','9','n'],['÷','÷','o'],['π','π',''],['e','e',''],
['4','4','n'],['5','5','n'],['6','6','n'],['×','×','o'],['xʸ','^',''],['Ans','Ans',''],
['1','1','n'],['2','2','n'],['3','3','n'],['−','−','o'],['a/b','\u2044',''],['S\u21D4D','',''],
['0','0','n'],['.','.','n'],['+','+','o'],['=','','o w']];
var box=document.getElementById('ckeys'),ex=document.getElementById('cex'),va=document.getElementById('cva'),s='',ans=0,fresh=false,deg=true,shown=false;
K.forEach(function(k){var b=document.createElement('button');b.type='button';b.textContent=k[0];b.className=k[2];b.onclick=function(){press(k)};box.appendChild(b)});
document.getElementById('cbtn').onclick=function(){document.body.classList.toggle('cbo')};
function mt(x,i){var d=0;for(var j=i;j<x.length;j++){if(x[j]==='(')d++;else if(x[j]===')'){d--;if(!d)return j}}return x.length}
function R(x){var o='',i=0,c,m,e,n,dn,j;while(i<x.length){c=x[i];
 if(c==='\u221A'&&x[i+1]==='('){e=mt(x,i+1);o+='<span>\u221A<span class="ov">'+R(x.slice(i+2,e))+'</span></span>';i=e+1;continue}
 if(c==='^'){j=i+1;if(x[j]==='('){e=mt(x,j);n=x.slice(j+1,e);j=e+1}else{m=/^-?[0-9.]+|^[\u03C0e]|^Ans/.exec(x.slice(j));n=m?m[0]:'';j+=n.length}o+='<sup>'+R(n)+'</sup>';i=j;continue}
 if(/[0-9.]/.test(c)||c==='('){if(c==='('){e=mt(x,i);n=x.slice(i,e+1);j=e+1}else{n=/^[0-9.]+/.exec(x.slice(i))[0];j=i+n.length}
  if(x[j]==='\u2044'){j++;if(x[j]==='('){e=mt(x,j);dn=x.slice(j,e+1);j=e+1}else{m=/^[0-9.]+|^[\u03C0e]/.exec(x.slice(j));dn=m?m[0]:'';j+=dn.length}
   o+='<span class="fr"><span>'+R(n)+'</span><span>'+(dn?R(dn):'\u25AB')+'</span></span>';i=j;continue}
  if(c!=='('){o+=n;i=j;continue}}
 o+=c==='<'?'&lt;':c==='>'?'&gt;':c==='&'?'&amp;':c;i++}return o}
function draw(){va.innerHTML=s?R(s):'0';va.scrollLeft=va.scrollWidth}
function press(k){var l=k[0];
 if(l==='AC'){s='';ex.textContent='';fresh=false;return draw()}
 if(l==='⌫'){if(fresh){s='';fresh=false}else s=s.replace(/(sin|cos|tan|asin|acos|atan|ln|log|abs|exp|Ans)\($|Ans$|.$/,'');return draw()}
 if(l==='S\u21D4D'){if(!fresh||!s||s==='Error')return;if(s.indexOf('\u2044')>-1){var r0=calc(s);if(r0!==null)s=fmt(r0)}else{var f=frac(ans);if(f)s=f}return draw()}
 if(l==='DEG'||l==='RAD'){deg=!deg;box.children[0].textContent=deg?'DEG':'RAD';return}
 if(l==='='){if(!s)return;var r=calc(s);ex.innerHTML=R(s)+' =';if(r===null){s='Error';fresh=true}else{ans=r;s=fmt(r);fresh=true}return draw()}
 var t=k[1];
 if(fresh){fresh=false;if(/^[0-9.(π]|^[a-z]/.test(t)&&!/^(\^|!|%)/.test(t)){s=''}else if(s==='Error')s=''}
 s+=t;draw()}
function frac(v){if(!isFinite(v)||v===Math.floor(v))return null;var sg=v<0?'\u2212':'',a=Math.abs(v),h1=1,h0=0,k1=0,k0=1,b=a,i;for(i=0;i<20;i++){var f=Math.floor(b),h=f*h1+h0,k=f*k1+k0;h0=h1;h1=h;k0=k1;k1=k;if(k1>10000)return null;if(Math.abs(a-h1/k1)<1e-10*Math.max(1,a))return sg+h1+'\u2044'+k1;if(b===f)break;b=1/(b-f)}return null}
function fmt(r){if(!isFinite(r))return 'Error';var x=Number(r.toPrecision(12));var o=String(x);if(o.indexOf('e')>-1)o=x.toExponential(8).replace(/\.?0+e/,'e');return o.replace('-','−')}
function calc(src){try{var v=parse(src);return isFinite(v)?v:null}catch(e){return null}}
function parse(src){
 var q=src.replace(/([0-9.]+|\([^()]*\))\u2044([0-9.]+|[\u03C0e]|\([^()]*\))/g,'($1)/($2)').replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/π/g,'pi').replace(/√/g,'sqrt'),T=[],m,re=/\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|[A-Za-z]+|[-+*\/^()!%])/y,i=0;
 while(i<q.length){re.lastIndex=i;m=re.exec(q);if(!m)throw 1;i=re.lastIndex;T.push(m[1])}
 var isN=function(t){return /^[0-9.]/.test(t)},isId=function(t){return /^[A-Za-z]/.test(t)},U=[];
 T.forEach(function(t,j){var p=U[U.length-1];if(p!==undefined&&(isN(p)||p===')'||p==='!'||p==='%'||p==='pi'||p==='e'||p==='Ans')&&(t==='('||isN(t)||isId(t)))U.push('*');U.push(t)});
 var p=0,FN={sin:1,cos:1,tan:1,asin:1,acos:1,atan:1,ln:1,log:1,sqrt:1,abs:1,exp:1};
 function peek(){return U[p]}function eat(){return U[p++]}
 function expr(){var v=term();while(peek()==='+'||peek()==='-'){var o=eat(),r=term();v=o==='+'?v+r:v-r}return v}
 function term(){var v=unary();while(peek()==='*'||peek()==='/'){var o=eat(),r=unary();v=o==='*'?v*r:v/r}return v}
 function unary(){if(peek()==='-'){eat();return -unary()}if(peek()==='+'){eat();return unary()}return pow()}
 function pow(){var b=post();if(peek()==='^'){eat();var e=unary();return Math.pow(b,e)}return b}
 function post(){var v=atom();while(peek()==='!'||peek()==='%'){if(eat()==='!')v=fact(v);else v=v/100}return v}
 function atom(){var t=eat();if(t===undefined)throw 1;
  if(isN(t))return parseFloat(t);
  if(t==='('){var v=expr();if(peek()===')')eat();return v}
  if(t==='pi')return Math.PI;if(t==='e')return Math.E;if(t==='Ans')return ans;
  if(FN[t]){if(eat()!=='(')throw 1;var a=expr();if(peek()===')')eat();return fn(t,a)}
  throw 1}
 function fn(n,a){var r=deg?Math.PI/180:1;
  switch(n){case'sin':return fixd(Math.sin(a*r));case'cos':return fixd(Math.cos(a*r));case'tan':return fixd(Math.tan(a*r));
  case'asin':return Math.asin(a)/r;case'acos':return Math.acos(a)/r;case'atan':return Math.atan(a)/r;
  case'ln':return Math.log(a);case'log':return Math.log10(a);case'sqrt':return Math.sqrt(a);case'abs':return Math.abs(a);case'exp':return Math.exp(a)}}
 function fixd(x){return Math.abs(x)<1e-14?0:Number(x.toPrecision(14))}
 function fact(n){if(n<0||n!==Math.floor(n)||n>170)throw 1;var r=1;for(var k=2;k<=n;k++)r*=k;return r}
 var res=expr();if(p<U.length)throw 1;return res}
})()</script>`;
