// /v1/guitar (GUITAR.md §11, MIGRATION.md §7 step 5, P6): the tab sources the ported Guitar app used
// through the old Worker, now through this one, for the owner's device only: Songsterr search, a
// song's tracks and the chosen tracks' revisions, GProTab search and Guitar Pro downloads, and the
// guitar samples. A source's own words for what went wrong travel in `details.reason`, which the
// app shows as before. Nothing is logged or stored; the edge may keep a public file for a while.
import { Hono } from 'hono';
import type { ErrorCode } from '../../../../shared/contract/errors';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { getRevisions, getSong, searchSongs } from './songsterr';
import { gprotabFile, searchGprotab, sound } from './sources';
import { SourceError } from './upstream';

const CODE: Record<number, ErrorCode> = {
  400: 'bad_request',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  422: 'validation',
};
/** A source's failure as this API's envelope, its words kept for the app. */
async function answer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    throw new ApiError(CODE[e.status] ?? 'upstream', { reason: e.message });
  }
}

export const guitarRoutes = new Hono<AppEnv>()
  .get('/guitar/search', guard('GET /v1/guitar/search'), async (c) =>
    c.json({ results: await answer(() => searchSongs(c.req.query('q') ?? '')) }),
  )
  .get('/guitar/songs/:id', guard('GET /v1/guitar/songs/:id'), async (c) => {
    const id = Number(c.req.param('id'));
    return c.json({ song: await answer(() => getSong(id)) });
  })
  .get('/guitar/songs/:id/score', guard('GET /v1/guitar/songs/:id/score'), async (c) => {
    const id = Number(c.req.param('id'));
    return c.json(
      await answer(async () => {
        const meta = await getSong(id);
        if (String(meta.revisionId) !== c.req.query('revision'))
          throw new SourceError('This tab changed. Choose the song again to load the latest tracks.', 409);
        const input = c.req.query('parts') ?? '';
        if (!/^\d+(,\d+)*$/.test(input)) throw new SourceError('Choose a track.', 400);
        const ids = [...new Set(input.split(',').map(Number))];
        const selected = ids.map((p) => meta.tracks.find((t) => t.partId === p));
        if (!ids.length || ids.length > 12 || selected.some((t) => !t))
          throw new SourceError('Choose up to 12 available tracks.', 400);
        return { meta, revisions: await getRevisions(meta, selected as typeof meta.tracks) };
      }),
    );
  })
  .get('/guitar/gprotab/search', guard('GET /v1/guitar/gprotab/search'), async (c) =>
    c.json({ results: await answer(() => searchGprotab(c.req.query('q') ?? '')) }),
  )
  .get('/guitar/gprotab/file', guard('GET /v1/guitar/gprotab/file'), async (c) => {
    const { bytes } = await answer(() => gprotabFile(c.req.query('path') ?? ''));
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/octet-stream' });
  })
  .get('/guitar/sounds/:instrument/:file', guard('GET /v1/guitar/sounds/:instrument/:file'), async (c) => {
    const m = /^([A-Za-z0-9]+)\.mp3$/.exec(c.req.param('file'));
    if (!m) throw new ApiError('not_found');
    const bytes = await answer(() => sound(c.req.param('instrument'), m[1]));
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'audio/mpeg' });
  });
