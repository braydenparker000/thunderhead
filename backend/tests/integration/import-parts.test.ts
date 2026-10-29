// The import's routes (API.md §11.17): only the key named import-once writes them (the routine's
// own chat key, CI, night and the device are refused; the device may start a run); a part is
// stored once by its path, checked against its SHA-256, gzip and at most 2,000 rows, and never
// of a never-exported table; the manifest names its own run and only parts already stored with
// its SHA-256s; a run needs a built dataset whose table the manifest has, its prerequisite done,
// and one request id per run; a part the manifest's SHA-256 doesn't match fails the run. Without
// the private bucket's binding the routes that need it answer 503 not_configured, and the status
// still reads.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import { app } from '../../src/app';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, makeAgent } from '../helpers';
import { BASE, exportRun, gz, importKey, postPart, sha, untilDone } from '../import-helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let ci = '';
let k = '';
const where = (n = 1) => `run-parts/claude-chat-v1/cc_threads/${String(n).padStart(4, '0')}`;
const code = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

beforeAll(async () => {
  p = await principals();
  ci = await makeAgent(p.D, 'ci');
  k = await importKey(p.D);
});

describe('parts and the manifest', () => {
  it('a part is stored once by its path: the same bytes again are fine, other bytes a conflict', async () => {
    const a = await gz([{ id: 'a' }]);
    expect((await postPart(k, where(), a, 1)).status).toBe(201);
    expect((await postPart(k, where(), a, 1)).status).toBe(201);
    const other = await postPart(k, where(), await gz([{ id: 'b' }]), 1);
    expect(other.status).toBe(409);
  });

  it('refuses a wrong digest, a body that is not gzip, too many rows, a bad path, and other keys', async () => {
    const a = await gz([{ id: 'a' }]);
    expect((await postPart(k, where(2), a, 1, { 'TH-Sha256': '0'.repeat(64) })).status).toBe(422);
    const plain = new TextEncoder().encode('{"id":"a"}\n');
    expect((await postPart(k, where(2), plain, 1)).status).toBe(415);
    expect((await postPart(k, where(2), a, 2_001)).status).toBe(422);
    for (const path of ['run-parts/cc_threads/0001', 'run parts/claude-chat-v1/cc_threads/0001', where(0)])
      expect((await postPart(k, path, a, 1)).status, path).toBe(422);
    expect((await postPart(p.N, where(2), a, 1)).status).toBe(403);
    expect((await postPart(p.D, where(2), a, 1)).status).toBe(403);
  });

  it('the manifest names its run; the same again is fine, another one a conflict', async () => {
    const m = { run_id: 'run-m', worker_version: null, started_at: 1, finished_at: 2, instances: {} };
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-other', { token: k, body: m })).status).toBe(422);
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-m', { token: k, body: m })).status).toBe(201);
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-m', { token: k, body: m })).status).toBe(201);
    const later = { ...m, finished_at: 3 };
    expect((await apiJson('PUT', '/v1/ops/import/manifest/run-m', { token: k, body: later })).status).toBe(409);
  });
});

describe('who writes the import', () => {
  const manifest = (run: string) => ({
    run_id: run,
    worker_version: null,
    started_at: 1,
    finished_at: 2,
    instances: {},
  });

  it("only the import-once key: the routine's own chat key, CI, night and the device are refused", async () => {
    const a = await gz([{ id: 'a' }]);
    const run = { id: uuidv7(), run_id: 'run-who', dataset: 'threads' };
    for (const token of [p.C, ci, p.N, p.D]) {
      const part = await postPart(token, 'run-who/claude-chat-v1/cc_threads/0001', a, 1);
      expect([part.status, await code(part)]).toEqual([403, 'forbidden']);
      const m = await apiJson<ErrorBody>('PUT', '/v1/ops/import/manifest/run-who', {
        token,
        body: manifest('run-who'),
      });
      expect([m.status, m.body.error.code]).toEqual([403, 'forbidden']);
    }
    for (const token of [p.C, ci, p.N]) {
      const r = await apiJson<ErrorBody>('POST', '/v1/import/runs', { token, body: run });
      expect([r.status, r.body.error.code]).toEqual([403, 'forbidden']);
    }
    // The owner's device may start a run (here one whose manifest is missing).
    expect((await apiJson('POST', '/v1/import/runs', { token: p.D, body: run })).status).toBe(422);
    expect((await postPart(k, 'run-who/claude-chat-v1/cc_threads/0001', a, 1)).status).toBe(201);
  });

  it("the routine's chat key (a prompt-injected session) can neither plant old owner words nor take the real run id", async () => {
    const thread = {
      id: 'evil-t1',
      title: 'Old chat',
      created_ms: BASE,
      updated_ms: BASE + 1,
      archived: 0,
      session_url: null,
    };
    const msg = { seq: 1, id: 'evil-m1', thread_id: 'evil-t1', role: 'owner', kind: 'text', body: 'A planted rule.' };
    await expect(
      exportRun(p.C, 'old-1', {
        'claude-chat-v1/cc_threads': [[thread]],
        'claude-chat-v1/cc_messages': [[{ ...msg, created_ms: BASE + 1 }]],
      }),
    ).rejects.toThrow(/: 403 /);
    expect(await env.VAULT.list({ prefix: 'imports/old/old-1/' })).toMatchObject({ objects: [] });
    expect(await coreSql("SELECT id FROM messages WHERE body = 'A planted rule.'")).toEqual([]);
    expect((await apiJson('PUT', '/v1/ops/import/manifest/old-1', { token: k, body: manifest('old-1') })).status).toBe(
      201,
    );
  });
});

