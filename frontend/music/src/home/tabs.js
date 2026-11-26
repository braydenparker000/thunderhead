// The v2 layout's two library tabs, Home and Library (install.js): each is a root of the library
// screen (list-widget.js rootSource), the other three buttons' screens are the top navigation's.
// - A tab's button: from elsewhere it shows that tab's root where it was left; on that tab, a level
//   above the root goes back to the root (its history entries dropped, as the old library button
//   did), and the root itself scrolls to its top.
// - Each root keeps where it is scrolled per chip (Home's All, Albums ...; Library's Playlists ...):
//   when the tab, the chip or a level above it changes and it shows again, it is there. A library
//   refresh keeps it too (list/relocate.js rebuilds the root in place).
// - Back from a tab's root goes to the root of the tab before it, once: one history entry stands for
//   the change of tab (pushed on the first change, replaced on the next), so the next Back leaves as
//   it always has.
import {cubicOut} from '../gesture.js';

export function installTabs(ctx) {
  const lw = ctx.listWidget;
  const kept = {home: new Map(), library: new Map()};
  let tabBack = null;
  const chipOf = (tab, root = lw.stack[0]) => (tab === 'library' ? root?.libraryChip ?? ctx.libraryChip ?? 'playlists' : root?.chip ?? ctx.homeChip ?? 'all');
  const tabOf = root => (root?.isLibraryV2 ? 'library' : root?.isHomeV2 ? 'home' : null);
  const onRoot = () => lw.mode === 'list' && lw.stack.length === 1 && lw.libList.source === lw.stack[0] && !lw.searchShown;

  const tabs = ctx.homeTabs = {
    get tab() { return lw.tab; },
    /** Where the shown root is (or the root under the shown levels was) scrolled, kept for its chip. */
    keep() {
      const root = lw.stack[0], tab = tabOf(root);
      if (!tab) return;
      const y = onRoot() ? lw.libList.scrollY : root.savedScroll;
      if (y != null) kept[tab].set(chipOf(tab, root), y);
    },
    leaveChip(tab, chip) { if (onRoot()) kept[tab].set(chip, lw.libList.scrollY); },
    chipScroll(tab, chip) { return kept[tab].get(chip) ?? 0; },
    /** A root made (rootSource): it opens where its chip was left. */
    made(src) {
      const tab = tabOf(src), y = tab ? kept[tab].get(chipOf(tab, src)) ?? 0 : 0;
      src.savedScroll = y;
      if (y) queueMicrotask(() => { if (lw.libList.source === src && lw.libList.scrollY === 0) lw.libList.scrollTo(y); });
    },
    /** A tab's button. */
    go(tab) {
      const nav = ctx.topNav?.nav;
      if (nav === 'nav_lib' && lw.mode === 'list' && !lw.searching && lw.tab === tab && tabOf(lw.stack[0]) === tab) {
        if (lw.stack.length > 1) { lw.trans?.complete(); lw.ignorePop = () => { lw.libList.setSource(lw.stack[0]); lw.stack.length = 1; lw.libList.scrollTo(lw.stack[0].savedScroll ?? 0); ctx.navMark?.(); }; history.go(-(lw.stack.length - 1)); }
        else smoothTop(ctx, lw.libList);
        return;
      }
      const from = tabOf(lw.stack[0]);
      tabs.keep();
      const switching = nav === 'nav_lib' && lw.mode === 'list' && from && from !== tab;
      lw.tab = tab;
      lw.startSource = null;
      lw.preparedLib = null;
      if (switching) {
        const show = () => { lw.stack = []; lw.openStart(); remember(from); ctx.navMark?.(); };
        if (lw.stack.length > 1) { lw.trans?.complete(); lw.ignorePop = show; history.go(-(lw.stack.length - 1)); } else show();
        return;
      }
      // From another screen: the library shows that tab's root (built when it shows).
      if (tabOf(lw.stack[0]) !== tab) lw.stack = [];
      ctx.bus.post('bus_gui', 'cmd_nav_to_lib', null);
      ctx.navMark?.();
    },
    /** Library at a chip (Home's "See all" of a kind). */
    toLibrary(chip) {
      tabs.keep();
      ctx.libraryChip = chip;
      tabs.go('library');
    },
    /** The layout changed (install.js setLayout): no change of tab to step back over; Home is the tab. */
    reset() {
      tabBack = null;
      lw.tab = 'home';
    },
  };

  // The one history entry for a change of tab: Back from the new tab's root shows the old one's.
  function remember(from) {
    if (tabBack) history.replaceState({cpTab: from}, '');
    else history.pushState({cpTab: from}, '');
    tabBack = from;
  }
  const back = lw.back.bind(lw);
  lw.back = () => {
    if (!ctx.homeV2 || lw.ignorePop || !tabBack || ctx.dialogs?.length) return back();
    if (ctx.topNav?.nav !== 'nav_lib' || lw.mode !== 'list' || lw.searching || lw.searchShown || lw.stack.length > 1) return back();
    const to = tabBack;
    tabBack = null;
    tabs.keep();
    lw.tab = to;
    lw.startSource = null;
    lw.stack = [];
    lw.openStart();
    ctx.navMark?.();
    return true;
  };
  return tabs;
}

/** The list to its top in a short glide (the app's cubic ease-out), not a jump. */
function smoothTop(ctx, list) {
  const from = list.scrollY;
  if (from <= 0) return;
  list.stopFling?.();
  const t0 = performance.now(), ms = Math.min(450, 200 + from / (8 * ctx.dpr));
  ctx.onFrame(now => {
    const t = Math.min(1, (now - t0) / ms);
    if (list.drag?.started) return false;
    list.scrollTo(Math.round(from * (1 - cubicOut(t))));
    return t < 1;
  });
}
