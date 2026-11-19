// Poster → Details and back (FEEL.md "Poster → Details"). The picture that was tapped travels (a shared
// element, ui/motion.js travel) to its place on Details: a poster to Details' poster, the hero's backdrop
// to Details' backdrop; Details itself (its black and its backdrop) fades in under it over 220 ms and its
// text rises in groups. Back sends the picture home to its card when the card is still on screen. One
// flight at a time: a new one (a second tap, Back mid-flight) takes over from where the picture is.
// The shell pushes every screen with a slide (app/app.js push); a Details opened from a picture takes
// that over at once (it is cancelled before its first frame) and moves by itself instead.

import {travel, rise, level, T, timed} from '../ui/motion.js';
import {go, stop, handle, instant} from '../ui/motion-core.js';

let flight = null; // {travel, copy}

const onScreen = el => {
  if (!el?.isConnected || el.closest('.off, [hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};
const srcOf = el => el?.querySelector?.('img')?.currentSrc || el?.querySelector?.('img')?.src || '';

/** Lands a flight: the picture (`from`, an element or a rect) to `to`. A flight still in the air is taken over from where it is. */
function fly(from, to, name, radius = null) {
  if (flight) {
    const r = flight.copy?.isConnected ? flight.copy.getBoundingClientRect() : null;
    flight.travel.cancel();
    if (r?.width) from = {left: r.left, top: r.top, width: r.width, height: r.height};
  }
  const before = document.body.lastElementChild;
  const t = travel(from, to, {name, radius});
  const last = document.body.lastElementChild;
  const mine = flight = {travel: t, copy: last !== before ? last : null};
  // A copy of a picture that faded in when it arrived would fade in again: it is already here.
  if (mine.copy) for (const img of [mine.copy, ...mine.copy.querySelectorAll('img')]) img.classList.remove('loaded');
  // Landing on Details' backdrop, the copy fades into the page as the backdrop does, so the title under it shows through.
  const mask = to instanceof Element ? getComputedStyle(to).maskImage : 'none';
  if (mine.copy && mask && mask !== 'none') { mine.copy.style.maskImage = mask; mine.copy.style.webkitMaskImage = mask; }
  t.finished.then(() => { if (flight === mine) flight = null; });
  return t;
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
 * Details opening out of `from` (a card's picture box, or the hero's backdrop), on the layer the shell
 * has just pushed. Without `from`, the shell's own slide stays.
 */
export function enter(screen, from) {
  const layer = screen.el.parentElement;
  if (!from || !layer || !onScreen(from)) return instant();
  stop(layer); // the shell's slide, before its first frame
  const {to, same} = landing(screen, from);
  const lv = level();
  if (lv === 'off') return instant();
  const fade = timed('fade:details', () => handle([go(layer, {opacity: 1}, {from: {opacity: 0}, duration: lv === 'full' ? T.normal : T.fade})]));
  // A different picture (a still to a backdrop): Details' own copy flies from the card's place. A Continue
  // Watching card flies its picture alone, without the words and the progress line drawn over it.
  const bare = from.classList.contains('cw-art') && from.querySelector('img');
  const radius = bare ? [parseFloat(getComputedStyle(from).borderTopLeftRadius) || 0, 0] : null;
  const t = fly(same ? bare || from : from.getBoundingClientRect(), to, 'travel:poster-details', radius);
  if (lv === 'full') rise(screen.riseGroups(), {name: 'rise:details'});
  screen.origin = from;
  return {finished: Promise.all([t.finished, fade.finished]).then(([a, b]) => ({cancelled: a.cancelled || b.cancelled})), cancel: () => { t.cancel(); fade.cancel(); }};
}

/** Back: the picture goes home to its card when the card is on screen (the shell fades Details away). */
export function leave(screen) {
  const from = screen.origin;
  if (!from || !onScreen(from) || level() === 'off') { flight?.travel.cancel(); return instant(); }
  const {to: at, same} = landing(screen, from);
  if (!at) return instant();
  // The same picture flies itself; a different one (a backdrop going home to a still) flies as the card's copy.
  const r = at.getBoundingClientRect();
  const t = fly(same ? at : {left: r.left, top: r.top, width: r.width, height: r.height}, from, 'travel:details-poster');
  if (!same) at.style.visibility = 'hidden';
  return t;
}
