// The stream list's own movements, made from the foundation's pieces (ui/motion.js, and motion-core's go()
// and springs, which ui/motion.js is built on): each follows the Motion setting, can be interrupted (a new
// call on an element starts from where it is), moves only transform and opacity, and is timed into the
// feel log under a fixed name.

import {level, rise, timed, T} from '../ui/motion.js';
import {go, spring, EASE, handle, instant} from '../ui/motion-core.js';

/** Something with no origin (an empty or failed state) fades in place over 120 ms (FEEL.md rule 3). */
export function fadeIn(el, name = 'fade:streams') {
  return timed(name, () => (level() === 'off' || !el ? instant() : handle([go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.fade, easing: EASE})])));
}

/**
 * Cards arriving: those that land inside the visible part of `scroller` rise into place once (--d-rise, in
 * up to 4 groups 30 ms apart); those below it are simply there when scrolled to, so no more than a screenful
 * moves at once (FEEL.md rule 9). Only new cards move, below what is already shown: nothing under a finger shifts.
 */
export function riseCards(cards, scroller, name = 'rise:streams') {
  if (level() === 'off' || !cards.length) return null;
  const bottom = scroller ? scroller.getBoundingClientRect().bottom : innerHeight;
  const seen = cards.filter(c => c.getBoundingClientRect().top < bottom).slice(0, 12);
  return seen.length ? rise(seen, {name}) : null;
}

/**
 * Placeholders handing over to the cards that replace them: put back, out of the flow, where they were (the
 * cards take their place at once), they fade out over 120 ms while the cards rise in, so the surface never dips.
 */
export const placesOf = els => els.map(el => ({el, top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight}));
/** `at` is placesOf(the placeholders), read before they left the body. They fade from 1 (reading it would force a style pass). */
export function handOver(at, body) {
  if (!at.length || level() === 'off') return;
  for (const {el, top, left, width, height} of at) {
    Object.assign(el.style, {position: 'absolute', top: top + 'px', left: left + 'px', width: width + 'px', height: height + 'px', margin: '0'});
    body.prepend(el);
  }
  timed('fade:streams-placeholders', () => handle(at.map(({el}) => { const a = go(el, {opacity: 0}, {from: {opacity: 1}, duration: T.fade, easing: EASE, keep: true}); a.finished.then(() => el.remove(), () => el.remove()); return a; })));
}

/** A chip's fill springing in when it is chosen, and fading out when it is not (--spring-snappy, a control's few px). */
export function springFill(fill, on, name = 'chip:select') {
  if (!fill) return null;
  const lv = level();
  if (lv === 'off') return null;
  return timed(name, () => handle([on
    ? go(fill, {transform: 'none', opacity: 1}, {from: {transform: 'scale(0.6)', opacity: 0}, duration: T.normal, easing: lv === 'full' ? spring('snappy') : EASE})
    : go(fill, {opacity: 0}, {from: {opacity: 1}, duration: T.fast, easing: EASE})]));
}
