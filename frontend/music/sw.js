// Service worker: keeps the app's own files available offline. Online they
// come from the network (the browser's HTTP cache revalidates them), so the
// page always runs one consistent version of its modules, the audio engine's
// worklet included; the copies kept here serve the app when the network
// fails. After a failure the copies serve at once for a while, so a bad
// network costs one wait per launch, not one per module. Covers and the
// library index are never cached here; they stay with the Worker and the
// page's own storage.
//
// Song heads (library/heads.js): the page keeps the first seconds of the next
// songs (and the end of an Ogg file, which the decoder reads for the length)
// in their own cache. A song's range request that a head or tail covers is
// answered from it, as much as it holds; the rest of the song comes from the
// network as usual. Requests a head does not cover are not touched, so the
// browser's own retries keep working.
// Each open asks the network for the site's release (th/music/release.js): the app's files of that
// release then come from the release's own cache at once, without a round trip each to ask whether
// they changed; the page itself, a new release, no signal or a cache error take the way described above.
// P5 data move (MIGRATION.md §7 step 5): the library's requests are answered from the new Worker. The old Worker's origin
// is only the name they and the offline copies carry: every request to it is answered here, none leaves the phone (§8).
importScripts('/th/music/bridge.js');
try { importScripts('/th/music/release.js'); } catch { /* without it, every file asks the network as before */ }
// Downloads (owner, 2026-11-26): songs, playlists and albums saved to the phone's Downloads, streamed from here; their
// route below. Loaded after the bridge, whose answer fetches each song.
try { importScripts('/th/music/downloads.js'); } catch { /* without it, Music says the download could not finish */ }
// The app's own files this worker fetches (its release's, and the network-first ones), counted as Music's app files in
// Settings › Data use by their headers (th/data/worker.js, loaded by the bridge); the answer itself is untouched.
const own = (req, init) => fetch(req, init).then(r => { self.thData?.count('music.app', r); return r; });
const release = self.thMusicRelease?.make({ fetch: own, caches });
self.thMusicBridge.use('https://jarvis-hub-api.braydenparker999.workers.dev');
const net = (req, e) => self.thMusicBridge.handles(new URL(req.url)) ? self.thMusicBridge.answer(req, e) : fetch(req);
const CACHE = 'claude-player-v1';
const HEADS = 'claude-player-heads';
// A network that answers nothing for this long counts as offline...
const NETWORK_MS = 3000;
// ...and for this long after a failure the copies serve without asking it.
const BAD_NETWORK_MS = 60000;
let badUntil = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './app.css', './manifest.webmanifest', './src/app.js'])).then(() => self.skipWaiting()));
});

// Only this worker's own older caches go: the site's other caches (the player's offline music copies
// and covers, other apps' downloads) share the origin.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^claude-player-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// The heads kept, by song URL: {head, tailStart, total, type} (bytes). From the page's messages, and
// from the heads cache's index when the worker starts. Chrome stops an idle worker and starts it again
// for the next request (a skip minutes into a song): range requests wait for the index, a few ms.
let heads = new Map(), told = false, headsKnown = false;
const HEADS_INDEX = new URL('heads-index.json', self.registration.scope).href;
const headsLoaded = (async () => {
  try { const list = await (await (await caches.open(HEADS)).match(HEADS_INDEX))?.json(); if (Array.isArray(list) && !told) heads = new Map(list); } catch { /* none yet */ }
  headsKnown = true;
})();
// (The page's 'ping' every 20 s while in use needs no answer: a message keeps the worker from being stopped.)
self.addEventListener('message', e => { if (e.data?.type === 'heads' && Array.isArray(e.data.list)) { heads = new Map(e.data.list); told = headsKnown = true; } });

/** The part of a song's range request its head or tail covers: [start, end or null], or null. */
function covered(req) {
  const h = heads.get(req.url), range = h && /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (!range) return null;
  const a = +range[1], b = range[2] ? +range[2] : null;
  return a < h.head || (a >= h.tailStart && a < h.total) ? [h, a, b] : null;
}

