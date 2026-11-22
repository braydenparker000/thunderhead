// @ts-check
// The whole-site report (MENU-AND-SETTINGS.md §6.8, Settings › About › Copy report), beside the editor's
// (journal.js): one JSON for whoever helps the owner with a phone that misbehaves, copied, never sent.
// Numbers and states only: `build` takes what the phone and the Worker hand it and keeps each field only
// as a number, a state from a known list or a code-shaped name (a cache, a scope, file:line), so the
// owner's words, titles, names and addresses never reach it (tests/site-report.test.mjs plants them).
// It holds the release and commit; the Worker's tag and deep health (GET /v1/ops/health/deep: schema
// versions and each object's `missing`, when the Worker sends it); each service worker's state and every
// cache with its entries and bytes; storage used, quota and persisted; push permission and whether a
// subscription exists; the network type; the look and theme; the last 20 client errors as code and
// file:line (GET /v1/ops/errors); open watchdog trips (GET /v1/ops/watchdogs); the data meter's totals by
// part (th/data/); the mind's state (`mind.status`) and today's wakes (GET /v1/mind/usage); and when each
// app last synced (the Worker's `next_since` of its last pull, as Music, Guitar and Podcasts keep it).
import { MUSIC, parse, totals } from '../data/tally.js';

/** The report's ceiling in bytes. */
export const LIMIT = 60 * 1024;

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (/** @type {unknown} */ v) => (typeof v === 'boolean' ? v : null);
/** @param {unknown} v @param {readonly string[]} states */
const one = (v, states) => (typeof v === 'string' && states.includes(v) ? v : null);
/** @param {unknown} v @param {RegExp} shape */
const like = (v, shape) => (typeof v === 'string' && shape.test(v) ? v : null);
/** @param {unknown} v @param {number} max @returns {any[]} */
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
/** The newest of some times, or null. @param {unknown[]} vs */
const newest = (vs) => { const n = Math.max(0, ...vs.map((v) => num(v) ?? 0)); return n > 0 ? n : null; };

const SW = ['parsed', 'installing', 'installed', 'activating', 'activated', 'redundant'];
const MIND = ['working', 'listening', 'stopping', 'limited', 'asleep', 'waking', 'failed', 'unconfigured'];
const CODE = /^[a-z0-9]{1,16}(\.[a-z0-9_-]{1,24}){0,3}$/i;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The client error's place in the site's code, `file:line`, from its message (ui/error-items.js). @param {unknown} message */
const place = (message) => {
  const m = typeof message === 'string' ? / @ \/([A-Za-z0-9._/-]{1,160}):(\d{1,7}):\d{1,7}$/.exec(message) : null;
  return m ? `${m[1]}:${m[2]}` : null;
};

/** Deep health as counts and states. @param {any} d */
function deepOf(d) {
  if (!d || typeof d !== 'object') return null;
  /** @type {Record<string, unknown>} */
  const objects = {};
  /** @type {Record<string, number | null>} */
  const schema = {};
  for (const [k, o] of Object.entries(d.objects ?? {}).slice(0, 12)) {
    if (!/^[a-z]{1,16}$/.test(k) || !o || typeof o !== 'object') continue;
    objects[k] = { ok: bool(o.ok), schema: num(o.schema), expected: num(o.expected), missing: Array.isArray(o.missing) ? o.missing.slice(0, 50).map(num) : null, db_bytes: num(o.db_bytes), jobs_backlog: num(o.jobs_backlog) };
  }
  for (const [k, v] of Object.entries(d.schema ?? {}).slice(0, 12)) if (/^[a-z]{1,16}$/.test(k)) schema[k] = num(v);
  const m = d.meter_today ?? {};
  return {
    ok: bool(d.ok), schema, objects,
    meter_today: { rows_read: num(m.rows_read), rows_written: num(m.rows_written), bulk_rows_written: num(m.bulk_rows_written) },
    last_backup_age_h: num(d.last_backup?.age_h), errors_open: num(d.errors_open), wakes_today: num(d.wakes_today), min_client: num(d.min_client),
  };
}

