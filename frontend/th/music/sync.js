// @ts-check
// Music's own data on every phone (MUSIC.md §1.4), modelled on Guitar's and Podcasts' sync
// (th/guitar/progress.js, th/podcasts/progress.js). The player keeps the owner's data in its
// IndexedDB `claude-player`: each catalog song's rating (5 the like, 1 "not for me", which is also
// home's "never play this again"), play count and last played in `state` `u:<id>`, and the playlists
// in `state` `pl:<id>`. This module sends and takes them, one record per song and one per playlist
// (GET/PUT /v1/music/marks and /v1/music/playlists):
// - when Music opens and when it is shown again, what the Worker took since the last time is merged:
//   a rating newer than this phone's (its `ratedAt`, stamped here when the owner rates) replaces it;
//   plays keep the larger count and the later time; a playlist newer than this phone's replaces it
//   whole, and a newer deletion removes it;
// - after a change (debounced, 20 s), on hiding the page and when the network returns, the songs and
//   playlists changed since the last push go up; a playlist deleted here goes up as a deleted record
//   (the Worker keeps it 30 days, so another phone's older copy does not bring it back). The first
//   time, every song this phone has rated or played goes up, at most CATCH_UP a push.
// It changes nothing about how Music looks or what plays: only data from another phone lands, into
// the same fields the player already reads (a remote rating tells the rows with the player's own
// message, marked `synced` so th/music/ratings.js does not send it back as a sense). Songs imported
// from files on this phone have no Worker id and stay here. Times go up on the Worker's clock
// (`offset`, as Guitar keeps it). Only signed in, in a top-level page or one of home's own frames.
// What it remembers is `th.p.music.sync`, cleared on sign-out. Loaded by th/music/dj.js `installDj`.
import { CONFIG } from '../../config.js';
import { framedByOther, sessionToken } from '../ported/session.js';

/** The Worker's limits this module keeps to (MUSIC_SYNC_LIMITS in shared/contract/music-sync.ts;
 * tests/music-sync.test.mjs checks they agree). */
export const L = Object.freeze({ batch_marks: 200, batch_playlists: 20, playlist_ids: 5000, page_max: 200 });
/** The Worker's song ids (SONG_ID in backend/src/areas/music/shapes.ts). */
export const SONG_ID = /^r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
export const SYNC_KEY = 'th.p.music.sync';
/** Songs the first sync sends at most in one push (the rest at the next). */
export const CATCH_UP = 1000;
const DEBOUNCE_MS = 20_000;
/** One playlists request's body: under the Worker's 512 KB limit for it. */
const BODY_BYTES = 480_000;
const KEEPALIVE_BYTES = 8_000;
const PAGES = 60;
const LIBRARY_WAIT_MS = 30_000;

/** `marks`/`lists`: each route's `next_since`. `dirty`: songs changed since the Worker took them,
 * each with a count of its changes (a push clears a song only if no change came while it was sent).
 * `sent`: per playlist, the `modified` (phone clock) the Worker has. `gone`: playlists deleted here,
 * when (phone clock), not yet taken. `caught`: the first sync's songs are queued. `reset`: Settings →
 * Reset stats here (phone clock), not yet taken; `resetSeen`: the newest reset applied or sent (the
 * Worker's clock). `offset`: the Worker's clock minus the phone's, ms.
 * @typedef {{ v: 1, marks: number, lists: number, dirty: Record<string, number>, sent: Record<string, number>,
 *   gone: Record<string, number>, caught?: boolean, reset?: number, resetSeen?: number, offset?: number }} Memory */
/** @typedef {import('../../../shared/contract/music-sync.ts').MusicMark} Mark */
/** @typedef {import('../../../shared/contract/music-sync.ts').MusicPlaylist} Playlist */

export const deps = {
  /** @type {typeof fetch} */
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  storage: () => /** @type {Storage} */ (localStorage),
  token: sessionToken,
  framed: framedByOther,
  api: () => CONFIG.api,
  online: () => navigator.onLine,
};

/** @param {Storage} storage @returns {Memory} */
export function loadMemory(storage) {
  try {
    const m = JSON.parse(storage.getItem(SYNC_KEY) || 'null');
    if (m?.v === 1 && m.dirty && m.sent && m.gone) return m;
  } catch {}
  return { v: 1, marks: 0, lists: 0, dirty: {}, sent: {}, gone: {} };
}
/** @param {Storage} storage @param {Memory} mem */
function saveMemory(storage, mem) {
  try {
    storage.setItem(SYNC_KEY, JSON.stringify(mem));
  } catch {}
}
/** @param {Memory} mem @param {unknown} at @param {number} t0 @param {number} t1 */
function setOffset(mem, at, t0, t1) {
  if (Number.isFinite(Number(at)) && Number(at) > 0) mem.offset = Math.round(Number(at) - (t0 + t1) / 2);
}

