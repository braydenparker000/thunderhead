// NEXT-BATCH.md part 7: Podcasts' positions and follows on the Worker (Core step 25). The newer
// `updated_at` wins item by item (equal keeps what is there); a page is what the Worker took since,
// oldest first, with a cursor while there is more; the daily prune keeps the newest 1,000 positions
// and an unfollow 30 days; the night reads the follows and records its check without the phones
// being sent the rows again, and reads at most 40 feeds a UTC day. Who may call each route is the
// route-scope and role-matrix tests' (and a few refusals here). Synthetic shows and episodes only.
import { createExecutionContext, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  PodcastFollow,
  PodcastFollowRow,
  PodcastPage,
  PodcastProgress,
  PodcastSyncResponse,
} from '../../../shared/contract/podcasts.ts';
import { app } from '../../src/app';
import { useFetch } from '../../src/areas/podcasts/upstream';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';

const FEED = 'https://feeds.example.org/show-a.xml';
const OTHER = 'https://feeds.example.org/show-b.xml';
const T0 = Date.now() - 3_600_000;
let D = '';
let N = '';
let C = '';

const pos = (id: string, position_s: number, updated_at: number, extra: Partial<PodcastProgress> = {}) => ({
  key: `${FEED}#${id}`,
  position_s,
  duration_s: 1800,
  played: false,
  updated_at,
  ...extra,
});
const follow = (feed_url: string, followed: boolean, updated_at: number): PodcastFollow => ({
  feed_url,
  title: `Show ${feed_url.slice(-6, -4)}`,
  author: 'A host',
  artwork: '',
  followed,
  updated_at,
});
const put = (path: string, items: unknown[], token = D) =>
  apiJson<PodcastSyncResponse>('PUT', `/v1/podcasts/${path}`, { token, body: { items } });
const progress = (q = 'since=0', token = D) =>
  apiJson<PodcastPage<PodcastProgress>>('GET', `/v1/podcasts/progress?${q}`, { token });
const follows = (q = 'since=0', token = D) =>
  apiJson<PodcastPage<PodcastFollowRow>>('GET', `/v1/podcasts/follows?${q}`, { token });
const tick = (now = Date.now()) =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(now));

beforeAll(async () => {
  D = (await setupOwner()).token;
  N = await makeAgent(D, 'mind:night');
  C = await makeAgent(D, 'mind:chat');
});

describe('positions', () => {
  it('a batch is kept, and read back as it was sent', async () => {
    const r = await put('progress', [
      pos('aaaa000000000001', 61.5, T0),
      pos('aaaa000000000002', 0, T0, { played: true }),
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ applied: 2, stale: 0 });
    const g = await progress();
    expect(g.status).toBe(200);
    expect(g.body.items).toEqual([pos('aaaa000000000001', 61.5, T0), pos('aaaa000000000002', 0, T0, { played: true })]);
    expect(g.body.next).toBeNull();
    expect(g.body.next_since).toBeGreaterThanOrEqual(r.body.at);
  });

  it('the newer updated_at wins; an older or equal one changes nothing', async () => {
    const r = await put('progress', [
      pos('aaaa000000000001', 10, T0 - 1), // older
      pos('aaaa000000000002', 99, T0), // equal
      pos('aaaa000000000001', 120, T0 + 5), // newer, in the same batch as an older one
    ]);
    expect(r.body).toMatchObject({ applied: 1, stale: 2 });
    const items = (await progress()).body.items;
    expect(items.find((p) => p.key.endsWith('01'))).toEqual(pos('aaaa000000000001', 120, T0 + 5));
    expect(items.find((p) => p.key.endsWith('02'))).toEqual(pos('aaaa000000000002', 0, T0, { played: true }));
    // The same batch again: nothing new.
    expect((await put('progress', [pos('aaaa000000000001', 120, T0 + 5)])).body).toMatchObject({ applied: 0 });
  });

  it('what changed since: only rows taken at or after it, oldest first, page by page', async () => {
    const since = (await progress()).body.next_since;
    expect((await progress(`since=${since}`)).body.items).toEqual([]);
    await put('progress', [pos('bbbb000000000001', 5, T0 + 10), pos('bbbb000000000002', 6, T0 + 11)]);
    await put('progress', [pos('bbbb000000000003', 7, T0 + 12)]);
    const first = await progress(`since=${since}&limit=2`);
    expect(first.body.items.map((p) => p.key.slice(-2))).toEqual(['01', '02']);
    expect(first.body.next).toEqual(expect.any(String));
    const second = await progress(`cursor=${first.body.next}&limit=2`);
    expect(second.body.items.map((p) => p.key.slice(-2))).toEqual(['03']);
    expect(second.body.next).toBeNull();
    // Another route's cursor is refused.
    expect((await follows(`cursor=${first.body.next}`)).status).toBe(400);
  });

  it('refuses what it cannot keep, naming the field', async () => {
    const bad = async (items: unknown[]) => {
      const r = await apiJson<{ error: { code: string; details: { path: string }[] } }>(
        'PUT',
        '/v1/podcasts/progress',
        {
          token: D,
          body: { items },
        },
      );
      return [r.status, r.body.error.details?.[0]?.path];
    };
    expect(await bad([{ ...pos('cccc000000000001', 1, T0), key: 'not a key' }])).toEqual([422, 'items.0.key']);
    expect(await bad([{ ...pos('cccc000000000001', 1, T0), key: `ftp://example.org/x#abc` }])).toEqual([
      422,
      'items.0.key',
    ]);
    expect(await bad([{ ...pos('cccc000000000001', 1, T0), key: `${FEED}#has space` }])).toEqual([422, 'items.0.key']);
    expect(await bad([pos('cccc000000000001', -1, T0)])).toEqual([422, 'items.0.position_s']);
    expect(await bad([pos('cccc000000000001', 1, Date.now() + 2 * 3_600_000)])).toEqual([422, 'items.0.updated_at']);
    expect(await bad([{ ...pos('cccc000000000001', 1, T0), title: 'no' }])).toEqual([422, 'items.0']);
    expect(await bad([])).toEqual([422, 'items']);
    expect(await bad(Array.from({ length: 101 }, (_, i) => pos(`d${String(i).padStart(15, '0')}`, 1, T0)))).toEqual([
      422,
      'items',
    ]);
    expect((await progress('since=-1')).status).toBe(422);
  });

  it('only the owner’s device writes them; the night reads them; chat neither', async () => {
    expect((await put('progress', [pos('eeee000000000001', 1, T0)], N)).status).toBe(403);
    expect((await put('progress', [pos('eeee000000000001', 1, T0)], '')).status).toBe(401);
    expect((await progress('since=0', N)).status).toBe(200);
    expect((await progress('since=0', C)).status).toBe(403);
  });

  it('the daily prune keeps the newest 1,000 by updated_at', async () => {
    await coreSql('DELETE FROM podcast_progress');
    await coreSql(
      `INSERT INTO podcast_progress (key, position_s, duration_s, played, updated_at, synced_at)
       SELECT ? || '#p' || printf('%04d', value), 1, 2, 0, ? + value, ? FROM json_each(?)`,
      FEED,
      T0,
      Date.now(),
      JSON.stringify([...Array(1005).keys()]),
    );
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    await tick();
    const left = await coreSql<{ n: number; oldest: number }>(
      'SELECT count(*) AS n, min(updated_at) AS oldest FROM podcast_progress',
    );
    expect(left).toEqual([{ n: 1000, oldest: T0 + 5 }]);
  });
});

