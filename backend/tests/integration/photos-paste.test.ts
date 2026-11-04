// Paste a copied edit onto photos (PHOTOS.md, Copy and paste; API.md §11.26): each photo keeps its
// keys outside the copied panels and takes the copy's inside them; an edit replaced gets an automatic
// version first; one ledger row for the whole paste, whose undo puts every photo back (one edited
// since keeps that edit); the same paste again writes nothing and answers that row; 20 photos at
// most; the `photo.paste` sense with the count and the panels only. Invented photos only.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PANEL_KEYS,
  PASTE_PANELS,
  type PhotoRecipe,
  RECIPE_CURVES,
  RECIPE_FLAGS,
  RECIPE_NUMBERS,
} from '../../../shared/contract/photos.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, setupOwner } from '../helpers';
import { connectDrive, fakeGoogle, photoBody } from '../photos-helpers';

type Out = {
  items: { id: string; changed: boolean; recipe: PhotoRecipe; before: PhotoRecipe }[];
  ledger_id: string | null;
};
let D = '';
const ids: string[] = [];
const paste = (body: unknown) => apiJson<Out>('POST', '/v1/photos/paste', { token: D, body });
const recipeOf = async (id: string) =>
  (await apiJson<{ recipe: PhotoRecipe }>('GET', `/v1/photos/${id}`, { token: D })).body.recipe;
const put = (id: string, recipe: PhotoRecipe) => api('PUT', `/v1/photos/${id}/recipe`, { token: D, body: { recipe } });
const pasteRows = () =>
  coreSql<{ id: string; what: string; undo_json: string; status: string }>(
    "SELECT id, what, undo_json, status FROM ledger WHERE what LIKE 'pasted a look%' ORDER BY seq",
  );
const autos = (id: string) =>
  coreSql<{ recipe_json: string }>(
    "SELECT recipe_json FROM photo_versions WHERE photo_id = ? AND kind = 'auto' ORDER BY created_at, id",
    id,
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  fakeGoogle();
  await connectDrive(D);
  for (let i = 0; i < 21; i++) {
    const id = uuidv7();
    expect((await api('PUT', `/v1/photos/${id}`, { token: D, body: photoBody() })).status).toBe(201);
    ids.push(id);
  }
});

