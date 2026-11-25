// The ported player's data move (P5, MIGRATION.md §7 step 5), inside its own service worker
// (music/sw.js loads this with importScripts). The player is unchanged: it still addresses its
// library by the old Worker's URLs (`…/music/library.json`, `…/music/library/{audio,art,waveform}/<id>`),
// and its offline copies and song heads stay keyed by them. This worker answers those requests
// from the new Worker instead, with the owner's session on this site:
// - the catalog from GET /v1/music/catalog (kept here with its ETag, so an unchanged one costs a 304,
//   and asked for `since` the copy kept, so a changed one comes as its changes, merged here);
// - audio and art by a signed link straight from the bucket (POST /v1/media/sign, kept until 20 min
//   before it expires, signed again on a 403); the bytes never pass through the Worker;
// - a waveform from GET /v1/music/waveforms/:id, as the bytes the player expects.
// The player's page names the next songs (a 'th-music-ahead' message, th/music/dj.js), and their
// links are signed together in one request before their turn, so a skip doesn't wait for one. A
// link asked for twice at once is signed once. The session is read again after a minute.
// No request ever goes to the old Worker (MIGRATION.md §8): its origin is only the name the player's
// addresses and offline copies carry. Every request to that origin is answered here. When the new
// Worker can't answer (signed out, no catalog imported yet, no signing key, the bucket refusing a
// fresh link: a REFUSED status), the player gets that refusal as it is, its status and plain words
// (`{error}`), never the old Worker's answer; any other address on that origin is a 404. A network failure or a slow answer is tried once more with
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
    // The phone's data meter (th/data/worker.js): what this worker fetches, counted from its headers.
    try {
      importScripts('/th/data/worker.js');
    } catch {}
  }
  let OLD = '';
  const PATH = /^\/music\/library(?:\.json|\/(audio|art|waveform)\/(r2_[A-Za-z0-9_-]{10,200}))$/;
  const CATALOG_CACHE = 'th-music-catalog';
  const CATALOG_KEY = '/music/th-catalog.json';
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
  /** "The new Worker can't answer yet", with its status: answered to the player as that refusal. */
  const notReady = (status) => ({ refused: status });
  /** The words for a refusal the player is given (COPY.md: plain, short). */
  const WORDS = { 401: 'Sign in to play your songs.', 403: "Your songs can't be reached right now.", 409: 'No songs yet.', 503: "Your songs can't be reached right now." };
  const refusalOf = (status) =>
    new Response(JSON.stringify({ error: WORDS[status] ?? WORDS[503] }), { status, headers: { 'Content-Type': 'application/json' } });
  /** An answer from the network, counted by its headers for the page that asked (th/data/worker.js). */
  const counted = (r, part, client) => (self.thData?.count(part, r, client), r);
  /** The same, but an answer with no size (the catalogue, compressed and streamed) is counted by the bytes read: use what it returns. */
  const measured = (r, part, client) => (self.thData?.read ? self.thData.read(part, r, client) : counted(r, part, client));

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

  /** The API's origin, as a promise (a failed read is tried again next time). */
  let api = null;
  /** The session, as a promise, and when it was read. */
  let token = null;
  let tokenAt = -Infinity;
  /** Signed links by ref: {url, expires_at}; and the answers on their way, by ref. */
  const links = new Map();
  const signing = new Map();

  /** Every request to the old Worker's origin is this worker's to answer (none leaves the phone). */
  const handles = (url) => !!OLD && url.origin === OLD;

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
      counted(r, 'music.rest');
      if (r.status !== 200) throw refused(r.status) ? notReady(r.status) : new Error('sign');
      const body = await r.json();
      for (const item of body.items ?? []) links.set(item.ref, item);
      return body;
    })();
    for (const ref of refs) {
      const one = asked.then((body) => {
        const item = body.items?.find((x) => x.ref === ref);
        if (item) return item;
        if (body.errors?.find((x) => x.ref === ref)?.code === 'not_found') return null;
        throw notReady(503);
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

  /** The kept catalog's `generatedAt`, kept beside it (never passed to the player): the `since` of the next ask. */
  const SINCE = 'TH-Generated';
  /** Where `generatedAt` is looked for: the head (version, kind, count, generatedAt come first), then the tail. */
  const HEAD = 4096;
  const TAIL = 512;
  const latin = (u8) => String.fromCharCode(...u8);
  const timeIn = (u8) => /"generatedAt":\s*"([^"]{1,64})"/.exec(latin(u8))?.[1] ?? '';
  const headOf = (buf) => latin(new Uint8Array(buf, 0, Math.min(buf.byteLength, HEAD)));
  /** A catalog's generatedAt, from its first bytes (or its last) without decoding the rest. */
  const generatedOf = (buf) => {
    const u8 = new Uint8Array(buf);
    return timeIn(u8.subarray(0, HEAD)) || timeIn(u8.subarray(Math.max(HEAD, u8.length - TAIL)));
  };
  const joined = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  /**
   * The generatedAt of a copy kept without it beside it (kept by the app before `since`): read from the
   * copy's own stream, its head and else its tail, holding no more than HEAD + TAIL bytes of it.
   */
  async function keptTime(r) {
    const reader = r?.body?.getReader();
    if (!reader) return '';
    let head = new Uint8Array(0);
    let tail = new Uint8Array(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (head.length < HEAD) {
          head = joined(head, value.subarray(0, HEAD - head.length));
          if (head.length === HEAD && timeIn(head)) return timeIn(head);
        }
        tail = value.length >= TAIL ? value.slice(-TAIL) : joined(tail, value).slice(-TAIL);
      }
      return timeIn(head) || timeIn(tail);
    } catch {
      return '';
    } finally {
      reader.cancel().catch(() => {});
    }
  }
  /**
   * The kept catalog (its text) with a delta merged in: changed tracks replaced by id, new ones appended
   * in the order given, removed ones dropped, its generatedAt and count the delta's. null when the kept
   * copy can't be read or the songs don't add up to `count`: the whole catalog is fetched again then.
   */
  function merged(text, delta) {
    let whole;
    try {
      whole = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(whole?.tracks) || !Array.isArray(delta?.tracks)) return null;
    const at = new Map(whole.tracks.map((t, i) => [t?.id, i]));
    for (const t of delta.tracks) {
      const i = at.get(t?.id);
      if (i === undefined) at.set(t?.id, whole.tracks.push(t) - 1);
      else whole.tracks[i] = t;
    }
    const gone = new Set(Array.isArray(delta.removed) ? delta.removed : []);
    if (gone.size) whole.tracks = whole.tracks.filter((t) => !gone.has(t?.id));
    if (whole.tracks.length !== delta.count) return null;
    whole.generatedAt = delta.generatedAt;
    whole.count = delta.count;
    return whole;
  }

  // Each takes the try's waits (`t`: first byte, sign) and the request's clock (`cap`, see answer()).
  // The catalog is asked for in changes: `since` the kept copy's generatedAt, with its ETag. The answer
  // is a 304, the whole catalog, or what changed since (`r2-library-delta`), merged here into the kept
  // copy; either way the player gets the whole catalog, as before.
  // One at a time: an ask waits until the one before it has kept its copy, then asks since that copy
  // (two at once would both ask for the whole catalog, and the one kept last decide what is kept).
  let keeping = Promise.resolve();
  async function catalog(base, auth, t, cap) {
    let release;
    const mine = new Promise((r) => (release = r));
    const turn = keeping;
    keeping = turn.then(() => mine);
    try {
      await within(turn, cap.signal);
      return await catalogNow(base, auth, t, cap);
    } finally {
      release();
    }
  }

  async function catalogNow(base, auth, t, cap) {
    const cache = await deps.caches().open(CATALOG_CACHE);
    const had = await cache.match(CATALOG_KEY);
    const ask = async (since, etag) => {
      const headers = { Authorization: `Bearer ${auth}` };
      if (etag) headers['If-None-Match'] = etag;
      const query = since ? `?since=${encodeURIComponent(since)}` : '';
      // Never through the browser's HTTP cache: the copy is kept here (not twice), and the browser must
      // not revalidate it on its own, with the ETag and without `since`.
      // Its own row in Settings › Data use (`music.catalog`), by the bytes read: it comes with no length.
      const r = measured(await upstream(`${base}/v1/music/catalog${query}`, { headers, cache: 'no-store' }, cap.signal, t.bytes), 'music.catalog', cap.client);
      // Its answer has started: the download takes as long as it takes.
      cap.done();
      return r;
    };
    // A copy kept without its time (by the app before `since`): read from its body, once (recorded below).
    const recorded = had?.headers.get(SINCE) ?? '';
    const since = had ? recorded || (await keptTime(await cache.match(CATALOG_KEY))) : '';
    const r = await ask(since, had?.headers.get('ETag'));
    if (r.status === 304 && had) {
      if (since && !recorded) {
        // Kept again with its time beside it, its body streamed from the cache (no copy in memory).
        const again = await cache.match(CATALOG_KEY);
        if (again) {
          const headers = new Headers(again.headers);
          headers.set(SINCE, since);
          await cache.put(CATALOG_KEY, new Response(again.body, { headers }));
        }
      }
      return copy(had, 200);
    }
    if (r.status !== 200) throw refused(r.status) ? notReady(r.status) : new Error('catalog');
    const buf = await r.arrayBuffer();
    let etag = r.headers.get('ETag') ?? '';
    let body = buf;
    let generated = generatedOf(buf);
    if (/"kind":\s*"r2-library-delta"/.test(headOf(buf))) {
      const whole = had && merged(await had.text(), await new Response(buf).json().catch(() => null));
      if (whole) {
        body = JSON.stringify(whole);
        generated = String(whole.generatedAt ?? '');
      } else {
        // Not mergeable: the whole catalog, without `since`, kept as it comes.
        const full = await ask('', '');
        if (full.status !== 200) throw refused(full.status) ? notReady(full.status) : new Error('catalog');
        body = await full.arrayBuffer();
        etag = full.headers.get('ETag') ?? '';
        generated = generatedOf(body);
      }
    }
    const keep = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: etag, [SINCE]: generated } });
    await cache.put(CATALOG_KEY, keep.clone());
    return copy(keep);
  }

  async function waveform(base, auth, id, t, cap) {
    const r = counted(await upstream(`${base}/v1/music/waveforms/${id}`, { headers: { Authorization: `Bearer ${auth}` } }, cap.signal, t.bytes), 'music.rest', cap.client);
    if (r.status === 404) return new Response(null, { status: 404 });
    if (r.status !== 200) throw refused(r.status) ? notReady(r.status) : new Error('waveform');
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
    const get = async (url) => counted(await upstream(url, { headers, mode: 'cors', credentials: 'omit', cache: 'no-store' }, cap.signal, t.bytes), art ? 'music.covers' : 'music.songs', cap.client);
    const signedAt = deps.now();
    let url = await within(sign(base, auth, ref, false, t.sign), cap.signal);
    // The signature's wait, for the player's report (0: signed ahead): music/src/player/song-net.js.
    const signMs = deps.now() - signedAt;
    if (!url) return new Response(null, { status: 404 });
    let r = await get(url);
    // An expired link (a paused song past its hour): sign once more. Refused again, the bucket isn't
    // open to this site (or the key is wrong). (Without its CORS rule, SETUP.md N2, it fails as a network would.)
    if (r.status === 403) {
      url = await within(sign(base, auth, ref, true, t.sign), cap.signal);
      if (!url) return new Response(null, { status: 404 });
      r = await get(url);
      if (r.status === 403) throw notReady(403);
    }
    const out = copy(r);
    out.headers.set('TH-Sign-Ms', String(signMs));
    return out;
  }

  async function fromNew(req, t, cap) {
    const url = new URL(req.url);
    const m = PATH.exec(url.pathname);
    const auth = await within(tokenOf(), cap.signal);
    if (!auth) throw notReady(401);
    const base = await within(apiOf(), cap.signal);
    if (!base) throw notReady(503);
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
    // Not a library file: there is nothing for it on that origin.
    if (req.method !== 'GET' || url.search || !PATH.test(url.pathname)) return new Response(null, { status: 404 });
    // A frame home didn't open never gets the session: to it, the owner is signed out.
    if (!(await deps.topLevel(event))) return refusalOf(401);
    // The whole answer starts, or fails, within ANSWER_MS; once it has started its body streams on.
    const cap = deadline(ANSWER_MS, req.signal);
    cap.client = event?.clientId;
    try {
      for (const t of TRIES) {
        try {
          return await fromNew(req, t, cap);
        } catch (e) {
          // "Not for this site yet": the refusal as it is.
          if (e?.refused) return refusalOf(e.refused);
          // The player let go of the request: there is no one to answer.
          if (req.signal?.aborted) throw e;
          // Twice failed or slow: a network error, which the player waits out and tries again (a 404 would skip the song).
          if (t === TRIES.at(-1) || cap.signal.aborted) return Response.error();
        }
      }
    } finally {
      cap.done();
    }
    return Response.error();
  }

  /** The next songs' links, signed in one request ahead of their turn (urls: the player's song addresses). */
  async function ahead(urls, source) {
    const ours = source?.frameType === 'top-level' || (!!self.thFrames && !!source?.id && (await self.thFrames.trusted(source.id)));
    if (!OLD || !ours) return;
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
    await signMany(base, auth, refs.slice(0, SIGN_MAX)).catch(() => {});
  }

  self.addEventListener?.('message', (e) => {
    if (e.data?.type !== 'th-music-ahead' || !Array.isArray(e.data.urls)) return;
    e.waitUntil?.(ahead(e.data.urls.slice(0, SIGN_MAX), e.source).catch(() => {}));
  });

  self.thMusicBridge = {
    /** The origin the player addresses its library on (the old Worker's): a name only, never fetched. */
    use: (origin) => {
      OLD = new URL(origin).origin;
    },
    handles,
    answer,
    ahead,
    deps,
    reset: () => {
      api = null;
      tokenAt = -Infinity;
      links.clear();
      signing.clear();
    },
  };
})();
