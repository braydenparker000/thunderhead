// Helpers for the import suites: an old export made of synthetic rows, posted part by part as the
// driver does (gzip JSONL with TH-Import, TH-Sha256, TH-Rows) and its manifest last, and a way
// to run Core's alarm until a run ends. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import type { ImportManifest, ImportStatus } from '../../shared/contract/api';
import type { Core } from '../src/objects/core';
import { apiJson, core } from './helpers';

export const BASE = Date.parse('2026-09-01T12:00:00Z');

export async function gz(rows: object[]): Promise<Uint8Array> {
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function postPart(
  token: string,
  where: string,
  bytes: Uint8Array,
  rows: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  return exports.default.fetch(
    new Request('https://api.example.test/v1/ops/import/parts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Type': 'application/gzip',
        'TH-Import': where,
        'TH-Sha256': await sha(bytes),
        'TH-Rows': String(rows),
        ...headers,
      },
      body: bytes,
    }),
  );
}

/** Posts every part of every table (`"<instance>/<table>"` → parts of rows) and then the manifest;
 * `rows` overrides a table's manifest count. */
export async function exportRun(
  token: string,
  runId: string,
  tables: Record<string, object[][]>,
  over: { rows?: Record<string, number> } = {},
): Promise<ImportManifest> {
  const manifest: ImportManifest = {
    run_id: runId,
    worker_version: 'synthetic',
    started_at: BASE,
    finished_at: BASE + 1,
    instances: {},
  };
  for (const [path, parts] of Object.entries(tables)) {
    const [instance, table] = path.split('/');
    const sha256s: string[] = [];
    for (const [i, rows] of parts.entries()) {
      const bytes = await gz(rows);
      const res = await postPart(
        token,
        `${runId}/${instance}/${table}/${String(i + 1).padStart(4, '0')}`,
        bytes,
        rows.length,
      );
      if (res.status !== 201) throw new Error(`part ${path} ${i + 1}: ${res.status} ${await res.text()}`);
      sha256s.push(await sha(bytes));
    }
    manifest.instances[instance] ??= { tables: {} };
    manifest.instances[instance].tables[table] = {
      rows: over.rows?.[path] ?? parts.reduce((n, p) => n + p.length, 0),
      parts: parts.length,
      columns: Object.keys(parts[0]?.[0] ?? {}),
      sha256s,
      part_rows: parts.map((p) => p.length),
    };
  }
  const put = await apiJson('PUT', `/v1/ops/import/manifest/${runId}`, { token, body: manifest });
  if (put.status !== 201) throw new Error(`manifest: ${put.status} ${JSON.stringify(put.body)}`);
  return manifest;
}

/** Runs the alarm (and any retry made due at once) until the run ends; returns its status. */
export async function untilDone(token: string, id: string, rounds = 20): Promise<ImportStatus> {
  for (let i = 0; i < rounds; i++) {
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
    const s = (await apiJson<ImportStatus>('GET', `/v1/import/runs/${id}`, { token })).body;
    if (s.state === 'done' || s.state === 'failed') return s;
  }
  throw new Error(`import ${id} did not end`);
}
