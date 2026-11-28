// The editor's edit backups live in the Photos folder in Drive (`<id>.thunderhead-edit.json`, lab/editor/app/backup.js).
// The daily Drive pass took every file it did not know in as a photo, so a backup became a tile on the shelf, and a tile
// deleted then sent the backup to Drive's trash at the purge. Now the pass takes photos only (as a pick from Drive does),
// and a row that is no photo never sends its file to the trash. Google is faked (photos-helpers.ts).
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PhotoShelfResponse } from '../../../shared/contract/photos.ts';
import { drivePass } from '../../src/areas/photos/reconcile';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, setupOwner } from '../helpers';
import { connectDrive, type FakeGoogle, fakeGoogle, photoBody } from '../photos-helpers';

const DAY = 86_400_000;
let D = '';
let g: FakeGoogle;
beforeAll(async () => {
  D = (await setupOwner()).token;
  g = fakeGoogle();
  await connectDrive(D);
});

describe('the editor’s edit backups in the Photos folder', () => {
  it('the daily pass takes the photos beside them in, and never a backup', async () => {
    g.folder = [
      { id: 'edit-backup-1', name: '019a0000-0000-7000-8000-000000000001.thunderhead-edit.json', size: '180', modifiedTime: '2026-10-30T18:00:00.000Z', mimeType: 'application/json' },
      { id: 'raf-beside-1', name: 'DSCF0201.RAF', size: '31457280', modifiedTime: '2026-10-30T18:01:00.000Z', mimeType: 'application/octet-stream' },
    ];
    expect(await drivePass(env)).toEqual({ added: 1, trashed: 0 });
    expect(await coreSql("SELECT id FROM photos WHERE drive_id = 'edit-backup-1'")).toEqual([]);
    const shelf = (await apiJson<PhotoShelfResponse>('GET', '/v1/photos', { token: D })).body;
    expect(shelf.days.flatMap((d) => d.photos.map((p) => p.name))).toEqual(['DSCF0201.RAF']);
  });

  it('a backup taken in as a photo before, then deleted, keeps its file at the purge; a photo’s goes to the trash', async () => {
    const backup = uuidv7(), raf = uuidv7();
    // the row as the pass before this one made it: registered, then the backup's own name and format
    expect((await apiJson('PUT', `/v1/photos/${backup}`, { token: D, body: photoBody({ drive: 'edit-backup-2' }) })).status).toBe(201);
    await coreSql("UPDATE photos SET name = '019a0000-0000-7000-8000-000000000002.thunderhead-edit.json', format = 'other', bytes = 180 WHERE id = ?", backup);
    expect((await apiJson('PUT', `/v1/photos/${raf}`, { token: D, body: photoBody({ drive: 'raf-gone-1', name: 'DSCF0202.RAF' }) })).status).toBe(201);
    for (const id of [backup, raf]) expect((await api('DELETE', `/v1/photos/${id}`, { token: D })).status).toBe(200);
    await runInDurableObject(core(), (o: Core) => (o as unknown as { purgePhotos: (now: number) => Promise<number> }).purgePhotos(Date.now() + 31 * DAY));
    expect(await coreSql('SELECT id FROM photos WHERE id IN (?, ?)', backup, raf)).toEqual([]);
    expect((await coreSql<{ drive_id: string }>('SELECT drive_id FROM photos_gone ORDER BY drive_id')).map((r) => r.drive_id)).toEqual(['raf-gone-1']);
  });
});
