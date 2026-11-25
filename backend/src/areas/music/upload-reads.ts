// The upload tools' reads (POST /v1/music/uploads/<op>, upload.ts) beyond `links`:
// - `export`: with no field, the whole catalog with its waveforms, as it always was; with `limit`
//   (1 to 2,000), `after` (the last answer's `next`, or a track's id or place) or `waveforms: false`,
//   a page in catalog order with `next` (null on the last page) and `complete` (true only there).
// - `track`: one track's record, `{ id }` or `{ sha256, size }`, without its waveform (`hasWaveform`,
//   `waveformKind`), or 404. One row read.
// - `quota`: the day's rows and the hold as Core counts them, with Music's live day; answered while
//   the day is held, so a tool can ask when to come back. Numbers only.
import { ApiError } from '../../http/errors';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { musicDay } from '../meter/hold';
import { SONG_ID } from './shapes';
import { HEX } from './validate';

export const EXPORT_PAGE_MAX = 2_000;
const PAGE = EXPORT_PAGE_MAX.toLocaleString('en-US');

type Body = Record<string, unknown>;
const bad = (path: string, issue: string): never => {
  throw new ApiError('validation', [{ path, issue }]);
};

/** `export`'s answer, as JSON text. */
export async function exportText(env: Env, input: Body): Promise<string> {
  const { limit, after, waveforms } = input;
  const music = musicObject(env);
  if (limit == null && after == null && waveforms == null) return fresh(music.exportCatalog());
  const n = limit as number;
  if (limit != null && !(Number.isInteger(n) && n >= 1 && n <= EXPORT_PAGE_MAX)) bad('limit', `1 to ${PAGE}`);
  let from: number | string | null = null;
  if (typeof after === 'number' && Number.isSafeInteger(after) && after >= 0) from = after;
  else if (typeof after === 'string' && /^\d{1,15}$/.test(after)) from = Number(after);
  else if (typeof after === 'string' && SONG_ID.test(after)) from = after;
  else if (after != null) bad('after', "the last answer's next, or a track id");
  if (waveforms != null && typeof waveforms !== 'boolean') bad('waveforms', 'true or false');
  const text = await fresh(music.exportPage(limit == null ? null : n, from, waveforms !== false));
  return text ?? bad('after', 'no track has this id');
}

/** `track`'s answer, as JSON text: `{ "track": … }`. */
export async function trackText(env: Env, input: Body): Promise<string> {
  const { id, sha256, size } = input;
  const byId = id !== undefined;
  if (byId ? !SONG_ID.test(String(id)) : !HEX.test(String(sha256)) || !Number.isSafeInteger(size) || Number(size) <= 0)
    bad('body', '{ id } or { sha256, size }');
  const t = await fresh(musicObject(env).trackRecord(byId ? String(id) : null, String(sha256), Number(size)));
  if (t === null) throw new ApiError('not_found');
  return `{"track":${t}}`;
}

/** `quota`'s answer. A Core that can't answer is 503, never a guess. */
export async function quotaOf(env: Env, now = Date.now()) {
  const live = await musicDay(env);
  try {
    return await fresh(coreObject(env).museQuota(now, live));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('unavailable');
  }
}
