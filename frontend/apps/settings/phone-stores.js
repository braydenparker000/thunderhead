// @ts-check
// Every place the site keeps data in this browser, by app (MENU-AND-SETTINGS.md §6.11, Settings ›
// Account and data › On this phone): which caches, IndexedDB databases (or keys in one), private
// files (OPFS) and localStorage each row measures (phone-measure.js), and for the rows that hold only
// what comes back by downloading again, how to clear them, with the apps' own removal code where they
// have it. Anything that cannot be fetched again has no `clear`: sign-in (`th-auth`, `th-setup`,
// `th-recover`), unsent messages and conversations (`th-data`), Photos' uploads waiting, imports under
// way, edits and ratings, Study's places, labels and books still uploading, Music's songs added from
// this phone's files, Astra's learned intros, the lab's edits and raw files, problem reports, and every
// localStorage key (settings, places, marks, the Forget queue). Code caches are left to About › Repair.

/** Photos' copies of the shelf, each photo's facts, previews and thumbnails: fetched again when shown. */
const PHOTOS_KEPT = ['shelf:', 'photo:', 'preview:', 'thumb:'];

/**
 * A row's units: caches by name, IndexedDB databases by name (with `keys` only the keys starting so,
 * with `skip` all but those), top-level private-file entries by name, localStorage (`local`).
 * @typedef {{ caches?: RegExp, idb?: string[], keys?: string[], skip?: string[], opfs?: RegExp, local?: boolean }} Units
 * @typedef {{ id: string, title: string, detail: string, unit: [string, string], units: Units,
 *   lost?: string, clear?: () => Promise<void> }} Store
 */

const dropCaches = async (/** @type {string[]} */ names) => {
  if (globalThis.caches) await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
};

/** Deletes the keys of an IndexedDB database that start with one of `prefixes`, never creating it. */
export async function dropKeys(/** @type {string} */ name, /** @type {string[]} */ prefixes) {
  const db = await new Promise((resolve) => {
    try {
      const req = indexedDB.open(name);
      req.onupgradeneeded = () => req.transaction?.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (!db) return;
  try {
    const names = [...db.objectStoreNames];
    if (!names.length) return;
    await new Promise((resolve) => {
      const tx = db.transaction(names, 'readwrite');
      for (const s of names) for (const p of prefixes) tx.objectStore(s).delete(IDBKeyRange.bound(p, `${p}￿`));
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve(undefined);
    });
  } finally {
    db.close();
  }
}

/** Study's kept books, through Study's own removal; a book still uploading from this phone keeps its file. */
async function clearBooks() {
  const [{ remove, DIR }, { local }] = await Promise.all([import('/apps/study/copies.js'), import('/apps/study/data.js')]);
  /** @type {any} */
  let dir;
  try {
    dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR);
  } catch {
    return;
  }
  const ids = new Set();
  for await (const name of dir.keys()) {
    const m = /^(.+)\.(pdf|parts)$/.exec(name);
    if (m) ids.add(m[1]);
  }
  for (const id of ids) if (!(await local.get(`upload:${id}`).catch(() => null))) await remove(id);
}

/** Podcasts' downloads: the files, and the marks that say they are here (podcasts/core.js's state). */
async function clearDownloads() {
  const { AUDIO_CACHE, STORAGE_KEY } = await import('/podcasts/core.js');
  await dropCaches([AUDIO_CACHE]);
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (s && typeof s === 'object' && s.downloads && Object.keys(s.downloads).length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, downloads: {} }));
  } catch {}
}

