// The knowledge job's outside requests (MUSIC.md §19.2, PRIVACY.md §5): one request a step, each
// carrying only MusicBrainz ids, Wikidata ids and canonical names (never the owner's text, plays or
// anything of theirs), with the app's User-Agent. MusicBrainz shares lookup()'s 1.1 s gate; every other
// host has its own of 1 s. A key or token is added here, at the call, never in a URL that is stored,
// logged or answered in an error: Last.fm's key in its query (its only way), Discogs's and
// ListenBrainz's tokens in a header (ListenBrainz's to api.listenbrainz.org only). Each answer is
// read by its parser (know-parse-*.ts) into facts.
import { KNOW_LIMITS as K } from '../../../../shared/contract/know.ts';
import { present } from '../../lib/secrets';
import { fmParse, fmSimilarUrl, hostTurn, lbParse, lbSimilarUrl, mbTurn, outsideGet } from './history-mb';
import * as mb from './know-parse-mb';
import * as web from './know-parse-web';

/** Each source a facts row may still ask, in the order it asks them. */
export const SOURCES = {
  artist: ['mb', 'disco', 'lbtop', 'wd', 'wdr', 'wdl', 'wdi', 'wp', 'fmtags', 'fmtop', 'lbsim', 'fmsim'],
  /** An artist outside the library a pick may name (a neighbour, an influence): enough to choose its album. */
  lite: ['disco', 'lbtop', 'fmtags'],
  /** A person behind loved albums: who they are and their other work. */
  person: ['mb', 'disco', 'lbtop'],
  album: ['rels', 'credits', 'rg', 'wds', 'wp', 'fmalb', 'dcm', 'dcr'],
} as const;
export type Kind = keyof typeof SOURCES;
export type Source = (typeof SOURCES)[Kind][number];
/** The family each source fills (KnowStatus.filled). */
export const FAMILY: Record<Source, 'musicbrainz' | 'listenbrainz' | 'wikidata' | 'wikipedia' | 'lastfm' | 'discogs'> =
  {
    mb: 'musicbrainz',
    disco: 'musicbrainz',
    rels: 'musicbrainz',
    credits: 'musicbrainz',
    rg: 'musicbrainz',
    lbtop: 'listenbrainz',
    lbsim: 'listenbrainz',
    wd: 'wikidata',
    wdr: 'wikidata',
    wdl: 'wikidata',
    wdi: 'wikidata',
    wds: 'wikidata',
    wp: 'wikipedia',
    fmtags: 'lastfm',
    fmtop: 'lastfm',
    fmsim: 'lastfm',
    fmalb: 'lastfm',
    dcm: 'discogs',
    dcr: 'discogs',
  };

/** What a later source needs from an earlier one. */
export interface Work {
  wd?: string | null;
  wiki?: string | null;
  discogs?: string | null;
  release?: string | null;
  main?: number | null;
  page?: number;
  refs?: string[];
  inf?: string[];
  credited?: boolean;
  /** The discography was read to its last page (at least once), and when it was last read or given up. */
  disco_done?: boolean;
  disco_at?: number;
  /** `rg` gave the group's title and artist as MusicBrainz names them. */
  named?: boolean;
  /** Failed requests this round, by source: at most `row_tries`, then that source waits for the next. */
  tries?: Record<string, number>;
}

/** One request: its host and URL (no key), and whether it needs Last.fm's key or a token. */
export interface Ask {
  host: string;
  url: string;
  auth?: 'lastfm' | 'discogs' | 'listenbrainz';
  /** The Wikidata item an entity read is about. */
  q?: string;
}

const MB = 'https://musicbrainz.org/ws/2';
const WD = 'https://www.wikidata.org/w/api.php?format=json&';
const FM = 'https://ws.audioscrobbler.com/2.0/?format=json&';
const e = encodeURIComponent;

/** The request a source makes for a row, or null when it has nothing to ask (no id to go on, no key,
 * nothing missing): the job then moves to the next source. */
