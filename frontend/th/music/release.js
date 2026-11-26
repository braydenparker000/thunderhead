// Music's files, kept whole for the release they came with (music/sw.js loads this with importScripts;
// PERFORMANCE.md §3.1, "Opening on a weak link"). The kept set holds the files of one release, the page included.
// - A kept set is complete once a page has started from it (the page's `booted` message, app.js) with every
//   file it asked for kept. An open while the newest kept set is complete, has started a page every time it
//   was used, and is at most 7 days old (LIFE_MS) takes all its files from it at once, the page included,
//   without the network (`open`); /release.json is asked in the background, once an open (`check`).
// - When that finds a new release, its files are fetched in the background (the kept set's list, each asked
//   with `no-cache`) into a second set; it is kept only if /release.json still names that release once
//   they are all in. The next open then takes the new set, whole. A page started from one set takes all
//   its files from it for as long as it is open (by its client id), so files of two releases never mix
//   in one page load.
// - A file a page asks for that its kept set lacks comes from the network; it joins the set when the set's
//   release is still the live one, and otherwise the set is marked incomplete (the next open is the
//   network's way, below).
// - A page that does not tell it started (a broken kept set, a crash) leaves its set's `trial` up: the next
//   open does not use that set and goes the network's way, so a bad set can never keep Music from starting.
// The network's way (no complete kept set, a set past its 7 days or one that failed to start a page): as
// before, the page comes from the network (the worker's own way, null here) and /release.json is asked;
// the app's files then come from the set of that release, each one the set lacks fetched and kept if the
// release it was asked for is still the live one when it arrives (deploy.sh uploads release.json last).
// A set of another release, or past its 7 days, starts again, empty. With no answer from /release.json
// (no signal, slow, an error: `down()` says so) nothing is answered here, nor for /release.json itself, nor
// on any cache error: null, and the worker does what it did before (the network, its own offline copies).
// The cache, `claude-player-release`, is code: Repair (repair/repair.js) deletes it with the others.
(() => {
  const g = /** @type {any} */ (typeof self !== 'undefined' ? self : globalThis);
  /** @param {{ fetch: typeof fetch, caches: CacheStorage, waitMs?: number, now?: () => number,
   *   wait?: (ms: number) => Promise<void>, clients?: () => Promise<string[]> }} io `now` and `wait` are the clock
   *   (the tests hold it); `clients` the ids of the pages open (the worker's clients; without it, every page ever
   *   opened since the worker started counts as open). */
  const make = ({ fetch, caches, waitMs = 3000, now = () => Date.now(), wait = (ms) => new Promise((ok) => setTimeout(ok, ms)), clients = null }) => {
    const NAME = 'claude-player-release';
    const MARK = '/music/th-release-id';
    const LIFE_MS = 7 * 86_400_000;
    /** @type {Promise<string> | null} */
    let current = null;
    /** Whether the last check had no answer from the network (no signal, an error, or none in time). */
    let unreached = false;
    /** @typedef {{ id: string, started: number, complete: boolean, missed: boolean, trial: number, files: string[] }} KeptSet */
    /** @type {Promise<{ v: 2, sets: Record<string, KeptSet | undefined>, current: string, next: string | null }> | null} */
    let loaded = null;
    /** Each open page's set: client id → {slot, kept} (kept: opened from a kept set, every file from it). */
    const pages = new Map();
    /** @type {Promise<void> | null} */
    let filling = null;
    /** @type {Promise<unknown>} The open's background work (its check, the next release's files). */
    let behind = Promise.resolve();
    let writing = Promise.resolve();
    let dirty = false;

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

    /** A file's key in a set's slot ('a' or 'b'): its address (a page's without its query), and the slot. */
    const keyOf = (url, slot) => {
      const u = new URL(url);
      u.hash = '';
      if (pageUrl(u)) u.search = '';
      u.searchParams.set('th-set', slot);
      return u.href;
    };
    const base = (url) => { const u = new URL(url); u.hash = ''; if (pageUrl(u)) u.search = ''; return u.href; };
    const pageUrl = (u) => u.pathname.endsWith('/') || u.pathname.endsWith('.html');

    /** The kept sets and which one opens next (read once from the cache; an old marker starts them again). */
    const state = () => (loaded ??= (async () => {
      const c = await caches.open(NAME);
      const had = await c.match(MARK);
      const s = had ? await had.text().then((t) => { try { return JSON.parse(t); } catch { return null; } }) : null;
      if (s?.v === 2 && s.sets && typeof s.current === 'string') return s;
      if (had) { await caches.delete(NAME); }
      return { v: 2, sets: {}, current: 'a', next: null };
    })().catch((e) => { loaded = null; throw e; }));

    /** Writes the sets' state, one write at a time (changes made meanwhile go in the next). */
    const save = () => {
      if (dirty) return writing;
      dirty = true;
      return (writing = writing.then(async () => {
        dirty = false;
        const s = await state();
        await (await caches.open(NAME)).put(MARK, new Response(JSON.stringify(s)));
      }).catch(() => {}));
    };

    /** A slot started again, empty, for release `id`, at once (no await before it: two asks at the same time
     * share it). A set answers only the files on its own list, so its slot's older entries are overwritten as
     * its files come, never answered. @param {{ sets: Record<string, any>, next: string | null }} s */
    const startSet = (s, slot, id) => {
      s.sets[slot] = { id, started: now(), complete: false, missed: false, trial: 0, files: [] };
      if (s.next === slot) s.next = null;
      save();
      return s.sets[slot];
    };

    /** A set whose files may be answered whole: complete, nothing missed, within its 7 days. */
    const whole = (set) => !!set && set.complete && !set.missed && now() - set.started <= LIFE_MS;
    /** A set that may open a page by itself: whole, and every page it opened has started. */
    const usable = (set) => whole(set) && set.trial < 1;

    /** A file kept into a set. */
    const keep = async (slot, set, req, res) => {
      await (await caches.open(NAME)).put(keyOf(req.url, slot), res);
      const url = base(req.url);
      if (!set.files.includes(url)) { set.files.push(url); save(); }
    };

    /** The set's file for a request, or undefined. */
    const kept = async (slot, set, req) => (set.files.includes(base(req.url)) ? (await caches.open(NAME)).match(keyOf(req.url, slot)) : undefined);

    /**
     * An open of the player (a navigation): the newest complete set's page, at once, the page then taking every
     * file from that set; /release.json is asked in the background and a new release saved whole for the next
     * open. null: the network's way (no usable set, or a cache error).
     * @param {Request} req @param {string} [clientId] the page's client id (the fetch event's resultingClientId)
     * @returns {Promise<Response | null>}
     */
    const open = async (req, clientId = '') => {
      let s;
      try {
        s = await state();
        // A new release saved whole since the last open: this open is the first on it.
        if (s.next && usable(s.sets[s.next])) { s.current = s.next; s.next = null; save(); }
        const slot = s.current, set = s.sets[slot];
        if (usable(set)) {
          const hit = await kept(slot, set, req);
          if (hit) {
            set.trial++;
            save();
            if (clientId) pages.set(clientId, {slot, kept: true});
            // (The check's answer and the next release's files come later, without holding this open.)
            behind = check().then(refresh).catch(() => {});
            return hit;
          }
        }
        // Not used: a set that failed to start a page is filled again before it opens one; this load's files
        // are kept into it afresh (what it misses is counted again).
        if (set) {
          if (set.trial >= 1) { set.complete = false; set.trial = 0; }
          set.missed = false;
          save();
        }
      } catch {
        return null;
      }
      behind = check();
      if (clientId) pages.set(clientId, {slot: s.current, kept: false});
      return null;
    };

    /** A page came from the network on the network's way: kept into the set its files go to, when that set
     * is the live release's (the worker passes it a copy). @param {Request} req @param {Response} res */
    const keepPage = async (req, res, clientId = '') => {
      try {
        const id = await (current ?? check());
        if (!id || !res.ok || res.type !== 'basic' || res.redirected) return;
        const s = await state(), slot = pages.get(clientId)?.slot ?? s.current;
        const set = await setFor(slot, id);
        if ((await current) === id) await keep(slot, set, req, res);
      } catch { /* not kept */ }
    };

    /** The set of release `id` in a slot: as it is, or started again (another release, past its 7 days). */
    const setFor = async (slot, id) => {
      const s = await state(), set = s.sets[slot];
      if (set && set.id === id && now() - set.started <= LIFE_MS) return set;
      return startSet(s, slot, id);
    };

    /** A page started (its `booted` message): its set may open the next page; a set filled with no file missed is complete. */
    const booted = async (clientId = '') => {
      try {
        const s = await state(), slot = pages.get(clientId)?.slot ?? s.current, set = s.sets[slot];
        if (!set) return;
        set.trial = 0;
        if (!set.missed && set.files.some((u) => pageUrl(new URL(u)))) set.complete = true;
        await save();
      } catch { /* the next open goes the network's way */ }
    };

    /** The live release differs from the kept one: its files, saved whole into the other slot, for the next open. */
    const refresh = (id) => {
      if (!id || filling) return filling;
      return (filling = (async () => {
        const s = await state(), from = s.sets[s.current];
        if (!from || from.id === id) return;
        const slot = s.current === 'a' ? 'b' : 'a';
        if (s.next === slot && s.sets[slot]?.id === id && usable(s.sets[slot])) return;
        // (A page still open on the other slot keeps it: it is filled again only once no page uses it.)
        if (clients) {
          const open = new Set(await clients().catch(() => [...pages.keys()]));
          for (const cid of pages.keys()) if (!open.has(cid)) pages.delete(cid);
        }
        if ([...pages.values()].some((p) => p.slot === slot)) return;
        const set = startSet(s, slot, id);
        for (const url of from.files) {
          const req = new Request(url);
          const res = await fetch(req, { cache: 'no-cache' });
          if (!res.ok || res.type !== 'basic' || res.redirected) return;
          await keep(slot, set, req, res);
        }
        if ((await check()) !== id) return;
        set.complete = true;
        s.next = slot;
        await save();
      })().catch(() => {}).finally(() => { filling = null; }));
    };

    /** Whether a request is never answered by `answer`: a page, or the release's own list. @param {Request} req */
    const page = (req) => {
      const path = new URL(req.url).pathname;
      return req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe' || path.endsWith('/') || path.endsWith('.html') || path === '/release.json';
    };

    /** A file of the app: from the set its page opened on (a kept set: at once), else this release's set, else
     * the network (kept for this release); or null: the worker answers it as before. `fresh` hears each file the
     * network gave (the worker's offline copies). @param {Request} req @param {(req: Request, res: Response) => void} [fresh]
     * @param {string} [clientId] the asking page's client id @returns {Promise<Response | null>} */
    const answer = async (req, fresh, clientId = '') => {
      if (req.method !== 'GET' || req.headers.has('range') || page(req)) return null;
      let s, slot, set;
      const own = pages.get(clientId);
      try {
        s = await state();
        slot = own?.slot ?? s.current;
        set = s.sets[slot];
      } catch {
        return null;
      }
      // A page opened on a kept set: its files from that set only (a page not known here, that of a worker
      // stopped and started since: the kept set while it may open pages).
      if (set && (own ? own.kept : whole(set))) {
        try {
          const hit = await kept(slot, set, req);
          if (hit) return hit;
        } catch {
          return null;
        }
        // Not in the set: the network's, joining the set while its release is the live one; else the set
        // is incomplete (the next open takes the network's way).
        let res;
        try {
          res = await fetch(req);
        } catch {
          set.missed = true;
          save();
          return null;
        }
        if (res.ok && res.type === 'basic' && !res.redirected) {
          fresh?.(req, res.clone());
          if ((await (current ?? check())) === set.id) await keep(slot, set, req, res.clone()).catch(() => {});
          else { set.missed = true; save(); }
        }
        return res;
      }
      const asked = current ?? check();
      const id = await asked;
      if (!id) return null;
      try {
        set = await setFor(slot, id);
        const hit = await kept(slot, set, req);
        if (hit) return hit;
      } catch {
        return null;
      }
      let res;
      try {
        res = await fetch(req);
      } catch {
        set.missed = true;
        return null;
      }
      if (res.ok && res.type === 'basic' && !res.redirected) {
        fresh?.(req, res.clone());
        // Kept only while its release is still the live one (an open since may have found another).
        if (current === asked || (await current) === id) await keep(slot, set, req, res.clone()).catch(() => {});
        else set.missed = true;
      }
      return res;
    };

    /** A worker a page starts takes its files from the page's set. @param {string} child @param {string} parent */
    const follow = (child, parent) => { if (child && pages.has(parent)) pages.set(child, pages.get(parent)); };

    return { check, answer, open, follow, keepPage, booted, behind: () => behind, saved: () => writing, state, down: () => unreached, NAME, LIFE_MS, keyOf };
  };
  g.thMusicRelease = { make };
})();