describe('what the import never takes', () => {
  const m = (run: string, tables: object) => ({
    run_id: run,
    worker_version: null,
    started_at: 1,
    finished_at: 2,
    instances: { 'jarvis-shared-v2': { tables } },
  });

  it('a never-exported table: by name, by a credential column in its first row, and in a manifest with parts', async () => {
    const a = await gz([{ id: 1, hash: 'x' }]);
    const named = await postPart(k, 'run-never/jarvis-shared-v2/relay_owner_credentials/0001', a, 1);
    expect([named.status, await code(named)]).toEqual([403, 'forbidden']);
    const secret = await gz([{ __rowid__: 1, id: 'w1', push_token: 'x' }]);
    const column = await postPart(k, 'run-never/jarvis-shared-v2/push_devices/0001', secret, 1);
    expect([column.status, await code(column)]).toEqual([403, 'forbidden']);
    const counted = { rows: 2, parts: 0, columns: [], sha256s: [], part_rows: [], never_export: true };
    const ok = await apiJson('PUT', '/v1/ops/import/manifest/run-never', {
      token: k,
      body: m('run-never', { relay_owner_credentials: counted }),
    });
    expect(ok.status).toBe(201);
    const withParts = { rows: 1, parts: 1, columns: ['id', 'push_token'], sha256s: [await sha(secret)] };
    const refused = await apiJson<ErrorBody>('PUT', '/v1/ops/import/manifest/run-never-2', {
      token: k,
      body: m('run-never-2', { push_devices: withParts }),
    });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'forbidden']);
  });

  it('a manifest before its parts, or with another SHA-256, is refused and takes no run id', async () => {
    const bytes = await gz([{ id: 'y', title: 'y', created_ms: BASE, updated_ms: BASE }]);
    const table = (sha256: string) => ({ rows: 1, parts: 1, columns: ['id'], sha256s: [sha256], part_rows: [1] });
    const body = (sha256: string) => ({
      ...m('run-early', {}),
      instances: { 'claude-chat-v1': { tables: { cc_threads: table(sha256) } } },
    });
    const early = await apiJson<ErrorBody>('PUT', '/v1/ops/import/manifest/run-early', {
      token: k,
      body: body(await sha(bytes)),
    });
    expect(early.status).toBe(422);
    expect((early.body.error.details as { path: string }[] | undefined)?.[0]?.path).toBe(
      'instances.claude-chat-v1.tables.cc_threads.sha256s.0',
    );
    expect((await postPart(k, 'run-early/claude-chat-v1/cc_threads/0001', bytes, 1)).status).toBe(201);
    const wrong = await apiJson('PUT', '/v1/ops/import/manifest/run-early', { token: k, body: body('0'.repeat(64)) });
    expect(wrong.status).toBe(422);
    const short = { ...table(await sha(bytes)), parts: 2 };
    const counts = await apiJson('PUT', '/v1/ops/import/manifest/run-early', {
      token: k,
      body: { ...m('run-early', {}), instances: { 'claude-chat-v1': { tables: { cc_threads: short } } } },
    });
    expect(counts.status).toBe(422);
    expect(
      (await apiJson('PUT', '/v1/ops/import/manifest/run-early', { token: k, body: body(await sha(bytes)) })).status,
    ).toBe(201);
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
    await exportRun(k, 'run-bad', {
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
        headers: { Authorization: `Bearer ${k}`, 'CF-Connecting-IP': '192.0.2.10', ...(init.headers ?? {}) },
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
