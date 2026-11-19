// Shared pieces: poster cards, the long press, skeleton rows, empty states; the lift menu, bottom
// sheets, dialogs and toasts (ui/overlays.js) are re-exported from here.

import {h} from './dom.js';
import {icon} from './icons.js';
import {tick} from './motion.js';
// The lift menu, sheets, dialogs and toasts live in ui/overlays.js (the shell's); screens import them from here.
import {liftMenu} from './overlays.js';
export {liftMenu, sheet, confirm, toast} from './overlays.js';

const LONG_PRESS_MS = 450;

/** Calls onLongPress after a still press; a normal tap still clicks. Returns a cleanup. */
export function longPress(el, onLongPress) {
  let timer = 0, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); start = null; };
  // Android Chrome also sends contextmenu for a long press (at about 400 ms):
  // whichever comes first opens the menu, once.
  const fire = e => { clearTimeout(timer); if (fired || document.querySelector('.lift, .sheet')) return; fired = true; tick('lift'); onLongPress(e); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false; start = {x: e.clientX, y: e.clientY};
    timer = setTimeout(() => fire(e), LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', e => { e.preventDefault(); fire(e); });
}

/**
 * An image that fades in when it arrives from the network. Art the browser
 * already holds (a poster seen on Home, now on Details) shows at once, with
 * no fade to replay. `eager` is for the art that fills the screen first;
 * `label` is written in the empty tile when there is no art (a poster's
 * title, an add-on's initial), as Nuvio does.
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

/**
 * A portrait poster card. `ctx` gives watched state and the menu actions:
 * {watched: (m) => bool, onOpen(m), menu(m) => [{label, icon, run, destructive}]}
 */
export function posterCard(m, ctx) {
  const watched = ctx.watched?.(m);
  const name = String(m.name || '') || 'Untitled'; // an add-on may send items without a name
  const card = h('button', {class: 'poster-card', type: 'button', onclick: () => ctx.onOpen(m)},
    h('div', {class: 'poster-art'}, image(m.poster, '', 'poster-img', {label: name}), watched ? h('span', {class: 'watched-badge', 'aria-label': 'Watched'}, icon('check', {size: 12})) : null),
    h('span', {class: 'poster-title'}, name),
    h('span', {class: 'poster-year'}, String(m.releaseInfo || m.year || '').slice(0, 9)));
  card.setAttribute('aria-label', [name, String(m.releaseInfo || ''), watched ? 'watched' : ''].filter(Boolean).join(', '));
  if (ctx.menu) longPress(card, () => liftMenu(card.querySelector('.poster-art'), name, String(m.releaseInfo || ''), ctx.menu(m)));
  card.dataset.item = `${m.type}:${m.id}`;
  return card;
}

/** Shows or hides a poster card's watched badge in place (no redraw of the row it sits in). */
export function setWatchedBadge(card, on) {
  const badge = card.querySelector('.watched-badge');
  if (!!badge === on) return;
  if (on) card.querySelector('.poster-art')?.append(h('span', {class: 'watched-badge', 'aria-label': 'Watched'}, icon('check', {size: 12})));
  else badge.remove();
  const label = (card.getAttribute('aria-label') || '').replace(/, watched$/, '');
  card.setAttribute('aria-label', on ? label + ', watched' : label);
}

export function skeletonRow(count = 6, {title = true, landscape = false} = {}) {
  return h('section', {class: 'row skeleton-row', 'aria-hidden': 'true'},
    title ? h('div', {class: 'row-head'}, h('div', {class: 'skeleton skeleton-title'})) : null,
    h('div', {class: 'row-scroll'}, ...Array.from({length: count}, () => h('div', {class: landscape ? 'skeleton skeleton-landscape' : 'skeleton skeleton-poster'}))));
}

export function emptyCard(title, body, action = null) {
  return h('div', {class: 'state-card'}, h('h3', {}, title), h('p', {}, body), action ? h('button', {class: 'btn primary wide', type: 'button', onclick: action.run}, action.label) : null);
}

/** The mind's "three for tonight" (`astra/tonight`, astra.shortlist) in `slot` on Home: two or three
 * titles to pick from (a tap opens one) and the filters it chose by, its why behind a tap and
 * Dismiss. It never picks or plays (th/ported/arrangement.js reads it and sends the senses). */
export function mountTonight(app, slot) {
  import('/th/ported/arrangement.js').then(m => m.mount('astra', 'tonight', a => {
    const titles = (a.payload.titles || []).map(t => ({...t, at: /^astra:([^:]+):(.+)$/.exec(t.ref)})).filter(t => t.at);
    const filters = (a.payload.filters || []).join(' · ');
    if (!titles.length && !filters) return null;
    return {label: 'Three for tonight', title: titles.length ? 'Pick one' : filters, detail: titles.length ? filters : '',
      extra: titles.map(t => m.choice(a, t.title, () => app.openTitle({type: t.at[1], id: t.at[2], name: t.title})))};
  }, card => slot.replaceChildren(card))).catch(() => {});
}
