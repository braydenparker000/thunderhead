// Podcasts' Up Next and playback speed on the Worker (Core step 49, PODCASTS.md §5.4). Each edit of
// Up Next is a version of the whole queue: its members carry its stamp and their place, the episodes
// it took out go as removals; the newer stamp wins row by row (equal keeps what is there), and a
// member the Worker holds as removed after the phone's `base` stays removed. The speed is one row,
// the newer wins. Pages are what the Worker took since, oldest first. Only the device may call
// them; the daily prune keeps the newest version and drops older rows after 30 days.
// Synthetic shows and episodes only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PodcastPage, PodcastPref, PodcastQueueItem, PodcastSyncResponse } from '../../../shared/contract/podcasts.ts';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';

const FEED = 'https://feeds.example.org/queue-show.xml';
const T0 = Date.now() - 3_600_000;
let D = '';
let C = '';

const id = (n: number) => n.toString(16).padStart(16, '0');
const episode = (n: number) => ({
  id: id(n),
  title: `Episode ${n}`,
  audioUrl: `https://media.example.org/${n}.mp3`,
  show: { feedUrl: FEED, title: 'A show' },
});
const member = (n: number, pos: number, updated_at: number, base = 0): PodcastQueueItem => ({
  key: `${FEED}#${id(n)}`,
  pos,
  queued: true,
  episode: episode(n),
  base,
  updated_at,
});
const removal = (n: number, updated_at: number, base = 0): PodcastQueueItem => ({
  key: `${FEED}#${id(n)}`,
  pos: 0,
  queued: false,
  episode: null,
  base,
  updated_at,
});
const put = (path: string, items: unknown[], token = D) =>
  apiJson<PodcastSyncResponse>('PUT', `/v1/podcasts/${path}`, { token, body: { items } });
const queue = (q = 'since=0', token = D) =>
  apiJson<PodcastPage<Omit<PodcastQueueItem, 'base'>>>('GET', `/v1/podcasts/queue?${q}`, { token });
