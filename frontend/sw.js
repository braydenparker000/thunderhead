// The one service worker of the shell, scope / (ARCHITECTURE.md §8). stage.mjs writes the build
// number into BUILD; each release is precached whole into the cache th-<BUILD> from
// /precache.json (which leaves out labs, vendor/ and Photos' RAW engine: site-config.mjs), and a new worker waits until the shell says it is a safe moment (§8.3).
// Never touched: the API and every other host, the ported app folders and /assets/ (they keep
// their own service workers), and anything that is not a GET. It also shows Web Push notifications
// and finishes Photos' background uploads, and makes Photos' editor cross-origin isolated (`isolate`).
const BUILD = 0;
const CACHE = `th-${BUILD}`;
const VENDOR = 'th-vendor';
/** Ported apps (P1b) and the old shared files: their own documents, never intercepted. */
const PORTED = ['/music/', '/guitar/', '/podcasts/', '/astra/', '/media/', '/assets/'];
/** Shell routes: a navigation to one of them gets the cached shell (their stubs equal index.html). */
const SHELL = ['/', '/settings/', '/settings/password/', '/settings/agents/', '/settings/devices/', '/settings/memory/', '/share/'];
/** Read from the network first (3 s), the cache only when offline. */
const FRESH = ['/release.json', '/config.js'];
/** Photos' editor (`/photos/?edit=`) and the LightCraft test page (`/lab/lightcraft/`) are cross-origin isolated so their
 * RAW engines can run threads (PHOTOS.md, the isolation shim; SECURITY.md; engine/lightcraft-web/README.md): the page gets
 * COOP and COEP, and the workers it starts (the engine's) COEP. Nothing else does: the Drive picker's frame
 * (docs.google.com sends no COEP) only ever opens on Photos' other places. */
const EDITOR = (/** @type {URL} */ url) => (url.pathname === '/photos/' && url.searchParams.has('edit')) || url.pathname === '/lab/lightcraft/';
const ENGINE_WORKERS = /^\/(apps\/photos\/edit|photos\/engine|lab\/lightcraft)\//;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/precache.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`precache.json: ${res.status}`);
    const { build, files } = await res.json();
    // A worker never caches a release other than its own (a deploy still uploading).
    if (build !== BUILD) throw new Error(`precache.json is build ${build}, this worker is ${BUILD}`);
    const cache = await caches.open(CACHE);
    // Every file is checked against its staged size, so a half-uploaded release fails the
    // install and the old worker keeps serving the old release whole.
    await Promise.all(files.map(async ({ path, size }) => {
      const r = await fetch(`/${path}`, { cache: 'reload' });
      const body = await r.clone().arrayBuffer();
      if (!r.ok || body.byteLength !== size) throw new Error(`/${path}: ${r.status}, ${body.byteLength} of ${size} bytes`);
      await cache.put(`/${path}`, r);
    }));
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
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (PORTED.some((p) => path === p.slice(0, -1) || path.startsWith(p))) return;
  if (req.mode === 'navigate') { event.respondWith(EDITOR(url) ? isolate(page(req, path), true) : page(req, path)); return; }
  if (req.destination === 'worker' && ENGINE_WORKERS.test(path)) { event.respondWith(isolate(cached(req, path), false)); return; }
  if (FRESH.includes(path)) { event.respondWith(fresh(req, path)); return; }
  if (path.startsWith('/vendor/')) { event.respondWith(vendor(req)); return; }
  event.respondWith(cached(req, path));
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
  return hit ?? fetch(req);
}

/** A navigation: shell routes get the shell; a precached page (/signin/) its own copy; anything
 * the release doesn't know (an app added later, a typo) goes to the network as usual. */
async function page(req, path) {
  const dir = path.endsWith('/') ? path : `${path}/`;
  const key = SHELL.includes(dir) ? '/index.html' : `${dir}index.html`;
  const hit = await caches.match(key, { cacheName: CACHE });
  if (hit) return hit;
  return fetch(req);
}

async function fresh(req, path) {
  try {
    const res = await fetch(req, { signal: AbortSignal.timeout(3000) });
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
  const res = await fetch(req);
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