export function askFor(
  source: Source,
  row: { mbid: string; name: string; artist?: string; title?: string },
  w: Work,
  keys: { lastfm: boolean; discogs: boolean; listenbrainz: boolean },
): Ask | null {
  const id = row.mbid;
  const mbAsk = (path: string): Ask => ({ host: 'musicbrainz.org', url: `${MB}/${path}&fmt=json` });
  const wd = (q: string, item?: string): Ask => ({ host: 'www.wikidata.org', url: `${WD}${q}`, q: item });
  const fm = (q: string): Ask | null =>
    keys.lastfm ? { host: 'ws.audioscrobbler.com', url: `${FM}${q}`, auth: 'lastfm' } : null;
  const dc = (path: string): Ask | null =>
    keys.discogs ? { host: 'api.discogs.com', url: `https://api.discogs.com/${path}`, auth: 'discogs' } : null;
  const discogs = /^(artist|master)\/(\d+)$/.exec(w.discogs ?? '');
  switch (source) {
    case 'mb':
      return mbAsk(`artist/${id}?inc=url-rels+artist-rels`);
    case 'disco':
      return mbAsk(`release-group?artist=${id}&limit=${K.disco_page}&offset=${w.page ?? 0}`);
    case 'rels':
      return mbAsk(`release?release-group=${id}&inc=recordings+labels&limit=25`);
    case 'credits':
      return w.release
        ? mbAsk(
            `release/${w.release}?inc=recordings+artist-rels+recording-rels+recording-level-rels+work-rels+work-level-rels`,
          )
        : null;
    case 'rg':
      return mbAsk(`release-group/${id}?inc=url-rels+artist-credits`);
    case 'lbtop':
      // ListenBrainz's popularity needs its token (401 without one, 2026-11); its labs host is asked without.
      return keys.listenbrainz
        ? {
            host: 'api.listenbrainz.org',
            url: `https://api.listenbrainz.org/1/popularity/top-release-groups-for-artist/${id}`,
            auth: 'listenbrainz',
          }
        : null;
    case 'lbsim':
      return { host: 'labs.api.listenbrainz.org', url: lbSimilarUrl(id), q: id };
    case 'wd':
      return w.wd ? wd(`action=wbgetentities&ids=${w.wd}&props=claims|sitelinks&sitefilter=enwiki`, w.wd) : null;
    case 'wdr':
      return w.wd
        ? wd(`action=query&list=search&srlimit=${K.influences}&srsearch=${e(`haswbstatement:P737=${w.wd}`)}`)
        : null;
    case 'wdl':
      return w.refs?.length
        ? wd(`action=wbgetentities&props=labels&languages=en&ids=${w.refs.slice(0, 50).join('|')}`)
        : null;
    case 'wdi':
      return w.inf?.length
        ? wd(`action=wbgetentities&props=labels|claims&languages=en&ids=${w.inf.slice(0, 20).join('|')}`)
        : null;
    case 'wds':
      return w.wd && !w.wiki ? wd(`action=wbgetentities&ids=${w.wd}&props=sitelinks&sitefilter=enwiki`, w.wd) : null;
    case 'wp':
      return w.wiki
        ? {
            host: 'en.wikipedia.org',
            url: `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&titles=${e(w.wiki)}`,
          }
        : null;
    case 'fmtags':
      return fm(`method=artist.gettoptags&mbid=${id}`);
    case 'fmtop':
      return fm(`method=artist.gettopalbums&limit=50&mbid=${id}`);
    case 'fmsim':
      return keys.lastfm ? { host: 'ws.audioscrobbler.com', url: fmSimilarUrl(id), auth: 'lastfm', q: id } : null;
    case 'fmalb':
      // Only MusicBrainz's own ids or names, never the files' tags: the release's id once known, else
      // the group's title and artist as MusicBrainz named them (`named`, from `rg`); before, nothing.
      if (w.release) return fm(`method=album.getinfo&mbid=${w.release}`);
      return w.named && row.artist && row.title
        ? fm(`method=album.getinfo&autocorrect=0&artist=${e(row.artist)}&album=${e(row.title)}`)
        : null;
    case 'dcm':
      return discogs?.[1] === 'master' ? dc(`masters/${discogs[2]}`) : null;
    case 'dcr':
      return w.main && !w.credited ? dc(`releases/${w.main}`) : null;
  }
}

/** What one request gave: its parsed answer; nothing (no such thing, or an answer too big to read:
 * not asked again this round); a refusal of the host (429, 5xx, no answer: the host backs off,
 * `retry` its Retry-After in ms); or a bad answer for this row only (not JSON, not the shape). */
