// The one service worker of the shell, scope / (ARCHITECTURE.md §8). stage.mjs writes the build
// number into BUILD; each release is precached whole into the cache th-<BUILD> from
// /precache.json (which leaves out labs, vendor/ and Photos' RAW engine: site-config.mjs; a file the release
// before has with the same hash is copied from its cache, not fetched), and a new worker waits until the shell says it is a safe moment (§8.3).
// Never touched: the API and every other host, the ported app folders and /assets/ (they keep
// their own service workers), /repair/, and anything that is not a GET. It also shows Web Push notifications
// and finishes Photos' background uploads, makes Photos' editor cross-origin isolated (`isolate`), and sends the
// editor's reports (th/report/send.js).
const BUILD = 0;
const CACHE = `th-${BUILD}`;
const VENDOR = 'th-vendor';
/** Ported apps (P1b) and the old shared files: their own documents, never intercepted. */
const PORTED = ['/music/', '/guitar/', '/podcasts/', '/astra/', '/media/', '/assets/'];
/** Shell routes: a navigation to one of them gets the cached shell (their stubs equal index.html). */
const SHELL = ['/', '/settings/', '/settings/password/', '/settings/agents/', '/settings/devices/', '/settings/memory/', '/share/'];
/** Read from the network first (3 s), the cache only when offline. config.js is not: the same deploy writes it
 * into the release's precache, so it comes from the release's cache like every other file and a start never
 * waits on the network for it (the update check is sw.js itself, `registration.update()`, th/update.js). */
const FRESH = ['/release.json'];
/** Photos' editor (`/photos/?edit=`) and the LightCraft, engine and editor test pages (`/lab/lightcraft/`, `/lab/engine/`, `/lab/editor/` and its compare page) are cross-origin isolated so their
 * RAW engines can run threads (PHOTOS.md, the isolation shim; SECURITY.md; engine/lightcraft-web/README.md): the page gets
 * COOP and COEP, and the workers it starts (the engine's) COEP. Nothing else does: the Drive picker's frame
 * (docs.google.com sends no COEP) only ever opens on Photos' other places. */
const EDITOR = (/** @type {URL} */ url) => (url.pathname === '/photos/' && url.searchParams.has('edit')) || url.pathname === '/lab/lightcraft/' || url.pathname === '/lab/engine/' || url.pathname === '/lab/editor/' || url.pathname === '/lab/editor/compare/';
const ENGINE_WORKERS = /^\/(apps\/photos\/edit|photos\/engine|lab\/lightcraft|lab\/engine)\//;

// The editor's reports go from here (th/report/send.js): when a page asks, and on the browser's own retries (sync).
try { importScripts('/th/report/fields.js', '/th/report/send.js'); } catch { /* a release without them */ }
const report = () => (self.thReportSend ? self.thReportSend().then((r) => { if (r.why === 'not sent') throw new Error('to be tried again'); return r; }) : Promise.resolve(null));
self.addEventListener('sync', (event) => { if (event.tag === 'th-report') event.waitUntil(report()); });
// The phone's data meter (th/data/worker.js): what this worker fetches is counted from its headers and posted to a
// page, a release's files as Updates, everything else by its path (Settings › Data use).
try { importScripts('/th/data/worker.js'); } catch { /* a release without it */ }
/** fetch, counted. @param {RequestInfo} req @param {RequestInit} [init] @param {string} [id] the part, else by its path */
async function net(req, init, id) {
  const r = await fetch(req, init);
  self.thData?.count(id ?? self.thData.partOf(new URL(typeof req === 'string' ? req : req.url, self.location.href).pathname), r);
  return r;
}

