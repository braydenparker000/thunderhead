// A sideways scroll for a row of Home (the chips, a shelf), with the library list's own physics
// (power-list.js): the drag starts one touch slop along the movement and follows the finger; a
// release faster than the minimum fling velocity flings with the list's decay (gesture.js Fling); a
// fling that reaches an end stops there. A touch on a moving row stops it. The row takes a drag only
// when it is more sideways than up or down (the list takes those) and only where it can still move
// that way: at its start a drag to the right, at its end one to the left, is left to the list's page
// swipe (Back, list-widget.js beginSideBack), so neither fights the other.
import {VelocityTracker, Fling, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';

/**
 * Adds the gesture to a view with `scrollX`, `maxScrollX` and `setScrollX(x)` (returns whether it moved).
 * The view's onPointerDown is not used: its items keep their taps.
 */
export function sideScroll(v) {
  v.stopSide = () => { v._fling?.(); v._fling = null; };
  v.onInterceptStart = (start, now) => {
    const dx = now.rootX - start.rootX, dy = now.rootY - start.rootY;
    if (!v.maxScrollX || Math.abs(dx) <= Math.abs(dy)) return false;
    const x = v.scrollX ?? 0;
    if ((dx > 0 && x <= 0) || (dx < 0 && x >= v.maxScrollX)) return false;
    v.stopSide();
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    v.hScroll = {x: start.rootX + Math.sign(dx) * TOUCH_SLOP_DP * v.ctx.dpr, scroll: x, vt};
    v.ctx.scrollLog?.begin(v);
    v.ctx.scrolling?.add(v);
    return true;
  };
  v.onPointerMove = e => {
    const h = v.hScroll;
    if (!h) return;
    h.vt.add(e.time, e.rootX, e.rootY);
    v.setScrollX(h.scroll - (e.rootX - h.x));
  };
  v.onPointerUp = e => {
    const h = v.hScroll;
    v.hScroll = null;
    if (!h || e?.cancelled) return;
    h.vt.up(e.time);
    const vx = -h.vt.compute(MAX_FLING_DP * v.ctx.dpr).vx;
    if (Math.abs(vx) < MIN_FLING_DP * v.ctx.dpr) return;
    const f = new Fling(vx);
    let last = null;
    v._fling = v.ctx.onFrame(now => {
      const dt = last === null ? 1 / 60 : Math.min(0.048, (now - last) / 1000);
      last = now;
      const moved = v.setScrollX((v.scrollX ?? 0) + f.step(dt));
      if (moved && !f.done) return true;
      v._fling = null;
      return false;
    });
  };
  v.onPointerCancel = () => v.onPointerUp({cancelled: true});
  // The scroll recorder (ui/scroll-log.js): a sideways row of Home.
  v.scrollMoving = () => !!(v.hScroll || v._fling);
  v.scrollInfo = () => ({screen: 'shelf', layout: 'list', zoom: 0});
  return v;
}
