// Songs' links signed before they are asked for (MUSIC.md §6.1): the service worker's bridge
// (th/music/bridge.js `th-music-ahead`) signs up to 50 in one request and keeps each link until 20
// minutes before it expires. On a slow connection the signature was a round trip (and the worker's
// wake-up) between the tap on a song and its first byte. Now it is asked for:
// - at pointer-down on a song's row (input.js → PowerList.onItemPress), so it is on its way while the
//   finger is still down; a press that becomes a scroll or a hold only leaves a signed link (no bytes);
// - for the rows on screen once a list has settled (SETTLE_MS after its last move, PowerList).
// A link posted in the last REPOST_MS is not posted again (the worker keeps it far longer).

export const SETTLE_MS = 150;
const REPOST_MS = 30 * 60_000;
const MAX = 50;
/** @type {Map<string, number>} */
const posted = new Map();

/** Remote song addresses of tracks (the player's own; offline copies and files need no link). */
function urlsOf(tracks) {
  const out = [];
  for (const t of tracks) if (typeof t?.src === 'string' && /^https?:/.test(t.src) && !out.includes(t.src)) out.push(t.src);
  return out;
}

/** Asks the worker to sign these songs' links now; returns the addresses posted. */
export function signAhead(tracks, now = Date.now()) {
  const sw = globalThis.navigator?.serviceWorker?.controller;
  if (!sw) return [];
  const urls = urlsOf(tracks).filter(u => !(now - (posted.get(u) ?? -Infinity) < REPOST_MS)).slice(0, MAX);
  if (!urls.length) return [];
  for (const u of urls) posted.set(u, now);
  if (posted.size > 2000) for (const [u, at] of posted) if (now - at >= REPOST_MS) posted.delete(u);
  sw.postMessage({type: 'th-music-ahead', urls});
  return urls;
}

/** The single song a list row plays when tapped (a group row opens a list: none). */
export function rowSong(list, v) {
  const s = list?.source, i = v?.listIndex;
  if (!s || !(i >= 0) || s.isSeparator?.(i) || v.track?.group) return null;
  const tracks = s.tracksAt?.(i) ?? [];
  return tracks.length === 1 ? tracks[0] : null;
}

/** The songs of the rows a list shows now. */
export function shownSongs(list) {
  const out = [];
  for (const [i, v] of list?.active ?? []) {
    if (i < 0 || v.offScreen) continue;
    const t = rowSong(list, v);
    if (t) out.push(t);
  }
  return out;
}
