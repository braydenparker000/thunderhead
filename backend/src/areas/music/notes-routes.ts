// What the mind knows of each song (MUSIC.md §10.5, API.md §11.21): its notes, written in batches by
// mind:night (and mind:chat), read by the owner's device and the mind, and the question it asks
// of them: songs by feeling, or like one. Notes and find stay inside the Worker (PRIVACY.md §2);
// the eval sandbox has no music (its Core is a scratch one, and the owner's notes are real).
//
// Writes stay under the rows-read guard: from 80% of the day's database budget a batch answers 429
// with Retry-After until 00:00 UTC (DATA.md §8.1), and the night's tagging waits for the next one.
// Find asks the Senses object for the early skips and the songs rated 1 (each kept in its memory
// until a new event of its kind arrives) and Core for the songs the owner told the mind never to
// play again, then ranks in the Music object.
import { Hono } from 'hono';
import {
  MUSIC_NOTE_LIMITS as L,
  type MusicFindResponse,
  type MusicNotesResponse,
  type MusicNotesWritten,
} from '../../../../shared/contract/music.ts';
import { type AppEnv, guard, principalOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { sensesObject } from '../../objects/senses';
import { refuseWhileHeld } from '../meter/hold';
import { parseFind } from './find';
import { checkNotes } from './notes';
import { SONG_ID } from './shapes';

/** A batch's body, at most: 200 full notes are about 100 KB. */
const BODY_MAX = 256 * 1024;

const noSandbox = () => {
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no music' }]);
};

export const notesRoutes = new Hono<AppEnv>()
  .put('/music/notes', guard('PUT /v1/music/notes'), async (c) => {
    noSandbox();
    if (Number(c.req.header('Content-Length') ?? 0) > BODY_MAX) throw new ApiError('too_large');
    const text = await c.req.text();
    if (text.length > BODY_MAX) throw new ApiError('too_large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError('bad_request');
    }
    const extra = body && typeof body === 'object' ? Object.keys(body).filter((k) => k !== 'items') : [];
    if (extra.length) throw new ApiError('validation', [{ path: extra[0], issue: 'only items' }]);
    // Every field first; whether each track is in the catalog, in the object that holds it.
    const checked = checkNotes((body as { items?: unknown })?.items, () => true);
    if ('issues' in checked) throw new ApiError('validation', checked.issues);
    await refuseWhileHeld(c.env);
    const p = principalOf(c);
    const by = p.kind === 'agent' ? p.role : 'owner';
    const r = await fresh(musicObject(c.env).putNotes(checked.notes, by));
    if ('unknown' in r) {
      const at = new Map(checked.notes.map((n, i) => [n.id, i]));
      throw new ApiError(
        'validation',
        r.unknown.slice(0, 50).map((id) => ({ path: `items.${at.get(id)}.id`, issue: 'not in the catalog' })),
      );
    }
    return c.json(r satisfies MusicNotesWritten);
  })
  .get('/music/notes', guard('GET /v1/music/notes'), async (c) => {
    noSandbox();
    const ids = c.req.query('ids');
    const music = musicObject(c.env);
    if (ids !== undefined) {
      const list = ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length || list.length > L.batch || list.some((id) => !SONG_ID.test(id)))
        throw new ApiError('validation', [{ path: 'ids', issue: `1 to ${L.batch} track ids, comma-separated` }]);
      return c.json((await fresh(music.notes(list))) satisfies MusicNotesResponse);
    }
    const cursor = c.req.query('cursor') ?? '';
    if (cursor && !SONG_ID.test(cursor)) throw new ApiError('validation', [{ path: 'cursor', issue: 'a track id' }]);
    const limit = Number(c.req.query('limit') ?? L.batch);
    if (!Number.isInteger(limit) || limit < 1 || limit > L.batch)
      throw new ApiError('validation', [{ path: 'limit', issue: `1 to ${L.batch}` }]);
    return c.json((await fresh(music.notesPage(cursor, limit))) satisfies MusicNotesResponse);
  })
  .get('/music/find', guard('GET /v1/music/find'), async (c) => {
    noSandbox();
    const q = parseFind(c.req.query());
    if ('issues' in q) throw new ApiError('validation', q.issues);
    const now = Date.now();
    const [heard, never] = await Promise.all([
      fresh(sensesObject(c.env).musicSignals(now)),
      fresh(coreObject(c.env).musicNever(now)),
    ]);
    const r = await fresh(musicObject(c.env).find(q, heard.skips, never, heard.rated_out));
    if (!r) throw new ApiError('not_found', { reason: 'like names a song the catalog does not hold' });
    return c.json(r satisfies MusicFindResponse);
  });