describe('POST /v1/photos/paste', () => {
  it('the panels own every recipe key, once', () => {
    const all = PASTE_PANELS.flatMap((p) => [...PANEL_KEYS[p]]);
    expect(new Set(all).size).toBe(all.length);
    const keys = [
      ...Object.keys(RECIPE_NUMBERS),
      ...RECIPE_CURVES,
      ...RECIPE_FLAGS,
      'WhiteBalance',
      'Temperature',
      'Tint',
    ];
    expect([...all].sort()).toEqual([...keys].sort());
  });

  it('merges the copied panels into each photo and records one ledger row; an edit replaced is kept as a version', async () => {
    const [a, b] = ids;
    expect((await put(a, { Exposure2012: 1, Texture: 20, CropAngle: 3 })).status).toBe(200);
    const copy = { Exposure2012: -0.5, Contrast2012: 15, Vibrance: 10 };
    const r = await paste({ ids: [a, b], panels: ['light', 'color'], recipe: copy });
    expect(r.status).toBe(200);
    expect(r.body.items.every((i) => i.changed)).toBe(true);
    // Light and Color replaced; Effects and Crop kept.
    expect(await recipeOf(a)).toEqual({
      Contrast2012: 15,
      CropAngle: 3,
      Exposure2012: -0.5,
      Texture: 20,
      Vibrance: 10,
    });
    expect(await recipeOf(b)).toEqual({ Contrast2012: 15, Exposure2012: -0.5, Vibrance: 10 });
    const rows = await pasteRows();
    expect(rows.map((x) => x.what)).toEqual(['pasted a look to 2 photos']);
    expect(r.body.ledger_id).toBe(rows[0]?.id);
    // a had an edit: kept as an automatic version; b was as shot: nothing to keep.
    expect((await autos(a)).map((v) => JSON.parse(v.recipe_json))).toEqual([
      { CropAngle: 3, Exposure2012: 1, Texture: 20 },
    ]);
    expect(await autos(b)).toEqual([]);
  });

  it('a key the copy leaves out is its panel’s default on the photo it lands on', async () => {
    const c = ids[2];
    await put(c, { Exposure2012: 2, Shadows2012: 40, Clarity2012: 10 });
    const r = await paste({ ids: [c], panels: ['light'], recipe: { Contrast2012: 5 } });
    expect(r.body.items[0]?.recipe).toEqual({ Clarity2012: 10, Contrast2012: 5 });
    expect((await pasteRows()).at(-1)?.what).toBe('pasted a look to a photo');
  });

  it('is idempotent by hash: the same paste again (any order) writes nothing and answers that row', async () => {
    const [a, b] = ids;
    const before = await pasteRows();
    const r = await paste({
      ids: [b, a, b],
      panels: ['color', 'light'],
      recipe: { Vibrance: 10, Contrast2012: 15, Exposure2012: -0.5 },
    });
    expect(r.status).toBe(200);
    expect(r.body.items.some((i) => i.changed)).toBe(false);
    expect(r.body.ledger_id).toBe(before.find((x) => x.what === 'pasted a look to 2 photos')?.id);
    expect(await pasteRows()).toEqual(before);
  });

  it('undo puts every photo back; one edited since keeps that edit', async () => {
    const [d, e, f] = ids.slice(3, 6);
    await put(d, { Shadows2012: 30 });
    await put(e, { Exposure2012: 0.7 });
    const r = await paste({ ids: [d, e, f], panels: ['light'], recipe: { Exposure2012: 1.5 } });
    const row = (await pasteRows()).at(-1);
    expect(row?.what).toBe('pasted a look to 3 photos');
    expect(JSON.parse(row?.undo_json ?? '{}').op).toBe('photo.paste');
    expect((await api('POST', `/v1/ledger/${r.body.ledger_id}/undo`, { token: D })).status).toBe(200);
    expect(await recipeOf(d)).toEqual({ Shadows2012: 30 });
    expect(await recipeOf(e)).toEqual({ Exposure2012: 0.7 });
    expect(await recipeOf(f)).toEqual({});
    expect((await pasteRows()).at(-1)?.status).toBe('undone');
    // Pasted again, then f edited by hand: the undo leaves f's edit and restores the others.
    const again = await paste({ ids: [d, e, f], panels: ['light'], recipe: { Exposure2012: 1.5 } });
    expect(again.body.ledger_id).not.toBe(r.body.ledger_id);
    await put(f, { Exposure2012: 1.5, Dehaze: 12 });
    expect((await api('POST', `/v1/ledger/${again.body.ledger_id}/undo`, { token: D })).status).toBe(200);
    expect(await recipeOf(d)).toEqual({ Shadows2012: 30 });
    expect(await recipeOf(f)).toEqual({ Dehaze: 12, Exposure2012: 1.5 });
  });

  it('takes at most 20 photos, real ones, and keys only of the panels copied', async () => {
    expect((await paste({ ids, panels: ['light'], recipe: { Exposure2012: 1 } })).status).toBe(422);
    expect((await paste({ ids: ids.slice(0, 20), panels: ['light'], recipe: { Exposure2012: 1 } })).status).toBe(200);
    expect((await paste({ ids: [ids[0]], panels: ['light'], recipe: { Vibrance: 5 } })).status).toBe(422);
    expect((await paste({ ids: [ids[0]], panels: ['masks'], recipe: {} })).status).toBe(422);
    expect((await paste({ ids: [ids[0]], panels: ['light'], recipe: { Exposure2012: 9 } })).status).toBe(422);
    expect((await paste({ ids: [], panels: ['light'], recipe: {} })).status).toBe(422);
    expect((await paste({ ids: [uuidv7()], panels: ['light'], recipe: { Exposure2012: 1 } })).status).toBe(404);
    expect((await api('DELETE', `/v1/photos/${ids[20]}`, { token: D })).status).toBe(200);
    expect((await paste({ ids: [ids[0], ids[20]], panels: ['light'], recipe: { Exposure2012: 2 } })).status).toBe(404);
    expect(await recipeOf(ids[0])).not.toHaveProperty('Exposure2012', 2);
  });

  it('the photo.paste sense takes the count and the panels, never a value or an id', async () => {
    const sense = (data: object, ref: string | null = null) =>
      apiJson<{ accepted: number }>('PUT', `/v1/senses/batches/${uuidv7()}`, {
        token: D,
        body: { events: [{ id: uuidv7(), at: Date.now(), type: 'photo.paste', ref, data, sensitivity: 0 }] },
      });
    expect((await sense({ count: 12, light: true, color: true, crop: false })).body.accepted).toBe(1);
    expect((await sense({ count: 2, Exposure2012: 1 })).body.accepted).toBe(0);
    expect((await sense({ count: 2, light: 'yes' })).body.accepted).toBe(0);
    expect((await sense({ count: 2 }, `photo:${ids[0]}`)).body.accepted).toBe(0);
  });
});
