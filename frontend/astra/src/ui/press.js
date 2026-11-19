// The press (FEEL.md "Press") and the feel report, beside ui/motion.js, which screens import them from.

import {T, EASE, spring, level, go, stop, hapticsSetting, motionChoice} from './motion-core.js';
import {timed, feelEntries, reportText, measureRefresh, refreshRate} from './feel-log.js';

/** The feel log as plain text, with the screen's refresh rate and the level and haptics it was made under. */
export function feelReport() {
  const text = reportText(feelEntries(), {motion: `${level()} (${motionChoice()})`, haptics: hapticsSetting()}, refreshRate());
  measureRefresh(); // afresh for the next report (the phone may have changed its rate)
  return text;
}
measureRefresh(); // the first quiet second after start

const pressed = new WeakSet();
/**
 * The pressed state (FEEL.md "Press"): scale .97 on pointerdown, in --t-press, released with
 * --spring-snappy. Shown in the same frame as the touch, before any work. Calling it twice on one
 * element does nothing more.
 */
export function press(el, {scale = 0.97, name = 'press'} = {}) {
  if (!el || pressed.has(el)) return el;
  pressed.add(el);
  let down = false, current = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || level() === 'off') return;
    down = true;
    // A release during the press-in is how a press ends, not a cut; a cancel (a scroll took over) is.
    const one = current = {released: false};
    timed(name, () => go(el, {transform: `scale(${scale})`}, {duration: T.press, easing: EASE, keep: true}).finished.then(() => ({cancelled: false}), () => ({cancelled: !one.released})));
  });
  const up = e => {
    if (!down) return;
    down = false;
    if (current) current.released = e?.type === 'pointerup';
    const lv = level();
    if (lv === 'off') { stop(el); return; }
    go(el, {transform: 'none'}, {duration: T.normal, easing: lv === 'full' ? spring('snappy') : EASE});
  };
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, up);
  return el;
}

