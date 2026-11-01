// `th podcasts new` (RUNTIME.md §12.1, NEXT-BATCH.md part 7): the night's look for new episodes of
// the shows the owner follows (the phone syncs the follows to the Worker). At most 20 shows a night
// (`night_feeds`), each at most once in 20 hours (`check_gap_ms`; a show whose feed failed waits
// 20 h × 2^fails, up to about a week), the longest unchecked first; the rest wait for the next
// night. Each feed comes through the Worker (GET /v1/podcasts/feed, which takes only followed shows
// and counts the night's reads) and is read here with the phone's own reader (th/podcasts/feed.js).
// An episode is new when it was published after the newest one seen at the show's last check (the
// first time: in the last day, and after the follow) and no phone has started it (GET
// /v1/podcasts/progress). The checks go back to the Worker (POST /v1/podcasts/follows/checked), a
// failed feed's too.
//
// The home line is counts only, "2 new episodes in Podcasts." (one: "1 new episode in Podcasts."),
// never a show's name: titles are their publishers' words (outside text), and a surface is read
// back by any session (`th surface ls`). This command places it itself (PUT
// /v1/surfaces/home/line.4, ref app:podcasts, so a tap opens Podcasts) and prints counts only, as
// mind/jobs/study-ingest.mjs does for books. The line counts every show checked in the last 20
// hours, so a refired night still places it.
//
//   → {"checked","failed","waiting","shows_with_new","new_episodes","placed","slot","reason"}
import {parseFeed} from '../../../frontend/th/podcasts/feed.js';
import {parseArgs} from './args.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {EXIT, ThError, invalid, out} from './io.mjs';

const L = CONTRACT.podcasts?.limits ?? {night_feeds: 20, check_gap_ms: 72_000_000, page_max: 500, fail_backoff_max: 3};
/** The home line's slot: the night's own lines take line.1–3 (mind/ROLES.md step 7). */
export const SLOT = 'line.4';
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** How far back a position counts as "started" (a week, and a day for the night itself). */
const STARTED_MS = 8 * DAY;
const PAGES = 10;

/** Every row a paged podcasts route has since `since`. @param {string} path @param {number} since */
async function rows(path, since) {
  const all = [];
  let query = {since, limit: L.page_max};
  for (let page = 0; page < PAGES; page++) {
    const {data} = await request('GET', path, {query});
    all.push(...(data.items ?? []));
    if (!data.next) break;
    query = {cursor: data.next, limit: L.page_max};
  }
  return all;
}

/** How long a show waits after its last check: `check_gap_ms`, doubled for each failed check in a
 * row (up to `fail_backoff_max` doublings). @param {{fails?: number}} f */
export const gapOf = f => L.check_gap_ms * 2 ** Math.min(Math.max(0, f.fails ?? 0), L.fail_backoff_max);

/** The followed shows due a check: never checked, or not for their gap; the longest unchecked
 * first. @param {any[]} follows @param {number} now */
export function due(follows, now) {
  return follows
    .filter(f => f.followed && (f.checked_at === null || f.checked_at === undefined || f.checked_at <= now - gapOf(f)))
    .sort((a, b) => (a.checked_at ?? 0) - (b.checked_at ?? 0) || (a.feed_url < b.feed_url ? -1 : 1));
}

/** One show's feed against its last check: the newest episode's time and how many are new.
 * @param {{feed_url: string, latest_at: number|null, updated_at: number}} f @param {{episodes: any[]}} feed
 * @param {Set<string>} started @param {number} now */
export function freshOf(f, feed, started, now) {
  const since = f.latest_at ?? Math.max(f.updated_at, now - DAY);
  let latest = f.latest_at ?? null;
  let n = 0;
  for (const e of feed.episodes) {
    const t = Date.parse(e.publishedAt);
    if (!Number.isFinite(t) || t > now + HOUR) continue;
    latest = Math.max(latest ?? 0, t);
    if (t > since && !started.has(`${f.feed_url}#${e.id}`)) n++;
  }
  return {feed_url: f.feed_url, latest_at: latest, new_n: n};
}

/** The home line for this many new episodes, counts only (a home line ends with a full stop), or
 * null for none. @param {number} total */
export const lineFor = total =>
  total > 0 ? `${total} new episode${total === 1 ? '' : 's'} in Podcasts.` : null;

/** Places the line on home (line.4) through the Worker; why it couldn't, as an error code, or null.
 * @param {string} text */
async function place(text) {
  try {
    await request('PUT', `/v1/surfaces/home/${SLOT}`, {body: {
      kind: 'line', schema: 1, payload: {text},
      why: 'New episodes of the shows the owner follows, found by the night.',
      topic_key: 'podcasts-new', ref: 'app:podcasts',
    }});
    return null;
  } catch (e) {
    if (e instanceof ThError) return e.code;
    throw e;
  }
}

/** @param {string[]} argv */
export async function podcasts(argv) {
  const {rest} = parseArgs(argv);
  if (rest[0] !== 'new' || rest.length !== 1) throw invalid('usage: th podcasts new');
  const now = Date.now();
  const follows = await rows('/v1/podcasts/follows', 0);
  const todo = due(follows, now);
  const started = new Set();
  if (todo.length)
    for (const p of await rows('/v1/podcasts/progress', now - STARTED_MS)) if (p.played || p.position_s > 0) started.add(p.key);
  const checked = [];
  let failed = 0;
  for (const f of todo.slice(0, L.night_feeds)) {
    try {
      const {data} = await request('GET', '/v1/podcasts/feed', {query: {url: f.feed_url}, text: true, retry: false, timeoutMs: 25_000});
      checked.push(freshOf(f, parseFeed(data, f.feed_url, {limit: 50}), started, now));
    } catch (e) {
      // The night's reads are over for the day, or this key may not: the rest wait. Any other
      // failure is recorded, so the show waits longer instead of taking a slot every night.
      if (e instanceof ThError && (e.exit === EXIT.budget || e.exit === EXIT.unauthorized)) break;
      if (e instanceof ThError && e.exit === EXIT.forbidden && e.details?.reason !== 'not_followed') break;
      checked.push({feed_url: f.feed_url, latest_at: null, new_n: 0, failed: true});
      failed++;
    }
  }
  if (checked.length) await request('POST', '/v1/podcasts/follows/checked', {body: {items: checked}});
  const found = new Map(checked.map(c => [c.feed_url, c.new_n]));
  const counts = follows
    .filter(f => f.followed)
    .map(f => (found.has(f.feed_url) ? found.get(f.feed_url) : f.checked_at > now - L.check_gap_ms ? f.new_n : 0))
    .filter(n => n > 0);
  const total = counts.reduce((a, n) => a + n, 0);
  const line = lineFor(total);
  const reason = line ? await place(line) : 'nothing_new';
  // Counts only: no show's title reaches the session or the surface (outside text).
  out({
    checked: checked.length - failed,
    failed,
    waiting: Math.max(0, todo.length - checked.length),
    shows_with_new: counts.length,
    new_episodes: total,
    placed: reason === null,
    slot: reason === null ? SLOT : null,
    reason,
  });
}