export type Got = { ok: unknown } | { none: true } | { error: 'host'; retry?: number } | { error: 'row' };
const PARSE: Record<Source, (j: unknown, q: string) => unknown> = {
  mb: mb.parseArtist,
  disco: mb.parseDisco,
  rels: mb.parseReleases,
  credits: mb.parseCredits,
  rg: mb.parseGroup,
  lbtop: mb.parseLbTop,
  lbsim: lbParse,
  fmsim: fmParse,
  wd: web.parseWdItem,
  wdr: web.parseWdSearch,
  wdl: web.parseWdLabels,
  wdi: web.parseWdLabels,
  wds: web.parseWdItem,
  wp: web.parseWiki,
  fmtags: web.parseFmTags,
  fmtop: web.parseFmTopAlbums,
  fmalb: web.parseFmAlbum,
  dcm: web.parseDcMaster,
  dcr: web.parseDcRelease,
};
/** Answers past this size are not read: no artist's facts need more. */
export const MAX_BYTES = 4 * 1024 * 1024;
/** A Retry-After is honoured up to this long. */
const RETRY_MAX = 6 * 3_600_000;

type Secrets = { key: string | null; token: string | null; lb: string | null };
let given: Secrets | null = null;
/** For tests: Last.fm's key and the Discogs and ListenBrainz tokens as if set (invented values), or
 * back to the env's. */
export function useKeys(k: { key: string | null; token: string | null; lb?: string | null } | null): void {
  given = k && { ...k, lb: k.lb ?? null };
}
/** Last.fm's key, Discogs's token and ListenBrainz's token, each null when not set (`none`). */
export function secretsOf(env: Env): Secrets {
  return (
    given ?? {
      key: present((env as { LASTFM_API_KEY?: string }).LASTFM_API_KEY),
      token: present(env.DISCOGS_TOKEN),
      lb: present(env.LISTENBRAINZ_TOKEN),
    }
  );
}

/** Retry-After (seconds or a date) in ms from now, capped; undefined when absent or unreadable. */
export function retryAfter(v: string | null, now: number): number | undefined {
  if (!v) return undefined;
  const ms = /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) * 1000 : Date.parse(v) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_MAX) : undefined;
}

/** The body as text, at most `max` bytes: null past it (read no further). */
async function capped(r: Response, max: number): Promise<string | null> {
  if (Number(r.headers.get('Content-Length') ?? 0) > max) {
    await r.body?.cancel();
    return null;
  }
  if (!r.body) return '';
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The one request, through its host's gate: `wait` when the host was asked too recently; else what
 * it answered, read by the source's parser. A parser never throws; if one did, it is this row's bad
 * answer, not the host's. */
export async function fetchAsk(env: Env, source: Source, ask: Ask, now = Date.now()): Promise<Got | 'wait'> {
  const open = ask.host === 'musicbrainz.org' ? mbTurn(now) : hostTurn(ask.host, K.host_gap_ms, now);
  if (!open) return 'wait';
  const { key, token, lb } = secretsOf(env);
  if ((ask.auth === 'lastfm' && !key) || (ask.auth === 'discogs' && !token) || (ask.auth === 'listenbrainz' && !lb))
    return { none: true };
  let r: Response;
  try {
    const url = ask.auth === 'lastfm' ? `${ask.url}&api_key=${e(key ?? '')}` : ask.url;
    const auth = ask.auth === 'discogs' ? `Discogs token=${token}` : ask.auth === 'listenbrainz' ? `Token ${lb}` : '';
    r = await outsideGet(url, auth ? { Authorization: auth } : {});
  } catch {
    return { error: 'host' };
  }
  if (r.status === 404) return { none: true };
  // Not allowed (ListenBrainz answered 401 to every popularity read from the live Worker, 2026-11-23):
  // no row's fault and not passing, so the host is left for the longest rest instead of costing each
  // row three requests.
  if (r.status === 401 || r.status === 403) return { error: 'host', retry: RETRY_MAX };
  if (r.status === 429 || r.status >= 500)
    return { error: 'host', retry: retryAfter(r.headers.get('Retry-After'), now) };
  if (!r.ok) return { error: 'row' };
  let j: unknown;
  try {
    const text = await capped(r, MAX_BYTES);
    if (text === null) return { none: true };
    j = JSON.parse(text);
  } catch {
    return { error: 'row' };
  }
  // Last.fm answers an unknown id with 200 and an error code.
  if (ask.auth === 'lastfm' && j && typeof j === 'object' && 'error' in j) return { none: true };
  try {
    return { ok: PARSE[source](j, ask.q ?? '') };
  } catch {
    return { error: 'row' };
  }
}
