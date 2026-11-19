// The one place Astra's motion is made (FEEL.md). Screens call these and nothing else moves a
// screen, a shared element, a sheet or a press. Each honours the motion level (Full, Reduced: a
// 120 ms cross-fade instead of travel or a slide, Off: no animation at all), can be interrupted
// (a new call on the same element starts from where it is; cancel() leaves things sane), and
// times itself into the feel log under its `name`.

import {T, EASE, spring, level, go, stop, handle, instant, decoded, frames, painted, hapticsSetting, motionChoice} from './motion-core.js';
import {timed, feelEntries, reportText} from './feel-log.js';

export {level, onLevel, tick, setMotionChoice, setHaptics, levelFor, hapticPattern, T} from './motion-core.js';
export {timed} from './feel-log.js';
export {stop} from './motion-core.js';
export {sheet, shouldDismiss, resist} from './sheet-motion.js';

/** The feel log as plain text, with the level and haptics it was made under. */
export const feelReport = () => reportText(feelEntries(), {motion: `${level()} (${motionChoice()})`, haptics: hapticsSetting()});

const pressed = new WeakSet();
/**
 * The pressed state (FEEL.md "Press"): scale .97 on pointerdown, in --t-press, released with
 * --spring-snappy. Shown in the same frame as the touch, before any work. Calling it twice on one
 * element does nothing more.
 */
export function press(el, {scale = 0.97, name = 'press'} = {}) {
  if (!el || pressed.has(el)) return el;
  pressed.add(el);
  let down = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || level() === 'off') return;
    down = true;
    timed(name, () => go(el, {transform: `scale(${scale})`}, {duration: T.press, easing: EASE, keep: true}).finished.then(() => ({cancelled: false}), () => ({cancelled: true})));
  });
  const up = () => {
    if (!down) return;
    down = false;
    const lv = level();
    if (lv === 'off') { stop(el); return; }
    go(el, {transform: 'none'}, {duration: T.normal, easing: lv === 'full' ? spring('snappy') : EASE});
  };
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, up);
  return el;
}

const isElement = v => typeof Element !== 'undefined' && v instanceof Element;
const rectOf = v => isElement(v) ? v.getBoundingClientRect() : v && Number.isFinite(v.width) ? {left: v.left ?? v.x, top: v.top ?? v.y, width: v.width, height: v.height} : null;
const radiusOf = el => isElement(el) ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0;
const hidden = new WeakMap();
const hide = el => { if (isElement(el) && !hidden.has(el)) { hidden.set(el, el.style.visibility); el.style.visibility = 'hidden'; } };
const show = el => { if (isElement(el) && hidden.has(el)) { el.style.visibility = hidden.get(el); hidden.delete(el); } };

/**
 * A copy of a picture box that shows exactly what the original shows now: each picture its current
 * address (`currentSrc`), asked for at once and decoded before it is drawn (never a lazy picture that
 * arrives later, never the 200 ms fade of a picture arriving).
 */
function copyOf(source) {
  const copy = source.cloneNode(true);
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  const pics = el => el.tagName === 'IMG' ? [el] : [...el.querySelectorAll('img')];
  const mine = pics(copy), theirs = pics(source);
  mine.forEach((img, i) => {
    img.loading = 'eager'; img.decoding = 'sync'; img.classList.remove('loaded'); img.removeAttribute('srcset');
    const src = theirs[i]?.currentSrc || theirs[i]?.src;
    if (src && img.src !== src) img.src = src;
  });
  // Only the pictures the original has painted are waited for: one still arriving shows its placeholder in both.
  return {copy, pictures: mine.filter((img, i) => theirs[i]?.complete && theirs[i].naturalWidth > 0)};
}