const LIST = '/precache.json';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await net(LIST, { cache: 'no-store' }, 'updates');
    if (!res.ok) throw new Error(`precache.json: ${res.status}`);
    const { build, files } = await res.clone().json();
    // A worker never caches a release other than its own (a deploy still uploading).
    if (build !== BUILD) throw new Error(`precache.json is build ${build}, this worker is ${BUILD}`);
    const cache = await caches.open(CACHE);
    // The newest release before kept whole (its list, put last, says so): a file with the same path and hash is
    // copied from it once its bytes are the listed size; everything else comes from the network.
    const old = (await caches.keys()).filter((n) => /^th-\d+$/.test(n) && n !== CACHE).sort((a, b) => Number(b.slice(3)) - Number(a.slice(3)));
    let from = '', had = new Map();
    for (const n of old) {
      const l = await caches.match(LIST, { cacheName: n });
      if (l) { from = n; had = new Map((await l.json()).files.map((f) => [f.path, f.hash])); break; }
    }
    // Every file fetched is checked against its staged size, so a half-uploaded release fails the
    // install and the old worker keeps serving the old release whole.
    await Promise.all(files.map(async ({ path, size, hash }) => {
      let r = hash && had.get(path) === hash ? await caches.match(`/${path}`, { cacheName: from }) : undefined;
      if (r && (await r.clone().arrayBuffer()).byteLength !== size) r = undefined;
      if (!r) {
        r = await net(`/${path}`, { cache: 'reload' }, 'updates');
        const body = await r.clone().arrayBuffer();
        if (!r.ok || body.byteLength !== size) throw new Error(`/${path}: ${r.status}, ${body.byteLength} of ${size} bytes`);
      }
      await cache.put(`/${path}`, r);
    }));
    await cache.put(LIST, res);   // last: its being there says the release is whole
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only older releases go; th-vendor and the caches apps make (offline audio, PDFs) stay.
    for (const name of await caches.keys()) if (/^th-\d+$/.test(name) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skipWaiting') self.skipWaiting();
  if (event.data?.type === 'report-send') event.waitUntil(report().catch(() => null));
  // The editor asks, each time it opens with a signal, to be kept for when there is none.
  if (event.data?.type === 'keepEditor') event.waitUntil(keepEditor().then((r) => r, (e) => ({ kept: false, fetched: 0, why: String(e?.message || e) })).then((r) => event.source?.postMessage({ type: 'editorKept', build: BUILD, ...r })));
});

// The new editor with no signal. Its files (lab/editor/, lab/engine/: 13 MB, most of it the RAW decoder) are not
// precached: every release would fetch them again on every phone. Once the editor has been opened with a
// signal they are kept in th-lab-<BUILD> from /lab/offline.json, which lists each with its size and a hash, so
// a later release fetches only the files that changed and takes the rest from the release before. With no
// signal the editor opens from what is kept, even when that is an older release's (whole, so its files agree).
const LAB = /^\/lab\/(editor|engine)\//, LAB_LIST = '/lab/offline.json', LAB_CACHE = /^th-lab-\d+$/;
/** The newest release whose editor is kept whole, as its cache's name, or ''. */
async function keptLab() {
  const names = (await caches.keys()).filter((n) => LAB_CACHE.test(n)).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
  for (const n of names) if (await caches.match(LAB_LIST, { cacheName: n })) return n;
  return '';
}
async function keepEditor() {
  const name = `th-lab-${BUILD}`;
  if (await caches.match(LAB_LIST, { cacheName: name })) return { kept: true, fetched: 0 };
  const res = await net(LAB_LIST, { cache: 'no-store' }, 'photos');
  if (!res.ok) throw new Error(`${LAB_LIST}: ${res.status}`);
  const list = await res.clone().json();
  if (list.build !== BUILD) throw new Error(`the list is release ${list.build}, this worker is ${BUILD}`);
  const old = await keptLab(), had = old ? await (await caches.match(LAB_LIST, { cacheName: old })).json() : { files: [] };
  const same = new Map(had.files.map((f) => [f.path, f.hash])), cache = await caches.open(name);
  let fetched = 0;
  for (const f of list.files) {
    const key = `/${f.path}`;
    let r = old && same.get(f.path) === f.hash ? await caches.match(key, { cacheName: old }) : undefined;
    if (!r) {
      r = await net(key, { cache: 'reload' }, 'photos');
      const size = (await r.clone().arrayBuffer()).byteLength;
      if (!r.ok || size !== f.size) throw new Error(`${key}: ${r.status}, ${size} of ${f.size} bytes`);
      fetched += size;
    }
    await cache.put(key, r);
  }
  await cache.put(LAB_LIST, res);   // last: its being there says the rest is whole
  for (const n of await caches.keys()) if (LAB_CACHE.test(n) && n !== name) await caches.delete(n);
  return { kept: true, fetched };
}
/** Just after a release, until this release's editor is kept whole: which of its files are the kept release's own,
 * unchanged (the same hash in both lists). Read once from this release's list; a failure is asked again. */
let carried = /** @type {Promise<{ name: string, same: Set<string> } | null> | null} */ (null);
const carry = () => (carried ||= (async () => {
  const name = await keptLab();
  if (!name || name === `th-lab-${BUILD}`) return null;
  const res = await net(LAB_LIST, { cache: 'no-store' }, 'photos'), list = res.ok ? await res.json() : null;
  if (list?.build !== BUILD) return null;
  const had = await (await caches.match(LAB_LIST, { cacheName: name })).json(), old = new Map(had.files.map((f) => [f.path, f.hash]));
  return { name, same: new Set(list.files.filter((f) => old.get(f.path) === f.hash).map((f) => `/${f.path}`)) };
})().catch(() => null).then((c) => { if (!c) carried = null; return c; }));
/** One of the editor's files: this release's kept copy; else the kept release's, where the file did not change
 * (a release changes a few of them: the decoder and its threads' files, megabytes, need not come over the network
 * again each time); else the network; else (no signal) the newest kept. */
