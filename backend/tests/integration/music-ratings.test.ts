// The phone's ratings kept in Music (MUSIC.md §10.5, API.md §11.14): a `music.rate` sense the Senses
// object refuses (a time out of its window) is refused again when the same batch is sent again (the
// replay is answered from its record, without its rejections); a null event in a batch is refused,
// never a 500 on every retry; and a rating timed ahead of the Worker's clock is kept as of now, so
// it can't outlast the owner's next rating. Synthetic songs only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/lib/ids';
import type { Music } from '../../src/objects/music';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';
import { music, seedCatalog } from '../music-helpers';

let P = {} as Principals;
let ids: string[] = [];
const ratings = () =>
  runInDurableObject(music(), (_o: Music, st) =>
    st.storage.sql.exec('SELECT track_id, rating, at FROM track_ratings ORDER BY track_id').toArray(),
  ) as Promise<{ track_id: string; rating: number; at: number }[]>;
const rate = (id: string, rating: number, at: number) => ({
  id: uuidv7(),
  at,
  type: 'music.rate',
  ref: `music:${id}`,
  data: { rating, from: 0 },
});
const put = (batch: string, events: unknown[]) =>
  apiJson<{ accepted: number; rejected: { i: number; reason: string }[] }>('PUT', `/v1/senses/batches/${batch}`, {
    token: P.D,
    body: { events },
  });

beforeAll(async () => {
  P = await principals();
  ids = await seedCatalog([{ title: 'Rated A' }, { title: 'Rated B' }, { title: 'Rated C' }]);
});

describe('ratings from the senses, checked every time', () => {
  it('a rating out of the time window is refused, and refused again on a retry of the batch', async () => {
    const batch = uuidv7();
    const events = [rate(ids[0], 1, Date.now() + 86_400_000), rate(ids[1], 4, Date.now() - 60_000)];
    const first = await put(batch, events);
    expect([first.status, first.body.rejected]).toEqual([200, [{ i: 0, reason: 'bad_time' }]]);
    const again = await put(batch, events);
    expect([again.status, again.body.rejected]).toEqual([200, []]);
    expect((await ratings()).map((r) => [r.track_id, r.rating])).toEqual([[ids[1], 4]]);
  });

  it('a null event is refused with the batch taken; its retry answers the same', async () => {
    const batch = uuidv7();
    const events = [null, rate(ids[2], 1, Date.now() - 30_000)];
    const first = await put(batch, events);
    expect([first.status, first.body.rejected]).toEqual([200, [{ i: 0, reason: 'bad_id' }]]);
    expect((await put(batch, events)).status).toBe(200);
    expect((await ratings()).find((r) => r.track_id === ids[2])?.rating).toBe(1);
  });

  it('a rating timed ahead of the clock is kept as of now, so the next one still wins', async () => {
    const ahead = Date.now() + 4 * 60_000;
    await put(uuidv7(), [rate(ids[2], 5, ahead)]);
    const kept = (await ratings()).find((r) => r.track_id === ids[2]);
    expect(kept?.rating).toBe(5);
    expect(kept?.at).toBeLessThanOrEqual(Date.now());
    await put(uuidv7(), [rate(ids[2], 2, Date.now())]);
    expect((await ratings()).find((r) => r.track_id === ids[2])?.rating).toBe(2);
  });
});
