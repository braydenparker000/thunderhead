// Transitions in motion (MUSIC.md §5.11 "Transitions at the screen's rate"). While a scene transition of the
// player's screens or a page transition of the list widget moves:
// - a frame writes only the views that changed since the last one (Context.dirty: invalidate and visibility),
//   not the whole tree; a view marked stays marked until a write reaches it (one under a gone view, or out
//   of the tree for a moment, is written once it is reached again); a view that shows again after
//   display:none writes its subtree, as the whole-tree write would; the frame after the last transition
//   ends writes the whole tree again;
// - work that is not the transition (whenStill) waits until no transition moves, then runs in a task after
//   the next frame, so neither the transition's frames nor its last one carry it.
import {GONE} from '../res/values.js';

/** A transition starts moving (a scene controller or a page transition). */
export function beginMove(ctx, source) {
  ctx.moving?.add(source);
}

/** A transition has ended; the last one to end lets the waiting work run. */
export function endMove(ctx, source) {
  if (!ctx.moving?.delete(source) || ctx.moving.size) return;
  const waiting = ctx.stillWork;
  if (!waiting?.size) return;
  ctx.stillWork = null;
  const run = () => {
    // Another transition began meanwhile: the work waits for that one. What was asked again meanwhile
    // (the same key) is the newer request and stays.
    if (ctx.moving.size) { for (const [k, fn] of waiting) if (!ctx.stillWork?.has(k)) whenStill(ctx, fn, k); return; }
    for (const fn of waiting.values()) fn();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
  else setTimeout(run, 0);
}

/** True while a transition moves. */
export const isMoving = ctx => !!ctx?.moving?.size;

/**
 * Runs fn now, or once no transition moves. A key (default fn itself) keeps one run per kind of work:
 * a later call with the same key replaces the waiting one.
 */
export function whenStill(ctx, fn, key = fn) {
  if (!isMoving(ctx)) { fn(); return; }
  (ctx.stillWork ??= new Map()).set(key, fn);
}

/** Inside the root and with no gone view above it (what a whole-tree write reaches). */
function reached(ctx, v) {
  for (let p = v.parent; p; p = p.parent) {
    if (p.visibility === GONE) return false;
    if (p === ctx.root) return true;
  }
  return v === ctx.root;
}

/** The frame's write while a transition moves: the changed views only. */
export function syncMoving(ctx) {
  const list = [...ctx.dirty];
  ctx.dirty.clear();
  for (const v of list) {
    // Not reached now (under a gone view, or out of the tree for a moment): it stays marked until a write
    // reaches it, so a change made meanwhile is never lost.
    if (!reached(ctx, v)) { ctx.dirty.add(v); continue; }
    // Shown again after display:none: its subtree takes the writes it missed while hidden.
    if (v.syncSelf() && v.children) for (const c of v.children) c.sync();
  }
}
