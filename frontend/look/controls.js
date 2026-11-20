// @ts-check
// Ink and Lamp's behaviour on Settings (builder C; design S-Settings-*): it runs only while the look
// is on (whileOn) and, turned off, takes away all it added. Every choice is already a row of kit keys
// or a slide switch by CSS (settings.css); here:
//   Text size  (#set-text)                   a fader with three detents,
//   Motion     ([data-key="appearance.motion"])  a rotary dial with four printed positions,
//   Haptics    ([data-key="appearance.haptics"]) a three-position slide switch,
//   switches   (.switch)                     the small slide switch's thumb follows a finger,
// each drawn over the page's own radio group (components.js choice()), whose buttons stay the
// options: a tap, the arrow keys and a screen reader use them as before. A drag sets the value by
// clicking the option it settles on (controls-drag.js). And on every page, a key looks pressed the
// moment a finger is on it (press.js). A choice whose keys would not fit beside its
// name goes under it (.lk-stack).
import { whileOn } from './look.js';
import { draggable } from './controls-drag.js';
import { press } from './press.js';

const SVG = 'http://www.w3.org/2000/svg';
const DIAL = [-60, -20, 20, 60];
const SLIDE = [24, 69, 114];

/** @param {string} tag @param {string} cls @param {Node[]} [kids] */
const make = (tag, cls, kids = []) => {
  const n = document.createElement(tag);
  n.className = cls;
  n.append(...kids);
  return n;
};
/** The options of a radio group. @param {HTMLElement} seg */
const options = (seg) => /** @type {HTMLButtonElement[]} */ ([...seg.querySelectorAll(':scope > .seg-option')]);
const index = (/** @type {HTMLElement} */ seg) => Number(seg.dataset.index) || 0;
const pickOf = (/** @type {HTMLElement} */ seg) => (/** @type {number} */ i) => options(seg)[i]?.click();
const onIndex = (/** @type {HTMLElement} */ seg) => ({ target: seg, options: { attributes: true, attributeFilter: ['data-index'] } });

/** The fader: three detents along a track, the cap on the chosen one.
 * @param {HTMLElement} seg @param {AbortSignal} signal */
function fader(seg, signal) {
  const ticks = [0, 1, 2].map((i) => make('i', `lk-tk lk-tk${i}`));
  const cap = make('span', 'lk-fader');
  const deco = make('span', 'lk-fd', [...ticks, make('i', 'lk-track'), make('i', 'lk-scale'), cap]);
  deco.setAttribute('aria-hidden', 'true');
  seg.prepend(deco);
  let w = seg.clientWidth;
  const stops = () => [13, w / 2, w - 13];
  const left = () => seg.getBoundingClientRect().left;
  const mark = () => ticks.forEach((t, i) => t.classList.toggle('on', i === index(seg)));
  mark();
  const c = draggable({
    zone: seg, stops, at: () => index(seg), signal, watch: onIndex(seg),
    read: (e) => e.clientX - left(),
    draw: (v) => { cap.style.transform = `translateX(${(v - 13).toFixed(2)}px)`; },
    pick: pickOf(seg),
    tap: (e) => (/** @type {Element} */ (e.target).closest('.seg-option') ? null : c.near(e.clientX - left())),
  });
  new MutationObserver(mark).observe(seg, { attributes: true, attributeFilter: ['data-index'] });
  const sized = new ResizeObserver(() => { const now = seg.clientWidth; if (now && now !== w) { w = now; c.rest(false); } });
  sized.observe(seg);
  signal.addEventListener('abort', () => { sized.disconnect(); deco.remove(); });
}

/** The rotary dial: four positions printed round it, the pointer on the chosen one. A finger turns
 * it by going round it, or across it. @param {HTMLElement} seg @param {AbortSignal} signal */
