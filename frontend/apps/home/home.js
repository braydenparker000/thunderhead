// Thunderhead home: one quiet chat screen. Hold still for the Compass ring, swipe right for the briefing, swipe left for the menu.
// The ring's apps come from the app registry (th/registry/apps.js, EXTENDING.md rule 3).
import { apps } from '/th/registry/apps.js';
import { from as launchFrom, launch } from '/ui/launch.js';
import { startPinned } from './pinned.js';
(function(){
  const $=s=>document.querySelector(s), root=document.documentElement;
  const edge=$('#edge'), toastEl=$('#toast'); let tt;
  const toast=m=>{toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>toastEl.classList.remove('show'),1700)};
  const buzz=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
  try{$('#date').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})}catch(e){}

  // Day or night: Auto follows the clock, Day or Night sticks (theme.js applied it before the first
  // paint). Settings → Appearance (apps/settings/appearance.js) and the shell.appearance verb both
  // change it through th:theme; text size and a still background live there too.
  function setTheme(p){ const hr=new Date().getHours(); root.dataset.theme=p==='auto'?((hr>=19||hr<7)?'dark':'light'):p; try{localStorage.setItem('th-theme',p)}catch(e){} }
  document.addEventListener('th:theme',e=>{ if(['auto','light','dark'].includes(e.detail)) setTheme(e.detail) });
  // Offline is said once, on the date line ("· Offline", th/chat), and each waiting message says it
  // will send when back (audit fix 10: the pill made it three).
  try{$('#bdate').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'})}catch(e){}

  // Signed in, a row or item that does something itself drops its data-toast.
  document.querySelectorAll('[data-toast]').forEach(b=>b.addEventListener('click',()=>b.dataset.toast&&toast(b.dataset.toast)));

  // + folds the options sheet up out of the ask bar
  const ask=$('#ask'), q=$('#q'), convo=$('#convo'), hint=$('#hint'), opts=$('#opts'), plus=$('#plus');
  startPinned();
  // The gesture hint retires once the ring has opened 3 times and the Briefing and the menu were each
  // swiped open once (HOME.md §10; audit fix 11), counted on this phone.
  const HINT='th-hint'; let learnt={ring:0,brief:0,side:0}; try{ learnt={...learnt,...JSON.parse(localStorage.getItem(HINT)||'{}')} }catch(e){}
  const known=()=>learnt.ring>=3&&learnt.brief>=1&&learnt.side>=1;
  const learn=k=>{ learnt[k]=(learnt[k]||0)+1; try{ localStorage.setItem(HINT,JSON.stringify(learnt)) }catch(e){} if(known()) hint.classList.add('gone') };
  if(known()) hint.classList.add('gone');
  function menu(on){ opts.classList.toggle('show',on); $('#home').classList.toggle('menuOpen',on); ask.classList.toggle('menu',on); plus.setAttribute('aria-expanded',on) }
  plus.addEventListener('click',()=>{ menu(!opts.classList.contains('show')); buzz(6) });
  opts.addEventListener('click',e=>{ if(e.target.closest('button')) menu(false) });
  document.addEventListener('pointerdown',e=>{ if(opts.classList.contains('show')&&!e.target.closest('#opts,#plus')) menu(false) });

  // asking (scripted examples only); the mic is on only while it's lit
  q.addEventListener('input',()=>ask.classList.toggle('typing',q.value.trim()!==''||ask.classList.contains('hasfiles')));
  // What you were writing survives closing the app: kept on this phone as you type, gone once sent
  // (and with everything else of yours at sign-out: th.p.*).
  const DRAFT='th.p.draft';
  try{ const d=localStorage.getItem(DRAFT); if(d&&!q.value){ q.value=d; ask.classList.add('typing') } }catch(e){}
  const keepDraft=()=>{ try{ q.value.trim()?localStorage.setItem(DRAFT,q.value):localStorage.removeItem(DRAFT) }catch(e){} };
  q.addEventListener('input',keepDraft); ask.addEventListener('submit',()=>setTimeout(keepDraft));
  // Enter sends (the line break a phone's keyboard asks for, whatever its key code); Shift+Enter on a
  // keyboard starts a new line, and pasted lines stay.
  let newLine=false;
  q.addEventListener('keydown',e=>{ newLine=e.key==='Enter'&&e.shiftKey });
  q.addEventListener('beforeinput',e=>{ if((e.inputType==='insertLineBreak'||e.inputType==='insertParagraph')&&!newLine){ e.preventDefault(); ask.requestSubmit() } });
  // The conversation ends above the bar, however tall it has grown, and stays at its newest turn
  // while the bar grows or the keyboard opens (the page resizes to the keyboard: interactive-widget).
  let atEnd=true; convo.addEventListener('scroll',()=>{ atEnd=convo.scrollHeight-convo.scrollTop-convo.clientHeight<24 },{passive:true});
  const keep=new ResizeObserver(()=>{ document.documentElement.style.setProperty('--ask-h',ask.offsetHeight+'px'); if(atEnd) convo.scrollTop=convo.scrollHeight });
  keep.observe(ask); keep.observe(convo);
  // The styles for what only shows after a tap or a pull, once the first paint is done.
  requestAnimationFrame(()=>setTimeout(()=>{ for(const href of ['/th/reply/tools.css','/th/attach/attach.css']){ const l=document.createElement('link'); l.rel='stylesheet'; l.href=href; document.head.append(l) } }));
  // Find in today (HOME.md §4.10): at the top of the conversation, pull down 64 px and let go.
  const pullEl=document.createElement('div'); pullEl.className='pullfind'; pullEl.setAttribute('aria-hidden','true'); pullEl.textContent='Find in today'; convo.parentElement.append(pullEl);
  let pull=null;
  const pullShow=d=>{ const k=Math.min(1,d/64); pullEl.style.opacity=String(k); pullEl.style.transform=`translate(-50%,${-12+k*12}px)`; pullEl.classList.toggle('ready',k>=1) };
  convo.addEventListener('touchstart',e=>{ pull=convo.scrollTop<=0&&e.touches.length===1&&!e.target.closest('input,textarea')?{y:e.touches[0].clientY,d:0}:null },{passive:true});
  convo.addEventListener('touchmove',e=>{ if(!pull) return; pull.d=e.touches[0].clientY-pull.y; if(pull.d<0||convo.scrollTop>0){ pull=null; pullShow(0); return } pullShow(pull.d) },{passive:true});
  convo.addEventListener('touchend',()=>{ if(pull&&pull.d>=64) import('/th/reply/find.js').then(f=>f.openFind()); pull=null; pullShow(0) },{passive:true});
  // Signed out the mic only says so; signed in it records a voice memo (th/chat/index.js).
  $('#mic').addEventListener('click',()=>toast('Voice memos come with sign-in'));
  ask.addEventListener('submit',e=>{
    e.preventDefault(); if(root.dataset.signedIn!==undefined){ if(root.dataset.chat==='failed') toast("Couldn't load the conversation. Reload to try again."); return; } // signed in: th/chat/index.js sends it
    const text=q.value.trim(); if(!text) return; q.value=''; ask.classList.remove('typing'); hint.classList.add('gone');
    const t=document.createElement('div'); t.className='turn';
    t.innerHTML='<div class="you"></div><div class="reply"></div>'; t.firstChild.textContent=text; $('#turns').appendChild(t);
    convo.scrollTop=convo.scrollHeight;
    edge.classList.add('think'); edge.classList.remove('breathe');
    const a="I'm not connected yet. Sign-in and my memory come next.";
    setTimeout(()=>{ edge.classList.remove('think'); edge.classList.add('breathe'); const r=t.querySelector('.reply'); let i=0;
      (function step(){ r.textContent=a.slice(0,i+=2); convo.scrollTop=convo.scrollHeight;
        if(i<a.length) return requestAnimationFrame(step);      })() },1100);
  });

  // Compass: hold an empty spot ~220 ms, a tight ring of apps springs out around the finger; slide toward one, let go to open.
  // Seven directions, clockwise from the top; an app not shipped yet (Photos) says it comes later. Each app keeps its own
  // glass disc (owner, 2026-10-31); the chosen one is drawn by fading layers in it (home.css), never by repainting under its blur.
  const APPS=apps.map(a=>[a.name,`<span class="fill" aria-hidden="true"></span><svg class="i ph" aria-hidden="true"><use href="/ui/icons.svg#${a.icon}-bold"/></svg><svg class="i ph on" aria-hidden="true"><use href="/ui/icons.svg#${a.icon}-bold"/></svg>`,a.color,a.built?a.path:'']);
  // A choice holds until the finger is ~7 degrees past its sector's edge, whatever the number of apps (GESTURES.md §3.2).
  // Direction is measured from where the thumb went down, not from the ring's drawn centre: near an edge the ring
  // moves inward to fit, and measuring from there made a straight swipe up pick the wrong app (owner, 2026-10-31).
  const N=APPS.length, SEC=Math.PI*2/N, HOLD=.5+7*N/360;
  const ring=$('#ring'), scrim=$('#scrim'), lbl=$('#lbl'), hub=$('#hub'), press=$('#press'), app=$('#app'), R=62;
  const pets=APPS.map(([n,svg,c],i)=>{const p=document.createElement('div');p.className='pet';p.innerHTML=svg;p.title=n;p.style.setProperty('--c',c);p.style.setProperty('--i',i);ring.appendChild(p);return p});
  let start=null, open=false, dir=-1, holdT=null;
  const blocked=el=>el.closest('button,input,textarea,form,.chip,.card,.note,.you,.reply,.opts');
  function place(x,y){ const r=app.getBoundingClientRect(); const m=R+30;
    const cx=Math.min(Math.max(x-r.left,m),r.width-m), cy=Math.min(Math.max(y-r.top,m+30),r.height-m-40);
    ring.style.left=cx+'px'; ring.style.top=cy+'px';
    lbl.style.top=(R+30)+'px'; return {cx:cx+r.left,cy:cy+r.top} }
  // Out on the spring; the chosen disc swells a little and the others ease back (transform only: the compositor's).
  const at=(i,k)=>`translate(${R*Math.sin(i*SEC)}px,${-R*Math.cos(i*SEC)}px) scale(${k})`;
  function fan(on){ pets.forEach((p,i)=>{ p.style.transform=on?at(i,1):'translate(0,0) scale(.2)' }) }
  function setDir(d){ if(d===dir) return; dir=d; pets.forEach((p,i)=>{ p.classList.toggle('on',i===d); p.style.transform=at(i,d<0?1:i===d?1.12:.94) }); ring.classList.toggle('active',d>=0);
    // The name glides in rather than popping: the label keeps its place and its text crossfades up.
    if(d>=0){ lbl.textContent=APPS[d][0]; lbl.style.setProperty('--c',APPS[d][2]); lbl.classList.remove('swap'); void lbl.offsetWidth; lbl.classList.add('swap') } lbl.classList.toggle('show',d>=0); if(d>=0) buzz(8) }
  function dirOf(dx,dy){ const dist=Math.hypot(dx,dy); if(dist<12) return -1; if(dir<0&&dist<18) return -1;
    const a=(Math.atan2(dx,-dy)/SEC+N)%N, n=Math.round(a)%N;
    if(dir>=0&&n!==dir){ const off=Math.abs(((a-dir+N*1.5)%N)-N/2); if(off<HOLD) return dir } // stays put until ~7 degrees past the boundary
    return n }
  const home=$('#home'), brief=$('#brief'), side=$('#side'), dim=$('#dim');
  let view='home', swipe=null, swiped=false;
  function setPos(b,s,anim,ms){ const W=app.clientWidth, S=side.offsetWidth;
    [home,brief,side,dim].forEach(el=>{ el.style.transition=anim?'':'none'; el.style.transitionDuration=anim&&ms?ms+'ms':'' });
    brief.style.transform=`translateX(${(b-1)*W}px)`; home.style.transform=s>0?`translateX(${-s*S*.12}px) scale(${1-.07*Math.min(1,s)})`:`translateX(${b*W}px)`; home.style.borderRadius=s>0?`${Math.round(30*Math.min(1,s))}px`:'';
    side.style.transform=`translateX(${(1-s)*100}%)`; dim.style.opacity=Math.min(1,s); side.classList.toggle('open',s>0); dim.style.pointerEvents=s>.5?'auto':'none' }
  // The menu's rows ripple in each time it opens; the Briefing's tiles cascade (DESIGN-SYSTEM.md §8).
  function enter(el){ [...el.querySelectorAll(':scope .sidescroll>:not(#convos), :scope #convos>*, :scope .grid>*')].forEach((c,i)=>c.style.setProperty('--k',String(Math.min(i,10)))); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); clearTimeout(el._enter); el._enter=setTimeout(()=>el.classList.remove('enter'),900) }
  // Only the place in view takes focus or taps; the others are inert (audit fix 5).
  function inertAll(){ home.inert=view!=='home'; brief.inert=view!=='brief'; side.inert=view!=='side' }
  function go(v,ms){ const was=view; view=v; setPos(v==='brief'?1:0,v==='side'?1:0,true,ms); inertAll(); if(v!=='home') menu(false); if(v!==was&&v==='side') enter(side); if(v!==was&&v==='brief') enter(brief) }
  inertAll();
  // Every gesture has a button (GESTURES.md §9): Apps, Briefing and Menu, first in the focus order and
  // shown only when focused; the Briefing's Back home; Escape returns home. The ring by keyboard:
  // it opens in the middle, the arrows move round it, Enter opens the app, Escape closes it.
  $('.skips').addEventListener('click',e=>{ const b=e.target.closest('[data-skip]'); if(!b) return; const k=b.dataset.skip; if(k==='apps') keyRing(); else go(k) });
  $('#bback').addEventListener('click',()=>go('home'));
  // Escape inside a field, a sheet or a page is theirs (search leaves search, a page closes itself).
  document.addEventListener('keydown',e=>{ if(e.key!=='Escape'||open||e.defaultPrevented) return; if(e.target.closest?.('input,textarea')||side.classList.contains('searching')||document.querySelector('.spage, .csheet, .holdsheet, .remind')) return; if(view!=='home') go('home') });
  dim.addEventListener('click',()=>go('home'));
  document.addEventListener('th:go',e=>go(e.detail)); // settings pages return to the open menu
  app.addEventListener('click',e=>{ if(swiped){ e.stopPropagation(); e.preventDefault() } },true);
  app.addEventListener('pointerdown',e=>{ if(!e.isPrimary||e.target.closest('input,textarea')) return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId,t:performance.now(),el:e.target}; swipe=null;
    if(view!=='home'||blocked(e.target)||opts.classList.contains('show')) return;
    const r=app.getBoundingClientRect(); press.style.left=(e.clientX-r.left)+'px'; press.style.top=(e.clientY-r.top)+'px'; press.classList.remove('on'); void press.offsetWidth; press.classList.add('on');
    holdT=setTimeout(()=>{ press.classList.remove('on'); const c=place(start.x,start.y); start.cx=c.cx; start.cy=c.cy; open=true; hint.classList.add('gone'); learn('ring'); ring.classList.remove('closing'); ring.classList.add('show'); scrim.classList.add('show'); requestAnimationFrame(()=>fan(true)); buzz(6) },220) });
  window.addEventListener('pointermove',e=>{ if(!start||e.pointerId!==start.id) return;
    if(!open){ const mx=e.clientX-start.x, my=e.clientY-start.y, d=Math.hypot(mx,my);
      // Sideways is ours from 6 px, before Chrome's own slop (8 dp) can hand the touch to a scroller;
      // anything else is the scroller's once it passes the 10 px hold slop.
      // A leftward drag that starts on a conversation row is the row's own (its Pin and Summary).
      if(!swipe&&view==='side'&&mx<0&&d>=6&&start.el.closest&&start.el.closest('#convos .row.thr')){ start=null; return }
      if(!swipe){ if(d>=6&&Math.abs(mx)>Math.abs(my)){ clearTimeout(holdT); press.classList.remove('on'); swipe={from:view,b:view==='brief'?1:0,s:view==='side'?1:0,v:[]} }
        else { if(d>10){ clearTimeout(holdT); press.classList.remove('on'); start=null } return } }
      e.preventDefault(); swipe.v.push([e.timeStamp,e.clientX]); if(swipe.v.length>8) swipe.v.shift();
      const W=app.clientWidth, S=side.offsetWidth;
      // Past the end a page stretches a little and springs back on release (a rubber band).
      const band=v=>v<=1?Math.max(0,v):1+(v-1)*.22/(1+(v-1)*2);
      if(swipe.from==='home'){ swipe.b=mx>0?band(mx/W):0; swipe.s=mx<0?band(-mx/S):0 }
      else if(swipe.from==='brief') swipe.b=band(1+mx/W);
      else swipe.s=band(1-mx/S);
      setPos(swipe.b,swipe.s,false); return }
    e.preventDefault(); const dx=e.clientX-start.x, dy=e.clientY-start.y, d=Math.hypot(dx,dy), k=Math.min(1,R*.55/(d||1));
    hub.style.transform=`translate(${dx*k}px,${dy*k}px)`; setDir(dirOf(dx,dy)) },{passive:false});
  // The finger's speed over its last 100 ms (px/ms, + is rightward); 0 if it stopped before lifting.
  function flick(v,at){ const last=v[v.length-1]; if(!last||at-last[0]>60) return 0; const first=v.find(p=>last[0]-p[0]<=100)||last; return last[0]>first[0]?(last[1]-first[1])/(last[0]-first[0]):0 }
  // A swipe commits at 28% of its travel or a flick of 0.45 px/ms its way (GESTURES.md §4).
  // A flick finishes at the finger's speed (the spring's settle is about 1.8 times the straight run),
  // between 180 and 460 ms; a commit ticks once.
  function endSwipe(at){ const {from,b,s}=swipe, v=at===undefined?0:flick(swipe.v,at), F=.45; swipe=null; swiped=true; setTimeout(()=>swiped=false,60);
    const to=from==='home'?(b>0&&(v>F||b>.28&&v>=-F)?'brief':s>0&&(v<-F||s>.28&&v<=F)?'side':'home')
      :from==='brief'?(v<-F||b<.72&&v<=F?'home':'brief'):(v>F||s<.72&&v>=-F?'home':'side');
    const left=to==='brief'||from==='brief'?Math.abs((to==='brief'?1:0)-b)*app.clientWidth:Math.abs((to==='side'?1:0)-s)*side.offsetWidth;
    go(to,Math.abs(v)>F?Math.round(Math.min(460,Math.max(180,left/Math.abs(v)*1.8))):undefined);
    if(to!==from){ buzz(5); if(to==='brief'||to==='side') learn(to) } }
  function close(commit){ clearTimeout(holdT); press.classList.remove('on');
    if(open){ const chosen=commit?dir:-1; scrim.classList.remove('show'); hub.style.transform='translate(0,0)';
      if(chosen>=0){ const p=pets[chosen], a=chosen*SEC; p.classList.add('go'); p.style.transform=`translate(${R*1.25*Math.sin(a)}px,${-R*1.25*Math.cos(a)}px) scale(1.7)`; buzz([12,40,12]); const to=APPS[chosen][3]; if(to){ const r=p.getBoundingClientRect(); launchFrom(r.left+r.width/2,r.top+r.height/2); launch(APPS[chosen][2]).then(()=>location.assign(to)) } else toast(APPS[chosen][0]+' comes later') }
      ring.classList.add('closing'); pets.forEach((p,i)=>{ if(i!==chosen) p.style.transform='translate(0,0) scale(.2)' });
      setTimeout(()=>{ ring.classList.remove('show','closing','active'); pets.forEach(p=>{p.classList.remove('go','on')}); fan(false) },230);
      dir=-1; lbl.classList.remove('show') }
    open=false; start=null }
  window.addEventListener('pointerup',e=>{ if(start&&e.pointerId===start.id){ if(swipe) endSwipe(e.timeStamp); close(true) } });
  function keyRing(){ if(open) return; const r=app.getBoundingClientRect(); place(r.left+r.width/2,r.top+r.height/2); open=true; hint.classList.add('gone'); ring.classList.remove('closing'); ring.classList.add('show'); scrim.classList.add('show'); requestAnimationFrame(()=>{ fan(true); setDir(0) });
    const keys=e=>{ if(e.key==='ArrowRight'||e.key==='ArrowDown'){ e.preventDefault(); setDir((dir+1)%N) } else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ e.preventDefault(); setDir((dir-1+N)%N) }
      else if(e.key==='Enter'||e.key===' '){ e.preventDefault(); done(true) } else if(e.key==='Escape'||e.key==='Tab'){ e.preventDefault(); done(false) } };
    const done=c=>{ document.removeEventListener('keydown',keys,true); close(c) };
    document.addEventListener('keydown',keys,true) }
  window.addEventListener('pointercancel',()=>{ if(swipe) endSwipe(); close(false) });
  app.addEventListener('contextmenu',e=>e.preventDefault());
  app.addEventListener('touchmove',e=>{ if(open||swipe) e.preventDefault() },{passive:false});
})();
