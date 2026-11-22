// Music's files, kept for the release they came with (music/sw.js loads this with importScripts;
// PERFORMANCE.md §3.1, "Opening on a weak link"). Each open of the player asks the network for the
// site's /release.json (never kept, `no-store`), while its page itself comes from the network as
// before. The app's other files (its modules, styles, fonts and model) are then answered from one cache
// that holds the files of exactly that release, so a second open of the same release costs no request
// for them (on a weak link each one cost a round trip to ask whether it changed: about 150 of them).
// A different release starts the cache again, empty, so a new release takes over on the next open.
// A file the network gives is kept only if the release it was asked for is still the live one when it
// arrives. deploy.sh uploads release.json last, so a file fetched during a deploy can be the new
// release's while release.json still names the old one; were that deploy never finished, the mix would
// stay: so the cache also lives at most 7 days (LIFE_MS), then starts again, empty, at the next open.
// This only ever answers a file or says it cannot (null), and the worker then does what it did
// before (the network, its own offline copies): with no answer from /release.json (no signal, slow, an
// error: `down()` then says so, and the worker goes straight to its offline copies), for a page
// (navigations and .html), for /release.json itself, and on any cache error.
// The cache, `claude-player-release`, is code: Repair (repair/repair.js) deletes it with the others.
(() => {
  const g = /** @type {any} */ (typeof self !== 'undefined' ? self : globalThis);
  /** @param {{ fetch: typeof fetch, caches: CacheStorage, waitMs?: number, now?: () => number,
   *   wait?: (ms: number) => Promise<void> }} io `now` and `wait` are the clock (the tests hold it). */
  const make = ({ fetch, caches, waitMs = 3000, now = () => Date.now(), wait = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) => {
    const NAME = 'claude-player-release';
    const MARK = '/music/th-release-id';
    const LIFE_MS = 7 * 86_400_000;
    /** @type {Promise<string> | null} */
    let current = null;
    /** Whether the last check had no answer from the network (no signal, an error, or none in time). */
    let unreached = false;
    /** @type {{ id: string, started: number, cache: Promise<Cache> } | null} */
    let opened = null;

    /** The live release's name ('' when the network gives none in time). Asked at every open. */
    const check = () => (current = (async () => {
      const late = Symbol('late');
      const ctl = new AbortController();
      try {
        const r = await Promise.race([fetch('/release.json', { cache: 'no-store', signal: ctl.signal }), wait(waitMs).then(() => late)]);
        if (r === late) { ctl.abort(); unreached = true; return ''; }
        unreached = false;
        if (!r.ok) return '';
        const j = await r.json();
        return typeof j?.commit === 'string' && j.commit ? `${j.commit} ${j.staged_at ?? ''}` : '';
      } catch {
        unreached = true;
        return '';
      }
    })());

    /** The cache, holding only the files of release `id`, started at most LIFE_MS ago (else started again). */
    const cacheFor = (id) => {
      if (opened && (opened.id !== id || now() - opened.started > LIFE_MS)) opened = null;
      if (!opened) {
        const o = { id, started: now(), cache: /** @type {Promise<Cache>} */ (/** @type {unknown} */ (null)) };
        o.cache = (async () => {
          let c = await caches.open(NAME);
          const had = await c.match(MARK);
          const [hadId, at] = had ? (await had.text()).split('\n') : [];
          if (hadId === id && now() - Number(at) <= LIFE_MS) {
            o.started = Number(at);
            return c;
          }
          await caches.delete(NAME);
          c = await caches.open(NAME);
          await c.put(MARK, new Response(`${id}\n${o.started}`));
          return c;
        })();
        o.cache.catch(() => { if (opened === o) opened = null; });
        opened = o;
      }
      return opened.cache;
    };

    /** Whether a request is never answered here: a page, or the release's own list. @param {Request} req */
    const page = (req) => {
      const path = new URL(req.url).pathname;
      return req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe' || path.endsWith('/') || path.endsWith('.html') || path === '/release.json';
    };

    /** A file of the app from this release's cache, else the network (kept for this release); or null:
     * the worker answers it as before. `fresh` hears each file the network gave (the worker's offline copies).
     * @param {Request} req @param {(req: Request, res: Response) => void} [fresh] @returns {Promise<Response | null>} */
    const answer = async (req, fresh) => {
      if (req.method !== 'GET' || req.headers.has('range') || page(req)) return null;
      const asked = current ?? check();
      const id = await asked;
      if (!id) return null;
      let cache;
      try {
        cache = await cacheFor(id);
        const hit = await cache.match(req);
        if (hit) return hit;
      } catch {
        return null;
      }
      let res;
      try {
        res = await fetch(req);
      } catch {
        return null;
      }
      if (res.ok && res.type === 'basic' && !res.redirected) {
        fresh?.(req, res.clone());
        // Kept only while its release is still the live one (an open since may have found another).
        if (current === asked || (await current) === id) await cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    };

    return { check, answer, down: () => unreached, NAME, LIFE_MS };
  };
  g.thMusicRelease = { make };
})();