/** The Worker's songs into the library where they are newer (a rating) or more (plays). Returns the
 * songs changed. @param {any} ctx @param {Memory} mem @param {Mark[]} items */
export function applyMarks(ctx, mem, items) {
  const lib = ctx.library, off = mem.offset ?? 0;
  let n = 0;
  for (const m of items) {
    const t = lib?.byId?.get(m?.id);
    if (!t) continue;
    let changed = false;
    if (Number.isInteger(m.rating) && Number(m.rated_at) > 0) {
      // Compared on the Worker's clock: a song never rated here (no stamp) takes any rating.
      const here = Number.isFinite(t.ratedAt) ? t.ratedAt + off : 0;
      if (Number(m.rated_at) > here) {
        const was = t.rating ?? 0;
        t.ratedAt = Math.round(Number(m.rated_at) - off);
        changed = true;
        if (m.rating !== was) {
          t.rating = m.rating;
          ctx.bus?.post?.('bus_data', 'msg_data_track_rating_changed', lib, { track: t, arg1: t.rating, synced: true });
        }
      }
    }
    // Plays from before a reset (this phone's, not yet sent, or the newest seen) are not counted.
    const from = Math.max((mem.resetSeen ?? 0) - off, Number(mem.reset) || 0);
    const fresh = Number(m.last_played) > 0 && Number(m.last_played) - off > from;
    const plays = Math.max(Number(t.plays) || 0, fresh ? Number(m.plays) || 0 : 0);
    const last = Math.max(Number(t.lastPlayed) || 0, fresh ? Math.round(Number(m.last_played) - off) : 0);
    if (plays !== (Number(t.plays) || 0) || last !== (Number(t.lastPlayed) || 0)) {
      t.plays = plays;
      t.lastPlayed = last;
      changed = true;
    }
    if (changed) {
      void lib.saveTrack?.(t)?.catch?.(() => {});
      n++;
    }
  }
  return n;
}

/** A Reset stats from another phone (`at`, the Worker's clock): every song last played before it
 * goes back to no plays here too, as the reset did there. Returns the songs changed.
 * @param {any} ctx @param {Memory} mem @param {unknown} at */
export function applyReset(ctx, mem, at) {
  const r = Number(at) || 0, off = mem.offset ?? 0;
  if (r <= (mem.resetSeen ?? 0)) return 0;
  mem.resetSeen = r;
  let n = 0;
  for (const t of ctx.library?.remoteTracks ?? ctx.library?.tracks ?? []) {
    if (!(Number(t?.plays) > 0 || Number(t?.lastPlayed) > 0) || Number(t.lastPlayed) + off > r) continue;
    t.plays = 0;
    t.lastPlayed = 0;
    void ctx.library.saveTrack?.(t)?.catch?.(() => {});
    n++;
  }
  return n;
}

/** The songs changed since the Worker took them, at most `max`, on the Worker's clock.
 * @param {any} ctx @param {Memory} mem @param {number} [max] @returns {Mark[]} */
export function marksToSend(ctx, mem, max = CATCH_UP) {
  const off = mem.offset ?? 0;
  /** @type {Mark[]} */
  const out = [];
  for (const id of Object.keys(mem.dirty)) {
    if (out.length >= max) break;
    const t = ctx.library?.byId?.get(id);
    if (!t || !SONG_ID.test(id)) {
      delete mem.dirty[id];
      continue;
    }
    const r = Number(t.rating) || 0;
    // A rating from before this sync has no stamp: the oldest time, so any stamped one wins over it.
    const ratedAt = Number.isFinite(t.ratedAt) ? Math.max(1, Math.round(t.ratedAt + off)) : r ? 1 : 0;
    const last = Number(t.lastPlayed) > 0 ? Math.round(Number(t.lastPlayed) + off) : 0;
    out.push({
      id,
      rating: ratedAt ? r : null,
      rated_at: ratedAt || null,
      plays: Math.max(0, Math.floor(Number(t.plays) || 0)),
      last_played: last,
      updated_at: Math.max(1, ratedAt, last),
    });
  }
  return out;
}

