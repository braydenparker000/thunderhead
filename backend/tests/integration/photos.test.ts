// The shelf (PHOTOS.md §3.1, API.md §11.26): a photo is registered once its original is in Drive
// (the same id again is a retry, a Drive file already on the shelf is that photo, another file on
// the same id a conflict), by day in the owner's zone, newest first, four photos and a count a day,
// a page of 14 days; rated and flagged; to Recently deleted and back; purged 30 days on with its
// preview, its Drive id kept for the trash; the preview stored in the private bucket and served
// only through the Worker. The owner's phone only. Invented photos only.
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PhotoItem, PhotoShelfResponse } from '../../../shared/contract/photos.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';
import { photoBody, previewBytes } from '../photos-helpers';

let D = '';
let C = '';
const put = (id: string, body: object, token = D) =>
  apiJson<{ photo: PhotoItem }>('PUT', `/v1/photos/${id}`, { token, body });
const shelf = (q = '') => apiJson<PhotoShelfResponse>('GET', `/v1/photos${q}`, { token: D });
const sendPreview = (id: string, bytes: Uint8Array, type = 'image/jpeg') =>
  exportsFetch(`/v1/photos/${id}/preview`, { method: 'PUT', headers: { 'Content-Type': type }, body: bytes });
async function exportsFetch(path: string, init: RequestInit = {}) {
  const { exports } = await import('cloudflare:workers');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${D}`);
  headers.set('CF-Connecting-IP', '192.0.2.10');
  return exports.default.fetch(new Request(`https://api.example.test${path}`, { ...init, headers }));
}

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('PUT /v1/photos/:id', () => {
  it('registers a photo on its capture day, once; a retry is the same photo', async () => {
    const id = uuidv7();
    const body = photoBody({ drive: 'drive-one' });
    const r = await put(id, body);
    expect(r.status).toBe(201);
    expect(r.body.photo).toMatchObject({
      id,
      drive_id: 'drive-one',
      day: '2026-10-30',
      rating: 0,
      flag: null,
      preview: false,
    });
    expect(r.body.photo).not.toHaveProperty('preview_key');
    expect((await put(id, body)).status).toBe(200);
    // The same Drive file under another id is the photo already on the shelf.
    expect((await put(uuidv7(), body)).body.photo.id).toBe(id);
    expect((await put(id, { ...body, drive_id: 'drive-other' })).status).toBe(409);
  });

  it('refuses a bad body, the mind, and an id that is not a UUIDv7', async () => {
    expect((await put(uuidv7(), { ...photoBody(), sha256: 'nope' })).status).toBe(422);
    expect((await put(uuidv7(), { ...photoBody(), format: 'gif' })).status).toBe(422);
    expect((await put(uuidv7(), photoBody(), C)).status).toBe(403);
    expect((await put('not-an-id', photoBody())).status).toBe(422);
  });
});

describe('GET /v1/photos', () => {
  it('lists days newest first, four photos and a count each, paged by 14 days', async () => {
    for (let d = 0; d < 16; d++)
      for (let i = 0; i < (d === 0 ? 6 : 1); i++)
        await put(uuidv7(), photoBody({ taken: Date.UTC(2026, 6, 1 + d, 9, i) }));
    const first = await shelf();
    expect(first.status).toBe(200);
    expect(first.body.days).toHaveLength(14);
    expect(first.body.days[0]?.day).toBe('2026-10-30');
    expect(first.body.next).toBe(first.body.days[13]?.day);
    const second = await shelf(`?before=${first.body.next}`);
    const all = [...first.body.days, ...second.body.days];
    const july1 = all.find((d) => d.day === '2026-07-01');
    expect(july1?.count).toBe(6);
    expect(july1?.photos).toHaveLength(4);
    expect(july1?.photos.map((p) => p.taken_at)).toEqual(
      [...(july1?.photos.map((p) => p.taken_at) ?? [])].sort((a, b) => b - a),
    );
    expect(second.body.next).toBeNull();
    const day = await shelf('?day=2026-07-01');
    expect(day.body.days[0]?.photos).toHaveLength(6);
    expect((await shelf('?day=July')).status).toBe(422);
  });
});

