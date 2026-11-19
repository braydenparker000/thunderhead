// Astra the same on every phone the owner signs in on (ASTRA.md §5.3, owner 2026-11-19): this phone's
// add-ons, library, progress, watched list, settings and recent searches are merged with the copy kept
// on the owner's server (GET/PUT/DELETE /v1/astra/backup, sealed there by the Worker).
//
// Who it talks to: only the owner's own Worker, through worker-api.js with the site's sign-in. Signed
// out (or framed by another site) nothing is hooked and nothing is sent, ever; with the switch off
// nothing is sent. When: shortly after start (never before the first paint), back in front after more
// than 5 minutes, a minute after the last change (each time: fetch, merge, then save if the merge
// changed anything), "Sync now", and when the page is hidden (a keepalive save of what changed, when it
// fits in a keepalive's 64 KiB; else it goes on the next start). Failures stay quiet: offline, 5xx, 503,
// a conflict three times over: tried again later, each wait longer, up to 30 minutes.
//
// What stays on this phone: a small record in localStorage `astra.sync.v1` (outside the store's
// `astra.v2.*`, so backups, restores and Reset never carry it): the switch, when each key last changed
// here, removed entries (60 days), the version last merged, when it last saved and fetched. Merged values
// pass the store's sanitisers (sync-merge.js) and are written through the store, then announced as
// another window's write would be, so every open screen follows; the title playing keeps its own
// progress; the senses reader is told nothing of merged progress (sync-senses.js). Nothing is logged.

import {BACKUP_KEYS, PREFIX} from './store.js';
import {ENTRY_KEYS, entryTime, isEmpty, mergeCopies, readCopy} from './sync-merge.js';
import {hideFromSenses} from './sync-senses.js';
import {api as workerApi, session as workerSession} from '../addons/worker-api.js';

export const RECORD = 'astra.sync.v1';
export const PATH = '/v1/astra/backup';
export const SAVE_AFTER = 60_000;
export const AWAY = 5 * 60_000;
/** A keepalive request's body may be 64 KiB at most: kept under it. */
export const KEEPALIVE_MAX = 63 * 1024;
const RETRY = [60_000, 120_000, 300_000, 600_000, 1_800_000];
const TRIES = 3;

const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
const times = v => isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'number' && Number.isFinite(t))) : {};
const bytes = text => new TextEncoder().encode(text).length;
const fresh = () => ({off: false, joined: false, at: {}, gone: {}, version: null, savedAt: null, fetchedAt: null, owed: false});

/** The record as stored, checked field by field (a damaged one starts afresh). */
export function recordOf(v) {
  if (!isObject(v)) return fresh();
  const stamp = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
  return {off: v.off === true, joined: v.joined === true, at: times(v.at), gone: Object.fromEntries(ENTRY_KEYS.map(k => [k, times(v.gone?.[k])])),
    version: typeof v.version === 'string' ? v.version : null, savedAt: stamp(v.savedAt), fetchedAt: stamp(v.fetchedAt), owed: v.owed === true};
}

/**
 * Starts keeping this phone in step for `app` (its store, and what it is playing). `deps` replace the
 * page's own for tests. Returns {state(), onChange(fn), setOn(on), syncNow(), removeCopy(), ready}.
 */
