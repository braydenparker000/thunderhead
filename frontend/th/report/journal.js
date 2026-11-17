// @ts-check
// The editor's flight recorder (the owner, 2026-11-17: "design a better reporting design"). Each event is its own
// record in IndexedDB `th-report` the moment it happens: no list read and written whole (two tabs wrote over each
// other's, and a full localStorage dropped them unseen), and a failed write is counted. A heavy job writes `begin`
// before it starts and `end` after (`job`), so one left unended is what was running when the chip or the page died.
// Each visit is a session: when it began, the build, the phone; it is marked hidden and shown as the page is, and
// closed when the page goes. The next visit finds any that never closed and records `died` with what was unended
// (and whether it was in the background: Android lets those go). The events go to the owner's storage from the
// background worker (send.js), asked here whenever there is something to send; this page reaches nothing itself.
// Kept on the phone 14 days whatever the Settings switch says: it only says whether they leave (Privacy and data ›
// Editor reports). Never a photo, its name or its settings: fields.js keeps known fields only.
import './fields.js';

const DB = 'th-report', V = 1, KEEP_MS = 14 * 86_400_000;
const F = /** @type {any} */ (globalThis).thReportFields;
/** @type {Promise<IDBDatabase | null> | null} */ let opened = null;
let session = '', seq = 0, t0 = 0, fails = 0;

/** The recorder's database (null where there is none: a private window). */
export function db() {
  return (opened ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, V);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('events', { keyPath: 'k', autoIncrement: true }).createIndex('s', 's');
        d.createObjectStore('sessions', { keyPath: 'id' });
        d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }));
}
/** Runs `f` on the stores named in one transaction, resolving once it is written (false where it was not).
 * @param {string[]} stores @param {IDBTransactionMode} mode @param {(t: IDBTransaction) => void} f */
export async function tx(stores, mode, f) {
  const d = await db();
  if (!d) return false;
  return new Promise((resolve) => {
    try { const t = d.transaction(stores, mode); f(t); t.oncomplete = () => resolve(true); t.onerror = t.onabort = () => resolve(false); } catch { resolve(false); }
  });
}
const put = (/** @type {string} */ store, /** @type {any} */ value, /** @type {IDBValidKey} */ key = /** @type {any} */ (undefined)) => tx([store], 'readwrite', (t) => (key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key)));

/** Records one event of this visit (`kind` one of fields.js's, its fields known there). Gives whether it was kept.
 * @param {string} kind @param {Record<string, unknown>} [fields] */
export async function log(kind, fields = {}) {
  if (!session) start();
  const { ok, dropped } = F.clean({ ...fields, kind });
  if (!ok) return false;
  const at = Date.now(), base = { s: session, n: ++seq, at, t: Math.round(performance.now() - t0) };
  const kept = await tx(['events'], 'readwrite', (t) => {
    const s = t.objectStore('events'); s.add({ ...base, ...ok });
    for (const name of dropped.slice(0, 4)) s.add({ ...base, n: ++seq, kind: 'dropped', name: /^[a-zA-Z0-9]{1,24}$/.test(name) ? name : 'unnamed' });   // so a field left off the list is seen, not lost
  });
  if (!kept) fails++;
  return kept;
}
/** A heavy job begins (`job`: open, full, copy, prep, starfish, detail, export): the returned function ends it.
 * @param {string} job @returns {(outcome?: 'done' | 'left' | 'failed', fields?: Record<string, unknown>) => void} */
export function begin(job) {
  const t = performance.now(); log('begin', { job });
  let over = false;
  return (outcome = 'done', fields = {}) => { if (over) return; over = true; log('end', { job, outcome, ms: performance.now() - t, ...fields }); };
}

/** This visit begins: its session is written, the ones before that never closed are found (`died`), what is older
 * than KEEP_MS is let go, and the page's comings and goings are followed. `build`: the site's build. @param {string} [build] */
