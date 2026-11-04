// A photo's recipe (PHOTOS.md, the editor; API.md §11.26): validated against the contract's ranges,
// stored canonical with its hash (the same recipe again writes nothing and leaves no ledger row), a
// ledger row per change whose undo puts the recipe before back (refused once a newer edit came after),
// and the `photo.edit` sense with the panel only. Invented photos only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PhotoItem, PhotoRecipe } from '../../../shared/contract/photos.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, setupOwner } from '../helpers';
import { connectDrive, fakeGoogle, photoBody } from '../photos-helpers';

let D = '';
let id = '';
const put = (recipe: unknown, pid = id) =>
  apiJson<{ photo: PhotoItem; recipe: PhotoRecipe; changed: boolean }>('PUT', `/v1/photos/${pid}/recipe`, {
    token: D,
    body: { recipe },
  });
const ledger = () =>
  coreSql<{ id: string; what: string; undo_json: string | null }>(
    'SELECT id, what, undo_json FROM ledger WHERE ref = ? ORDER BY seq',
    `photo:${id}`,
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  fakeGoogle();
  await connectDrive(D);
  id = uuidv7();
  expect((await api('PUT', `/v1/photos/${id}`, { token: D, body: photoBody() })).status).toBe(201);
});

describe('PUT /v1/photos/:id/recipe', () => {
  it('stores the recipe canonical: defaults left out, the photo marked edited, GET returns it', async () => {
    const r = await put({
      Exposure2012: 0.5,
      Contrast2012: 0,
      Shadows2012: 20,
      WhiteBalance: 'As Shot',
      Temperature: 5000,
    });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);
    expect(r.body.recipe).toEqual({ Exposure2012: 0.5, Shadows2012: 20 });
    expect(r.body.photo.edited).toBe(true);
    const g = await apiJson<{ photo: PhotoItem; recipe: PhotoRecipe }>('GET', `/v1/photos/${id}`, { token: D });
    expect(g.body.recipe).toEqual({ Exposure2012: 0.5, Shadows2012: 20 });
    expect((await ledger()).map((l) => l.what)).toEqual(['edited a photo']);
  });

  it('is idempotent by hash: the same recipe again (any key order) writes nothing', async () => {
    const before = await ledger();
    const r = await put({ Shadows2012: 20, Exposure2012: 0.5, Highlights2012: 0 });
    expect(r.body.changed).toBe(false);
    expect(await ledger()).toEqual(before);
  });

  it('refuses values out of range, unknown keys, bad curves and a deleted photo', async () => {
    for (const bad of [
      { Exposure2012: 6 },
      { Contrast2012: -101 },
      { Temperature: 1000 },
      { WhiteBalance: 'Daylight' },
      { Clarity: 10 },
      { ToneCurvePV2012: [[0, 0]] },
      {
        ToneCurvePV2012: [
          [0, 0],
          [0, 255],
        ],
      },
      {
        ToneCurvePV2012: [
          [0, 0],
          [128, 300],
        ],
      },
      { ConvertToGrayscale: 'yes' },
    ])
      expect((await put(bad)).status, JSON.stringify(bad)).toBe(422);
    expect((await put({}, uuidv7())).status).toBe(404);
  });

  it('keeps Temperature and Tint only with a custom white balance, and curves that change something', async () => {
    const curve = [
      [0, 0],
      [64, 80],
      [255, 255],
    ];
    const r = await put({
      WhiteBalance: 'Custom',
      Temperature: 5200,
      Tint: 8,
      ToneCurvePV2012: curve,
      ToneCurvePV2012Red: [
        [0, 0],
        [255, 255],
      ],
      ConvertToGrayscale: true,
    });
    expect(r.body.recipe).toEqual({
      ConvertToGrayscale: true,
      Temperature: 5200,
      Tint: 8,
      ToneCurvePV2012: curve,
      WhiteBalance: 'Custom',
    });
  });

  it('undo puts the recipe before back; an older row is refused once a newer edit came after', async () => {
    await put({ Exposure2012: 1 });
    const rows = await ledger();
    const last = rows.at(-1);
    const older = rows.at(-2);
    expect(JSON.parse(last?.undo_json ?? '{}').op).toBe('photo.recipe');
    expect((await api('POST', `/v1/ledger/${older?.id}/undo`, { token: D })).status).toBe(409);
    expect((await api('POST', `/v1/ledger/${last?.id}/undo`, { token: D })).status).toBe(200);
    const g = await apiJson<{ recipe: PhotoRecipe }>('GET', `/v1/photos/${id}`, { token: D });
    expect(g.body.recipe).toEqual({
      ConvertToGrayscale: true,
      Temperature: 5200,
      Tint: 8,
      ToneCurvePV2012: [
        [0, 0],
        [64, 80],
        [255, 255],
      ],
      WhiteBalance: 'Custom',
    });
  });

  it('back to as shot is `{}`: the photo is no longer edited', async () => {
    const r = await put({});
    expect(r.body.changed).toBe(true);
    expect(r.body.photo.edited).toBe(false);
    expect((await ledger()).at(-1)?.what).toBe('set a photo back to as shot');
  });

  it('the photo.edit sense takes the panel, never a value', async () => {
    const sense = (data: object) =>
      apiJson<{ accepted: number; rejected: unknown[] }>('PUT', `/v1/senses/batches/${uuidv7()}`, {
        token: D,
        body: {
          events: [{ id: uuidv7(), at: Date.now(), type: 'photo.edit', ref: `photo:${id}`, data, sensitivity: 0 }],
        },
      });
    expect((await sense({ panel: 'light' })).body.accepted).toBe(1);
    expect((await sense({ panel: 'light', Exposure2012: 1 })).body.accepted).toBe(0);
    expect((await sense({ panel: 'masks' })).body.accepted).toBe(0);
  });
});