describe('follows and the night’s check', () => {
  it('a follow and an unfollow, the newer winning', async () => {
    expect((await put('follows', [follow(FEED, true, T0), follow(OTHER, true, T0)])).body).toMatchObject({
      applied: 2,
    });
    expect((await put('follows', [follow(OTHER, false, T0 + 1), follow(FEED, false, T0 - 1)])).body).toMatchObject({
      applied: 1,
      stale: 1,
    });
    const rows = (await follows()).body.items;
    expect(rows.map((f) => [f.feed_url, f.followed])).toEqual([
      [FEED, true],
      [OTHER, false],
    ]);
    expect(rows[0]).toMatchObject({ title: 'Show -a', checked_at: null, latest_at: null, new_n: 0 });
    const bad = await apiJson('PUT', '/v1/podcasts/follows', {
      token: D,
      body: { items: [{ ...follow(FEED, true, T0 + 2), artwork: 'javascript:alert(1)' }] },
    });
    expect(bad.status).toBe(422);
  });

  it('the night records the shows it read, followed ones only, without the phones seeing the rows again', async () => {
    const since = (await follows()).body.next_since;
    const r = await apiJson<{ updated: number }>('POST', '/v1/podcasts/follows/checked', {
      token: N,
      body: {
        items: [
          { feed_url: FEED, latest_at: T0 + 100, new_n: 2 },
          { feed_url: OTHER, latest_at: T0 + 100, new_n: 1 },
        ],
      },
    });
    expect(r).toMatchObject({ status: 200, body: { updated: 1 } });
    // An earlier newest episode never moves latest_at back; null keeps it.
    await apiJson('POST', '/v1/podcasts/follows/checked', {
      token: N,
      body: { items: [{ feed_url: FEED, latest_at: T0 + 50, new_n: 0 }] },
    });
    await apiJson('POST', '/v1/podcasts/follows/checked', {
      token: N,
      body: { items: [{ feed_url: FEED, latest_at: null, new_n: 0 }] },
    });
    const row = (await follows('since=0', N)).body.items.find((f) => f.feed_url === FEED);
    expect(row).toMatchObject({ latest_at: T0 + 100, new_n: 0, checked_at: expect.any(Number) });
    expect((await follows(`since=${since}`)).body.items).toEqual([]);
    expect(
      (
        await apiJson('POST', '/v1/podcasts/follows/checked', {
          token: D,
          body: { items: [{ feed_url: FEED, latest_at: null, new_n: 0 }] },
        })
      ).status,
    ).toBe(403);
  });

  it('an unfollow goes after 30 days; a follow stays', async () => {
    const old = Date.now() - 31 * 86_400_000;
    await coreSql('UPDATE podcast_follows SET updated_at = ?', old);
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    await tick();
    expect(
      (await coreSql<{ feed_url: string }>('SELECT feed_url FROM podcast_follows')).map((r) => r.feed_url),
    ).toEqual([FEED]);
  });
});

describe('the night’s feed reads', () => {
  const RSS = '<?xml version="1.0"?><rss><channel><title>Show</title></channel></rss>';
  beforeAll(() => useFetch(async () => new Response(RSS, { headers: { 'Content-Type': 'application/rss+xml' } })));
  afterAll(() => useFetch((...a) => fetch(...a)));
  const feed = (token: string) =>
    app.fetch(
      new Request(`https://api.example.test/v1/podcasts/feed?url=${encodeURIComponent(FEED)}`, {
        headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.10' },
      }),
      env,
      createExecutionContext(),
    );

  it('at most 40 a UTC day for mind:night; the owner’s device is never counted', async () => {
    for (let i = 0; i < 40; i++) expect((await feed(N)).status).toBe(200);
    const r = await feed(N);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await feed(D)).status).toBe(200);
    expect((await feed(C)).status).toBe(403);
  });
});
