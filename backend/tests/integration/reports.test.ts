// /v1/ops/reports (API.md §11.16, NEXT-BATCH.md part 1): a batch from the phone is one row, taken
// only from a device, kept to its known fields (any other dropped, every text with its addresses cut
// to their host, quoted text cut, at most 160 characters), at most 32 KB as JSON, at most 6 from one
// device in any 5 minutes (then 429 with Retry-After); the list goes to the devices and the mind,
// never CI or Muse, newest first, reads the rows it returns, not the table, and ends a page before
// 512 KB; the daily prune drops rows older than 30 days, at most 2,000 a step.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, Page } from '../../../shared/contract/api';
import type { Report, ReportCreated } from '../../../shared/contract/reports.ts';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, loginOk, makeAgent, rowsDuring, setupOwner } from '../helpers';

const DAY = 86_400_000;
let owner: string;
const agents = {} as Record<'chat' | 'night' | 'reflex' | 'ci' | 'muse', string>;
let ip = 20;
/** Another signed-in device: the 5-minute count is per device. */
const device = async () => (await loginOk(`192.0.2.${ip++}`)).token;

const batch = (body: Record<string, unknown> = {}) => ({
  kind: 'playback',
  body: {
    v: 1,
    page: '0123456789abcdef',
    seq: 1,
    why: 'minute',
    events: [{ n: 0, t: 1200, type: 'first sound', track: 'r2_native_abc', ms: 840 }],
    ...body,
  },
});
const post = (token: string | undefined, body: unknown) =>
  apiJson<ReportCreated & ErrorBody>('POST', '/v1/ops/reports', { token, body });
const list = (token: string, query = '') => apiJson<Page<Report>>('GET', `/v1/ops/reports${query}`, { token });

/** `n` rows straight into the table, one a millisecond back from `newest`. */
const seed = (n: number, newest: number, prefix: string, pad = 0) =>
  coreSql(
    `INSERT INTO reports (kind, at, id, device_id, body_json)
     SELECT 'playback', ? - value, ? || printf('%05d', value), 'seeded',
       CASE WHEN ? > 0 THEN '{"v":1,"pad":"' || replace(hex(zeroblob(?)), '0', 'x') || '"}' ELSE '{"v":1}' END
     FROM json_each(?)`,
    newest,
    prefix,
    pad,
    pad / 2,
    JSON.stringify([...Array(n).keys()]),
  );

beforeAll(async () => {
  owner = (await setupOwner()).token;
  agents.chat = await makeAgent(owner, 'mind:chat');
  agents.night = await makeAgent(owner, 'mind:night');
  agents.reflex = await makeAgent(owner, 'mind:reflex');
  agents.ci = await makeAgent(owner, 'ci');
  agents.muse = await makeAgent(owner, 'muse');
});