export function start(build = '') {
  if (session) return session;
  session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); t0 = performance.now();
  const nav = /** @type {any} */ (navigator), me = { id: session, at: Date.now(), build: String(build).slice(0, 12), cores: nav.hardwareConcurrency || 0, memory: nav.deviceMemory || 0, hidden: document.hidden ? 1 : 0, closed: 0 };
  void (async () => {
    if (!me.build) me.build = await import('/config.js').then((m) => String(m.CONFIG?.commit || '').slice(0, 12)).catch(() => '');
    await found();
    await put('sessions', me);
    const ua = await nav.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']).catch(() => null);
    log('phone', { model: ua?.model || '', android: ua?.platformVersion || '', cores: me.cores, memory: me.memory, dpr: Math.round(devicePixelRatio * 100), w: screen.width, h: screen.height });
  })();
  const mark = (/** @type {Partial<typeof me>} */ m) => { Object.assign(me, m); void put('sessions', { ...me }); };
  addEventListener('visibilitychange', () => { mark({ hidden: document.hidden ? 1 : 0 }); if (document.hidden) sendSoon(); });
  addEventListener('pagehide', () => { shut(session); mark({ closed: 1 }); sendSoon(); });
  return session;
}
/** The visits closed as their pages went, by id: written at once (a write to IndexedDB as a page goes may land after
 * the next page has looked, and a reload is no death). */
const CLOSED = 'th.report.closed';
const closedIds = () => { try { const a = JSON.parse(localStorage.getItem(CLOSED) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const shut = (/** @type {string} */ id) => { try { localStorage.setItem(CLOSED, JSON.stringify([...closedIds().filter((x) => x !== id), id].slice(-20))); } catch { /* a private window */ } };
/** The visits before this one that never closed: each gets `died`, naming the heaviest job it left unended. */
async function found() {
  const d = await db();
  if (!d) return;
  /** @type {any[]} */ const open = await new Promise((resolve) => { const r = d.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
  const HEAVY = ['copy-maker', 'copy-compile', 'copy-tile', 'copy-read', 'copy', 'prep', 'starfish', 'detail', 'export', 'full', 'open'];
  const shutIds = new Set(closedIds());
  for (const s of open.filter((x) => !x.closed && x.id !== session && shutIds.has(x.id))) await put('sessions', { ...s, closed: 1 });
  for (const s of open.filter((x) => !x.closed && x.id !== session && !shutIds.has(x.id))) {
    /** @type {any[]} */ const evs = await new Promise((resolve) => { const r = d.transaction('events').objectStore('events').index('s').getAll(s.id); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
    const going = new Map();
    for (const e of evs) if (e.kind === 'begin') going.set(e.job, (going.get(e.job) || 0) + 1); else if (e.kind === 'end') going.set(e.job, (going.get(e.job) || 1) - 1);
    const left = HEAVY.filter((j) => (going.get(j) || 0) > 0), last = evs.at(-1);
    await tx(['events', 'sessions'], 'readwrite', (t) => {
      t.objectStore('events').add({ s: s.id, n: (last?.n || 0) + 1, at: Date.now(), t: (last?.t || 0) + 1, kind: 'died', job: left[0] || 'none', hidden: s.hidden ? 1 : 0 });
      t.objectStore('sessions').put({ ...s, closed: 1, died: 1 });
    });
  }
  const old = Date.now() - KEEP_MS;   // and what is older than two weeks goes
  await tx(['events', 'sessions'], 'readwrite', (t) => {
    const c = t.objectStore('events').openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur && cur.value.at < old) { cur.delete(); cur.continue(); } };
    for (const s of open) if (s.at < old) t.objectStore('sessions').delete(s.id);
  });
}

/** Asks the background worker to send what is new (it does nothing where the owner turned it off). */
export function sendSoon() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  sw.ready.then((r) => /** @type {any} */ (r).sync?.register('th-report')).catch(() => {});
  sw.controller?.postMessage({ type: 'report-send' });
}
/** Whether the events may leave (the Settings switch, as this page knows it: the background worker cannot read it). @param {boolean} on */
export const allow = (on) => put('meta', !!on, 'send');

/** What the Settings line says: events kept, those not sent yet, when they were last sent, writes that failed. */
export async function stats() {
  const d = await db();
  if (!d) return { kept: 0, waiting: 0, sent: 0, fails };
  return new Promise((resolve) => {
    const t = d.transaction(['events', 'meta']), out = { kept: 0, waiting: 0, sent: 0, fails };
    const all = t.objectStore('events').count(), cur = t.objectStore('meta').get('cursor'), when = t.objectStore('meta').get('sentAt');
    t.oncomplete = () => {
      out.kept = all.result || 0; out.sent = when.result || 0;
      const c = cur.result || 0, w = d.transaction('events').objectStore('events').count(IDBKeyRange.lowerBound(c, true));
      w.onsuccess = () => resolve({ ...out, waiting: w.result || 0 }); w.onerror = () => resolve(out);
    };
    t.onerror = () => resolve(out);
  });
}
/** This visit's id ('' before it starts). */
export const visit = () => session;
