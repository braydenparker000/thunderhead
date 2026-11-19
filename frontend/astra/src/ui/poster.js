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

/**
 * An image that fades in when it arrives from the network. Art the browser already holds (a poster
 * seen on Home, now on Details) shows at once, with no fade to replay. `eager` is for the art that fills
 * the screen first; `label` is written in the empty tile when there is no art (a poster's title).
 */
export function image(src, alt = '', cls = '', {eager = false, label = ''} = {}) {
  const fallback = () => h('div', {class: 'img-fallback ' + cls}, label ? h('span', {class: 'img-label', 'aria-hidden': 'true'}, label) : null);
  if (!src) return fallback();
  const img = h('img', {class: cls, alt, loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false'});
  if (eager) img.fetchPriority = 'high';
  img.src = src;
  img.addEventListener('error', () => img.replaceWith(fallback()), {once: true});
  if (!img.complete) img.addEventListener('load', () => img.classList.add('loaded'), {once: true});
  return img;
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
  const card = press(h('button', {class: 'poster-card', type: 'button', onclick: () => ctx.onOpen(m, art)},
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
