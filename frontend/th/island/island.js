// @ts-check
// A single capsule, retained players, and one reversible clip from its measured shape (HOME §12).
import { appFor } from '../registry/apps.js';
import { animator, motionReduced, springs, restTime, haptic } from '../motion.js';
import { frames, retain } from './frames.js';
export const LAYERED = Object.freeze(['music', 'podcasts']);
/** @param {string} id */
export const layered = id => LAYERED.includes(id);
const BARS = 5, HOLD_MS = 450;
const clamp = (/** @type {number} */ n) => Math.max(0, Math.min(1, n));
/** @type {import('./frames.js').Layer|null} */
let layer = null;
/** @type {HTMLDivElement|null} */
let island = null;
let expanded = false, compactWidth = 124, flight = 0, insets = [0,0,0,0,18];
let raf = 0;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let slow;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let idleClose;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let alertEnd;
/** @type {{end:number,timer:ReturnType<typeof setTimeout>}|null} */
let podSleep = null;
/** @param {string} name */
function ms(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--d-${name}`).trim();
  return parseFloat(v) * (v.endsWith('ms') ? 1 : 1000);
}
const springOptions = (name = 'base') => ({ spring:springs.island, timeScale:ms(name) / restTime(springs.island) || 1 });
const content = animator(v => {
  if (!island) return;
  island.style.setProperty('--details', String(clamp(v)));
  island.style.setProperty('--compact', String(1 - clamp(v)));
}, { unit:'opacity' });
const shape = animator(v => {
  if (!island) return;
  const p = clamp(v), width = Math.min(360, innerWidth - 24);
  // Finish growing at 80%, then squish out by 4% and settle on the same spring clock.
  const grow = clamp(p / .8), squish = p > .8 ? Math.sin(Math.PI * (p - .8) / .2) * width * .04 : 0;
  island.style.width = `${compactWidth + (width - compactWidth) * grow + squish + alertWidth.value * (1-p)}px`;
  island.style.height = `${36 + 92*p}px`;
  island.style.borderRadius = `${18 + 10*p}px`;
  if (!motionReduced()) content.set(clamp((p - .4) / .6));
}, { unit:'scalar' });
const alertWidth = animator(() => renderShape());
function renderShape() {
  // Repaint without resetting an in-flight shape or its velocity.
  if (!island) return;
  const p = clamp(shape.value), width = Math.min(360, innerWidth - 24);
  const squish = p > .8 ? Math.sin(Math.PI * (p - .8) / .2) * width * .04 : 0;
  island.style.width = `${compactWidth + (width-compactWidth)*clamp(p/.8) + squish + alertWidth.value*(1-p)}px`;
}
const capsuleFade = animator(v => { if (island) island.style.opacity = String(clamp(v)); }, { unit:'opacity' });
const morph = animator(v => {
  if (!layer) return;
  const p = clamp(v), [t,r,b,l,radius] = insets.map(n => n*p);
  layer.shell.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${radius}px)`;
  if (island && !motionReduced()) {
    const visible = clamp((p-.7)/.3);
    island.style.opacity = String(visible);
    island.style.transform = `scale(${.6 + .4*visible})`;
  }
}, { unit:'scalar' });
/** All public transitions complete at the actual spring rest, including a reversal. */
export async function whenResting() {
  await Promise.all([shape.whenResting(), content.whenResting(), alertWidth.whenResting(), morph.whenResting(), capsuleFade.whenResting()]);
}
/** @returns {any} */
function win() { try { return layer?.frame.contentWindow ?? null; } catch { return null; } }
/** @returns {{kind:'music',p:any,w:any}|{kind:'podcasts',a:HTMLAudioElement,w:any}|null} */
function media() {
  const w = win();
  if (!w || !layer) return null;
  try {
    if (layer.id === 'music') return w.__cp?.player ? { kind:'music', p:w.__cp.player, w } : null;
    const a = w.document?.querySelector('audio');
    return a ? { kind:'podcasts', a, w } : null;
  } catch { return null; }
}
export function playing() {
  const m = media(), a = m?.kind === 'music' ? m.p.audio : m?.a;
  return Boolean(a && !a.paused && !a.ended);
}
export function sleepLeft() {
  const m = media();
  if (m?.kind === 'podcasts') return podSleep ? Math.max(0,(podSleep.end-Date.now())/1000) : 0;
  const s = m?.p.sleep;
  return !s ? 0 : s.end === null ? s.seconds : Math.max(0,(s.end-m?.w.performance.now())/1000);
}
/** @param {{text:string,undo?:()=>void}} r */
function toastOf(r) { void import('../ui.js').then(({toast}) => toast(r.text, r.undo ? {label:'Undo',run:r.undo} : undefined)); }

