// The v2 navbar (switch.js): Home, Search, Library, More, in the same bar with the same buttons, the
// mini player above as before. Home and Library have glyphs of their own in the bar's style (icons.js
// home, library: a house; books on a shelf), Search and More theirs. Home and Library are two roots of
// the library screen (tabs.js). A tap on More opens the menu sheet as before, which has an Equaliser
// line now; held and drawn up, More brings the Equaliser up as a sheet with the finger (eq-sheet.js).
// The dress is made once and put on or taken off in place (install.js setLayout, the classic option).
import {glyph} from './row-view.js';
import {installEqSheet} from './eq-sheet.js';
import {WORDS} from './switch.js';
import {GONE, VISIBLE} from '../res/values.js';

/**
 * The navbar's v2 dress: set(true) orders the buttons Home, Search, Library, More with their glyphs and
 * taps and shows the menu's Equaliser line; set(false) puts every button back as the classic navbar had
 * it (its order, glyph, words, hold and tap) and hides the line. The Equaliser sheet stays installed and
 * acts only while the v2 layout is on (eq-sheet.js). Null when the navbar is not the one expected.
 */
export function installNavbarV2(ctx) {
  const nb = ctx.navbar, buttons = nb?.buttons;
  if (!buttons) return null;
  const lw = ctx.listWidget;
  const home = buttons.findViewById('cmd_nav_to_lib'), eq = buttons.findViewById('cmd_nav_to_eq');
  const search = buttons.findViewById('cmd_nav_to_search'), more = buttons.findViewById('cmd_nav_more');
  if (!home || !eq || !search || !more) return null;
  // The equaliser's button becomes the library's.
  const library = eq;
  // The classic dress, to put back: the order, and each changed button's glyph, words, hold and tap.
  const order = [...buttons.children];
  const hasOwn = (b, k) => Object.prototype.hasOwnProperty.call(b, k);
  const classic = [home, library].map(b => ({b, drawable: b.drawable, words: b.contentDescription, hold: b.longClickable, ownTap: hasOwn(b, 'onClick'), tap: b.onClick}));
  // Their own glyphs (icons.js home, library) in the skin's variant of the button's own (rounded, stroked).
  const own = (d, base) => { const n = d?.name ?? ''; return glyph(d, `cp_${base}${/rounded/.test(n) ? '_rounded' : ''}${/stroke/.test(n) ? '_stroke' : ''}`); };
  const dress = {home: own(home.drawable, 'home'), library: own(library.drawable, 'library')};
  // Which button shows chosen: Home or Library on the library screen (by its root), Search on search.
  const mark = () => {
    if (!ctx.homeV2) return;
    const nav = ctx.topNav?.nav ?? nb.nav, root = lw.stack[0];
    const tab = root?.isLibraryV2 ? 'library' : 'home';
    home.setActivated(nav === 'nav_lib' && tab === 'home');
    library.setActivated(nav === 'nav_lib' && tab === 'library');
    search.setActivated(nav === 'nav_search');
  };
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_nav_changed') mark(); });
  ctx.navMark = mark;
  const line = addEqualiserLine(ctx, nb);
  ctx.eqSheet = installEqSheet(ctx, buttons, more);
  const reorder = list => {
    for (const b of list) buttons.removeView(b);
    for (const b of list) buttons.addView(b);
  };
  return {
    set(on) {
      if (on) {
        // The order: Home, Search, Library (the equaliser's place), More.
        const four = [home, search, library, more];
        reorder([...four, ...order.filter(b => !four.includes(b))]);
        library.v2Id = 'library';
        library.contentDescription = WORDS.library;
        library.setDrawable?.(dress.library);
        library.longClickable = false;
        library.onClick = () => ctx.homeTabs.go('library');
        home.contentDescription = WORDS.home;
        home.setDrawable?.(dress.home);
        home.onClick = () => ctx.homeTabs.go('home');
      } else {
        reorder(order);
        delete library.v2Id;
        for (const k of classic) {
          k.b.setDrawable?.(k.drawable);
          k.b.contentDescription = k.words;
          k.b.longClickable = k.hold;
          if (k.ownTap) k.b.onClick = k.tap;
          else delete k.b.onClick;
        }
      }
      if (line) { line.visibility = on ? VISIBLE : GONE; nb.ext?.requestLayout?.(); }
      buttons.requestLayout?.();
      if (on) mark();
      // The classic marks: the screen's own button (navbar.js onNav; the lines stay as they are).
      else nb.onNav?.(ctx.topNav?.nav ?? nb.nav);
    },
  };
}

/** The menu sheet's Equaliser line (the sheet's own line style and the equaliser's navbar icon). */
function addEqualiserLine(ctx, nb) {
  const ext = nb.ext;
  if (!ext) return null;
  const settings = ext.findViewById('navbar_ext_settings');
  const node = ['com.maxmpz.widget.base.BusActionButton', {
    'android:id': '@id/navbar_ext_eq', 'android:text': '@string/h_equ_effects', 'android:drawable': '?nav_equ',
    'w:busId': '@id/bus_gui', 'w:msgId': '@id/cmd_nav_to_eq', style: '?NavbarExtensionMenuLine',
  }];
  const at = settings ? ext.children.indexOf(settings) : -1;
  const [line] = ctx.inflater.inflateNode(node, ext, null, null) ?? [];
  if (!line) return null;
  if (line.parent === ext && at >= 0) { ext.children.splice(ext.children.indexOf(line), 1); ext.children.splice(at, 0, line); ext.el.insertBefore(line.el, settings.el); }
  line.onClick = () => { ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', line); ctx.bus.post('bus_gui', 'cmd_nav_to_eq', line); };
  return line;
}
