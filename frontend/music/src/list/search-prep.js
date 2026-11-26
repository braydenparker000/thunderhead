// Search over a large library without freezes (the search field: widgets/search.js). On a slow phone
// with 15,000 songs the first key froze ~600 ms (every song's fields normalised then) and each later key
// 100–250 ms (every song ranked, on every input event). Now:
// - every song's search fields are normalised in idle time after each library change (warmSearch);
// - the field sends its text once typing pauses (DEBOUNCE_MS), the latest text always;
// - before it sends, each song's tier for that text is worked out in slices of a few milliseconds
//   (prepareSearch), stopped when a newer key comes; the search then takes them (th/music/search.js
//   smartSongs), so its results and their order are the same as without.
import {prepareSteps, warmSteps} from '/th/music/search.js';
import {idleWork} from '../view/idle-work.js';

export const DEBOUNCE_MS = 120;
const SLICE_MS = 8;

/** What the songs search reads, as list/sources.js searchSource has it: the songs, the line shown, titles only. */
export function searchInputs(ctx) {
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player?.queue ?? [];
  const fileTitles = !!ctx.pref?.('title_filename'), titlesOnly = !!ctx.pref?.('search_track_titles_only');
  const fileName = t => { const p = t.fileName || t.path || ''; return p.slice(p.lastIndexOf('/') + 1); };
  return {pool, title: t => (fileTitles ? fileName(t) : t.title), titlesOnly};
}

/** Runs steps a slice at a time between tasks; done() after the last. Returns a cancel. */
export function runSliced(steps, done) {
  let stopped = false, timer = 0;
  const slice = () => {
    timer = 0;
    const end = performance.now() + SLICE_MS;
    try {
      while (!stopped && performance.now() < end) if (steps.next().done) { stopped = true; done(); return; }
    } catch (e) { stopped = true; console.warn('[claude-player] search', e); done(); return; }
    if (!stopped) timer = setTimeout(slice, 0);
  };
  timer = setTimeout(slice, 0);
  return () => { stopped = true; clearTimeout(timer); };
}

/**
 * The tiers for a query worked out in slices, then done() (at once when there is nothing to work out:
 * too short a query, a search within one list). Returns a cancel.
 */
export function prepareSearch(ctx, query, done) {
  const q = String(query ?? '').trim();
  if (q.length < 2 || ctx.listWidget?.searchTarget) { done(); return () => {}; }
  const {pool, title, titlesOnly} = searchInputs(ctx);
  return runSliced(prepareSteps(pool, q, title, titlesOnly), done);
}

// The songs' and the views' lower-cased search texts (list/sources.js searchSource keeps them here).
export const SEARCH_TEXT = new WeakMap();

/** searchSource's texts made ahead, as it makes them: per item and field set (mode). */
function* textSteps(ctx) {
  const {pool, title, titlesOnly} = searchInputs(ctx), lib = ctx.library;
  const mode = (ctx.pref?.('title_filename') ? 1 : 0) | (titlesOnly ? 2 : 0);
  const keep = (o, make) => { if (SEARCH_TEXT.get(o)?.mode !== mode) SEARCH_TEXT.set(o, {mode, s: make().toLowerCase()}); };
  let n = 0;
  for (const t of pool) {
    keep(t, () => (titlesOnly ? title(t) ?? '' : (title(t) ?? '') + (t.album ?? '') + (t.artist ?? '')));
    if (++n % 250 === 0) yield;
  }
  if (!lib?.tracks?.length || !lib.groupedSteps) return;
  for (const kind of ['albums', 'artists', 'albumArtists', 'folders', 'genres', 'composers']) {
    for (const g of yield* lib.groupedSteps(kind)) {
      keep(g, () => (g.title ?? '') + (kind === 'albums' ? g.artist ?? '' : ''));
      if (++n % 250 === 0) yield;
    }
  }
}

/** Every song's search fields and texts made in idle time after each library change (once installed). */
export function warmSearch(ctx) {
  if (ctx._searchWarm) return;
  ctx._searchWarm = true;
  const warm = () => {
    if (!globalThis.requestIdleCallback) return;
    idleWork(ctx, 'search-fields', [() => { const {pool, title, titlesOnly} = searchInputs(ctx); return warmSteps(pool, title, titlesOnly); }, () => textSteps(ctx)]);
  };
  ctx.bus.subscribe('bus_library', warm);
  if (ctx.library?.tracks?.length) warm();
}
