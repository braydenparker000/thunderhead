// @ts-check
// A single capsule, retained players, and one reversible clip from its measured shape (HOME §12).
import { appFor } from '../registry/apps.js';
import { animator, motionReduced, springs, restTime, response, haptic } from '../motion.js';
import { frames, retain } from './frames.js';
export const LAYERED = Object.freeze(['music', 'podcasts']);
/** @param {string} id */
export const layered = id => LAYERED.includes(id);
const BARS = 5, HOLD_MS = 450;
// The expanded capsule (HOME §12.1): a glyph row, the 72 px art beside a title of up to two lines,
// the progress line, then the times under its ends and the controls between them.
const TALL = 180, ART = 72, ART_Y = 38, LINE_Y = 124;
const clamp = (/** @type {number} */ n) => Math.max(0, Math.min(1, n));
/** @type {import('./frames.js').Layer|null} */
let layer = null;
/** @type {HTMLDivElement|null} */
let island = null;
/** The shared artwork node and the progress line (moved by transform only), then the compact and expanded groups. @type {HTMLElement[]} */
let movers = [];
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
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** @param {string} name */
function ms(name) {
  const v = token(`--d-${name}`);
  return parseFloat(v) * (v.endsWith('ms') ? 1 : 1000);
}
const springOptions = (name = 'base') => ({ spring:springs.island, timeScale:ms(name) / restTime(springs.island) || 1 });
// The compact title and bars hand off to the details at 40% of the shape: out by 40%, in from it.
// Opacity is set on the two groups themselves, so a frame restyles them and not the whole capsule.
let faded = '';
const content = animator(v => {
  if (!island) return;
  const r = motionReduced(), c = String(1 - clamp(r ? v : v / .4)), d = String(clamp(r ? v : (v - .4) / .6)), [art, line, compact, details] = movers;
  if (`${c} ${d}` === faded) return;
  faded = `${c} ${d}`; compact.style.opacity = c; details.style.opacity = d;
  // The artwork's app icon and the line's track arrive with the details.
  art.style.setProperty('--details', d); line.style.setProperty('--details', d);
}, { unit:'opacity' });
const shape = animator(paint, { unit:'scalar' });
const alertWidth = animator(paint);
/** 0: the app-colour dot fills the compact lobe; 1: the artwork does. */
const artOn = animator(paint, { unit:'scalar' });
/** Draws the capsule at the shape's value, without resetting an in-flight spring or its velocity. */
function paint() {
  if (!island) return;
  const p = clamp(shape.value), width = Math.min(360, innerWidth - 24), s = island.style, [art, line] = movers;
  // Finish growing at 80%, then squish out by 4% and settle on the same spring clock.
  const squish = p > .8 ? Math.sin(Math.PI * (p - .8) / .2) * width * .04 : 0;
  s.width = `${compactWidth + (width - compactWidth) * clamp(p / .8) + squish + alertWidth.value * (1 - p)}px`;
  s.height = `${36 + (TALL - 36) * p}px`;
  s.borderRadius = `${18 + 10 * p}px`;
  // One artwork node travels and scales from the compact lobe (24 px with 7 px corners, or the 22 px
  // dot without art) to the 72 px art with 16 px corners. Corners are in its own unscaled pixels.
  const a = clamp(artOn.value), from = 22 + 2 * a, k = (from + (ART - from) * p) / ART, at = (36 - from) / 2;
  art.style.transform = `translate(${at + (16 - at) * p}px,${at + (ART_Y - at) * p}px) scale(${k})`;
  art.style.borderRadius = `${((from / 2 + (7 - from / 2) * a) * (1 - p) + 16 * p) / k}px`;
  // The progress line rises above the times and thickens from 2 to 3 px.
  line.style.transform = `translateY(${33 + (LINE_Y - 33) * p}px) scaleY(${(2 + p) / 3})`;
  if (!motionReduced()) content.set(p);
}
const capsuleFade = animator(v => { if (island) island.style.opacity = String(clamp(v)); }, { unit:'opacity' });
// Play or pause swells the capsule to 1.03 and back on springs.pop: one impulse, in thousandths.
const pulse = animator(v => { if (island) island.style.scale = String(1 + v / 1000); });
function kick() {
  let peak = 0;
  for (let t = 0; t < .5; t += .002) peak = Math.max(peak, response(springs.pop, t, 0, 1, 0).value);
  pulse.to(0, { spring:springs.pop, velocity:30 / peak });
}
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
  await Promise.all([shape, content, alertWidth, artOn, pulse, morph, capsuleFade].map(a => a.whenResting()));
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
    expanded = false; marquee(-1); shape.set(0); content.set(0); capsuleFade.set(1);
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
    touch(); marquee();
  }
  void why;
}
/** @param {string} why */
export async function expand(why) {
  if (!layer || layer.front) return;
  const l = layer, current = ++flight, is = ensureIsland();
  clearTimeout(idleClose); marquee(-1);
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
  const w = /** @type {any} */ (l.frame.contentWindow);
  if (!w) return;
  /** @type {{x:number,y:number,lastY:number,t:number}|null} */
  let s = null;
  const on = { capture:true, passive:true };
  // Podcasts' swipe starts on its mini player or tab bar (its page scrolls); Music's in its bottom 150 px.
  /** @param {any} target @param {number} x @param {number} y @param {number} t */
  const down = (target, x, y, t) => {
    const zone = w.document.getElementById('mini-player') ? target?.closest?.('#mini-player,.podcast-nav') : y > w.innerHeight-150;
    s = zone ? {x,y,lastY:y,t} : null;
  };
  /** @param {number} x @param {number} y @param {number} t */
  const move = (x, y, t) => {
    if (!s || layer !== l || !l.front) return;
    const dy = y-s.y, velocity = (y-s.lastY)*1000/Math.max(1,t-s.t);
    s.lastY=y; s.t=t;
    if (dy > 56 && dy > Math.abs(x-s.x)*1.4) { s=null; void collapse('swipe down',velocity); }
  };
  try {
    // Touch is read from touch events: they keep arriving while a page pans, where the browser
    // cancels the pointer stream after a few pixels (Podcasts pans; Music is touch-action:none).
    w.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { if (e.pointerType !== 'touch') down(e.target,e.clientX,e.clientY,e.timeStamp); }, on);
    w.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => { if (e.pointerType !== 'touch') move(e.clientX,e.clientY,e.timeStamp); }, on);
    w.addEventListener('touchstart', (/** @type {TouchEvent} */ e) => { const p = e.touches[0]; if (e.touches.length === 1) down(e.target,p.clientX,p.clientY,e.timeStamp); else s=null; }, on);
    w.addEventListener('touchmove', (/** @type {TouchEvent} */ e) => { const p = e.touches[0]; if (p) move(p.clientX,p.clientY,e.timeStamp); }, on);
    for (const type of ['pointerup','touchend','touchcancel']) w.addEventListener(type, () => {s=null;});
    w.addEventListener('pointercancel', (/** @type {PointerEvent} */ e) => { if (e.pointerType !== 'touch') s=null; });
    // An app's own way home (Podcasts' top-left arrow is a link to "/") shrinks the layer here,
    // instead of loading home inside the frame.
    w.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      const a = /** @type {any} */ (e.target)?.closest?.('a[href]');
      if (!a || layer !== l || !l.front || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const u = new URL(a.href, w.location.href);
      if (u.origin === location.origin && u.pathname === '/') { e.preventDefault(); void collapse('home link'); }
    }, true);
  } catch {}
}
/** @param {string} name */
const use = name => `<use href="/ui/icons.svg#${name}"/>`;
/** @param {string} name @param {string} [more] */
const icon = (name, more = '') => `<svg class="i${more}" aria-hidden="true">${use(name)}</svg>`;
function ensureIsland() {
  if (island) return island;
  const b = document.createElement('div');
  b.setAttribute('role','group');
  b.className='th-island'; b.hidden=true; b.dataset.state='compact';
  b.innerHTML = `<button type="button" class="compact" aria-label="Expand player" aria-expanded="false"><span class="title-mask"><span class="title"></span></span><span class="bars">${'<i></i>'.repeat(BARS)}</span><span class="alert-dot"></span></button><div class="details" inert>${icon('music-notes-simple-bold',' glyph')}<button type="button" class="zz" aria-label="Sleep timer">${icon('moon-stars')}<b></b></button><button type="button" class="heading" aria-label="Open app"><span class="tt"></span><span class="by"></span></button><span class="elapsed"></span><span class="left"></span><div class="controls"><button type="button" data-control="previous" aria-label="Previous"></button><button type="button" data-control="toggle" aria-label="Play">${icon('play')}</button><button type="button" data-control="next" aria-label="Next"></button></div></div><span class="art" aria-hidden="true"><canvas width="144" height="144"></canvas>${icon('music-notes-simple')}</span><div class="progress"><i></i></div>`;
  document.body.append(b); island=b;
  movers = /** @type {HTMLElement[]} */ (['.art','.progress','.compact','.details'].map(s => b.querySelector(s)));
  b.querySelector('.compact')?.addEventListener('click', e => { if (!held || !/** @type {MouseEvent} */ (e).detail) void wide(true); held=false; });
  for (const node of b.querySelectorAll('.art,.heading')) node.addEventListener('click', () => { if (expanded) void expand('island'); });
  for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (b.querySelectorAll('[data-control]'))) button.addEventListener('click', () => {
    const cmd = button.dataset.control;
    if (cmd === 'toggle') kick();
    control(cmd === 'toggle' ? playing() ? 'pause' : 'play' : /** @type {'next'|'previous'} */ (cmd));
    touch(); haptic('choose');
  });
  b.querySelector('.zz')?.addEventListener('click', () => { toastOf(control('sleep', sleepLeft() ? 0 : 30)); touch(); });
  gestures(b);
  document.addEventListener('pointerdown', e => { if (expanded && !b.contains(/** @type {Node} */ (e.target))) void wide(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) { void wide(false); /** @type {HTMLElement} */ (b.querySelector('.compact')).focus(); } });
  // The title's width is measured again once Switzer has loaded.
  document.fonts?.addEventListener('loadingdone', () => { lastTitle = ''; });
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
  marquee(-1);
  shape.to(on?1:0,springOptions());
  if (motionReduced()) content.to(on?1:0);
  touch(); if(on) haptic('open');
  await whenResting();
  if (!expanded) marquee();
}
let held=false;
/** @param {HTMLElement} b */
function gestures(b) {
  /** @type {{x:number,y:number}|null} */ let start=null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let hold;
  b.addEventListener('pointerdown', e => {
    // A touch stops a scrolling title; a hold alone does nothing (no marquee).
    touching=true; touch(); held=false; start={x:e.clientX,y:e.clientY}; marquee(-1);
    if (!expanded) hold=setTimeout(() => { held=true; },HOLD_MS);
  });
  b.addEventListener('pointermove', e => {
    if (!start) return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;
    if (Math.abs(dy)>30 && dy < -Math.abs(dx)) { held=true; clearTimeout(hold); start=null; void wide(false); }
    else if (!expanded && Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*1.5) { held=true; clearTimeout(hold); start=null; control(dx<0?'next':'previous'); }
  });
  const end=() => {if(!touching) return; touching=false; clearTimeout(hold); start=null; touch(); if (!expanded) marquee();};
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
let marqueeRun = 0;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let marqueeWait;
/**
 * A title too long for the capsule (HOME §12.1): after `delay` ms at rest it scrolls once to its end at
 * 40 px/s, holds 1.5 s, snaps back, and rests 8 s before the next pass. A negative delay only stops it.
 */
function marquee(delay = 2000) {
  const run = ++marqueeRun, text = /** @type {HTMLElement|null} */ (island?.querySelector('.title'));
  clearTimeout(marqueeWait);
  if (!island || !text) return;
  const is = island;
  // An engine without linear() easings snaps back without the curve.
  /** @param {number} from */
  const back = from => { try { text.animate([{transform:`translateX(${from}px)`},{transform:'none'}], {duration:ms('quick'), easing:token('--pop')}); } catch {} };
  const at = new DOMMatrix(getComputedStyle(text).transform).e;
  for (const a of text.getAnimations()) a.cancel();
  if (at < -1) back(at);
  is.classList.remove('scrolling');
  const wait = (/** @type {number} */ t) => new Promise(r => { marqueeWait = setTimeout(r, t); });
  if (delay >= 0) void (async () => {
    await wait(delay);
    while (run === marqueeRun) {
      const end = text.parentElement ? text.parentElement.clientWidth - text.scrollWidth - 16 : 0;
      if (end >= -16 || motionReduced()) return;
      // Only while the capsule rests, compact and untouched, in a visible page.
      if (expanded || touching || is.hidden || document.hidden || !shape.resting || !alertWidth.resting || layer?.front) { await wait(2000); continue; }
      is.classList.add('scrolling');
      // 40 px/s: 25 ms a pixel, on to 16 px past the end so its last letter clears the fade.
      const scroll = text.animate([{transform:'none'},{transform:`translateX(${end}px)`}], {duration:-end * 25, easing:token('--ease-linear'), fill:'forwards'});
      await scroll.finished.catch(() => {});
      if (run !== marqueeRun) return;
      await wait(1500);
      if (run !== marqueeRun) return;
      scroll.cancel(); back(end); is.classList.remove('scrolling');
      await wait(ms('quick') + 8000);
    }
  })();
}
const time = (/** @type {number} */ s) => {
  const t = Math.max(0, Math.floor(s)), m = Math.floor(t / 60), x = String(t % 60).padStart(2,'0');
  return m < 60 ? `${m}:${x}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2,'0')}:${x}`;
};
let lastArt='', lastTitle='', titleViewport=0, lastApp='';
let meterData=new Uint8Array(0);
/**
 * The app's artwork, drawn once into the shared node. Fetched inside its app (its worker and CSP),
 * decoded off the main thread (createImageBitmap, or img.decode() for a data: URL), and drawn only
 * while the capsule rests, so it never holds up a morph. A failed load keeps the dot.
 * @param {string} src @param {any} m
 */
async function showArt(src, m) {
  const [art] = movers, canvas = /** @type {HTMLCanvasElement} */ (art.querySelector('canvas'));
  const image = async (/** @type {string} */ url) => { const i = new Image(); i.src = url; await i.decode(); return i; };
  /** @type {any} */ let bits = null;
  try {
    if (src.startsWith('data:image/')) bits = await image(src);
    else if (src) {
      /** @type {Blob|null} */ let blob = null;
      try { const r = await m.w.fetch(src, { referrerPolicy:'no-referrer' }); if (r.ok) blob = await r.blob(); } catch {}
      // An SVG has no bitmap decoder; a host without CORS leaves the app's own <img>, already decoded.
      if (blob) bits = await createImageBitmap(blob).catch(() => new Promise(done => { const f = new FileReader(); f.onload = () => done(image(String(f.result))); f.onerror = () => done(null); f.readAsDataURL(/** @type {Blob} */ (blob)); }));
      else { const own = [...m.w.document.images].find(i => i.currentSrc === src && i.naturalWidth); if (own) bits = await createImageBitmap(own); }
    }
  } catch {}
  if (!shape.resting) await shape.whenResting();
  if (src !== lastArt) return bits?.close?.();
  art.classList.toggle('has-art', Boolean(bits));
  artOn.to(bits ? 1 : 0, springOptions('fast'));
  if (!bits) return;
  const w = bits.naturalWidth || bits.width, h = bits.naturalHeight || bits.height, side = Math.min(w, h), g = canvas.getContext('2d');
  g?.clearRect(0, 0, 144, 144);
  g?.drawImage(bits, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 144, 144);
  bits.close?.();
}
/** Titles and artwork stay in this page. Fetch artwork inside its app, under that app's CSP. */
function tick() {
  cancelAnimationFrame(raf); clearTimeout(slow);
  const is=island;
  if (!is || !layer) return;
  const m=media(), app=appFor(layer.id), on=playing(), pod=layer.id==='podcasts';
  const meta=m?.w.navigator.mediaSession?.metadata;
  const t=m?.kind==='music' ? m.p.track : null;
  // Podcasts names its episode in the media session only once it plays; before that, its player says.
  const page=(/** @type {string} */ id)=>pod ? m?.w.document.getElementById(id) : null;
  const title=t?.title || meta?.title || page('player-title')?.textContent || app?.name || '', by=t?.artist || meta?.artist || page('player-show')?.textContent || '';
  const shown=page('player-art')?.currentSrc ?? '', art=t?.art?.url || meta?.artwork?.[0]?.src || (/^https?:/.test(shown) ? shown : '');
  for (const node of is.querySelectorAll('.title,.tt')) if(node.textContent!==title) node.textContent=title;
  const sub=/** @type {HTMLElement} */ (is.querySelector('.by')); if(sub.textContent!==by) sub.textContent=by;
  if (lastApp !== layer.id) {
    lastApp = layer.id;
    is.style.setProperty('--c',app?.color ?? '#2f7df6');
    /** @type {Element} */ (is.querySelector('.glyph')).innerHTML=use(`${app?.icon}-bold`);
    /** @type {Element} */ (is.querySelector('.art .i')).innerHTML=use(app?.icon ?? '');
    // Podcasts skips 15 s back and 30 s on; Music steps through its queue.
    const [previous, next] = /** @type {HTMLElement[]} */ ([...is.querySelectorAll('[data-control="previous"],[data-control="next"]')]);
    previous.innerHTML=pod ? `<b>15</b>${icon('arrow-counter-clockwise')}` : icon('play');
    next.innerHTML=pod ? `<b>30</b>${icon('arrow-clockwise')}` : icon('play');
    previous.setAttribute('aria-label', pod ? 'Back 15 seconds' : 'Previous');
    next.setAttribute('aria-label', pod ? 'Forward 30 seconds' : 'Next');
  }
  is.dataset.app=layer.id;
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
  movers[1].style.setProperty('--progress',String(duration?clamp(elapsed/duration):0));
  /** @type {HTMLElement} */ (is.querySelector('.elapsed')).textContent=time(elapsed);
  /** @type {HTMLElement} */ (is.querySelector('.left')).textContent=duration ? `−${time(duration-elapsed)}` : '';
  const text=/** @type {HTMLElement} */ (is.querySelector('.title'));
  if (title!==lastTitle || titleViewport!==innerWidth) {
    lastTitle=title; titleViewport=innerWidth;
    // The capsule grows with its title up to 60% of the viewport; past that the title fades out.
    const need=text.scrollWidth+85, most=innerWidth*.6;
    compactWidth=Math.max(124,Math.min(most,need));
    is.classList.toggle('long',need>most);
    paint(); marquee();
  }
  if (art!==lastArt && !layer.front) { lastArt=art; void showArt(art, m); }
  const an=m?.kind==='music' && !motionReduced() && !document.hidden && !layer.front && on ? m.w.__cp?.dsp?.nodes?.analyser : null;
  is.classList.toggle('live',Boolean(an));
  // Without an analyser, retain the playing-only fallback; reduced motion and pause stop it.
  is.querySelectorAll('.bars i').forEach((bar,i)=>{
    const animations=bar.getAnimations();
    const breathe=on && !an && !layer?.front && !document.hidden && !motionReduced();
    if(!breathe) for(const animation of animations) animation.cancel();
    else if(!animations.length) bar.animate([{transform:'scaleY(.25)'},{transform:'scaleY(1)'}],
      {duration:ms('rise')*(.6+i*.08),easing:token('--settle'),iterations:Infinity,direction:'alternate'});
  });
  if(an) {
    if(meterData.length!==an.frequencyBinCount) meterData=new Uint8Array(an.frequencyBinCount);
    const bars=/** @type {NodeListOf<HTMLElement>} */ (is.querySelectorAll('.bars i'));
    const step=Math.max(1,Math.floor(meterData.length/3/BARS));
    const draw=()=>{
      if(document.hidden || layer?.front || motionReduced()) return;
      // The bars are out of sight while expanded or morphing: no style writes then.
      if(!expanded && shape.resting) {
        an.getByteFrequencyData(meterData);
        bars.forEach((b,i)=>{let sum=0;for(let k=0;k<step;k++) sum+=meterData[i*step+k]??0;b.style.transform=`scaleY(${Math.max(.18,Math.min(1,sum/step/190))})`;});
      }
      raf=requestAnimationFrame(draw);
    };
    draw();
  }
  if(!layer.front) slow=setTimeout(tick,500);
  notices();
}
addEventListener('resize',()=>{ if(layer && !layer.front){tick();paint();} });
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