/** @param {string} id @param {{cover?:()=>Promise<void>}} [o] */
export async function openApp(id, o = {}) {
  if (!layered(id) || !appFor(id)?.built) return false;
  const started = performance.now();
  // Ring/chip callers start their generic reveal before importing us. Retire it immediately;
  // the retained layer supplies the capsule clip, including while its frame is still booting.
  for (const cover of document.querySelectorAll('.launch:not(.th-app-shell)')) { for (const a of cover.getAnimations()) a.cancel(); cover.remove(); }
  void o;
  await styles();
  const next = retain(id, watch), cold = !next.ready;
  if (layer !== next) {
    ++flight;
    morph.stop();
    if (layer) park(layer);
    layer = next;
    const is = ensureIsland();
    is.hidden = false; is.style.transform = ''; is.style.opacity = '1';
    expanded = false; shape.set(0); content.set(0); capsuleFade.set(1);
    is.dataset.state='compact';
    const compact=/** @type {HTMLButtonElement} */ (is.querySelector('.compact'));
    compact.inert=false; compact.setAttribute('aria-expanded','false');
    /** @type {HTMLElement} */ (is.querySelector('.details')).inert=true;
    tick();
    measure(); morph.set(1);
  }
  void expand('open');
  const opening = flight;
  void next.loaded.then(() => {
    if (opening !== flight || !next.front || !next.ready) return;
    requestAnimationFrame(() => {
      if (opening !== flight || !next.front || !next.ready) return;
      const duration = performance.now() - started;
      performance.measure(`th:island:${id}:ready`, {start:started, end:performance.now()});
      document.dispatchEvent(new CustomEvent('th:app-ready', {detail:{app:id,ms:duration,cold}}));
    });
  });
  return true;
}
/** Prewarm only after the chat's first successful load; called by warm.js at idle. */
export async function warm() {
  if (document.documentElement.dataset.signedIn === undefined || /** @type {any} */ (navigator).connection?.saveData) return;
  // A warm frame needs its worker's session handshake; blocked workers cannot prewarm safely.
  if (!navigator.serviceWorker) return;
  await navigator.serviceWorker.ready;
  await styles();
  for (const id of LAYERED) {
    if (document.documentElement.dataset.signedIn === undefined || /** @type {any} */ (navigator).connection?.saveData) return;
    const l = retain(id, watch);
    // A failed Music boot must not keep Podcasts from warming forever.
    await Promise.race([l.loaded, new Promise(r => setTimeout(r, 15_000))]);
  }
}
/** @param {import('./frames.js').Layer} l */
function park(l) { l.front = false; l.frame.inert = true; l.frame.classList.add('away'); l.shell.classList.remove('launch'); l.shell.classList.add('parked'); }
function measure() {
  if (!island || !morph.resting) return;
  island.style.transform = '';
  const r = island.getBoundingClientRect();
  insets = [r.top,innerWidth-r.right,innerHeight-r.bottom,r.left,parseFloat(getComputedStyle(island).borderRadius)];
  morph.set(morph.value);
}
/** @param {string} why @param {number} [velocity] */
export async function collapse(why, velocity) {
  if (!layer?.front) return;
  const l = layer, current = ++flight, is = ensureIsland();
  l.front = false; l.frame.inert = true;
  is.hidden = false; is.inert = false;
  tick();
  measure();
  document.body.dataset.island = l.id;
  morph.to(1, {...springOptions(), velocity:velocity === undefined ? undefined : velocity/Math.max(1,innerHeight-36)});
  if (motionReduced()) capsuleFade.to(1);
  await whenResting();
  if (current === flight && layer === l && !l.front) {
    park(l); is.style.opacity = '1'; is.style.transform = '';
    // If the app just visited is quiet, the island returns to the engine still playing.
    if (!playing()) for (const other of frames.values()) {
      try {
        const w=/** @type {any} */ (other.frame.contentWindow);
        const a=other.id==='music'?w.__cp?.player?.audio:w.document.querySelector('audio');
        if(a && !a.paused && !a.ended) {layer=other;tick();break;}
      } catch {}
    }
    touch();
  }
  void why;
}
/** @param {string} why */
export async function expand(why) {
  if (!layer || layer.front) return;
  const l = layer, current = ++flight, is = ensureIsland();
  clearTimeout(idleClose);
  // Preserve the exact measured shape while the frame grows or reverses.
  shape.stop(); content.stop(); alertWidth.stop();
  measure();
  l.front = true; l.frame.inert = false; l.frame.classList.remove('away'); l.shell.classList.remove('parked');
  // Keep the shell's launch marker on the real capsule reveal until its spring rests.
  l.shell.classList.add('launch');
  is.inert = true;
  delete document.body.dataset.island;
  if (history.state?.th !== 'app') history.pushState({th:'app',app:l.id}, '');
  morph.to(0, springOptions());
  if (motionReduced()) capsuleFade.to(0);
  await whenResting();
  if (current === flight && layer === l && l.front) { is.hidden = true; l.shell.classList.remove('launch'); }
  void why;
}
/** Closing returns to the chat; the engine and its frame stay alive. */
export function close() { return collapse('close'); }
addEventListener('popstate', () => { if (layer?.front) void collapse('Back'); });

