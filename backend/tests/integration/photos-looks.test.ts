// Looks (PHOTOS.md, Looks; API.md §11.26): added or replaced by id in batches of up to 50, canonical
// and only in their panels, renamed or updated from an edit, deleted; 500 at most; the recipe schema
// and its 4 KB; the `photo.look` sense with the source and the panel count only. Invented looks only.
import { beforeAll, describe, expect, it } from 'vitest';
import { type PhotoLook, RECIPE_NUMBERS } from '../../../shared/contract/photos.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, coreSql, setupOwner } from '../helpers';

let D = '';
type Put = { items: PhotoLook[]; created: number };
const put = (items: Record<string, unknown>[]) =>
  apiJson<Put>('PUT', '/v1/photos/looks', { token: D, body: { items } });
const list = async () => (await apiJson<{ items: PhotoLook[] }>('GET', '/v1/photos/looks', { token: D })).body.items;
const look = (o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  name: 'Soft evening',
  source: 'mine',
  panels: ['light', 'color'],
  recipe: { Exposure2012: 0.3, Vibrance: 12 },
  ...o,
});

beforeAll(async () => {
  D = (await setupOwner()).token;
});

describe('/v1/photos/looks', () => {
  it('adds looks canonical, lists them newest first, and the same id again replaces', async () => {
    const a = look({ recipe: { Exposure2012: 0.3, Contrast2012: 0, Vibrance: 12 } });
    const b = look({
      name: 'Faded film',
      source: 'xmp',
      tag: 'Invented pack',
      panels: ['effects'],
      recipe: { GrainAmount: 30 },
    });
    const r = await put([a, b]);
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(2);
    expect(r.body.items[0]).toMatchObject({
      id: a.id,
      recipe: { Exposure2012: 0.3, Vibrance: 12 },
      panels: ['color', 'light'],
      tag: null,
    });
    expect(r.body.items[1]).toMatchObject({ source: 'xmp', tag: 'Invented pack', film: null, credit: null });
    const again = await put([{ ...a, name: 'Soft evening, warmer' }]);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(0);
    const all = await list();
    expect(all.map((l) => l.name).sort()).toEqual(['Faded film', 'Soft evening, warmer']);
    expect(all.find((l) => l.id === a.id)?.created_at).toBe(r.body.items[0]?.created_at);
  });

  it('keeps a recipe look with its film simulation and credit', async () => {
    const r = await put([
      look({
        source: 'recipe',
        name: 'Example chrome',
        film: 'Classic Chrome',
        credit: 'An invented page title',
        panels: ['light', 'color', 'effects', 'detail'],
        recipe: { Highlights2012: -15, Saturation: 20, GrainAmount: 25 },
      }),
    ]);
    expect(r.body.items[0]).toMatchObject({ film: 'Classic Chrome', credit: 'An invented page title' });
  });

  it('renames, updates from an edit, and deletes', async () => {
    const a = look();
    await put([a]);
    const named = await apiJson<{ look: PhotoLook }>('PATCH', `/v1/photos/looks/${a.id}`, {
      token: D,
      body: { name: 'Renamed' },
    });
    expect(named.body.look).toMatchObject({ name: 'Renamed', recipe: a.recipe });
    const upd = await apiJson<{ look: PhotoLook }>('PATCH', `/v1/photos/looks/${a.id}`, {
      token: D,
      body: { recipe: { Shadows2012: 25, Texture: 8 }, panels: ['light', 'effects'] },
    });
    expect(upd.body.look).toMatchObject({
      name: 'Renamed',
      recipe: { Shadows2012: 25, Texture: 8 },
      panels: ['effects', 'light'],
    });
    expect(
      (await api('PATCH', `/v1/photos/looks/${a.id}`, { token: D, body: { recipe: { Vibrance: 3 } } })).status,
    ).toBe(422);
    expect((await api('DELETE', `/v1/photos/looks/${a.id}`, { token: D })).status).toBe(200);
    expect((await api('DELETE', `/v1/photos/looks/${a.id}`, { token: D })).status).toBe(404);
    expect((await api('PATCH', `/v1/photos/looks/${uuidv7()}`, { token: D, body: { name: 'x' } })).status).toBe(404);
  });

  it('refuses keys outside its panels, values outside the schema, a long name, more than 50', async () => {
    expect((await put([look({ panels: ['light'], recipe: { Vibrance: 5 } })])).status).toBe(422);
    expect((await put([look({ recipe: { Exposure2012: 9 } })])).status).toBe(422);
    expect((await put([look({ recipe: { Exposure2012: 1, Author: 'someone' } })])).status).toBe(422);
    expect((await put([look({ panels: ['versions'] })])).status).toBe(422);
    expect((await put([look({ source: 'web' })])).status).toBe(422);
    expect((await put([look({ name: 'n'.repeat(61) })])).status).toBe(422);
    expect((await put([look({ credit: 'c'.repeat(121) })])).status).toBe(422);
    // Every control at a long decimal and four full curves: the largest recipe the schema takes fits 4 KB.
    const curve = Array.from({ length: 16 }, (_, i) => [i * 17, Math.min(255, i * 17 + 3)]);
    const big: Record<string, unknown> = {
      ToneCurvePV2012: curve,
      ToneCurvePV2012Red: curve,
      ToneCurvePV2012Green: curve,
      ToneCurvePV2012Blue: curve,
    };
    for (const [k, [min, max]] of Object.entries(RECIPE_NUMBERS))
      big[k] = min + (max - min) * (k.startsWith('Crop') ? 0.2 : 0.123456789012345);
    big.CropRight = big.CropBottom = 0.9;
    expect(JSON.stringify(big).length).toBeLessThan(4096);
    const all = look({ panels: ['light', 'color', 'effects', 'detail', 'optics', 'crop'], recipe: big });
    expect((await put([all])).status).toBe(201);
    expect((await api('DELETE', `/v1/photos/looks/${all.id}`, { token: D })).status).toBe(200);
    expect((await put(Array.from({ length: 51 }, () => look()))).status).toBe(422);
  });

  it('keeps 500 at most: more refused whole, replacing still allowed', async () => {
    const have = (await list()).length;
    for (let left = 500 - have; left > 0; left -= 50)
      expect((await put(Array.from({ length: Math.min(50, left) }, () => look()))).status).toBe(201);
    expect((await list()).length).toBe(500);
    expect((await put([look(), look()])).status).toBe(409);
    const { created_at: _c, updated_at: _u, ...one } = (await list())[0] as PhotoLook;
    expect((await put([{ ...one, name: 'Still fine' }])).status).toBe(200);
    expect((await coreSql<{ n: number }>('SELECT COUNT(*) AS n FROM photo_looks'))[0]?.n).toBe(500);
  });

  it('the photo.look sense takes the source and the panel count, never a name or an id', async () => {
    const sense = (data: object, ref: string | null = null) =>
      apiJson<{ accepted: number }>('PUT', `/v1/senses/batches/${uuidv7()}`, {
        token: D,
        body: { events: [{ id: uuidv7(), at: Date.now(), type: 'photo.look', ref, data, sensitivity: 0 }] },
      });
    expect((await sense({ source: 'xmp', panels: 3 })).body.accepted).toBe(1);
    expect((await sense({ source: 'xmp', name: 'Soft evening' })).body.accepted).toBe(0);
    expect((await sense({ source: 'website', panels: 1 })).body.accepted).toBe(0);
    expect((await sense({ source: 'mine', panels: 2 }, 'look:abc')).body.accepted).toBe(0);
  });
});
