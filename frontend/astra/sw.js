// Service worker: Astra opens at once from a saved copy of its own files,
// and updates in the background.
//
// A release of Astra is named in the site's /release.json (components.astra.tree,
// a hash of every file under frontend/astra as staged: scripts/astra/files.mjs);
// /astra/files.json lists those files with a hash of each. Each release is saved
// in a cache of its own, and a page is served from the release it started on for
// as long as it is open, even after this worker has been stopped and started
// again (which release each page and its workers started on is kept in the state
// cache), so files from two releases never mix. The app's own files are saved
// whole; vendor/ (megabytes, needed only by some films) is saved when first used.
// When /release.json names a newer release, it is saved whole in the background:
// a file whose hash did not change is copied from the release in use, the rest
// are fetched and checked against their hash; only then are open pages told, and
// they offer to reload. Files Astra loads from outside its folder (/assets/,
// /config.js, /th/) are never handled here: they always come from the network.
// Add-on answers, artwork and video are never handled here either (the page
// keeps add-on answers in 'astra-data-v1' itself).

const PREFIX = 'astra-app-';
const STATE = 'astra-sw-state';
const OLD = ['astra-v1']; // the network-first cache of earlier versions
const GRACE = 60_000; // a page being opened is not yet listed among the clients

const known = new Map(); // client id -> release, mirrors state.clients
const lists = new Map(); // release -> its files.json list (or null: none)
let updating = null, choosing = null, writing = Promise.resolve();

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all(OLD.map(name => caches.delete(name)));
    // Earlier versions saved pages under their whole address: a stream address in lab/?src= stays nowhere.
    for (const name of await caches.keys()) {
      if (!name.startsWith(PREFIX)) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) if (new URL(request.url).search) await cache.delete(request);
    }
    await tidy(await change(state => state));
    await self.clients.claim();
  })());
});

async function readState() {
  const response = await (await caches.open(STATE)).match('state');
  const state = response ? await response.json() : {};
  return {current: null, previous: null, clients: {}, ...state};
}
const json = value => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
/** Changes the saved state one change at a time; drops pages that have closed. */
function change(edit) {
  const next = writing.then(async () => {
    const state = await edit(await readState()) ?? await readState();
    const open = new Set((await self.clients.matchAll({type: 'all', includeUncontrolled: true})).map(c => c.id));
    state.clients = Object.fromEntries(Object.entries(state.clients || {}).filter(([id, c]) => open.has(id) || Date.now() - c.at < GRACE));
    await (await caches.open(STATE)).put('state', json(state));
    return state;
  });
  writing = next.catch(() => {});
  return next;
}
/** Remembers which release a page (or a worker it started) is served from. */
function record(id, release) {
  if (!id || !release) return Promise.resolve();
  known.set(id, release);
  return change(state => ({...state, clients: {...state.clients, [id]: {release, at: Date.now()}}}));
}
/** The release a page is served from: the one it started on while that is saved, else the current one. */
async function releaseOf(id) {
  if (id && known.has(id)) return known.get(id);
  const state = await readState();
  const own = id && state.clients[id]?.release;
  if (own && await caches.has(PREFIX + own)) { known.set(id, own); return own; }
  return state.current;
}

/** The release the site serves now, or null when it cannot be read. */
async function siteRelease() {
  try {
    const response = await fetch(new URL('/release.json', self.location.origin), {cache: 'no-store'});
    if (!response.ok) return null;
    const release = await response.json();
    return release?.components?.astra?.tree || release?.commit || null;
  } catch { return null; }
}

/** A release's list of files {path: hash}, kept in the state cache; null for a release without one.
 * Throws while the site's list is another release's (a deploy part-way). */
async function listOf(release) {
  if (lists.has(release)) return lists.get(release);
  const state = await caches.open(STATE);
  const kept = await state.match('files/' + release);
  if (kept) { const files = await kept.json(); lists.set(release, files); return files; }
  const response = await fetch(new URL('files.json', self.registration.scope), {cache: 'no-store'});
  if (response.status === 404) return null; // a site from before the lists: no copying, no checking
  if (!response.ok) throw Error('no list');
  const list = await response.json();
  if (list.tree !== release) throw Error('not ready');
  await state.put('files/' + release, json(list.files));
  lists.set(release, list.files);
  return list.files;
}
const knownList = release => listOf(release).catch(() => null);

/** The app's own files, saved whole for each release (vendor/ is saved when first used). */
const whole = path => !path.startsWith('vendor/') && !path.endsWith('.md');
const base = () => new URL('./', self.registration.scope).href;
/** A file's place in the release ('index.html' for a folder); null outside Astra's folder. */
function pathOf(href) {
  const url = new URL(href), root = new URL(base());
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
  const path = url.pathname.slice(root.pathname.length);
  return path === '' || path.endsWith('/') ? path + 'index.html' : path;
}
/** The one key a file is saved under: its address without the query, a page as its folder. */
const keyOf = path => base() + path.replace(/(^|\/)index\.html$/, '$1');
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const hashOf = async body => hex(await crypto.subtle.digest('SHA-256', body)).slice(0, 16);

/** Saves a response under its key, after checking it is the release's own file (when the release has a list). */
async function save(cache, path, response, files) {
  const body = await response.arrayBuffer();
  if (files?.[path] && await hashOf(body) !== files[path]) throw Error('changed');
  await cache.put(keyOf(path), new Response(body, {status: response.status, headers: response.headers}));
}

/**
 * The release this worker serves: the saved one, or on the very first visit
 * the site's current one, recorded at once so the first page's files and a
 * second tab opened meanwhile land in the same cache.
 */