const prefs = (q = 'since=0', token = D) => apiJson<PodcastPage<PodcastPref>>('GET', `/v1/podcasts/prefs?${q}`, { token });
/** The queue as a phone reads it: the members carrying the newest stamp, by place. */
const members = (items: Omit<PodcastQueueItem, 'base'>[]) => {
  const v = Math.max(...items.map((q) => q.updated_at));
  return items
    .filter((q) => q.queued && q.updated_at === v)
    .sort((a, b) => a.pos - b.pos)
    .map((q) => Number.parseInt(q.key.slice(-16), 16));
};

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('Up Next', () => {
  it('a version is kept and read back with its episodes; the newer whole version wins', async () => {
    const a = await put('queue', [member(1, 0, T0), member(2, 1, T0), member(3, 2, T0)]);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ applied: 3, stale: 0, refused: [] });
    const g = await queue();
    expect(members(g.body.items)).toEqual([1, 2, 3]);
    expect(g.body.items.find((q) => q.key.endsWith(id(2)))?.episode).toEqual(episode(2));
    // Another phone's newer version: 3 first, 1 taken out, 4 added.
    await put('queue', [member(3, 0, T0 + 10, T0), member(2, 1, T0 + 10, T0), member(4, 2, T0 + 10, T0), removal(1, T0 + 10, T0)]);
    expect(members((await queue()).body.items)).toEqual([3, 2, 4]);
    // An older version arriving late changes nothing; the same one again neither.
    expect((await put('queue', [member(1, 0, T0 + 5), member(2, 1, T0 + 5)])).body).toMatchObject({ applied: 0, stale: 2 });
    expect((await put('queue', [member(3, 0, T0 + 10, T0)])).body).toMatchObject({ applied: 0 });
    expect(members((await queue()).body.items)).toEqual([3, 2, 4]);
  });

  it('a removal made on another phone after this phone’s base does not come back', async () => {
    // This phone last had T0 (base) and adds 5 at T0 + 20, still holding 1, removed at T0 + 10.
    const r = await put('queue', [member(1, 0, T0 + 20, T0), member(3, 1, T0 + 20, T0), member(5, 2, T0 + 20, T0)]);
    expect(r.body).toMatchObject({ applied: 2, stale: 1 });
    expect(members((await queue()).body.items)).toEqual([3, 5]);
    // Added again by a phone that has seen the removal: it is back.
    await put('queue', [member(1, 0, T0 + 30, T0 + 20), member(3, 1, T0 + 30, T0 + 20), member(5, 2, T0 + 30, T0 + 20)]);
    expect(members((await queue()).body.items)).toEqual([1, 3, 5]);
  });

  it('an emptied queue is a version of removals; pages carry only what changed since', async () => {
    const since = (await queue()).body.next_since;
    expect((await queue(`since=${since}`)).body.items).toEqual([]);
    await put('queue', [removal(1, T0 + 40, T0 + 30), removal(3, T0 + 40, T0 + 30), removal(5, T0 + 40, T0 + 30)]);
    const g = await queue(`since=${since}`);
    expect(g.body.items.map((q) => [q.queued, q.updated_at])).toEqual([
      [false, T0 + 40],
      [false, T0 + 40],
      [false, T0 + 40],
    ]);
    expect(members((await queue()).body.items)).toEqual([]);
  });

  it('an item it cannot keep is refused by its place; the rest are kept', async () => {
    const r = await put('queue', [
      { ...member(6, 0, T0 + 50), episode: { ...episode(6), id: id(7) } },
      { ...member(6, 0, T0 + 50), episode: null },
      { ...removal(6, T0 + 50), episode: episode(6) },
      { ...member(6, 0, T0 + 50), episode: { ...episode(6), title: 'x'.repeat(8000) } },
      { ...member(6, 100, T0 + 50) },
      member(6, 0, Date.now() + 2 * 3_600_000),
      member(6, 0, T0 + 50),
    ]);
    expect(r.status).toBe(200);
    expect(r.body.refused.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.body).toMatchObject({ applied: 1 });
  });

  it('only the device: a mind is refused', async () => {
    expect((await queue('since=0', C)).status).toBe(403);
    expect((await put('queue', [member(8, 0, T0)], C)).status).toBe(403);
    expect((await prefs('since=0', C)).status).toBe(403);
  });

  it('the daily prune keeps the newest version and drops older rows after 30 days', async () => {
    const old = Date.now() - 40 * 86_400_000;
    await coreSql(
      `INSERT INTO podcast_queue (key, pos, queued, episode, updated_at, synced_at) VALUES (?, 0, 0, '', ?, ?)`,
      `${FEED}#${id(90)}`,
      old,
      old,
    );
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
    const keys = (await coreSql<{ key: string }>('SELECT key FROM podcast_queue')).map((r) => r.key);
    expect(keys).not.toContain(`${FEED}#${id(90)}`);
    expect(keys).toContain(`${FEED}#${id(6)}`);
  });
});

describe('playback speed', () => {
  it('the newer wins; only the app’s speeds are taken', async () => {
    expect((await put('prefs', [{ name: 'speed', value: 1.5, updated_at: T0 }])).body).toMatchObject({ applied: 1 });
    expect((await prefs()).body.items).toEqual([{ name: 'speed', value: 1.5, updated_at: T0 }]);
    expect((await put('prefs', [{ name: 'speed', value: 2, updated_at: T0 - 1 }])).body).toMatchObject({ applied: 0, stale: 1 });
    const r = await put('prefs', [
      { name: 'speed', value: 3, updated_at: T0 + 1 },
      { name: 'volume', value: 1, updated_at: T0 + 1 },
      { name: 'speed', value: 1.25, updated_at: T0 + 2 },
    ]);
    expect(r.body.refused.map((x) => x.index)).toEqual([0, 1]);
    const since = (await prefs()).body.next_since;
    expect((await prefs()).body.items).toEqual([{ name: 'speed', value: 1.25, updated_at: T0 + 2 }]);
    expect((await prefs(`since=${since}`)).body.items).toEqual([]);
  });
});
