// Our own frames (NEXT-BATCH.md part 3, the island; SECURITY.md §4.4 rule 4). A ported app's worker
// gives the owner's session only to a top-level page of this site, so a copy of the app that another
// site frames never gets it (the page can't send headers, so nothing stops a site from framing it).
// Home now opens Music and Podcasts as layers inside itself, in frames. To tell its own frame from
// another site's, home first hands the app's worker a one-time token (a message, which only this
// site's pages can send to its worker) and waits for its answer, then opens the frame at
// `?th-frame=<token>`. The worker marks the client that navigation creates as ours; a token works once
// and for one minute. The marks are kept in a cache, since the browser stops idle workers, and
// forgotten when their frame is gone. Any other framed copy is untrusted, as before.
// Works as a classic worker script (music/sw.js, through th/music/bridge.js) and as a module
// (podcasts/sw.js, through th/podcasts/bridge.js): it only sets `self.thFrames`.
(() => {
  const sw = /** @type {any} */ (typeof self !== 'undefined' ? self : null);
  if (!sw || sw.thFrames || typeof sw.addEventListener !== 'function' || !sw.clients) return;
  const STORE = 'th-frames';
  const KEY = new URL('/__th/frames', sw.location?.origin ?? 'https://example.invalid').href;
  const TOKEN = /^[0-9a-f]{32}$/;
  const TOKEN_MS = 60_000;
  /** @type {Map<string, number>} */
  const tokens = new Map();
  /** @type {Set<string> | null} */
  let ours = null;

  const load = async () => {
    if (ours) return ours;
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

  // Home's token, from a top-level page of this site; answered on the port it came with.
  sw.addEventListener('message', (/** @type {any} */ e) => {
    if (e.data?.th !== 'frame-token') return;
    const token = e.data.token;
    const ok = typeof token === 'string' && TOKEN.test(token) && e.source?.frameType === 'top-level';
    if (ok) {
      const now = Date.now();
      for (const [t, until] of tokens) if (until < now) tokens.delete(t);
      tokens.set(token, now + TOKEN_MS);
    }
    e.ports?.[0]?.postMessage({ th: 'frame-token', ok });
  });

  // The frame's own page load, at ?th-frame=<token>: its client is ours.
  sw.addEventListener('fetch', (/** @type {any} */ e) => {
    if (e.request.mode !== 'navigate' || !e.resultingClientId) return;
    let token = null;
    try {
      token = new URL(e.request.url).searchParams.get('th-frame');
    } catch {}
    const until = token ? tokens.get(token) : undefined;
    if (!token || until === undefined) return;
    tokens.delete(token);
    if (until < Date.now()) return;
    e.waitUntil(
      load()
        .then((set) => set.add(e.resultingClientId))
        .then(save),
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