/** The data meter's totals by part, today and this month, each [wifi, mobile, unknown] bytes. @param {unknown} tally @param {number} now */
function meterOf(tally, now) {
  const t = parse(tally, now), all = totals(t, now);
  const span = (/** @type {ReturnType<typeof totals>['today']} */ s) => {
    /** @type {Record<string, number[]>} */
    const parts = {};
    for (const row of s.rows) {
      parts[row.id] = row.split;
      row.pieces?.forEach((p, i) => { parts[MUSIC[i][0]] = p.split; });
    }
    return { all: s.all, parts };
  };
  return { since: t.since, unsized: t.unsized, today: span(all.today), month: span(all.month) };
}

/**
 * The report from what was gathered (`gather`); pure, for the test.
 * @param {any} raw
 */
export function build(raw) {
  const r = raw ?? {}, c = r.config ?? {}, now = num(r.now) ?? 0, p = r.presence ?? {}, u = r.usage?.today ?? {};
  const sum = (/** @type {unknown} */ o) => (o && typeof o === 'object' ? Object.values(o).reduce((n, v) => n + (num(v) ?? 0), 0) : null);
  const client = list(r.errors, 500).filter((e) => e?.source === 'client').sort((a, b) => (num(b.last_at) ?? 0) - (num(a.last_at) ?? 0));
  const out = {
    v: 1,
    at: now,
    release: { build: num(c.build), commit: like(c.commit, /^([0-9a-f]{7,40}|dev)$/), preview: Boolean(c.preview) },
    worker: { tag: like(r.health?.version?.tag, /^[A-Za-z0-9._-]{1,40}$/), id: like(r.health?.version?.id, /^[0-9a-f-]{1,40}$/i), min_client: num(r.health?.min_client), deep: deepOf(r.deep) },
    controlled: bool(r.controlled),
    workers: list(r.workers, 10).map((w) => ({ scope: like(w?.scope, /^\/[a-z0-9/_-]{0,60}$/), active: one(w?.active, SW), waiting: one(w?.waiting, SW), installing: one(w?.installing, SW) })),
    caches: list(r.caches, 40).map((k) => ({ name: like(k?.name, NAME) ?? 'other', entries: num(k?.entries), bytes: num(k?.bytes), more: Boolean(k?.more) })),
    storage: { usage: num(r.storage?.usage), quota: num(r.storage?.quota), persisted: bool(r.storage?.persisted) },
    push: { permission: one(r.push?.permission, ['granted', 'denied', 'default']), subscribed: bool(r.push?.subscribed) },
    network: { type: one(r.network?.type, ['bluetooth', 'cellular', 'ethernet', 'none', 'wifi', 'wimax', 'other', 'unknown']), effective: one(r.network?.effective, ['slow-2g', '2g', '3g', '4g']), save_data: bool(r.network?.saveData), online: bool(r.network?.online) },
    look: like(r.look, /^[a-z-]{1,16}$/), theme: one(r.theme, ['light', 'dark']), theme_choice: one(r.themeChoice, ['auto', 'light', 'dark']),
    errors: client.slice(0, 20).map((e) => ({ code: like(e.code, CODE), at: place(e.message), count: num(e.count), last_at: num(e.last_at), build: num(e.last_build) })),
    watchdogs: list(r.watchdogs, 60).filter((w) => w?.state === 'tripped').slice(0, 30)
      .map((w) => ({ name: like(w.name, /^[a-z]{1,16}(\.[a-z_]{1,24}){1,2}$/), severity: one(w.severity, ['S2', 'S3', 'S4']), since: num(w.since), handled: one(w.handled?.outcome, ['fixed', 'reported', 'nothing']), handled_at: num(w.handled?.at) })),
    data: meterOf(r.tally, now),
    mind: { state: one(p.state, MIND), since: num(p.since), wakes_today: sum(u.wakes), awake_min_today: sum(u.minutes), night_min_today: num(u.night_min), wake_budget: num(r.usage?.budget), waiting: num(r.usage?.live) },
    synced: {
      music: newest([r.sync?.music?.marks, r.sync?.music?.lists]),
      guitar: newest([r.sync?.guitar?.since]),
      podcasts: newest(Object.values(r.sync?.podcasts?.since ?? {})),
    },
  };
  // Never over the ceiling: the longest lists give way first (they are capped well under it).
  while (new TextEncoder().encode(JSON.stringify(out)).length >= LIMIT && (out.caches.length || out.errors.length)) (out.caches.length ? out.caches : out.errors).pop();
  return out;
}

