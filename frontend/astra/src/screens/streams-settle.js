// The stream list opened from Details moves itself in and out (the shell's enter/leave hooks, app/app.js):
// no slide. In the first frame its header is Details' hero, piece for piece (streams-hero.js); then, with
// --spring-smooth over --t-screen, the backdrop is cut to a strip (a window lifted over a picture held still), the poster
// and the title travel together to the strip's foot, and the chips and the list rise up under them, fading in
// where Details' own buttons were. Back is the same in reverse, from wherever things are (a Back during the
// settle turns it round; a scrolled list is first brought to its top without anything moving on screen), and
// the layer fades over the last moment so Details' own page is there when it goes. Only under Full motion:
// Reduced and Off take the shell's ordinary push (a fade, or nothing), with the header already short.

import {level, timed, T} from '../ui/motion.js';
import {go, spring, EASE, handle} from '../ui/motion-core.js';

/** The transform that puts a piece at its place on Details, given its short form `at` and its place there `r`. */
const onDetails = (r, at) => `translate(${r.left - at.left}px, ${r.top - at.top}px) scale(1)`;
const content = screen => [...screen.el.children].filter(el => el !== screen.top && !el.classList.contains('float-back'));

/** Arriving from Details: returns the motion's handle, or null for the shell's own push. */
export function settleIn(screen) {
  const s = screen.top?.settle;
  if (!s || level() !== 'full') return null;
  return timed('settle:streams', () => {
    const smooth = {duration: T.screen, easing: spring('smooth')};
    const anims = [go(s.art, {transform: s.art.style.transform}, {...smooth, from: {transform: 'translateY(0px)'}}),
      go(s.inner, {transform: s.inner.style.transform}, {...smooth, from: {transform: 'translateY(0px)'}}),
      go(s.edge, {transform: 'none', opacity: 1}, {...smooth, from: {transform: `translateY(${s.delta}px)`, opacity: 0}})];
    for (const [el, r, at] of s.pieces) anims.push(go(el, {transform: el.style.transform}, {...smooth, from: {transform: onDetails(r, at)}}));
    for (const el of content(screen)) {
      anims.push(go(el, {transform: 'none'}, {...smooth, from: {transform: `translateY(${s.delta}px)`}}));
      anims.push(go(el, {opacity: 1}, {duration: T.fade, easing: EASE, from: {opacity: 0}, join: true}));
    }
    return handle(anims);
  });
}

/** Back to Details: returns the motion's handle (the shell removes `layer` when it is done), or null for its own pop. */
export function settleOut(screen, layer) {
  const s = screen.top?.settle;
  if (!s || !screen.settled || level() !== 'full') return null;
  return timed('unsettle:streams', () => {
    const moving = [s.art, s.edge, ...s.pieces.map(p => p[0]), ...content(screen)];
    // Where each is on screen now (mid-settle, or scrolled), so bringing the list to its top moves nothing.
    const was = new Map(moving.map(el => [el, {top: el.getBoundingClientRect().top, transform: getComputedStyle(el).transform}]));
    screen.el.scrollTop = 0;
    const from = el => { const w = was.get(el), dy = w.top - el.getBoundingClientRect().top; return `translate(0px, ${dy}px) ${w.transform === 'none' ? '' : w.transform}`.trim(); };
    const smooth = {duration: T.screen, easing: spring('smooth'), keep: true};
    const inner = getComputedStyle(s.inner).transform;
    const anims = [go(s.art, {transform: 'translateY(0px)'}, {...smooth, from: {transform: from(s.art)}}),
      go(s.inner, {transform: 'translateY(0px)'}, {...smooth, from: {transform: inner}}),
      go(s.edge, {transform: `translateY(${s.delta}px)`, opacity: 0}, {...smooth, from: {transform: from(s.edge), opacity: getComputedStyle(s.edge).opacity}})];
    for (const [el, r, at] of s.pieces) anims.push(go(el, {transform: onDetails(r, at)}, {...smooth, from: {transform: from(el)}}));
    for (const el of content(screen)) {
      anims.push(go(el, {transform: `translateY(${s.delta}px)`}, {...smooth, from: {transform: from(el)}}));
      anims.push(go(el, {opacity: 0}, {duration: T.fade, easing: EASE, keep: true, join: true}));
    }
    // Details' own page (its buttons, its story) shows through as the header lands on its hero.
    anims.push(go(layer, {opacity: 0}, {duration: T.fast, delay: T.screen - T.fast, easing: EASE, keep: true}));
    return handle(anims);
  });
}