describe('a batch from the phone', () => {
  it('is one row from a device, given back to the devices and the mind, never to CI or Muse', async () => {
    expect((await post(undefined, batch())).status).toBe(401);
    for (const t of [agents.chat, agents.ci]) expect((await post(t, batch())).status).toBe(403);
    const d = await device();
    const before = Date.now();
    const r = await post(d, batch());
    expect(r.status).toBe(201);
    expect(r.body.at).toBeGreaterThanOrEqual(before);
    const rows = await coreSql<{ id: string; device_id: string }>(
      'SELECT id, device_id FROM reports WHERE id = ?',
      r.body.id,
    );
    expect(rows).toHaveLength(1);
    for (const t of [d, agents.chat, agents.night, agents.reflex]) {
      const got = await list(t, `?since=${before}`);
      expect(got.status).toBe(200);
      expect(got.body.items.map((i) => i.id)).toContain(r.body.id);
    }
    const mine = (await list(d, `?since=${before}`)).body.items.find((i) => i.id === r.body.id);
    expect(mine).toEqual({
      id: r.body.id,
      kind: 'playback',
      device_id: rows[0].device_id,
      at: r.body.at,
      body: batch().body,
    });
    // Listening history by track id: never to CI, whose logs are public, nor to Muse.
    for (const t of [agents.ci, agents.muse]) {
      const no = await list(t);
      expect([no.status, (no.body as unknown as ErrorBody).error.code]).toEqual([403, 'forbidden']);
    }
    expect((await api('GET', '/v1/ops/reports')).status).toBe(401);
  });

  it('keeps only the known fields, and of a text only what is safe', async () => {
    const token = `th1_${'A'.repeat(43)}abcdef`;
    const r = await post(
      await device(),
      batch({
        trackTitle: 'A Song',
        q: 'what I searched',
        events: [
          {
            n: 1,
            t: 5,
            type: 'track',
            id: 'r2_native_abc',
            format: 'OPUS',
            source: 'stream',
            trackTitle: 'A Song',
            songName: 'A Song',
            key: 'audio/Artist/Song.opus',
            q: 'what I searched',
            meta: { tags: { TIT2: 'A Song' } },
          },
          {
            n: 2,
            t: 6,
            type: 'error',
            deck: 0,
            code: 2,
            kind: 'network',
            message: `MEDIA_ERR HTTPS://Bucket.Example/audio/A.opus?sig=s3cr3t with ${token}`,
          },
          { n: 3, t: 7, type: 'stream_error', code: 4, message: 'open file:///storage/Music/My Song.opus (gone)' },
          { n: 4, t: 8, type: 'stream_error', code: 4, message: 'at content://media/external/audio/My Song' },
          {
            n: 5,
            t: 9,
            type: 'stream_error',
            code: 4,
            message: 'fetch https%3A%2F%2Fh.example%2FMy%20Song.opus%3Fsig%3Dx',
          },
          { n: 6, t: 10, type: 'stream_error', code: 2, message: 'GET http://user:secret@host.example/My Song.mp3' },
          { n: 7, t: 11, type: 'stream_error', code: 3, message: `"My Song" is not ${'x'.repeat(300)}` },
          { n: 8, t: 12, type: 'my own type', title: 'A Song' },
          { n: 9, t: 13, type: 'track', id: 'Artist - My Song.opus' },
        ],
        state: {
          track: { id: 'r2_native_abc', title: 'A Song' },
          decks: [{ index: 0, waits: 1, path: '/My Song' }],
          browser: 'x',
        },
      }),
    );
    expect(r.status).toBe(201);
    const [row] = await coreSql<{ body_json: string }>('SELECT body_json FROM reports WHERE id = ?', r.body.id);
    const body = JSON.parse(row.body_json);
    expect(body).toEqual({
      v: 1,
      page: '0123456789abcdef',
      seq: 1,
      why: 'minute',
      events: [
        { n: 1, t: 5, type: 'track', id: 'r2_native_abc', format: 'OPUS', source: 'stream' },
        { n: 2, t: 6, type: 'error', deck: 0, code: 2, kind: 'network', message: 'MEDIA_ERR Bucket.Example/…' },
        { n: 3, t: 7, type: 'stream_error', code: 4, message: 'open file:… (gone)' },
        { n: 4, t: 8, type: 'stream_error', code: 4, message: 'at media/…' },
        { n: 5, t: 9, type: 'stream_error', code: 4, message: 'fetch h.example/…' },
        { n: 6, t: 10, type: 'stream_error', code: 2, message: 'GET host.example/…' },
        { n: 7, t: 11, type: 'stream_error', code: 3, message: `… is not ${'x'.repeat(300)}`.slice(0, 160) },
        { n: 8, t: 12, type: 'other' },
        { n: 9, t: 13, type: 'track' },
      ],
      state: { track: { id: 'r2_native_abc' }, decks: [{ index: 0, waits: 1 }] },
    });
    expect(row.body_json).not.toMatch(/Song|Artist|search|TIT2|s3cr3t|secret|sig|storage|AAAAAAAA/);
  });

  it('refuses a batch over 32 KB, a kind it does not know and extra fields; drops what nests too deep', async () => {
    const d = await device();
    const before = await coreSql('SELECT count(*) AS n FROM reports');
    // Under the request limit, over 32 KB as JSON once kept (every field known, each text 150).
    const events: Record<string, unknown>[] = [];
    const big = { kind: 'playback', body: { v: 1, events } };
    for (let n = 0; JSON.stringify(big.body).length <= 32_800; n++)
      events.push({ n, t: n, type: 'stream_error', code: 1, message: 'x'.repeat(150), atMs: 1 });
    const over = await post(d, big);
    expect([over.status, over.body.error.code]).toEqual([413, 'too_large']);
    // Over the request limit, refused before it is read.
    expect((await post(d, batch({ pad: 'x'.repeat(40_000) }))).status).toBe(413);
    expect((await post(d, { kind: 'diary', body: {} })).status).toBe(422);
    expect((await post(d, { ...batch(), extra: 1 })).status).toBe(422);
    expect((await post(d, { kind: 'playback', body: [1, 2] })).status).toBe(422);
    expect(await coreSql('SELECT count(*) AS n FROM reports')).toEqual(before);
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { deep };
    const kept = await post(d, { kind: 'playback', body: { ...deep, v: 1 } });
    expect(kept.status).toBe(201);
    const [row] = await coreSql<{ body_json: string }>('SELECT body_json FROM reports WHERE id = ?', kept.body.id);
    expect(row.body_json).toBe('{"v":1}');
  });

  it('takes at most 6 from one device in any 5 minutes; another device is counted on its own', async () => {
    const d = await device();
    for (let i = 0; i < 6; i++) expect((await post(d, batch({ seq: i }))).status).toBe(201);
    const res = await api('POST', '/v1/ops/reports', { token: d, body: batch({ seq: 7 }) });
    const over = (await res.json()) as ErrorBody & { error: { retry_after: number } };
    expect([res.status, over.error.code]).toEqual([429, 'rate_limited']);
    expect(over.error.retry_after).toBeGreaterThan(0);
    expect(over.error.retry_after).toBeLessThanOrEqual(300);
    expect(res.headers.get('Retry-After')).toBe(String(over.error.retry_after));
    expect((await post(await device(), batch())).status).toBe(201);
  });

  it('costs one row written and none read', async () => {
    const d = await device();
    const rows = await rowsDuring(core(), async () => expect((await post(d, batch())).status).toBe(201));
    expect(rows).toEqual({ read: 0, written: 1 });
  });
});