/**
 * A shared element (FEEL.md "Poster → Details"): a copy of `from` flies to `to`'s place and size
 * (--spring-smooth over --t-travel); then `to` is shown. Nothing is ever without its picture: `to` is
 * hidden at once (it is not seen yet), `from` only once the copy has painted over it (its picture
 * decoded, then a frame), and the copy goes only once `to`'s picture has decoded and painted under it.
 * `from` and `to` are elements or rects ({left, top, width, height}); with a rect for `from`, a copy of
 * `to` flies from there. `radius` is the corner radius at each end ([from, to] or one number; read from
 * the elements by default). `replaces` is a copy an interrupted flight left in place (cancel({keep})):
 * it stays until this flight's copy has painted. `onStart` runs when the copy starts to move.
 * Reduced: `to` fades in over 120 ms. Off: nothing moves. Returns {finished, cancel({keep})}: finished
 * resolves once the copy has gone; cancel() removes the copy and shows both originals, cancel({keep:
 * true}) leaves the copy where it is and returns it (for the flight that takes over).
 */
export function travel(from, to, {name = 'travel', radius = null, onStart = null, onEnd = null, replaces = null} = {}) {
  const a = rectOf(from), b = rectOf(to), source = isElement(from) ? from : isElement(to) ? to : null;
  const lv = level();
  const plain = settle => { replaces?.remove(); onStart?.(); return settle; };
  if (lv === 'off' || !a || !b || !source || !b.width || !b.height || !a.width || !a.height) return timed(name, () => instant(plain(cancelled => { show(from); show(to); onEnd?.({cancelled}); })));
  if (lv === 'reduced') return timed(name, () => isElement(to) ? handle([go(to, {opacity: 1}, {from: {opacity: 0}, duration: T.fade})], plain(cancelled => onEnd?.({cancelled}))) : instant(plain(() => onEnd?.({cancelled: false}))));
  {
    const {copy, pictures} = copyOf(source);
    Object.assign(copy.style, {position: 'fixed', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px', margin: '0', zIndex: '5000',
      pointerEvents: 'none', transformOrigin: '50% 50%', boxSizing: 'border-box', overflow: 'hidden', visibility: 'hidden', willChange: 'transform, clip-path'});
    document.body.append(copy);
    hide(to);
    // The copy has `to`'s size; at the start it is scaled evenly to cover `from` and cut to its shape.
    const s = Math.max(a.width / b.width, a.height / b.height);
    const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const ix = Math.max(0, (b.width - a.width / s) / 2), iy = Math.max(0, (b.height - a.height / s) / 2);
    const [r0, r1] = Array.isArray(radius) ? radius : radius != null ? [radius, radius] : [radiusOf(from), radiusOf(to)];
    // Held at its start (over `from`, the same picture) until it has painted there; then it moves.
    const anim = go(copy, {transform: 'none', clipPath: `inset(0px 0px round ${r1}px)`},
      {from: {transform: `translate(${dx}px, ${dy}px) scale(${s})`, clipPath: `inset(${iy}px ${ix}px round ${r0 / s}px)`}, duration: T.travel, easing: spring('smooth'), keep: true});
    anim.pause();
    let state = 'waiting', resolve;
    const finished = new Promise(r => { resolve = r; });
    // Unseen until its pictures are decoded (it never covers the card with an empty tile), then shown over the
    // card for a frame, and only then is the card hidden and the copy let go.
    decoded(pictures).then(() => { if (state === 'waiting') copy.style.visibility = 'visible'; return frames(2); }).then(() => {
      if (state !== 'waiting') return;
      state = 'flying';
      replaces?.remove();
      hide(from);
      anim.play();
      // Timed in the feel log from here: the frames of the flight itself, not the wait before it.
      timed(name, () => ({finished: anim.finished.then(() => ({cancelled: false}), () => ({cancelled: true}))}));
      onStart?.();
    });
    const end = (cancelled, keep = false) => {
      if (state === 'done') return null;
      state = 'done';
      replaces?.remove();
      show(from); show(to);
      onEnd?.({cancelled});
      if (cancelled) {
        if (keep) { try { anim.commitStyles(); } catch {} }
        anim.cancel();
        if (!keep) copy.remove();
        resolve({cancelled: true});
        return keep ? copy : null;
      }
      // Landed: `to` is shown under the copy, which goes once `to`'s own picture has painted.
      painted(isElement(to) ? [...(to.tagName === 'IMG' ? [to] : to.querySelectorAll('img'))].filter(img => img.src) : [], {cap: 400}).then(() => { copy.remove(); resolve({cancelled: false}); });
      return null;
    };
    anim.finished.then(() => end(false), () => end(true));
    return {finished, cancel: ({keep = false} = {}) => end(true, keep)};
  }
}

