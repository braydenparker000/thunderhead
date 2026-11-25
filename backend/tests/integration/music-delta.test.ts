// The catalog in changes (GET /v1/music/catalog?since=, objects/music-delta.ts): with the
// `generatedAt` of the copy a phone holds, the songs changed after it and the ids removed after it,
// read from the change log, each song exactly as the whole catalog gives it, under the whole
// catalog's ETag and with its whole count; an unchanged catalog is still a 304 first; a time the
// catalog never had, one older than the log, or no `since` at all gives the whole catalog. Rows read
// follow the change, not the catalog. Every song is invented.
import { describe, expect, it } from 'vitest';
import { setupOwner } from '../helpers';
import { musicRows } from '../music-helpers';
import { catalogGet, uploader } from '../upload-helpers';

type Track = Record<string, unknown> & { id: string };
type Cat = { kind: string; count: number; generatedAt: string; since?: string; tracks: Track[]; removed?: string[] };
/** A moment later: two changes never share a millisecond here, so each delta is exactly its change. */
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('the catalog since a copy', () => {
  it('gives exactly what changed, or the whole catalog when the log cannot say', async () => {
    const u = await uploader();
    const owner = (await setupOwner()).token;
    const get = (q = '', h: Record<string, string> = {}) => catalogGet(u.E, owner, q, h);
    const since = (c: Cat) => `?since=${encodeURIComponent(c.generatedAt)}`;
    const tracks = [];
    for (let i = 1; i <= 3; i++) tracks.push(await u.song(i, { album: 'Rope Bridges', track: i }));
    expect((await u.op('register-batch', { tracks })).body).toMatchObject({ registered: 3 });
    const first = await get();
    const c0 = first.body as Cat;
    expect([c0.kind, c0.count]).toEqual(['r2-library', 3]);

    // Unchanged: the ETag still answers 304 first; with no ETag, an empty delta.
    expect((await get(since(c0), { 'If-None-Match': String(first.etag) })).status).toBe(304);
    const none = await get(since(c0));
    expect(none.body).toEqual({
      version: 1,
      kind: 'r2-library-delta',
      complete: true,
      count: 3,
      since: c0.generatedAt,
      generatedAt: c0.generatedAt,
      tracks: [],
      removed: [],
    });
    // The phone tells a delta by its head, written first.
    expect(none.text.slice(0, 400)).toContain('"kind":"r2-library-delta"');

    // One song added: that song alone, as the whole catalog gives it.
    await tick();
    const added = await u.op('register', await u.song(4, { album: 'Rope Bridges', track: 4 }));
    const id4 = String(added.body.id);
    let rows = { read: 0, written: 0 };
    let d = await get();
    rows = await musicRows(async () => {
      d = await get(since(c0));
    });
    const full = (await get()).body as Cat;
    const delta = d.body as Cat;
    expect(delta).toMatchObject({ kind: 'r2-library-delta', count: 4, since: c0.generatedAt, removed: [] });
    expect(delta.tracks).toEqual([full.tracks.find((t) => t.id === id4)]);
    expect(delta.generatedAt).toBe(full.generatedAt);
    expect(d.etag).toBe((await get()).etag);
    // The log's newest rows and the one song: never the whole catalog.
    expect(rows.read).toBeLessThan(40);
    expect(rows.written).toBe(0);

    // One song patched: that one.
    await tick();
    const id2 = String((full.tracks[1] as Track).id);
    expect((await u.op('patch', { id: id2, metadata: { genre: 'Folk' } })).body).toMatchObject({ patched: true });
    const c1 = full;
    const patched = (await get(since(c1))).body as Cat;
    expect(patched.tracks.map((t) => t.id)).toEqual([id2]);
    expect(patched.tracks[0]).toMatchObject({ metadata: { genre: 'Folk' } });
    expect([patched.removed, patched.count]).toEqual([[], 4]);

    // One song deleted: its id among the removed, no track.
    await tick();
    const c2 = (await get()).body as Cat;
    const id1 = String((c2.tracks[0] as Track).id);
    expect((await u.op('delete', { ids: [id1] })).body).toMatchObject({ deleted: [id1] });
    const gone = (await get(since(c2))).body as Cat;
    expect([gone.tracks, gone.removed, gone.count]).toEqual([[], [id1], 3]);
    // Since the first copy: everything after it at once, the removed one only among the removed.
    const all = (await get(since(c0))).body as Cat;
    expect([all.tracks.map((t) => t.id).sort(), all.removed, all.count]).toEqual([[id2, id4].sort(), [id1], 3]);

    // A time the catalog never had, one before its log, a bad one, or none: the whole catalog.
    const later = new Date(Date.parse(c0.generatedAt) + 1).toISOString();
    for (const q of [
      `?since=${encodeURIComponent(later)}`,
      '?since=2020-01-01T00%3A00%3A00.000Z',
      '?since=yesterday',
      `?since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
      '',
    ]) {
      const r = (await get(q)).body as Cat;
      expect([r.kind, r.count, r.tracks.length], q).toEqual(['r2-library', 3, 3]);
    }
  });
});
