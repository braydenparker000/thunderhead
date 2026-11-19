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
 * Keeps `el` still on screen while the screen it is on is pushed in from 8% (or pops back there): the same
 * spring and duration in the opposite direction, so the two cancel and the backdrop and logo Details had stay
 * where they were. Only under Full motion (Reduced and Off do not slide).
 */
export function stayPut(el, leaving = false, name = leaving ? 'hold:streams-pop' : 'hold:streams-push') {
  if (!el || level() !== 'full') return null;
  return timed(name, () => handle([leaving
    ? go(el, {transform: 'translateX(-8%)'}, {from: {transform: 'none'}, duration: T.screen, easing: spring('smooth'), keep: true})
    : go(el, {transform: 'none'}, {from: {transform: 'translateX(-8%)'}, duration: T.screen, easing: spring('smooth')})]));
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
