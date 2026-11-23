// Boot guard (MENU-AND-SETTINGS.md §6.8): no thStarted() from home within 12 s on screen, twice in a row: a panel.
(function(){
try{if(top!==self)return}catch(e){return}
var K='th.boot',R='th.repaired',d=document,t=0,done=0,p;
function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
function put(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);return 1}catch(e){}}
self.thStarted=function(){done=1;clearTimeout(t);put(K);if(p)p.remove();var r=get(R);put(R);return r};
function arm(){clearTimeout(t);if(!done&&d.visibilityState=='visible')t=setTimeout(miss,12e3)}
function miss(){var n=(+get(K)||0)+1;done=1;if(!put(K,n)||n>1)show()}
function el(x,s){var e=d.createElement(x);e.style.cssText=s;return e}
function b(x,f){var e=el('button','font:inherit;padding:12px');e.type='button';e.textContent=x;e.onclick=f;return e}
function show(){
p=el('div','all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:24px 16px;background:Canvas;color:CanvasText;color-scheme:light dark;font:17px/1.4 system-ui');
p.id='th-boot-guard';p.setAttribute('role','alertdialog');p.setAttribute('aria-label','Thunderhead');
var h=el('p','margin:0'),r=b('Repair',function(){location.assign('/repair/')});
h.textContent='Thunderhead didn\u2019t start.';
p.attachShadow({mode:'open'}).append(h,r,b('Try again',function(){location.reload()}));
d.documentElement.append(p);r.focus()}
d.addEventListener('visibilitychange',arm);arm()
})();
