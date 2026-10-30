// The one service worker of the shell, scope / (ARCHITECTURE.md §8). stage.mjs writes the build
// number into BUILD; each release is precached whole into the cache th-<BUILD> from
// /precache.json, and a new worker waits until the shell says it is a safe moment (§8.3).
// Never touched: the API and every other host, the ported app folders and /assets/ (they keep
// their own service workers), and anything that is not a GET. It also shows Web Push notifications.
const BUILD = 0;
const CACHE = `th-${BUILD}`;
const VENDOR = 'th-vendor';
/** Ported apps (P1b) and the old shared files: their own documents, never intercepted. */
const PORTED = ['/music/', '/guitar/', '/podcasts/', '/astra/', '/media/', '/assets/'];
/** Shell routes: a navigation to one of them gets the cached shell (their stubs equal index.html). */
const SHELL = ['/', '/settings/', '/settings/password/', '/settings/agents/', '/settings/devices/', '/settings/memory/'];
/** Read from the network first (3 s), the cache only when offline. */
const FRESH = ['/release.json', '/config.js'];

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
  if (req.mode === 'navigate') { event.respondWith(page(req, path)); return; }
  if (FRESH.includes(path)) { event.respondWith(fresh(req, path)); return; }
  if (path.startsWith('/vendor/')) { event.respondWith(vendor(req)); return; }
  event.respondWith(cached(req, path));
});

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
  const asked = new URL(event.notification.data?.url || '/', self.location.origin);
  const url = asked.origin === self.location.origin ? asked.href : `${self.location.origin}/`;
  event.waitUntil((async () => {
    const open = (await self.clients.matchAll({ type: 'window' })).find((c) => new URL(c.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(url);
    await open.focus();
    if (open.url !== url) await open.navigate(url).catch(() => {});
  })());
});

/** The session's token from IndexedDB `th-auth`, as the shell keeps it; null when signed out. */
function session() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open('th-auth');
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const get = db.transaction('kv', 'readonly').objectStore('kv').get('session');
        get.onsuccess = () => resolve(typeof get.result?.token === 'string' ? get.result.token : null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      } finally {
        db.close();
      }
    };
  });
}

/** The API's address from this site's config.js (written at deploy), or ''. */
async function apiOrigin() {
  const text = await (await fetch('/config.js', { cache: 'no-cache' })).text();
  const m = /CONFIG = (\{.*\});/.exec(text);
  return m ? String(JSON.parse(m[1]).api || '') : '';
}
