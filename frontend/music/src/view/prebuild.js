// Screens built before they move (MUSIC.md §5.11 "Transitions at the screen's rate"): in idle time after
// start, the player screen's likely next scenes (player, library, search, equaliser) and the navbar's lines have their layouts
// inflated, the views they show laid out at their size there and written while still hidden, laid out by
// the browser once and kept so while gone, and their images decoded, so no transition builds a screen in
// its frames. A scene not built by then is built where it always was, in the scene change itself, before
// its first frame (the animation's clock starts at its first frame, so it starts that much later and does
// not jump).
import {MeasureSpec} from './view.js';
import {collect} from './scene.js';
import {markForLayout} from './scene-layout.js';
import {isMoving} from './motion.js';
import {GONE} from '../res/values.js';

export const LIKELY_SCENES = ['scene_playing', 'scene_lib', 'scene_search', 'scene_eq'];

const exact = n => MeasureSpec.make(n, MeasureSpec.EXACTLY);

function relayout(root) {
  const l = root.left, t = root.top, r = root.right, b = root.bottom;
  root.measure(exact(r - l), exact(b - t));
  root.layout(l, t, r, b);
}

/**
 * Builds a scene of a scene root while it shows another: its layouts are inflated, and the views the
 * scene shows that are gone now are measured and laid out at their place in it and written (their
 * children; they stay hidden), then the present scene's layout returns as it was. Their images are
 * decoded. Returns false when the scene was built before.
 */
export function buildScene(root, scene) {
  if (root.built?.has(scene)) return false;
  (root.built ??= new Set()).add(scene);
  root.loadBehaviorsFor?.(scene);
  const shows = [];
  for (const {view, rec} of collect(root, scene, [])) {
    if (view.visibility === GONE && rec.visibility !== undefined && rec.visibility !== GONE) shows.push({view, rec, lp: view.lp});
  }
  if (!shows.length || !(root.width > 0 && root.height > 0)) return true;
  for (const s of shows) {
    if (s.rec.lp) s.view.lp = s.rec.lp;
    s.view.visibility = s.rec.visibility;
    markForLayout(s.view, root);
  }
  relayout(root);
  // A second pass settles what one view reads from another laid out after it (a scroller and its content).
  for (const s of shows) { s.view.forceLayoutTree(); markForLayout(s.view, root); }
  relayout(root);
  for (const s of shows) for (const c of s.view.children ?? []) c.sync();
  for (const s of shows) {
    s.view.lp = s.lp;
    s.view.visibility = GONE;
    markForLayout(s.view, root);
    s.view.sync();
  }
  relayout(root);
  for (const s of shows) {
    // A screen (a layout with views in it), not a single button: its layout is what costs.
    if (s.view.children?.length) keepRendered(s.view);
    decodeImages(s.view);
  }
  return true;
}

/**
 * The browser lays a built screen out once while it stays hidden, and keeps that layout while the screen is
 * gone (content-visibility: hidden instead of display: none, View.syncSelf), so showing it later does not
 * lay its whole subtree out in the transition's first frame.
 */
function keepRendered(view) {
  const st = view.el.style;
  view.keepRendered = true;
  st.visibility = 'hidden';
  st.contentVisibility = '';
  st.display = '';
  // Laid out in the next frame; from the one after, its content is skipped until it shows.
  const later = () => { if (view.visibility === GONE && view._dom.gone) st.contentVisibility = 'hidden'; };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(later));
  else later();
}

/** The art under a view, decoded ahead of its first paint. */
function decodeImages(view) {
  const seen = new Set();
  view.walk?.(v => {
    const url = v.art?.url;
    if (!url || seen.has(url) || typeof Image !== 'function') return;
    seen.add(url);
    const img = new Image();
    img.src = url;
    img.decode?.().catch(() => {});
  });
}

/**
 * Builds the likely next scenes of the top container, then the navbar's lines scene (its seekbar and
 * mini player, shown with the library, search and the equaliser), one per idle period after start,
 * never while a transition moves, and only when the page is really idle (no deadline: a build is one
 * long task on a slow phone, and the start-up's own tasks and the first tap come first).
 * ctx.prebuilt.done turns true once all are built (the browser tests wait for it).
 */
export function prebuildLikely(ctx, scenes = LIKELY_SCENES) {
  const root = ctx.topNav;
  ctx.prebuilt = {done: false};
  if (!root) { ctx.prebuilt.done = true; return; }
  const idle = globalThis.requestIdleCallback ?? (fn => setTimeout(() => fn({timeRemaining: () => 8}), 50));
  const left = scenes.map(scene => () => [root, scene]);
  // The library's start rows (list/list-widget.js prepareLibrary), once the library scene is built.
  left.push(() => { ctx.listWidget?.prepareLibrary?.(); return null; });
  // (Asked when its turn comes: the navbar's line count follows the settings then.)
  left.push(() => {
    const bar = ctx.navbar?.container?.();
    return bar ? [bar, ctx.settings.navbar_seekbar ?? true ? 'scene_navbar_3lines' : 'scene_navbar_2lines'] : null;
  });
  const next = () => {
    if (!left.length) { ctx.prebuilt.done = true; return; }
    idle(() => {
      // A transition or a pending layout first: the build measures against the settled screen.
      if (isMoving(ctx) || ctx._layoutPending || root.scenes.running || ctx.listWidget?.trans || ctx.navbar?.container?.()?.scenes.running) { next(); return; }
      const job = left.shift()();
      if (job) buildScene(...job);
      next();
    });
  };
  next();
}
