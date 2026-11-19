// Tiny DOM helpers. Text always goes in as text nodes.

import {level, hapticsSetting} from './motion-core.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** "1:05:09" / "4:07" from seconds. */
export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
}

/** "42m left", "1h 5m left". */
export function timeLeft(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

/** A vibration of `ms`, unless Settings › Motion and touch › Haptics is off (new code: tick() in ui/motion.js). */
export function haptic(ms = 10) { if (hapticsSetting() === 'off') return; try { navigator.vibrate?.(ms); } catch {} }

/** True when motion is Reduced or Off (Settings › Motion and touch, or the phone's own wish). */
export function reducedMotion() { return level() !== 'full'; }

/** True when CSS can drive animations from scrolling (then parallax needs no script). */
export const scrollTimelines = typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline: scroll()') === true;