/**
 * A pushed screen (FEEL.md "Any other pushed screen"): `inEl` comes from --d-push (8% to the right)
 * with --spring-smooth over --t-screen, opaque from its first frame, while `outEl` recedes (scale .98,
 * 8% dimmer) and stays so until pop(). Reduced: `inEl` fades in over 120 ms. Off: at once.
 */
export function push(inEl, outEl, {name = 'push'} = {}) {
  return timed(name, () => {
    const lv = level();
    if (lv === 'off') { stop(inEl); return instant(); }
    if (lv === 'reduced') { stop(inEl); return handle([go(inEl, {opacity: 1}, {from: {opacity: 0}, duration: T.fade})]); }
    // Opaque from its first frame: it only moves (a fade would show both screens blended); the fade is Reduced's.
    const anims = [go(inEl, {transform: 'none'}, {from: {transform: 'translateX(8%)'}, duration: T.screen, easing: spring('smooth')})];
    if (outEl) anims.push(go(outEl, {transform: 'scale(0.98)', opacity: 0.92}, {duration: T.screen, easing: spring('smooth'), keep: true}));
    return handle(anims);
  });
}

/**
 * Back from a pushed screen: `outEl` (the screen leaving) goes back to 8% to the right and fades,
 * and stays hidden until the caller removes it; `inEl` (the screen under it) comes forward from
 * where it is. Started during a push, both take over from where they are. Reduced: `outEl` fades
 * over 120 ms. Off: at once (`outEl` is hidden at once).
 */
export function pop(inEl, outEl, {name = 'pop'} = {}) {
  return timed(name, () => {
    const lv = level();
    if (inEl) stop(inEl);
    if (lv === 'off') { if (outEl) go(outEl, {opacity: 0}, {from: {opacity: 0}, duration: 0, keep: true}); return instant(); }
    if (lv === 'reduced') return handle(outEl ? [go(outEl, {opacity: 0}, {duration: T.fade, keep: true})] : []);
    const anims = [];
    if (outEl) {
      anims.push(go(outEl, {transform: 'translateX(8%)'}, {duration: T.screen, easing: spring('smooth'), keep: true}));
      anims.push(go(outEl, {opacity: 0}, {duration: 200, easing: EASE, delay: 40, keep: true, join: true}));
    }
    if (inEl) anims.push(go(inEl, {transform: 'none', opacity: 1}, {from: {transform: 'scale(0.98)', opacity: 0.92}, duration: T.screen, easing: spring('smooth')}));
    return handle(anims);
  });
}

/**
 * Content rising into place (FEEL.md: --d-rise, in up to 4 groups 30 ms apart). `els` is a list of
 * elements, or of lists of elements (one list a group); more than 4 are split into 4 groups in order.
 * `delay` (ms) holds them hidden first, at Full only. Reduced: all fade in over 120 ms. Off: nothing moves.
 */
export function rise(els, {name = 'rise', delay = 0} = {}) {
  return timed(name, () => {
    const lv = level(), list = [...(els || [])].filter(Boolean);
    if (lv === 'off' || !list.length) return instant();
    const groups = list.length <= 4 ? list.map(g => [g].flat()) : Array.from({length: 4}, (_, i) => list.slice(Math.round(i * list.length / 4), Math.round((i + 1) * list.length / 4)).flat());
    const anims = [];
    groups.forEach((group, i) => {
      for (const el of group) {
        if (lv === 'reduced') { anims.push(go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.fade})); continue; }
        anims.push(go(el, {transform: 'none'}, {from: {transform: 'translateY(12px)'}, duration: T.normal, easing: spring('smooth'), delay: delay + i * 30}));
        anims.push(go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.normal, delay: delay + i * 30, join: true}));
      }
    });
    return handle(anims);
  });
}

