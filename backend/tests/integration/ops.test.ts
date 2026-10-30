// /v1/ops and /v1/settings (API.md §11.1, §11.16, §11.20): deep health, the error inbox, perf,
// meter and the private Core settings (the owner's time zone lives only there).
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  DeepHealthResponse,
  ErrorBody,
  ErrorRow,
  MeterResponse,
  Page,
  Settings,
} from '../../../shared/contract/api';
import { api, apiJson, coreSql, makeAgent, setupOwner } from '../helpers';

let owner: string;
let ci: string;
beforeAll(async () => {
  owner = (await setupOwner()).token;
  ci = await makeAgent(owner, 'ci');
});

const report = (over: Record<string, unknown> = {}) => ({
  source: 'client',
  code: 'boot_failed',
  message: 'x',
  build: 412,
  at: Date.now(),
  ...over,
});

describe('deep health', () => {
  it('reports the documented shape, counts only, to a device and to the ci key', async () => {
    for (const token of [owner, ci]) {
      const { status, body } = await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token });
      expect(status).toBe(200);
      expect(body).toEqual({
        ok: true,
        version: { id: env.VERSION.id, tag: env.VERSION.tag || null },
        schema: { core: 20, auth: 2, music: 1, senses: 1, library: 1 },
        objects: {
          core: {
            ok: true,
            schema: 20,
            expected: 20,
            db_bytes: expect.any(Number),
            jobs_backlog: 0,
            last_alarm_at: null,
          },
          auth: {
            ok: true,
            schema: 2,
            expected: 2,
            db_bytes: expect.any(Number),
            jobs_backlog: 0,
            last_alarm_at: null,
          },
          music: {
            ok: true,
            schema: 1,
            expected: 1,
            db_bytes: expect.any(Number),
            jobs_backlog: 0,
            last_alarm_at: null,
          },
          senses: {
            ok: true,
            schema: 1,
            expected: 1,
            db_bytes: expect.any(Number),
            jobs_backlog: 0,
            last_alarm_at: null,
          },
          library: {
            ok: true,
            schema: 1,
            expected: 1,
            db_bytes: expect.any(Number),
            jobs_backlog: 0,
            last_alarm_at: null,
          },
        },
        meter_today: {
          rows_written: expect.any(Number),
          rows_read: expect.any(Number),
          bulk_rows_written: 0,
          bulk_lane: null,
        },
        last_backup: null,
        last_events_export: null,
        errors_open: 0,
        wakes_today: 0,
        min_client: 0,
      });
    }
  });
});

