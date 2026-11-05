// Stacks, stars, the heart and the filters (PHOTOS.md, the shelf): a RAW and a JPEG with the same
// base name taken within 2 s are one stack, in either order and from any source (this phone, From
// Drive, the daily pass); the shelf and Recently deleted show it once, as its RAW; its stars, heart
// and flag are on both rows, and a delete or a restore takes both. GET /v1/photos?filter= pages under
// a chip; GET /v1/photos/:id/around gives the photos either side for culling. Invented photos only.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  FromDriveResponse,
  PhotoAroundResponse,
  PhotoItem,
  PhotoShelfResponse,
} from '../../../shared/contract/photos.ts';
import { drivePass } from '../../src/areas/photos/reconcile';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, setupOwner } from '../helpers';
import { connectDrive, type FakeGoogle, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
let g: FakeGoogle;
const T = Date.UTC(2026, 6, 10, 9, 0, 0);
const put = async (name: string, taken: number, format = /\.raf$/i.test(name) ? 'raf' : 'jpeg') => {
  const id = uuidv7();
  const r = await apiJson<{ photo: PhotoItem }>('PUT', `/v1/photos/${id}`, {
    token: D,
    body: { ...photoBody({ name, taken }), format },
  });
  expect(r.status).toBe(201);
  return r.body.photo;
};
const pairOf = async (id: string) =>
  (await coreSql<{ pair_id: string | null }>('SELECT pair_id FROM photos WHERE id = ?', id))[0]?.pair_id ?? null;
const shelf = (q: string) => apiJson<PhotoShelfResponse>('GET', `/v1/photos${q}`, { token: D });
const ids = (s: PhotoShelfResponse) => s.days.flatMap((d) => d.photos.map((p) => p.id));
const picked = (name: string, mime: string, time: string) => ({
  name,
  size: '20000000',
  mimeType: mime,
  createdTime: '2026-07-20T08:00:00.000Z',
  modifiedTime: '2026-07-20T08:00:00.000Z',
  imageMediaMetadata: { time, width: 6000, height: 4000 },
});

beforeAll(async () => {
  D = (await setupOwner()).token;
  g = fakeGoogle();
  await connectDrive(D);
});

describe('stacks', () => {
  it('pairs a RAF and its JPEG in either order, shows the RAW once, and keeps 2 s', async () => {
    const raf = await put('DSCF1001.RAF', T);
    const jpg = await put('DSCF1001.JPG', T + 1500);
    expect(jpg.pair_id).toBe(raf.id);
    expect(await pairOf(raf.id)).toBe(jpg.id);
    // The other order: the JPEG first.
    const j2 = await put('dscf1002.jpg', T + 60_000);
    const r2 = await put('DSCF1002.RAF', T + 59_000);
    expect([r2.pair_id, await pairOf(j2.id)]).toEqual([j2.id, r2.id]);
    // Past the window, or another name, or a second JPEG for a RAW already paired: no stack.
    const far = await put('DSCF1003.RAF', T + 120_000);
    const late = await put('DSCF1003.JPG', T + 122_500);
    const other = await put('DSCF1004.JPG', T + 120_500);
    const third = await put('DSCF1001.JPG', T + 500);
    for (const p of [far, late, other, third]) expect(await pairOf(p.id)).toBeNull();
    const day = (await shelf(`?day=${raf.day}`)).body.days[0];
    const shown = day?.photos.map((p) => p.id) ?? [];
    expect(shown).toContain(raf.id);
    expect(shown).toContain(r2.id);
    expect(shown).not.toContain(jpg.id);
    expect(shown).not.toContain(j2.id);
    expect(day?.count).toBe(6);
    expect(day?.photos.find((p) => p.id === raf.id)).toMatchObject({ pair_id: jpg.id, favorite: false, rating: 0 });
  });

  it('pairs across sources: a JPEG picked in Drive with the RAF from this phone, and the daily pass', async () => {
    g.picked['pick-jpg'] = picked('DSCF2001.JPG', 'image/jpeg', '2026:07:11 10:00:00');
    const r = await apiJson<FromDriveResponse>('POST', '/v1/photos/from-drive', {
      token: D,
      body: { ids: ['pick-jpg'] },
    });
    const jpg = r.body.added[0] as PhotoItem;
    const raf = await put('DSCF2001.RAF', jpg.taken_at - 800);
    expect([raf.pair_id, await pairOf(jpg.id)]).toEqual([jpg.id, raf.id]);
    // The daily pass finds a RAF whose JPEG came from this phone.
    const phoneJpg = await put('DSCF2002.JPG', jpg.taken_at + 3_600_000);
    const at = new Date(phoneJpg.taken_at).toISOString();
    (g.folder as unknown as Record<string, unknown>[]).push({
      id: 'pass-raf',
      name: 'DSCF2002.RAF',
      size: '30000000',
      modifiedTime: at,
      mimeType: 'application/octet-stream',
    });
    expect(await drivePass(env)).toEqual({ added: 1, trashed: 0 });
    const found = await coreSql<{ id: string; pair_id: string }>(
      "SELECT id, pair_id FROM photos WHERE drive_id = 'pass-raf'",
    );
    expect(found[0]?.pair_id).toBe(phoneJpg.id);
    expect(await pairOf(phoneJpg.id)).toBe(found[0]?.id);
  });

  it('puts a stack’s stars, heart and flag on both, and deletes and restores both', async () => {
    const raf = await put('DSCF3001.RAF', T + 86_400_000);
    const jpg = await put('DSCF3001.JPG', T + 86_400_000);
    const p = await apiJson<{ photo: PhotoItem }>('PATCH', `/v1/photos/${raf.id}`, {
      token: D,
      body: { rating: 4, favorite: true },
    });
    expect(p.body.photo).toMatchObject({ rating: 4, favorite: true });
    const rows = await coreSql<{ rating: number; favorite: number }>(
      'SELECT rating, favorite FROM photos WHERE id IN (?, ?)',
      raf.id,
      jpg.id,
    );
    expect(rows).toEqual([
      { rating: 4, favorite: 1 },
      { rating: 4, favorite: 1 },
    ]);
    const bad = await api('PATCH', `/v1/photos/${raf.id}`, { token: D, body: { favorite: 'yes' } });
    expect(bad.status).toBe(422);
    expect((await api('DELETE', `/v1/photos/${jpg.id}`, { token: D })).status).toBe(200);
    const gone = await coreSql<{ n: number }>(
      'SELECT COUNT(*) AS n FROM photos WHERE id IN (?, ?) AND deleted_at IS NOT NULL',
      raf.id,
      jpg.id,
    );
    expect(gone[0]?.n).toBe(2);
    const bin = (await apiJson<{ items: PhotoItem[] }>('GET', '/v1/photos/deleted', { token: D })).body.items;
    expect(bin.map((x) => x.id)).toEqual([raf.id]);
    expect((await api('POST', `/v1/photos/${raf.id}/restore`, { token: D })).status).toBe(200);
    const back = await coreSql<{ n: number }>(
      'SELECT COUNT(*) AS n FROM photos WHERE id IN (?, ?) AND deleted_at IS NULL',
      raf.id,
      jpg.id,
    );
    expect(back[0]?.n).toBe(2);
  });
});

describe('the filter', () => {
  it('pages under a chip and gives the photos either side in its order', async () => {
    // 16 days, each with one 4-star photo (the heart on every other) and an unrated one.
    const four: PhotoItem[] = [];
    for (let d = 0; d < 16; d++) {
      const at = Date.UTC(2025, 0, 1 + d, 12, 0);
      const p = await put(`IMG_${5000 + d}.JPG`, at);
      await apiJson('PATCH', `/v1/photos/${p.id}`, { token: D, body: { rating: 4, favorite: d % 2 === 0 } });
      await put(`IMG_${6000 + d}.JPG`, at + 60_000);
      four.push(p);
    }
    const top = (await shelf('?filter=stars4&before=2025-12-31')).body;
    expect(top.days).toHaveLength(14);
    expect(top.days.every((d) => d.count === 1)).toBe(true);
    expect(top.next).toBe(top.days.at(-1)?.day);
    const rest = (await shelf(`?filter=stars4&before=${top.next}`)).body;
    expect([...ids(top), ...ids(rest)]).toEqual(four.map((p) => p.id).reverse());
    expect(rest.next).toBeNull();
    const fav = (await shelf('?filter=favorites&before=2025-12-31')).body;
    expect(ids(fav)).toEqual(
      four
        .filter((_, i) => i % 2 === 0)
        .map((p) => p.id)
        .reverse(),
    );
    expect((await shelf('?filter=stars5&before=2025-12-31')).body.days).toEqual([]);
    expect((await shelf('?filter=unedited&day=2025-01-03')).body.days[0]?.count).toBe(2);
    expect((await shelf('?filter=raw&day=2025-01-03')).body.days).toEqual([]);
    expect((await api('GET', '/v1/photos?filter=sparkly', { token: D })).status).toBe(422);
    // Culling: the 4-star photos either side of the third, newest first.
    const a = (
      await apiJson<PhotoAroundResponse>('GET', `/v1/photos/${four[2]?.id}/around?filter=stars4`, { token: D })
    ).body;
    expect(a).toEqual({ newer: four[3]?.id, older: four[1]?.id });
    const all = (await apiJson<PhotoAroundResponse>('GET', `/v1/photos/${four[2]?.id}/around`, { token: D })).body;
    expect(all.newer).not.toBe(four[3]?.id);
    const none = await api('GET', `/v1/photos/${uuidv7()}/around`, { token: D });
    expect(none.status).toBe(404);
  });
});
