// Phones for the Astra sync engine tests (tests/astra-sync-engine*.test.mjs): Astra's real store and worker-api.js
// over each phone's own storage, clock, timers, page and window, against an invented Worker that answers as the real
// one does. Invented add-ons, titles, token and times.
import { createStorage, Library, PREFIX } from '../../frontend/astra/src/app/store.js';
import { startSync, RECORD } from '../../frontend/astra/src/app/sync.js';
import { api } from '../../frontend/astra/src/addons/worker-api.js';

// The phones' clocks start at the real time: the store's own classes stamp with Date.now(), and the sync takes no time
// as later than `AHEAD` (twelve hours) ahead of its clock.
export const T = Math.floor(Date.now() / 1000) * 1000, MIN = 60_000;
export const ADDON = { url: 'https://addon.example/invented-config-0011/manifest.json', enabled: true, name: 'Invented' };
export const film = (id, updated) => ({ type: 'movie', id, videoId: id, season: null, episode: null, time: 600, duration: 6000, updated, completed: false, meta: { id, type: 'movie', name: `Invented ${id}` } });
export const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The invented Worker as the real one answers: one copy, `?known=` answered `same` when it is that version, saves
 * with the copy as the body and its base in `?base=` (conditional), every request recorded with its size. */
export function worker() {
  let n = 0;
  const w = { kept: null, calls: [], down: 0, conflict: false, answer: null };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method, path: u.pathname, query: u.search, keepalive: init.keepalive === true, body, auth: init.headers?.Authorization });
    if (w.down) return json(w.down, { error: { code: 'unavailable', message: 'Down.' } });
    if (method === 'GET') {
      const known = u.searchParams.get('known');
      if (known && w.kept?.version === known && !w.answer) return json(200, { version: known, saved_at: w.kept.saved_at, same: true });
      return json(200, w.answer ?? (w.kept ? structuredClone(w.kept) : { version: null, saved_at: null, copy: null }));
    }
    if (method === 'DELETE') { w.kept = null; return new Response(null, { status: 204 }); }
    if (init.body.length > 1024 * 1024) return json(413, { error: { code: 'too_large', message: 'Too large.' } });
    if (w.conflict || (w.kept?.version ?? null) !== u.searchParams.get('base')) return json(409, { error: { code: 'conflict', message: 'Stale.', details: { reason: 'stale_base' } } });
    w.kept = { version: `v${++n}`, saved_at: new Date(T).toISOString(), copy: body };
    return json(200, { version: w.kept.version, saved_at: w.kept.saved_at });
  };
  w.methods = () => w.calls.map((c) => c.method);
  return w;
}

function memory(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

/** A phone: Astra's store over its own storage, its clock (`offset` from true time), timers, page and window. */
export async function phone(w, { data = {}, signedIn = true, offset = 0, record = null } = {}) {
  const area = memory(Object.fromEntries(Object.entries(data).map(([k, v]) => [PREFIX + k, JSON.stringify(v)])));
  if (record) area.setItem(RECORD, JSON.stringify(record));
  const win = new EventTarget();
  const store = createStorage(area, { events: win });
  const p = { area, store, t: T + offset, queue: [], toasts: [], doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }), set: store.set, channel: new EventTarget() };
  p.library = new Library(store);
  p.app = { store, playing: null };
  const later = (fn, ms) => { const id = Symbol('timer'); p.queue.push({ id, at: p.t + ms, fn }); return id; };
  const cancel = (id) => { p.queue = p.queue.filter((x) => x.id !== id); };
  p.advance = async (ms) => { p.t += ms; for (const due of p.queue.filter((x) => x.at <= p.t)) { cancel(due.id); due.fn(); } await settle(); };
  p.read = (k) => JSON.parse(area.getItem(PREFIX + k) ?? 'null');
  p.record = () => JSON.parse(area.getItem(RECORD) ?? 'null');
  p.page = async (state) => { p.doc.visibilityState = state; p.doc.dispatchEvent(new Event('visibilitychange')); await settle(); };
  const session = async () => (signedIn ? { api: 'https://api.example.test', token: 'invented-session-token' } : null);
  p.sync = startSync(p.app, {
    api: (path, o = {}) => api(path, { ...o, read: session, fetchFn: o.fetchFn ?? w.fetch }), session, storage: area, now: () => p.t,
    later, cancel, idle: (fn) => fn(), win, doc: p.doc, toast: (t) => p.toasts.push(t), fetch: w.fetch, channel: () => p.channel,
    // Node has no StorageEvent: the same event's shape, which the store's own listener reads.
    announce: (k) => win.dispatchEvent(Object.assign(new Event('storage'), { key: PREFIX + k, storageArea: area })),
  });
  await p.sync.ready;
  await settle();
  return p;
}

