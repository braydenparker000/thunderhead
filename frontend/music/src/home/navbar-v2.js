// The v2 navbar (switch.js): Home, Search, Library, More, in the same bar with the same buttons, the
// mini player above as before. Home and Library have glyphs of their own in the bar's style (icons.js
// home, library: a house; books on a shelf), Search and More theirs. Home and Library are two roots of
// the library screen (tabs.js). A tap on More opens the menu sheet as before, which has an Equaliser
// line now; held and drawn up, More brings the Equaliser up as a sheet with the finger (eq-sheet.js).
import {glyph} from './row-view.js';
import {installEqSheet} from './eq-sheet.js';
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
  // Their own glyphs (icons.js home, library) in the skin's variant of the button's own (rounded, stroked).
  const own = (b, base) => { const n = b.drawable?.name ?? ''; b.setDrawable?.(glyph(b.drawable, `cp_${base}${/rounded/.test(n) ? '_rounded' : ''}${/stroke/.test(n) ? '_stroke' : ''}`)); };
  own(library, 'library');
  own(home, 'home');
  home.contentDescription = WORDS.home;
  library.longClickable = false;
  home.onClick = () => ctx.homeTabs.go('home');
  library.onClick = () => ctx.homeTabs.go('library');
  // Which button shows chosen: Home or Library on the library screen (by its root), Search on search.
  const mark = () => {
    const nav = ctx.topNav?.nav ?? nb.nav, root = lw.stack[0];
    const tab = root?.isLibraryV2 ? 'library' : 'home';
    home.setActivated(nav === 'nav_lib' && tab === 'home');
    library.setActivated(nav === 'nav_lib' && tab === 'library');
    search.setActivated(nav === 'nav_search');
  };
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_nav_changed') mark(); });
  mark();
  ctx.navMark = mark;
  addEqualiserLine(ctx, nb);
  ctx.eqSheet = installEqSheet(ctx, buttons, more);
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
