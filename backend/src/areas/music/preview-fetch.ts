// A pick's preview, fetched (MUSIC.md §19.7, PRIVACY.md §3): Apple's iTunes Search API is asked for the
// pick's album by its artist and title (nothing of the owner; no key), and when Apple refuses (it
// answers the Worker 429 in production) or lacks the album, Deezer's search the same way; each host at
// most once a second per isolate. The matching song's 30-second clip is passed through to the phone,
// so the phone only ever talks to the Worker. Nothing is written: the found address, or a miss (both
// asked, one answered without the album), is remembered in this isolate alone. A refusal is logged by
// host and status only (outsideGet), never the address.
import { ApiError } from '../../http/errors';
import { hostTurn, outsideGet } from './history-mb';
import { allowedPreview, deezerUrl, matchDeezer, matchPreview, PREVIEW, searchUrl } from './preview';

/** Pick id → its preview address, or null for a miss (both asked, neither had the album). */
const seen = new Map<string, string | null>();
/** For tests: forgets what this isolate found. */
export const forgetPreviews = () => seen.clear();

function remember(id: string, url: string | null) {
  seen.delete(id);
  seen.set(id, url);
  while (seen.size > PREVIEW.remembered) seen.delete(seen.keys().next().value as string);
}

const none = () => new ApiError('not_found');
const AUDIO = /^audio\/[a-z0-9.+-]{1,60}$/;

type Pick = { id: string; artist: string; album: string };
type Match = (answer: unknown, artist: string, album: string) => string | null;
/** One source asked: what it answered (an address, or null without the album), or why not. */
type Asked = { url: string | null } | 'closed' | 'refused';

async function ask(host: string, url: string, match: Match, pick: Pick): Promise<Asked> {
  if (!hostTurn(host, PREVIEW.gap_ms)) return 'closed';
  try {
    const r = await outsideGet(url);
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      return 'refused';
    }
    return { url: match(await r.json(), pick.artist, pick.album) };
  } catch {
    return 'refused';
  }
}

const found = (a: Asked) => (typeof a === 'object' ? a.url : null);

/** The address of the pick's preview: remembered, or looked up at Apple, then at Deezer when Apple
 * refused or lacks the album (429 while both gates are closed, 404 for no preview or refusals). A
 * miss is remembered only when both were asked and one answered without the album. */
async function addressOf(pick: Pick): Promise<string> {
  if (seen.has(pick.id)) {
    const url = seen.get(pick.id);
    if (!url) throw none();
    return url;
  }
  const apple = await ask(PREVIEW.host, searchUrl(pick.artist, pick.album), matchPreview, pick);
  const hit = found(apple);
  const deezer = hit ? 'closed' : await ask(PREVIEW.deezer, deezerUrl(pick.artist, pick.album), matchDeezer, pick);
  const url = hit ?? found(deezer);
  if (url) {
    remember(pick.id, url);
    return url;
  }
  if (apple === 'closed' && deezer === 'closed') throw new ApiError('rate_limited', undefined, { retry_after: 1 });
  const both = apple !== 'closed' && deezer !== 'closed';
  if (both && (typeof apple === 'object' || typeof deezer === 'object')) remember(pick.id, null);
  throw none();
}

/** Passes at most `max` bytes through; a longer body ends in an error rather than past the cap. */
function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let n = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        n += chunk.byteLength;
        if (n > max) ctl.error(new Error('preview too large'));
        else ctl.enqueue(chunk);
      },
    }),
  );
}

/** The pick's preview as the response body: audio only, at most 3 MB, kept a day by the phone. */
export async function previewResponse(pick: { id: string; artist: string; album: string }): Promise<Response> {
  const url = allowedPreview(await addressOf(pick));
  if (!url) throw none();
  let r: Response;
  try {
    r = await outsideGet(url, { Accept: 'audio/*' });
  } catch {
    throw none();
  }
  // The media type alone (no parameters from elsewhere), and only an audio one.
  const type = (r.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const length = Number(r.headers.get('Content-Length') ?? 0);
  if (!r.ok || !r.body || !AUDIO.test(type) || !(length <= PREVIEW.max_bytes)) {
    await r.body?.cancel().catch(() => {});
    throw none();
  }
  return new Response(capped(r.body, PREVIEW.max_bytes), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' },
  });
}
