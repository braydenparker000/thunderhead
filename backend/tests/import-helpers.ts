// Helpers for the import suites: an old export made of synthetic rows, posted part by part as the
// driver does (gzip JSONL with TH-Import, TH-Sha256, TH-Rows) and its manifest last, and a way
// to run Core's alarm until a run ends. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import type { ImportManifest, ImportStatus } from '../../shared/contract/api';
import { type JobHandler, type JobHost, runJobs } from '../src/areas/jobs/runner';
import type { Db } from '../src/objects/base';
import type { Core } from '../src/objects/core';
import { apiJson, core } from './helpers';

export const BASE = Date.parse('2026-09-01T12:00:00Z');
const HOUR = 3_600_000;

/** A seeded old Chats export (TESTING.md §8): `threads` threads and `messages` messages spread
 * over them at random, every old id starting with `prefix`, so two exports with one seed and two
 * prefixes hold the same rows under other ids. About 1 message in 97 is empty and 1 in 211 names
 * a thread the export lacks; Claude's replies name the message before them in their thread. */
export function oldChats(prefix: string, seed: number, threads = 50, messages = 2_000) {
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ts = Array.from({ length: threads }, (_, i) => ({
    id: `${prefix}t${i}`,
    title: `Old chat ${i}`,
    created_ms: BASE + i * HOUR,
    updated_ms: BASE + i * HOUR + 3 * HOUR,
    archived: 0,
    session_url: null,
  }));
  const last = new Map<number, string>();
  const ms = Array.from({ length: messages }, (_, i) => {
    const t = Math.floor(rand() * threads);
    const role = rand() < 0.5 ? 'owner' : 'claude';
    const reply = role === 'claude' ? (last.get(t) ?? null) : null;
    last.set(t, `${prefix}m${i}`);
    return {
      seq: i + 1,
      id: `${prefix}m${i}`,
      thread_id: i % 211 === 5 ? `${prefix}gone` : `${prefix}t${t}`,
      role,
      kind: 'text',
      body: i % 97 === 3 ? ' ' : `message ${i} in chat ${t}`,
      meta: null,
      reply_to: reply,
      created_ms: BASE + t * HOUR + i * 1_000,
      delivered_ms: null,
      answered_ms: null,
      attachments: null,
    };
  });
  return { threads: ts, messages: ms };
}

/** Splits rows into parts of `size`. */
export const parts = <T>(rows: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/** Runs Core's jobs once with these handlers (a test's own, such as one that dies in a step), at
 * `now`. */
export function runJobsWith(handlers: Record<string, JobHandler>, now?: number): Promise<number> {
  return runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => {
    const x = o as unknown as { env: Env; db: Db; write: JobHost['write'] };
    return runJobs({ env: x.env, db: x.db, write: x.write.bind(o) }, handlers, now);
  });
}

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