async function lab(req, path) {
  const key = path.endsWith('/') ? `${path}index.html` : path;
  const mine = await caches.match(key, { cacheName: `th-lab-${BUILD}` });
  if (mine) return mine;
  const c = await carry(), same = c?.same.has(key) ? await caches.match(key, { cacheName: c.name }) : undefined;
  if (same) return same;
  // (the keeping may have finished between those two looks: the kept release's cache is gone, and this release's is whole)
  const now = c?.same.has(key) ? await caches.match(key, { cacheName: `th-lab-${BUILD}` }) : undefined;
  if (now) return now;
  try {
    return await net(req);
  } catch (e) {
    const name = await keptLab(), hit = name && (await caches.match(key, { cacheName: name }));
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (PORTED.some((p) => path === p.slice(0, -1) || path.startsWith(p))) return;
  // Repair (repair/repair.js) must work when this worker's cached release does not: never answered here.
  if (path === '/repair' || path.startsWith('/repair/')) return;
  if (req.mode === 'navigate') { event.respondWith(EDITOR(url) ? isolate(LAB.test(path) ? lab(req, path) : page(req, path), true) : page(req, path)); return; }
  if (req.destination === 'worker' && ENGINE_WORKERS.test(path)) { event.respondWith(isolate(LAB.test(path) ? lab(req, path) : cached(req, path), false)); return; }
  if (FRESH.includes(path)) { event.respondWith(fresh(req, path)); return; }
  if (path.startsWith('/vendor/') || path.startsWith('/look/')) { event.respondWith(vendor(req)); return; }   // look/<hash>/: scripts/look-config.mjs
  event.respondWith(LAB.test(path) ? lab(req, path) : cached(req, path));
});

