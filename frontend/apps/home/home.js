// Thunderhead home: one quiet chat screen. Hold still for the Compass ring, swipe right for the briefing, swipe left for the menu.
// The ring's apps come from the app registry (th/registry/apps.js, EXTENDING.md rule 3).
import { apps } from '/th/registry/apps.js';
import { from as launchFrom, launch } from '/ui/launch.js';
import { startPinned } from './pinned.js';
import { animator, springs, haptic, motionReduced, response, restTime } from '/th/motion.js';

// Music and Podcasts open as a layer inside home and keep playing behind the chat (th/island); the
// others load in their place. The reveal starts at once; the layer's code loads while it grows.
function openFromRing(id,color,to){
  const cover=launch(color);
  const away=()=>cover.then(()=>location.assign(to));
  import('/th/island/island.js').then(m=>m.openApp(id,{cover:()=>cover})).then(ok=>ok||away(),away);
}
(function(){
  const $=s=>document.querySelector(s), root=document.documentElement;
  const edge=$('#edge'), toastEl=$('#toast'); let tt;
  const toast=m=>{toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>toastEl.classList.remove('show'),1700)};
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
  const learn=k=>{ if(known()) return; learnt[k]=(learnt[k]||0)+1; try{ localStorage.setItem(HINT,JSON.stringify(learnt)) }catch(e){} if(known()) hint.classList.add('gone') };
  if(known()) hint.classList.add('gone');
  function menu(on){ opts.classList.toggle('show',on); $('#home').classList.toggle('menuOpen',on); ask.classList.toggle('menu',on); plus.setAttribute('aria-expanded',on) }
  plus.addEventListener('click',()=>{ menu(!opts.classList.contains('show')); haptic('open') });
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
  // Seven directions, clockwise from the top; an app not shipped yet (Photos) says it comes later.
  // Motion (GESTURES.md §3): what moves in space springs past its mark (the discs fly ~13% past the ring and magnet back,
  // growing .2 → 1.06 → 1); fades never overshoot. The flight out is the springs' own curve played by the compositor
  // (nothing for the page to do each frame); a choice or a release mid-flight hands it to the th/motion.js engine at
  // exactly the position and speed it had. Each disc's frosted glass (::before) fades in on --d-fast once the discs are
  // 85% of the way out and slowing, so it is in place as they settle, and fades out with them. The chosen disc lifts on a
  // soft shadow once it rests; the name fades up under the ring. Only transform and opacity change; the disc itself never
  // fades, so its glass always sees what is behind it.
  const APPS=apps.map(a=>[a.name,`<span class="lift" aria-hidden="true"></span><span class="face" aria-hidden="true"><span class="fill"></span><svg class="i ph"><use href="/ui/icons.svg#${a.icon}-fill"/></svg><svg class="i ph on"><use href="/ui/icons.svg#${a.icon}-fill"/></svg></span>`,a.color,a.built?a.path:'']);
  // A choice holds until the finger is ~7 degrees past its sector's edge, whatever the number of apps (GESTURES.md §3.2).
  // Direction is measured from where the thumb went down, not from the ring's drawn centre: near an edge the ring
  // moves inward to fit, and measuring from there made a straight swipe up pick the wrong app (owner, 2026-10-31).
  const N=APPS.length, SEC=Math.PI*2/N, HOLD=.5+7*N/360;
  const ring=$('#ring'), scrim=$('#scrim'), lbl=$('#lbl'), hub=$('#hub'), press=$('#press'), app=$('#app'), R=62;
  const pets=APPS.map(([n,svg,c])=>{const p=document.createElement('div');p.className='pet';p.innerHTML=svg;p.title=n;p.style.setProperty('--c',c);ring.appendChild(p);return p});
  // The name that is leaving fades up and out while the new one fades up into its place.
  const ghost=document.createElement('div'); ghost.className='lbl ghost'; ghost.setAttribute('aria-hidden','true'); ring.appendChild(ghost);
  let start=null, open=false, dir=-1, holdT=null;
  let ringRun=0, opening=false, peak=0, look={fast:160,quick:240,ease:'ease-out'}, flight=null;
  const petMotion=pets.map((p,i)=>{
    const x=R*Math.sin(i*SEC), y=-R*Math.cos(i*SEC);
    // Three springs share one transform: it is written once a frame, after they have all stepped.
    let queued=false;
    const write=()=>{queued=false;const r=radial.value;p.style.transform=`translate(${x*r}px,${y*r}px) scale(${size.value+choice.value})`};
    const draw=()=>{if(!queued){queued=true;queueMicrotask(write)}};
    const radial=animator((v,speed)=>{draw();if(i===0)glassy(v,speed)},{unit:'scalar'}), size=animator(draw,{unit:'scalar'}), choice=animator(draw,{unit:'scalar'});
    const faceEl=p.querySelector('.face'), face=animator(v=>{faceEl.style.opacity=String(Math.max(0,Math.min(1,v)))},{unit:'opacity'});
    size.set(.2);
    return {x,y,faceEl,write,radial,size,choice,face};
  });
  // The glass starts to fade in as the discs pass 85% of the way out with their speed falling (GESTURES.md §3).
  function glassy(v,speed){ if(!opening) return; peak=Math.max(peak,speed); if(v>=.85&&(speed<peak||speed===0)){ opening=false; ring.classList.add('glassy') } }
  const engines=()=>petMotion.flatMap(m=>[m.radial,m.size,m.choice,m.face]);
  const petsRest=()=>Promise.all(engines().map(m=>m.whenResting()));
  function ringMoving(){ ring.classList.toggle('moving',!!flight||engines().some(m=>!m.resting)) }
  function settleRing(run){ ringMoving(); petsRest().then(()=>{if(run===ringRun)ringMoving()}) }
  // Behind the ring and the open menu the field holds still (home.css .hush): nothing under their glass changes,
  // so once they rest no frame is drawn at all.
  function hush(){ app.classList.toggle('hush',ring.classList.contains('show')||view==='side') }
  function showRing(){ ++ringRun; ground(); pets.forEach(p=>p.classList.remove('go','on','lifted')); ring.classList.remove('glassy'); ring.classList.add('show'); scrim.classList.add('show'); hush() }
  // Start at the hold deadline: all seven share the same frame, without a CSS stagger.
  function openFan(keyboard=false){ fan();if(keyboard&&dir<0)setDir(0) }
  const blocked=el=>el.closest('button,input,textarea,form,.chip,.card,.note,.you,.reply,.opts');
  // The ring keeps clear of the edges at its overshoot: 1.13 R plus half a disc at 1.06.
  function place(x,y){ const r=app.getBoundingClientRect(); const m=R+36;
    const cx=Math.min(Math.max(x-r.left,m),r.width-m), cy=Math.min(Math.max(y-r.top,m+30),r.height-m-40);
    ring.style.left=cx+'px'; ring.style.top=cy+'px';
    lbl.style.top=ghost.style.top=(R+34)+'px'; return {cx:cx+r.left,cy:cy+r.top} }
  // The motion tokens, read off the hold's path (after the first paint, then whenever the ring has closed), so the
  // hold's own frame forces no style.
  function tokens(){ const css=getComputedStyle(root), ms=n=>parseFloat(css.getPropertyValue(n))||0;
    look={fast:ms('--d-fast'),quick:ms('--d-quick'),ease:css.getPropertyValue('--ease-out').trim()||'ease-out'}; if(!motionReduced()) flightFx() }
  function fan(){ opening=true; peak=0;
    if(motionReduced()){ petMotion.forEach(m=>{m.radial.to(1,{spring:springs.pop});m.size.to(1,{spring:springs.lift});m.choice.to(0,{spring:springs.pop});m.face.to(1,{spring:springs.fade})}); settleRing(ringRun); return }
    const run=ringRun, fx=flightFx(); petMotion.forEach(m=>m.face.set(1));
    // Started at the hold's own time, not at the first frame that shows them, so the flight keeps its clock.
    const t0=document.timeline.currentTime, anims=fx.effects.map(e=>{ const a=new Animation(e,document.timeline); if(t0==null) a.play(); else a.startTime=t0; return a });
    flight={run,anims,glass:setTimeout(()=>{ if(flight?.run===run){ opening=false; ring.classList.add('glassy') } },fx.at85)};
    ringMoving();
    // The flight is over when the discs' paths are (the fades end well before).
    Promise.all(anims.filter((a,k)=>k%2===0).map(a=>a.finished)).then(()=>{ if(flight?.run===run) land(1) },()=>{});
  }
  // The flight out as compositor animations: both springs sampled every 12 ms from rest, all seven on one clock. The glass
  // comes in as they pass 85% of the way out (slowing by then: the spring's speed peaks near 42%). Each disc fades in whole
  // before that, and its fade then ends (no fill): a disc with an opacity animation on it is drawn on its own surface, and
  // its glass would blur only the disc. Built off the hold's path (idle, and after each close) and kept while the springs
  // and tokens are the same, so the hold's frame only starts them.
  let built=null;
  function flightFx(){ const key=JSON.stringify([springs.pop,springs.lift,look.ease]); if(built?.key===key) return built;
    const rest={pop:restTime(springs.pop),lift:restTime(springs.lift)}, T=Math.max(rest.pop,rest.lift), grid=[];
    const at=(n,ms)=>ms>=rest[n]?1:response(springs[n],ms/1000).value;
    for(let ms=0;ms<T;ms+=12) grid.push(ms); grid.push(T);
    const r=grid.map(ms=>at('pop',ms)), z=grid.map(ms=>.2+.8*at('lift',ms));
    let at85=0; while(at('pop',at85)<.85&&at85<T) at85++;
    const effects=petMotion.flatMap((m,i)=>[new KeyframeEffect(pets[i],grid.map((ms,k)=>({offset:ms/T,transform:`translate(${m.x*r[k]}px,${m.y*r[k]}px) scale(${z[k]})`})),{duration:T,fill:'forwards'}),
      new KeyframeEffect(pets[i],[{opacity:0},{opacity:1}],{duration:Math.round(at85*.8),easing:look.ease})]);
    return built={key,effects,at85} }
  // The flight ends, or a choice or release takes it over: the engine carries on from where the discs are, at their speed.
  function land(done){ if(!flight) return; const t=done?Infinity:(flight.anims[0].currentTime??0)/1000;
    const at=n=>t===Infinity?{value:1,velocity:0}:response(springs[n],t), r=at('pop'), z=at('lift'), f=done?1:Number(getComputedStyle(pets[0]).opacity);
    petMotion.forEach(m=>{ m.radial.set(r.value); m.size.set(.2+.8*z.value); m.face.set(f); m.write();
      if(!done){ m.radial.to(1,{spring:springs.pop,velocity:r.velocity}); m.size.to(1,{spring:springs.lift,velocity:.8*z.velocity}); m.face.to(1,{spring:springs.fade}) } });
    ground(); settleRing(ringRun) }
  function ground(){ if(!flight) return; clearTimeout(flight.glass); flight.anims.forEach(a=>a.cancel()); flight=null }
  function setDir(d){ if(d===dir) return; land(0); dir=d; const run=++ringRun; ring.classList.toggle('active',d>=0);
    const dimmed=root.dataset.theme==='dark'?.6:.55;
    pets.forEach((p,i)=>{ p.classList.toggle('on',i===d); p.classList.remove('lifted'); petMotion[i].choice.to(d<0?0:i===d?.12:-.06,{spring:springs.pop}); petMotion[i].face.to(d<0||i===d?1:dimmed,{spring:springs.fade}) });
    settleRing(run);
    // The chosen disc lifts on its shadow only once it has come to rest.
    if(d>=0) petMotion[d].choice.whenResting().then(()=>{ if(dir===d&&open) pets[d].classList.add('lifted') });
    name(d); if(d>=0) haptic('choose') }
  // The name under the ring: the new one fades up into place, the old one fades on up and out (compositor only).
  function name(d){ const was=lbl.classList.contains('show')?lbl.textContent:'', next=d>=0?APPS[d][0]:'';
    if(was===next) return;
    const rise=(el,keys,ms)=>{ try{ el.animate(keys,{duration:ms,easing:look.ease}) }catch(e){} };
    if(was){ ghost.textContent=was; ghost.style.setProperty('--c',lbl.style.getPropertyValue('--c')); rise(ghost,[{opacity:1,transform:'translate(-50%,0)'},{opacity:0,transform:'translate(-50%,-6px)'}],look.fast) }
    lbl.classList.toggle('show',d>=0);
    if(d>=0){ lbl.textContent=next; lbl.style.setProperty('--c',APPS[d][2]); rise(lbl,[{opacity:0,transform:'translate(-50%,8px)'},{opacity:1,transform:'translate(-50%,0)'}],look.quick) } }
  function dirOf(dx,dy){ const dist=Math.hypot(dx,dy); if(dist<12) return -1; if(dir<0&&dist<18) return -1;
    const a=(Math.atan2(dx,-dy)/SEC+N)%N, n=Math.round(a)%N;
    if(dir>=0&&n!==dir){ const off=Math.abs(((a-dir+N*1.5)%N)-N/2); if(off<HOLD) return dir } // stays put until ~7 degrees past the boundary
    return n }
  const home=$('#home'), brief=$('#brief'), side=$('#side'), dim=$('#dim');
  let view='home', swipe=null, swiped=false;
  let pageRun=0;
  const pages=[home,brief,side,dim], savedTransitions=pages.map(el=>el.style.transition);
  const paint=()=>setPos(briefMotion.value,sideMotion.value);
  const briefMotion=animator(paint,{unit:'scalar'}), sideMotion=animator(paint,{unit:'scalar'});
  function takePages(){ ++pageRun; pages.forEach(el=>el.style.transition='none'); side.classList.add('moving') }
  function setPos(b,s){ const W=app.clientWidth, S=side.offsetWidth;
    brief.style.transform=`translateX(${(b-1)*W}px)`; home.style.transform=s>0?`translateX(${b*W-s*S*.12}px) scale(${1-.07*Math.min(1,s)})`:`translateX(${b*W}px)`;
    side.style.transform=`translateX(${(1-s)*100}%)`; dim.style.opacity=Math.min(1,s); side.classList.toggle('open',s>0); dim.style.pointerEvents=s>.5?'auto':'none';
    // The menu slides on its own opaque fill; its frosted layer cross-fades in from 85% of the way open, before it
    // rests, and back out as soon as a finger takes it or it leaves (home.css).
    side.classList.toggle('frost',view==='side'&&!swipe&&s>=.85) }
  // The Briefing's tiles cascade (DESIGN-SYSTEM.md §8); menu rows stay visible.
  function enter(el){ [...el.querySelectorAll(':scope .sidescroll>:not(#convos), :scope #convos>*, :scope .grid>*')].forEach((c,i)=>c.style.setProperty('--k',String(Math.min(i,10)))); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); clearTimeout(el._enter); el._enter=setTimeout(()=>el.classList.remove('enter'),900) }
  // Only the place in view takes focus or taps; the others are inert (audit fix 5).
  function inertAll(){ home.inert=view!=='home'; brief.inert=view!=='brief'; side.inert=view!=='side' }
  function go(v,ms,velocity={}){ const was=view; view=v; takePages(); hush(); const run=pageRun;
    // Preserve the flick clock; the dim and home scale use these same progress values.
    const timeScale=(ms??(parseFloat(getComputedStyle(root).getPropertyValue('--d-page'))||460))/410;
    briefMotion.to(v==='brief'?1:0,{spring:springs.page,velocity:velocity.b,timeScale});
    sideMotion.to(v==='side'?1:0,{spring:springs.page,velocity:velocity.s,timeScale});
    Promise.all([briefMotion.whenResting(),sideMotion.whenResting()]).then(()=>{if(run===pageRun){side.classList.remove('moving');pages.forEach((el,i)=>{el.style.transition=savedTransitions[i]})}});
    inertAll(); if(v!=='home') menu(false); if(v!==was&&v==='brief') enter(brief) }
  function resumePages(){ if(start?.paused){start.paused=false;go(view,undefined,{b:start.bv,s:start.sv})} }
  inertAll(); requestAnimationFrame(()=>setTimeout(tokens));
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
  app.addEventListener('pointerdown',e=>{ if(!e.isPrimary||e.target.closest('input,textarea,.spage')) return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId,t:performance.now(),el:e.target,b:briefMotion.value,s:sideMotion.value,bv:briefMotion.velocity,sv:sideMotion.velocity,paused:!briefMotion.resting||!sideMotion.resting}; swipe=null;
    if(start.paused){takePages();briefMotion.stop();sideMotion.stop()}
    if(view!=='home'||blocked(e.target)||opts.classList.contains('show')) return;
    const r=app.getBoundingClientRect(); press.style.left=(e.clientX-r.left)+'px'; press.style.top=(e.clientY-r.top)+'px'; press.classList.remove('on'); void press.offsetWidth; press.classList.add('on');
    // The hold's own frame does only what the ring needs; counting it for the hint waits until the ring is out.
    holdT=setTimeout(()=>{ resumePages(); press.classList.remove('on'); const c=place(start.x,start.y); start.cx=c.cx; start.cy=c.cy; open=true; hint.classList.add('gone'); showRing(); openFan(); haptic('open'); setTimeout(()=>learn('ring'),600) },220) });
  window.addEventListener('pointermove',e=>{ if(!start||e.pointerId!==start.id) return;
    if(!open){ const mx=e.clientX-start.x, my=e.clientY-start.y, d=Math.hypot(mx,my);
      // Sideways is ours from 6 px, before Chrome's own slop (8 dp) can hand the touch to a scroller;
      // anything else is the scroller's once it passes the 10 px hold slop.
      // A leftward drag that starts on a conversation row is the row's own (its Pin and Summary).
      if(!swipe&&view==='side'&&mx<0&&d>=6&&start.el.closest&&start.el.closest('#convos .row.thr')){ resumePages(); start=null; return }
      if(!swipe){ if(d>=6&&Math.abs(mx)>Math.abs(my)){ clearTimeout(holdT); press.classList.remove('on'); takePages(); swipe={from:view,axis:start.b>0&&(view==='brief'||start.s<=0)?'brief':start.s>0?'side':mx>0?'brief':'side',b:start.b,s:start.s,v:[]} }
        else { if(d>10){ clearTimeout(holdT); press.classList.remove('on'); resumePages(); start=null } return } }
      e.preventDefault(); swipe.v.push([e.timeStamp,e.clientX]); if(swipe.v.length>8) swipe.v.shift();
      const W=app.clientWidth, S=side.offsetWidth;
      // Past the end a page stretches a little and springs back on release (a rubber band).
      const band=v=>v<=1?Math.max(0,v):1+(v-1)*.22/(1+(v-1)*2);
      if(start.b===0&&start.s===0)swipe.axis=mx>0?'brief':'side';
      // Anchor a regrab at its rendered value, including an in-flight overshoot.
      swipe.b=swipe.axis==='brief'?start.b+band(start.b+mx/W)-band(start.b):start.b;
      swipe.s=swipe.axis==='side'?start.s+band(start.s-mx/S)-band(start.s):start.s;
      briefMotion.set(swipe.b); sideMotion.set(swipe.s); return }
    e.preventDefault(); const dx=e.clientX-start.x, dy=e.clientY-start.y, d=Math.hypot(dx,dy), k=Math.min(1,R*.55/(d||1));
    hub.style.transform=`translate(${dx*k}px,${dy*k}px)`; setDir(dirOf(dx,dy)) },{passive:false});
  // The finger's speed over its last 100 ms (px/ms, + is rightward); 0 if it stopped before lifting.
  function flick(v,at){ const last=v[v.length-1]; if(!last||at-last[0]>60) return 0; const first=v.find(p=>last[0]-p[0]<=100)||last; return last[0]>first[0]?(last[1]-first[1])/(last[0]-first[0]):0 }
  // A swipe commits at 28% of its travel or a flick of 0.45 px/ms its way (GESTURES.md §4).
  // A flick finishes at the finger's speed (the spring's settle is about 1.8 times the straight run),
  // between 180 and 460 ms; a commit ticks once.
  function endSwipe(at){ const {from,b,s,axis}=swipe, v=at===undefined?0:flick(swipe.v,at), F=.45; swipe=null; start.paused=false; swiped=true; setTimeout(()=>swiped=false,60);
    const to=from==='home'?(b>0&&(v>F||b>.28&&v>=-F)?'brief':s>0&&(v<-F||s>.28&&v<=F)?'side':'home')
      :from==='brief'?(v<-F||b<.72&&v<=F?'home':'brief'):(v>F||s<.72&&v>=-F?'home':'side');
    const left=to==='brief'||from==='brief'?Math.abs((to==='brief'?1:0)-b)*app.clientWidth:Math.abs((to==='side'?1:0)-s)*side.offsetWidth;
    go(to,Math.abs(v)>F?Math.round(Math.min(460,Math.max(180,left/Math.abs(v)*1.8))):undefined,{b:axis==='brief'?v*1000/app.clientWidth:0,s:axis==='side'?-v*1000/side.offsetWidth:0});
    if(to!==from){ haptic('commit'); if(to==='brief'||to==='side') learn(to) } }
  function close(commit){ clearTimeout(holdT); press.classList.remove('on');
    if(open){ land(0); const chosen=commit?dir:-1; scrim.classList.remove('show'); hub.style.transform='translate(0,0)';
      const run=++ringRun; opening=false;
      if(chosen>=0){ const p=pets[chosen]; p.classList.add('go'); haptic('commit'); const to=APPS[chosen][3]; if(to){ const r=p.getBoundingClientRect(); launchFrom(r.left+r.width/2,r.top+r.height/2); openFromRing(apps[chosen].id,APPS[chosen][2],to) } else toast(APPS[chosen][0]+' comes later') }
      // The chosen disc carries on out and grows as it fades; the others fold back into the finger. Their glass
      // fades out with their faces (.glassy off, --d-fast).
      ring.classList.remove('glassy');
      pets.forEach((p,i)=>{const m=petMotion[i], c=i===chosen, spring=c?springs.pop:springs.ring; p.classList.remove('lifted'); m.face.to(0,{spring:springs.fade}); m.radial.to(c?1.25:0,{spring}); m.size.to(c?1.15:.2,{spring}); m.choice.to(c?.12:0,{spring})});
      settleRing(run);
      petsRest().then(()=>{if(run!==ringRun||open)return;ring.classList.remove('show','active','moving');pets.forEach((p,i)=>{p.classList.remove('go','on');const m=petMotion[i];m.radial.set(0);m.size.set(.2);m.choice.set(0);m.face.set(0)}); hush(); requestAnimationFrame(()=>setTimeout(tokens)) });
      dir=-1; name(-1) }
    resumePages(); open=false; start=null }
  window.addEventListener('pointerup',e=>{ if(start&&e.pointerId===start.id){ if(swipe) endSwipe(e.timeStamp); close(true) } });
  function keyRing(){ if(open) return; const r=app.getBoundingClientRect(); place(r.left+r.width/2,r.top+r.height/2); open=true; hint.classList.add('gone'); showRing(); openFan(true);
    const keys=e=>{ if(e.key==='ArrowRight'||e.key==='ArrowDown'){ e.preventDefault(); setDir((dir+1)%N) } else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ e.preventDefault(); setDir((dir-1+N)%N) }
      else if(e.key==='Enter'||e.key===' '){ e.preventDefault(); done(true) } else if(e.key==='Escape'||e.key==='Tab'){ e.preventDefault(); done(false) } };
    const done=c=>{ document.removeEventListener('keydown',keys,true); close(c) };
    document.addEventListener('keydown',keys,true) }
  window.addEventListener('pointercancel',()=>{ if(swipe) endSwipe(); close(false) });
  app.addEventListener('contextmenu',e=>e.preventDefault());
  app.addEventListener('touchmove',e=>{ if(open||swipe) e.preventDefault() },{passive:false});
})();
