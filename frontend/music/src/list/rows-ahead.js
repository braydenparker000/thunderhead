// Rows bound ahead of a scroll (MUSIC.md §5.11 "Scrolling"): once the library's list has come to rest after a
// finger or a fling moved it, rows beyond the screen are bound and laid out in idle time, a row's height a step
// (view/idle-work.js), up to a screen (at most MAX_AHEAD items) in the way it last moved and a third of that the
// other way. They lie in the
// list's content layer off screen (power-list.js), so the compositor has them drawn before they come into view,
// and the next scroll shows them without binding, measuring or painting them in its frames. While it scrolls,
// rows newly ahead are bound only while the frame has had less than BUDGET_MS of binding and a pooled view is
// there to take; the rest wait for the next frame, or for idle time. Rows on screen are always bound in their frame. A new source starts with none ahead.
import {idleWork} from '../view/idle-work.js';

export const BUDGET_MS = 6;

/**
 * The rows ahead to keep bound (the list's `ahead` margins, px above and below the screen), or null; it also
 * notes which way the list last moved. The range object is the list's own, reused (no allocation a frame).
 */
export function rowsAhead(list, g, sy, first, last) {
  if (list._lastSy !== undefined && sy !== list._lastSy) list.lastDir = sy > list._lastSy ? 1 : -1;
  list._lastSy = sy;
  const a = list.ahead, s = list.source;
  if (!a || (!a.up && !a.down) || !s?.count) return null;
  const base = g.top + g.headerH;
  const f = list.indexAtY(g, Math.max(0, sy - base - a.up));
  const l = Math.min(s.count - 1, list.indexAtY(g, Math.max(0, sy + list.height - base + a.down)) + g.cols - 1);
  if (f >= first && l <= last) return null;
  const r = list._aheadRange ??= {first: 0, last: 0};
  r.first = f;
  r.last = l;
  return r;
}

/**
 * Binds the rows ahead not bound yet, nearest first in the way the list moves, while the frame's time lasts and
 * a pooled view of the row's type is there (a frame never inflates a row off screen: idle time does).
 */
export function bindAhead(list, r, first, last, t0, place) {
  const down = (list.lastDir ?? 1) > 0, s = list.source;
  const runs = down ? [[last + 1, r.last, 1], [first - 1, r.first, -1]] : [[first - 1, r.first, -1], [last + 1, r.last, 1]];
  for (const [from, to, step] of runs) {
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      if (list.active.has(i)) continue;
      if (performance.now() - t0 > BUDGET_MS) { later(list); return; }
      if (!list.idleAhead && !list.pool.get(s.typeAt?.(i) ?? s.itemType)?.length) return;
      place(i);
    }
  }
}

/** Rows ahead left for later: the next frame places the list again (a scroll's own next frame does anyway). */
function later(list) {
  if (list._aheadLater) return;
  list._aheadLater = list.ctx.onFrame(() => {
    list._aheadLater = null;
    list.placeItems();
    return false;
  });
}

/** The rows ahead in the way it moved: a screen, or MAX_AHEAD items when fewer (small grid tiles: each one more
 * view to keep and to lay out in every frame that changes the page). */
export const MAX_AHEAD = 16;

/** The list is at rest after a scroll: its margins grow in idle time, a row's height a step, to their target. */
export function aheadAtRest(list) {
  if (!list.bindAhead || !list.source || !list.height) return;
  const g = list.geometry(), H = Math.min(list.height, Math.ceil(MAX_AHEAD / g.cols) * Math.max(1, g.itemH)), down = (list.lastDir ?? 1) > 0;
  list.aheadTarget = {up: down ? Math.round(H / 3) : H, down: down ? H : Math.round(H / 3), source: list.source};
  if (list._aheadJob) return;
  list._aheadJob = true;
  idleWork(list.ctx, 'rows-ahead', [function* grow() {
    for (;;) {
      const t = list.aheadTarget, s = list.source;
      // A new list, or a scroll under way (it places its rows itself), ends it.
      if (!t || t.source !== s || !s || list._fling || list.drag?.started || list.reorder) return;
      const a = list.ahead ??= {up: 0, down: 0};
      if (a.up >= t.up && a.down >= t.down) return;
      const step = Math.max(1, list.geometry().itemH || Math.round(56 * list.ctx.dpr));
      a.up = Math.min(t.up, a.up + step);
      a.down = Math.min(t.down, a.down + step);
      // (Idle time may make the views it needs.)
      list.idleAhead = true;
      try { list.placeItems(); } finally { list.idleAhead = false; }
      yield;
    }
  }]).finally(() => { list._aheadJob = false; });
}