/** The Worker's playlists into the player where they are newer than this phone's (a deletion
 * removes it). Returns how many were taken. @param {any} ctx @param {Memory} mem @param {Playlist[]} items */
export function applyPlaylists(ctx, mem, items) {
  const P = ctx.playlists, off = mem.offset ?? 0;
  if (!P) return 0;
  let n = 0;
  for (const p of items) {
    if (!p || typeof p.id !== 'string') continue;
    const local = P.get(p.id);
    const here = local ? Number(local.modified) || 0 : mem.gone[p.id] ?? 0;
    if (here && here + off >= p.updated_at) continue;
    const at = Math.round(p.updated_at - off);
    delete mem.gone[p.id];
    if (p.deleted) {
      delete mem.sent[p.id];
      if (!local) continue;
      applying = true;
      try {
        P.items = P.items.filter((/** @type {any} */ x) => x !== local);
        P.library?.db?.deleteState?.('pl:' + p.id)?.catch?.(() => {});
        P.changed(local);
      } finally {
        applying = false;
      }
    } else {
      const pl = local ?? { id: p.id };
      Object.assign(pl, { name: p.name, ids: [...p.ids], created: p.created, modified: at });
      if (p.path) pl.path = p.path;
      else delete pl.path;
      if (!local) P.items.push(pl);
      mem.sent[p.id] = at;
      P.library?.db?.setState?.('pl:' + p.id, pl)?.catch?.(() => {});
      applying = true;
      try {
        P.changed(pl);
      } finally {
        applying = false;
      }
    }
    n++;
  }
  return n;
}

/** The playlists changed or deleted since the Worker took them, on its clock. A playlist the Worker
 * had that is no longer here (deleted while the player was closed) goes as deleted.
 * @param {any} ctx @param {Memory} mem @returns {Playlist[]} */
export function playlistsToSend(ctx, mem) {
  const off = mem.offset ?? 0, now = deps.now();
  const items = ctx.playlists?.items ?? [];
  const have = new Set(items.map((/** @type {any} */ p) => p.id));
  for (const id of Object.keys(mem.sent)) if (!have.has(id) && !(id in mem.gone)) mem.gone[id] = now;
  /** @type {Playlist[]} */
  const out = [];
  for (const p of items) {
    const at = Math.round(Number(p.modified) || 0);
    if (at <= 0 || (mem.sent[p.id] ?? 0) >= at || !/^[a-z0-9]{4,40}$/.test(p.id)) continue;
    const ids = (Array.isArray(p.ids) ? p.ids : []).filter((/** @type {unknown} */ x) => typeof x === 'string' && x).slice(0, L.playlist_ids);
    out.push({ id: p.id, name: String(p.name ?? ''), ids, created: Math.max(0, Number(p.created) || 0), path: typeof p.path === 'string' ? p.path : null, deleted: false, updated_at: at + off });
  }
  for (const [id, at] of Object.entries(mem.gone))
    if (/^[a-z0-9]{4,40}$/.test(id)) out.push({ id, name: '', ids: [], created: 0, path: null, deleted: true, updated_at: Math.max(1, Math.round(at + off)) });
  return out;
}