/** The same response with COEP (and COOP for a page) added. @param {Promise<Response>} pending @param {boolean} doc */
async function isolate(pending, doc) {
  const res = await pending;
  if (res.type === 'opaque' || res.type === 'opaqueredirect' || res.status < 200) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  if (doc) headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** The cached copy of a precached file, else the network. */
async function cached(req, path) {
  const hit = await caches.match(path, { cacheName: CACHE });
  return hit ?? net(req);
}

/** A navigation: shell routes get the shell; a precached page (/signin/) its own copy; anything
 * the release doesn't know (an app added later, a typo) goes to the network as usual. */
async function page(req, path) {
  const dir = path.endsWith('/') ? path : `${path}/`;
  const key = SHELL.includes(dir) ? '/index.html' : `${dir}index.html`;
  const hit = await caches.match(key, { cacheName: CACHE });
  if (hit) return hit;
  return net(req);
}

async function fresh(req, path) {
  try {
    const res = await net(req, { signal: AbortSignal.timeout(3000) });
    if (res.ok) (await caches.open(CACHE)).put(path, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(path, { cacheName: CACHE });
    if (hit) return hit;
    throw e;
  }
}

/** Vendor paths carry their version, so a cached copy never goes stale. */
async function vendor(req) {
  const cache = await caches.open(VENDOR);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await net(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

// Web Push (SECURITY.md §10): a push carries only a kind and an id; its words come from the API
// with this phone's own session, else a line that says nothing. Every push shows a notification;
// a tap opens its place on this site (Home, the device list) in an open window if there is one.
const PUSH_ID = /^[A-Za-z0-9_-]{8,64}$/;

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let msg = null;
    try {
      msg = event.data?.json() ?? null;
    } catch {}
    let words = { title: 'Thunderhead', body: 'Thunderhead has something for you.', url: '/' };
    try {
      const [token, api] = await Promise.all([session(), apiOrigin()]);
      if (token && api && PUSH_ID.test(msg?.id ?? '')) {
        const r = await fetch(`${api}/v1/push/items/${msg.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (r.ok) words = await r.json();
      }
    } catch {}
    await self.registration.showNotification(words.title, {
      body: words.body,
      tag: msg?.id,
      icon: '/ui/app-icon-192.png',
      data: { url: words.url },
    });
  })());
});

// The push service replaced or dropped this phone's subscription: subscribe again with the same key and send
// the new one to the Worker with this phone's session, as th/push/phone.js does, so pushes keep arriving.
self.addEventListener('pushsubscriptionchange', (event) => event.waitUntil((async () => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  const sub = event.newSubscription ?? (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
  const [token, api] = await Promise.all([session(), apiOrigin()]);
  if (!sub || !token || !api) return;
  const j = sub.toJSON();
  await fetch(`${api}/v1/push/subscription`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth } }),
    cache: 'no-store',
  });
})()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openAt(event.notification.data?.url || '/'));
});

/** A place on this site, in an open window if there is one. @param {string} at */
async function openAt(at) {
  const asked = new URL(at, self.location.origin);
  const url = asked.origin === self.location.origin ? asked.href : `${self.location.origin}/`;
  const open = (await self.clients.matchAll({ type: 'window' })).find((c) => new URL(c.url).origin === self.location.origin);
  if (!open) return self.clients.openWindow(url);
  await open.focus();
  if (open.url !== url) await open.navigate(url).catch(() => {});
}

// Background Fetch (PHOTOS.md §3.1, SECURITY.md §10): a photo's upload the Photos page handed to the
// browser, one PUT of the whole file to its Drive session. When it ends this worker sends the Worker
// the file's Drive id (nothing else) with this phone's session, says so in the notification (the
// file's name only) and tells an open Photos page. Drive's 308 (part of it) or a failure keeps the
// session for the page, which resumes it by range; a PATCH that did not go through keeps the id.
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

self.addEventListener('backgroundfetchsuccess', (event) => event.waitUntil(uploaded(event)));
self.addEventListener('backgroundfetchfail', (event) => event.waitUntil(notUploaded(event)));
self.addEventListener('backgroundfetchabort', (event) => event.waitUntil(notUploaded(event)));
self.addEventListener('backgroundfetchclick', (event) => event.waitUntil(openAt('/photos/')));

async function uploaded(event) {
  const id = event.registration.id;
  if (!PHOTO_ID.test(id)) return;
  let driveId = '';
  try {
    const [record] = await event.registration.matchAll();
    const res = await record?.responseReady;
    if (res && (res.status === 200 || res.status === 201)) driveId = String((await res.json())?.id ?? '');
  } catch {}
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(driveId)) return notUploaded(event);
  const kept = await kv('th-photos', 'readonly', (s) => s.get(`bg:${id}`));
  let photo = null;
  try {
    const [token, api] = await Promise.all([session(), apiOrigin()]);
    if (token && api) {
      const r = await fetch(`${api}/v1/photos/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ drive_id: driveId }),
        cache: 'no-store',
      });
      if (r.ok) photo = (await r.json()).photo ?? null;
    }
  } catch {}
  if (kept) await kv('th-photos', 'readwrite', (s) => (photo ? s.delete(`bg:${id}`) : s.put({ ...kept, drive_id: driveId }, `bg:${id}`)));
  await event.updateUI({ title: kept?.name ? `In Drive: ${kept.name}` : 'In Drive' }).catch(() => {});
  await tell({ type: 'photos:upload', id, state: photo ? 'done' : 'kept', photo });
}

async function notUploaded(event) {
  const id = event.registration.id;
  if (!PHOTO_ID.test(id)) return;
  const kept = await kv('th-photos', 'readonly', (s) => s.get(`bg:${id}`));
  if (kept) await kv('th-photos', 'readwrite', (s) => s.put({ ...kept, failed: true }, `bg:${id}`));
  if (event.type !== 'backgroundfetchabort') await event.updateUI({ title: kept?.name ? `Did not upload: ${kept.name}` : 'Did not upload' }).catch(() => {});
  await tell({ type: 'photos:upload', id, state: 'failed' });
}

/** A word to every open page of this site. @param {object} msg */
async function tell(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}

/** One request on a database's `kv` store as th/idb.js keeps it, never creating it; its result,
 * or null when there is none. @param {string} name @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest} run */
function kv(name, mode, run) {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(name);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const t = db.transaction('kv', mode);
        const r = run(t.objectStore('kv'));
        t.oncomplete = () => resolve(r.result ?? null);
        t.onerror = t.onabort = () => resolve(null);
      } catch {
        resolve(null);
      } finally {
        db.close();
      }
    };
  });
}

/** The session's token from IndexedDB `th-auth`, as the shell keeps it; null when signed out. */
async function session() {
  const s = await kv('th-auth', 'readonly', (store) => store.get('session'));
  return typeof s?.token === 'string' ? s.token : null;
}

/** The API's address from this site's config.js (written at deploy), or ''. */
async function apiOrigin() {
  const text = await (await fetch('/config.js', { cache: 'no-cache' })).text();
  const m = /CONFIG = (\{.*\});/.exec(text);
  return m ? String(JSON.parse(m[1]).api || '') : '';
}
