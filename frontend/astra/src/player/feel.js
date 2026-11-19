// The player's motion, made from the foundation's own pieces (ui/motion-core.js: `go` takes over from
// where an element is, `handle` makes {finished, cancel}; ui/feel-log.js times each run), so every
// movement here follows Settings › Motion (Full; Reduced: 120 ms fades, no travel; Off: none), can be
// interrupted and lands in the feel report under a fixed name. ui/motion.js has no generic "this
// state changed, animate it" or "fade this out, then hide it": the player needs both, so they live
// here, beside the screen that uses them (FEEL.md: only transform and opacity move).

import {T, EASE, spring, level, go, stop, handle, instant} from '../ui/motion-core.js';
import {timed} from '../ui/feel-log.js';

export {T, EASE, spring, level, go, stop, handle};
export {tick} from '../ui/motion.js';

const look = el => { const s = getComputedStyle(el); return {opacity: s.opacity, transform: s.transform}; };

/**
 * A state change on some elements (a class added or removed by `change`), animated from where each
 * one is now to where its styles put it afterwards: transform on a spring, opacity on the ease. The
 * styles keep the end state, so nothing is left filled; a second change during the first takes over
 * from where things are (rule 4).
 */
export function restyle(els, change, {name = 'restyle', ms = T.fast, curve = 'snappy', delay = 0} = {}) {
  els = els.filter(Boolean);
  const before = els.map(look);
  change();
  return timed(name, () => {
    const lv = level(), anims = [];
    els.forEach((el, i) => {
      stop(el);
      if (lv === 'off') return;
      const a = before[i], b = look(el);
      if (a.opacity === b.opacity && a.transform === b.transform) return;
      if (lv === 'reduced') { if (a.opacity !== b.opacity) anims.push(go(el, {opacity: b.opacity}, {from: {opacity: a.opacity}, duration: T.fade})); return; }
      anims.push(go(el, {transform: b.transform}, {from: {transform: a.transform}, duration: ms, easing: spring(curve), delay}));
      anims.push(go(el, {opacity: b.opacity}, {from: {opacity: a.opacity}, duration: ms, easing: EASE, delay, join: true}));
    });
    return anims.length ? handle(anims) : instant();
  });
}

/**
 * Something appearing from an edge: from `offset` (a transform added to where its styles put it, so
 * a centred card stays centred) and transparent, to its place. Reduced: a 120 ms fade. Off: at once.
 */
export function appear(el, {name = 'appear', offset = 'translateY(12px)', ms = T.screen, curve = 'smooth', delay = 0} = {}) {
  return timed(name, () => {
    const lv = level();
    stop(el);
    if (lv === 'off' || !el.isConnected) return instant();
    if (lv === 'reduced') return handle([go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.fade, delay})]);
    const at = getComputedStyle(el).transform, base = at === 'none' ? '' : at + ' ';
    return handle([
      go(el, {transform: at}, {from: {transform: base + offset}, duration: ms, easing: spring(curve), delay}),
      go(el, {opacity: 1}, {from: {opacity: 0}, duration: Math.min(ms, T.normal), easing: EASE, delay, join: true}),
    ]);
  });
}

/** A fade of `el`'s opacity to `to` (from `from`, else from where it is), kept until stop(el) or the next motion. */
export function fade(el, to, {name = 'fade', from = null, ms = T.fade, delay = 0} = {}) {
  return timed(name, () => {
    if (level() === 'off') { go(el, {opacity: to}, {from: {opacity: to}, duration: 0, keep: true}); return instant(); }
    return handle([go(el, {opacity: to}, {from: from == null ? null : {opacity: from}, duration: ms, easing: EASE, delay, keep: true})]);
  });
}

/** Whether `el` is out of the way: hidden, or on its way out (leave()). */
export const gone = el => el.hidden || el.dataset.leaving != null;

/**
 * Takes `el` away: at once it is out of reach (inert, marked leaving, so what it covered takes
 * touches in the same frame: rule 1), then it fades (and moves by `offset`, Full only) and is hidden.
 * arrive() during the leave takes it back from where it is.
 */
