// Pending photos (PHOTOS.md §3.1, API.md §11.26): a phone whose browser uploads in the background
// registers the photo before Drive has it (`drive_id` null, no call to Drive); it is on the shelf and
// in GET /v1/photos/pending, takes no paste, and gets its Drive id later by PATCH (checked with Drive
// against what was registered; the same id again writes nothing; another id or another photo's file
// is a conflict). The daily pass takes a pending photo's own file as that photo. Invented photos only.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PhotoItem, PhotoShelfResponse } from '../../../shared/contract/photos.ts';
import { drivePass } from '../../src/areas/photos/reconcile';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, setupOwner } from '../helpers';
import { connectDrive, type FakeGoogle, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
let g: FakeGoogle;
type One = { photo: PhotoItem };
const put = (id: string, body: object) => apiJson<One>('PUT', `/v1/photos/${id}`, { token: D, body });
const patch = (id: string, body: object) => apiJson<One>('PATCH', `/v1/photos/${id}`, { token: D, body });
const pending = async () =>
  (await apiJson<{ items: PhotoItem[] }>('GET', '/v1/photos/pending', { token: D })).body.items.map((p) => p.id);
const metaCalls = () => g.calls.filter((c) => /\/drive\/v3\/files\/[^?]+\?fields=/.test(c.url)).length;

beforeAll(async () => {
  D = (await setupOwner()).token;
  g = fakeGoogle();
  await connectDrive(D);
});

describe('a pending photo', () => {
  it('registers with no Drive id and no call to Drive, shows on the shelf and in the pending list', async () => {
    const id = uuidv7();
    const before = metaCalls();
    const r = await put(id, { ...photoBody(), drive_id: null, name: 'DSCF0200.RAF' });
    expect(r.status).toBe(201);
    expect(r.body.photo).toMatchObject({ id, drive_id: null, name: 'DSCF0200.RAF' });
    expect(metaCalls()).toBe(before);
    // The same registration again is a retry.
    expect((await put(id, { ...photoBody(), drive_id: null, name: 'DSCF0200.RAF' })).status).toBe(200);
    expect(await pending()).toContain(id);
    const day = await apiJson<PhotoShelfResponse>('GET', '/v1/photos?day=2026-10-30', { token: D });
    expect(day.body.days[0]?.photos.some((p) => p.id === id && p.drive_id === null)).toBe(true);
  });

  it('takes its Drive id by PATCH once, checked with Drive; the same again is idempotent', async () => {
    const id = uuidv7();
    await put(id, { ...photoBody(), drive_id: null });
    const before = metaCalls();
    const r = await patch(id, { drive_id: 'drive-late-1' });
    expect(r.status).toBe(200);
    expect(r.body.photo.drive_id).toBe('drive-late-1');
    expect(metaCalls()).toBe(before + 1);
    expect(await pending()).not.toContain(id);
    // The same id again: no Drive call, nothing written.
    const again = await patch(id, { drive_id: 'drive-late-1' });
    expect(again.status).toBe(200);
    expect(metaCalls()).toBe(before + 1);
    // Another id on a photo that has one, or another photo's file: a conflict.
    expect((await patch(id, { drive_id: 'drive-late-2' })).status).toBe(409);
    const other = uuidv7();
    await put(other, { ...photoBody(), drive_id: null });
    expect((await patch(other, { drive_id: 'drive-late-1' })).status).toBe(409);
    // A rating with it still works.
    expect((await patch(other, { drive_id: 'drive-late-3', rating: 2 })).body.photo).toMatchObject({
      drive_id: 'drive-late-3',
      rating: 2,
    });
  });

  it('refuses a Drive file that is not what was registered, and an unknown photo', async () => {
    const id = uuidv7();
    await put(id, { ...photoBody(), drive_id: null });
    g.meta['drive-wrong-size'] = { size: 12 };
    expect((await patch(id, { drive_id: 'drive-wrong-size' })).status).toBe(422);
    g.meta['drive-gone'] = 404;
    expect((await patch(id, { drive_id: 'drive-gone' })).status).toBe(422);
    expect((await patch(uuidv7(), { drive_id: 'drive-x' })).status).toBe(404);
    expect(await pending()).toContain(id);
  });

  it('the page upload after a failed background one: PUT with the Drive id fills the pending photo', async () => {
    const id = uuidv7();
    await put(id, { ...photoBody(), drive_id: null });
    const r = await put(id, { ...photoBody(), drive_id: 'drive-page-1' });
    expect(r.status).toBe(200);
    expect(r.body.photo.drive_id).toBe('drive-page-1');
    // Another file's hash on that id (Drive agrees with the body) is a conflict.
    g.meta['drive-page-2'] = { sha256: 'c'.repeat(64) };
    const b = uuidv7();
    await put(b, { ...photoBody(), drive_id: null });
    expect((await put(b, { ...photoBody(), drive_id: 'drive-page-2', sha256: 'c'.repeat(64) })).status).toBe(409);
  });

  it('takes no paste until it is in Drive', async () => {
    const id = uuidv7();
    await put(id, { ...photoBody(), drive_id: null });
    const r = await apiJson('POST', '/v1/photos/paste', {
      token: D,
      body: { ids: [id], panels: ['light'], recipe: { Exposure2012: 0.5 } },
    });
    expect(r.status).toBe(409);
  });

  it('the daily pass takes a pending photo’s own file (the same name and size) as that photo', async () => {
    const id = uuidv7();
    await put(id, { ...photoBody(), drive_id: null, name: 'DSCF0300.RAF' });
    g.folder = [
      {
        id: 'drive-pass-1',
        name: 'DSCF0300.RAF',
        size: '31457280',
        modifiedTime: '2026-10-30T18:00:00.000Z',
        mimeType: 'application/octet-stream',
      },
      {
        id: 'drive-pass-2',
        name: 'DSCF0301.RAF',
        size: '31457280',
        modifiedTime: '2026-10-30T18:01:00.000Z',
        mimeType: 'application/octet-stream',
      },
    ];
    expect(await drivePass(env)).toEqual({ added: 1, trashed: 0 });
    const rows = await coreSql<{ id: string }>("SELECT id FROM photos WHERE drive_id = 'drive-pass-1'");
    expect(rows).toEqual([{ id }]);
  });
});
