// The import's routes (API.md §11.17): a part is stored once by its path, checked against its
// SHA-256, gzip and at most 2,000 rows; the manifest names its own run; a run needs a built
// dataset whose table the manifest has, its prerequisite done, and one request id per run; a
// part the manifest's SHA-256 doesn't match fails the run. Without the private bucket's binding
// the routes that need it answer 503 not_configured, and the status still reads.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import { app } from '../../src/app';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, makeAgent } from '../helpers';
import { exportRun, gz, postPart, sha, untilDone } from '../import-helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let ci = '';
const where = (n = 1) => `run-parts/claude-chat-v1/cc_threads/${String(n).padStart(4, '0')}`;
const code = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

beforeAll(async () => {
  p = await principals();
  ci = await makeAgent(p.D, 'ci');
});

describe('parts and the manifest', () => {
  it('a part is stored once by its path: the same bytes again are fine, other bytes a conflict', async () => {
    const a = await gz([{ id: 'a' }]);
    expect((await postPart(ci, where(), a, 1)).status).toBe(201);
    expect((await postPart(p.C, where(), a, 1)).status).toBe(201);
    const other = await postPart(ci, where(), await gz([{ id: 'b' }]), 1);
    expect(other.status).toBe(409);
  });

  it('refuses a wrong digest, a body that is not gzip, too many rows, a bad path, and other keys', async () => {
    const a = await gz([{ id: 'a' }]);
    expect((await postPart(ci, where(2), a, 1, { 'TH-Sha256': '0'.repeat(64) })).status).toBe(422);
    const plain = new TextEncoder().encode('{"id":"a"}\n');
    expect((await postPart(ci, where(2), plain, 1)).status).toBe(415);
    expect((await postPart(ci, where(2), a, 2_001)).status).toBe(422);
    for (const path of ['run-parts/cc_threads/0001', 'run parts/claude-chat-v1/cc_threads/0001', where(0)])
      expect((await postPart(ci, path, a, 1)).status, path).toBe(422);
    expect((await postPart(p.N, where(2), a, 1)).status).toBe(403);
    expect((await postPart(p.D, where(2), a, 1)).status).toBe(403);
  });

  it('the manifest names its run; the same again is fine, another one a conflict', async () => {
    const m = { run_id: 'run-m', worker_version: null, started_at: 1, finished_at: 2, instances: {} };
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-other', { token: ci, body: m })).status).toBe(422);
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-m', { token: ci, body: m })).status).toBe(201);
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-m', { token: ci, body: m })).status).toBe(201);
    const later = { ...m, finished_at: 3 };
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-m', { token: ci, body: later })).status).toBe(409);
  });
});

describe('runs', () => {
  const start = (body: object, token = p.D) => apiJson<ErrorBody>('POST', '/v1/import/runs', { token, body });

  it('need a built dataset, a manifest with its table, and the request id for one run only', async () => {
    expect((await start({ id: uuidv7(), run_id: 'run-none', dataset: 'threads' })).status).toBe(422);
    expect((await start({ id: uuidv7(), run_id: 'run-m', dataset: 'threads' })).status).toBe(422);
    const muse = await start({ id: uuidv7(), run_id: 'run-m', dataset: 'muse' });
    expect(muse.status).toBe(422);
    expect(JSON.stringify(muse.body)).toMatch(/waits for/);
    expect((await start({ id: uuidv7(), run_id: 'run-m', dataset: 'threads' }, p.N)).status).toBe(403);
    expect((await apiJson('GET', `/v1/import/runs/${uuidv7()}`, { token: p.N })).status).toBe(404);
  });

  it('a part that does not match the manifest fails the run after three tries', async () => {
    await exportRun(ci, 'run-bad', {
      'claude-chat-v1/cc_threads': [[{ id: 't1', title: 'x', created_ms: 1_000, updated_ms: 2_000 }]],
    });
    const key = 'imports/old/run-bad/claude-chat-v1/cc_threads/part-0001.jsonl.gz';
    const swapped = await gz([{ id: 't2', title: 'y', created_ms: 1_000, updated_ms: 2_000 }]);
    await env.VAULT.put(key, swapped, { customMetadata: { sha256: await sha(swapped) } });
    const id = uuidv7();
    expect((await start({ id, run_id: 'run-bad', dataset: 'threads' })).status).toBe(202);
    for (let i = 0; i < 3; i++) {
      await coreSql('UPDATE jobs SET due_at = 0 WHERE state IN (?, ?)', 'queued', 'running');
      await untilDone(p.D, id, 1).catch(() => null);
    }
    const s = (await apiJson<{ state: string; last_error: string }>('GET', `/v1/import/runs/${id}`, { token: p.D }))
      .body;
    expect(s).toMatchObject({ state: 'failed', last_error: 'bad_part' });
  });
});

describe('without the private bucket', () => {
  const bare = { ...env, VAULT: undefined } as unknown as Env;
  const call = (method: string, path: string, init: RequestInit) =>
    app.fetch(
      new Request(`https://api.example.test${path}`, {
        method,
        ...init,
        headers: { Authorization: `Bearer ${ci}`, 'CF-Connecting-IP': '192.0.2.10', ...(init.headers ?? {}) },
      }),
      bare,
      createExecutionContext(),
    );

  it('the routes that need it answer 503 not_configured; the status still reads', async () => {
    const a = await gz([{ id: 'a' }]);
    const part = await call('POST', '/v1/ops/import/parts', {
      body: a,
      headers: { 'Content-Type': 'application/gzip', 'TH-Import': where(3), 'TH-Sha256': await sha(a), 'TH-Rows': '1' },
    });
    expect([part.status, await code(part)]).toEqual([503, 'not_configured']);
    const m = await call('PUT', '/v1/ops/import/manifest/run-x', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([m.status, await code(m)]).toEqual([503, 'not_configured']);
    const owner = { Authorization: `Bearer ${p.D}`, 'Content-Type': 'application/json' };
    const run = await call('POST', '/v1/import/runs', {
      body: JSON.stringify({ id: uuidv7(), run_id: 'run-m', dataset: 'threads' }),
      headers: owner,
    });
    expect([run.status, await code(run)]).toEqual([503, 'not_configured']);
    expect((await call('GET', `/v1/import/runs/${uuidv7()}`, { headers: owner })).status).toBe(404);
  });
});