describe('error inbox', () => {
  it('stores reports once per fingerprint, scrubbed, with counts and the newest build; 204', async () => {
    const msg = 'failed at https://x.example.test/a?token=abc with thm_ABCDEFGHIJKLMNOP';
    for (const build of [412, 413]) {
      const r = await api('POST', '/v1/ops/errors', {
        token: owner,
        body: { items: [report({ message: msg, build, count: 2 })] },
      });
      expect(r.status).toBe(204);
    }
    const rows = await coreSql<Record<string, unknown>>('SELECT count, message, last_build, source FROM errors');
    expect(rows).toEqual([{ count: 4, message: 'failed at [url] with [token]', last_build: 413, source: 'client' }]);
    expect((await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: owner })).body.errors_open).toBe(
      1,
    );
  });

  it('refuses more than 50 items (422), over 32 KB (413), a bad source or a long message (422)', async () => {
    const many = Array.from({ length: 51 }, () => report());
    expect((await api('POST', '/v1/ops/errors', { token: owner, body: { items: many } })).status).toBe(422);
    const big = Array.from({ length: 50 }, () =>
      report({ message: 'y'.repeat(300), route: 'r'.repeat(200), code: 'c'.repeat(60), fingerprint: 'f'.repeat(64) }),
    );
    expect((await api('POST', '/v1/ops/errors', { token: owner, body: { items: big } })).status).toBe(413);
    expect(
      (await api('POST', '/v1/ops/errors', { token: owner, body: { items: [report({ source: 'worker' })] } })).status,
    ).toBe(422);
    expect(
      (await api('POST', '/v1/ops/errors', { token: owner, body: { items: [report({ message: 'z'.repeat(301) })] } }))
        .status,
    ).toBe(422);
  });

  it('lists open errors newest first with a cursor, resolves them, and refuses a foreign cursor', async () => {
    await api('POST', '/v1/ops/errors', {
      token: owner,
      body: { items: [report({ code: 'a', fingerprint: 'fp-a' }), report({ code: 'b', fingerprint: 'fp-b' })] },
    });
    const p1 = await apiJson<Page<ErrorRow>>('GET', '/v1/ops/errors?status=open&limit=2', { token: ci });
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.next).toBeTruthy();
    const p2 = await apiJson<Page<ErrorRow>>('GET', `/v1/ops/errors?status=open&limit=2&cursor=${p1.body.next}`, {
      token: ci,
    });
    expect(p2.body, JSON.stringify([p1.body, p2.body])).toMatchObject({ items: [expect.any(Object)], next: null });
    const newest = Math.max(...[...p1.body.items, ...p2.body.items].map((e) => e.last_at));
    const recent = await apiJson<Page<ErrorRow>>('GET', `/v1/ops/errors?status=open&since=${newest}`, { token: ci });
    expect(recent.body.items.length).toBeGreaterThan(0);
    expect(recent.body.items.every((e) => e.last_at >= newest)).toBe(true);
    const none = await apiJson<Page<ErrorRow>>('GET', `/v1/ops/errors?status=open&since=${newest + 1}`, { token: ci });
    expect(none.body.items).toEqual([]);
    const fps = [...p1.body.items, ...p2.body.items].map((e) => e.fingerprint);
    expect(new Set(fps).size).toBe(3);
    expect((await api('POST', '/v1/ops/errors/fp-a/resolve', { token: owner, body: {} })).status).toBe(204);
    expect((await api('POST', '/v1/ops/errors/nope/resolve', { token: owner, body: {} })).status).toBe(404);
    const resolved = await apiJson<Page<ErrorRow>>('GET', '/v1/ops/errors?status=resolved', { token: owner });
    expect(resolved.body.items.map((e) => e.fingerprint)).toEqual(['fp-a']);
    const foreign = btoa(JSON.stringify({ r: 'other', k: [] }));
    expect(
      (await apiJson<ErrorBody>('GET', `/v1/ops/errors?cursor=${foreign}`, { token: owner })).body.error.code,
    ).toBe('bad_request');
  });
});

describe('settings, perf and meter', () => {
  it('owner.tz falls back to UTC and is set from the phone, kept only in Core', async () => {
    const before = await apiJson<Settings>('GET', '/v1/settings', { token: owner });
    expect(before.body).toMatchObject({ 'owner.tz': 'UTC', min_client: 0 });
    const r = await apiJson<Settings>('PATCH', '/v1/settings', { token: owner, body: { 'owner.tz': 'Etc/GMT+3' } });
    expect(r).toEqual({ status: 200, body: { 'owner.tz': 'Etc/GMT+3' } });
    expect((await apiJson<Settings>('GET', '/v1/settings', { token: owner })).body['owner.tz']).toBe('Etc/GMT+3');
    expect(await coreSql('SELECT actor FROM settings WHERE key = ?', 'owner.tz')).toEqual([{ actor: 'owner' }]);
    expect(await coreSql("SELECT kind, ref FROM changes WHERE kind = 'setting'")).toEqual([
      { kind: 'setting', ref: 'setting:owner.tz' },
    ]);
  });

  it('refuses unknown zones, unknown keys and an empty patch', async () => {
    for (const body of [{ 'owner.tz': 'Not/AZone' }, { 'theme.accent': 'red' }, {}])
      expect((await api('PATCH', '/v1/settings', { token: owner, body })).status).toBe(422);
  });

  it('stores a day of perf numbers and reports today’s meter per class', async () => {
    const body = { day: '2026-10-28', build: 412, metrics: { inp: { p50: 40, p75: 60, p95: 120, n: 30 } } };
    expect((await api('POST', '/v1/ops/perf', { token: owner, body })).status).toBe(204);
    expect(await coreSql('SELECT metric, n FROM perf_days')).toEqual([{ metric: 'inp', n: 30 }]);
    const m = await apiJson<MeterResponse>('GET', '/v1/ops/meter?days=7', { token: ci });
    expect(m.body.items.map((i) => i.class).sort()).toEqual(['auth', 'core', 'library', 'music', 'senses']);
    expect((await api('GET', '/v1/ops/meter?days=31', { token: ci })).status).toBe(422);
  });
});
