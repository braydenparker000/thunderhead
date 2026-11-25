// A pick's preview, fetched (MUSIC.md §19.7, PRIVACY.md §3): Apple's iTunes Search API is asked for the
// pick's album by its artist and title (nothing of the owner; no key), at most once a second per
// isolate, and the matching song's 30-second clip is passed through to the phone, so the phone only
// ever talks to the Worker. Nothing is written: the found address, or a miss, is remembered in this
// isolate alone. A refusal is logged by host and status only (outsideGet), never the address.
import { ApiError } from '../../http/errors';
import { hostTurn, outsideGet } from './history-mb';
import { allowedPreview, matchPreview, PREVIEW, searchUrl } from './preview';

/** Pick id → its preview address, or null for a miss (Apple answered with no such album). */
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

/** The address of the pick's preview: remembered, or looked up (429 while the gate is closed, 404
 * for no preview or a refusal). */
async function addressOf(pick: { id: string; artist: string; album: string }): Promise<string> {
  if (seen.has(pick.id)) {
    const url = seen.get(pick.id);
    if (!url) throw none();
    return url;
  }
  if (!hostTurn(PREVIEW.host, PREVIEW.gap_ms)) throw new ApiError('rate_limited', undefined, { retry_after: 1 });
  let answer: unknown;
  try {
    const r = await outsideGet(searchUrl(pick.artist, pick.album));
    if (!r.ok) throw none();
    answer = await r.json();
  } catch {
    throw none();
  }
  const url = matchPreview(answer, pick.artist, pick.album);
  remember(pick.id, url);
  if (!url) throw none();
  return url;
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
