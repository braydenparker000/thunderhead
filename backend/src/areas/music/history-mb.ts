// Canonical names and similar artists (MUSIC.md §16.2, PRIVACY.md §3). The MusicBrainz job (`music.mb`,
// Core's alarm, bulk lane) resolves the most played artist still due, one request a step and a step at
// most every 1.1 s (MusicBrainz asks for one a second), until none is due; an artist MusicBrainz
// doesn't know stays as the name, and one whose lookup failed three times is left. What it sends is
// the artist's name in a structured query (a canonical name, not the owner's text), with a User-Agent
// naming the app and nothing of the owner. ListenBrainz's similar artists are fetched when asked
// (GET /v1/music/similar/:mbid) by MusicBrainz id alone and kept a week; with a Last.fm key set
// (LASTFM_API_KEY, optional), Last.fm's similar artists are merged in. Once no artist is due it
// writes the taste line and queues the music knowledge's own job (`music.know`, know-job.ts).
import { TASTE_LIMITS as L } from '../../../../shared/contract/taste.ts';
import { present } from '../../lib/secrets';
import { musicObject } from '../../objects/music';
import type { JobHandler } from '../jobs/runner';
import { MB_JOB, putTaste } from './history-job';
import { keyOf } from './history-parse';
import { queueKnow } from './know-queue';

const UA = 'Thunderhead/1.0 (a personal music library)';
export const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LB_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';

let fetcher: typeof fetch = (...a) => fetch(...a);
/** When this isolate last asked MusicBrainz: the second guard behind the job's spacing. */
let lastMb = 0;
/** When this isolate last asked each other host (the knowledge job's, know-fetch.ts). */
const lastAt = new Map<string, number>();
/** For tests: the fetch every outside service is asked with; resets the guards. */
export function useFetch(f: typeof fetch): void {
  fetcher = f;
  lastMb = 0;
  lastAt.clear();
}

/** The gate of a host other than MusicBrainz: false when it was asked under `gap` ms ago. */
export function hostTurn(host: string, gap: number, now = Date.now()): boolean {
  if (now - (lastAt.get(host) ?? 0) < gap) return false;
  lastAt.set(host, now);
  return true;
}

/** The one gate every MusicBrainz request passes (the lookup's and the knowledge job's, know-job.ts):
 * false when the last request was under 1.1 s ago. */
export function mbTurn(now = Date.now()): boolean {
  if (now - lastMb < L.mb_gap_ms) return false;
  lastMb = now;
  return true;
}

/** One GET to an outside service with the app's User-Agent (and nothing of the owner), by the fetch
 * the tests replace. */
