// The ported player's data move (P5, MIGRATION.md §7 step 5), inside its own service worker
// (music/sw.js loads this with importScripts). The player is unchanged: it still addresses its
// library by the old Worker's URLs (`…/music/library.json`, `…/music/library/{audio,art,waveform}/<id>`),
// and its offline copies and song heads stay keyed by them. This worker answers those requests
// from the new Worker instead, with the owner's session on this site:
// - the catalog from GET /v1/music/catalog (kept here with its ETag, so an unchanged one costs a 304);
// - audio and art by a signed link straight from the bucket (POST /v1/media/sign, kept until 20 min
//   before it expires, signed again on a 403); the bytes never pass through the Worker;
// - a waveform from GET /v1/music/waveforms/:id, as the bytes the player expects.
// The player's page names the next songs (a 'th-music-ahead' message, th/music/dj.js), and their
// links are signed together in one request before their turn, so a skip doesn't wait for one. A
// link asked for twice at once is signed once. The session is read again after a minute.
// Until the new Worker can answer (signed out, no catalog imported yet, no signing key, the bucket
// refusing a fresh link: a REFUSED status), the request goes to the old Worker as before, and the new
// one is asked again 5 minutes later. Nothing else ever goes to the old Worker (it lacks newer songs:
// its 404 would make the player skip). A network failure or a slow answer is tried once more with
// longer waits (a signature 8 s, a first byte 12 s; a link already signed is reused), then answered
// with a network error, which the player treats as a stall and tries again: within ANSWER_MS. A framed copy of the
// player never gets the owner's session, unless home opened that frame itself (the island,
// th/ported/frames.js: a one-time token home gives this worker before it opens the frame).
// Classic script: it runs in a classic worker, and loads frames.js the classic way. The player's worker names the old
// Worker's origin (`use`); this file names no outside host. Text never reaches a log.
(() => {
  // In the worker only (the tests evaluate this file without one).
  if (typeof importScripts === 'function') {
    try {
      importScripts('/th/ported/frames.js');
    } catch {}
  }
  let OLD = '';
  const PATH = /^\/music\/library(?:\.json|\/(audio|art|waveform)\/(r2_[A-Za-z0-9_-]{10,200}))$/;
  const CATALOG_CACHE = 'th-music-catalog';
  const CATALOG_KEY = '/music/th-catalog.json';
  const RETRY_MS = 5 * 60_000;
  const RESIGN_MS = 20 * 60_000;
  /** A signature, or the first byte of an answer (the bucket's, the catalog's, a waveform's), waits this long at most. */
  const UPSTREAM_MS = 4000;
  /** The one try again after a timeout or network failure (a slow connection): a signature, a first byte. */
  const SIGN_RETRY_MS = 8000;
  const BYTES_RETRY_MS = 12_000;
  /** The player hears a failure (a network error) or the answer starts within this: 4 s + 8 s to sign, then 12 s for the first byte. */
  const ANSWER_MS = UPSTREAM_MS + SIGN_RETRY_MS + BYTES_RETRY_MS;
  /** The session read from IndexedDB is used this long before it is read again. */
  const TOKEN_MS = 60_000;
  /** Refs in one POST /v1/media/sign (MUSIC_LIMITS.sign_refs in shared/contract/music.ts). */
  const SIGN_MAX = 50;
  /** The new Worker's answers that mean "not for this site yet": signed out, no catalog or key, not allowed. */
  const REFUSED = [401, 403, 409, 503];
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
    api: async (signal) => {
      const text = await (await fetch('/config.js', { cache: 'no-cache', signal })).text();
      const m = /CONFIG = (\{.*\});/.exec(text);
      return m ? String(JSON.parse(m[1]).api || '') : '';
    },
    /** Whether the request's page may have the session: top-level, or a frame home opened. */
    topLevel: async (event) => {
      if (!event?.clientId) return true;
      if (self.thFrames) return self.thFrames.trusted(event.clientId);
      const c = await self.clients.get(event.clientId);
      return !c || c.frameType === 'top-level';
    },
  };

  let offUntil = 0;
  /** The API's origin, as a promise (a failed read is tried again next time). */
  let api = null;
  /** The session, as a promise, and when it was read. */
  let token = null;
  let tokenAt = -Infinity;
  /** Signed links by ref: {url, expires_at}; and the answers on their way, by ref. */
  const links = new Map();
  const signing = new Map();

  const handles = (url) => !!OLD && url.origin === OLD && PATH.test(url.pathname);

  /** A signal that aborts after ms, or with `outer` (the player's own request). `done()` stops the clock. */
  function deadline(ms, outer) {
    const own = new AbortController();
    const timer = setTimeout(() => own.abort(new DOMException('No answer in time', 'TimeoutError')), ms);
    let signal = own.signal;
    if (outer && AbortSignal.any) signal = AbortSignal.any([outer, own.signal]);
    else if (outer) {
      if (outer.aborted) own.abort(outer.reason);
      else outer.addEventListener('abort', () => own.abort(outer.reason), { once: true });
    }
    return { signal, done: () => clearTimeout(timer) };
  }

  /** A fetch whose answer must start within ms; its body then streams as long as `outer` lives. */
  async function upstream(url, init, outer, ms = UPSTREAM_MS) {
    const d = deadline(ms, outer);
    try {
      return await deps.fetch(url, { ...init, signal: d.signal });
    } finally {
      d.done();
    }
  }

  /** p, or the reason `signal` aborts first (a wait that can't be aborted itself, kept within ANSWER_MS). */
  const within = (p, signal) =>
    Promise.race([p, new Promise((_, no) => (signal.aborted ? no(signal.reason) : signal.addEventListener('abort', () => no(signal.reason), { once: true })))]);

  const tokenOf = () => {
    if (deps.now() - tokenAt > TOKEN_MS) {
      tokenAt = deps.now();
      token = deps.token();
    }
    return token;
  };
  /** A refusal of the session (signed out elsewhere, expired): read it again next time. */
  const refused = (status) => {
    if (status === 401) tokenAt = -Infinity;
    return REFUSED.includes(status);
  };
  const apiOf = () => {
    if (!api) {
      const d = deadline(UPSTREAM_MS);
      const asked = (api = deps.api(d.signal).finally(d.done));
      asked.catch(() => api === asked && (api = null));
    }
    return api;
  };

  /** A link with more than RESIGN_MS left, or null. */
  const fresh = (ref) => {
    const had = links.get(ref);
    return had && had.expires_at - deps.now() > RESIGN_MS ? had : null;
  };

  /** One POST /v1/media/sign for refs. Each ref's link (null: no such file) waits in `signing` meanwhile. */
  function signMany(base, auth, refs, ms = UPSTREAM_MS) {
    const asked = (async () => {
      const r = await upstream(
        `${base}/v1/media/sign`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs }),
        },
        undefined,
        ms,
      );
      if (r.status !== 200) throw refused(r.status) ? NOT_READY : new Error('sign');
      const body = await r.json();
      for (const item of body.items ?? []) links.set(item.ref, item);
      return body;
    })();
    for (const ref of refs) {
      const one = asked.then((body) => {
        const item = body.items?.find((x) => x.ref === ref);
        if (item) return item;
        if (body.errors?.find((x) => x.ref === ref)?.code === 'not_found') return null;
        throw NOT_READY;
      });
      signing.set(ref, one);
      one.catch(() => {}).finally(() => signing.get(ref) === one && signing.delete(ref));
    }
    return asked;
  }

  /** A ref's link: the one kept, the one on its way, or a new one (`again`: always new) within ms. */
  async function sign(base, auth, ref, again, ms) {
    if (!again && fresh(ref)) return fresh(ref).url;
    if (again || !signing.has(ref)) signMany(base, auth, [ref], ms).catch(() => {});
    return (await signing.get(ref))?.url ?? null;
  }

  const copy = (r, status = r.status) => {
    const headers = new Headers();
    for (const h of PASS) if (r.headers.get(h) !== null) headers.set(h, r.headers.get(h));
    return new Response(r.body, { status, headers });
  };

  // Each takes the try's waits (`t`: first byte, sign) and the request's clock (`cap`, see answer()).
  async function catalog(base, auth, t, cap) {
    const cache = await deps.caches().open(CATALOG_CACHE);
    const had = await cache.match(CATALOG_KEY);
    const headers = { Authorization: `Bearer ${auth}` };
    if (had?.headers.get('ETag')) headers['If-None-Match'] = had.headers.get('ETag');
    const r = await upstream(`${base}/v1/music/catalog`, { headers }, cap.signal, t.bytes);
    // Its answer has started: the download takes as long as it takes.
    cap.done();
    if (r.status === 304 && had) return copy(had, 200);
    if (r.status !== 200) throw refused(r.status) ? NOT_READY : new Error('catalog');
    const keep = new Response(await r.arrayBuffer(), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: r.headers.get('ETag') ?? '' },
    });
    await cache.put(CATALOG_KEY, keep.clone());
    return copy(keep);
  }

  async function waveform(base, auth, id, t, cap) {
    const r = await upstream(`${base}/v1/music/waveforms/${id}`, { headers: { Authorization: `Bearer ${auth}` } }, cap.signal, t.bytes);
    if (r.status === 404) return new Response(null, { status: 404 });
    if (r.status !== 200) throw refused(r.status) ? NOT_READY : new Error('waveform');
    const { bars } = await r.json();
    const bytes = Uint8Array.from(atob(bars), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
  }

  async function media(req, base, auth, id, art, t, cap) {
    const ref = `music:${id}${art ? '#art' : ''}`;
    const headers = {};
    for (const h of ['Range', 'If-Range']) if (req.headers.get(h)) headers[h] = req.headers.get(h);
    // Never through the browser's HTTP cache: a read cut short (a skip, a head stopped) left part of a
    // range there, and the next read of it went out as a conditional request first (If-Range), one more
    // round trip before the first byte (MUSIC.md §6.1). Heads and offline copies keep what is kept.
    const get = (url) => upstream(url, { headers, mode: 'cors', credentials: 'omit', cache: 'no-store' }, cap.signal, t.bytes);
    let url = await within(sign(base, auth, ref, false, t.sign), cap.signal);
    if (!url) return new Response(null, { status: 404 });
    let r = await get(url);
    // An expired link (a paused song past its hour): sign once more. Refused again, the bucket isn't
    // open to this site (or the key is wrong). (Without its CORS rule, SETUP.md N2, it fails as a network would.)
    if (r.status === 403) {
      url = await within(sign(base, auth, ref, true, t.sign), cap.signal);
      if (!url) return new Response(null, { status: 404 });
      r = await get(url);
      if (r.status === 403) throw NOT_READY;
    }
    return copy(r);
  }

  async function fromNew(req, t, cap) {
    const url = new URL(req.url);
    const m = PATH.exec(url.pathname);
    const auth = await within(tokenOf(), cap.signal);
    if (!auth) throw NOT_READY;
    const base = await within(apiOf(), cap.signal);
    if (!base) throw NOT_READY;
    if (!m[1]) return catalog(base, auth, t, cap);
    if (m[1] === 'waveform') return waveform(base, auth, m[2], t, cap);
    return media(req, base, auth, m[2], m[1] === 'art', t, cap);
  }

  /** The two tries' waits: the first, then the one try again on a slow connection. */
  const TRIES = [
    { sign: UPSTREAM_MS, bytes: UPSTREAM_MS },
    { sign: SIGN_RETRY_MS, bytes: BYTES_RETRY_MS },
  ];

  /** The answer to one of the player's library requests. */
  async function answer(req, event) {
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.search || !PATH.test(url.pathname)) return deps.fetch(req);
    if (deps.now() >= offUntil && (await deps.topLevel(event))) {
      // The whole answer starts, or fails, within ANSWER_MS; once it has started its body streams on.
      const cap = deadline(ANSWER_MS, req.signal);
      try {
        for (const t of TRIES) {
          try {
            return await fromNew(req, t, cap);
          } catch (e) {
            // Only "not for this site yet" goes to the old Worker.
            if (e === NOT_READY) {
              offUntil = deps.now() + RETRY_MS;
              break;
            }
            // The player let go of the request: there is no one to answer.
            if (req.signal?.aborted) throw e;
            // Twice failed or slow: a network error, which the player waits out and tries again (a 404 would skip the song).
            if (t === TRIES.at(-1) || cap.signal.aborted) return Response.error();
          }
        }
      } finally {
        cap.done();
      }
    }
    return deps.fetch(req);
  }

  /** The next songs' links, signed in one request ahead of their turn (urls: the player's song addresses). */
  async function ahead(urls, source) {
    const ours = source?.frameType === 'top-level' || (!!self.thFrames && !!source?.id && (await self.thFrames.trusted(source.id)));
    if (!OLD || deps.now() < offUntil || !ours) return;
    const refs = [];
    for (const u of urls) {
      let url = null;
      try {
        url = new URL(u);
      } catch {}
      const m = url && handles(url) && PATH.exec(url.pathname);
      const ref = m?.[1] === 'audio' && `music:${m[2]}`;
      if (ref && !fresh(ref) && !signing.has(ref) && !refs.includes(ref)) refs.push(ref);
    }
    if (!refs.length) return;
    const auth = await tokenOf();
    const base = auth && (await apiOf());
    if (!base) return;
    await signMany(base, auth, refs.slice(0, SIGN_MAX)).catch((e) => {
      if (e === NOT_READY) offUntil = deps.now() + RETRY_MS;
    });
  }

  self.addEventListener?.('message', (e) => {
    if (e.data?.type !== 'th-music-ahead' || !Array.isArray(e.data.urls)) return;
    e.waitUntil?.(ahead(e.data.urls.slice(0, SIGN_MAX), e.source).catch(() => {}));
  });

  self.thMusicBridge = {
    /** The origin the player addresses its library on (the old Worker's). */
    use: (origin) => {
      OLD = new URL(origin).origin;
    },
    handles,
    answer,
    ahead,
    deps,
    reset: () => {
      offUntil = 0;
      api = null;
      tokenAt = -Infinity;
      links.clear();
      signing.clear();
    },
  };
})();
