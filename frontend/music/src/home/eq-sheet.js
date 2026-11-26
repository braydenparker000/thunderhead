// The Equaliser as a sheet from the bottom (the v2 navbar: navbar-v2.js). Held on More and drawn up,
// it rises from behind the mini player with the finger: an opaque sheet, the Equaliser screen as it
// shows when open (over the app's own background), its top edge under the finger; the screen under it
// stays where it is, dimmed a little, and none of it shows through the sheet (it is cut at the sheet's
// edge). Let go past a third of the way, or flung up, it settles open; else it falls back. Open, Back,
// a swipe down from its top or another screen's button closes it the same way down. The Equaliser line
// of the menu sheet raises it too. No cross-fade: the scene changes at once, under the sheet, when it
// starts to move; the moves run on the list's fling curve over the top navigation's own time
// (topnav.js animTime), shorter for what is left of the way and for a flick's speed.
import {VelocityTracker, TOUCH_SLOP_DP, MAX_FLING_DP, FLING_CURVE} from '../gesture.js';
import {animTime} from '../widgets/topnav.js';
import {VISIBLE, GONE} from '../res/values.js';

const DIM = 0.3, OPEN_AT = 1 / 3, FLICK_DP = 600, SHADE_DP = 18, TOP_DP = 72;

export function installEqSheet(ctx, buttons, more) {
  const top = ctx.topNav;
  if (!top) return null;
  const go = top.go.bind(top);
  const px = ctx.px, dpr = ctx.dpr, slop = TOUCH_SLOP_DP * dpr;
  const panel = () => top.findViewById('eq_layout');
  // The screen's views under the sheet: drawn below the Equaliser (the page's order), the background apart.
  const screen = () => {
    const eq = panel(), dom = [...top.el.children], at = eq ? dom.indexOf(eq.el) : dom.length;
    return top.children.filter(c => dom.indexOf(c.el) < at && c !== eq && c.id !== 'milk' && !c.isBehavior && c.visibility === VISIBLE && c.width > 0);
  };
  // Where the sheet starts and ends: the mini player's top (it rises from behind the navbar).
  const floor = () => {
    const nb = ctx.root.findViewById('navbar_list') ?? ctx.root.findViewById('navbar_container');
    const y = nb ? nb.getLocationIn(top).y : top.height;
    return Math.max(1, Math.min(top.height, Math.round(y)));
  };
  const layer = css => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;width:100%;pointer-events:none;' + css;
    return el;
  };
  let s = null; // the sheet while it shows: {y0, y, under, dim, shade, drag?, anim?}
  let navBefore = 'nav_lib';
  // Under the sheet the library stays the library (the list widget would turn to the player's art for
  // any screen but the library's), so it is there as it was when the sheet goes down again.
  const lw = ctx.listWidget;
  if (lw) {
    const keep = mode => ctx.homeV2 && mode === 'aa' && top.nav === 'nav_eq' && lw.mode === 'list';
    const setMode = lw.setMode.bind(lw), animate = lw.animateModeChange.bind(lw);
    lw.setMode = (mode, ...rest) => (keep(mode) ? undefined : setMode(mode, ...rest));
    lw.animateModeChange = (mode, ...rest) => (keep(mode) ? true : animate(mode, ...rest));
  }

  /** The sheet at y (0 open, y0 down); the screen under it cut at y and dimmed by how far up it is. */
  const place = y => {
    const p = 1 - y / s.y0, eq = panel();
    s.y = y;
    // (Moved down, it shows nothing past where it ends when open: none of it under the navbar's edge.)
    if (eq) { eq.translationY = Math.round(y); eq.visibility = VISIBLE; eq.el.style.clipPath = y > 0 ? `inset(0 0 ${px(Math.round(y))}px 0)` : ''; eq.invalidate(); }
    // Each view cut at the sheet's edge in its own box (where it is in the top navigation, kept from the start).
    for (const v of s.under) v.el.style.clipPath = `inset(0 0 ${px(Math.max(0, (v._sheetY ?? 0) + v.height - y))}px 0)`;
    s.dim.style.opacity = String(DIM * p);
    s.dim.style.height = px(Math.max(0, y)) + 'px';
    s.shade.style.transform = `translateY(${px(y - SHADE_DP * dpr)}px)`;
    s.shade.style.opacity = y > 0 ? String(Math.min(1, p * 4)) : '0';
  };

  /**
   * The sheet shown at its start: opening, the Equaliser's scene set at once and the screen it leaves
   * kept showing under it; closing, the scene it goes to set at once under the Equaliser kept up.
   */
  const begin = (opening, scene) => {
    if (opening) top.loadBehaviorsFor?.('scene_eq');
    const before = opening ? screen() : null;
    top.scenes.go(opening ? 'scene_eq' : scene, {duration: 0});
    const under = opening ? before : screen();
    for (const v of under) {
      v._sheetVis = v.visibility;
      v._sheetY = v.getLocationIn(top).y;
      if (v.visibility !== VISIBLE) { v.visibility = VISIBLE; v.invalidate(); }
    }
    const dim = layer('height:0;background:#000;opacity:0');
    const shade = layer(`height:${px(SHADE_DP * dpr)}px;background:linear-gradient(to bottom,transparent,rgba(0,0,0,.28));opacity:0`);
    const eq = panel();
    if (eq?.el?.parentNode) { eq.el.parentNode.insertBefore(dim, eq.el); eq.el.parentNode.insertBefore(shade, eq.el); }
    s = {y0: floor(), y: 0, under, dim, shade, opening};
    place(opening ? s.y0 : 0);
  };
  /** The sheet gone: open (the Equaliser's scene as it is), or down (the scene under it as it is). */
  const finish = open => {
    const done = s;
    s = null;
    if (!done) return;
    done.anim?.();
    done.dim.remove();
    done.shade.remove();
    for (const v of done.under) {
      v.el.style.clipPath = '';
      if (open && done.opening) { v.visibility = v._sheetVis ?? GONE; v.invalidate(); }
    }
    const eq = panel();
    if (eq) { eq.translationY = 0; eq.el.style.clipPath = ''; if (!open) eq.visibility = GONE; eq.invalidate(); }
  };
  /** Moves the sheet open (y 0) or down (y0) on the fling curve, then `then`. */
  const settle = (open, v, then) => {
    const from = s.y, to = open ? 0 : s.y0, dist = Math.abs(to - from);
    const base = animTime(ctx, top.times.anim) * 1.4 * Math.max(0.35, dist / s.y0);
    const flick = Math.abs(v) > FLICK_DP * dpr && Math.sign(v) === Math.sign(to - from);
    const seconds = flick ? Math.min(base, Math.max(0.12, (dist / Math.abs(v)) * 2.2)) : base;
    const t0 = performance.now();
    s.anim?.();
    s.anim = ctx.onFrame(now => {
      if (!s) return false;
      const k = Math.min(1, (now - t0) / 1000 / Math.max(0.001, seconds));
      place(from + (to - from) * FLING_CURVE(k));
      if (k < 1) return true;
      s.anim = null;
      then();
      return false;
    });
  };
  const opened = () => { finish(true); top.adoptNav('nav_eq'); };
  const fellBack = () => { top.scenes.go(top.sceneFor(top.nav), {duration: 0}); finish(false); };
  const closeTo = (scene, nav, v = 0) => {
    if (!s) begin(false, scene);
    settle(false, s.flingV ?? v, () => { finish(false); top.adoptNav(nav); });
  };

  // Every way to the Equaliser and from it goes as the sheet (the menu's line, Back, another button).
  // (Only while the v2 layout is on: the classic one keeps the Equaliser a screen of its own.)
  top.go = (scene, nav, animate = true) => {
    if (!ctx.homeV2 && !s) return go(scene, nav, animate);
    if (s?.drag) return;
    if (animate && nav === 'nav_eq' && top.nav !== 'nav_eq' && !s && !top.scenes.running) {
      ctx.navbar?.sheet && ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', null);
      begin(true);
      settle(true, 0, opened);
      return;
    }
    if (animate && top.nav === 'nav_eq' && nav !== 'nav_eq' && top.scenes.scene === 'scene_eq' && !top.scenes.running && (!s || !s.opening)) {
      if (nav === 'nav_search') ctx.leaveField?.();
      closeTo(scene, nav);
      return;
    }
    go(scene, nav, animate);
  };
  // Back from the Equaliser: down to the screen it rose over (before the library takes Back for its levels).
  window.addEventListener('popstate', e => {
    if (!ctx.homeV2 || top.nav !== 'nav_eq' || ctx.dialogs?.length || ctx.settingsUi?.isOpen || ctx.subAAEditor?.editing) return;
    e.stopImmediatePropagation();
    top.navigate(navBefore);
  }, true);
  ctx.bus.subscribe('bus_gui', (msg, src, d) => {
    if (msg !== 'msg_nav_changed') return;
    if (d?.nav && d.nav !== 'nav_eq') navBefore = d.nav;
    else watchPanel();
  });

  // Up from More (held or not): the sheet follows the finger.
  buttons.onInterceptStart = (start, now) => {
    if (!ctx.homeV2 || start.target !== more || s || ctx.navbar?.sheet || top.nav === 'nav_eq' || top.scenes.running) return false;
    const dy = now.rootY - start.rootY, dx = now.rootX - start.rootX;
    if (dy > -slop || Math.abs(dx) > Math.abs(dy)) return false;
    more.setPressed(false);
    begin(true);
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    s.drag = {y: start.rootY - slop, vt};
    return true;
  };
  buttons.onPointerMove = e => {
    const d = s?.drag;
    if (!d) return;
    d.vt.add(e.time, e.rootX, e.rootY);
    place(Math.max(0, Math.min(s.y0, s.y0 - (d.y - e.rootY))));
  };
  buttons.onPointerUp = e => {
    const d = s?.drag;
    if (!d) return;
    s.drag = null;
    let v = 0;
    if (!e.cancelled) { d.vt.up(e.time); v = d.vt.compute(MAX_FLING_DP * dpr).vy; }
    const flick = FLICK_DP * dpr, p = 1 - s.y / s.y0;
    if (v < -flick || (v <= flick && p > OPEN_AT)) settle(true, v, opened);
    else settle(false, v, fellBack);
  };
  buttons.onPointerCancel = () => buttons.onPointerUp({cancelled: true});

  // Down from the open sheet's top: it follows the finger and closes as Back does.
  function watchPanel() {
    const eq = panel();
    if (!eq || eq._sheetDown) return;
    eq._sheetDown = true;
    eq.onInterceptStart = (start, now) => {
      if (!ctx.homeV2 || top.nav !== 'nav_eq' || s || top.scenes.running) return false;
      const y = start.rootY - eq.getLocationIn(null).y, dy = now.rootY - start.rootY;
      if (y > TOP_DP * dpr || dy < slop || Math.abs(now.rootX - start.rootX) > dy) return false;
      begin(false, top.sceneFor(navBefore));
      const vt = new VelocityTracker();
      vt.add(start.time, start.rootX, start.rootY);
      s.drag = {y: start.rootY + slop, vt};
      return true;
    };
    eq.onPointerMove = e => {
      const d = s?.drag;
      if (!d) return;
      d.vt.add(e.time, e.rootX, e.rootY);
      place(Math.max(0, Math.min(s.y0, e.rootY - d.y)));
    };
    eq.onPointerUp = e => {
      const d = s?.drag;
      if (!d) return;
      s.drag = null;
      let v = 0;
      if (!e.cancelled) { d.vt.up(e.time); v = d.vt.compute(MAX_FLING_DP * dpr).vy; }
      const flick = FLICK_DP * dpr, p = 1 - s.y / s.y0;
      if (v < -flick || (v <= flick && p > 1 - OPEN_AT)) { settle(true, v, () => { top.scenes.go('scene_eq', {duration: 0}); finish(true); }); return; }
      // Closed as Back closes it: its history entry goes (the popstate above takes it down from here).
      s.flingV = v;
      if (history.state?.cpNav === 'nav_eq') history.back();
      else closeTo(top.sceneFor(navBefore), navBefore, v);
    };
    eq.onPointerCancel = () => eq.onPointerUp({cancelled: true});
  }
  watchPanel();
  return {get shown() { return !!s; }};
}
