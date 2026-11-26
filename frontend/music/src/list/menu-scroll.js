// The item menu's entries scroll inside it when they do not all fit (the playing song's menu in
// landscape: its row of four and Download push Artist, Album, Folder and Genre past the menu's
// height). The menu keeps its capped height (list-widget.js openItemMenu); its entries (menu_items)
// are cut off at the menu's inner bottom, and a vertical drag or the wheel on them moves them, as a
// dialog's content scrolls (view/table.js ScrollingBehavior). Where everything fits (portrait)
// nothing changes.
import {GONE} from '../res/values.js';

/**
 * Lets `items` (the menu's menu_items) scroll inside `item` (the menu) while the menu is open.
 * Returns release(), which puts everything back as it was (on closing).
 */
export function scrollMenuItems(item, items) {
  if (!item || !items) return () => {};
  const ctx = item.ctx;
  let scroll = 0, drag = null;
  // The entries' full height, and the height the menu leaves them.
  const full = () => Math.max(0, ...items.children.filter(c => c.visibility !== GONE).map(c => c.lp?.fb ?? c.bottom)) + items.paddingBottom;
  const room = () => Math.max(0, item.height - item.paddingBottom - items.top);
  const max = () => Math.max(0, full() - room());
  const apply = y => {
    scroll = Math.max(0, Math.min(max(), y));
    for (const c of items.children) if (c.translationY !== -scroll) { c.translationY = -scroll; c.invalidate(); }
  };
  // After each layout of the menu (its scene lays it out every frame while it opens): what passes the
  // menu's inner bottom is cut off there, and takes no touch (input.js clipTouch).
  const own = Object.hasOwn(item, 'onLayout') ? item.onLayout : null;
  const layout = item.onLayout;
  item.onLayout = function (...args) {
    layout.apply(this, args);
    const r = room(), cut = max() > 0 ? Math.max(0, items.height - r) : 0;
    items.el.style.clipPath = cut ? `inset(0 0 ${ctx.px(cut)}px 0)` : '';
    items.clipTouch = cut ? r : null;
    apply(scroll);
  };
  items.onInterceptStart = (start, now) => {
    if (max() <= 0 || Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    drag = {last: start.rootY};
    return true;
  };
  items.onPointerMove = e => {
    if (!drag) return;
    const step = drag.last - e.rootY;
    drag.last = e.rootY;
    apply(scroll + step);
  };
  items.onPointerUp = () => { drag = null; };
  items.onPointerCancel = items.onPointerUp;
  const wheel = e => {
    if (max() <= 0) return;
    e.preventDefault();
    apply(scroll + e.deltaY * (ctx.dpr || 1));
  };
  items.el.addEventListener('wheel', wheel, {passive: false});
  return () => {
    items.el.removeEventListener('wheel', wheel);
    for (const k of ['onInterceptStart', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) delete items[k];
    if (own) item.onLayout = own;
    else delete item.onLayout;
    items.clipTouch = null;
    items.el.style.clipPath = '';
    scroll = 0;
    for (const c of items.children) { c.translationY = 0; c.invalidate(); }
  };
}
