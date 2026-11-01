// Our own frames (NEXT-BATCH.md part 3, the island; SECURITY.md §4.4 rule 5). A ported app's worker
// gives the owner's session only to a top-level page of this site, so a copy of the app that another
// site frames never gets it (the page can't send headers, so nothing stops a site from framing it).
// Home now opens Music and Podcasts as layers inside itself, in frames. To tell its own frame from
// another site's, home first hands the app's worker a one-time token (a message, which only this
// site's pages can send to its worker) and waits for its answer, then opens the frame at
// `?th-frame=<token>`. The worker marks the client that navigation creates as ours, and answers that
// page load from the app's own address (so it works offline and no token is ever stored). An app
// that reloads itself in the frame (Music does, on a day/night switch) is a new client: its page asks
// home, its top, for a fresh token and gives it to the worker (`frame-claim`, th/ported/claim.js).
// A token comes only from home's own page (`/`, top-level), works once and for one minute. The marks
// are kept in a cache per app, since the browser stops idle workers, and forgotten when their frame
// is gone. Any other framed copy is untrusted, as before.
// Works as a classic worker script (music/sw.js, through th/music/bridge.js) and as a module
// (podcasts/sw.js, through th/podcasts/bridge.js): it only sets `self.thFrames`.
(() => {
  const sw = /** @type {any} */ (typeof self !== 'undefined' ? self : null);
  if (!sw || sw.thFrames || typeof sw.addEventListener !== 'function' || !sw.clients) return;
  const STORE = 'th-frames';
  // One list per app (its worker's scope), so Music's and Podcasts' workers never drop each other's.
  const KEY = new URL('th-frames.json', sw.registration?.scope ?? sw.location?.href).href;
  const TOKEN = /^[0-9a-f]{32}$/;
  const TOKEN_MS = 60_000;
  /** @type {Map<string, number>} */
  const tokens = new Map();
  /** @type {Set<string> | null} */
  let ours = null;

  const load = async () => {
    if (ours) return ours;
    /** @type {string[]} */
    let list = [];
    try {
      const r = await (await caches.open(STORE)).match(KEY);
      const v = r ? await r.json() : [];
      if (Array.isArray(v)) list = v.filter((x) => typeof x === 'string');
    } catch {}
    ours ??= new Set(list);
    return ours;
  };
  const save = async () => {
    const set = await load();
    const live = [];
    for (const id of set) if (await sw.clients.get(id)) live.push(id);
    ours = new Set(live);
    try {
      await (await caches.open(STORE)).put(KEY, new Response(JSON.stringify(live), { headers: { 'Content-Type': 'application/json' } }));
    } catch {}
  };

  /** Whether a message came from home: top-level, at this site's root. @param {any} source */
  const fromHome = (source) => {
    try {
      return source?.frameType === 'top-level' && new URL(source.url).pathname === '/';
    } catch {
      return false;
    }
  };
  /** Takes a token once, if it is fresh. @param {unknown} token */
  const take = (token) => {
    const until = typeof token === 'string' ? tokens.get(token) : undefined;
    if (until === undefined) return false;
    tokens.delete(/** @type {string} */ (token));
    return until >= Date.now();
  };
  const mark = (/** @type {string} */ id) => load().then((set) => set.add(id)).then(save);

  sw.addEventListener('message', (/** @type {any} */ e) => {
    // Home's token; answered on the port it came with.
    if (e.data?.th === 'frame-token') {
      const token = e.data.token;
      const ok = typeof token === 'string' && TOKEN.test(token) && fromHome(e.source);
      if (ok) {
        const now = Date.now();
        for (const [t, until] of tokens) if (until < now) tokens.delete(t);
        tokens.set(token, now + TOKEN_MS);
      }
      e.ports?.[0]?.postMessage({ th: 'frame-token', ok });
    }
    // A framed page of this app that reloaded itself, with a fresh token home gave it.
    if (e.data?.th === 'frame-claim' && e.source?.frameType === 'nested' && e.source.id) {
      const ok = take(e.data.token);
      if (ok) e.waitUntil?.(mark(e.source.id));
      e.ports?.[0]?.postMessage({ th: 'frame-claim', ok });
    }
  });

  // The frame's own page load, at ?th-frame=<token>: its client is ours, and the page comes from the
  // app's address without the token (the network, else the app's cached copy: it opens offline).
  sw.addEventListener('fetch', (/** @type {any} */ e) => {
    if (e.request.mode !== 'navigate') return;
    let url = null;
    try {
      url = new URL(e.request.url);
    } catch {}
    const token = url?.searchParams.get('th-frame');
    if (!url || token === null || token === undefined) return;
    if (take(token) && e.resultingClientId) e.waitUntil(mark(e.resultingClientId));
    url.searchParams.delete('th-frame');
    const clean = url.href;
    e.respondWith(
      fetch(clean).catch(async () => (await caches.match(clean, { ignoreSearch: true })) ?? Response.error()),
    );
  });

  sw.thFrames = {
    /** Whether the request's page may have the session: no page (the worker's own), a top-level
     * page, or a frame home opened. @param {string | undefined | null} clientId */
    async trusted(clientId) {
      if (!clientId) return true;
      const c = await sw.clients.get(clientId);
      if (!c || c.frameType === 'top-level') return true;
      return (await load()).has(c.id);
    },
    /** For tests: forget everything. */
    reset() {
      tokens.clear();
      ours = new Set();
    },
  };
})();
