// The night's untagged place and find's packs stay true when the catalog or the notes change under
// them (MUSIC.md §10.5, DATA.md §6.2): a new track that takes a place a deleted one held is still
// offered, and so is an imported song below the place; a table restore of the notes (or any write
// that isn't a batch's own) rebuilds the packs and starts the place over. A synthetic catalog only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MusicFindResponse, MusicTracksResponse } from '../../../shared/contract/music.ts';
import { writeTrack } from '../../src/areas/music/store';
import type { Db } from '../../src/objects/base';
import type { Music } from '../../src/objects/music';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';
import { music, note, putNotes, seedCatalog, songId } from '../music-helpers';

let P = {} as Principals;
const sql = (q: string, ...b: unknown[]) =>
  runInDurableObject(music(), (_o: Music, st) => st.storage.sql.exec(q, ...b).toArray());
const page = async () =>
  (await apiJson<MusicTracksResponse>('GET', '/v1/music/tracks?untagged=1&limit=10', { token: P.N })).body;
const find = async (q: string) => (await apiJson<MusicFindResponse>('GET', `/v1/music/find?${q}`, { token: P.N })).body;
/** A track as the upload tools' writer puts it: the catalog's last place. */
const upload = (n: number) =>
  runInDurableObject(music(), (o: Music) => {
    const sha = n.toString(16).padStart(64, '0');
    const id = songId(n);
    writeTrack(
      (o as unknown as { db: Db }).db,
      { id, sha256: sha, size: 1000 + n, audioKey: `native/audio/${sha}.opus`, metadata: { title: `Upload ${n}` } },
      null,
      Date.now(),
    );
    (o as unknown as { dropIndex(): void }).dropIndex();
    return id;
  });

beforeAll(async () => {
  P = await principals();
});

describe('the night’s place', () => {
  it('a new track that takes a deleted track’s place is still offered', async () => {
    const a = await upload(0xa1);
    const b = await upload(0xb2);
    expect((await putNotes(P.N, [note(a), note(b)])).status).toBe(200);
    expect((await page()).items).toEqual([]);
    const [{ ord: last }] = (await sql('SELECT ord FROM tracks WHERE id = ?', b)) as { ord: number }[];
    // The last track goes, and the next upload takes its place again.
    await sql('DELETE FROM tracks WHERE id = ?', b);
    const c = await upload(0xc3);
    expect(await sql('SELECT ord FROM tracks WHERE id = ?', c)).toEqual([{ ord: last }]);
    expect((await page()).items.map((t) => t.id)).toEqual([c]);
  });

  it('an imported song below the place is offered', async () => {
    const [d] = await seedCatalog([{ title: 'Imported later' }], 5);
    expect((await page()).items.map((t) => t.id)).toEqual([d, songId(0xc3)]);
  });
});

describe('a restore under the packs', () => {
  it('rebuilds the packs and starts the place over when the notes change underneath', async () => {
    const ids = await seedCatalog(
      Array.from({ length: 4 }, (_, i) => ({ title: `Restored ${i}` })),
      20,
    );
    await putNotes(P.N, [
      note(ids[0], { moods: { calm: 0.9 } }),
      note(ids[1], { moods: { calm: 0.8 } }),
      note(ids[2], { moods: { calm: 0.7 } }),
      note(ids[3], { moods: { calm: 0.6 } }),
    ]);
    await page();
    expect((await find('moods=calm')).items.map((t) => t.id)).toEqual(ids);
    expect(await sql("SELECT key FROM music_state WHERE key = 'notes.stale'")).toEqual([]);
    // A restore of an older copy of the table: one song had no note then, another felt otherwise.
    await sql('DELETE FROM track_notes WHERE track_id = ?', ids[1]);
    await sql(
      `UPDATE track_notes SET note_json = json_set(note_json, '$.moods', json('{"calm":0.95}')) WHERE track_id = ?`,
      ids[3],
    );
    expect(await sql("SELECT key FROM music_state WHERE key = 'notes.stale'")).toEqual([{ key: 'notes.stale' }]);
    const found = await find('moods=calm');
    expect(found.items.map((t) => t.id)).toEqual([ids[3], ids[0], ids[2]]);
    expect(found.items[0].why.moods).toEqual({ calm: 0.95 });
    // The place starts over: the song that lost its note comes up in the night's page again.
    expect((await page()).items.map((t) => t.id)).toContain(ids[1]);
    expect(await sql("SELECT key FROM music_state WHERE key = 'notes.stale'")).toEqual([]);
    // A batch's own writes leave no mark.
    await putNotes(P.N, [note(ids[1], { moods: { calm: 0.5 } })]);
    expect(await sql("SELECT key FROM music_state WHERE key = 'notes.stale'")).toEqual([]);
  });
});
