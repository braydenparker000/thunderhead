// The ported player's data move (P5, MIGRATION.md §7 step 5), inside its own service worker
// (music/sw.js loads this with importScripts). The player is unchanged: it still addresses its
// library by the old Worker's URLs (`…/music/library.json`, `…/music/library/{audio,art,waveform}/<id>`),
// and its offline copies and song heads stay keyed by them. This worker answers those requests
// from the new Worker instead, with the owner's session on this site:
// - the catalog from GET /v1/music/catalog (kept here with its ETag, so an unchanged one costs a 304);
// - audio and art by a signed link straight from the bucket (POST /v1/media/sign, kept until 20 min
//   before it expires, signed again on a 403); the bytes never pass through the Worker;
// - a waveform from GET /v1/music/waveforms/:id, as the bytes the player expects.
// Until the new Worker can answer (signed out, no catalog imported yet, no signing key, the bucket
// not open to this site), the request goes to the old Worker as before, and the new one is asked
// again 5 minutes later. A framed copy of the player never gets the owner's session.
// Classic script, no imports: it runs in a classic worker. The player's worker names the old
// Worker's origin (`use`); this file names no outside host. Text never reaches a log.
(() => {
  let OLD = '';
  const PATH = /^\/music\/library(?:\.json|\/(audio|art|waveform)\/(r2_[A-Za-z0-9_-]{10,200}))$/;
  const CATALOG_CACHE = 'th-music-catalog';
  const CATALOG_KEY = '/music/th-catalog.json';
  const RETRY_MS = 5 * 60_000;
  const RESIGN_MS = 20 * 60_000;
  const PASS = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified'];
  /** "The new Worker can't answer yet": fall back, and ask again later. */
  const NOT_READY = Symbol('not ready');

  const deps = {
    fetch: (...a) => fetch(...a),
    caches: () => self.caches,
    now: () => Date.now(),
    /** The owner's session on this site, or null (IndexedDB `th-auth`, as the shell keeps it). */
    token: () =>
      new Promise((resolve) => {
        let req;
        try {
          req = indexedDB.open('th-auth');
        } catch {
          return resolve(null);
        }
        // No such database: signed out. Never create it here.
        req.onupgradeneeded = () => req.transaction.abort();
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const get = db.transaction('kv', 'readonly').objectStore('kv').get('session');
            get.onsuccess = () => {
              db.close();
              resolve(typeof get.result?.token === 'string' ? get.result.token : null);
            };
            get.onerror = () => {
              db.close();
              resolve(null);
            };
          } catch {
            db.close();
            resolve(null);
          }
        };
      }),
    /** The API's origin from this site's config.js (written at deploy), or ''. */
    api: async () => {
      const text = await (await fetch('/config.js', { cache: 'no-cache' })).text();
      const m = /CONFIG = (\{.*\});/.exec(text);
      return m ? String(JSON.parse(m[1]).api || '') : '';
    },
    topLevel: async (event) => {
      if (!event?.clientId) return true;
      const c = await self.clients.get(event.clientId);
      return !c || c.frameType === 'top-level';
    },
  };

  let offUntil = 0;
  let api = null;
  const links = new Map();

  const handles = (url) => !!OLD && url.origin === OLD && PATH.test(url.pathname);

  async function sign(base, token, ref, again) {
    const had = links.get(ref);
    if (!again && had && had.expires_at - deps.now() > RESIGN_MS) return had.url;
    const r = await deps.fetch(`${base}/v1/media/sign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: [ref] }),
    });
    if (r.status !== 200) throw NOT_READY;
    const body = await r.json();
    const item = body.items?.[0];
    if (!item) {
      if (body.errors?.[0]?.code === 'not_found') return null;
      throw NOT_READY;
    }
    links.set(ref, item);
    return item.url;
  }

  const copy = (r, status = r.status) => {
    const headers = new Headers();
    for (const h of PASS) if (r.headers.get(h) !== null) headers.set(h, r.headers.get(h));
    return new Response(r.body, { status, headers });
  };

  async function catalog(base, token) {
    const cache = await deps.caches().open(CATALOG_CACHE);
    const had = await cache.match(CATALOG_KEY);
    const headers = { Authorization: `Bearer ${token}` };
    if (had?.headers.get('ETag')) headers['If-None-Match'] = had.headers.get('ETag');
    const r = await deps.fetch(`${base}/v1/music/catalog`, { headers });
    if (r.status === 304 && had) return copy(had, 200);
    if (r.status !== 200) {
      if (r.status === 401 || r.status === 403 || r.status === 409 || r.status === 503) throw NOT_READY;
      throw new Error('catalog');
    }
    const keep = new Response(await r.arrayBuffer(), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: r.headers.get('ETag') ?? '' },
    });
    await cache.put(CATALOG_KEY, keep.clone());
    return copy(keep);
  }

  async function waveform(base, token, id) {
    const r = await deps.fetch(`${base}/v1/music/waveforms/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 404) return new Response(null, { status: 404 });
    if (r.status !== 200) throw NOT_READY;
    const { bars } = await r.json();
    const bytes = Uint8Array.from(atob(bars), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
  }

  async function media(req, base, token, id, art) {
    const ref = `music:${id}${art ? '#art' : ''}`;
    const headers = {};
    for (const h of ['Range', 'If-Range']) if (req.headers.get(h)) headers[h] = req.headers.get(h);
    let url = await sign(base, token, ref, false);
    if (!url) return new Response(null, { status: 404 });
    let r;
    try {
      r = await deps.fetch(url, { headers, mode: 'cors', credentials: 'omit' });
      // An expired link (a paused song past its hour): sign once more.
      if (r.status === 403) {
        url = await sign(base, token, ref, true);
        if (!url) return new Response(null, { status: 404 });
        r = await deps.fetch(url, { headers, mode: 'cors', credentials: 'omit' });
      }
    } catch {
      // The bucket refused this site (no CORS rule yet, SETUP.md N2) or the network failed.
      throw NOT_READY;
    }
    if (r.status === 403) throw NOT_READY;
    return copy(r);
  }

  async function fromNew(req) {
    const url = new URL(req.url);
    const m = PATH.exec(url.pathname);
    const token = await deps.token();
    if (!token) throw NOT_READY;
    api ??= await deps.api();
    if (!api) throw NOT_READY;
    if (!m[1]) return catalog(api, token);
    if (m[1] === 'waveform') return waveform(api, token, m[2]);
    return media(req, api, token, m[2], m[1] === 'art');
  }

  /** The answer to one of the player's library requests. */
  async function answer(req, event) {
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.search || !PATH.test(url.pathname)) return deps.fetch(req);
    if (deps.now() >= offUntil && (await deps.topLevel(event))) {
      try {
        return await fromNew(req);
      } catch (e) {
        if (e === NOT_READY) offUntil = deps.now() + RETRY_MS;
      }
    }
    return deps.fetch(req);
  }

  self.thMusicBridge = {
    /** The origin the player addresses its library on (the old Worker's). */
    use: (origin) => {
      OLD = new URL(origin).origin;
    },
    handles,
    answer,
    deps,
    reset: () => {
      offUntil = 0;
      api = null;
      links.clear();
    },
  };
})();
