// The library layout (owner, 2026-11-26): the v2 layout is the default — Home, Search, Library and More
// in the navbar, a Home of shelves and a one-screen Library with chips. Settings › Lists › Look and feel ›
// "Classic library layout" (cp_classic_library) brings back the classic one: Library, Equaliser, Search,
// More and the category home. The page can force either: ?home2 the v2 layout, ?home1 the classic one
// (the demo page and the tests). The option applies at once, without a reload (install.js setLayout).

/** The option's key (settings.js withClassicSwitch). */
export const CLASSIC_KEY = 'cp_classic_library';

/** The layout the page asks for: true (?home2), false (?home1), or null (none). */
export function forcedLayout() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    if (q.has('home2')) return true;
    if (q.has('home1')) return false;
  } catch { /* no location */ }
  return null;
}

/** Whether the v2 layout is on for this page. */
export function homeV2(ctx) {
  if (ctx?.homeV2 !== undefined) return ctx.homeV2;
  const v = ctx?.settings?.[CLASSIC_KEY];
  const on = forcedLayout() ?? !(v === true || v === 'true');
  if (ctx) ctx.homeV2 = on;
  return on;
}

/** The words the v2 screens use (the reference has no strings for them). */
export const WORDS = {
  home: 'Home', library: 'Library', search: 'Search', more: 'More',
  all: 'All', playlists: 'Playlists', albums: 'Albums', artists: 'Artists', songs: 'Songs', folders: 'Folders', new: 'New',
  seeAll: 'See all', liked: 'Liked songs', allMusic: 'All music',
  recentlyAdded: 'Recently added', mostPlayed: 'Most played lately', forgotten: 'Forgotten favourites',
  recentlyPlayed: 'Recently played', yourPlaylists: 'Your playlists', yourAlbums: 'Your albums', topArtists: 'Your artists', newSongs: 'New songs',
  recent: 'Recent', name: 'Name', added: 'Added', nothingYet: 'Play something and it shows here.',
};
