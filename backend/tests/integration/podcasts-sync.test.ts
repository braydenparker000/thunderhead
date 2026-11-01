// NEXT-BATCH.md part 7: Podcasts' positions and follows on the Worker (Core step 25). The newer
// `updated_at` wins item by item (equal keeps what is there); a page is what the Worker took since,
// oldest first, with a cursor while there is more; the daily prune keeps the newest 1,000 positions
// and an unfollow 30 days; the night reads the follows and records its check without the phones
// being sent the rows again (its reads and their taint: podcasts-night.test.ts). Who may call each
// route is the route-scope and role-matrix tests' (and a few refusals here). Synthetic shows only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { episodeID } from '../../../frontend/th/podcasts/feed.js';
import type {
  PodcastFollow,
  PodcastFollowRow,
  PodcastPage,
  PodcastProgress,
  PodcastSyncResponse,
} from '../../../shared/contract/podcasts.ts';
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
/** The night's claimed session: a mind reads these routes only from one (and is marked tainted). */
const NIGHT_SESSION = 'cse_podcasts_night';
const sessionOf = (token: string): Record<string, string> => (token === N ? { 'TH-Session': NIGHT_SESSION } : {});
const progress = (q = 'since=0', token = D) =>
  apiJson<PodcastPage<PodcastProgress>>('GET', `/v1/podcasts/progress?${q}`, { token, headers: sessionOf(token) });
const follows = (q = 'since=0', token = D) =>
  apiJson<PodcastPage<PodcastFollowRow>>('GET', `/v1/podcasts/follows?${q}`, { token, headers: sessionOf(token) });
const tick = (now = Date.now()) =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(now));

beforeAll(async () => {
  D = (await setupOwner()).token;
  N = await makeAgent(D, 'mind:night');
  C = await makeAgent(D, 'mind:chat');
  const claim = await apiJson('POST', '/v1/mind/brief', {
    token: N,
    headers: { 'TH-Session': NIGHT_SESSION },
    body: {
      claim: true,
      session_id: NIGHT_SESSION,
      role: 'night',
      constitution_sha256: 'a'.repeat(64),
      th_version: '0.1.0',
    },
  });
  expect(claim.status).toBe(200);
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

  it('an item it cannot keep is refused by its place, and the rest of the batch is kept', async () => {
    const r = await put('progress', [
      { ...pos('cccc000000000001', 1, T0), key: 'not a key' },
      pos('cccc000000000002', 2, T0),
      { ...pos('cccc000000000003', 1, T0), key: 'ftp://example.org/x#abc' },
      { ...pos('cccc000000000004', 1, T0), key: `${FEED}#has space` },
      pos('cccc000000000005', -1, T0),
      pos('cccc000000000006', 1, Date.now() + 2 * 3_600_000),
      { ...pos('cccc000000000007', 1, T0), title: 'no' },
      'not an item',
      pos('cccc000000000009', 9, T0),
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ applied: 2, stale: 0 });
    expect(r.body.refused.map((x) => x.index)).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(r.body.refused.map((x) => x.issue.split(':')[0])).toEqual([
      'key',
      'key',
      'key',
      'position_s',
      'updated_at',
      'item',
      'item',
    ]);
    const kept = (await progress()).body.items.map((p) => p.key);
    expect(kept.filter((k) => k.includes('#cccc')).sort()).toEqual([
      `${FEED}#cccc000000000002`,
      `${FEED}#cccc000000000009`,
    ]);
    // Only the batch's own shape refuses it whole.
    const whole = async (body: unknown) => (await apiJson('PUT', '/v1/podcasts/progress', { token: D, body })).status;
    expect(await whole({ items: [] })).toBe(422);
    expect(await whole({ items: 'x' })).toBe(422);
    expect(await whole({ items: Array.from({ length: 101 }, (_, i) => pos(`d${i}`, 1, T0)) })).toBe(422);
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
    expect(rows[0]).toMatchObject({ title: 'Show -a', checked_at: null, latest_at: null, new_n: 0, fails: 0 });
    const bad = await put('follows', [{ ...follow(FEED, true, T0 + 2), artwork: 'javascript:alert(1)' }]);
    expect(bad.body).toMatchObject({ applied: 0, refused: [{ index: 0 }] });
  });

  it('the night records the shows it read by their ids, followed ones only, the numbers clamped, without the phones seeing the rows again', async () => {
    const since = (await follows()).body.next_since;
    const id = (url: string) => episodeID(url);
    const rowOf = async () => (await follows('since=0', N)).body.items.find((f) => f.show_id === id(FEED));
    const r = await apiJson<{ updated: number }>('POST', '/v1/podcasts/follows/checked', {
      token: N,
      body: {
        items: [
          { show_id: id(FEED), latest_at: T0 + 100, new_n: 2 },
          { show_id: id(OTHER), latest_at: T0 + 100, new_n: 1 },
        ],
      },
    });
    expect(r).toMatchObject({ status: 200, body: { updated: 1 } });
    // An earlier newest episode never moves latest_at back; null keeps it.
    const check = (item: object) =>
      apiJson('POST', '/v1/podcasts/follows/checked', { token: N, body: { items: [item] } });
    await check({ show_id: id(FEED), latest_at: T0 + 50, new_n: 0 });
    await check({ show_id: id(FEED), latest_at: null, new_n: 0 });
    expect(await rowOf()).toMatchObject({ latest_at: T0 + 100, new_n: 0, checked_at: expect.any(Number) });
    expect((await follows(`since=${since}`)).body.items).toEqual([]);
    // A feed that failed: one more failure in a row, nothing new, latest_at kept; a good check resets it.
    await check({ show_id: id(FEED), latest_at: null, new_n: 3, failed: true });
    await check({ show_id: id(FEED), latest_at: null, new_n: 0, failed: true });
    expect(await rowOf()).toMatchObject({ fails: 2, new_n: 0, latest_at: T0 + 100 });
    // Odd numbers from a feed are clamped, never refused: a time at 1970 or far ahead is no time
    // (latest_at kept), a re-dated back catalogue counts at most 200.
    expect((await check({ show_id: id(FEED), latest_at: 0, new_n: 300 })).status).toBe(200);
    expect(await rowOf()).toMatchObject({ fails: 0, new_n: 200, latest_at: T0 + 100 });
    expect((await check({ show_id: id(FEED), latest_at: Date.now() + 30 * 86_400_000, new_n: -4 })).status).toBe(200);
    expect(await rowOf()).toMatchObject({ new_n: 0, latest_at: T0 + 100 });
    // Only by a show's id, and only the night.
    expect((await check({ feed_url: FEED, latest_at: null, new_n: 0 })).status).toBe(422);
    expect(
      (
        await apiJson('POST', '/v1/podcasts/follows/checked', {
          token: D,
          body: { items: [{ show_id: id(FEED), latest_at: null, new_n: 0 }] },
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
