// GUITAR.md §1.1: Guitar's progress on the Worker (Core step 47), one record per song. The newer
// `updated_at` wins record by record (equal keeps what is there); a page is what the Worker took
// since, oldest first, with a cursor while there is more; one bad item is refused by its place and
// the rest are kept; the owner's device only; the daily prune keeps the newest 1,000. Invented songs.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GuitarPage, GuitarProgress, GuitarSyncResponse } from '../../../shared/contract/guitar.ts';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';

const T0 = Date.now() - 3_600_000;
let D = '';
let C = '';

const rec = (key: string, updated_at: number, extra: Partial<GuitarProgress> = {}): GuitarProgress => ({
  key,
  song: { key, source: 'songsterr', id: Number(key.slice(1)), title: 'An invented song', artist: 'A band', best: 80 },
  ladder: { '3-6': { day: '2026-11-20', passes: 4, clean: 3, ceiling: 82, best: 82, last: null } },
  days: { '2026-11-20': 300 },
  phone_at: updated_at - 5,
  updated_at,
  ...extra,
});
const put = (items: unknown[], token = D) =>
  apiJson<GuitarSyncResponse>('PUT', '/v1/guitar/progress', { token, body: { items } });
const page = (q = 'since=0', token = D) => apiJson<GuitarPage>('GET', `/v1/guitar/progress?${q}`, { token });

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('guitar progress', () => {
  it('a batch is kept, and read back as it was sent', async () => {
    const r = await put([rec('s101', T0), rec('g:a-band/a-song', T0)]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ applied: 2, stale: 0, refused: [] });
    const p = await page();
    expect(p.status).toBe(200);
    expect(p.body.items.map((i) => i.key).sort()).toEqual(['g:a-band/a-song', 's101']);
    expect(p.body.items.find((i) => i.key === 's101')).toEqual(rec('s101', T0));
    expect(p.body.next).toBeNull();
  });

  it('the newer record wins; an older or equal one changes nothing', async () => {
    const newer = rec('s101', T0 + 10, { days: { '2026-11-20': 300, '2026-11-21': 60 } });
    expect((await put([newer])).body).toMatchObject({ applied: 1, stale: 0 });
    const older = rec('s101', T0 + 5, { days: {} });
    expect((await put([older, newer])).body).toMatchObject({ applied: 0, stale: 2 });
    const p = await page();
    expect(p.body.items.find((i) => i.key === 's101')?.days).toEqual(newer.days);
  });

  it('asks only for what changed since, page by page', async () => {
    const since = (await page()).body.next_since;
    await new Promise((r) => setTimeout(r, 5));
    expect((await page(`since=${since}`)).body.items).toEqual([]);
    await put([rec('s201', T0), rec('s202', T0), rec('s203', T0)]);
    const first = await page(`since=${since}&limit=2`);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.next).toEqual(expect.any(String));
    const second = await page(`cursor=${encodeURIComponent(first.body.next as string)}&limit=2`);
    expect(second.body.items.map((i) => i.key)).toEqual(['s203']);
    expect(second.body.next).toBeNull();
  });

  it('refuses a bad item by its place and keeps the rest', async () => {
    const r = await put([
      rec('s301', T0),
      { ...rec('s302', T0), key: 'not a key' },
      rec('s303', Date.now() + 2 * 3_600_000),
      rec('s304', T0, { days: Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`${2000 + i}-01-01`, 1])) }),
      { ...rec('s305', T0), extra: 1 },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(1);
    expect(r.body.refused.map((x) => x.index)).toEqual([1, 2, 3, 4]);
  });

  it('refuses a body of more than 50 items, and a mind', async () => {
    expect((await put(Array.from({ length: 51 }, (_, i) => rec(`s${400 + i}`, T0)))).status).toBe(422);
    expect((await put([rec('s500', T0)], C)).status).toBe(403);
    expect((await page('since=0', C)).status).toBe(403);
  });

  it('the daily prune keeps the newest 1,000', async () => {
    await coreSql(
      `INSERT INTO guitar_progress (key, body, updated_at, synced_at)
       SELECT 's9' || printf('%05d', value), '{"song":null,"ladder":{},"days":{},"phone_at":1}', ? + value, ? FROM json_each(?)`,
      T0,
      T0,
      JSON.stringify([...Array(1000).keys()]),
    );
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
    const [{ n }] = await coreSql<{ n: number }>('SELECT count(*) AS n FROM guitar_progress');
    expect(n).toBe(1000);
    expect(await coreSql("SELECT key FROM guitar_progress WHERE key = 's900999'")).toHaveLength(1);
  });
});
