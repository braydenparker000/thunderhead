// A photo's info (PHOTOS.md § Info; API.md §11.26): sent at registration or, for a photo registered
// without it, by PUT /v1/photos/:id/info; checked against the allowlist (an unknown key dropped, a
// GPS one among them; a known key out of range refused), at most 2 KB, kept canonical, returned by
// GET /v1/photos/:id; the same again writes nothing. Invented photos only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PhotoInfo, PhotoItem, PhotoResponse } from '../../../shared/contract/photos.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, setupOwner } from '../helpers';
import { connectDrive, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
const INFO: PhotoInfo = {
  lens: 'XF23mmF2 R WR',
  iso: 400,
  exposure: 0.004,
  fnumber: 2.8,
  film_mode: 0x600,
  highlight: -16,
};
const get = (id: string) => apiJson<PhotoResponse>('GET', `/v1/photos/${id}`, { token: D });
const putInfo = (id: string, body: unknown) =>
  apiJson<{ photo: PhotoItem; changed: boolean }>('PUT', `/v1/photos/${id}/info`, { token: D, body });
const stored = async (id: string) =>
  (await coreSql<{ info: string | null }>('SELECT info FROM photos WHERE id = ?', id))[0]?.info ?? null;

beforeAll(async () => {
  D = (await setupOwner()).token;
  fakeGoogle();
  await connectDrive(D);
});

describe('info at registration', () => {
  it('keeps the allowlist canonical and drops what it does not know, GPS too', async () => {
    const id = uuidv7();
    const body = {
      ...photoBody(),
      info: { ...INFO, GPSLatitude: 35.6586, gps: { lat: 35.6586, lon: 139.7454 }, maker: 'anything' },
    };
    expect((await api('PUT', `/v1/photos/${id}`, { token: D, body })).status).toBe(201);
    const json = (await stored(id)) ?? '';
    expect(json).toBe(JSON.stringify(Object.fromEntries(Object.entries(INFO).sort(([a], [b]) => a.localeCompare(b)))));
    expect(json).not.toMatch(/gps|35\.65|139\.74|maker/i);
    expect((await get(id)).body.info).toEqual(INFO);
  });

  it('a photo registered without it has none; the shelf never carries it', async () => {
    const id = uuidv7();
    await api('PUT', `/v1/photos/${id}`, { token: D, body: photoBody() });
    expect((await get(id)).body.info).toBeNull();
    const shelf = await apiJson<{ days: { photos: Record<string, unknown>[] }[] }>('GET', '/v1/photos', { token: D });
    expect(shelf.body.days.flatMap((d) => d.photos).some((p) => 'info' in p)).toBe(false);
  });

  it('refuses a known key out of its range, a name over 80 or with a control character, and over 2 KB', async () => {
    for (const info of [
      { iso: -1 },
      { rating: 6 },
      { exposure: Number.MAX_VALUE },
      { lens: 'L'.repeat(81) },
      { software: 'a\nb' },
    ]) {
      const r = await api('PUT', `/v1/photos/${uuidv7()}`, { token: D, body: { ...photoBody(), info } });
      expect(r.status, JSON.stringify(info)).toBe(422);
    }
    const big = await api('PUT', `/v1/photos/${uuidv7()}`, {
      token: D,
      body: { ...photoBody(), info: { iso: 200, note: 'x'.repeat(2100) } },
    });
    expect(big.status).toBe(413);
  });
});

describe('PUT /v1/photos/:id/info', () => {
  it('gives a photo its info, and its camera and film only where it has none', async () => {
    const id = uuidv7();
    await api('PUT', `/v1/photos/${id}`, { token: D, body: { ...photoBody(), camera: null, film: 'Velvia' } });
    const r = await putInfo(id, { info: INFO, camera: 'FUJIFILM X-T5', film: 'Classic Chrome' });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);
    expect(r.body.photo).toMatchObject({ camera: 'FUJIFILM X-T5', film: 'Velvia' });
    expect((await get(id)).body.info).toEqual(INFO);
    const again = await putInfo(id, { info: { ...INFO }, camera: 'FUJIFILM X-T5' });
    expect(again.body.changed).toBe(false);
  });

  it('keeps an empty read as {} (read, nothing found), and refuses an unknown or deleted photo', async () => {
    const id = uuidv7();
    await api('PUT', `/v1/photos/${id}`, { token: D, body: photoBody() });
    expect((await putInfo(id, { info: { lat: 1 } })).status).toBe(200);
    expect(await stored(id)).toBe('{}');
    expect((await get(id)).body.info).toEqual({});
    expect((await putInfo(uuidv7(), { info: INFO })).status).toBe(404);
    await api('DELETE', `/v1/photos/${id}`, { token: D });
    expect((await putInfo(id, { info: INFO })).status).toBe(404);
    expect((await putInfo(id, { info: INFO, extra: 1 })).status).toBe(422);
  });
});
