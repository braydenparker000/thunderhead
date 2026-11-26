// The v2 layout put on or taken off (switch.js; app.js loads this when the layout is v2 at start or the
// classic option changes): the library's roots become the v2 Home and Library (list-widget.js
// rootSource) as two tabs (tabs.js), the navbar takes its four buttons (navbar-v2.js), Home's data is
// built in idle time and kept until the library, a playlist, a rating or the play history changes, and
// the "tonight" mix becomes a card of Home. Its pieces are made once (installHomeV2) and act only while
// ctx.homeV2 is on; setLayout changes it in place: the navbar redressed, the library's first screen
// made again where it is (the levels above it, the player and what plays stay as they are).
import './rows.js';
import {HomeV2Source} from './home-source.js';
import {librarySource} from './library-source.js';
import {installNavbarV2} from './navbar-v2.js';
import {installTabs} from './tabs.js';
import {installBottomRoom} from './bottom-room.js';
import {homeStale, warmHome} from './data.js';

/** The v2 layout on (true) or off, at start (`initial`: nothing shown to make again) or live. */
export function setLayout(ctx, on, {initial = false} = {}) {
  const lw = ctx.listWidget;
  if (!lw) return;
  ctx.homeV2 = on;
  if (on) installHomeV2(ctx);
  const parts = ctx.homeV2Parts;
  if (!parts) return;
  lw.rootSource = on ? parts.rootSource : null;
  parts.tabs.reset();
  parts.navbar?.set(on);
  document.documentElement.toggleAttribute('data-cp-home-v2', on);
  if (!initial) remakeRoot(ctx);
  if (on) warmHome(ctx);
}

/**
 * The library's first screen made again for the layout now on, where it is: shown, it changes in place
 * at the top; under levels, they stay and Back comes down to the new one; a start built ahead and not
 * shown is dropped (the next showing builds the new one).
 */
function remakeRoot(ctx) {
  const lw = ctx.listWidget;
  lw.trans?.complete?.();
  const prepared = lw.preparedLib;
  lw.preparedLib = null;
  lw.startSource = null;
  if (!lw.stack.length) return;
  const old = lw.stack[0];
  if (old === prepared && lw.stack.length === 1 && lw.mode !== 'list') { lw.stack = []; return; }
  const fresh = lw.homeSource();
  if (old.openedFrom !== undefined) fresh.openedFrom = old.openedFrom;
  lw.stack[0] = fresh;
  const list = lw.libList;
  if (list.source === old) { list.setSource(fresh); list.scrollTo(0); }
  ctx.navMark?.();
}

/** The layout's pieces, made once: each acts only while ctx.homeV2 is on. */
export function installHomeV2(ctx) {
  const lw = ctx.listWidget;
  if (!lw || ctx.homeV2Parts) return;
  lw.tab = 'home';
  const tabs = installTabs(ctx);
  const rootSource = () => {
    // The navbar marks the tab whose root this is, once it is on the stack.
    queueMicrotask(() => ctx.navMark?.());
    const src = lw.tab === 'library' ? librarySource(ctx, lw.libList, lw.nav) : new HomeV2Source(ctx, lw.libList, lw.nav, ctx.homeChip ?? 'all');
    tabs.made(src);
    return src;
  };
  lw.rootSource = rootSource;
  const navbar = installNavbarV2(ctx);
  ctx.homeV2Parts = {rootSource, tabs, navbar};
  installBottomRoom(ctx);
  // Home made again from the newest data, where it is (no new level): shown, in place; under levels, for Back.
  // (The list keeps showing it when hidden too: the art's page, a level built ahead. Not in a transition.)
  let later = 0;
  const refresh = () => {
    const at = lw.stack.findIndex(s => s.isHomeV2);
    if (at < 0) return;
    if (lw.trans || lw.pinch) { clearTimeout(later); later = setTimeout(refresh, 250); return; }
    const old = lw.stack[at], fresh = old.rebuild();
    for (const k of ['savedScroll', 'openedFrom']) if (old[k] !== undefined) fresh[k] = old[k];
    lw.stack[at] = fresh;
    if (lw.startSource === old) lw.startSource = fresh;
    if (lw.preparedLib === old) lw.preparedLib = fresh;
    const list = lw.libList;
    if (list.source === old) { const y = list.scrollY; list.setSource(fresh); list.scrollTo(y); }
  };
  ctx.homeRefresh = refresh;
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_home_data_ready') refresh(); });
  // A change marks the data stale; it is built again in idle time while Home is the shown root.
  const stale = () => { homeStale(ctx); if (ctx.homeV2 && lw.mode === 'list' && lw.stack[0]?.isHomeV2) warmHome(ctx); };
  ctx.bus.subscribe('bus_library', stale);
  ctx.bus.subscribe('bus_data', msg => { if (msg === 'msg_playlists_changed' || msg === 'msg_data_track_rating_changed') stale(); });
  ctx.bus.subscribe('bus_player', msg => { if (msg === 'msg_player_track_changed') homeStale(ctx); });
  ctx.player?.history?.onChange?.(() => homeStale(ctx));
  // Going to the library: a stale Home is built again in idle time, shown meanwhile as it was.
  ctx.bus.subscribe('bus_gui', (msg, src, d) => { if (ctx.homeV2 && msg === 'msg_nav_changed' && d?.nav === 'nav_lib' && ctx.homeDataKept?.stale) warmHome(ctx); });
  ctx.library?.r2Ready?.then?.(() => ctx.homeV2 && warmHome(ctx), () => ctx.homeV2 && warmHome(ctx));
  // The tonight mix (th/music/tonight.js): a card of Home while it is there (tonight-row.js).
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_tonight_card') refresh(); });
}