function servedRelease() {
  return choosing ??= (async () => {
    const state = await readState();
    if (state.current) return state.current;
    const release = await siteRelease();
    if (release) await change(s => ({...s, current: s.current || release}));
    return (await readState()).current;
  })().finally(() => { choosing = null; });
}

const inScope = url => url.origin === self.location.origin && url.pathname.startsWith(new URL(base()).pathname);

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range') || !inScope(url)) return;
  event.respondWith(request.mode === 'navigate' ? navigate(event) : subresource(event));
});

async function navigate(event) {
  const path = pathOf(event.request.url);
  const state = await readState();
  if (state.current) {
    const saved = await (await caches.open(PREFIX + state.current)).match(keyOf(path));
    if (saved) {
      event.waitUntil(record(event.resultingClientId, state.current).then(() => checkForUpdate()));
      return saved;
    }
  }
  // Not saved yet: this visit comes from the network and is saved as it loads.
  const release = await servedRelease();
  const response = await fetch(event.request);
  if (release && response.ok && response.type === 'basic') {
    event.waitUntil(Promise.all([record(event.resultingClientId, release),
      listOf(release).then(async files => save(await caches.open(PREFIX + release), path, response.clone(), files)).catch(() => {})]));
  }
  return response;
}

async function subresource(event) {
  const request = event.request, path = pathOf(request.url);
  const release = await releaseOf(event.clientId);
  if (!release) return fetch(request);
  // A worker the page starts (the subtitle engine's) is served from the page's release too.
  if (event.resultingClientId) event.waitUntil(record(event.resultingClientId, release));
  const cache = await caches.open(PREFIX + release);
  const saved = await cache.match(keyOf(path));
  if (saved) return saved;
  const response = await fetch(request);
  // Not saved when it is no longer this release's file (the site has moved on).
  if (response.ok && response.type === 'basic') event.waitUntil(listOf(release).then(files => save(cache, path, response.clone(), files)).catch(() => {}));
  return response;
}

// The first visit loads before this worker controls the page; the page then
// lists the files it loaded, and the rest of the app's own files are saved too.
self.addEventListener('message', event => {
  if (event.data?.type !== 'astra-precache' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const release = await servedRelease();
    if (!release) return;
    if (event.source?.id && !(await readState()).clients[event.source.id]) await record(event.source.id, release);
    const files = await listOf(release);
    const cache = await caches.open(PREFIX + release);
    const paths = new Set(event.data.urls.slice(0, 300).map(pathOf).filter(Boolean));
    for (const path of Object.keys(files || {})) if (whole(path)) paths.add(path);
    for (const path of paths) {
      if (path === 'sw.js' || (files && !(path in files)) || await cache.match(keyOf(path))) continue;
      const response = await fetch(keyOf(path)).catch(() => null);
      if (response?.ok && response.type === 'basic') await save(cache, path, response, files).catch(() => {});
    }
    event.source?.postMessage({type: 'astra-saved', release});
  })().catch(() => {}));
});

/** On each visit, looks for a newer release (one small request) and saves it in the background. */
function checkForUpdate() {
  return updating ??= (async () => {
    const release = await siteRelease();
    const state = await readState();
    if (!release || release === state.current) return;
    await saveRelease(release, state.current);
    if (!(await caches.has(PREFIX + release))) return; // deleted meanwhile (a newer worker took over)
    // Saved whole: from now on new pages open on it; pages still open keep theirs and are told.
    const done = await change(s => ({...s, current: release, previous: s.current === release ? s.previous : s.current}));
    await tidy(done);
    for (const client of await self.clients.matchAll({type: 'window'}))
      if ((known.get(client.id) ?? done.clients[client.id]?.release) !== release) client.postMessage({type: 'astra-updated'});
  })().catch(() => {}).finally(() => { updating = null; });
}

/**
 * Saves `release` whole into its own cache: the files of the release in use
 * and the new release's own app files. Throws (leaving the new cache unused)
 * when a file cannot be fetched or is not the new release's.
 */
async function saveRelease(release, current) {
  const files = await listOf(release);
  const before = current && await knownList(current);
  const from = current && await caches.has(PREFIX + current) ? await caches.open(PREFIX + current) : null;
  if (!files) await caches.delete(PREFIX + release); // nothing to check a cut-short try's files against
  const to = await caches.open(PREFIX + release);
  const paths = new Set();
  for (const request of from ? await from.keys() : []) { const path = pathOf(request.url); if (path) paths.add(path); }
  for (const path of Object.keys(files || {})) if (whole(path)) paths.add(path);
  for (const path of paths) {
    if (files && !(path in files)) continue; // not in the new release
    if (files && await to.match(keyOf(path))) continue; // saved by a try that was cut short (checked then)
    const old = files && before?.[path] === files[path] && await from?.match(keyOf(path), {ignoreSearch: true});
    if (old) { await to.put(keyOf(path), old); continue; }
    const response = await fetch(keyOf(path), {cache: 'no-cache'});
    if (response.status === 404 && !files) continue;
    if (!response.ok || response.type !== 'basic') throw Error('incomplete');
    await save(to, path, response, files);
  }
}

/** Deletes every saved release but the current, the one before it and those open pages use. */
async function tidy(state) {
  const keep = new Set([state.current, state.previous, ...Object.values(state.clients).map(c => c.release)].filter(Boolean));
  for (const name of await caches.keys())
    if (name.startsWith(PREFIX) && !keep.has(name.slice(PREFIX.length))) await caches.delete(name);
  const kept = await caches.open(STATE);
  for (const request of await kept.keys()) {
    const release = new URL(request.url).pathname.split('/files/')[1];
    if (release && !keep.has(release)) { await kept.delete(request); lists.delete(release); }
  }
}