/** @type {readonly Store[]} */
export const STORES = [
  { id: 'music-songs', title: 'Music · Offline songs', detail: 'Whole songs kept to play without a signal.', unit: ['song', 'songs'], units: { caches: /^claude-player-audio$/ },
    lost: 'songs kept to play without a signal',
    clear: async () => {
      const { AudioCache } = await import('/music/src/library/audio-cache.js');
      const c = new AudioCache();
      await c.ready;
      await c.clear();
    } },
  { id: 'music-played', title: 'Music · Songs played', detail: 'Songs you played, kept so playing them again uses no data.', unit: ['song', 'songs'], units: { caches: /^claude-player-played$/ },
    lost: 'songs kept from playing them',
    clear: async () => {
      const { PlayedCache } = await import('/music/src/library/played-cache.js');
      const c = new PlayedCache();
      await c.ready;
      await c.clear();
    } },
  { id: 'music-heads', title: 'Music · Song starts', detail: 'The first seconds of the songs that come next.', unit: ['piece', 'pieces'], units: { caches: /^claude-player-heads$/ },
    lost: 'the first seconds kept of the songs that come next', clear: () => dropCaches(['claude-player-heads']) },
  // Music's own "clear_aa_cache" (library.js clearArtCache) deletes these two caches.
  { id: 'music-covers', title: 'Music · Covers', detail: 'Album art and thumbnails.', unit: ['picture', 'pictures'], units: { caches: /^claude-player-(covers|thumbs)$/ },
    lost: 'album art and thumbnails', clear: () => dropCaches(['claude-player-covers', 'claude-player-thumbs']) },
  { id: 'music-library', title: 'Music · Songs from this phone', detail: 'Songs and playlists added from this phone’s files.', unit: ['record', 'records'], units: { idb: ['claude-player'] } },
  { id: 'podcasts-downloads', title: 'Podcasts · Downloads', detail: 'Episodes downloaded to play offline.', unit: ['episode', 'episodes'], units: { caches: /^jarvis-podcast-audio-v\d+$/ },
    lost: 'downloaded episodes', clear: clearDownloads },
  { id: 'podcasts-art', title: 'Podcasts · Show art', detail: 'Pictures of the shows.', unit: ['picture', 'pictures'], units: { caches: /^jarvis-podcast-art-v\d+$/ },
    lost: 'pictures of the shows', clear: () => dropCaches(['jarvis-podcast-art-v1']) },
  { id: 'podcasts-feeds', title: 'Podcasts · Shows', detail: 'The shows you follow and their episode lists.', unit: ['show', 'shows'], units: { idb: ['jarvis-podcasts'] } },
  { id: 'astra-data', title: 'Astra · Saved answers', detail: 'Catalogues and title pages, so they open at once.', unit: ['answer', 'answers'], units: { caches: /^astra-data-v\d+$/ },
    lost: 'catalogues and title pages kept so they open at once',
    clear: async () => (await import('/astra/src/app/cache.js')).clearCache() },
  { id: 'astra-intro', title: 'Astra · Intros learned', detail: 'Where each series’ opening and ending are.', unit: ['series', 'series'], units: { idb: ['astra-intro'] } },
  { id: 'study-books', title: 'Study · Books', detail: 'Books kept to read without a signal.', unit: ['file', 'files'], units: { opfs: /^study$/ },
    lost: 'books kept to read without a signal (a book still uploading from this phone stays)', clear: clearBooks },
  { id: 'study-shelf', title: 'Study · Places and notes', detail: 'Where you are in each book, labels and uploads.', unit: ['record', 'records'], units: { idb: ['th-study'] } },
  { id: 'photos-kept', title: 'Photos · Shelf kept offline', detail: 'Thumbnails, previews and the shelf.', unit: ['record', 'records'], units: { idb: ['th-photos'], keys: PHOTOS_KEPT },
    lost: 'thumbnails, previews and the shelf kept for offline', clear: () => dropKeys('th-photos', PHOTOS_KEPT) },
  { id: 'photos-own', title: 'Photos · Waiting and edits', detail: 'Uploads waiting, imports under way, edits and ratings.', unit: ['record', 'records'], units: { idb: ['th-photos'], skip: PHOTOS_KEPT } },
  { id: 'guitar', title: 'Guitar · Saved tabs', detail: 'Copies of saved songs’ tabs, covers and sounds.', unit: ['entry', 'entries'], units: { caches: /^jarvis-guitar-v\d+$/ } },
  { id: 'chat', title: 'Chat and conversations', detail: 'Conversations, the Briefing and messages not sent yet.', unit: ['record', 'records'], units: { idb: ['th-data'] } },
  { id: 'lab', title: 'Photo editor', detail: 'Edits, looks and the photos opened in it.', unit: ['item', 'items'], units: { idb: ['th-editor', 'th-looks', 'th-engine'], opfs: /^(?!study$)/ } },
  { id: 'signin', title: 'Sign-in', detail: 'This phone’s sign-in.', unit: ['record', 'records'], units: { idb: ['th-auth', 'th-setup', 'th-recover'] } },
  { id: 'reports', title: 'Problem reports', detail: 'Kept here until you send one.', unit: ['record', 'records'], units: { idb: ['th-report'] } },
  { id: 'code', title: 'The app’s own code', detail: 'Home, Music, Podcasts, Astra and the lab, to open without a signal.', unit: ['file', 'files'],
    units: { caches: /^(th-(\d+|vendor|lab-\d+|frames|music-catalog)|claude-player-v\d+|jarvis-podcast-shell-v\d+|astra-(app-.+|sw-state|v1))$/ } },
  { id: 'local', title: 'Settings and small notes', detail: 'Choices, places and marks for every app.', unit: ['key', 'keys'], units: { local: true } },
];

/** The row for what no row names (left by an older version). @type {Store} */
export const OTHER = { id: 'other', title: 'Other', detail: 'Left by older versions of the site.', unit: ['item', 'items'], units: {} };

