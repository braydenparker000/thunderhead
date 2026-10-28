// Thunderhead home: one quiet chat screen. Hold still for the Compass ring, swipe right for the briefing, swipe left for the menu.
'use strict';
(function(){
  const $=s=>document.querySelector(s), root=document.documentElement;
  const edge=$('#edge'), toastEl=$('#toast'); let tt;
  const toast=m=>{toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>toastEl.classList.remove('show'),1700)};
  const buzz=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
  try{$('#date').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})}catch(e){}

  // day/night: Auto follows the clock; Day or Night sticks
  const seg=$('#seg'); let pref='auto'; try{pref=localStorage.getItem('th-theme')||'auto'}catch(e){}
  function applyTheme(p){ pref=p; const hr=new Date().getHours(); root.dataset.theme=p==='auto'?((hr>=19||hr<7)?'dark':'light'):p; seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.th===p)) }
  applyTheme(pref);
  seg.addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; applyTheme(b.dataset.th); try{localStorage.setItem('th-theme',b.dataset.th)}catch(e){}});
  try{$('#bdate').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'})}catch(e){}

  document.querySelectorAll('[data-toast]').forEach(b=>b.addEventListener('click',()=>toast(b.dataset.toast)));

  // + folds the options sheet up out of the ask bar
  const ask=$('#ask'), q=$('#q'), convo=$('#convo'), hint=$('#hint'), opts=$('#opts'), plus=$('#plus');
  function menu(on){ opts.classList.toggle('show',on); $('#home').classList.toggle('menuOpen',on); ask.classList.toggle('menu',on); plus.setAttribute('aria-expanded',on) }
  plus.addEventListener('click',()=>{ menu(!opts.classList.contains('show')); buzz(6) });
  opts.addEventListener('click',e=>{ if(e.target.closest('button')) menu(false) });
  document.addEventListener('pointerdown',e=>{ if(opts.classList.contains('show')&&!e.target.closest('#opts,#plus')) menu(false) });

  // asking (scripted examples only); the mic is on only while it's lit
  q.addEventListener('input',()=>ask.classList.toggle('typing',q.value.trim()!==''));
  let listening=false;
  $('#mic').addEventListener('click',()=>{ listening=!listening; ask.classList.toggle('listening',listening); edge.classList.toggle('listen',listening);
    q.placeholder=listening?'Listening…':''; toast(listening?'Listening. Tap again to stop':'Stopped. Nothing is kept unless you send it'); buzz(8) });
  ask.addEventListener('submit',e=>{
    e.preventDefault(); const text=q.value.trim(); if(!text) return; q.value=''; ask.classList.remove('typing'); hint.classList.add('gone');
    const t=document.createElement('div'); t.className='turn';
    t.innerHTML='<div class="you"></div><div class="voice reply"></div>'; t.firstChild.textContent=text; $('#turns').appendChild(t);
    convo.scrollTop=convo.scrollHeight;
    edge.classList.add('think'); edge.classList.remove('breathe');
    const a="I'm not connected yet. Sign-in and my memory come next.";
    setTimeout(()=>{ edge.classList.remove('think'); edge.classList.add('breathe'); const r=t.querySelector('.reply'); let i=0;
      (function step(){ r.textContent=a.slice(0,i+=2); convo.scrollTop=convo.scrollHeight;
        if(i<a.length) return requestAnimationFrame(step);      })() },1100);
  });

  // Compass: hold an empty spot ~220 ms, a tight ring of six apps springs out around the finger; slide toward one, let go to open
  const I={
    music:'<svg viewBox="0 0 256 256" class="ph"><path d="M212.92,17.69a8,8,0,0,0-6.86-1.45l-128,32A8,8,0,0,0,72,56V166.08A36,36,0,1,0,88,196V62.25l112-28v99.83A36,36,0,1,0,216,164V24A8,8,0,0,0,212.92,17.69ZM52,216a20,20,0,1,1,20-20A20,20,0,0,1,52,216Zm128-32a20,20,0,1,1,20-20A20,20,0,0,1,180,184Z"/></svg>',
    guitar:'<svg viewBox="0 0 256 256" class="ph"><path d="M249.66,46.34l-40-40a8,8,0,0,0-11.31,11.32L200.69,20,140.52,80.16C117.73,68.3,92.21,69.29,76.75,84.74a42.27,42.27,0,0,0-9.39,14.37A8.24,8.24,0,0,1,59.81,104c-14.59.49-27.26,5.72-36.65,15.11C11.08,131.22,6,148.6,8.74,168.07,11.4,186.7,21.07,205.15,36,220s33.34,24.56,52,27.22A71.13,71.13,0,0,0,98.1,248c15.32,0,28.83-5.23,38.76-15.16,9.39-9.39,14.62-22.06,15.11-36.65a8.24,8.24,0,0,1,4.92-7.55,42.12,42.12,0,0,0,14.37-9.39c15.45-15.46,16.44-41,4.58-63.77L236,55.31l2.34,2.34a8,8,0,1,0,11.32-11.31ZM160,167.93a26.12,26.12,0,0,1-8.95,5.83,24.24,24.24,0,0,0-15,21.89c-.36,10.46-4,19.41-10.43,25.88-8.44,8.43-21,11.95-35.36,9.89C75,229.25,59.73,221.19,47.27,208.73S26.75,181,24.58,165.81c-2-14.37,1.46-26.92,9.89-35.36C40.94,124,49.89,120.37,60.35,120h0a24.22,24.22,0,0,0,21.89-15,26.12,26.12,0,0,1,5.83-9c5.49-5.49,13-8.13,21.38-8.13a49.38,49.38,0,0,1,19.13,4.19L108.5,112.19a32,32,0,1,0,35.31,35.31l20.08-20.08C170.41,142.71,169.47,158.41,160,167.93Zm-10.4-61.48a72.9,72.9,0,0,1,5.93,6.75l-15.42,15.42a32.22,32.22,0,0,0-12.68-12.68l15.42-15.43A73,73,0,0,1,149.55,106.45ZM112,128a16,16,0,0,1,16,16h0a16,16,0,1,1-16-16Zm48.85-32.85a86.94,86.94,0,0,0-6.68-6L176,67.31,188.69,80l-21.83,21.82A86.94,86.94,0,0,0,160.86,95.14ZM200,68.68,187.32,56,212,31.31,224.69,44ZM93.66,194.33a8,8,0,0,1-11.31,11.32l-32-32a8,8,0,0,1,11.32-11.31Z"/></svg>', /* Phosphor Icons, MIT */
    study:'<svg viewBox="0 0 256 256" class="ph"><path d="M208,24H72A32,32,0,0,0,40,56V224a8,8,0,0,0,8,8H192a8,8,0,0,0,0-16H56a16,16,0,0,1,16-16H208a8,8,0,0,0,8-8V32A8,8,0,0,0,208,24ZM120,40h48v72L148.79,97.6a8,8,0,0,0-9.6,0L120,112Zm80,144H72a31.82,31.82,0,0,0-16,4.29V56A16,16,0,0,1,72,40h32v88a8,8,0,0,0,12.8,6.4L144,114l27.21,20.4A8,8,0,0,0,176,136a8,8,0,0,0,8-8V40h16Z"/></svg>',
    astra:'<svg viewBox="0 0 256 256" class="ph"><path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Zm-48,48a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224Zm-3.56-110.66-48-32A8,8,0,0,0,104,88v64a8,8,0,0,0,12.44,6.66l48-32a8,8,0,0,0,0-13.32ZM120,137.05V103l25.58,17Z"/></svg>',
    podcasts:'<svg viewBox="0 0 256 256" class="ph"><path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z"/></svg>',
    media:'<svg viewBox="0 0 256 256" class="ph"><path d="M164.44,121.34l-48-32A8,8,0,0,0,104,96v64a8,8,0,0,0,12.44,6.66l48-32a8,8,0,0,0,0-13.32ZM120,145.05V111l25.58,17ZM234.33,69.52a24,24,0,0,0-14.49-16.4C185.56,39.88,131,40,128,40s-57.56-.12-91.84,13.12a24,24,0,0,0-14.49,16.4C19.08,79.5,16,97.74,16,128s3.08,48.5,5.67,58.48a24,24,0,0,0,14.49,16.41C69,215.56,120.4,216,127.34,216h1.32c6.94,0,58.37-.44,91.18-13.11a24,24,0,0,0,14.49-16.41c2.59-10,5.67-28.22,5.67-58.48S236.92,79.5,234.33,69.52Zm-15.49,113a8,8,0,0,1-4.77,5.49c-31.65,12.22-85.48,12-86,12H128c-.54,0-54.33.2-86-12a8,8,0,0,1-4.77-5.49C34.8,173.39,32,156.57,32,128s2.8-45.39,5.16-54.47A8,8,0,0,1,41.93,68c30.52-11.79,81.66-12,85.85-12h.27c.54,0,54.38-.18,86,12a8,8,0,0,1,4.77,5.49C221.2,82.61,224,99.43,224,128S221.2,173.39,218.84,182.47Z"/></svg>'};
  // six directions, 60 degrees apart, clockwise from the top
  const APPS=[['Music',I.music,'#2f7df6'],['Guitar',I.guitar,'#e08a1e'],['Podcasts',I.podcasts,'#e0457b'],['Astra',I.astra,'#8b5cf6'],['My Media',I.media,'#14a39a'],['Study',I.study,'#2e9e5b']];
  const N=APPS.length, SEC=Math.PI*2/N;
  const ring=$('#ring'), scrim=$('#scrim'), lbl=$('#lbl'), hub=$('#hub'), press=$('#press'), app=$('#app'), R=62;
  const pets=APPS.map(([n,svg,c],i)=>{const p=document.createElement('div');p.className='pet';p.innerHTML=svg;p.title=n;p.style.setProperty('--c',c);p.style.setProperty('--i',i);ring.appendChild(p);return p});
  let start=null, open=false, dir=-1, holdT=null;
  const blocked=el=>el.closest('button,input,form,.chip,.card,.say,.you,.reply,.opts');
  function place(x,y){ const r=app.getBoundingClientRect(); const m=R+30;
    const cx=Math.min(Math.max(x-r.left,m),r.width-m), cy=Math.min(Math.max(y-r.top,m+30),r.height-m-40);
    ring.style.left=cx+'px'; ring.style.top=cy+'px';
    lbl.style.top=(R+30)+'px'; return {cx:cx+r.left,cy:cy+r.top} }
  function fan(on){ pets.forEach((p,i)=>{const a=i*SEC; p.style.transform=on?`translate(${R*Math.sin(a)}px,${-R*Math.cos(a)}px) scale(1)`:'translate(0,0) scale(.2)'}) }
  function setDir(d){ if(d===dir) return; dir=d; pets.forEach((p,i)=>p.classList.toggle('on',i===d)); ring.classList.toggle('active',d>=0); lbl.textContent=d>=0?APPS[d][0]:''; lbl.classList.toggle('show',d>=0); if(d>=0) buzz(8) }
  function dirOf(dx,dy){ const dist=Math.hypot(dx,dy); if(dist<14) return -1; if(dir<0&&dist<22) return -1;
    const a=(Math.atan2(dx,-dy)/SEC+N)%N, n=Math.round(a)%N;
    if(dir>=0&&n!==dir){ const off=Math.abs(((a-dir+N*1.5)%N)-N/2); if(off>N/2-.62) return dir } // stays put until ~7 degrees past the boundary
    return n }
  const home=$('#home'), brief=$('#brief'), side=$('#side'), dim=$('#dim');
  let view='home', swipe=null, swiped=false;
  function setPos(b,s,anim){ const W=app.clientWidth, S=side.offsetWidth;
    [home,brief,side,dim].forEach(el=>el.style.transition=anim?'':'none');
    brief.style.transform=`translateX(${(b-1)*W}px)`; home.style.transform=`translateX(${b*W-s*S*.2}px)`;
    side.style.transform=`translateX(${(1-s)*100}%)`; dim.style.opacity=s; side.classList.toggle('open',s>0); dim.style.pointerEvents=s>.5?'auto':'none' }
  function go(v){ view=v; setPos(v==='brief'?1:0,v==='side'?1:0,true); if(v!=='home') menu(false) }
  dim.addEventListener('click',()=>go('home'));
  app.addEventListener('click',e=>{ if(swiped){ e.stopPropagation(); e.preventDefault() } },true);
  app.addEventListener('pointerdown',e=>{ if(!e.isPrimary||e.target.closest('input')) return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId,t:performance.now()}; swipe=null;
    if(view!=='home'||blocked(e.target)||opts.classList.contains('show')) return;
    const r=app.getBoundingClientRect(); press.style.left=(e.clientX-r.left)+'px'; press.style.top=(e.clientY-r.top)+'px'; press.classList.remove('on'); void press.offsetWidth; press.classList.add('on');
    holdT=setTimeout(()=>{ press.classList.remove('on'); const c=place(start.x,start.y); start.cx=c.cx; start.cy=c.cy; open=true; hint.classList.add('gone'); ring.classList.remove('closing'); ring.classList.add('show'); scrim.classList.add('show'); requestAnimationFrame(()=>fan(true)); buzz(6) },220) });
  window.addEventListener('pointermove',e=>{ if(!start||e.pointerId!==start.id) return;
    if(!open){ const mx=e.clientX-start.x, my=e.clientY-start.y;
      if(!swipe){ if(Math.hypot(mx,my)<=10) return; clearTimeout(holdT); press.classList.remove('on');
        if(Math.abs(mx)>Math.abs(my)*1.2) swipe={from:view,b:view==='brief'?1:0,s:view==='side'?1:0}; else { start=null; return } }
      e.preventDefault(); const W=app.clientWidth, S=side.offsetWidth, cl=v=>Math.max(0,Math.min(1,v));
      if(swipe.from==='home'){ swipe.b=mx>0?cl(mx/W):0; swipe.s=mx<0?cl(-mx/S):0 }
      else if(swipe.from==='brief') swipe.b=cl(1+mx/W);
      else swipe.s=cl(1-mx/S);
      setPos(swipe.b,swipe.s,false); return }
    e.preventDefault(); const dx=e.clientX-start.cx, dy=e.clientY-start.cy, d=Math.hypot(dx,dy), k=Math.min(1,R*.55/(d||1));
    hub.style.transform=`translate(${dx*k}px,${dy*k}px)`; setDir(dirOf(dx,dy)) },{passive:false});
  function endSwipe(){ const {from,b,s}=swipe; swipe=null; swiped=true; setTimeout(()=>swiped=false,60);
    if(from==='home') go(b>.28?'brief':s>.28?'side':'home');
    else if(from==='brief') go(b<.72?'home':'brief');
    else go(s<.72?'home':'side') }
  function close(commit){ clearTimeout(holdT); press.classList.remove('on');
    if(open){ const chosen=commit?dir:-1; scrim.classList.remove('show'); hub.style.transform='translate(0,0)';
      if(chosen>=0){ const p=pets[chosen], a=chosen*SEC; p.classList.add('go'); p.style.transform=`translate(${R*1.25*Math.sin(a)}px,${-R*1.25*Math.cos(a)}px) scale(1.7)`; buzz([12,40,12]); toast(APPS[chosen][0]+' moves over next') }
      ring.classList.add('closing'); pets.forEach((p,i)=>{ if(i!==chosen) p.style.transform='translate(0,0) scale(.2)' });
      setTimeout(()=>{ ring.classList.remove('show','closing','active'); pets.forEach(p=>{p.classList.remove('go','on')}); fan(false) },230);
      dir=-1; lbl.classList.remove('show') }
    open=false; start=null }
  window.addEventListener('pointerup',e=>{ if(start&&e.pointerId===start.id){ if(swipe) endSwipe(); close(true) } });
  window.addEventListener('pointercancel',()=>{ if(swipe) endSwipe(); close(false) });
  app.addEventListener('contextmenu',e=>e.preventDefault());
  app.addEventListener('touchmove',e=>{ if(open||swipe) e.preventDefault() },{passive:false});
})();
