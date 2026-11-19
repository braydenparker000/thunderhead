// @ts-check
// Music and Podcasts as layers inside home and the island they shrink into (HOME §12.1): loaded at idle (warm.js);
// the capsule (capsule.js, shape.js, hand.js) loads when it first appears.
import { appFor } from '../registry/apps.js';
import { frames, retain } from './frames.js';
import { drop } from './line.js';
export const LAYERED = Object.freeze(['music', 'podcasts']);
export const layered = (/** @type {string} */ id) => LAYERED.includes(id);
/** Shared state; c, s, h are the modules. @type {{layer:import('./frames.js').Layer|null,island:HTMLDivElement|null,expanded:boolean,touching:boolean,held:boolean,flight:number,dir:number,from:number,c:any,s:any,h:any}} */
export const st = { layer: null, island: null, expanded: false, touching: false, held: false, flight: 0, dir: 0, from: 0, c: null, s: null, h: null };
/** @type {{end:number,timer:number}|null} */
let podSleep = null;
/** @type {Promise<void>|null} */
let sheet = null, loading = null;
const styles = () => sheet ??= new Promise(resolve => {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/th/island/island.css';
  link.onload = link.onerror = () => resolve(); document.head.append(link);
});
const load = () => loading ??= Promise.all([styles(), import('./capsule.js'), import('./shape.js'), import('./hand.js')]).then(([, c, s, h]) => { st.c = c; st.s = s; st.h = h; });
export const whenResting = () => st.s ? st.s.whenResting() : Promise.resolve();
/** @param {boolean} [on] @param {number} [velocity] */
export const wide = (on = true, velocity) => st.c ? st.c.wide(on, velocity) : Promise.resolve();
/** @returns {{kind:'music',p:any,w:any}|{kind:'podcasts',a:HTMLAudioElement,w:any}|null} */
export function media() {
  try {
    const l = st.layer, w = /** @type {any} */ (l?.frame.contentWindow);
    if (!w || !l) return null;
    if (l.id === 'music') return w.__cp?.player ? { kind:'music', p:w.__cp.player, w } : null;
    const a = w.document?.querySelector('audio');
    return a ? { kind:'podcasts', a, w } : null;
  } catch { return null; }
}
/** The app the capsule shows now, or null (none, or it is in front). */
export const inIsland = () => (st.layer && !st.layer.front && st.island && !st.island.hidden ? st.layer.id : null);
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

/** @param {string} id @param {{cover?:()=>Promise<void>}} [o] */
export async function openApp(id, o = {}) {
  // Island off (Settings → Island): Music and Podcasts open as their own pages, never inside home.
  if (!layered(id) || !appFor(id)?.built || document.documentElement.dataset.island === 'off') return false;
  const started = performance.now();
  // A ring or chip's reveal is retired: the layer grows from the capsule.
  for (const cover of document.querySelectorAll('.launch:not(.th-app-shell)')) { for (const a of cover.getAnimations()) a.cancel(); cover.remove(); }
  await load();
  const next = retain(id, watch), cold = !next.ready;
  if (st.layer !== next) {
    ++st.flight;
    st.s.morph.stop();
    if (st.layer) park(st.layer);
    st.layer = next;
    st.c.reset();
    st.s.morph.set(1);
  }
  void expand('open');
  const opening = st.flight;
  void next.loaded.then(() => requestAnimationFrame(() => {
    if (opening !== st.flight || !next.front || !next.ready) return;
    performance.measure(`th:island:${id}:ready`, {start:started, end:performance.now()});
    document.dispatchEvent(new CustomEvent('th:app-ready', {detail:{app:id,ms:performance.now() - started,cold}}));
  }));
  return true;
}
/** Prewarm only after the chat's first successful load; called by warm.js at idle. */
export async function warm() {
  const no = () => document.documentElement.dataset.signedIn === undefined || /** @type {any} */ (navigator).connection?.saveData;
  // A warm frame needs its worker's session handshake.
  if (no() || !navigator.serviceWorker) return;
  await navigator.serviceWorker.ready;
  await styles();
  for (const f of ['capsule', 'shape', 'hand']) document.head.append(Object.assign(document.createElement('link'), { rel: 'modulepreload', href: `/th/island/${f}.js` }));
  for (const id of LAYERED) {
    if (no()) return;
    // A failed Music boot must not keep Podcasts from warming forever.
    await Promise.race([retain(id, watch).loaded, new Promise(r => setTimeout(r, 15_000))]);
  }
}
/** @param {import('./frames.js').Layer} l */
function park(l) { l.front = false; l.frame.inert = true; l.frame.classList.add('away'); l.shell.classList.remove('launch'); l.shell.classList.add('parked'); }
/** Into the island, from the full screen or where a drag left it. @param {string} why @param {number[]} [from] @param {number[]} [speed] */
export async function collapse(why, from, speed) {
  if (!st.layer?.front) return;
  const l = st.layer, current = ++st.flight, { c, s } = st, is = c.ensureIsland();
  l.front = false; l.frame.inert = true;
  is.hidden = false; is.inert = false;
  c.tick();
  document.body.dataset.island = l.id;
  // A touch on the app on its way in catches it and turns it round.
  l.shell.onpointerdown = () => { if (!l.front && !s.morph.resting) void expand('caught'); };
  s.aim(1, from, speed);
  await whenResting();
  if (current === st.flight && st.layer === l && !l.front) {
    park(l);
    // If the app just left is quiet, the island shows the one still playing.
    if (!playing()) for (const other of frames.values()) {
      try {
        const w=/** @type {any} */ (other.frame.contentWindow), a=other.id==='music'?w.__cp?.player?.audio:w.document.querySelector('audio');
        if(a && !a.paused && !a.ended) {st.layer=other;c.tick();break;}
      } catch {}
    }
    c.touch(); c.marquee();
  }
}
/** @param {string} why */
export async function expand(why) {
  if (!st.layer || st.layer.front) return;
  const l = st.layer, current = ++st.flight, { c, s } = st, is = c.ensureIsland();
  c.hush();
  l.front = true; l.frame.inert = false; l.frame.classList.remove('away'); l.shell.classList.remove('parked');
  drop(l.id);
  l.shell.classList.add('launch');
  is.inert = true;
  delete document.body.dataset.island;
  if (history.state?.th !== 'app') history.pushState({th:'app',app:l.id}, '');
  s.aim(0);
  await whenResting();
  if (current === st.flight && st.layer === l && l.front) { is.hidden = true; l.shell.classList.remove('launch'); }
}
export function close() { return collapse('close'); }
addEventListener('popstate', () => { if (st.layer?.front) void collapse('Back'); });