/** Reattach on every frame navigation, including the app's own theme reload. @param {import('./frames.js').Layer} l */
function watch(l) {
  const w = l.frame.contentWindow;
  if (!w) return;
  /** @type {{x:number,y:number,lastY:number,t:number}|null} */
  let s = null;
  try {
    w.addEventListener('pointerdown', e => { s = e.clientY > w.innerHeight-150 ? {x:e.clientX,y:e.clientY,lastY:e.clientY,t:e.timeStamp} : null; }, {capture:true,passive:true});
    w.addEventListener('pointermove', e => {
      if (!s || layer !== l || !l.front) return;
      const dy = e.clientY-s.y, velocity = (e.clientY-s.lastY)*1000/Math.max(1,e.timeStamp-s.t);
      s.lastY=e.clientY; s.t=e.timeStamp;
      if (dy > 56 && dy > Math.abs(e.clientX-s.x)*1.4) { s=null; void collapse('swipe down',velocity); }
    }, {capture:true,passive:true});
    for (const type of ['pointerup','pointercancel']) w.addEventListener(type, () => {s=null;});
  } catch {}
}
/** @param {string} name */
const icon = name => `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${name}"/></svg>`;
function ensureIsland() {
  if (island) return island;
  const b = document.createElement('div');
  b.setAttribute('role','group');
  b.className='th-island'; b.hidden=true; b.dataset.state='compact';
  b.innerHTML = `<button type="button" class="compact" aria-label="Expand player" aria-expanded="false"><span class="dot"></span><span class="title-mask"><span class="title"></span></span><span class="bars">${'<i></i>'.repeat(BARS)}</span><span class="alert-dot"></span></button><div class="details" inert><button type="button" class="art" aria-label="Open app"><img alt="" hidden>${icon('music-notes-simple')}</button><button type="button" class="heading" aria-label="Open app"><span class="tt"></span><span class="by"></span></button><button type="button" class="zz" aria-label="Sleep timer">${icon('moon-stars')}<b></b></button><div class="controls"><button type="button" data-control="previous" aria-label="Previous">${icon('play')}</button><button type="button" data-control="toggle" aria-label="Play">${icon('play')}</button><button type="button" data-control="next" aria-label="Next">${icon('play')}</button></div><div class="times"><span class="elapsed"></span><span class="total"></span></div></div><div class="progress"><i></i></div>`;
  document.body.append(b); island=b;
  b.querySelector('.compact')?.addEventListener('click', e => { if (!held || !/** @type {MouseEvent} */ (e).detail) void wide(true); held=false; });
  for (const button of b.querySelectorAll('.art,.heading')) button.addEventListener('click', () => void expand('island'));
  for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (b.querySelectorAll('[data-control]'))) button.addEventListener('click', () => {
    const cmd = button.dataset.control;
    control(cmd === 'toggle' ? playing() ? 'pause' : 'play' : /** @type {'next'|'previous'} */ (cmd));
    touch(); haptic('choose');
  });
  b.querySelector('.zz')?.addEventListener('click', () => { toastOf(control('sleep', sleepLeft() ? 0 : 30)); touch(); });
  gestures(b);
  document.addEventListener('pointerdown', e => { if (expanded && !b.contains(/** @type {Node} */ (e.target))) void wide(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) { void wide(false); /** @type {HTMLElement} */ (b.querySelector('.compact')).focus(); } });
  const changes = new MutationObserver(notices);
  for (const node of document.querySelectorAll('#talk,#decision')) changes.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('th:decisions', notices);
  document.addEventListener('click', e => { const note = /** @type {Element} */ (e.target).closest?.('#talk .note'); if (note && about(note)) void wide(true); });
  notices();
  return b;
}
let touching=false;
function touch() { clearTimeout(idleClose); if (expanded && !touching) idleClose=setTimeout(() => void wide(false),6000); }
/** @param {boolean} [on] */
export async function wide(on=true) {
  if (!layer || layer.front) return;
  const b=ensureIsland(); expanded=on;
  b.dataset.state=on ? 'expanded' : b.classList.contains('alert') ? 'alert' : 'compact';
  const compact=/** @type {HTMLButtonElement} */ (b.querySelector('.compact'));
  compact.setAttribute('aria-expanded',String(on)); compact.inert=on;
  /** @type {HTMLElement} */ (b.querySelector('.details')).inert=!on;
  shape.to(on?1:0,springOptions());
  if (motionReduced()) content.to(on?1:0);
  touch(); if(on) haptic('open');
  await whenResting();
}
let held=false;
/** @param {HTMLElement} b */
function gestures(b) {
  /** @type {{x:number,y:number}|null} */ let start=null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let hold;
  b.addEventListener('pointerdown', e => {
    touching=true; touch(); held=false; start={x:e.clientX,y:e.clientY};
    if (!expanded) hold=setTimeout(() => { held=true; if(!motionReduced()) b.classList.add('marquee'); },HOLD_MS);
  });
  b.addEventListener('pointermove', e => {
    if (!start) return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;
    if (Math.abs(dy)>30 && dy < -Math.abs(dx)) { held=true; clearTimeout(hold); start=null; void wide(false); }
    else if (!expanded && Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*1.5) { held=true; clearTimeout(hold); start=null; control(dx<0?'next':'previous'); }
  });
  const end=() => {if(!touching) return; touching=false; clearTimeout(hold); start=null; b.classList.remove('marquee'); touch();};
  addEventListener('pointerup',end); addEventListener('pointercancel',end);
  b.addEventListener('contextmenu',e=>e.preventDefault());
}
/** @param {Element} note */
function about(note) { return Boolean(layer && new RegExp(`\\b${layer.id === 'music' ? 'music' : 'podcasts?'}\\b`,'i').test(note.textContent ?? '')); }
let noticeKey='';
function notices() {
  if (!island) return;
  const notes=[...document.querySelectorAll('#talk .note')].filter(about);
  const decision=document.querySelector('#decision .card:not(.gone)');
  const key=notes.map(n=>n.closest('[data-id]')?.getAttribute('data-id') ?? n.textContent).join('|') + (decision?.textContent ?? '');
  island.classList.toggle('alert',Boolean(key));
  if (key && key!==noticeKey) {
    clearTimeout(alertEnd); island.classList.add('alert-flash');
    if (!expanded) island.dataset.state='alert';
    alertWidth.to(24,springOptions('fast'));
    alertEnd=setTimeout(() => {
      island?.classList.remove('alert-flash');
      alertWidth.to(0,springOptions('fast'));
      if (island && !expanded) island.dataset.state='compact';
    },1200);
  }
  noticeKey=key;
}
const time = (/** @type {number} */ s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
let lastArt='', lastTitle='', titleViewport=0;
let meterData=new Uint8Array(0);
/** Titles and artwork stay in this page. Fetch artwork inside its app, under that app's CSP. */
function tick() {
  cancelAnimationFrame(raf); clearTimeout(slow);
  const is=island;
  if (!is || !layer) return;
  const m=media(), app=appFor(layer.id), on=playing();
  const meta=m?.w.navigator.mediaSession?.metadata;
  const t=m?.kind==='music' ? m.p.track : null;
  const title=t?.title || meta?.title || app?.name || '', by=t?.artist || meta?.artist || '';
  for (const node of is.querySelectorAll('.title,.tt')) if(node.textContent!==title) node.textContent=title;
  const sub=/** @type {HTMLElement} */ (is.querySelector('.by')); if(sub.textContent!==by) sub.textContent=by;
  is.style.setProperty('--c',app?.color ?? '#2f7df6'); is.dataset.app=layer.id;
  is.classList.toggle('playing',on);
  const zz=Math.ceil(sleepLeft()/60); is.classList.toggle('sleep',zz>0);
  /** @type {HTMLElement} */ (is.querySelector('.zz b')).textContent=zz?String(zz):'';
  is.querySelector('.compact')?.setAttribute('aria-label', `${title}${by ? `, ${by}` : ''}. Expand ${app?.name} player`);
  is.querySelector('.heading')?.setAttribute('aria-label', `${title}${by ? `, ${by}` : ''}. Open ${app?.name}`);
  is.setAttribute('aria-label',`${app?.name} ${on?'playing':'paused'}${zz?`, stops in ${zz} min`:''}`);
  const toggle=/** @type {HTMLButtonElement} */ (is.querySelector('[data-control="toggle"]'));
  const action=on?'Pause':'Play'; if(toggle.getAttribute('aria-label')!==action) {toggle.setAttribute('aria-label',action); toggle.innerHTML=icon(on?'pause':'play');}
  const a=m?.kind==='music'?m.p.audio:m?.a;
  const duration=Number.isFinite(a?.duration)?a.duration:0, elapsed=Number.isFinite(a?.currentTime)?a.currentTime:0;
  is.style.setProperty('--progress',String(duration?clamp(elapsed/duration):0));
  /** @type {HTMLElement} */ (is.querySelector('.elapsed')).textContent=time(elapsed);
  /** @type {HTMLElement} */ (is.querySelector('.total')).textContent=time(duration);
  const text=/** @type {HTMLElement} */ (is.querySelector('.title'));
  if (title!==lastTitle || titleViewport!==innerWidth) {
    lastTitle=title; titleViewport=innerWidth;
    compactWidth=Math.max(124,Math.min(innerWidth*.6-24,text.scrollWidth+83));
    is.style.setProperty('--marquee',`${Math.min(0,compactWidth-83-text.scrollWidth)}px`);
    renderShape();
  }
  const art=meta?.artwork?.[0]?.src ?? '';
  if (art!==lastArt) {
    lastArt=art;
    const img=/** @type {HTMLImageElement} */ (is.querySelector('.art img')); img.hidden=true;
    if(art.startsWith('data:image/')) {img.src=art;img.hidden=false;}
    else if(art && m) void m.w.fetch(art).then((/** @type {Response} */ r)=>r.blob()).then((/** @type {Blob} */ blob)=>{
      const reader=new FileReader(); reader.onload=()=>{if(lastArt===art){img.src=String(reader.result);img.hidden=false;}}; reader.readAsDataURL(blob);
    }).catch(()=>{});
  }
  const an=m?.kind==='music' && !motionReduced() && !document.hidden && !layer.front && on ? m.w.__cp?.dsp?.nodes?.analyser : null;
  is.classList.toggle('live',Boolean(an));
  // Without an analyser, retain the playing-only fallback; reduced motion and pause stop it.
  is.querySelectorAll('.bars i').forEach((bar,i)=>{
    const animations=bar.getAnimations();
    const breathe=on && !an && !layer?.front && !document.hidden && !motionReduced();
    if(!breathe) for(const animation of animations) animation.cancel();
    else if(!animations.length) bar.animate([{transform:'scaleY(.25)'},{transform:'scaleY(1)'}],
      {duration:ms('rise')*(.6+i*.08),easing:getComputedStyle(document.documentElement).getPropertyValue('--settle').trim(),iterations:Infinity,direction:'alternate'});
  });
  if(an) {
    if(meterData.length!==an.frequencyBinCount) meterData=new Uint8Array(an.frequencyBinCount);
    const bars=/** @type {NodeListOf<HTMLElement>} */ (is.querySelectorAll('.bars i'));
    const step=Math.max(1,Math.floor(meterData.length/3/BARS));
    const draw=()=>{
      if(document.hidden || layer?.front || motionReduced()) return;
      an.getByteFrequencyData(meterData);
      bars.forEach((b,i)=>{let sum=0;for(let k=0;k<step;k++) sum+=meterData[i*step+k]??0;b.style.transform=`scaleY(${Math.max(.18,Math.min(1,sum/step/190))})`;});
      raf=requestAnimationFrame(draw);
    };
    draw();
  }
  if(!layer.front) slow=setTimeout(tick,500);
  notices();
}
addEventListener('resize',()=>{ if(layer && !layer.front){tick();renderShape();} });
/**
 * The phone's commands, on the app playing behind the chat (or in front). `minutes` for 'sleep'.
 * @param {'pause' | 'play' | 'next' | 'previous' | 'sleep' | 'never'} cmd @param {number} [minutes]
 * @returns {{ ok: boolean, text: string, undo?: () => void }}
 */
export function control(cmd, minutes = 30) {
  const m = media();
  if (!m) return { ok: false, text: 'Nothing is playing here. Open Music or Podcasts first.' };
  if (m.kind === 'podcasts') {
    const a = m.a;
    if (cmd === 'pause') a.pause();
    else if (cmd === 'play') void a.play().catch(() => {});
    else if (cmd === 'next') a.currentTime = Math.min(a.duration || Infinity, a.currentTime + 30);
    else if (cmd === 'previous') a.currentTime = Math.max(0, a.currentTime - 15);
    else if (cmd === 'sleep') {
      const before = podSleep ? Math.ceil((podSleep.end - Date.now()) / 60_000) : 0;
      if (podSleep) clearTimeout(podSleep.timer);
      podSleep = null;
      if (minutes > 0) {
        const timer = setTimeout(() => {
          podSleep = null;
          a.pause();
        }, minutes * 60_000);
        podSleep = { end: Date.now() + minutes * 60_000, timer };
      }
      tick();
      return { ok: true, text: minutes > 0 ? `Podcasts stops in ${minutes} minutes.` : 'Sleep timer off.', undo: () => control('sleep', before) };
    } else return { ok: false, text: 'That works in Music.' };
    tick();
    return { ok: true, text: { pause: 'Paused.', play: 'Playing.', next: '30 seconds on.', previous: '15 seconds back.' }[cmd] ?? '' };
  }
  const p = m.p;
  if (cmd === 'pause') p.pause();
  else if (cmd === 'play') p.play();
  else if (cmd === 'next') p.step(1);
  else if (cmd === 'previous') p.step(-1);
  else if (cmd === 'sleep') {
    // Music's own sleep timer: it fades out and stops (MUSIC.md's sleep timer). 0 turns it off.
    const before = Math.ceil(sleepLeft());
    p.setSleepTimer(Math.max(0, minutes) * 60, false);
    tick();
    return { ok: true, text: minutes > 0 ? `Music stops in ${minutes} minutes.` : 'Sleep timer off.', undo: () => p.setSleepTimer(before, false) };
  } else if (cmd === 'never') {
    const t = p.track;
    const lib = m.w.__cp?.library;
    if (!t || !lib?.setRating) return { ok: false, text: "Couldn't reach the song." };
    const before = t.rating ?? 0;
    // The library tells Music's page, which sends the rating as a sense (th/music/ratings.js).
    lib.setRating(t, 1);
    p.step(1);
    return {
      ok: true,
      text: 'Skipped. Rated "not for me": it won\'t come up again.',
      // The bus sends the old rating back as a sense too.
      undo: () => lib.setRating(t, before),
    };
  }
  tick();
  return { ok: true, text: { pause: 'Paused.', play: 'Playing.', next: 'Next song.', previous: 'Previous song.' }[cmd] ?? '' };
}


/** @type {Promise<void>|null} */
let sheet=null;
function styles() {
  return sheet ??= new Promise(resolve=>{
    const link=document.createElement('link'); link.rel='stylesheet'; link.href='/th/island/island.css';
    link.onload=()=>resolve(); link.onerror=()=>resolve(); document.head.append(link);
  });
}