/** Each cache of this site: its entries and their bytes (Content-Length, else the body's size), up to 2,000 entries a cache. */
async function cacheSizes() {
  const out = [];
  for (const name of (await caches.keys()).slice(0, 40)) {
    const cache = await caches.open(name), keys = await cache.keys(), some = keys.slice(0, 2000);
    let bytes = 0;
    for (const req of some) {
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length'));
      bytes += len > 0 ? len : res ? (await res.blob()).size : 0;
    }
    out.push({ name, entries: keys.length, bytes, more: keys.length > some.length });
  }
  return out;
}

/** What the report is made from, on this phone and from the Worker; whatever cannot be read is null. */
export async function gather() {
  const [{ api, configured, signedIn }, { CONFIG }] = await Promise.all([import('/th/client.js'), import('/config.js')]);
  /** @template T @param {() => T | Promise<T>} f @returns {Promise<T | null>} */
  const settle = async (f) => { try { return await f(); } catch { return null; } };
  const call = (/** @type {string} */ path) => (configured ? settle(() => signedIn((t) => api.call(path, { token: t }))) : Promise.resolve(null));
  const kept = (/** @type {string} */ k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const regs = (await settle(() => navigator.serviceWorker.getRegistrations())) ?? [];
  const shell = regs.find((g) => new URL(g.scope).pathname === '/');
  const [health, deep, errors, watchdogs, settings, usage, sizes, estimate, persisted, subscription] = await Promise.all([
    configured ? settle(() => api.health()) : null,
    call('/v1/ops/health/deep'), call('/v1/ops/errors?limit=50'), call('/v1/ops/watchdogs'), call('/v1/settings'), call('/v1/mind/usage'),
    settle(cacheSizes), settle(() => navigator.storage.estimate()), settle(() => navigator.storage.persisted()),
    shell ? settle(() => shell.pushManager.getSubscription()) : null,
  ]);
  const net = /** @type {any} */ (navigator).connection, root = document.documentElement.dataset;
  return {
    now: Date.now(),
    config: CONFIG,
    health, deep, errors: errors?.items, watchdogs: watchdogs?.items, presence: settings?.['mind.status'], usage,
    controlled: Boolean(navigator.serviceWorker?.controller),
    workers: regs.map((g) => ({ scope: new URL(g.scope).pathname, active: g.active?.state ?? null, waiting: g.waiting?.state ?? null, installing: g.installing?.state ?? null })),
    caches: sizes,
    storage: { usage: estimate?.usage, quota: estimate?.quota, persisted },
    push: { permission: 'Notification' in window ? Notification.permission : null, subscribed: Boolean(subscription) },
    network: { type: net?.type, effective: net?.effectiveType, saveData: net?.saveData, online: navigator.onLine },
    look: root.look, theme: root.theme, themeChoice: (() => { try { return localStorage.getItem('th-theme') || 'auto'; } catch { return null; } })(),
    tally: kept('th.p.data'),
    sync: { music: kept('th.p.music.sync'), guitar: kept('th.p.guitar.sync'), podcasts: kept('th.p.podcasts.sync') },
  };
}

/** Gathers, builds and copies the report; its size in bytes. */
export async function copyReport() {
  const text = JSON.stringify(build(await gather()));
  await navigator.clipboard.writeText(text);
  return new TextEncoder().encode(text).length;
}
