// Shared pieces: the long press and the mind's shortlist. Poster cards, skeleton rows and empty states
// (ui/poster.js) and the lift menu, bottom sheets, dialogs and toasts (ui/overlays.js) are re-exported from here.

import {tick} from './motion.js';
// The lift menu, sheets, dialogs and toasts live in ui/overlays.js (the shell's); screens import them from here.
export {liftMenu, sheet, confirm, toast} from './overlays.js';

const LONG_PRESS_MS = 450;

/** Calls onLongPress after a still press; a normal tap still clicks. Returns a cleanup. */
export function longPress(el, onLongPress) {
  let timer = 0, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); start = null; };
  // Android Chrome also sends contextmenu for a long press (at about 400 ms):
  // whichever comes first opens the menu, once.
  const fire = e => { clearTimeout(timer); if (fired || document.querySelector('.lift, .sheet')) return; fired = true; tick('lift'); onLongPress(e); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false; start = {x: e.clientX, y: e.clientY};
    timer = setTimeout(() => fire(e), LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', e => { e.preventDefault(); fire(e); });
}

// Poster cards, images, skeleton rows and empty states live in ui/poster.js (the browse screens'); re-exported here.
export {posterCard, image, setWatchedBadge, skeletonRow, emptyCard} from './poster.js';

/** The mind's "three for tonight" (`astra/tonight`, astra.shortlist) in `slot` on Home: two or three
 * titles to pick from (a tap opens one) and the filters it chose by, its why behind a tap and
 * Dismiss. It never picks or plays (th/ported/arrangement.js reads it and sends the senses). */
export function mountTonight(app, slot) {
  import('/th/ported/arrangement.js').then(m => m.mount('astra', 'tonight', a => {
    const titles = (a.payload.titles || []).map(t => ({...t, at: /^astra:([^:]+):(.+)$/.exec(t.ref)})).filter(t => t.at);
    const filters = (a.payload.filters || []).join(' · ');
    if (!titles.length && !filters) return null;
    return {label: 'Three for tonight', title: titles.length ? 'Pick one' : filters, detail: titles.length ? filters : '',
      extra: titles.map(t => m.choice(a, t.title, () => app.openTitle({type: t.at[1], id: t.at[2], name: t.title})))};
  }, card => slot.replaceChildren(card))).catch(() => {});
}
