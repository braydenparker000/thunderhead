// A photo's versions (PHOTOS.md, Versions; API.md §11.26): automatic ones (an equal recipe again
// writes nothing, the oldest goes past 20), named ones (a 21st refused until one is deleted), rename
// and delete, restore as an ordinary recipe put with its undo, and the versions gone with a purged
// photo. Invented photos only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PhotoRecipe, PhotoVersion } from '../../../shared/contract/photos.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, setupOwner } from '../helpers';
import { connectDrive, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
let id = '';
const post = (body: Record<string, unknown>, pid = id) =>
  apiJson<{ version: PhotoVersion; created: boolean }>('POST', `/v1/photos/${pid}/versions`, {
    token: D,
    body: { id: uuidv7(), ...body },
  });
const list = async () =>
  (await apiJson<{ items: PhotoVersion[] }>('GET', `/v1/photos/${id}/versions`, { token: D })).body.items;

beforeAll(async () => {
  D = (await setupOwner()).token;
  fakeGoogle();
  await connectDrive(D);
  id = uuidv7();
  expect((await api('PUT', `/v1/photos/${id}`, { token: D, body: photoBody() })).status).toBe(201);
});

describe('/v1/photos/:id/versions', () => {
  it('keeps an automatic version canonical, and the same recipe again writes nothing', async () => {
    const a = await post({ kind: 'auto', recipe: { Exposure2012: 0.3, Contrast2012: 0, CropAngle: 4.5 } });
    expect(a.status).toBe(201);
    expect(a.body.version).toMatchObject({ kind: 'auto', name: null, recipe: { CropAngle: 4.5, Exposure2012: 0.3 } });
    const again = await post({ kind: 'auto', recipe: { CropAngle: 4.5, Exposure2012: 0.3 } });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, version: { id: a.body.version.id } });
    expect((await list()).length).toBe(1);
  });

  it('keeps 20 automatic versions, the oldest going first', async () => {
    for (let i = 1; i <= 21; i++)
      expect((await post({ kind: 'auto', recipe: { Exposure2012: i / 10 } })).status).toBe(201);
    const autos = (await list()).filter((v) => v.kind === 'auto');
    expect(autos.length).toBe(20);
    expect(autos.at(-1)?.recipe).toEqual({ Exposure2012: 0.2 });
    expect(autos[0]?.recipe).toEqual({ Exposure2012: 2.1 });
  });

  it('names, renames and deletes; a 21st named version is refused until one goes', async () => {
    const n = await post({ kind: 'named', name: 'Warm crop', recipe: { Temperature: 6000, WhiteBalance: 'Custom' } });
    expect(n.body.version).toMatchObject({ kind: 'named', name: 'Warm crop' });
    for (let i = 2; i <= 20; i++)
      expect((await post({ kind: 'named', name: `Look ${i}`, recipe: {} })).status).toBe(201);
    expect((await post({ kind: 'named', name: 'One too many', recipe: {} })).status).toBe(409);
    const auto = (await list()).find((v) => v.kind === 'auto') as PhotoVersion;
    expect(
      (await api('PATCH', `/v1/photos/${id}/versions/${auto.id}`, { token: D, body: { name: 'Kept' } })).status,
    ).toBe(409);
    const r = await apiJson<{ version: PhotoVersion }>('PATCH', `/v1/photos/${id}/versions/${n.body.version.id}`, {
      token: D,
      body: { name: 'Warmer crop' },
    });
    expect(r.body.version.name).toBe('Warmer crop');
    expect((await api('DELETE', `/v1/photos/${id}/versions/${n.body.version.id}`, { token: D })).status).toBe(200);
    expect((await api('DELETE', `/v1/photos/${id}/versions/${n.body.version.id}`, { token: D })).status).toBe(404);
    const named = await apiJson<{ version: PhotoVersion }>('PATCH', `/v1/photos/${id}/versions/${auto.id}`, {
      token: D,
      body: { name: 'Kept' },
    });
    expect(named.body.version).toMatchObject({ kind: 'named', name: 'Kept' });
  });

  it('refuses a bad crop, an unknown key, a bad id and another photo', async () => {
    expect((await post({ kind: 'auto', recipe: { CropLeft: 0.6, CropRight: 0.4 } })).status).toBe(422);
    expect((await post({ kind: 'auto', recipe: { Nonsense: 1 } })).status).toBe(422);
    expect(
      (await api('POST', `/v1/photos/${id}/versions`, { token: D, body: { id: 'x', kind: 'auto', recipe: {} } }))
        .status,
    ).toBe(422);
    expect((await post({ kind: 'auto', recipe: {} }, uuidv7())).status).toBe(404);
  });

  it('restores as a recipe put whose undo is the recipe before', async () => {
    const v = (await list()).find((x) => x.name === 'Kept') as PhotoVersion;
    await api('PUT', `/v1/photos/${id}/recipe`, {
      token: D,
      body: { recipe: { Exposure2012: -1, FlipHorizontal: true } },
    });
    const r = await apiJson<{ recipe: PhotoRecipe }>('PUT', `/v1/photos/${id}/recipe`, {
      token: D,
      body: { recipe: v.recipe },
    });
    expect(r.body.recipe).toEqual(v.recipe);
    const rows = await coreSql<{ undo_json: string }>(
      'SELECT undo_json FROM ledger WHERE ref = ? ORDER BY seq DESC LIMIT 1',
      `photo:${id}`,
    );
    expect(JSON.parse(rows[0]?.undo_json ?? '{}').args.before).toBe('{"Exposure2012":-1,"FlipHorizontal":true}');
  });

  it('goes with the photo when it is purged', async () => {
    expect((await coreSql('SELECT id FROM photo_versions WHERE photo_id = ?', id)).length).toBe(39);
    await api('DELETE', `/v1/photos/${id}`, { token: D });
    expect((await post({ kind: 'auto', recipe: { Exposure2012: 1 } })).status).toBe(404);
    await runInDurableObject(core(), (o: Core) =>
      (o as unknown as { purgePhotos(n: number): Promise<number> }).purgePhotos(Date.now() + 31 * DAY),
    );
    expect(await coreSql('SELECT id FROM photo_versions WHERE photo_id = ?', id)).toEqual([]);
  });
});
