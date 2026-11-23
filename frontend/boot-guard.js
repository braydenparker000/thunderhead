// Boot guard (MENU-AND-SETTINGS.md §6.8): no thStarted() in 12 s on screen, twice: a panel.
(()=>{
try{if(top!==self)return}catch{return}
var K='th.boot',R='th.repaired',U='/repair/',d=document,t,done,p,
get=k=>{try{return localStorage.getItem(k)}catch{}},
put=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);return 1}catch{}},
arm=()=>{clearTimeout(t);if(!done&&d.visibilityState=='visible')t=setTimeout(miss,12e3)},
miss=()=>{var n=(+get(K)||0)+1;done=1;if(!put(K,n)||n>1)show()},
el=(x,s)=>{var e=d.createElement(x);e.style.cssText=s;return e},
b=(x,f)=>{var e=el('button','font:inherit;padding:12px');e.textContent=x;e.onclick=f;return e};
self.thStarted=()=>{done=1;clearTimeout(t);put(K);if(p)p.remove();var r=get(R);put(R);return r};
function show(){
p=el('div','all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:24px 16px;background:Canvas;color:CanvasText;color-scheme:light dark;font:17px/1.4 system-ui');
p.id='th-boot-guard';p.role='alertdialog';p.ariaLabel='Thunderhead';
var h=el('p','margin:0'),r=b('Repair',()=>fetch(U,{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(15e3)}).then(x=>{if(!x.ok)throw 0;location.assign(U)}).catch(()=>h.textContent='Repair needs a connection.'));
h.textContent='Thunderhead didn’t start.';
p.attachShadow({mode:'open'}).append(h,r,b('Try again',()=>location.reload()));
d.documentElement.append(p);r.focus()}
d.addEventListener('visibilitychange',arm);arm()
})();
