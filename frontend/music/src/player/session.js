// What the player was doing, kept across a restart. A phone closes a background tab whenever it
// wants the memory, so "restart" is ordinary: the song and its place, shuffle and repeat, the Queue,
// and (since 2026-11) the list that was playing with its play order, so Next after a restart is the
// song it would have been, an album stays that album, and a shuffle does not start over.
//
// Two records in the library's state store: 'queue' (small, written often) and 'queue-list' (the
// list's song ids and play order, written only when the list or its order changes).

import {groupKey} from '../library/group-key.js';

const STATE = 'queue', LIST = 'queue-list';
const SAVE_EVERY_MS = 10000; // the place in the song, while it plays

/** The list that plays outside the Queue (in queue mode, the one it returns to), its play order and place. */
function playingList(player) {
  const np = player.queueMode ? player.savedNP : null;
  return np?.queue ? {list: np.queue, order: np.order ?? null, shuffle: np.orderShuffle, index: np.index, category: np.category ?? null}
    : {list: player.queue, order: player.order ?? null, shuffle: player.orderShuffle, index: player.index, category: player.category ?? null};
}

/** The category the list came from, named so list/category-ref.js can find it again: {home, key}, or null. */
function categoryRef({category: c, index}) {
  if (!c?.source?.home) return null;
  // In Shuffle All the list spans every category: the one the playing song is in.
  let i = c.index;
  if (c.spans) { let start = 0; i = 0; while (i < c.spans.length - 1 && index >= start + c.spans[i]) start += c.spans[i++]; }
  const key = groupKey(c.source.groups?.[i]);
  return key ? {home: c.source.home, key} : null;
}

const sameSongs = (a, b) => a === b || (a.length === b.length && a.every((t, i) => t?.id === b[i]?.id));

/** The small record: the song, its place, the modes and the Queue. Null when nothing from the library plays. */
export function stateOf(player, library) {
  const t = player.track;
  if (!t || !library.byId.has(t.id)) return null;
  const np = player.savedNP, at = playingList(player);
  return {
    trackId: t.id, positionMs: player.positionMs(), shuffle: player.shuffle, repeat: player.repeat,
    entries: player.entries.map(e => ({id: e.track.id, created: e.created, played: e.played})),
    queueMode: player.queueMode, npTrackId: np?.queue?.[np.index]?.id ?? null, listIndex: at.index, category: categoryRef(at),
  };
}

/** The list record: every song id in order (or `all` for the whole library as it stands) and the play order. */
export function listOf(player, library) {
  const {list, order, shuffle} = playingList(player);
  const all = sameSongs(list, library.tracks);
  return {all, ids: all ? null : list.map(t => t.id), order: order?.length === list.length ? [...order] : null, shuffle: shuffle ?? 0};
}

/** True when `order` is a play order for a list of n songs: each place once. */
export function validOrder(order, n) {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Uint8Array(n);
  for (const i of order) { if (!Number.isInteger(i) || i < 0 || i >= n || seen[i]) return false; seen[i] = 1; }
  return true;
}

/**
 * Puts the player back as the records say. A song that has left the library drops out of the list
 * (the play order is then made anew); a record that names nothing known starts the whole library.
 */
export function restore(player, library, saved, savedList) {
  const byId = library.byId;
  if (saved?.shuffle !== undefined) player.shuffle = saved.shuffle;
  if (saved?.repeat !== undefined) player.repeat = saved.repeat;
  player.restoreQueue(saved?.entries ?? saved?.userQueue, byId);
  const wanted = saved?.queueMode ? saved.npTrackId : saved?.trackId;
  let list = library.tracks, whole = true;
  if (savedList && !savedList.all && Array.isArray(savedList.ids)) {
    const found = savedList.ids.map(id => byId.get(id)).filter(Boolean);
    whole = found.length === savedList.ids.length;
    // The list is only used when the song that was playing is in it.
    if (found.some(t => t.id === wanted)) list = found; else whole = true;
  }
  let index = saved?.listIndex;
  if (!(Number.isInteger(index) && list[index]?.id === wanted)) index = Math.max(0, list.findIndex(t => t.id === wanted));
  player.setQueue(list, index);
  // The category list it came from, when the list is still that category's (list/category-ref.js; none in tests of the player alone).
  if (saved?.category) player.ctx?.restoreCategory?.(saved.category);
  const order = whole && savedList?.shuffle === player.shuffle && validOrder(savedList?.order, list.length) ? savedList.order : null;
  if (order) { player.order = order; player.orderShuffle = player.shuffle; player.orderQueueMode = false; }
  if (saved?.queueMode) {
    player.resumeQueueMode(saved.trackId);
    if (order && player.savedNP) { player.savedNP.order = order; player.savedNP.orderShuffle = player.shuffle; }
  }
  if (saved?.positionMs) player.seek(saved.positionMs);
}

/** Saves as the player goes: on every change that matters, every ten seconds while it plays, and when the page is hidden or put away. */
export function installSession(ctx, player, library) {
  const db = library.db;
  let lastList = null, lastOrder = null, lastShuffle = null;
  const save = () => {
    const state = stateOf(player, library);
    if (!state || !db) return;
    db.setState(STATE, state).catch(() => {});
    const at = playingList(player);
    if (at.list === lastList && at.order === lastOrder && at.shuffle === lastShuffle) return;
    lastList = at.list; lastOrder = at.order; lastShuffle = at.shuffle;
    db.setState(LIST, listOf(player, library)).catch(() => {});
  };
  ctx.bus.subscribe('bus_player', m => { if (/^msg_player_(track_changed|playing_state_changed|shuffle_mode_changed|repeat_mode_changed|queue_changed|category_changed)$/.test(m)) save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  for (const type of ['pagehide', 'freeze']) addEventListener(type, save);
  setInterval(() => { if (player.playing) save(); }, SAVE_EVERY_MS);
  return save;
}

/** Reads both records (null where there is none). */
export async function readSession(library) {
  const db = library.db;
  const [saved, savedList] = await Promise.all([db?.getState(STATE).catch(() => null), db?.getState(LIST).catch(() => null)]);
  return {saved: saved ?? null, savedList: savedList ?? null};
}
