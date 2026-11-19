// A sheet's motion (FEEL.md "Sheets and menus"): it rises with --spring-smooth; it follows a finger
// exactly, resists upward (one fifth of the finger's travel), and is dismissed past 30% of its
// height or by a downward fling faster than 0.5 px/ms; the scrim's darkness follows its position.
// Part of ui/motion.js's API (screens import it from there).

import {T, EASE, spring, level, go, stop, handle, instant, tick} from './motion-core.js';
import {timed} from './feel-log.js';

export const DISMISS_SHARE = 0.3; // of the sheet's height
export const FLING = 0.5; // px/ms, downward

/** Where a sheet sits for a finger `dy` px below where it took hold (negative: above). */
export const resist = dy => dy >= 0 ? dy : dy / 5;
/** Whether a released drag dismisses: past 30% of the height, or a downward fling over 0.5 px/ms. */
export const shouldDismiss = ({offset, height, velocity}) => offset > DISMISS_SHARE * height || velocity > FLING;

const translateY = el => { const t = getComputedStyle(el).transform; return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0; };

/**
 * Gives `el` (the sheet's body) its motion: it rises now; dragged by its grab area (`grab`, by
 * default its `.sheet-grab` or itself) it follows the finger. `scrim` (optional) is the element
 * whose opacity is the darkness behind. `onDismiss` runs when a drag dismisses it (after it has
 * gone). Returns {finished (the rise), close() → {finished} (it leaves, then the caller removes
 * it), cancel(), destroy()}.
 */
export function sheet(el, {scrim = null, onDismiss = null, grab = null, name = 'sheet'} = {}) {
  const handleEl = grab || el.querySelector('.sheet-grab') || el;
  const height = () => el.getBoundingClientRect().height + 16; // past its bottom margin
  let closed = false, drag = null, opening = null;

  const shade = to => scrim && go(scrim, {opacity: to}, {duration: T.normal, easing: EASE, keep: true});
  const rest = () => { stop(el); el.style.transform = ''; if (scrim) { stop(scrim); scrim.style.opacity = ''; } };

  function rise() {
    return timed(name + ':open', () => {
      const lv = level();
      if (lv === 'off') return instant();
      if (lv === 'reduced') return handle([go(el, {opacity: 1}, {from: {opacity: 0}, duration: T.fade}), scrim && go(scrim, {opacity: 1}, {from: {opacity: 0}, duration: T.fade})].filter(Boolean));
      return handle([go(el, {transform: 'none'}, {from: {transform: `translateY(${height()}px)`}, duration: T.travel, easing: spring('smooth')}),
        scrim && go(scrim, {opacity: 1}, {from: {opacity: 0}, duration: T.normal, easing: EASE})].filter(Boolean));
    });
  }

  function close({velocity = 0} = {}) {
    closed = true;
    return timed(name + ':close', () => {
      const lv = level(), h = height();
      el.style.transform = ''; // the drag's own position is where the animation starts (read below)
      if (lv === 'off') { go(el, {opacity: 0}, {from: {opacity: 0}, duration: 0, keep: true}); if (scrim) go(scrim, {opacity: 0}, {from: {opacity: 0}, duration: 0, keep: true}); return instant(); }
      if (lv === 'reduced') return handle([go(el, {opacity: 0}, {duration: T.fade, keep: true}), shade(0)].filter(Boolean));
      // A fling leaves faster: the spring's time shrinks with the speed (never under 160 ms).
      const ms = velocity > FLING ? Math.max(160, Math.min(T.sheet, h / velocity)) : T.sheet;
      return handle([go(el, {transform: `translateY(${h}px)`}, {from: drag?.last != null ? {transform: `translateY(${drag.last}px)`} : null, duration: ms, easing: spring('smooth'), keep: true}),
        scrim && go(scrim, {opacity: 0}, {duration: ms, easing: EASE, keep: true})].filter(Boolean));
    });
  }

  function settleBack(from) {
    if (level() === 'off') { rest(); return; }
    el.style.transform = '';
    timed(name + ':settle', () => handle([go(el, {transform: 'none'}, {from: {transform: `translateY(${from}px)`}, duration: T.sheet, easing: level() === 'full' ? spring('smooth') : EASE}),
      scrim && go(scrim, {opacity: 1}, {duration: T.normal, easing: EASE})].filter(Boolean)));
  }

  const down = e => {
    if (closed || e.button !== 0) return;
    const at = translateY(el); // a drag during the rise takes over from where the sheet is
    opening?.cancel();
    stop(el);
    if (scrim) stop(scrim);
    drag = {id: e.pointerId, y0: e.clientY - at, last: at, samples: [{y: e.clientY, t: e.timeStamp}], past: false, h: height()};
    el.style.transform = `translateY(${at}px)`;
    try { handleEl.setPointerCapture(e.pointerId); } catch {}
  };
  const move = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const pos = resist(e.clientY - drag.y0);
    drag.last = pos;
    drag.samples.push({y: e.clientY, t: e.timeStamp});
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 80) drag.samples.shift();
    el.style.transform = `translateY(${pos}px)`;
    if (scrim) scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - pos / drag.h)));
    const past = pos > DISMISS_SHARE * drag.h;
    if (past !== drag.past) { drag.past = past; if (past) tick('edge'); }
  };
  const up = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const first = drag.samples[0], last = drag.samples.at(-1);
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const offset = drag.last, h = drag.h;
    if (e.type !== 'pointercancel' && shouldDismiss({offset, height: h, velocity})) {
      close({velocity}).finished.then(() => onDismiss?.());
    } else settleBack(offset);
    drag = null;
  };
  handleEl.addEventListener('pointerdown', down);
  handleEl.addEventListener('pointermove', move);
  handleEl.addEventListener('pointerup', up);
  handleEl.addEventListener('pointercancel', up);
  const destroy = () => {
    handleEl.removeEventListener('pointerdown', down);
    handleEl.removeEventListener('pointermove', move);
    handleEl.removeEventListener('pointerup', up);
    handleEl.removeEventListener('pointercancel', up);
  };
  opening = rise();
  return {finished: opening.finished, close, cancel: () => { opening.cancel(); rest(); }, destroy};
}