/** Reattach on every frame navigation, including the app's own theme reload. @param {import('./frames.js').Layer} l */
function watch(l) {
  const w = /** @type {any} */ (l.frame.contentWindow), on = { capture:true, passive:true };
  /** @param {string} kind @param {any} e @param {any} p */
  const send = (kind, e, p) => { if (st.layer === l && l.front) st.h?.pull(kind, w, e, p); };
  try {
    // Touch events keep coming while a page pans; pointers are cancelled.
    for (const [p, t, kind] of [['down','start','down'],['move','move','move'],['up','end','up'],['cancel','cancel','cancel']]) {
      w.addEventListener(`pointer${p}`, (/** @type {PointerEvent} */ e) => { if (e.pointerType !== 'touch') send(kind, e, e); }, on);
      w.addEventListener(`touch${t}`, (/** @type {TouchEvent} */ e) => send(kind, e, e.touches.length > 1 ? null : e.touches[0] ?? e.changedTouches[0]), on);
    }
    // An app's own way home (a link to "/") shrinks the layer.
    w.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      const a = /** @type {any} */ (e.target)?.closest?.('a[href]');
      if (!a || st.layer !== l || !l.front || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const u = new URL(a.href, w.location.href);
      if (u.origin === location.origin && u.pathname === '/') { e.preventDefault(); void collapse('home link'); }
    }, true);
  } catch {}
}

/**
 * The phone's commands, on the app playing behind the chat (or in front). `minutes` for 'sleep'.
 * @param {'pause' | 'play' | 'next' | 'previous' | 'sleep' | 'never'} cmd @param {number} [minutes]
 * @returns {{ ok: boolean, text: string, undo?: () => void }}
 */
export function control(cmd, minutes = 30) {
  const m = media(), tick = () => st.c?.tick();
  if (!m) return { ok: false, text: 'Nothing is playing here. Open Music or Podcasts first.' };
  st.dir = cmd === 'next' || cmd === 'never' ? 1 : cmd === 'previous' ? -1 : 0;
  if (m.kind === 'podcasts') {
    const a = m.a;
    if (cmd === 'pause') a.pause();
    else if (cmd === 'play') void a.play().catch(() => {});
    else if (cmd === 'next') a.currentTime = Math.min(a.duration || Infinity, a.currentTime + 30);
    else if (cmd === 'previous') a.currentTime = Math.max(0, a.currentTime - 15);
    else if (cmd === 'sleep') {
      const before = podSleep ? Math.ceil((podSleep.end - Date.now()) / 60_000) : 0;
      if (podSleep) clearTimeout(podSleep.timer);
      podSleep = minutes > 0 ? { end: Date.now() + minutes * 60_000, timer: setTimeout(() => { podSleep = null; a.pause(); }, minutes * 60_000) } : null;
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
    // Music's own sleep timer; 0 turns it off.
    const before = Math.ceil(sleepLeft());
    p.setSleepTimer(Math.max(0, minutes) * 60, false);
    tick();
    return { ok: true, text: minutes > 0 ? `Music stops in ${minutes} minutes.` : 'Sleep timer off.', undo: () => p.setSleepTimer(before, false) };
  } else if (cmd === 'never') {
    const t = p.track, lib = m.w.__cp?.library;
    if (!t || !lib?.setRating) return { ok: false, text: "Couldn't reach the song." };
    const before = t.rating ?? 0;
    // Music's page sends the rating, and its undo, as a sense (th/music/ratings.js).
    lib.setRating(t, 1);
    p.step(1);
    tick();
    return { ok: true, text: 'Skipped. Rated "not for me": it won\'t come up again.', undo: () => lib.setRating(t, before) };
  }
  tick();
  return { ok: true, text: { pause: 'Paused.', play: 'Playing.', next: 'Next song.', previous: 'Previous song.' }[cmd] ?? '' };
}
