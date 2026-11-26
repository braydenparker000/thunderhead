// The library's category views (albums, artists, album artists, composers, genres, folders) built as
// steps: each builder is a generator that yields every STEP songs, so idle time (view/idle-work.js)
// can build a 15,000-song library's views in slices of a few milliseconds instead of one long task
// each; run() takes the same steps at once, for a view asked for before it was built. The results are
// the same either way (tests/music-groups-steps.test.mjs). Library.grouped keeps them per shown list.

export const STEP = 500;

// The default order of the views, and paths case-insensitive with numbers by value.
export const PLAIN = new Intl.Collator(), PATHS = new Intl.Collator(undefined, {sensitivity: 'base', numeric: true});

/** Runs a generator's steps to the end; its return value. */
export function run(steps) {
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}

const SORT_RUN = 128;

/**
 * arr.sort(cmp) as steps (a stable merge sort over runs the engine sorts): the same order as the
 * engine's own stable sort, in place, yielding every few hundred comparisons. Short arrays sort at once.
 */
export function* sortSteps(arr, cmp) {
  const n = arr.length;
  if (n <= SORT_RUN) return arr.sort(cmp);
  for (let i = 0; i < n; i += SORT_RUN) {
    const part = arr.slice(i, i + SORT_RUN).sort(cmp);
    for (let k = 0; k < part.length; k++) arr[i + k] = part[k];
    yield;
  }
  let src = arr, dst = new Array(n), work = 0;
  for (let width = SORT_RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n), hi = Math.min(lo + 2 * width, n);
      let i = lo, j = mid, k = lo;
      // Ties keep the left run's song first: the order a stable sort gives.
      while (i < mid && j < hi) {
        dst[k++] = cmp(src[j], src[i]) < 0 ? src[j++] : src[i++];
        if (++work % 500 === 0) yield;
      }
      while (i < mid) dst[k++] = src[i++];
      while (j < hi) dst[k++] = src[j++];
    }
    [src, dst] = [dst, src];
  }
  if (src !== arr) for (let k = 0; k < n; k++) arr[k] = src[k];
  return arr;
}

/** Albums keyed by the catalog's album id, else album and album artist (join_albums: Library.albums). */
export function* albumSteps(lib, tracks) {
  const unknown = lib.ctx.res?.stringByName('unknown_album_name') ?? 'Unknown album';
  const lc = s => (s ?? '').toLowerCase();
  const tagged = new Set();
  let n = 0;
  if (lib.ctx.pref?.('join_albums') !== false) {
    for (const t of tracks) {
      if (t.album && t.albumArtist) tagged.add(lc(t.album) + '\u0000' + lc(t.albumArtist));
      if (++n % STEP === 0) yield;
    }
  }
  const map = new Map();
  for (const t of tracks) {
    let key;
    // The catalog's album id (the same for every song of one release, however its tags are spelled)
    // groups first; without one, the album's name and album artist, as typed.
    if (t.albumId) key = '\u0002' + t.albumId;
    else if (!t.album) key = '\u0001';
    else {
      let aa = lc(t.albumArtist);
      if (!aa && t.artist && tagged.has(lc(t.album) + '\u0000' + lc(t.artist))) aa = lc(t.artist);
      key = lc(t.album) + '\u0000' + aa;
    }
    let a = map.get(key);
    if (!a) map.set(key, a = {kind: 'album', title: t.album || unknown, artist: t.albumArtist || t.artist || '', tracks: [], artId: t.artId});
    a.tracks.push(t);
    a.artId ||= t.artId;
    if (++n % STEP === 0) yield;
  }
  return yield* sortSteps([...map.values()], (x, y) => PLAIN.compare(x.title, y.title));
}

/** Artists, composers or genres as groups of songs (split names: Library.namesOf). */
export function* namedSteps(lib, tracks, field, kind, unknownName, unknownFallback) {
  const unknown = lib.ctx.res?.stringByName(unknownName) ?? unknownFallback;
  const showUnsplit = field !== 'genre' && !!lib.ctx.pref?.('show_unsplit_cats');
  const map = new Map();
  const add = (name, t) => {
    const k = name.toLowerCase();
    let g = map.get(k);
    if (!g) map.set(k, g = {kind, title: name || unknown, tracks: []});
    if (g.tracks[g.tracks.length - 1] !== t) g.tracks.push(t);
  };
  const splitters = lib.splitters();
  let n = 0;
  for (const t of tracks) {
    const {names, unsplit} = lib.namesOf(t, field, splitters);
    for (const name of names) add(name, t);
    if (unsplit && showUnsplit) add(unsplit, t);
    if (++n % STEP === 0) yield;
  }
  return yield* sortSteps([...map.values()], (x, y) => PLAIN.compare(x.title, y.title));
}

/** Album artists: a song without an album artist counts under its artist (IFNULL(album_artist, artist)). */
export function* albumArtistSteps(lib, tracks) {
  const unknown = lib.ctx.res?.stringByName('unknown_artist_name') ?? 'Unknown artist';
  const showUnsplit = !!lib.ctx.pref?.('show_unsplit_cats');
  const map = new Map(), splitters = lib.splitters();
  let n = 0;
  for (const t of tracks) {
    const field = t.albumArtist ? 'albumArtist' : 'artist';
    const {names, unsplit} = lib.namesOf(t, field, splitters);
    for (const name of unsplit && showUnsplit ? [...names, unsplit] : names) {
      const k = name.toLowerCase();
      let g = map.get(k);
      if (!g) map.set(k, g = {kind: 'albumArtist', title: name || unknown, tracks: []});
      g.tracks.push(t);
    }
    if (++n % STEP === 0) yield;
  }
  return yield* sortSteps([...map.values()], (x, y) => PLAIN.compare(x.title, y.title));
}

/** Folders (each track folder's songs), by path. */
export function* folderSteps(tracks) {
  const map = new Map();
  let n = 0;
  for (const t of tracks) {
    const k = t.folder || '/';
    (map.get(k) ?? map.set(k, {kind: 'folder', title: k.split('/').pop() || k, path: k, tracks: []}).get(k)).tracks.push(t);
    if (++n % STEP === 0) yield;
  }
  return yield* sortSteps([...map.values()], (x, y) => PLAIN.compare(x.path, y.path));
}
