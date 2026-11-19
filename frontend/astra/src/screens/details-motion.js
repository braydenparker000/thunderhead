// Poster → Details and back (FEEL.md "Poster → Details"). The picture that was tapped travels (a shared
// element, ui/motion.js travel) to its place on Details: a poster to Details' poster, the hero's backdrop
// to Details' backdrop; Details itself (its black and its backdrop) fades in under it over 220 ms and its
// text rises in groups. Back sends the picture home to its card when the card is still on screen. One
// flight at a time: a new one (a second tap, Back mid-flight) takes over from where the picture is.
// The shell pushes and pops every other screen with a slide (app/app.js); a Details opened from a picture
// moves itself both ways (the shell asks `screen.enter` and `screen.leave` first). Back with the card off
// screen: Details fades and drops 12 px.

import {travel, rise, level, T, timed} from '../ui/motion.js';
import {go, handle, instant, spring, EASE} from '../ui/motion-core.js';

let flight = null; // {travel, copy}

const onScreen = el => {
  if (!el?.isConnected || el.closest('.off, [hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};
const srcOf = el => el?.querySelector?.('img')?.currentSrc || el?.querySelector?.('img')?.src || '';

/**
 * Lands a flight: the picture (`from`, an element or a rect) to `to`. A flight still in the air is taken over
 * from where it is: its copy stays in place until the new one has painted over it (ui/motion.js travel).
 */
function fly(from, to, name, {radius = null, then = null, different = false} = {}) {
  let replaces = null;
  if (flight) {
    const r = flight.copy?.isConnected ? flight.copy.getBoundingClientRect() : null;
    replaces = flight.travel.cancel({keep: true});
    if (r?.width) from = {left: r.left, top: r.top, width: r.width, height: r.height};
  }
  // Landing on Details' backdrop, the copy fades into the page as the backdrop does, so the title under it
  // shows through; landing on a different picture (a still on a backdrop), it fades into that one.
  const mask = to instanceof Element ? getComputedStyle(to).maskImage : 'none';
  const fades = (mask && mask !== 'none') || different;
  let mine = null;
  const onStart = () => {
    then?.();
    if (!mine?.copy || !fades) return;
    // Its last 100 ms: the backdrop itself is shown under it (the same picture, all but in place) and the copy
    // fades, so Details' poster and title, drawn over the backdrop, are never under the travelling copy.
    go(mine.copy, {opacity: 0}, {duration: 100, delay: T.travel - 100, easing: EASE, keep: true, join: true});
    const early = setTimeout(() => { if (flight === mine) to.style.visibility = 'visible'; }, T.travel - 100);
    mine.travel.finished.then(() => clearTimeout(early));
  };
  const before = document.body.lastElementChild;
  const t = travel(from, to, {name, radius, onStart, replaces});
  const last = document.body.lastElementChild;
  mine = flight = {travel: t, copy: last !== before && last !== replaces ? last : null};
  if (mine.copy && mask && mask !== 'none') { mine.copy.style.maskImage = mask; mine.copy.style.webkitMaskImage = mask; }
  t.finished.then(() => { if (flight === mine) flight = null; });
  return t;
}

/**
 * The card a Details opened from, found again by its title when its row was redrawn meanwhile (a library
 * change, a quiet reload of Home): the card on screen now with the same title and the same kind of picture.
 */
function origin(screen) {
  const was = screen.origin, {item, cls} = screen.originKey || {};
  if (was?.isConnected || !item || !cls) return was;
  const cards = [...document.querySelectorAll(`[data-item="${CSS.escape(item)}"] .${CSS.escape(cls)}`)].filter(el => !screen.el.contains(el));
  return cards.find(onScreen) || was;
}

/** Where on Details a picture lands: the same picture when Details shows it, else by its shape. */
export function landing(screen, from) {
  const src = srcOf(from), poster = screen.posterBox, bg = screen.hero?.bg;
  if (src && poster && src === srcOf(poster)) return {to: poster, same: true};
  if (src && bg && src === srcOf(bg)) return {to: bg, same: true};
  const r = from.getBoundingClientRect();
  return {to: r.width > r.height || !poster ? bg : poster, same: false};
}

/**
 * Details opening out of `from` (a card's picture box, or the hero's backdrop), on the layer the shell has
 * just pushed. Null when there is no picture on screen to open from: the shell slides Details in.
 */
export function enter(screen, from) {
  const layer = screen.el.parentElement;
  if (!from || !layer || !onScreen(from)) return null;
  screen.origin = from;
  screen.originKey = {item: from.closest('[data-item]')?.dataset.item || '', cls: from.classList[0] || ''};
  const lv = level();
  if (lv === 'off') return instant();
  // Details fades in and its text rises once the picture starts to move: the frame that lays the page out
  // is drawn while the copy still sits on the card, not in the flight's first frames.
  const fadeIn = go(layer, {opacity: 1}, {from: {opacity: 0}, duration: lv === 'full' ? T.normal : T.fade});
  fadeIn.pause();
  const start = () => {
    if (!fadeIn.playState || fadeIn.playState === 'idle') return; // cancelled before it began
    timed('fade:details', () => { fadeIn.play(); return handle([fadeIn]); });
    // Flown from a long-press menu's lifted card (screens/home.js), the rest of that card goes with its picture.
    if (from.classList.contains('lift-art')) from.style.visibility = 'hidden';
    if (lv === 'full') rise(screen.riseGroups(), {name: 'rise:details'});
  };
  const {to, same} = landing(screen, from);
  // The card's own picture always flies (a different one on Details, a still to a backdrop, is faded into at
  // the end). A Continue Watching card flies its picture alone, without the words and the progress line over it.
  const bare = from.classList.contains('cw-art') && from.querySelector('img');
  const radius = bare ? [parseFloat(getComputedStyle(from).borderTopLeftRadius) || 0, 0] : null;
  const t = fly(bare || from, to, 'travel:poster-details', {radius, then: start, different: !same});
  const faded = fadeIn.finished.then(() => ({cancelled: false}), () => ({cancelled: true}));
  return {finished: Promise.all([t.finished, faded]).then(([x, y]) => ({cancelled: x.cancelled || y.cancelled})), cancel: () => { t.cancel(); fadeIn.cancel(); }};
}

const both = (a, b) => ({finished: Promise.all([a.finished, b.finished]).then(([x, y]) => ({cancelled: x.cancelled || y.cancelled})), cancel: () => { a.cancel(); b.cancel(); }});

/**
 * Back from a Details that opened itself (`layer` is its layer; the shell removes it when this is done): the
 * picture goes home to its card while Details fades, or, with the card off screen, Details fades and drops 12 px.
 */
export function leave(screen, layer) {
  const from = origin(screen), lv = level();
  if (lv === 'off') { flight?.travel.cancel(); return instant(); }
  const at = from && onScreen(from) ? landing(screen, from) : null;
  if (!at?.to) {
    flight?.travel.cancel();
    return timed('drop:details', () => handle(lv === 'full'
      ? [go(layer, {transform: 'translateY(12px)'}, {duration: T.screen, easing: spring('smooth'), keep: true}), go(layer, {opacity: 0}, {duration: T.normal, easing: EASE, keep: true, join: true})]
      : [go(layer, {opacity: 0}, {duration: T.fade, easing: EASE, keep: true})]));
  }
  // The same picture flies itself; a different one (a backdrop going home to a still) flies as the card's copy.
  const r = at.to.getBoundingClientRect();
  const t = fly(at.same ? at.to : {left: r.left, top: r.top, width: r.width, height: r.height}, from, 'travel:details-poster', {});
  if (!at.same) at.to.style.visibility = 'hidden';
  return both(t, timed('fade:details-out', () => handle([go(layer, {opacity: 0}, {duration: lv === 'full' ? T.normal : T.fade, easing: EASE, keep: true})])));
}
