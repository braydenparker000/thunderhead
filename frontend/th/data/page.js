// @ts-check
// The data meter in one page (docs/engineering/DATA-METER.md). Each page that is its own document loads
// it once, through its error reporter (ui/errors.js: home, Photos, Study; assets/error-report.js: Music,
// Podcasts, Astra, Guitar), framed or not. It counts what this document's own timeline reports
// (PerformanceObserver on `resource` and `navigation`; th/data/tally.js entrySize), takes the counts
// the service workers post (th/data/worker.js) and those the code makes itself (`thData.add`, Astra's
// film engine), and writes them to the phone's tally at most once every 5 s and when the page is hidden
// (th/data/store.js). A frame's own load is left to the frame, which counts itself, so nothing is
// counted twice. It sends nothing anywhere.
import { CONFIG } from '/config.js';
import { HEADERS, IDS, dayOf, empty, entrySize, firstSight, netOf } from './tally.js';
import { mergeIn } from './store.js';

/** The part a document is, by its path; everything else is home and the shell. */
const DOCS = /** @type {const} */ ([
  [/^\/music\//, 'music.app'],
  [/^\/podcasts\//, 'podcasts'],
  [/^\/astra\//, 'astra'],
  [/^\/guitar\//, 'guitar'],
  [/^\/(photos|apps\/photos|lab\/(editor|engine|lightcraft))\//, 'photos'],
  [/^\/(study|apps\/study|vendor\/pdfjs[^/]*)\//, 'study'],
]);
/** A release's own files. */
const UPDATES = /^\/(release\.json|precache\.json|sw\.js|lab\/offline\.json)$/;
const WAIT_MS = 5000;

/** The part for a path on this site, or '' when the path says nothing. @param {string} path */
export const partOfPath = (path) => (UPDATES.test(path) ? 'updates' : DOCS.find(([re]) => re.test(path))?.[1] ?? '');

const g = /** @type {any} */ (globalThis);
if (!g.thData && typeof PerformanceObserver === 'function') start();

function start() {
  const doc = partOfPath(location.pathname) || 'home';
  const api = CONFIG.api ? new URL(CONFIG.api).origin : '';
  let batch = empty(0), timer = 0;
  /** Content-Lengths the code holds for answers its timeline may give no size (th/api.js). @type {Map<string, number>} */
  const held = new Map();
  /** Addresses whose bytes the code counts itself (Astra's engine): their entries are left alone. @type {Set<string>} */
  const own = new Set();
  const net = () => netOf(/** @type {any} */ (navigator).connection?.type);

  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!Object.keys(batch.days).length && !batch.unsized) return;
    const b = batch;
    batch = empty(0);
    mergeIn(b);
    // Settings › Data use, open in this page, draws the new numbers (other pages hear `storage`).
    dispatchEvent(new Event('th:data'));
  };
  const later = () => { timer ||= /** @type {any} */ (setTimeout(flush, WAIT_MS)); };
  /** @param {string} id @param {number} bytes @param {number} [n] the network @param {number} [at] */
  const count = (id, bytes, n = net(), at = Date.now()) => {
    if (!IDS.includes(id) || !(bytes > 0)) return;
    const s = ((batch.days[dayOf(at)] ??= {})[id] ??= [0, 0, 0]);
    s[n] += Math.round(bytes);
    later();
  };

  /** What a file from another site is: this document's part (Music's page: the rest, its app files being its own). */
  const elsewhere = doc === 'music.app' ? 'music.rest' : doc;
  /** The part an entry is: a release's file, an app's file by its path, the Worker's API from home; else `elsewhere`. @param {URL} url */
  const partOf = (url) => (url.origin === location.origin ? partOfPath(url.pathname) || doc : url.origin === api && doc === 'home' ? 'api' : elsewhere);
  const fresh = firstSight();
  /** @param {PerformanceEntryList} list */
  const seen = (list) => {
    for (const e of /** @type {PerformanceResourceTiming[]} */ (list)) {
      if (!fresh(e)) continue;
      let url;
      try { url = new URL(e.name); } catch { continue; }
      // A frame of this site counts its own load (its navigation entry); an address the code counts is its.
      if ((e.initiatorType === 'iframe' && url.origin === location.origin) || own.has(e.name)) continue;
      const h = held.get(e.name);
      if (h !== undefined) held.delete(e.name);
      const bytes = entrySize(e, h ?? null);
      if (bytes === null) { batch.unsized++; later(); }
      else count(partOf(url), bytes);
    }
  };
  try {
    new PerformanceObserver((l) => seen(l.getEntries())).observe({ type: 'navigation', buffered: true });
    new PerformanceObserver((l) => seen(l.getEntries())).observe({ type: 'resource', buffered: true });
  } catch {}

  // The service workers' counts (Music's and Podcasts' bridges, the shell's precache), posted to one page.
  const sw = navigator.serviceWorker;
  if (sw) {
    sw.addEventListener('message', (e) => {
      if (e.data?.type !== 'th-data') return;
      for (const i of Array.isArray(e.data.items) ? e.data.items.slice(0, 500) : []) if (i && [0, 1, 2].includes(i.net) && Number.isFinite(i.at)) count(String(i.id), Number(i.bytes), i.net, i.at);
      if (Number.isFinite(e.data.unsized) && e.data.unsized > 0) { batch.unsized += Math.min(e.data.unsized, 10_000); later(); }
    });
    try { sw.startMessages(); } catch {}
    const hello = { type: 'th-data-hello' };
    sw.controller?.postMessage(hello);
    sw.ready.then((r) => r.active?.postMessage(hello), () => {});
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  g.thData = {
    /** Bytes the code counted itself (`url`: its timeline entries are then left alone). @param {string} id @param {number} bytes @param {string} [url] */
    add(id, bytes, url) {
      if (url && own.size < 200) own.add(url);
      count(id, bytes);
    },
    /** A Content-Length for an answer whose timeline entry may carry no size (th/api.js). @param {Response} res */
    held(res) {
      const n = Number(res.headers.get('Content-Length') ?? NaN);
      if (res.url && Number.isFinite(n) && held.size < 100) held.set(res.url, n + HEADERS);
    },
    /** Writes what this page has counted now (Settings › Data use, before it reads). */
    flush,
  };
}