/** A song's byte range from its head or tail: 206 with what they hold of it (gone from storage: the network's). */
async function fromHead(req, h, a, b, e) {
  const url = req.url, tail = a >= h.tailStart;
  const stored = await caches.open(HEADS).then(c => c.match(tail ? url + (url.includes('?') ? '&' : '?') + 'cp-tail' : url)).catch(() => null);
  const bytes = stored && new Uint8Array(await stored.arrayBuffer()), base = tail ? h.tailStart : 0;
  if (!bytes || a - base >= bytes.length) { heads.delete(url); return net(req, e); }
  const end = Math.min(b ?? h.total - 1, base + bytes.length - 1);
  return new Response(bytes.slice(a - base, end - base + 1), {status: 206, headers: {
    'Content-Type': h.type || 'application/octet-stream', 'Content-Range': `bytes ${a}-${end}/${h.total}`,
    'Content-Length': String(end - a + 1), 'Accept-Ranges': 'bytes',
  }});
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // A download the page asked for (th/music/downloads.js): its file, streamed.
  if (self.thMusicDownloads?.handles(url)) { e.respondWith(self.thMusicDownloads.answer(e)); return; }
  // An open of the player (its page, or home's frame of it): which release is live, asked now.
  if (req.mode === 'navigate' && url.origin === self.location.origin) release?.check();
  // A song's range request that its head or tail covers.
  if (req.method === 'GET' && req.headers.has('range')) {
    if (!headsKnown) { e.respondWith(headsLoaded.then(() => { const c = covered(req); return c ? fromHead(req, ...c, e) : net(req, e); })); return; }
    const c = covered(req);
    if (c) { e.respondWith(fromHead(req, ...c, e)); return; }
  }
  if (self.thMusicBridge.handles(url)) { e.respondWith(self.thMusicBridge.answer(req, e)); return; }
  // Only same-origin GETs of the app itself; never media or range requests.
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  // The site's shared files the player loads (th/, assets/, ui/, config.js): from the release's cache too, else
  // the network exactly as without this worker (they have no offline copies here).
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname) && /^\/(th|assets|ui)\/[^?]*\.js$|^\/config\.js$/.test(url.pathname) && !/^\/th\/music\/(dj|dj-tags|search|ratings)\.js$/.test(url.pathname)) {
    if (release && Date.now() >= badUntil) e.respondWith(release.answer(req).catch(() => null).then(r => r ?? (noRelease(), own(req))));
    return;
  }
  // The DJ shuffle's planner (with the tags it reads), the better search and the ratings (th/music/dj.js, dj-tags.js, search.js, ratings.js) are part of the app, offline too.
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname) && !/^\/th\/music\/(dj|dj-tags|search|ratings)\.js$/.test(url.pathname)) return;
  const keep = (r, res) => { caches.open(CACHE).then(c => c.put(r, res)).catch(() => {}); };
  // (After a network failure the offline copies answer at once, as before: the release is not asked.)
  e.respondWith((release && Date.now() >= badUntil ? release.answer(req, keep) : Promise.resolve(null)).catch(() => null).then(r => r ?? (noRelease(), appFile(req))));
});

/** No answer from the release: when the network gave none (no signal, or none in time), the offline copies
 * answer at once for a while, as after any network failure, so a weak signal waits once, not twice. */
function noRelease() {
  if (release?.down() && Date.now() >= badUntil) badUntil = Date.now() + BAD_NETWORK_MS;
}

/** One of the app's files: the network within NETWORK_MS, else the copy kept for offline. */
function appFile(req) {
  return caches.open(CACHE).then(async cache => {
    if (Date.now() < badUntil) {
      const copy = await cache.match(req);
      if (copy) return copy;
    }
    // The request goes as it came (a navigation cannot be re-made with options).
    const network = own(req).then(r => { if (r.ok && r.type === 'basic') cache.put(req, r.clone()); return r; });
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(resolve, NETWORK_MS, null); });
    try {
      const r = await Promise.race([network, late]);
      if (r) return r;
    } catch { /* offline */ } finally {
      clearTimeout(timer);
    }
    badUntil = Date.now() + BAD_NETWORK_MS;
    return (await cache.match(req)) ?? network.catch(() => Response.error());
  });
}