export function leave(el, {name = 'leave', ms = T.fade, offset = null, then = null} = {}) {
  if (el.hidden) { then?.(); return instant(); }
  el.dataset.leaving = '';
  el.inert = true;
  const done = cancelled => {
    if (cancelled && el.dataset.leaving == null) return; // arrive() took it back
    delete el.dataset.leaving; el.inert = false; el.hidden = true; stop(el); then?.();
  };
  return timed(name, () => {
    const lv = level();
    if (lv === 'off') { done(false); return instant(); }
    const anims = [go(el, {opacity: 0}, {duration: lv === 'full' ? ms : T.fade, easing: EASE, keep: true})];
    if (offset && lv === 'full') {
      const at = getComputedStyle(el).transform;
      anims.push(go(el, {transform: (at === 'none' ? '' : at + ' ') + offset}, {duration: ms, easing: EASE, keep: true, join: true}));
    }
    const h = handle(anims);
    h.finished.then(({cancelled}) => done(cancelled));
    return h;
  });
}

/**
 * Shows `el` again, fading in over `ms` from where it is (a leave under way turns back from its own
 * opacity, a hidden one starts from 0). `ms: 0` shows it at once, for a caller that animates it
 * itself. Returns whether it was out of the way.
 */
export function arrive(el, {name = 'arrive', ms = T.fast} = {}) {
  const was = gone(el);
  if (!was) return false;
  const from = el.hidden ? 0 : Number(getComputedStyle(el).opacity);
  delete el.dataset.leaving; el.inert = false; el.hidden = false;
  if (!ms || level() === 'off') { stop(el); return true; }
  fade(el, 1, {name, from, ms}).finished.then(({cancelled}) => { if (!cancelled) stop(el); });
  return true;
}

/**
 * A copy of `el` left in its place to fade out (and drift by `offset`) while the element itself is
 * already hidden: the player's state changes at once, the picture eases. For small things (a chip,
 * a card), never a screen.
 */
export function ghost(el, {name = 'ghost', offset = null, ms = T.fade} = {}) {
  const lv = level();
  if (lv === 'off' || el.hidden || !el.isConnected || !el.offsetParent) return;
  const at = getComputedStyle(el).transform, copy = el.cloneNode(true);
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.style.pointerEvents = 'none';
  copy.style.transform = at === 'none' ? '' : at;
  el.after(copy);
  timed(name, () => {
    const anims = [go(copy, {opacity: 0}, {duration: lv === 'full' ? ms : T.fade, easing: EASE, keep: true})];
    if (offset && lv === 'full') anims.push(go(copy, {transform: (at === 'none' ? '' : at + ' ') + offset}, {duration: ms, easing: EASE, keep: true, join: true}));
    const h = handle(anims, () => copy.remove());
    h.finished.then(() => copy.remove());
    return h;
  });
}

/** A press held in (scale .97) until release(): the tapped card stays pressed under the player. */
export function holdIn(el, {name = 'press'} = {}) {
  if (level() === 'off') return;
  timed(name, () => handle([go(el, {transform: 'scale(0.97)'}, {duration: T.press, easing: EASE, keep: true})]));
}

/** Lets a held press go, with the snappy spring (after `delay` ms). */
export function release(el, {delay = 0} = {}) {
  const lv = level();
  if (lv !== 'full') { stop(el); return; }
  const a = go(el, {transform: 'none'}, {duration: T.normal, easing: spring('snappy'), delay, keep: true});
  a.finished.then(() => stop(el), () => {});
}

/**
 * A value that follows a target on the snappy spring (stiffness 420, damping 34), drawn by `draw(x)`
 * each frame: the seek bar's bubble behind the finger. set(x, {jump}) moves the target (jump: there
 * at once, as on the first touch: the answer is in the same frame). Off or Reduced: always a jump.
 */
export function follower(draw, {stiffness = 420, damping = 34} = {}) {
  let x = null, v = 0, target = 0, frame = 0, last = 0;
  const step = now => {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    v += (stiffness * (target - x) - damping * v) * dt;
    x += v * dt;
    if (Math.abs(target - x) < 0.3 && Math.abs(v) < 4) { x = target; v = 0; frame = 0; draw(x); return; }
    draw(x);
    frame = requestAnimationFrame(step);
  };
  return {
    set(to, {jump = false} = {}) {
      target = to;
      if (jump || x == null || level() !== 'full') { cancelAnimationFrame(frame); frame = 0; x = to; v = 0; draw(x); return; }
      if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); }
    },
    stop() { cancelAnimationFrame(frame); frame = 0; x = null; v = 0; },
  };
}
