// @ts-check
// Ink and Lamp: the drag shared by Settings' kit controls (controls.js). A control is a zone a finger
// moves along (a fader's track, a dial, a slide switch) over a few stops; it follows the finger and,
// let go, settles on the nearest stop by the springs (th/motion.js, so Motion's setting holds), with a
// tick (Haptics' setting) at each stop it passes. The value is set by the page's own control (`pick`,
// a click on its option, exactly as a tap), so it is stored, synced and announced as it always was.
// A drag starts once a finger has moved 6 px more across than up or down: a page scroll that starts
// on a control is the page's. The click a drag ends in is the drag's.
import { animator, haptic, springs } from '/th/motion.js';

/**
 * @param {{
 *   zone: HTMLElement,                      the element a finger drags on
 *   stops: () => number[],                  each option's place, along the control's own measure
 *   at: () => number,                       the option chosen now
 *   read: (e: PointerEvent, from: { x: number, y: number, v: number, px: number, py: number }) => number,
 *   draw: (v: number) => void,              shows the control at `v`
 *   pick: (i: number) => void,              chooses option i as a tap does
 *   tap?: (e: PointerEvent) => number | null, the option a tap off the options means, or null
 *   starts?: (e: PointerEvent) => boolean,  whether a finger here may drag
 *   watch: { target: Node, options: MutationObserverInit },  what changes when the value does
 *   signal: AbortSignal,
 * }} o
 */
export function draggable(o) {
  const move = animator((v) => o.draw(v));
  const near = (/** @type {number} */ v) => {
    const s = o.stops();
    let best = 0;
    for (let i = 1; i < s.length; i++) if (Math.abs(s[i] - v) < Math.abs(s[best] - v)) best = i;
    return best;
  };
  const rest = (/** @type {boolean} */ spring) => {
    const v = o.stops()[o.at()] ?? 0;
    if (spring) move.to(v, { spring: springs.pop });
    else move.set(v);
  };
  rest(false);
  /** @type {{ id: number, x: number, y: number, v: number, px: number, py: number, on: boolean, n: number } | null} */
  let d = null;
  let swallow = false, driving = false;
  const choose = (/** @type {number} */ i) => {
    if (i !== o.at()) {
      driving = true;
      try { o.pick(i); } finally { driving = false; }
    }
    rest(true);
  };
  const on = { signal: o.signal };
  o.zone.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0 || (o.starts && !o.starts(e))) return;
    d = { id: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, v: move.value, on: false, n: o.at() };
  }, on);
  o.zone.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.hypot(dx, dy) < 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) { d = null; return; }
      d.on = true;
      move.stop();
      try { o.zone.setPointerCapture(e.pointerId); } catch {}
    }
    e.stopPropagation();
    const s = o.stops();
    const v = Math.min(Math.max(o.read(e, d), Math.min(...s)), Math.max(...s));
    d.v = v; d.px = e.clientX; d.py = e.clientY;
    move.set(v);
    const n = near(v);
    if (n !== d.n) { d.n = n; haptic('choose'); }
  }, on);
  const end = (/** @type {PointerEvent} */ e) => {
    if (!d || e.pointerId !== d.id) return;
    const was = d;
    d = null;
    if (was.on) {
      e.stopPropagation();
      swallow = true;
      setTimeout(() => { swallow = false; }, 80);
      choose(e.type === 'pointerup' ? near(was.v) : o.at());
    } else if (e.type === 'pointerup' && o.tap) {
      const i = o.tap(e);
      if (i !== null) choose(i);
    }
  };
  o.zone.addEventListener('pointerup', end, on);
  o.zone.addEventListener('pointercancel', end, on);
  o.zone.addEventListener('click', (e) => {
    if (!swallow || driving) return;
    swallow = false;
    e.stopPropagation();
    e.preventDefault();
  }, { capture: true, signal: o.signal });
  // Chosen any other way (a tap, the keyboard, a reset, a sync): it settles there.
  const seen = new MutationObserver(() => { if (!d?.on) rest(true); });
  seen.observe(o.watch.target, o.watch.options);
  o.signal.addEventListener('abort', () => { seen.disconnect(); move.stop(); });
  return { rest, near };
}
