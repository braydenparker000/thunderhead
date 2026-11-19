// @ts-check
// The capsule (HOME §12.1): what it shows, its alerts, long titles and expanded card.
import { appFor } from '../registry/apps.js';
import { haptic, motionReduced } from '../motion.js';
import { pref, prefNum, prefOn } from '../pref.js';
import { saidFor } from './line.js';
import { st, control, playing, sleepLeft, media, expand } from './island.js';
import { shape, morph, alertWidth, artOn, paint, size, movers, go, grow, settle, kick, pulse, nudge, slide, ms, token, clamp, whenResting } from './shape.js';
import { grip } from './hand.js';
const sleepy = () => pref('island.controls') === 'play-next-sleep';
const sleepTap = () => control('sleep', sleepLeft() ? 0 : prefNum('island.sleep_min', 30));
let idleClose = 0, alertEnd = 0, slow = 0, marqueeWait = 0, raf = 0, rise = 0;
/** @param {{text:string,undo?:()=>void}} r */
const toastOf = r => void import('../ui.js').then(({toast}) => toast(r.text, r.undo ? {label:'Undo',run:r.undo} : undefined));
const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (st.island?.querySelector(s));
const use = (/** @type {string} */ name) => `<use href="/ui/icons.svg#${name}"/>`;
const icon = (/** @type {string} */ name, more = '') => `<svg class="i${more}" aria-hidden="true">${use(name)}</svg>`;
export function ensureIsland() {
  if (st.island) return st.island;
  const b = st.island = document.createElement('div');
  b.setAttribute('role','group');
  b.className='th-island'; b.hidden=true; b.dataset.state='compact';
  // Play and pause are both drawn: a swapped icon took frames to appear.
  b.innerHTML = `<i class="fill"></i><button class="compact" aria-expanded="false"><span class="title-mask"><span class="title"></span></span><span class="bars">${'<i></i>'.repeat(5)}</span><span class="alert-dot"></span></button><div class="details" inert>${icon('music-notes-simple-bold',' glyph')}<span class="say"></span><button class="zz" aria-label="Sleep timer">${icon('moon-stars')}<b></b></button><button class="heading"><span class="tt"></span><span class="by"></span></button><span class="elapsed"></span><span class="left"></span><div class="controls"><button data-control="previous"></button><button data-control="toggle">${icon('play',' play')}${icon('pause',' pause')}</button><button data-control="next"></button></div></div><span class="art" aria-hidden="true"><canvas width="144" height="144"></canvas>${icon('music-notes-simple')}</span><div class="progress"><i></i></div>`;
  document.body.append(b);
  movers.push(...['.art','.progress','.compact','.details','.fill'].map($));
  $('.compact').addEventListener('click', e => { if (!st.held || !e.detail) void wide(true); st.held=false; });
  for (const node of b.querySelectorAll('.art,.heading')) node.addEventListener('click', () => { if (st.expanded) void expand('island'); });
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (b.querySelectorAll('[data-control]'))) button.addEventListener('click', () => {
    const cmd = button.dataset.control, on = !b.classList.contains('playing');
    if (cmd === 'toggle') { want = [on, performance.now() + 1500]; flip(on); }
    if (cmd === 'previous' && sleepy()) toastOf(sleepTap());
    else control(cmd === 'toggle' ? on ? 'play' : 'pause' : /** @type {'next'|'previous'} */ (cmd));
    touch(); haptic('choose');
  });
  $('.zz').addEventListener('click', () => { toastOf(sleepTap()); touch(); });
  document.addEventListener('th:setting', e => { if (/** @type {CustomEvent} */ (e).detail?.key === 'island.controls') lastApp = ''; });
  grip(b);
  document.addEventListener('pointerdown', e => { if (st.expanded && !b.contains(/** @type {Node} */ (e.target))) void wide(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.expanded) { void wide(false); $('.compact').focus(); } });
  document.fonts?.addEventListener('loadingdone', () => { lastTitle = ''; });
  const changes = new MutationObserver(notices);
  for (const node of document.querySelectorAll('#talk,#decision')) changes.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('th:decisions', notices);
  document.addEventListener('th:island-line', () => { if (st.layer && !st.layer.front) tick(); });
  document.addEventListener('click', e => { const note = /** @type {Element} */ (e.target).closest?.('#talk .note'); if (note && about(note)) void wide(true); });
  addEventListener('resize', () => { if (st.layer && !st.layer.front) { tick(); layout(); paint(); } });
  notices();
  return b;
}
export function reset() { ensureIsland().hidden = false; st.expanded = false; marquee(-1); shape.set(0); state(); tick(); }
function state() {
  const on = st.expanded, compact = $('.compact');
  ensureIsland().dataset.state = on ? 'expanded' : st.island?.classList.contains('alert') ? 'alert' : 'compact';
  compact.setAttribute('aria-expanded', String(on)); compact.inert = on; $('.details').inert = !on;
}
export function hush() { clearTimeout(idleClose); marquee(-1); shape.stop(); alertWidth.stop(); }
export function touch() { clearTimeout(idleClose); if (st.expanded && !st.touching) idleClose=setTimeout(() => void wide(false),6000); }
/** @param {boolean} [on] @param {number} [velocity] in shape units a second, from a drag */
export async function wide(on=true, velocity) {
  if (!st.layer || st.layer.front) return;
  st.expanded = on; state(); marquee(-1);
  go(on ? 'island:expand' : 'island:collapse', shape, +on, { spring: on ? grow() : settle(), velocity });
  touch(); if(on) haptic('open');
  await whenResting();
  if (!st.expanded) { marquee(); tick(); }
}
/** @param {Element} note */
const about = note => Boolean(st.layer && new RegExp(`\\b${st.layer.id === 'music' ? 'music' : 'podcasts?'}\\b`,'i').test(note.textContent ?? ''));
let noticeKey='';
function notices() {
  const is = st.island;
  if (!is) return;
  const notes=[...document.querySelectorAll('#talk .note')].filter(about);
  const decision=document.querySelector('#decision .card:not(.gone)');
  const key=prefOn('island.alerts') ? notes.map(n=>n.closest('[data-id]')?.getAttribute('data-id') ?? n.textContent).join('|') + (decision?.textContent ?? '') : '';
  is.classList.toggle('alert',Boolean(key));
  if (key && key!==noticeKey) {
    // A second thing: 24 px wider for a gold dot, and back.
    clearTimeout(alertEnd); is.classList.add('alert-flash'); layout();
    if (!st.expanded) is.dataset.state='alert';
    go('island:alert', alertWidth, 24, { spring: grow() });
    alertEnd=setTimeout(() => {
      is.classList.remove('alert-flash'); layout();
      go('island:alert', alertWidth, 0, { spring: settle() });
      if (!st.expanded) is.dataset.state='compact';
    },1200);
  }
  noticeKey=key;
}
let marqueeRun = 0;
/** A long title, `delay` ms after rest, scrolls once at 40 px/s, holds 1.5 s, returns, rests 8 s; delay < 0 stops it. */
export function marquee(delay = 2000) {
  const run = ++marqueeRun, is = st.island, text = $('.title'), wait = (/** @type {number} */ t) => new Promise(r => { marqueeWait = setTimeout(r, t); });
  clearTimeout(marqueeWait);
  if (!is || !text) return;
  const back = (/** @type {number} */ from) => { try { text.animate([{transform:`translateX(${from}px)`},{transform:'none'}], {duration:ms('quick'), easing:token('--pop')}); } catch {} };
  const at = new DOMMatrix(getComputedStyle(text).transform).e;
  for (const a of text.getAnimations()) a.cancel();
  if (at < -1) back(at);
  is.classList.remove('scrolling');
  if (delay >= 0) void (async () => {
    for (await wait(delay); run === marqueeRun;) {
      const end = text.parentElement ? text.parentElement.clientWidth - text.scrollWidth - 16 : 0;
      if (end >= -16 || motionReduced() || pref('island.titles') === 'fade') return;
      if (st.expanded || st.touching || is.hidden || document.hidden || !shape.resting || !alertWidth.resting || st.layer?.front) { await wait(2000); continue; }
      is.classList.add('scrolling');
      // 25 ms a pixel, to 16 px past the end (clear of the fade).
      const scroll = text.animate([{transform:'none'},{transform:`translateX(${end}px)`}], {duration:-end * 25, easing:token('--ease-linear'), fill:'forwards'});
      await scroll.finished.catch(() => {});
      if (run !== marqueeRun || (await wait(1500), run !== marqueeRun)) return;
      scroll.cancel(); back(end); is.classList.remove('scrolling');
      await wait(ms('quick') + 8000);
    }
  })();
}
const time = (/** @type {number} */ s) => {
  const t = Math.max(0, Math.floor(s)), m = Math.floor(t / 60), x = String(t % 60).padStart(2,'0');
  return m < 60 ? `${m}:${x}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2,'0')}:${x}`;
};
let lastArt='', lastTitle='', titleViewport=0, lastApp='', lastIndex=-1, /** @type {boolean|null} */ wasOn=null, meterData=new Uint8Array(0);
/** @type {[boolean, number]|null} */
let want = null;
/** The compact width: with its title, to 60% of the viewport; a bar spans the top. */
function layout() {
  const is = /** @type {HTMLElement} */ (st.island), need = $('.title').scrollWidth + 85, most = innerWidth * .6, bar = document.documentElement.dataset.island === 'bar', c = $('.compact').style;
  size.w = bar ? innerWidth - 24 : Math.max(124, Math.min(most, need));
  size.r = bar ? parseFloat(token('--r-m')) || 14 : 18;
  is.classList.toggle('long', need > most);
  c.left = `${(innerWidth - size.w) / 2}px`; c.width = `${size.w + (is.classList.contains('alert-flash') ? 24 : 0)}px`;
}
/** The artwork: fetched in its app (its worker, CSP), decoded off the main thread, drawn at rest; failing, the dot. @param {string} src @param {any} m */
async function showArt(src, m) {
  const [art] = movers, image = async (/** @type {string} */ url) => { const i = new Image(); i.src = url; await i.decode(); return i; };
  /** @type {any} */ let bits = null;
  try {
    if (src.startsWith('data:image/')) bits = await image(src);
    else if (src) {
      /** @type {Blob|null} */ let blob = null;
      try { const r = await m.w.fetch(src, { referrerPolicy:'no-referrer' }); if (r.ok) blob = await r.blob(); } catch {}
      // An SVG has no bitmap decoder; a host without CORS leaves the app's own decoded <img>.
      if (blob) bits = await createImageBitmap(blob).catch(() => new Promise(done => { const f = new FileReader(); f.onload = () => done(image(String(f.result))); f.onerror = () => done(null); f.readAsDataURL(/** @type {Blob} */ (blob)); }));
      else { const own = [...m.w.document.images].find(i => i.currentSrc === src && i.naturalWidth); if (own) bits = await createImageBitmap(own); }
    }
  } catch {}
  if (!shape.resting) await shape.whenResting();
  if (src !== lastArt) return bits?.close?.();
  art.classList.toggle('has-art', Boolean(bits));
  go('island:art', artOn, +!!bits, { spring: settle() });
  const g = /** @type {HTMLCanvasElement} */ (art.firstChild).getContext('2d');
  if (!bits || !g) return;
  const w = bits.naturalWidth || bits.width, h = bits.naturalHeight || bits.height, side = Math.min(w, h);
  g.clearRect(0, 0, 144, 144);
  g.drawImage(bits, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 144, 144);
  bits.close?.();
}
/** Play or pause: a breath, the icon turns, the bars settle to a line or rise. */
function flip(/** @type {boolean} */ on, seen = true) {
  const r = motionReduced();
  wasOn = on; st.island?.classList.toggle('playing', on);
  if (seen && !r) kick(pulse, 30, 'island:pause');
  rise = performance.now();
  for (const bar of /** @type {NodeListOf<HTMLElement>} */ (st.island?.querySelectorAll('.bars i') ?? [])) {
    const from = getComputedStyle(bar).transform;
    for (const a of bar.getAnimations()) a.cancel();
    bar.style.transform = on || r ? '' : from;
    if (!on && !r) bar.animate([{transform:from},{transform:'scaleY(.15)'}], {duration:ms('base'), easing:token('--settle'), fill:'forwards'});
  }
}
export function tick() {
  cancelAnimationFrame(raf); clearTimeout(slow);
  const is=st.island, layer=st.layer;
  if (!is || !layer) return;
  // The island's play or pause shows at once, before the app's fade ends.
  const real=playing(), on=want && real!==want[0] && performance.now()<want[1] ? want[0] : (want=null, real);
  const m=media(), app=appFor(layer.id), pod=layer.id==='podcasts', r=motionReduced(), meta=m?.w.navigator.mediaSession?.metadata, t=m?.kind==='music' ? m.p.track : null;
  // Podcasts' episode: from the media session once it plays, else its player.
  const page=(/** @type {string} */ id)=>pod ? m?.w.document.getElementById(id) : null;
  const title=t?.title || meta?.title || page('player-title')?.textContent || app?.name || '', by=t?.artist || meta?.artist || page('player-show')?.textContent || '';
  const shown=page('player-art')?.currentSrc ?? '', art=t?.art?.url || meta?.artwork?.[0]?.src || (/^https?:/.test(shown) ? shown : '');
  // A song change from anywhere slides before its title is written; a skip in an episode nudges.
  const index=m?.kind==='music' ? m.p.index : -1, dir=st.dir || Math.sign(index-lastIndex)*+(lastIndex>=0), was=$('.tt').textContent;
  const seen=lastApp===layer.id && !layer.front && !is.hidden && morph.resting && morph.value===1;
  if (seen && dir && was) { if (was!==title) slide(dir, st.from); else if (st.dir && !r) kick(nudge, -4*dir, 'island:skip'); }
  st.dir=0; st.from=0; lastIndex=index;
  // The mind's line (line.js) takes the compact title's place.
  const said=saidFor(layer.id), top=said || title, text=(/** @type {string} */ s, /** @type {string} */ v)=>{ if($(s).textContent!==v) $(s).textContent=v; };
  text('.title', top); text('.tt', title); text('.say', said); text('.by', by);
  is.classList.toggle('said',Boolean(said));
  if (lastApp !== layer.id) {
    lastApp = layer.id; wasOn = null;
    is.style.setProperty('--c',app?.color ?? '#2f7df6');
    $('.glyph').innerHTML=use(`${app?.icon}-bold`);
    $('.art .i').innerHTML=use(app?.icon ?? '');
    // Podcasts skips 15 s back and 30 s on. With "Play, next, sleep" the first button is the timer, last.
    const previous=$('[data-control=previous]'), next=$('[data-control=next]'), zz=sleepy();
    previous.innerHTML=zz ? icon('moon-stars') : pod ? `<b>15</b>${icon('arrow-counter-clockwise')}` : icon('play');
    previous.style.order = zz ? '3' : ''; previous.classList.toggle('zzz', zz);
    next.innerHTML=pod ? `<b>30</b>${icon('arrow-clockwise')}` : icon('play');
    previous.ariaLabel=zz ? 'Sleep timer' : pod ? 'Back 15 seconds' : 'Previous';
    next.ariaLabel=pod ? 'Forward 30 seconds' : 'Next';
  }
  is.dataset.app=layer.id;
  if (wasOn !== null && on !== wasOn) flip(on, seen);
  wasOn = on; is.classList.toggle('playing',on);
  const zz=Math.ceil(sleepLeft()/60); is.classList.toggle('sleep',zz>0);
  text('.zz b', zz?String(zz):'');
  $('.compact').ariaLabel=`${said ? `${said} ` : ''}${title}${by ? `, ${by}` : ''}. Expand ${app?.name} player`;
  $('.heading').ariaLabel=`${title}${by ? `, ${by}` : ''}. Open ${app?.name}`;
  is.ariaLabel=`${app?.name} ${on?'playing':'paused'}${zz?`, stops in ${zz} min`:''}`;
  $('[data-control=toggle]').ariaLabel=on?'Pause':'Play';
  const a=m?.kind==='music'?m.p.audio:m?.a, duration=Number.isFinite(a?.duration)?a.duration:0, elapsed=Number.isFinite(a?.currentTime)?a.currentTime:0;
  movers[1].style.setProperty('--progress',String(duration?clamp(elapsed/duration):0));
  text('.elapsed', time(elapsed)); text('.left', duration ? `−${time(duration-elapsed)}` : '');
  if (top!==lastTitle || titleViewport!==innerWidth) { lastTitle=top; titleViewport=innerWidth; layout(); paint(); marquee(); }
  if (art!==lastArt && !layer.front) { lastArt=art; void showArt(art, m); }
  // The bars move with the sound (or breathe) only while they show: nothing loops out of sight.
  const away=!on || layer.front || document.hidden || r || st.expanded, an=m?.kind==='music' && !away ? m.w.__cp?.dsp?.nodes?.analyser : null;
  const bars=/** @type {NodeListOf<HTMLElement>} */ (is.querySelectorAll('.bars i'));
  is.classList.toggle('live',Boolean(an));
  bars.forEach((bar,i)=>{
    const loops=bar.getAnimations().filter(x=>x.effect?.getTiming().iterations===Infinity);
    if(away || an) for(const loop of loops) loop.cancel();
    else if(!loops.length) bar.animate([{transform:'scaleY(.25)'},{transform:'scaleY(1)'}], {duration:ms('rise')*(.6+i*.08),easing:token('--settle'),iterations:Infinity,direction:'alternate'});
  });
  if(an) {
    if(meterData.length!==an.frequencyBinCount) meterData=new Uint8Array(an.frequencyBinCount);
    const step=Math.max(1,Math.floor(meterData.length/15)), draw=()=>{
      raf=0;
      if(document.hidden || layer.front || st.expanded || !shape.resting || motionReduced()) return;
      an.getByteFrequencyData(meterData);
      const g=clamp((performance.now()-rise)/ms('base'));
      bars.forEach((b,i)=>{let sum=0;for(let k=0;k<step;k++) sum+=meterData[i*step+k]??0;b.style.transform=`scaleY(${Math.max(.15,Math.min(1,sum/step/190)*g)})`;});
      raf=requestAnimationFrame(draw);
    };
    draw();
  }
  if(!layer.front) slow=setTimeout(tick,500);
  notices();
}