function rotary(seg, signal) {
  const marks = document.createElementNS(SVG, 'svg');
  marks.setAttribute('viewBox', '0 0 64 64');
  const dots = DIAL.map((a) => {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', (32 + 28.6 * Math.sin(a * Math.PI / 180)).toFixed(2));
    c.setAttribute('cy', (32 - 28.6 * Math.cos(a * Math.PI / 180)).toFixed(2));
    marks.append(c);
    return c;
  });
  const body = make('span', 'lk-dial lk-dial--small');
  const deco = make('span', 'lk-rot', [marks, body]);
  deco.setAttribute('aria-hidden', 'true');
  seg.prepend(deco);
  const mark = () => dots.forEach((c, i) => { c.setAttribute('r', i === index(seg) ? '1.8' : '1.4'); c.classList.toggle('on', i === index(seg)); });
  mark();
  const centre = () => { const r = body.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const angle = (/** @type {number} */ x, /** @type {number} */ y) => { const [cx, cy] = centre(); return Math.atan2(x - cx, cy - y) * 180 / Math.PI; };
  const c = draggable({
    zone: deco, stops: () => DIAL, at: () => index(seg), signal, watch: onIndex(seg),
    read: (e, from) => {
      // Round it: the change of the finger's bearing from the centre; or across it: its sideways
      // travel (clockwise to the right), whichever turns it more.
      const [cx, cy] = centre();
      const far = Math.hypot(e.clientX - cx, e.clientY - cy) > 16 && Math.hypot(from.px - cx, from.py - cy) > 16;
      let round = far ? angle(e.clientX, e.clientY) - angle(from.px, from.py) : 0;
      if (round > 180) round -= 360;
      if (round < -180) round += 360;
      const across = (e.clientX - from.px) * 1.4;
      const turn = Math.abs(round) > Math.abs(across) ? round : across;
      return Math.min(75, Math.max(-75, from.v + turn));
    },
    draw: (v) => body.style.setProperty('--turn', `${v.toFixed(2)}deg`),
    pick: pickOf(seg),
    // A tap on the dial turns it on by one, back to the first after the last.
    tap: () => (index(seg) + 1) % DIAL.length,
  });
  new MutationObserver(mark).observe(seg, { attributes: true, attributeFilter: ['data-index'] });
  signal.addEventListener('abort', () => deco.remove());
}

/** The three-position slide switch: its legends are the options, the thumb in its well under them.
 * @param {HTMLElement} seg @param {AbortSignal} signal */
function slide(seg, signal) {
  const thumb = make('span', 'lk-thumb');
  const deco = make('span', 'lk-sw', [make('i', ''), make('i', ''), make('i', ''), thumb]);
  deco.setAttribute('aria-hidden', 'true');
  seg.prepend(deco);
  const left = () => deco.getBoundingClientRect().left;
  const c = draggable({
    zone: seg, stops: () => SLIDE, at: () => index(seg), signal, watch: onIndex(seg),
    read: (e, from) => from.v + e.clientX - from.px,
    draw: (v) => { thumb.style.transform = `translateX(${(v - 24).toFixed(2)}px)`; },
    pick: pickOf(seg),
    tap: (e) => (/** @type {Element} */ (e.target).closest('.seg-option') ? null : c.near(e.clientX - left())),
  });
  signal.addEventListener('abort', () => deco.remove());
}

/** A switch row: its thumb follows a finger that starts on it. @param {HTMLElement} row @param {AbortSignal} signal */
function toggle(row, signal) {
  const track = /** @type {HTMLElement | null} */ (row.querySelector('.switch-track'));
  if (!track) return;
  const on = () => (row.getAttribute('aria-checked') === 'true' ? 1 : 0);
  draggable({
    zone: row, stops: () => [0, 12], at: on, signal,
    watch: { target: row, options: { attributes: true, attributeFilter: ['aria-checked'] } },
    starts: (e) => { const r = track.getBoundingClientRect(); return e.clientX > r.left - 16 && e.clientX < r.right + 16; },
    read: (e, from) => from.v + e.clientX - from.px,
    draw: (v) => track.style.setProperty('--lk-x', `${v.toFixed(2)}px`),
    pick: () => row.click(),
  });
  signal.addEventListener('abort', () => { track.style.removeProperty('--lk-x'); if (track.getAttribute('style') === '') track.removeAttribute('style'); });
}

/** Dresses the controls under `root` once each. @param {ParentNode} root @param {AbortSignal} signal @param {WeakSet<Element>} done */
function dress(root, signal, done) {
  for (const seg of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.seg'))) {
    if (done.has(seg)) continue;
    done.add(seg);
    const field = /** @type {HTMLElement | null} */ (seg.closest('.seg-field'));
    const kind = field?.id === 'set-text' && options(seg).length === 3 ? 'fader'
      : field?.dataset.key === 'appearance.motion' && options(seg).length === 4 ? 'rotary'
      : field?.dataset.key === 'appearance.haptics' && options(seg).length === 3 ? 'slide' : '';
    if (kind) {
      seg.dataset.lk = kind;
      ({ fader, rotary, slide })[kind](seg, signal);
      signal.addEventListener('abort', () => delete seg.dataset.lk);
    } else if (field) {
      requestAnimationFrame(() => stack(field, seg, signal));
      void document.fonts.ready.then(() => stack(field, seg, signal));
    }
  }
  for (const row of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.switch'))) {
    if (done.has(row)) continue;
    done.add(row);
    toggle(row, signal);
  }
}

/** Keys that would not fit beside their name go under it. @param {HTMLElement} field @param {HTMLElement} seg @param {AbortSignal} signal */
function stack(field, seg, signal) {
  if (signal.aborted || !field.isConnected || field.classList.contains('lk-stack')) return;
  const title = field.querySelector('.row-title') ?? field.querySelector('.seg-label');
  const tight = options(seg).some((b) => { const r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect().width > b.clientWidth - 24; }) || (title?.getBoundingClientRect().height ?? 0) > 30;
  if (!tight) return;
  field.classList.add('lk-stack');
  signal.addEventListener('abort', () => field.classList.remove('lk-stack'));
}

whileOn(() => {
  const stop = new AbortController();
  const { signal } = stop;
  /** @type {WeakSet<Element>} */
  const done = new WeakSet();
  // Settings' pages come into #app, sheets into <body>: each is watched (with all under it) as it comes.
  const inner = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n instanceof Element) dress(n.parentElement ?? n, signal, done);
  });
  const watch = (/** @type {Element} */ n) => {
    if (!n.matches('.spage, .sheet, .csheet')) return;
    inner.observe(n, { childList: true, subtree: true });
    dress(n, signal, done);
  };
  const outer = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n instanceof Element) watch(n); });
  for (const host of [document.getElementById('app'), document.body]) if (host) {
    outer.observe(host, { childList: true });
    for (const n of host.children) watch(n);
  }
  return () => { outer.disconnect(); inner.disconnect(); stop.abort(); };
});

whileOn(press);
