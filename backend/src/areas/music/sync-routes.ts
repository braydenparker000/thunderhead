// /v1/music/marks and /v1/music/playlists (MUSIC.md §1.4, API.md §11.29): the owner's phone sends the
// songs whose rating or plays it changed (1–200 at a time) and the playlists it changed or deleted
// (1–20), and a Settings → Reset stats (`reset_at`), and asks what changed since it last asked
// (`?since=`, then `cursor` while there is more), oldest first. A PUT's items are checked one by one: one that can't be taken (malformed, too big, or
// a time more than an hour ahead of the Worker's clock) is reported by its place in `refused` and the
// rest are kept. The owner's device only; nothing here writes the change feed or the catalog. The
// rows guard's hold never refuses these writes (about 130 rows a day, 2026-11-25): only the
// platform's own refusal, once the day's quota is truly spent, stops them.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  MUSIC_SYNC_LIMITS as L,
  MUSIC_PLAYLIST_ID,
  type MusicMark,
  type MusicMarksPage,
  type MusicPlaylist,
  type MusicPlaylistsPage,
  type MusicSyncResponse,
} from '../../../../shared/contract/music-sync.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { SONG_ID } from './shapes';

const ms = z.number().check(z.int(), z.gte(0), z.lte(Number.MAX_SAFE_INTEGER));
const markItem = z.strictObject({
  id: z.string().check(z.maxLength(220), z.regex(SONG_ID)),
  rating: z.nullable(z.number().check(z.int(), z.gte(0), z.lte(5))),
  rated_at: z.nullable(ms.check(z.gte(1))),
  plays: z.number().check(z.int(), z.gte(0), z.lte(10_000_000)),
  last_played: ms,
  updated_at: ms.check(z.gte(1)),
}) satisfies z.ZodMiniType<MusicMark>;
const playlistItem = z.strictObject({
  id: z.string().check(z.regex(MUSIC_PLAYLIST_ID)),
  name: z.string().check(z.maxLength(L.name_chars)),
  ids: z.array(z.string().check(z.minLength(1), z.maxLength(L.entry_chars))).check(z.maxLength(L.playlist_ids)),
  created: ms,
  path: z.nullable(z.string().check(z.maxLength(L.name_chars))),
  deleted: z.boolean(),
  updated_at: ms.check(z.gte(1)),
}) satisfies z.ZodMiniType<MusicPlaylist>;

/** The items the Worker can take, and the rest by their place with why (the first issue only; never
 * the value). */
function sorted<T>(
  schema: z.ZodMiniType<T>,
  raw: unknown[],
  now: number,
  times: (t: T) => number[],
  chars = Number.POSITIVE_INFINITY,
): { ok: T[]; refused: MusicSyncResponse['refused'] } {
  const ok: T[] = [];
  const refused: MusicSyncResponse['refused'] = [];
  raw.forEach((x, index) => {
    const r = schema.safeParse(x);
    if (!r.success) {
      const i = r.error.issues[0];
      refused.push({ index, issue: `${i?.path.join('.') || 'item'}: ${i?.message ?? 'invalid'}` });
    } else if (chars < Number.POSITIVE_INFINITY && JSON.stringify(r.data).length > chars)
      refused.push({ index, issue: `item: more than ${chars} characters` });
    else if (times(r.data).some((t) => t > now + L.ahead_ms))
      refused.push({ index, issue: "a time more than an hour ahead of the Worker's clock" });
    else ok.push(r.data);
  });
  return { ok, refused };
}

const batch = (max: number) => z.strictObject({ items: z.array(z.unknown()).check(z.minLength(1), z.maxLength(max)) });
/** Marks may come with a Reset stats, alone or with up to 200 songs. */
const marksBody = z
  .strictObject({
    items: z.array(z.unknown()).check(z.maxLength(L.batch_marks)),
    reset_at: z.optional(ms.check(z.gte(1))),
  })
  .check(z.refine((b) => b.items.length > 0 || b.reset_at !== undefined, 'items: 1 or more, or a reset_at'));
const pageQuery = z.object({
  since: z.optional(z.coerce.number().check(z.int(), z.gte(0))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(L.page_max))),
  cursor: z.optional(z.string().check(z.maxLength(4000))),
});

/** The page's `[synced_at, id]` start: the cursor's, else `since`. */
function startOf(route: string, raw: Record<string, string>): { after: [number, string]; limit: number } {
  const q = parse(pageQuery, raw);
  const k = decodeCursor(route, q.cursor);
  if (k !== null && (k.length !== 2 || !Number.isSafeInteger(k[0]) || typeof k[1] !== 'string'))
    throw new ApiError('bad_request');
  return { after: k ? [k[0] as number, k[1] as string] : [q.since ?? 0, ''], limit: q.limit ?? L.page_max };
}

export const musicSyncRoutes = new Hono<AppEnv>()
  .put('/music/marks', guard('PUT /v1/music/marks'), async (c) => {
    const body = await json(c, marksBody);
    const now = Date.now();
    const { ok, refused } = sorted(markItem, body.items, now, (m) => [m.rated_at ?? 0, m.last_played, m.updated_at]);
    if (body.reset_at !== undefined && body.reset_at > now + L.ahead_ms)
      throw new ApiError('validation', [{ path: 'reset_at', issue: "more than an hour ahead of the Worker's clock" }]);
    return c.json(await fresh(musicObject(c.env).putMarks(ok, refused, body.reset_at)));
  })
  .get('/music/marks', guard('GET /v1/music/marks'), async (c) => {
    const { after, limit } = startOf('music/marks', c.req.query());
    const p = await fresh(musicObject(c.env).marks(after, limit));
    return c.json({
      items: p.rows,
      next_since: p.at,
      next: p.more && p.last ? encodeCursor('music/marks', p.last) : null,
      reset_at: p.reset_at,
    } satisfies MusicMarksPage);
  })
  .put('/music/playlists', guard('PUT /v1/music/playlists'), async (c) => {
    const raw = (await json(c, batch(L.batch_playlists))).items;
    const { ok, refused } = sorted(playlistItem, raw, Date.now(), (p) => [p.updated_at], L.playlist_chars);
    return c.json(await fresh(musicObject(c.env).putPlaylists(ok, refused)));
  })
  .get('/music/playlists', guard('GET /v1/music/playlists'), async (c) => {
    const { after, limit } = startOf('music/playlists', c.req.query());
    const p = await fresh(musicObject(c.env).playlists(after, limit));
    return c.json({
      items: p.rows,
      next_since: p.at,
      next: p.more && p.last ? encodeCursor('music/playlists', p.last) : null,
    } satisfies MusicPlaylistsPage);
  });
