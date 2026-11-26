// Sorted song orders kept per list of songs and sort value (All Songs: the library's whole list, about
// 125 ms to sort at every open on a slow phone with 15,000 songs). Kept by the list itself: a library
// change makes a new list (Library.setTracks), so its orders are made again; orders that follow what
// changes as songs play or are rated (rating, last played, plays) and the length are never kept.
import {run, sortSteps} from '../library/groups.js';

// Sort values whose order depends only on the catalog (list/sources.js TRACK_SORT).
const STABLE = new Set([0, 13, 1, 2, 14, 8, 9, 3, 15, 12, 4]);

/** @type {WeakMap<object[], Map<number, object[]>>} */
const kept = new WeakMap();

/** Whether a sort value's order is kept. */
export const keptSort = v => STABLE.has(v);

/** tracks sorted by cmp (sort value v), a new array each time; the order is kept for the same list and value. */
export function sortedTracks(tracks, v, cmp) {
  return run(sortedSteps(tracks, v, cmp));
}

/** sortedTracks as steps (groups.js): made in idle slices ahead of the first open (list-widget prepare). */
export function* sortedSteps(tracks, v, cmp) {
  if (!keptSort(v)) return [...tracks].sort(cmp);
  let byValue = kept.get(tracks);
  const had = byValue?.get(v);
  if (had) return had.slice();
  const order = yield* sortSteps([...tracks], cmp);
  if (!byValue) kept.set(tracks, byValue = new Map());
  byValue.set(v, order);
  return order.slice();
}