describe('rating, Recently deleted and the purge', () => {
  it('rates and flags; deletes to Recently deleted and restores', async () => {
    const id = uuidv7();
    await put(id, photoBody({ taken: Date.UTC(2026, 5, 2, 8) }));
    const rated = await apiJson<{ photo: PhotoItem }>('PATCH', `/v1/photos/${id}`, {
      token: D,
      body: { rating: 4, flag: 'pick' },
    });
    expect(rated.body.photo).toMatchObject({ rating: 4, flag: 'pick' });
    expect((await apiJson('PATCH', `/v1/photos/${id}`, { token: D, body: { rating: 6 } })).status).toBe(422);
    expect((await api('DELETE', `/v1/photos/${id}`, { token: D })).status).toBe(200);
    expect((await shelf('?day=2026-06-02')).body.days).toEqual([]);
    const gone = await apiJson<{ items: PhotoItem[] }>('GET', '/v1/photos/deleted', { token: D });
    expect(gone.body.items.map((p) => p.id)).toContain(id);
    expect((await apiJson('PATCH', `/v1/photos/${id}`, { token: D, body: { rating: 1 } })).status).toBe(404);
    expect((await api('POST', `/v1/photos/${id}/restore`, { token: D })).status).toBe(200);
    expect((await shelf('?day=2026-06-02')).body.days[0]?.photos[0]?.rating).toBe(4);
    const ledger = await coreSql<{ what: string }>('SELECT what FROM ledger WHERE ref = ?', `photo:${id}`);
    expect(ledger.map((l) => l.what)).toEqual(['moved a photo to Recently deleted']);
  });

  it('purges a photo deleted 30 days ago with its preview, and keeps its Drive id for the trash', async () => {
    const id = uuidv7();
    await put(id, photoBody({ drive: 'drive-purged', taken: Date.UTC(2026, 4, 5, 8) }));
    expect((await sendPreview(id, previewBytes())).status).toBe(200);
    const key = `photos/previews/${id}.jpg`;
    expect(await env.VAULT.head(key)).not.toBeNull();
    await api('DELETE', `/v1/photos/${id}`, { token: D });
    const purge = (at: number) =>
      runInDurableObject(core(), (o: Core) =>
        (o as unknown as { purgePhotos(n: number): Promise<number> }).purgePhotos(at),
      );
    expect(await purge(Date.now() + 29 * DAY)).toBe(0);
    expect(await purge(Date.now() + 31 * DAY)).toBe(1);
    expect(await coreSql('SELECT id FROM photos WHERE id = ?', id)).toEqual([]);
    expect(await env.VAULT.head(key)).toBeNull();
    expect(await coreSql('SELECT drive_id FROM photos_gone')).toEqual([{ drive_id: 'drive-purged' }]);
  });
});

describe('the preview', () => {
  it('is stored in the private bucket and served only through the Worker, with an ETag', async () => {
    const id = uuidv7();
    await put(id, photoBody({ taken: Date.UTC(2026, 3, 9, 8) }));
    expect((await exportsFetch(`/v1/photos/${id}/preview`)).status).toBe(404);
    expect((await sendPreview(id, previewBytes(), 'image/png')).status).toBe(422);
    expect((await sendPreview(id, new Uint8Array([1, 2, 3, 4, 5]))).status).toBe(422);
    expect((await sendPreview(id, previewBytes(400 * 1024 + 1))).status).toBe(413);
    const ok = await sendPreview(id, previewBytes());
    expect(((await ok.json()) as { photo: PhotoItem }).photo.preview).toBe(true);
    const got = await exportsFetch(`/v1/photos/${id}/preview`);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(previewBytes());
    const etag = got.headers.get('ETag') ?? '';
    expect((await exportsFetch(`/v1/photos/${id}/preview`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
  });
});
