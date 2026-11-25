// @ts-check
// The data meter in a service worker (docs/engineering/DATA-METER.md): bytes a worker fetches and answers
// a page with reach that page as "from a service worker", without a size, so the worker counts them here,
// from the answer's headers (th/data/tally.js sizeOf: Content-Length, a range answer's range, a 304's
// headers), or, through `read`, for an answer whose headers give no size (a compressed answer streamed
// without a length: Music's catalogue), by the bytes of its body as they pass on their way to whoever
// reads it (nothing buffered, nothing waited for), and posts the counts to one page of the site, which keeps them
// (th/data/page.js). It fetches nothing itself and never opens the tally. Counts wait here while no page
// is open, and go with the next page that says hello. Classic script with no imports: music/sw.js (through
// th/music/bridge.js) and frontend/sw.js load it with importScripts, Podcasts' module worker imports it.
(() => {
  const s = /** @type {any} */ (self);
  if (s.thData) return;
  const HEADERS = 300;
  /** Bytes read are posted in steps of this much while a body is read, and the rest at its end. */
  const STEP = 256 * 1024;
  /** Counts not yet posted, by day, part and network. @type {Map<string, { id: string, net: number, at: number, bytes: number }>} */
  const waiting = new Map();
  let unsized = 0;
  /** Pages that said hello (they keep counts). @type {Set<string>} */
  const ears = new Set();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const dayOf = (/** @type {number} */ ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const net = () => { const t = s.navigator?.connection?.type; return t === 'wifi' ? 0 : t === 'cellular' ? 1 : 2; };

  /** An answer's bytes from its headers (tally.js sizeOf), or null. @param {Response} r */
  const size = (r) => {
    if (r.status === 304) return HEADERS;
    const n = Number(r.headers.get('Content-Length') ?? NaN);
    if (r.headers.get('Content-Length') !== null && Number.isFinite(n)) return n + HEADERS;
    const m = /^bytes (\d+)-(\d+)\//.exec(r.headers.get('Content-Range') ?? '');
    return m ? Number(m[2]) - Number(m[1]) + 1 + HEADERS : null;
  };

  /** Sends what waits to a page: the one that asked if it listens, else one that said hello, else any. @param {string} [client] */
  async function post(client) {
    if (!waiting.size && !unsized) return;
    let to = null;
    for (const id of [client, ...ears]) {
      if (!id || (id !== client && !ears.has(id))) continue;
      to = await s.clients.get(id).catch(() => null);
      if (to) break;
      ears.delete(id);
    }
    to ??= (await s.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []))[0];
    if (!to || (!waiting.size && !unsized)) return;
    to.postMessage({ type: 'th-data', items: [...waiting.values()], unsized });
    waiting.clear();
    unsized = 0;
  }

  /** Bytes for a part. @param {string} id @param {number} bytes @param {string} [client] */
  function bytes(id, bytes, client) {
    if (!(bytes > 0)) return;
    const n = net(), at = Date.now(), key = `${dayOf(at)}|${id}|${n}`;
    const had = waiting.get(key);
    if (had) { had.bytes += bytes; had.at = at; } else if (waiting.size < 200) waiting.set(key, { id, net: n, at, bytes });
    post(client).catch(() => {});
  }

  /** An answer this worker fetched, by its headers. @param {string} id @param {Response | null | undefined} r @param {string} [client] */
  function count(id, r, client) {
    if (!r || r.type === 'opaque' || r.type === 'error') { if (r) unsized++; return; }
    const n = size(r);
    if (n === null) { unsized++; post(client).catch(() => {}); } else bytes(id, n, client);
  }

  /**
   * An answer this worker fetched, counted: by its headers as `count` does, or, when they give no size, by
   * the bytes of its body as they are read. The answer handed back then carries the same body, counted on
   * its way (status and headers as they came), so use what this returns; the one given is no longer readable.
   * @param {string} id @param {Response} r @param {string} [client] @returns {Response}
   */
  function read(id, r, client) {
    if (!r || r.type === 'opaque' || r.type === 'error' || size(r) !== null || !r.body || typeof TransformStream !== 'function') {
      count(id, r, client);
      return r;
    }
    let pending = HEADERS;
    const out = () => { if (pending > 0) bytes(id, pending, client); pending = 0; };
    // (`cancel` is newer than some type libraries: the transformer is typed loosely.)
    const body = r.body.pipeThrough(new TransformStream(/** @type {any} */ ({
      transform(/** @type {Uint8Array} */ chunk, /** @type {TransformStreamDefaultController} */ c) {
        pending += chunk?.byteLength ?? 0;
        if (pending >= STEP) out();
        c.enqueue(chunk);
      },
      flush: out,
      // (A body let go of part-way: what was read is counted.)
      cancel: out,
    })));
    return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
  }

  /** The part a path on this site is (th/data/page.js partOfPath): an app's, a release's, else home's. @param {string} path */
  const partOf = (path) =>
    /^\/(release\.json|precache\.json|sw\.js|lab\/offline\.json)$/.test(path) ? 'updates'
      : /^\/(photos|apps\/photos|lab\/(editor|engine|lightcraft))\//.test(path) ? 'photos'
        : /^\/(study|apps\/study|vendor\/pdfjs[^/]*)\//.test(path) ? 'study' : 'home';

  s.addEventListener?.('message', (/** @type {any} */ e) => {
    if (e.data?.type !== 'th-data-hello' || !e.source?.id) return;
    ears.add(e.source.id);
    e.waitUntil?.(post(e.source.id).catch(() => {}));
  });

  s.thData = { count, read, bytes, partOf, post };
})();