describe('the list', () => {
  it('reads about the rows it returns (50 of 600), on every page, by kind or not', async () => {
    const now = Date.now();
    await seed(600, now - 60_000, 'list-');
    for (const query of ['?kind=playback&limit=50', '?limit=50']) {
      let page: Page<Report> = { items: [], next: null };
      const first = await rowsDuring(core(), async () => {
        page = (await list(owner, query)).body;
      });
      expect(page.items).toHaveLength(50);
      expect(first.read).toBeLessThanOrEqual(55);
      expect(first.written).toBe(0);
      const ats = page.items.map((i) => i.at);
      expect([...ats].sort((a, b) => b - a)).toEqual(ats);
      // The fourth page starts where the third ended and still reads only its own rows.
      for (let i = 0; i < 3; i++) page = (await list(owner, `${query}&cursor=${page.next}`)).body;
      const seen = new Set(page.items.map((x) => x.id));
      const fourth = await rowsDuring(core(), async () => {
        page = (await list(owner, `${query}&cursor=${page.next}`)).body;
      });
      expect(page.items).toHaveLength(50);
      expect(page.items.some((x) => seen.has(x.id))).toBe(false);
      expect(fourth.read).toBeLessThanOrEqual(55);
    }
    const plan = await coreSql<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT kind, at, id, device_id, body_json FROM reports
       WHERE kind = 'playback' AND at >= 0 AND (at, id) < (1, '') ORDER BY at DESC, id DESC LIMIT 50`,
    );
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/SEARCH reports USING PRIMARY KEY/);
    const since = await list(owner, `?since=${now - 60_000 - 9}&limit=200`);
    expect(since.body.items.filter((i) => i.id.startsWith('list-'))).toHaveLength(10);
    expect((await list(owner, '?cursor=not-ours')).status).toBe(400);
    expect((await list(owner, '?limit=201')).status).toBe(422);
  });

  it('ends a page before it passes 512 KB, and the next page goes on from there', async () => {
    const now = Date.now();
    // 20 batches of 30 KB, newer than every other row but the ones posted above.
    await seed(20, now - 30_000, 'big-', 30_000);
    const query = `?kind=playback&since=${now - 40_000}&limit=200`;
    const res = await api('GET', `/v1/ops/reports${query}`, { token: owner });
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    const first = (await res.json()) as Page<Report>;
    const size = first.items.reduce((n, i) => n + JSON.stringify(i.body).length, 0);
    expect(size).toBeLessThanOrEqual(512 * 1024);
    const bigs = (p: Page<Report>) => p.items.filter((i) => i.id.startsWith('big-')).length;
    expect(bigs(first)).toBeGreaterThan(10);
    expect(bigs(first)).toBeLessThan(20);
    expect(first.next).not.toBeNull();
    const second = (await list(owner, `${query}&cursor=${first.next}`)).body;
    expect(bigs(first) + bigs(second)).toBe(20);
    expect(second.next).toBeNull();
  });
});

describe('the daily prune', () => {
  it('drops batches older than 30 days, at most 2,000 rows a step, and keeps the rest', async () => {
    const now = Date.now();
    await seed(2_100, now - 31 * DAY, 'old-');
    await seed(5, now - 29 * DAY, 'kept-');
    const tick = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(now));
    const count = async (prefix: string) =>
      (await coreSql<{ n: number }>('SELECT count(*) AS n FROM reports WHERE id LIKE ?', `${prefix}%`))[0].n;
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    await tick();
    expect(await count('old-')).toBe(100);
    await tick();
    expect(await count('old-')).toBe(0);
    expect(await count('kept-')).toBe(5);
  });
});