/** Requests of at most `max` items and `bytes`. @template T @param {T[]} items @param {number} max @param {number} bytes @returns {T[][]} */
export function chunks(items, max, bytes) {
  /** @type {T[][]} */
  const out = [];
  let cur = /** @type {T[]} */ ([]);
  let size = 20;
  for (const it of items) {
    const s = JSON.stringify(it).length + 1;
    if (cur.length && (cur.length >= max || size + s > bytes)) {
      out.push(cur);
      cur = [];
      size = 20;
    }
    cur.push(it);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

let applying = false;
/** @type {string | null} */
let token = null;
const tokenOf = async () => (token ??= deps.framed() ? null : await deps.token());

/** @param {string} method @param {string} path @param {string} t @param {unknown} [body] */
async function call(method, path, t, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  try {
    const r = await deps.fetch(`${deps.api()}/v1/music/${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(text ? { 'Content-Type': 'application/json' } : {}) },
      body: text,
      keepalive: Boolean(text && text.length < KEEPALIVE_BYTES),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
    if ([401, 403].includes(r.status)) token = null;
    return r;
  } catch {
    return null;
  }
}

/** Every page since `since` of one route, or null when a request failed.
 * @param {'marks' | 'playlists'} route @param {number} since @param {string} t @param {Memory} mem */
async function pages(route, since, t, mem) {
  /** @type {any[]} */
  const items = [];
  let q = `?since=${since}`;
  for (let page = 0; page < PAGES; page++) {
    const t0 = deps.now();
    const r = await call('GET', route + q, t);
    if (!r?.ok) return null;
    const b = await r.json();
    setOffset(mem, b.next_since, t0, deps.now());
    items.push(...(Array.isArray(b.items) ? b.items : []));
    if (!b.next) return { items, since: Number(b.next_since) || since, reset_at: Number(b.reset_at) || 0 };
    q = `?cursor=${encodeURIComponent(b.next)}`;
  }
  return null;
}

/** Merges what was remembered meanwhile (a push may have finished) into `mem`. @param {Memory} mem @param {Memory} latest */
function keepLatest(mem, latest) {
  for (const [k, at] of Object.entries(latest.sent)) mem.sent[k] = Math.max(mem.sent[k] ?? 0, at);
  mem.offset ??= latest.offset;
}

/** What changed since the last pull, merged; the first time, every rated or played song is queued.
 * @param {any} ctx */
async function pullNow(ctx) {
  const t = deps.api() && deps.online() ? await tokenOf() : null;
  if (!t) return;
  const storage = deps.storage();
  const mem = loadMemory(storage);
  const marks = await pages('marks', mem.marks, t, mem);
  const lists = marks && (await pages('playlists', mem.lists, t, mem));
  if (!marks || !lists) return;
  const latest = loadMemory(storage);
  keepLatest(mem, latest);
  // Changes made here while the pages came are in the storage, not in `mem`.
  mem.dirty = latest.dirty;
  mem.gone = latest.gone;
  mem.reset = latest.reset;
  mem.resetSeen = Math.max(mem.resetSeen ?? 0, latest.resetSeen ?? 0);
  // A reset first, so the plays that come with it are counted from it.
  applyReset(ctx, mem, marks.reset_at);
  applyMarks(ctx, mem, marks.items);
  applyPlaylists(ctx, mem, lists.items);
  if (!mem.caught) {
    for (const s of ctx.library?.remoteTracks ?? ctx.library?.tracks ?? [])
      if (SONG_ID.test(s?.id) && (Number(s.rating) > 0 || Number(s.plays) > 0)) mem.dirty[s.id] ??= 1;
    mem.caught = true;
  }
  mem.marks = marks.since;
  mem.lists = lists.since;
  saveMemory(storage, mem);
}

/** The changed songs and playlists up; one the Worker refused stays queued. @param {any} ctx */
async function pushNow(ctx) {
  const t = deps.api() && deps.online() ? await tokenOf() : null;
  if (!t) return;
  const storage = deps.storage();
  const mem = loadMemory(storage);
  // Not before a pull has come back: until then the clock's offset is unknown.
  if (!mem.marks) return;
  // What went up, as it was when it went: each song's change count, each playlist's own stamp
  // (phone clock) and a reset's time; a change made meanwhile stays queued.
  const done = {
    /** @type {[string, number][]} */ songs: [],
    /** @type {[string, number, boolean][]} */ lists: [],
    /** @type {number | null} */ reset: null,
  };
  const counts = { ...mem.dirty };
  const marks = marksToSend(ctx, mem);
  const reset = Number(mem.reset) > 0 ? Math.round(Number(mem.reset) + (mem.offset ?? 0)) : 0;
  const markBatches = chunks(marks, L.batch_marks, 60_000);
  if (reset && !markBatches.length) markBatches.push([]);
  for (const [k, batch] of markBatches.entries()) {
    const t0 = deps.now();
    const withReset = reset && k === 0;
    const r = await call('PUT', 'marks', t, withReset ? { items: batch, reset_at: reset } : { items: batch });
    const b = r?.ok ? await r.json().catch(() => null) : null;
    if (!b) break;
    setOffset(mem, b.at, t0, deps.now());
    if (withReset) done.reset = Number(mem.reset);
    const refused = new Set((Array.isArray(b.refused) ? b.refused : []).map((/** @type {{ index: number }} */ x) => x.index));
    batch.forEach((m, i) => refused.has(i) || done.songs.push([m.id, counts[m.id]]));
  }
  const listOffset = mem.offset ?? 0;
  for (const batch of chunks(playlistsToSend(ctx, mem), L.batch_playlists, BODY_BYTES)) {
    const t0 = deps.now();
    const r = await call('PUT', 'playlists', t, { items: batch });
    const b = r?.ok ? await r.json().catch(() => null) : null;
    if (!b) break;
    setOffset(mem, b.at, t0, deps.now());
    const refused = new Set((Array.isArray(b.refused) ? b.refused : []).map((/** @type {{ index: number }} */ x) => x.index));
    batch.forEach((p, i) => refused.has(i) || done.lists.push([p.id, Math.round(p.updated_at - listOffset), p.deleted]));
  }
  // Read again: a change or a pull may have landed meanwhile; only what went up, unchanged since, is cleared.
  const latest = loadMemory(storage);
  for (const [id, n] of done.songs) if (latest.dirty[id] === n) delete latest.dirty[id];
  for (const [id, at, deleted] of done.lists) {
    if (!deleted) latest.sent[id] = Math.max(latest.sent[id] ?? 0, at);
    else if (!(id in latest.gone) || Math.round(latest.gone[id]) === at) {
      delete latest.gone[id];
      delete latest.sent[id];
    }
  }
  // Deletions found here (a playlist gone while the player was closed) that did not go up stay queued.
  for (const [id, at] of Object.entries(mem.gone)) if (!done.lists.some(([x]) => x === id)) latest.gone[id] ??= at;
  if (done.reset !== null) {
    latest.resetSeen = Math.max(latest.resetSeen ?? 0, reset);
    if (latest.reset === done.reset) delete latest.reset;
  }
  latest.offset = mem.offset ?? latest.offset;
  saveMemory(storage, latest);
}

/** One at a time, and once more if asked meanwhile. @param {(ctx: any) => Promise<void>} fn */
function serial(fn) {
  /** @type {Promise<void> | null} */
  let running = null;
  let again = false;
  /** @param {any} ctx @returns {Promise<void>} */
  const go = (ctx) => {
    if (running) {
      again = true;
      return running;
    }
    running = fn(ctx)
      .catch(() => {})
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void go(ctx);
        }
      });
    return running;
  };
  return go;
}
export const pull = serial(pullNow);
export const push = serial(pushNow);

/** For tests: forget the token. */
export function reset() {
  token = null;
}

/** The owner's own changes, remembered for the next push: a rating (stamped now), a play, a
 * playlist changed or deleted. Changes this module makes are not the owner's. @param {any} ctx @param {() => void} soon */
export function watch(ctx, soon) {
  const mark = (/** @type {(m: Memory) => void} */ fn) => {
    const storage = deps.storage();
    const mem = loadMemory(storage);
    fn(mem);
    saveMemory(storage, mem);
    soon();
  };
  ctx.bus?.subscribe?.('bus_data', (/** @type {string} */ msg, /** @type {unknown} */ _src, /** @type {any} */ d) => {
    const t = d?.track;
    if (msg === 'msg_data_track_rating_changed' && t?.id && !d.synced && SONG_ID.test(t.id)) {
      t.ratedAt = deps.now();
      void ctx.library?.saveTrack?.(t)?.catch?.(() => {});
      mark((m) => (m.dirty[t.id] = (m.dirty[t.id] ?? 0) + 1));
    } else if (msg === 'msg_data_track_played' && t?.id && SONG_ID.test(t.id))
      mark((m) => (m.dirty[t.id] = (m.dirty[t.id] ?? 0) + 1));
    // Settings → Reset stats (the library's resetStats posts a played message with no track).
    else if (msg === 'msg_data_track_played' && !t) mark((m) => (m.reset = deps.now()));
    else if (msg === 'msg_playlists_changed' && !applying) {
      const pl = d?.playlist;
      const gone = pl?.id && !(ctx.playlists?.items ?? []).includes(pl);
      mark((m) => {
        if (gone) m.gone[pl.id] = deps.now();
      });
    }
  });
}

let started = false;
/** Music opened: once its library is there, a pull, then the pushes and pulls above. Once a page.
 * @param {any} ctx */
export function installSync(ctx) {
  if (started) return;
  started = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const soon = () => {
    if (timer === undefined) timer = setTimeout(() => ((timer = undefined), void push(ctx)), DEBOUNCE_MS);
  };
  const now = () => {
    clearTimeout(timer);
    timer = undefined;
    void push(ctx);
  };
  watch(ctx, soon);
  const begin = Date.now();
  const wait = setInterval(() => {
    if (!ctx.library?.byId?.size && Date.now() - begin < LIBRARY_WAIT_MS) return;
    clearInterval(wait);
    document.addEventListener('visibilitychange', () => (document.hidden ? now() : void pull(ctx)));
    addEventListener('pagehide', now);
    addEventListener('online', now);
    void pull(ctx).then(() => push(ctx));
  }, 1000);
}
