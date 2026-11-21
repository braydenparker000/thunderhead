// The recorder's check that the icons are painted (MUSIC.md §5.10 "Movement and layout", §5.11 "Icons
// that disappeared"): once a change of screen has settled, the navbar's icons and the A–Z bar (when the
// list shows it) are read for what would hide them. Only names and numbers: never a title or a letter
// of the list.
import {VISIBLE} from '../res/values.js';

const round = x => (Number.isFinite(x) ? Math.round(x) : null);

/**
 * One target's state: `model` the views up the tree show it (visible, alpha > 0); `hiddenBy` what in the
 * page hides it despite that (display, visibility, content-visibility, opacity of it or an element above);
 * its box; `marks` the drawn marks in it (icons, letters); `masks` its masked shapes and `foreign` those
 * whose mask id resolves to another element than their own icon's (a hidden copy's, or none).
 */
export function paintState(name, view, el = view.el) {
  let model = true;
  for (let v = view; v; v = v.parent) if (v.visibility !== VISIBLE || !(v.alpha > 0)) model = false;
  let hiddenBy = el.isConnected ? null : 'detached';
  for (let e = el; e && !hiddenBy && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none') hiddenBy = 'display';
    else if (cs.contentVisibility === 'hidden') hiddenBy = 'content-visibility';
    else if (+cs.opacity === 0) hiddenBy = 'opacity';
    else if (e === el && cs.visibility === 'hidden') hiddenBy = 'visibility';
  }
  const r = el.getBoundingClientRect();
  let masks = 0, foreign = 0;
  for (const n of el.querySelectorAll('[mask]')) {
    masks++;
    const id = /url\(#([^)]+)\)/.exec(n.getAttribute('mask') ?? '')?.[1];
    const m = id ? document.getElementById(id) : null;
    if (!m || m.ownerSVGElement !== n.ownerSVGElement) foreign++;
  }
  const marks = el.querySelectorAll('svg, .ln').length;
  const s = {name, model, hiddenBy, w: round(r.width), h: round(r.height), marks, masks, foreign};
  s.problem = model && (!!hiddenBy || !s.w || !s.h || !marks || foreign > 0);
  return s;
}

/** The navbar's icons and the A–Z bar, with what hides each; `problems` only those shown in the model and not painted. */
export function iconStates(ctx) {
  const out = [];
  for (const b of ctx.root?.findViewById?.('navbar_nav_buttons')?.children ?? []) if (b.visibility === VISIBLE) out.push(paintState(`nav:${b.id}`, b));
  const sc = ctx.listScroller;
  if (sc && ctx.listWidget?.mode === 'list' && sc.mode === 2) {
    const az = paintState('az', sc);
    // The bar's letters are drawn with their own alpha (a fade): at rest it is 1.
    az.alpha = round(sc.textAlpha * 100) / 100;
    if (az.model && az.alpha < 1) az.problem = true;
    out.push(az);
  }
  return out;
}
