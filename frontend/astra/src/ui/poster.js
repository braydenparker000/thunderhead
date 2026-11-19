// Poster cards, the images in them, skeleton rows and empty states (re-exported by ui/components.js).
// FEEL.md "Loading": a poster shows its own colour (or a soft gradient of its colours, ui/art.js) at once
// and its picture fades over it in 200 ms; a placeholder has the card's final geometry (art, title line,
// year line), so nothing moves when the data lands; a skeleton's shimmer starts only after 600 ms, so data
// that is already here never shimmers.

import {h} from './dom.js';
import {icon} from './icons.js';
import {longPress, liftMenu} from './components.js';
import {press} from './motion.js';
import {paintArt, readArt, artEntry} from './art.js';

// Pictures painted this visit (FEEL.md "Loading": a later visit shows them at once). Drawn again (a row
// redrawn, a tab or a screen built anew, Details' poster after the card's), such a picture is asked for at
// once and decoded before it is drawn: no lazy wait, no placeholder, no 200 ms fade replayed.
const shown = new Set();
// Lazy pictures still waiting (off screen: to the right in a row, below the fold), by address. When the same
// picture is painted elsewhere (the hero shows a title a row shows further on), they are asked for at once:
// the bytes are here, so the card is whole before it is scrolled to, not a placeholder until then.
const waiting = new Map(); // src -> Set of WeakRef(img)
function wake(src) {
  for (const ref of waiting.get(src) || []) { const img = ref.deref(); if (img && !img.complete && img.loading === 'lazy') img.loading = 'eager'; }
  waiting.delete(src);
}
/** True when `src` has been painted somewhere this visit. */
export const seen = src => !!src && shown.has(src);

/**
 * An image that fades in when it arrives from the network. Art already seen this visit (a poster seen on
 * Home, now on Details, in Search or in a redrawn row) shows at once, with no fade to replay. `eager` is for
 * the art that fills the screen first; `label` is written in the empty tile when there is no art (a poster's title).
 */
export function image(src, alt = '', cls = '', {eager = false, label = ''} = {}) {
  const fallback = () => h('div', {class: 'img-fallback ' + cls}, label ? h('span', {class: 'img-label', 'aria-hidden': 'true'}, label) : null);
  if (!src) return fallback();
  const again = shown.has(src);
  const img = h('img', {class: cls, alt, loading: eager || again ? 'eager' : 'lazy', decoding: again ? 'sync' : 'async', referrerpolicy: 'no-referrer', draggable: 'false'});
  if (eager) img.fetchPriority = 'high';
  img.src = src;
  img.addEventListener('error', () => img.replaceWith(fallback()), {once: true});
  // Once painted, a picture is drawn with its pixels ready (decoding sync): a phone short of memory that
  // dropped its decoded copy draws it again in the same frame instead of leaving its tile empty for one.
  const painted = () => { shown.add(src); img.decoding = 'sync'; wake(src); };
  if (img.complete && img.naturalWidth) painted();
  else {
    img.addEventListener('load', () => { if (!shown.has(src)) img.classList.add('loaded'); painted(); }, {once: true}); // painted elsewhere meanwhile: no fade
    if (img.loading === 'lazy' && typeof WeakRef === 'function') { if (!waiting.has(src)) waiting.set(src, new Set()); waiting.get(src).add(new WeakRef(img)); }
  }
  return img;
}

/**
 * A finger is down on a picture that may fly (ui/motion.js travel): its picture is asked for and decoded
 * again now, so the flying copy made at the tap has its pixels at once and the flight starts without a wait.
 */
const warm = new Set();
export function warmArt(box) {
  const img = box?.tagName === 'IMG' ? box : box?.querySelector?.('img');
  const src = img?.complete && img.naturalWidth ? img.currentSrc || img.src : '';
  if (!src || typeof Image !== 'function') return;
  const w = new Image();
  w.referrerPolicy = 'no-referrer';
  w.src = src;
  warm.add(w); // held until it has decoded, and a while after, so the copy finds it
  const drop = () => setTimeout(() => warm.delete(w), 2000);
  w.decode().then(drop, drop);
}

/** The whole pictures in a part about to be redrawn, by address (for keepPictures). */
export function wholePictures(root) {
  const found = new Map();
  for (const img of root.querySelectorAll('img')) if (img.complete && img.naturalWidth && !found.has(img.src)) found.set(img.src, img);
  return found;
}
/**
 * In a part just redrawn, each picture not whole yet takes the element that showed the same address before
 * (its pixels already decoded): a redrawn row or grid shows its art at once even when the browser has let go
 * of the bytes (a phone short of memory), instead of its placeholder until the picture comes back.
 */
export function keepPictures(old, root) {
  for (const img of root.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth) continue;
    const was = old.get(img.src);
    if (!was || was.isConnected) continue;
    old.delete(img.src);
    was.className = img.className;
    was.classList.remove('loaded');
    img.replaceWith(was);
  }
}

