// The v2 library layout (a prototype the owner chooses, 2026-11-26): Home, Search, Library and More in
// the navbar, a Home of shelves and a one-screen Library with chips. Off unless the setting home_v2 is
// on, or the page is opened with ?home2 (the demo page shows it that way). Nothing else changes while
// it is off: the navbar, the library home and its lists are as they were.

/** Whether the v2 layout is on for this page. */
export function homeV2(ctx) {
  if (ctx?.homeV2 !== undefined) return ctx.homeV2;
  let query = false;
  try { query = new URLSearchParams(globalThis.location?.search ?? '').has('home2'); } catch { /* no location */ }
  const on = query || ctx?.settings?.home_v2 === true || ctx?.settings?.home_v2 === 'true';
  if (ctx) ctx.homeV2 = on;
  return on;
}

/** The words the v2 screens use (the reference has no strings for them). */
export const WORDS = {
  home: 'Home', library: 'Library', search: 'Search', more: 'More',
  all: 'All', playlists: 'Playlists', albums: 'Albums', artists: 'Artists', songs: 'Songs', folders: 'Folders', new: 'New',
  seeAll: 'See all', liked: 'Liked songs', allMusic: 'All music',
  recentlyAdded: 'Recently added', mostPlayed: 'Most played lately', forgotten: 'Forgotten favourites',
  recentlyPlayed: 'Recently played', yourPlaylists: 'Your playlists', topArtists: 'Your artists', newSongs: 'New songs',
  recent: 'Recent', name: 'Name', added: 'Added', nothingYet: 'Play something and it shows here.',
};
