// Google Drive for Photos (PHOTOS.md §3.1, §3.7): Connect asks Google for the drive.file scope
// with a one-use state; the public callback trades the code, seals the refresh token in the Auth
// object (never readable from its row without the pepper), makes the folder and goes back to
// /photos/; the upload token is minted from it and kept until it nearly expires, never for the
// mind; a grant Google refuses reads as revoked; Disconnect forgets it. The daily Drive pass trashes
// purged originals and registers files the shelf does not know, at most 200 a run, from where it
// stopped. Google is faked throughout (photos-helpers.ts).
import { env, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DriveStatus, PhotoShelfResponse, UploadTokenResponse } from '../../../shared/contract/photos.ts';
import { drivePass } from '../../src/areas/photos/reconcile';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { api, apiJson, authSql, core, coreSql, makeAgent, SITE, setupOwner } from '../helpers';
import { type FakeGoogle, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
let C = '';
let g: FakeGoogle;
const status = async () => (await apiJson<DriveStatus>('GET', '/v1/photos/drive', { token: D })).body;
const callback = (q: string) =>
  exports.default.fetch(new Request(`https://api.example.test/v1/photos/drive/callback?${q}`, { redirect: 'manual' }));
async function connect(code = 'good-code') {
  const r = await apiJson<{ url: string }>('POST', '/v1/photos/drive/connect', { token: D, headers: { Origin: SITE } });
  const url = new URL(r.body.url);
  return { res: await callback(`code=${code}&state=${url.searchParams.get('state')}`), url };
}

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  g = fakeGoogle();
});

describe('connecting Google Drive', () => {
  it('starts not connected, and the upload token says so', async () => {
    expect(await status()).toEqual({
      configured: true,
      connected: false,
      folder_name: null,
      revoked: false,
      connected_at: null,
      account: null,
      picker_key: 'test-picker-key',
      picker_app: '100000000001',
    });
    expect((await api('POST', '/v1/photos/upload-token', { token: D })).status).toBe(409);
  });

  it('asks for drive.file only, comes back once, seals the grant and makes the folder', async () => {
    const { res, url } = await connect();
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.test/v1/photos/drive/callback');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${SITE}/photos/?drive=connected`);
    // The state works once.
    expect((await callback(`code=good-code&state=${url.searchParams.get('state')}`)).status).toBe(400);
    // The consenting account, shown to the owner's phone; sealed at rest like the token.
    expect(await status()).toMatchObject({
      connected: true,
      folder_name: 'Thunderhead Photos',
      account: 'owner@example.test',
    });
    const [row] = await authSql<{ sealed: string; folder_id: string; account: string }>(
      'SELECT sealed, folder_id, account FROM drive_grant',
    );
    expect(row?.account).toMatch(/^v1\./);
    expect(row?.account).not.toContain('example.test');
    expect(row?.folder_id).toBe('folder-made-1');
    expect(row?.sealed).toMatch(/^v1\./);
    expect(row?.sealed).not.toContain('fake-refresh-1');
    expect(g.calls.some((c) => c.method === 'POST' && c.url.endsWith('/drive/v3/files?fields=id'))).toBe(true);
  });

  it('a declined consent or a wrong code goes back with a plain result', async () => {
    const r = await apiJson<{ url: string }>('POST', '/v1/photos/drive/connect', { token: D });
    const state = new URL(r.body.url).searchParams.get('state');
    const res = await callback(`error=access_denied&state=${state}`);
    expect(res.headers.get('Location')).toBe(`${SITE}/photos/?drive=declined`);
    expect((await connect('bad-code')).res.headers.get('Location')).toBe(`${SITE}/photos/?drive=failed`);
  });

  it('mints the upload token once until it nearly expires, for the phone only', async () => {
    const before = g.minted;
    const a = await apiJson<UploadTokenResponse>('POST', '/v1/photos/upload-token', { token: D });
    expect(a.status).toBe(200);
    expect(a.body.folder_id).toBe('folder-made-1');
    const b = await apiJson<UploadTokenResponse>('POST', '/v1/photos/upload-token', { token: D });
    expect(b.body.access_token).toBe(a.body.access_token);
    expect(g.minted).toBe(before);
    expect((await api('POST', '/v1/photos/upload-token', { token: C })).status).toBe(403);
  });

  it('a grant Google refuses reads as revoked; Disconnect forgets it', async () => {
    await runInDurableObject(
      env.AUTH.getByName('owner'),
      (o) => ((o as unknown as { driveAccess: null }).driveAccess = null),
    );
    g.revoked = true;
    const r = await apiJson<{ error: { details: { issue: string }[] } }>('POST', '/v1/photos/upload-token', {
      token: D,
    });
    expect(r.status).toBe(409);
    expect(await status()).toMatchObject({ connected: false, revoked: true, folder_name: 'Thunderhead Photos' });
    g.revoked = false;
    await connect();
    expect((await status()).connected).toBe(true);
    expect((await api('DELETE', '/v1/photos/drive', { token: D })).status).toBe(204);
    expect(await authSql('SELECT id FROM drive_grant')).toEqual([]);
    const revoke = g.calls.at(-1);
    expect(revoke?.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(revoke?.body).toBe('token=fake-refresh-1');
    await connect();
  });
});

describe('the daily Drive pass', () => {
  const file = (i: number) => ({
    id: `hand-added-${i}`,
    name: `IMG_${String(i).padStart(4, '0')}.JPG`,
    size: String(1000 + i),
    modifiedTime: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
    mimeType: 'image/jpeg',
  });

  it('registers what the shelf does not know, 200 a run, from where it stopped; trashes purged originals', async () => {
    const known = photoBody({ drive: 'hand-added-0' });
    await apiJson('PUT', `/v1/photos/${uuidv7()}`, { token: D, body: known });
    await runInDurableObject(core(), (o: Core) =>
      (o as unknown as { db: { run(q: string, ...a: unknown[]): number } }).db.run(
        "INSERT INTO photos_gone (drive_id, purged_at) VALUES ('hand-added-1', 1), ('gone-403', 2), ('gone-500', 3)",
      ),
    );
    // Each trash on its own: one Drive will not let us reach is done, a busy Drive's waits a day.
    g.trashFail = { 'gone-403': 403, 'gone-500': 500 };
    g.folder = Array.from({ length: 230 }, (_, i) => file(i));
    const first = await drivePass(env);
    expect(first).toEqual({ added: 198, trashed: 2 });
    expect(g.trashed).toEqual(['hand-added-1']);
    expect(await coreSql('SELECT drive_id FROM photos_gone')).toEqual([{ drive_id: 'gone-500' }]);
    // One listing page a run, so a run stays under 25 subrequests.
    expect(g.calls.filter((c) => c.url.includes('in+parents')).length).toBe(1);
    // Once a day: the same day's tick does nothing.
    expect(await drivePass(env)).toBeNull();
    const day = await apiJson<PhotoShelfResponse>('GET', '/v1/photos?day=2026-09-01', { token: D });
    const p = day.body.days[0]?.photos.find((x) => x.drive_id === 'hand-added-5');
    expect(p).toMatchObject({ format: 'jpeg', preview: false, name: 'IMG_0005.JPG', bytes: 1005 });
    // The next day goes on after the last file seen.
    expect(await drivePass(env, Date.now() + 86_400_000)).toEqual({ added: 30, trashed: 0 });
    const n = await coreSql<{ n: number }>("SELECT COUNT(*) AS n FROM photos WHERE drive_id LIKE 'hand-added-%'");
    expect(n[0]?.n).toBe(229);
  });
});