export async function outsideGet(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const host = url.slice(8, url.indexOf('/', 8));
  try {
    const r = await fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    // A refusal is logged by host and status alone (never the address: it can carry a key or a name).
    if (!r.ok) console.log(JSON.stringify({ evt: 'outside_refused', host, status: r.status }));
    return r;
  } catch (e) {
    console.log(JSON.stringify({ evt: 'outside_refused', host, status: 0 }));
    throw e;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '');

/** One artist by name: its id and canonical name when MusicBrainz is sure (score 90 or more and the
 * same name, or 100), 'none' when it knows no such artist, 'error' when it could not answer, 'wait'
 * when the last request was under 1.1 s ago. */
export async function lookup(
  name: string,
  now = Date.now(),
): Promise<{ mbid: string; name: string } | 'none' | 'error' | 'wait'> {
  if (!mbTurn(now)) return 'wait';
  const query = `artist:"${name.replace(/["\\]/g, ' ')}"`;
  const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&limit=3&fmt=json`;
  try {
    const r = await outsideGet(url);
    if (!r.ok) return 'error';
    const j = (await r.json()) as { artists?: { id?: unknown; name?: unknown; score?: unknown }[] };
    const want = keyOf(name);
    for (const a of j.artists ?? []) {
      const id = str(a.id);
      const n = str(a.name);
      const score = Number(a.score);
      if (MBID.test(id) && n && (score === 100 || (score >= 90 && keyOf(n) === want))) return { mbid: id, name: n };
    }
    return 'none';
  } catch {
    return 'error';
  }
}

type MbInput =
  | { wait: true }
  | { resolved: boolean }
  | { done: Awaited<ReturnType<ReturnType<typeof musicObject>['taste']>> };

export const mbJob: JobHandler = {
  kind: MB_JOB,
  lane: true,
  async load(env) {
    const music = musicObject(env);
    const next = await music.mbNext();
    if (!next) return { done: await music.taste(3) } satisfies MbInput;
    const r = await lookup(next.name);
    if (r === 'wait') return { wait: true } satisfies MbInput;
    return { resolved: (await music.mbPut(next.key, r)) > 0 } satisfies MbInput;
  },
  step(w, _payload, cursor, input) {
    const i = input as MbInput;
    const n = (cursor as { n: number } | null)?.n ?? 0;
    if ('done' in i) {
      putTaste(w, i.done);
      // Its artists resolved, the music knowledge goes on in its own job (know-job.ts).
      queueKnow(w.db, w.at);
      return { done: true };
    }
    // The next lookup waits its 1.1 s (the runner's `after`), so an alarm never asks twice.
    return { next: { n: 'wait' in i ? n : n + 1 }, after: L.mb_gap_ms, rows: 'resolved' in i && i.resolved ? 1 : 0 };
  },
};

export interface Similar {
  mbid: string;
  name: string;
  score: number;
}

/** ListenBrainz's and Last.fm's similar-artists URLs for one MusicBrainz id (Last.fm's without its
 * key, which is added at the call). */
export const lbSimilarUrl = (mbid: string) =>
  `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${mbid}&algorithm=${LB_ALGO}`;
export const fmSimilarUrl = (mbid: string) =>
  `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&mbid=${mbid}&format=json&limit=${L.similar_max}`;

/** ListenBrainz's answer read: scores scaled to 0–1. Never throws. */
export function lbParse(j: unknown, mbid: string): Similar[] {
  const list = (Array.isArray(j) ? j.flat() : []) as { artist_mbid?: unknown; name?: unknown; score?: unknown }[];
  const max = Math.max(1, ...list.map((a) => Number(a?.score) || 0));
  const out: Similar[] = [];
  for (const a of list) {
    const id = str(a?.artist_mbid);
    if (MBID.test(id) && id !== mbid && str(a.name))
      out.push({ mbid: id, name: str(a.name), score: Math.round(((Number(a.score) || 0) / max) * 100) / 100 });
  }
  return out;
}

/** Last.fm's answer read. Never throws. */
export function fmParse(j: unknown, mbid: string): Similar[] {
  const sa = j && typeof j === 'object' ? (j as { similarartists?: { artist?: unknown } }).similarartists : undefined;
  const list = Array.isArray(sa?.artist) ? sa.artist : [];
  const out: Similar[] = [];
  for (const a of list as { mbid?: unknown; name?: unknown; match?: unknown }[]) {
    const id = str(a?.mbid);
    if (MBID.test(id) && id !== mbid && str(a.name))
      out.push({ mbid: id, name: str(a.name), score: Math.round((Number(a.match) || 0) * 100) / 100 });
  }
  return out;
}

async function similarOnce(url: string, parse: (j: unknown, mbid: string) => Similar[], mbid: string) {
  try {
    const r = await outsideGet(url);
    return r.ok ? parse(await r.json(), mbid) : null;
  } catch {
    return null;
  }
}

/** ListenBrainz's similar artists for one MusicBrainz id; null when it did not answer. One request. */
export const lbSimilar = (mbid: string) => similarOnce(lbSimilarUrl(mbid), lbParse, mbid);

/** Last.fm's similar artists for one MusicBrainz id (its key in the query, which nothing logs); null
 * when it did not answer. One request. */
export const fmSimilar = (key: string, mbid: string) =>
  similarOnce(`${fmSimilarUrl(mbid)}&api_key=${encodeURIComponent(key)}`, fmParse, mbid);

/** Two similar lists merged (the higher score kept), best first, at most `similar_max`. */
export function mergeSimilar(...lists: (Similar[] | null)[]): Similar[] {
  const out = new Map<string, Similar>();
  for (const l of lists) for (const a of l ?? []) if (a.score > (out.get(a.mbid)?.score ?? -1)) out.set(a.mbid, a);
  return [...out.values()].sort((a, b) => b.score - a.score || (a.mbid < b.mbid ? -1 : 1)).slice(0, L.similar_max);
}

/** ListenBrainz's similar artists for one MusicBrainz id (scores scaled to 0–1), with Last.fm's merged
 * in when its key is set; null when neither answered. */
export async function similarFetch(env: Env, mbid: string): Promise<Similar[] | null> {
  const lb = await lbSimilar(mbid);
  const key = present((env as { LASTFM_API_KEY?: string }).LASTFM_API_KEY);
  const fm = key ? await fmSimilar(key, mbid) : null;
  return lb || fm ? mergeSimilar(lb, fm) : null;
}
