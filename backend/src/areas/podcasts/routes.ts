// /v1/podcasts (PODCASTS.md §3.1, §4.4; MIGRATION.md §7 step 5, P8): what the ported Podcasts app
// asked the old Worker for, now from this one, for the owner's device only. The directory (by words
// or one of the app's categories); a feed passed through as its host sent it, at most 4 MB (the
// phone reads it, §4.1); an episode's audio, found in its feed by id (never an address the caller
// names) and streamed with byte ranges. Where an episode was found, and where its host's redirects
// led, are kept 10 minutes in memory, so a seek costs one request. A host's own trouble travels in
// `details.reason`, which the app shows as before. Nothing is logged or stored.
import { Hono } from 'hono';
import { parseFeed, publicURL } from '../../../../frontend/th/podcasts/feed.js';
import type { ErrorCode } from '../../../../shared/contract/errors';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { CATEGORIES, directory, FeedError, feedBody, upstream } from './upstream';

const CODE: Record<number, ErrorCode> = {
  400: 'bad_request',
  404: 'not_found',
  413: 'too_large',
  415: 'unsupported_media_type',
};
const reason = (code: ErrorCode, words: string) => new ApiError(code, { reason: words });
/** A host's failure as this API's envelope, its words kept for the app. */
async function answer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof FeedError) throw reason(CODE[e.status] ?? 'upstream', e.message);
    if (e instanceof TypeError || (e instanceof Error && ['AbortError', 'TimeoutError'].includes(e.name)))
      throw reason('upstream', 'Could not reach the podcast service. Please try again.');
    throw e;
  }
}

const KEEP_MS = 10 * 60_000;
type Kept<T> = Map<string, T & { until: number }>;
/** An episode's enclosure, by `<feed>#<id>`. */
const episodes: Kept<{ url: string; type: string }> = new Map();
/** Where an enclosure's redirects ended (a signed CDN address), by enclosure. */
const located: Kept<{ url: string }> = new Map();
function keep<T>(m: Kept<T>, key: string, value: T): void {
  m.set(key, { ...value, until: Date.now() + KEEP_MS });
  if (m.size > 64) m.delete(m.keys().next().value as string);
}
const kept = <T>(m: Kept<T>, key: string) => {
  const v = m.get(key);
  return v && v.until > Date.now() ? v : undefined;
};

/** The episode's enclosure. The feed is read in growing pieces (64 KB, then ×4) and looked through
 * as far as it has come, so a recent episode costs the Worker well under a millisecond, not the
 * 10 ms limit a whole 4 MB feed would. */
async function enclosure(feed: string, id: string, signal: AbortSignal) {
  const url = publicURL(feed);
  const had = kept(episodes, `${url}#${id}`);
  if (had) return had;
  const reader = (await feedBody(url, signal)).getReader();
  const decoder = new TextDecoder();
  let raw = '';
  for (let enough = 64 * 1024; ; ) {
    const { done, value } = await reader.read();
    if (!done) raw += decoder.decode(value, { stream: true });
    if (!done && raw.length < enough) continue;
    enough *= 4;
    let e: { audioUrl: string; type: string } | undefined;
    try {
      e = parseFeed(raw, url, { id }).episodes[0];
    } catch (err) {
      // A piece may end before the channel has begun; the whole feed decides.
      if (done) throw err;
    }
    if (e) {
      await reader.cancel();
      keep(episodes, `${url}#${id}`, { url: e.audioUrl, type: e.type });
      return { url: e.audioUrl, type: e.type };
    }
    if (done) throw new FeedError('This episode is no longer in the feed. Use its original audio link.', 404);
  }
}

const AUDIO = ['application/octet-stream', 'application/ogg', 'video/mp4'];
const time = (c: { req: { raw: Request } }) => AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(20_000)]);

export const podcastsRoutes = new Hono<AppEnv>()
  .get('/podcasts/directory', guard('GET /v1/podcasts/directory'), async (c) => {
    const category = c.req.query('category');
    if (category !== undefined && !Object.hasOwn(CATEGORIES, category))
      throw reason('bad_request', 'Unknown podcast category');
    const q = category === undefined ? (c.req.query('q') ?? '') : CATEGORIES[category];
    return c.json(await answer(() => directory(q, c.req.query('country'), time(c))));
  })
  .get('/podcasts/feed', guard('GET /v1/podcasts/feed'), async (c) => {
    const body = await answer(() => feedBody(c.req.query('url') ?? '', time(c)));
    return c.body(body, 200, { 'Content-Type': 'application/xml' });
  })
  .get('/podcasts/audio', guard('GET /v1/podcasts/audio'), async (c) => {
    const range = c.req.header('Range');
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw reason('bad_request', 'Invalid byte range');
    const ep = await answer(() => enclosure(c.req.query('feed') ?? '', c.req.query('id') ?? '', time(c)));
    const headers: Record<string, string> = {
      Accept: 'audio/*,application/octet-stream',
      ...(range ? { Range: range } : {}),
    };
    // The time limit is for reaching the host; an episode can take far longer to stream.
    const reach = new AbortController();
    const timer = setTimeout(() => reach.abort(), 25_000);
    const stop = () => reach.abort();
    c.req.raw.signal.addEventListener('abort', stop, { once: true });
    let r: Response;
    try {
      r = await answer(async () => {
        const target = kept(located, ep.url)?.url ?? ep.url;
        let got = await upstream(target, { headers, signal: reach.signal });
        // A remembered CDN address has expired: from the publisher's address again, once.
        if (target !== ep.url && [401, 403, 404, 410].includes(got.response.status)) {
          await got.response.body?.cancel();
          located.delete(ep.url);
          got = await upstream(ep.url, { headers, signal: reach.signal });
        }
        if ([200, 206].includes(got.response.status)) keep(located, ep.url, { url: got.url });
        return got.response;
      });
    } finally {
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', stop);
    }
    if (![200, 206, 416].includes(r.status)) {
      await r.body?.cancel();
      throw reason('upstream', 'The episode host could not serve this audio.');
    }
    const type = (r.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (r.status !== 416 && type && !type.startsWith('audio/') && !AUDIO.includes(type)) {
      await r.body?.cancel();
      throw reason('unsupported_media_type', 'The episode host returned an unsupported audio format.');
    }
    const out: Record<string, string> = { 'Content-Type': type || ep.type };
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges'])
      if (r.headers.has(name)) out[name] = r.headers.get(name) as string;
    return c.body(r.body as ReadableStream, r.status as 200 | 206 | 416, out);
  });