/**
 * The tab change (FEEL.md "Tabs"): no slide. The old tab fades out in 90 ms, then the new one fades
 * in over 120 ms rising 6 px. `onOut` runs once, when the old one is gone, at once when nothing moves, or
 * when interrupted (another tab chosen): it must check which tab is current before hiding the old one.
 */
export function swap(inEl, outEl, {name = 'tab', onOut = null} = {}) {
  return timed(name, () => {
    const lv = level();
    if (outEl) stop(outEl);
    stop(inEl);
    if (lv === 'off' || !outEl) { onOut?.(); return lv === 'off' ? instant() : handle([go(inEl, {opacity: 1}, {from: {opacity: 0}, duration: T.fade})]); }
    const out = go(outEl, {opacity: 0}, {duration: 90, easing: 'linear', keep: true});
    // Once only; interrupted, it still runs (the caller checks which tab is current).
    let gone = false;
    const done = () => { if (gone) return; gone = true; onOut?.(); };
    out.finished.then(() => { done(); stop(outEl); }, () => {});
    const anims = [out, go(inEl, {opacity: 1}, {from: {opacity: 0}, duration: T.fade, delay: 90})];
    if (lv === 'full') anims.push(go(inEl, {transform: 'none'}, {from: {transform: 'translateY(6px)'}, duration: T.fade, delay: 90, easing: spring('snappy'), join: true}));
    return handle(anims, cancelled => { if (cancelled) done(); });
  });
}

/**
 * Something appearing in place (a dialog, a toast, a menu, the lifted poster): from `from` (a
 * transform) to `to` on the spring named (`smooth`, `snappy`, `lively`), fading in over --t-fast
 * unless `fade` is false; `delay` (ms, Full only) holds it at its start first. Reduced: a 120 ms fade.
 * Off: at once.
 */
export function enter(el, {from = 'scale(0.96)', to = 'none', spring: curve = 'smooth', duration = T.normal, fade = true, delay = 0, name = 'enter'} = {}) {
  return timed(name, () => {
    const lv = level();
    stop(el);
    if (lv === 'off') return instant();
    if (lv === 'reduced') return handle([go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.fade})]);
    const anims = [go(el, {transform: to}, {from: {transform: from}, duration, delay, easing: spring(curve)})];
    if (fade) anims.push(go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.fast, delay, join: true}));
    return handle(anims);
  });
}

/**
 * Something leaving (FEEL.md: things leave by fading, or go back where they came from): fades out
 * over --t-fast and, with `to`, moves there on the spring named. It stays as it ends until the caller
 * removes it. Reduced: a 120 ms fade. Off: hidden at once.
 */
export function exit(el, {to = null, spring: curve = 'smooth', duration = T.normal, fade = true, name = 'exit'} = {}) {
  return timed(name, () => {
    const lv = level();
    if (lv === 'off') { stop(el); go(el, {opacity: 0}, {from: {opacity: 0}, duration: 0, keep: true}); return instant(); }
    if (lv === 'reduced') return handle([go(el, {opacity: 0}, {duration: T.fade, keep: true})]);
    const anims = [];
    if (to) anims.push(go(el, {transform: to}, {duration, easing: spring(curve), keep: true}));
    if (fade) anims.push(go(el, {opacity: 0}, {duration: T.fast, keep: true, join: !!to}));
    return anims.length ? handle(anims) : instant();
  });
}

/** A scrim or a blur fading to `opacity` (0 or 1) with the standard ease; it stays there. */
export function fadeTo(el, opacity, {duration = T.normal, name = 'fade'} = {}) {
  return timed(name, () => {
    const lv = level();
    if (lv === 'off') { stop(el); go(el, {opacity}, {from: {opacity}, duration: 0, keep: true}); return instant(); }
    return handle([go(el, {opacity}, {duration: lv === 'reduced' ? T.fade : duration, keep: true})]);
  });
}
