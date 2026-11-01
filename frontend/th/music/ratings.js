// @ts-check
// The owner's song ratings, as senses for the Worker (MUSIC.md §10.1 `music.rate`, §10.5), so the
// mind's find and mixes leave out what the owner rated "not for me" (1): every rating set in Music
// (its rating widget, a playlist import, home's "never play this again", which rates through the same
// library), from the library's own `msg_data_track_rating_changed`; and once, the songs rated 1
// before this, CATCH_UP a page load and never more than the senses outbox has room for (it drops
// its oldest past 200), each remembered on this phone as sent only once the Worker took it. Ids and
// numbers only. th/senses/send.js sends them, signed in (it reads the session; nothing here touches
// it). Loaded by th/music/dj.js `installDj`, which the player runs.

/** Songs the catch-up sends at most each time the player loads. */
export const CATCH_UP = 100;
const DONE = 'th.music.rated';
/** When the catch-up runs after the player starts (its library has loaded by then). */
const CATCH_UP_AFTER_MS = 20_000;
/** Room the catch-up leaves in the outbox for the page's other events meanwhile. */
export const ROOM_MARGIN = 50;

/** A song's ref, when its id fits the ref grammar (DATA.md §2.3). @param {unknown} id */
export const refOf = (id) => (typeof id === 'string' && /^[A-Za-z0-9._:/-]{1,154}$/.test(id) ? `music:${id}` : null);

/** The sense for one rating: its type, ref and data, or null for an id that can't be a ref.
 * @param {unknown} id @param {unknown} rating @param {number | undefined} from
 * @returns {[string, string, Record<string, unknown>] | null} */
export function rateSense(id, rating, from) {
  const ref = refOf(id);
  const r = Number(rating);
  if (!ref || !Number.isInteger(r) || r < 0 || r > 5) return null;
  return ['music.rate', ref, from === undefined ? { rating: r } : { rating: r, from }];
}

/** The catch-up's next songs: rated 1, not sent before, at most `max`, in library order.
 * @param {{ id?: unknown, rating?: unknown }[]} tracks @param {Set<string>} sent @param {number} [max] */
export function catchUp(tracks, sent, max = CATCH_UP) {
  /** @type {string[]} */
  const out = [];
  for (const t of tracks) {
    if (out.length >= max) break;
    if (t?.rating === 1 && typeof t.id === 'string' && refOf(t.id) && !sent.has(t.id)) out.push(t.id);
  }
  return out;
}

/** @param {Storage} store @returns {Set<string>} */
function sentBefore(store) {
  try {
    const v = JSON.parse(store.getItem(DONE) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The senses outbox (th/senses/send.js), or null where it can't load.
 * @typedef {{ sense: (type: string, ref: string, data: Record<string, unknown>) => Promise<boolean>,
 *   room: () => number, flush: () => Promise<void>, drained: () => boolean }} Outbox
 * @returns {Promise<Outbox | null>} */
const outbox = () => import('/th/senses/send.js').catch(() => null);

/** One catch-up: the next songs rated 1, as many as the outbox has room for (less a margin), sent
 * now; remembered as sent only if the outbox then holds nothing (the Worker took them), else the
 * next load sends them again (the same rating again changes nothing).
 * @param {{ id?: unknown, rating?: unknown }[]} tracks @param {Outbox | null} out @param {Storage} store
 * @returns {Promise<string[]>} the songs now remembered as sent */
export async function runCatchUp(tracks, out, store) {
  if (!out) return [];
  const sent = sentBefore(store);
  /** @type {string[]} */
  const queued = [];
  for (const id of catchUp(tracks, sent, Math.min(CATCH_UP, out.room() - ROOM_MARGIN))) {
    const s = rateSense(id, 1, undefined);
    // Signed out, or in another's frame: nothing is kept, and the next load tries again.
    if (!s || !(await out.sense(...s))) break;
    queued.push(id);
  }
  if (!queued.length) return [];
  await out.flush();
  if (!out.drained()) return [];
  for (const id of queued) sent.add(id);
  try {
    store.setItem(DONE, JSON.stringify([...sent]));
  } catch {}
  return queued;
}

/** @param {any} ctx the player's context: its bus and its library */
export function installRatings(ctx) {
  /** Each song's rating as last seen here, for `from`. @type {Map<string, number>} */
  const known = new Map();
  ctx.bus?.subscribe?.('bus_data', (/** @type {string} */ msg, /** @type {unknown} */ _src, /** @type {any} */ d) => {
    if (msg !== 'msg_data_track_rating_changed' || !d?.track?.id) return;
    const rating = Number(d.arg1 ?? d.track.rating ?? 0);
    const s = rateSense(d.track.id, rating, known.get(d.track.id));
    known.set(d.track.id, rating);
    if (s) void outbox().then((out) => out?.sense(...s)).catch(() => {});
  });
  setTimeout(async () => {
    const tracks = ctx.library?.tracks ?? [];
    for (const t of tracks) if (typeof t?.id === 'string' && !known.has(t.id)) known.set(t.id, Number(t.rating) || 0);
    if (navigator.onLine) await runCatchUp(tracks, await outbox(), localStorage);
  }, CATCH_UP_AFTER_MS);
}
