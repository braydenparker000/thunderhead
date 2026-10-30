// The podcast hosts (PODCASTS.md §4.4; harvested from the old Worker's backend/podcasts.js): every
// address is checked as public before it is asked and again on each redirect (at most 16, since
// publishers chain measurement services before their CDN; a loop is an error), with one honest
// User-Agent and bodies limited as they stream. The directory asks Apple's two search addresses,
// then gpodder, each for at most 5.5 s. Nothing is logged or stored. Tests swap the fetch.
import { appleDirectoryURLs, normalizeDirectory } from '../../../../frontend/podcasts/directory.js';
import { episodeID, FeedError, optionalURL, publicURL } from '../../../../frontend/th/podcasts/feed.js';

export { FeedError };
export const FEED_BYTES = 4 * 1024 * 1024;
const UA = 'Thunderhead-Podcasts/1.0 (personal app; 1 listener)';
const REDIRECTS = [301, 302, 303, 307, 308];

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch the hosts are asked with. */
export function useFetch(f: typeof fetch): void {
  fetcher = f;
}

/** The answer at the end of the redirects, and its address. */
export async function upstream(
  value: string,
  o: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<{ response: Response; url: string }> {
  let url = publicURL(value);
  const visited = new Set<string>();
  for (let i = 0; i <= 16; i++) {
    if (visited.has(url)) throw new FeedError('The podcast host returned a redirect loop.');
    visited.add(url);
    const response = await fetcher(url, {
      headers: { 'User-Agent': UA, ...o.headers },
      redirect: 'manual',
      signal: o.signal,
    });
    if (!REDIRECTS.includes(response.status)) return { response, url };
    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location) throw new FeedError('The podcast host returned an invalid redirect.');
    url = publicURL(new URL(location, url).href);
  }
  throw new FeedError('The podcast host redirected too many times.');
}

/** The first `max` bytes of a body, then the host is let go. A feed cut short keeps its whole items. */
export function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let left = max;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      if (value.length >= left) {
        controller.enqueue(value.subarray(0, left));
        await reader.cancel();
        return controller.close();
      }
      left -= value.length;
      controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

/** A feed as its host sent it, at most 4 MB of it. */
export async function feedBody(feed: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const { response: r } = await upstream(feed, { signal });
  if (!r.ok || !r.body) {
    await r.body?.cancel();
    throw new FeedError('This podcast feed is unavailable. Try again later.', r.status === 404 ? 404 : 502);
  }
  return capped(r.body, FEED_BYTES);
}

/** A directory's JSON, at most 1 MB. */
async function json(r: Response): Promise<unknown> {
  if (Number(r.headers.get('Content-Length')) > 1024 * 1024) throw new FeedError('Too large.', 413);
  const bytes = new Uint8Array(await new Response(r.body && capped(r.body, 1024 * 1024 + 1)).arrayBuffer());
  if (bytes.length > 1024 * 1024) throw new FeedError('Too large.', 413);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const CATEGORIES: Record<string, string> = {
  popular: 'podcast',
  history: 'history',
  science: 'science',
  technology: 'technology',
  culture: 'society culture',
  faith: 'religion spirituality',
  music: 'music',
  stories: 'fiction storytelling',
};

/** Shows matching the words: Apple's first non-empty answer, else gpodder's; empty only if all are. */
export async function directory(q: string, region: string | undefined, signal?: AbortSignal) {
  const query = q.trim();
  if (query.length < 2 || query.length > 120) throw new FeedError('Enter at least two characters to search.', 400);
  const endpoints = [
    ...appleDirectoryURLs(query, region),
    `https://gpodder.net/search.json?q=${encodeURIComponent(query)}&scale_logo=300`,
  ];
  let empty: { shows: unknown[] } | undefined;
  for (const endpoint of endpoints) {
    try {
      // One unavailable index must not spend the whole request.
      const { response: r } = await upstream(endpoint, {
        signal: AbortSignal.any([AbortSignal.timeout(5500), ...(signal ? [signal] : [])]),
      });
      if (!r.ok) {
        await r.body?.cancel();
        continue;
      }
      const gpodder = new URL(endpoint).hostname === 'gpodder.net';
      const { shows } = normalizeDirectory(await json(r), gpodder ? 'gpodder' : 'apple', optionalURL);
      if (gpodder) for (const show of shows) show.id = episodeID(show.feedUrl);
      if (shows.length) return { shows };
      empty = { shows };
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  if (empty) return empty;
  throw new FeedError('Podcast search is unavailable. Please try again.');
}