/**
 * Puts `next` (a picture from image() in `box` in place of the one shown there, once it has decoded, so a
 * new address (a sharper copy, the full details' own art) replaces the old picture with no flash between.
 */
const wanted = new WeakMap(); // box -> the picture last asked for: an older one decoding late never paints over it
export function swapIn(box, next) {
  const now = box.firstElementChild;
  wanted.set(box, next);
  if (!now || now.tagName !== 'IMG' || !now.complete || !next || next.tagName !== 'IMG') { box.replaceChildren(...[next].filter(Boolean)); return; }
  const put = () => { if (wanted.get(box) !== next) return; next.classList.remove('loaded'); box.replaceChildren(next); };
  (next.decode ? next.decode() : Promise.resolve()).then(put, () => {}); // a picture that fails keeps the old one
}

// Pictures whose colour is not known yet are read (their small copy) as they come near the screen,
// at the moment their lazy picture is asked for too.
let near = null;
function readWhenNear(el, src) {
  if (artEntry(src) || typeof IntersectionObserver !== 'function') return;
  near ??= new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) {
      near.unobserve(e.target);
      const s = e.target.dataset.art;
      if (s) readArt(s).then(() => paintArt(e.target, s));
    }
  }, {rootMargin: '400px'});
  el.dataset.art = src;
  near.observe(el);
}

/** A picture's box with its placeholder painted (or read when it comes near). */
export function artBox(cls, src, child) {
  const box = h('div', {class: cls}, child);
  if (src && !paintArt(box, src)) readWhenNear(box, src);
  return box;
}

const watchedBadge = () => h('span', {class: 'watched-badge', 'aria-label': 'Watched'}, icon('check', {size: 12}));

/**
 * A portrait poster card. `ctx` gives watched state and the menu actions:
 * {watched: (m) => bool, onOpen(m, art), menu(m) => [{label, icon, run, destructive}]}. `art` is the
 * card's picture box, which Details' poster travels from (screens/details-motion.js).
 */
export function posterCard(m, ctx) {
  const watched = ctx.watched?.(m);
  const name = String(m.name || '') || 'Untitled'; // an add-on may send items without a name
  const year = String(m.releaseInfo || m.year || '').slice(0, 9);
  const art = artBox('poster-art', m.poster, image(m.poster, '', 'poster-img', {label: name}));
  if (watched) art.append(watchedBadge());
  const card = press(h('button', {class: 'poster-card', type: 'button', onclick: () => ctx.onOpen(m, art), onpointerdown: () => warmArt(art)},
    art, h('span', {class: 'poster-title'}, name), h('span', {class: 'poster-year'}, year)));
  card.setAttribute('aria-label', [name, String(m.releaseInfo || ''), watched ? 'watched' : ''].filter(Boolean).join(', '));
  if (ctx.menu) longPress(card, () => liftMenu(art, name, String(m.releaseInfo || ''), ctx.menu(m)));
  card.dataset.item = `${m.type}:${m.id}`;
  return card;
}

/** Shows or hides a poster card's watched badge in place (no redraw of the row it sits in). */
export function setWatchedBadge(card, on) {
  const badge = card.querySelector('.watched-badge');
  if (!!badge === on) return;
  if (on) card.querySelector('.poster-art')?.append(watchedBadge());
  else badge.remove();
  const label = (card.getAttribute('aria-label') || '').replace(/, watched$/, '');
  card.setAttribute('aria-label', on ? label + ', watched' : label);
}

/** A card-shaped placeholder: the poster's box, its title line and its year line. */
export const posterPlaceholder = () => h('div', {class: 'poster-card ph', 'aria-hidden': 'true'},
  h('div', {class: 'poster-art skeleton'}), h('span', {class: 'poster-title'}, h('i', {class: 'ph-line'})), h('span', {class: 'poster-year'}, h('i', {class: 'ph-line short'})));

export function skeletonRow(count = 6, {title = true, landscape = false} = {}) {
  return h('section', {class: 'row skeleton-row', 'aria-hidden': 'true'},
    title ? h('div', {class: 'row-head'}, h('div', {class: 'skeleton skeleton-title'})) : null,
    h('div', {class: 'row-scroll'}, ...Array.from({length: count}, () => landscape ? h('div', {class: 'skeleton skeleton-landscape'}) : posterPlaceholder())));
}

/**
 * A designed empty state: an icon, a title, one line of help and (at most) one action.
 * @param {string} title @param {string} body @param {{label: string, run: () => void} | null} [action] @param {{icon?: string}} [options]
 */
export function emptyCard(title, body, action = null, {icon: iconName = ''} = {}) {
  return h('div', {class: 'state-card' + (iconName ? ' empty-state' : '')}, iconName ? h('span', {class: 'empty-icon', 'aria-hidden': 'true'}, icon(iconName, {size: 28})) : null,
    h('h3', {}, title), h('p', {}, body), action ? press(h('button', {class: 'btn primary wide', type: 'button', onclick: action.run}, action.label)) : null);
}
