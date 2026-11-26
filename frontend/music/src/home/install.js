// Turns the v2 layout on (switch.js; app.js loads this only then): the library's roots become the
// v2 Home and Library (list-widget.js rootSource), the navbar takes its four buttons (navbar-v2.js),
// Home's data is built in idle time and kept fresh, and the "tonight" card moves into Home.
import './rows.js';
import {HomeV2Source} from './home-source.js';
import {librarySource} from './library-source.js';
import {installNavbarV2} from './navbar-v2.js';
import {homeStale, warmHome} from './data.js';

export function installHomeV2(ctx) {
  const lw = ctx.listWidget;
  if (!lw || lw.rootSource) return;
  lw.tab = 'home';
  lw.rootSource = () => {
    // The navbar marks the tab whose root this is, once it is on the stack.
    queueMicrotask(() => ctx.navMark?.());
    return lw.tab === 'library' ? librarySource(ctx, lw.libList, lw.nav) : new HomeV2Source(ctx, lw.libList, lw.nav, ctx.homeChip ?? 'all');
  };
  installNavbarV2(ctx);
  // Home shown: its rows made again from the newest data, where it is (no new level).
  const refresh = () => {
    const top = lw.stack[lw.stack.length - 1];
    if (lw.stack.length === 1 && top?.isHomeV2) lw.replaceTop(top.rebuild());
    else if (lw.stack[0]?.isHomeV2) lw.stack[0] = lw.stack[0].rebuild();
  };
  ctx.homeRefresh = refresh;
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_home_data_ready') refresh(); });
  const stale = () => { homeStale(ctx); if (lw.mode !== 'list' || !lw.stack[0]?.isHomeV2) return; warmHome(ctx); };
  ctx.bus.subscribe('bus_library', stale);
  ctx.bus.subscribe('bus_data', msg => { if (msg === 'msg_playlists_changed' || msg === 'msg_data_track_rating_changed') stale(); });
  ctx.bus.subscribe('bus_player', msg => { if (msg === 'msg_player_track_changed') homeStale(ctx); });
  // Going to the library: a stale Home is built again in idle time, shown meanwhile as it was.
  ctx.bus.subscribe('bus_gui', (msg, src, d) => { if (msg === 'msg_nav_changed' && d?.nav === 'nav_lib' && ctx.homeDataKept?.stale) warmHome(ctx); });
  ctx.library?.r2Ready?.then?.(() => warmHome(ctx), () => warmHome(ctx));
  warmHome(ctx);
  // The tonight card (th/music/tonight.js): measured once at the list's width, then a Home row.
  const tonight = card => {
    if (!card) return;
    const box = document.createElement('div');
    box.className = 'cp-home-card cp-home-measure';
    box.style.width = `${Math.round((lw.width || ctx.viewportWidth * ctx.dpr) / ctx.dpr)}px`;
    document.body.append(box);
    box.append(card);
    card.style.width = `${Math.round((lw.width || ctx.viewportWidth * ctx.dpr) / ctx.dpr) - 24}px`;
    ctx.tonightHeight = Math.round((card.offsetHeight + 12) * ctx.dpr);
    ctx.tonightCard = card;
    // (Hidden in the page until Home's row takes it: the card shows only inside .cp-home-card.)
    document.body.append(card);
    box.remove();
    refresh();
  };
  ctx.bus.subscribe('bus_gui', (msg, src, d) => { if (msg === 'msg_tonight_card') tonight(d?.card); });
  if (ctx.tonightCard) tonight(ctx.tonightCard);
}
