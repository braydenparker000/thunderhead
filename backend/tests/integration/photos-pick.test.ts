// Import from Drive (PHOTOS.md §3.1): GET /v1/photos/drive hands the phone the picker's public key;
// POST /v1/photos/from-drive registers files the owner picked in Google's picker by reference, one
// Drive call a file, at most 20 a request, with what Drive says of each (EXIF time, size, SHA-256),
// no preview and no ledger row, through the same registration as the daily pass; a known file is
// `already`, whichever way it came. Google is faked (photos-helpers.ts); every id and name is invented.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DriveStatus, FromDriveResponse } from '../../../shared/contract/photos.ts';
import { drivePass } from '../../src/areas/photos/reconcile';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, makeAgent, setupOwner } from '../helpers';
import { connectDrive, type FakeGoogle, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
let g: FakeGoogle;
const pick = (ids: string[], token = D) =>
  apiJson<FromDriveResponse>('POST', '/v1/photos/from-drive', { token, body: { ids } });
const raf = (n: number) => ({
  name: `DSCF${String(n).padStart(4, '0')}.RAF`,
  size: String(30_000_000 + n),
  mimeType: 'application/octet-stream',
  createdTime: '2026-10-31T08:00:00.000Z',
  modifiedTime: '2026-10-31T08:00:00.000Z',
  sha256Checksum: 'c'.repeat(64),
  imageMediaMetadata: { time: '2026:10:30 17:00:05', width: 7728, height: 5152 },
});
const metaCalls = () => g.calls.filter((c) => c.url.includes('imageMediaMetadata')).length;

beforeAll(async () => {
  D = (await setupOwner()).token;
  g = fakeGoogle();
  await connectDrive(D);
});

describe('import from Drive', () => {
  it('the Drive status carries the picker key (public by design) and app id', async () => {
    const s = (await apiJson<DriveStatus>('GET', '/v1/photos/drive', { token: D })).body;
    // The picker's app id is the Cloud project's number, the OAuth client id's first part.
    expect([s.picker_key, s.picker_app]).toEqual(['test-picker-key', '100000000001']);
  });

  it('registers picked photos by reference, refuses what is not one, one Drive call a file, no ledger row', async () => {
    g.picked = {
      'pick-raf-1': raf(1),
      'pick-jpg-1': {
        name: 'IMG_0001.JPG',
        size: '2000000',
        mimeType: 'image/jpeg',
        createdTime: '2026-09-02T10:00:00.000Z',
      },
      'pick-folder': { name: 'Trip', mimeType: 'application/vnd.google-apps.folder' },
      'pick-trashed': { ...raf(2), trashed: true },
      'pick-text': { name: 'notes.txt', size: '12', mimeType: 'text/plain', createdTime: '2026-09-02T10:00:00.000Z' },
    };
    const ledger = (await coreSql<{ n: number }>('SELECT COUNT(*) AS n FROM ledger'))[0]?.n;
    const before = metaCalls();
    const r = await pick([
      'pick-raf-1',
      'pick-jpg-1',
      'pick-folder',
      'pick-trashed',
      'pick-text',
      'pick-unknown',
      'pick-raf-1',
    ]);
    expect(r.status).toBe(200);
    expect(metaCalls() - before).toBe(6);
    expect(r.body.already).toEqual([]);
    expect(r.body.refused.map((x) => x.id)).toEqual(['pick-folder', 'pick-trashed', 'pick-text', 'pick-unknown']);
    const [a, b] = r.body.added;
    expect(a).toMatchObject({
      drive_id: 'pick-raf-1',
      name: 'DSCF0001.RAF',
      format: 'raf',
      bytes: 30_000_001,
      sha256: 'c'.repeat(64),
      width: 7728,
      height: 5152,
      preview: false,
      taken_at: Date.UTC(2026, 9, 30, 17, 0, 5),
      day: '2026-10-30',
    });
    expect(b).toMatchObject({
      drive_id: 'pick-jpg-1',
      format: 'jpeg',
      sha256: null,
      width: null,
      taken_at: Date.UTC(2026, 8, 2, 10),
      day: '2026-09-02',
    });
    expect((await coreSql<{ n: number }>('SELECT COUNT(*) AS n FROM ledger'))[0]?.n).toBe(ledger);
    const day = (
      await apiJson<{ days: { photos: { drive_id: string }[] }[] }>('GET', '/v1/photos?day=2026-10-30', { token: D })
    ).body;
    expect(day.days[0]?.photos.map((p) => p.drive_id)).toContain('pick-raf-1');
  });

  it('dedupes by Drive id, whichever way the photo came: picked again, uploaded from the phone, found by the daily pass', async () => {
    const phone = photoBody({ drive: 'pick-phone-1' });
    await apiJson('PUT', `/v1/photos/${uuidv7()}`, { token: D, body: phone });
    g.picked['pick-phone-1'] = raf(3);
    g.folder = [
      {
        id: 'pick-found-1',
        name: 'DSCF0004.RAF',
        size: '100',
        modifiedTime: '2026-10-01T09:00:00.000Z',
        mimeType: 'application/octet-stream',
      },
    ];
    expect((await drivePass(env))?.added).toBe(1);
    g.picked['pick-found-1'] = raf(4);
    const r = await pick(['pick-raf-1', 'pick-phone-1', 'pick-found-1']);
    expect(r.body).toEqual({ added: [], already: ['pick-raf-1', 'pick-phone-1', 'pick-found-1'], refused: [] });
    // Picked first, then listed by the next day's pass: still one photo.
    g.folder = [
      {
        id: 'pick-jpg-1',
        name: 'IMG_0001.JPG',
        size: '2000000',
        modifiedTime: '2026-10-02T09:00:00.000Z',
        mimeType: 'image/jpeg',
      },
    ];
    expect((await drivePass(env, Date.now() + 86_400_000))?.added).toBe(0);
    expect((await coreSql<{ n: number }>("SELECT COUNT(*) AS n FROM photos WHERE drive_id = 'pick-jpg-1'"))[0]?.n).toBe(
      1,
    );
  });

  it('a file picked after its purge is wanted after all: registered, and no longer bound for the trash', async () => {
    await coreSql("INSERT INTO photos_gone (drive_id, purged_at) VALUES ('pick-purged-1', 1)");
    g.picked['pick-purged-1'] = raf(5);
    expect((await pick(['pick-purged-1'])).body.added).toHaveLength(1);
    expect(await coreSql("SELECT drive_id FROM photos_gone WHERE drive_id = 'pick-purged-1'")).toEqual([]);
  });

  it('takes at most 20 a request (the phone sends the rest in further requests), the owner’s phone only, Drive connected', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `pick-many-${i}`);
    for (const id of ids) g.picked[id] = { ...raf(10), name: `${id}.JPG`, mimeType: 'image/jpeg' };
    expect((await pick(ids)).status).toBe(422);
    expect((await pick([])).status).toBe(422);
    const before = metaCalls();
    expect((await pick(ids.slice(0, 20))).body.added).toHaveLength(20);
    expect(metaCalls() - before).toBe(20);
    expect((await pick(['../etc'])).status).toBe(422);
    expect((await pick(['pick-many-20'], await makeAgent(D, 'mind:chat'))).status).toBe(403);
    expect((await api('DELETE', '/v1/photos/drive', { token: D })).status).toBe(204);
    expect((await pick(['pick-many-20'])).status).toBe(409);
    await connectDrive(D);
  });
});
