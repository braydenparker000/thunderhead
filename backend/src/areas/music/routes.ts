// /v1/music (MUSIC.md §1.3, API.md §11.21) and /v1/media/sign (API.md §11.15, SECURITY.md §9): the
// catalog in the ported player's own format under one ETag (an unchanged catalog costs a 304 and
// one row read), one track's waveform, and signed links to a track's audio and art in the shared
// bucket `jarvis-music`, so audio never passes through the Worker. Before the catalog is imported
// (I7) there is none to give: 409, never an empty library a phone would take as the real one.
// Study's books are not signed: the phone reads them through the Worker (GET /v1/library/books/:id/file).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import { type MediaSignResponse, MUSIC_LIMITS, type MusicWaveform } from '../../../../shared/contract/music.ts';
import { type AppEnv, guard, principalOf, whoOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json } from '../../http/validate';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { ART_KEY, AUDIO_KEY, SONG_ID } from './shapes';
import { signKey, signR2 } from './sign';

const BUCKET = 'jarvis-music';
const signBody = z.strictObject({
  refs: z.array(z.string().check(z.maxLength(300))).check(z.minLength(1), z.maxLength(MUSIC_LIMITS.sign_refs)),
});
const MUSIC_REF = /^music:([^#]+)(#art)?$/;

/** This isolate's copy of the catalog, by ETag: a new isolate asks the object once. */
let held: { etag: string; text: string } | null = null;

const unchanged = (header: string | undefined, etag: string) =>
  !!header && header.split(',').some((v) => v.trim().replace(/^W\//, '') === etag);

export const musicRoutes = new Hono<AppEnv>()
  .get('/music/catalog', guard('GET /v1/music/catalog'), async (c) => {
    const music = musicObject(c.env);
    const etag = await fresh(music.catalogTag());
    if (etag.startsWith('"m0-'))
      throw new ApiError('conflict', { reason: 'no catalog yet: the import (I7) has not run' });
    c.header('ETag', etag);
    if (unchanged(c.req.header('If-None-Match'), etag)) return c.body(null, 304);
    if (held?.etag !== etag) held = await fresh(music.catalog());
    // The object may have moved on between the two calls: the ETag sent is the text's own.
    c.header('ETag', held.etag);
    return c.body(held.text, 200, { 'Content-Type': 'application/json; charset=utf-8' });
  })
  .get('/music/waveforms/:id', guard('GET /v1/music/waveforms/:id'), async (c) => {
    const id = c.req.param('id');
    if (!SONG_ID.test(id)) throw new ApiError('not_found');
    const bars = await fresh(musicObject(c.env).waveform(id));
    if (!bars) throw new ApiError('not_found');
    return c.json({ id, bars } satisfies MusicWaveform);
  })
  .post('/media/sign', guard('POST /v1/media/sign'), async (c) => {
    const { refs } = await json(c, signBody);
    const key = signKey(c.env);
    if (!key) throw new ApiError('not_configured');
    const out: MediaSignResponse = { items: [], errors: [] };
    // Music is the owner's device's alone (`file:` comes later).
    const device = whoOf(principalOf(c)) === 'D';
    const wanted = new Map<string, { id: string; art: boolean }>();
    for (const ref of new Set(refs)) {
      const m = MUSIC_REF.exec(ref);
      if (!m || !device) out.errors.push({ ref, code: 'not_signable' });
      else if (!SONG_ID.test(m[1])) out.errors.push({ ref, code: 'not_found' });
      else wanted.set(ref, { id: m[1], art: !!m[2] });
    }
    const ids = [...new Set([...wanted.values()].map((w) => w.id))];
    const found = new Map(ids.length ? (await fresh(musicObject(c.env).keys(ids))).map((k) => [k.id, k]) : []);
    const now = Date.now();
    for (const [ref, w] of wanted) {
      const t = found.get(w.id);
      const k = w.art ? t?.cover_key : t?.audio_key;
      if (!k) out.errors.push({ ref, code: 'not_found' });
      else if (!(w.art ? ART_KEY : AUDIO_KEY).test(k)) out.errors.push({ ref, code: 'not_signable' });
      else out.items.push({ ref, ...(await signR2(key, BUCKET, k, now)) });
    }
    return c.json(out);
  });
