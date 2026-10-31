// /v1/ops/reports (API.md §11.16, NEXT-BATCH.md part 1): a batch from the phone is one row, taken
// only from a device, at most 32 KB as JSON, its addresses cut to their host and its tokens
// removed, at most 6 from one device in any 5 minutes; the list is newest first and reads the rows
// it returns, not the table; the daily prune drops rows older than 30 days, at most 2,000 a step.
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
    page: 'p1',
    seq: 1,
    events: [{ t: 1200, type: 'first sound', track: 'r2_native_abc', ms: 840 }],
    ...body,
  },
});
const post = (token: string | undefined, body: unknown) =>
  apiJson<ReportCreated & ErrorBody>('POST', '/v1/ops/reports', { token, body });
const list = (token: string, query = '') => apiJson<Page<Report>>('GET', `/v1/ops/reports${query}`, { token });

/** `n` rows straight into the table, one a millisecond back from `newest`. */
const seed = (n: number, newest: number, prefix: string) =>
  coreSql(
    `INSERT INTO reports (kind, at, id, device_id, body_json)
     SELECT 'playback', ? - value, ? || printf('%05d', value), 'seeded', '{"v":1}' FROM json_each(?)`,
    newest,
    prefix,
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
    expect((await list(agents.muse)).status).toBe(403);
    expect((await list(agents.ci)).status).toBe(403);
    expect((await api('GET', '/v1/ops/reports')).status).toBe(401);
  });

  it('keeps an address only as its host, drops tokens and cuts long text', async () => {
    const token = `th1_${'A'.repeat(43)}abcdef`;
    const r = await post(
      await device(),
      batch({
        events: [
          {
            t: 5,
            type: 'error',
            message: `MEDIA_ERR from https://bucket.example/audio/a.opus?X-Amz-Signature=s3cr3t with ${token}`,
          },
        ],
        note: 'x'.repeat(400),
      }),
    );
    expect(r.status).toBe(201);
    const [row] = await coreSql<{ body_json: string }>('SELECT body_json FROM reports WHERE id = ?', r.body.id);
    const body = JSON.parse(row.body_json);
    expect(body.events[0].message).toBe('MEDIA_ERR from bucket.example/… with [token]');
    expect(body.note).toHaveLength(300);
    expect(row.body_json).not.toMatch(/s3cr3t|X-Amz|AAAAAAAA/);
  });

  it('refuses a batch over 32 KB, a kind it does not know, extra fields and deep nesting', async () => {
    const d = await device();
    const before = await coreSql('SELECT count(*) AS n FROM reports');
    // Under the request limit, over 32 KB as JSON once cleaned (each text stays under 300).
    const big = await post(d, { kind: 'playback', body: { a: Array.from({ length: 112 }, () => 'x'.repeat(290)) } });
    expect([big.status, big.body.error.code]).toEqual([413, 'too_large']);
    // Over the request limit, refused before it is read.
    expect((await post(d, batch({ pad: 'x'.repeat(40_000) }))).status).toBe(413);
    expect((await post(d, { kind: 'diary', body: {} })).status).toBe(422);
    expect((await post(d, { ...batch(), extra: 1 })).status).toBe(422);
    expect((await post(d, { kind: 'playback', body: [1, 2] })).status).toBe(422);
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { deep };
    const r = await post(d, { kind: 'playback', body: deep });
    expect([r.status, r.body.error.code]).toEqual([422, 'validation']);
    expect(await coreSql('SELECT count(*) AS n FROM reports')).toEqual(before);
  });

  it('takes at most 6 from one device in any 5 minutes; another device is counted on its own', async () => {
    const d = await device();
    for (let i = 0; i < 6; i++) expect((await post(d, batch({ seq: i }))).status).toBe(201);
    const over = await post(d, batch({ seq: 7 }));
    expect([over.status, over.body.error.code]).toEqual([429, 'rate_limited']);
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
