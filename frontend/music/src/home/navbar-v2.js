// The v2 navbar (switch.js): Home, Search, Library, More, in the same bar with the same buttons and
// icons (the app's own glyphs: the grid for Home, the search glass, the playlist lines for Library, the
// menu lines for More), the mini player above as before. Home and Library are two roots of the library
// screen: a tap opens that root at its start (as the library button did), never a second copy on Back.
// A tap on More opens the menu sheet as before; a swipe up from More (a hold first or not) brings the
// Equaliser up with the finger, the top navigation's own scene change scrubbed by it (scenes.drag),
// settling open past half way or on an upward flick and springing back otherwise; the equaliser's
// panel rises with it from a little below (its scene change only fades). The Equaliser is also a line
// of the menu sheet now.
import {VelocityTracker, TOUCH_SLOP_DP, MAX_FLING_DP, cubicOut} from '../gesture.js';
import {animTime} from '../widgets/topnav.js';
import {glyph} from './rows.js';
import {WORDS} from './switch.js';

export function installNavbarV2(ctx) {
  const nb = ctx.navbar, buttons = nb?.buttons;
  if (!buttons) return;
  const lw = ctx.listWidget;
  const home = buttons.findViewById('cmd_nav_to_lib'), eq = buttons.findViewById('cmd_nav_to_eq');
  const search = buttons.findViewById('cmd_nav_to_search'), more = buttons.findViewById('cmd_nav_more');
  if (!home || !eq || !search || !more) return;
  // The order: Home, Search, Library (the equaliser's place, its button now the library's), More.
  for (const b of [search, eq, more]) buttons.removeView(b);
  for (const b of [search, eq, more]) buttons.addView(b);
  const library = eq;
  library.v2Id = 'library';
  library.contentDescription = WORDS.library;
  library.setDrawable?.(glyph(library.drawable, 'playlist_24dp'));
  home.contentDescription = WORDS.home;
  library.longClickable = false;
  const toTab = tab => {
    if (lw.tab !== tab) { lw.tab = tab; lw.startSource = null; lw.preparedLib = null; }
    ctx.bus.post('bus_gui', 'cmd_list_to_start', home);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib', home);
    mark();
  };
  home.onClick = () => toTab('home');
  library.onClick = () => toTab('library');
  // Which button shows chosen: Home or Library on the library screen (by its root), Search on search.
  const mark = () => {
    const nav = nb.nav, root = lw.stack[0];
    const tab = root?.isLibraryV2 ? 'library' : 'home';
    home.setActivated(nav === 'nav_lib' && tab === 'home');
    library.setActivated(nav === 'nav_lib' && tab === 'library');
    search.setActivated(nav === 'nav_search');
  };
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_nav_changed') mark(); });
  mark();
  ctx.navMark = mark;
  addEqualiserLine(ctx, nb);
  installEqSwipe(ctx, nb, buttons, more);
}

/** The menu sheet's Equaliser line (the sheet's own line style and the equaliser's navbar icon). */
function addEqualiserLine(ctx, nb) {
  const ext = nb.ext;
  if (!ext) return;
  const settings = ext.findViewById('navbar_ext_settings');
  const node = ['com.maxmpz.widget.base.BusActionButton', {
    'android:id': '@id/navbar_ext_eq', 'android:text': '@string/h_equ_effects', 'android:drawable': '?nav_equ',
    'w:busId': '@id/bus_gui', 'w:msgId': '@id/cmd_nav_to_eq', style: '?NavbarExtensionMenuLine',
  }];
  const at = settings ? ext.children.indexOf(settings) : -1;
  const [line] = ctx.inflater.inflateNode(node, ext, null, null) ?? [];
  if (!line) return;
  if (line.parent === ext && at >= 0) { ext.children.splice(ext.children.indexOf(line), 1); ext.children.splice(at, 0, line); ext.el.insertBefore(line.el, settings.el); }
  line.onClick = () => { ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', line); ctx.bus.post('bus_gui', 'cmd_nav_to_eq', line); };
}

/**
 * Up from More: the top navigation's change to the equaliser's scene follows the finger over a third
 * of the screen's height; a release past half way or an upward flick settles it open (adopting the
 * navigation), else it springs back. Only from a screen other than the equaliser, with the sheet closed.
 */
function installEqSwipe(ctx, nb, buttons, more) {
  const top = ctx.topNav;
  if (!top) return;
  const slop = TOUCH_SLOP_DP * ctx.dpr;
  let g = null;
  buttons.onInterceptStart = (start, now) => {
    if (start.target !== more || nb.sheet || top.nav === 'nav_eq' || top.scenes.running) return false;
    const dy = now.rootY - start.rootY, dx = now.rootX - start.rootX;
    if (dy > -slop || Math.abs(dx) > Math.abs(dy)) return false;
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    g = {y0: start.rootY - slop, span: Math.max(1, ctx.root.height / 3), vt, from: top.nav};
    more.setPressed(false);
    return true;
  };
  const rise = () => Math.round(96 * ctx.dpr);
  const panel = () => ctx.root.findViewById('eq_layout');
  buttons.onPointerMove = e => {
    if (!g) return;
    g.vt.add(e.time, e.rootX, e.rootY);
    const f = (g.y0 - e.rootY) / g.span;
    top.scenes.drag('scene_eq', f, {min: 0, max: 1});
    ctx.eqRise = top.scenes.ratio;
    const p = panel();
    if (p) { p.translationY = Math.round((1 - ctx.eqRise) * rise()); p.invalidate(); }
  };
  buttons.onPointerUp = e => {
    const had = g;
    g = null;
    if (!had || !top.scenes.running?.manual) return;
    let v = 0;
    if (!e.cancelled) { had.vt.up(e.time); v = had.vt.compute(MAX_FLING_DP * ctx.dpr).vy; }
    const p = top.scenes.ratio, fast = 1000 * ctx.dpr;
    const commit = v < -fast ? true : v > fast ? false : p > 0.5;
    const rest = Math.max(0.25, commit ? 1 - p : p);
    const seconds = animTime(ctx, top.times.anim) * rest;
    const pn = panel();
    if (pn) ctx.tween(pn, {translationY: commit ? 0 : rise()}, seconds, cubicOut);
    top.scenes.settleTo(commit, seconds, () => {
      ctx.eqRise = null;
      if (pn) { ctx.tweens?.delete(pn); pn.translationY = 0; pn.invalidate(); }
      if (commit) top.adoptNav('nav_eq');
    });
  };
}