export function startSync(app, deps = {}) {
  const d = {api: workerApi, session: workerSession, now: () => Date.now(), win: globalThis, doc: globalThis.document, toast: null,
    storage: (() => { try { return globalThis.localStorage; } catch { return null; } })(),
    later: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id), idle: fn => globalThis.requestIdleCallback ? requestIdleCallback(fn, {timeout: 4000}) : setTimeout(fn, 1500),
    fetch: (...a) => globalThis.fetch(...a), ...deps};
  // As another window's write is heard (store.js createStorage), so every open screen follows.
  d.announce ??= key => d.win?.dispatchEvent?.(new StorageEvent('storage', {key: PREFIX + key, storageArea: d.storage}));
  const store = app.store, listeners = new Set(), snap = {};
  let signedIn = null, working = null, problem = '', timer = 0, retry = 0, hiddenAt = 0, changes = 0, applying = false;

  const record = () => { try { return recordOf(JSON.parse(d.storage?.getItem(RECORD) || 'null')); } catch { return fresh(); } };
  const keep = rec => { try { d.storage?.setItem(RECORD, JSON.stringify(rec)); } catch {} };
  const changed = () => { for (const fn of listeners) fn(); };
  const schedule = ms => { d.cancel(timer); timer = d.later(() => exchange('timer'), ms); };

  /** What this phone holds of a key now: its stored text and, for entry keys, each entry's time. */
  function snapshot(k) {
    const entries = new Map();
    if (ENTRY_KEYS.includes(k)) for (const [id, e] of Object.entries(store.get(k, {}))) entries.set(id, entryTime(k, e));
    snap[k] = {raw: store.raw(PREFIX + k), entries};
  }

  /** A write this window made: stamps each changed key, keeps tombstones for removed entries, and
   * schedules a save a minute on. Merged values written by this module are not changes. */
  function heard(keys) {
    if (applying) return;
    const rec = record(), now = d.now();
    let any = false;
    for (const k of keys) {
      if (!BACKUP_KEYS.includes(k)) continue;
      const was = snap[k];
      if (was && store.raw(PREFIX + k) === was.raw) continue;
      snapshot(k);
      if (rec.off) continue;
      any = true;
      // Later than this phone last saw for the key, so a change made after seeing another phone's wins.
      rec.at[k] = Math.max(now, (rec.at[k] ?? 0) + 1);
      if (was && ENTRY_KEYS.includes(k))
        for (const [id, t] of was.entries) if (!snap[k].entries.has(id)) rec.gone[k][id] = Math.max(now, t + 1);
    }
    if (!any) return;
    keep({...rec, owed: true});
    changes++;
    schedule(Math.max(SAVE_AFTER, retry ? RETRY[retry - 1] : 0));
  }

  /** Hears the store's three writers; another window's writes only refresh what this one knows. */
  function hearWrites() {
    const {set, remove, replace} = store;
    store.set = (key, value) => { const ok = set(key, value); if (ok) heard([key]); return ok; };
    store.remove = key => { const ok = remove(key); if (ok) heard([key]); return ok; };
    store.replace = (values, keepKeys) => { const failed = replace(values, keepKeys); if (!failed) heard(BACKUP_KEYS); return failed; };
    d.win?.addEventListener?.('storage', e => {
      const k = e.key?.startsWith(PREFIX) ? e.key.slice(PREFIX.length) : null;
      if (k && BACKUP_KEYS.includes(k) && !applying) snapshot(k);
    });
  }

  /** This phone's side for a merge: each key as stored (undefined when nothing is saved), with the record's stamps. */
  function mine(rec) {
    const out = {};
    for (const k of BACKUP_KEYS) out[k] = {at: rec.at[k] ?? 0, value: store.get(k, undefined), gone: rec.gone[k] ?? {}};
    return out;
  }

  /** Writes merged values through the store and announces each as another window's write, so every screen follows. */
  function apply(values, before) {
    applying = true;
    try {
      for (const [k, v] of Object.entries(values)) {
        if (!store.set(k, v)) return false;
        if (k === 'progress') hideFromSenses(before, v, d.storage);
        snapshot(k);
        d.announce(k);
      }
      return true;
    } finally { applying = false; }
  }

  /** The Worker's answer to GET, checked: {version, copy} with copy readCopy's (null: nothing usable). */
  function kept(a) {
    if (!isObject(a) || !('copy' in a) || (a.version !== null && typeof a.version !== 'string')) throw Object.assign(Error('unreadable'), {code: 'unreadable'});
    return {version: a.version, copy: a.version === null ? null : readCopy(a.copy)};
  }

  /** Fetch, merge, write here, save there when the merge changed the copy; up to three times on a conflict. */
  async function run() {
    for (let tries = 1; ; tries++) {
      const server = kept(await d.api(PATH));
      if (server.copy === 'newer') { problem = 'newer'; return; }
      let rec = record();
      if (rec.off) return;
      const now = d.now(), first = !rec.joined, side = mine(rec);
      // A phone that has data but never merged: its non-empty keys changed now (the brief's first-merge rule).
      if (first) for (const k of BACKUP_KEYS) if (!isEmpty(k, side[k].value) && !rec.at[k]) side[k].at = now;
      const merged = mergeCopies({mine: side, theirs: server.copy?.keys ?? {}, first, playing: app.playing?.meta || null, now});
      if (!apply(merged.apply, side.progress.value)) { problem = 'full'; return; }
      const mark = changes;
      rec = record();
      for (const [k, v] of Object.entries(merged.copy.keys)) { rec.at[k] = v.at; if (v.gone) rec.gone[k] = v.gone; }
      Object.assign(rec, {joined: true, version: server.version, fetchedAt: now, owed: merged.differs});
      keep(rec);
      if (first && server.copy && BACKUP_KEYS.some(k => !isEmpty(k, side[k].value) && server.copy.keys[k]))
        d.toast?.('Astra on this phone and on your other phones were put together. Nothing was lost.');
      if (!merged.differs) { problem = ''; return; }
      const body = {base: server.version, copy: merged.copy};
      if (bytes(JSON.stringify(body)) > 2 * 1024 * 1024) { problem = 'too-big'; return; }
      try {
        const saved = await d.api(PATH, {method: 'PUT', body});
        rec = record();
        keep({...rec, version: String(saved.version), savedAt: d.now(), owed: rec.owed && changes !== mark});
        problem = '';
        return;
      } catch (error) {
        if (error?.status !== 409 || tries >= TRIES) throw error;
      }
    }
  }

  /** One exchange at a time; a failure is quiet and tried again later, each wait longer. */
  function exchange() {
    if (!signedIn || record().off) return Promise.resolve();
    if (working) return working;
    d.cancel(timer);
    working = run().then(() => { retry = 0; }, error => {
      if (error?.code === 'signed-out' || error?.status === 401) { signedIn = false; return; }
      problem = 'unreached';
      schedule(RETRY[Math.min(retry++, RETRY.length - 1)]);
    }).finally(() => { working = null; changed(); });
    changed();
    return working;
  }

  /** The page is going away or out of sight: what changed since the last save, as a keepalive request. */
  function saveOnLeave() {
    const rec = record();
    if (!signedIn || rec.off || !rec.joined || !rec.owed || working) return;
    const {copy} = mergeCopies({mine: mine(rec), theirs: {}, now: d.now()});
    const body = {base: rec.version, copy};
    if (bytes(JSON.stringify(body)) > KEEPALIVE_MAX) return; // too big to outlive the page: the next start sends it
    d.cancel(timer);
    const mark = changes;
    d.api(PATH, {method: 'PUT', body, fetchFn: (url, init) => d.fetch(url, {...init, keepalive: true})}).then(saved => {
      const now = record();
      keep({...now, version: String(saved.version), savedAt: d.now(), owed: now.owed && changes !== mark});
      changed();
    }, () => {}); // a conflict or a failure: still owed, so the next exchange merges and saves it
  }

  const ready = (async () => {
    signedIn = !!(await d.session().catch(() => null));
    changed();
    if (!signedIn) return; // signed out: nothing is hooked and nothing is sent
    for (const k of BACKUP_KEYS) snapshot(k);
    hearWrites();
    d.doc?.addEventListener?.('visibilitychange', () => {
      if (d.doc.visibilityState === 'hidden') { hiddenAt = d.now(); saveOnLeave(); }
      else if (hiddenAt && d.now() - hiddenAt > AWAY) { hiddenAt = 0; exchange(); }
      else hiddenAt = 0;
    });
    d.win?.addEventListener?.('online', () => { if (record().owed) schedule(5000); });
    // After the first paint and whatever the page does first: never in the way of start-up.
    d.idle(() => exchange());
  })();

  return {
    ready,
    state: () => { const rec = record(); return {signedIn, on: !rec.off, savedAt: rec.savedAt, fetchedAt: rec.fetchedAt, working: !!working, problem}; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** On again: as a phone that never merged, so both sides are put together and nothing is lost. */
    setOn(on) {
      if (on === !record().off) return;
      d.cancel(timer);
      keep(on ? fresh() : {...record(), off: true});
      problem = '';
      changed();
      if (on) { for (const k of BACKUP_KEYS) snapshot(k); exchange(); }
    },
    syncNow: () => exchange(),
    /** Deletes the copy on the server, with its daily copies; this phone stops keeping one. */
    async removeCopy() {
      try { await d.api(PATH, {method: 'DELETE'}); } catch (error) {
        // api() reads a JSON answer; the Worker's 204 has none, which is the success it says it is.
        if (error?.status !== 204) return {ok: false, message: error?.message || 'Your server could not be reached.'};
      }
      d.cancel(timer);
      keep({...fresh(), off: true});
      changed();
      return {ok: true};
    },
  };
}
