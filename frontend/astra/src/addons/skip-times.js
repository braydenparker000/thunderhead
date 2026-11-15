// Public skip times for anime (AniSkip), off unless the owner turns it on.
// It sends two outside services a show's public id and an episode number,
// nothing else: no cookies, no referrer, no stream or add-on address.
//  1. api.ani.zip maps a Kitsu or IMDb id to a MyAnimeList id.
//  2. api.aniskip.com answers the opening, ending and recap for that episode.
// Both let any web page read their answers. Answers, "nothing known"
// included, are kept in memory for the session.

const MAP = 'https://api.ani.zip/mappings';
const SKIP = 'https://api.aniskip.com/v2/skip-times';
const TIMEOUT = 6000;
const TYPES = {'op': 'intro', 'mixed-op': 'intro', 'ed': 'outro', 'mixed-ed': 'outro', 'recap': 'recap'};
const SLACK = 5;   // seconds a result may run past the end of this file

const memo = new Map();

/** Which lookup an Astra id needs: {mal} directly, {kitsu} or {imdb} to map first, or null. */
export function idQuery({id, season} = {}) {
  const s = String(id || '');
  let m;
  if ((m = /^mal:(\d+)$/.exec(s))) return {mal: Number(m[1])};
  if ((m = /^kitsu:(\d+)$/.exec(s))) return {kitsu: m[1]};
  // An IMDb id maps to one entry, usually the first season: only season 1 can use it.
  if ((m = /^(tt\d+)$/.exec(s))) return season == null || Number(season) === 1 ? {imdb: m[1]} : null;
  return null;
}

/** The MyAnimeList id from an ani.zip mappings answer, or null. */
export function parseMapping(json) {
  const n = Number(json?.mappings?.mal_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Segments from an AniSkip answer for a file of `duration` seconds (0 when
 * unknown). Times are not shifted or scaled: results outside the file are
 * dropped, and of each kind the one whose episodeLength is nearest wins.
 */
export function parseSkipTimes(json, duration = 0) {
  if (!json?.found || !Array.isArray(json.results)) return null;
  const best = new Map();
  for (const r of json.results) {
    const type = TYPES[r?.skipType], start = Number(r?.interval?.startTime), end = Number(r?.interval?.endTime);
    if (!type || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    if (duration > 0 && (start >= duration || end > duration + SLACK)) continue;
    const len = Number(r.episodeLength), miss = duration > 0 && len > 0 ? Math.abs(len - duration) : Infinity;
    const had = best.get(type);
    if (!had || miss < had.miss) best.set(type, {miss, seg: {type, start: tenth(start), end: tenth(duration > 0 ? Math.min(end, duration) : end)}});
  }
  const out = [...best.values()].map(b => b.seg).sort((a, b) => a.start - b.start);
  return out.length ? out : null;
}

const tenth = x => Math.round(x * 10) / 10;

/** The episode number AniSkip wants: Kitsu numbers are per entry; IMDb (season 1) and MAL take the episode as given. */
function episodeOf({episode}) {
  const n = Number(episode);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getJson(url, {signal, fetch}) {
  const timer = new AbortController(), stop = setTimeout(() => timer.abort(), TIMEOUT);
  const onAbort = () => timer.abort();
  signal?.addEventListener?.('abort', onAbort, {once: true});
  try {
    const r = await fetch(url, {signal: timer.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default'});
    if (r.status === 404) return {missing: true};
    if (!r.ok) return null;
    return {json: await r.json()};
  } catch { return null; } finally { clearTimeout(stop); signal?.removeEventListener?.('abort', onAbort); }
}

// Remembers an answer (a missing one too); a failure (timeout, offline) is not remembered.
async function cached(key, make) {
  if (memo.has(key)) return memo.get(key);
  const value = await make();
  if (value !== undefined) memo.set(key, value);
  return value ?? null;
}

async function malId(q, opts) {
  if (q.mal) return q.mal;
  const [name, value] = q.kitsu ? ['kitsu_id', q.kitsu] : ['imdb_id', q.imdb];
  return cached(`map:${name}:${value}`, async () => {
    const got = await getJson(`${MAP}?${name}=${encodeURIComponent(value)}`, opts);
    if (!got) return undefined;
    return got.missing ? null : parseMapping(got.json);
  });
}

/**
 * Skip segments for an anime episode, or null. `fetch` may be passed for
 * tests; nothing ever throws.
 * @param {{type?: string, id: string, season?: number, episode: number, duration?: number}} title
 */
export async function lookupSkipTimes(title, {signal, fetch = globalThis.fetch} = {}) {
  try {
    const q = idQuery(title || {}), ep = episodeOf(title || {});
    if (!q || !ep || typeof fetch !== 'function' || signal?.aborted) return null;
    const opts = {signal, fetch};
    const mal = await malId(q, opts);
    if (!mal || signal?.aborted) return null;
    const duration = title.duration > 0 && Number.isFinite(title.duration) ? title.duration : 0;
    const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].map(t => `types=${t}`).join('&');
    const answer = await cached(`skip:${mal}:${ep}:${Math.round(duration)}`, async () => {
      const got = await getJson(`${SKIP}/${mal}/${ep}?${types}&episodeLength=${Math.round(duration)}`, opts);
      if (!got) return undefined;
      return got.missing ? null : got.json;
    });
    return answer ? parseSkipTimes(answer, duration) : null;
  } catch { return null; }
}

/** Forgets what was looked up (for tests). */
export function forgetSkipTimes() { memo.clear(); }
