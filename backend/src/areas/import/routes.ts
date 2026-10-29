// The import (API.md §11.17, MIGRATION.md §3–4): the driver posts the old export's parts as they
// came (`TH-Import: <run_id>/<instance>/<table>/<nnnn>`, `TH-Sha256`, `TH-Rows`) and the manifest
// last; a run then turns one dataset's parts into rows in Core, and its status carries the counts
// and the verification report. Only the key named `import-once` writes them (RouteSpec.key: a
// routine's key could otherwise plant "old" owner words); a never-exported table is refused, and
// a manifest names only parts already stored with its SHA-256s. Parts and the manifest live in
// the private bucket; without its binding (local dev, older configs) the routes that need it
// answer 503 not_configured.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { ImportManifest, ImportRunRequest, ImportStatus } from '../../../../shared/contract/api';
import {
  IMPORT_DATASET_NAMES,
  IMPORT_DATASETS,
  IMPORT_NEVER_EXPORT,
  IMPORT_PART_BYTES,
  IMPORT_PART_ROWS,
  IMPORT_SECRET_COLUMN,
  neverExported,
} from '../../../../shared/contract/imports.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import {
  firstKeys,
  manifestKey,
  NAME,
  partKey,
  prefix,
  putOnce,
  RUN_ID,
  readManifest,
  sha256,
  storedShas,
} from './vault';

const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const name = z.string().check(z.regex(NAME));
const table = z.strictObject({
  rows: z.number().check(z.int(), z.gte(0)),
  parts: z.number().check(z.int(), z.gte(0), z.lte(9_999)),
  columns: z.array(z.string().check(z.maxLength(64))).check(z.maxLength(200)),
  sha256s: z.array(z.string().check(z.regex(SHA))).check(z.maxLength(9_999)),
  part_rows: z.optional(
    z.array(z.number().check(z.int(), z.gte(0), z.lte(IMPORT_PART_ROWS))).check(z.maxLength(9_999)),
  ),
  never_export: z.optional(z.boolean()),
});
const manifestBody = z.strictObject({
  run_id: z.string().check(z.regex(RUN_ID)),
  worker_version: z.nullable(z.string().check(z.maxLength(80))),
  started_at: z.number().check(z.int(), z.gte(0)),
  finished_at: z.number().check(z.int(), z.gte(0)),
  instances: z.record(name, z.strictObject({ tables: z.record(name, table) })),
}) satisfies z.ZodMiniType<ImportManifest>;
const runBody = z.strictObject({
  id: z.string().check(z.regex(UUID)),
  run_id: z.string().check(z.regex(RUN_ID)),
  dataset: z.enum(IMPORT_DATASET_NAMES),
}) satisfies z.ZodMiniType<ImportRunRequest>;

/** A manifest names only what is stored: every part, with the SHA-256 it was stored with, and no
 * part of a never-exported table. */
async function partsStored(vault: R2Bucket, m: ImportManifest): Promise<void> {
  const stored = await storedShas(vault, m.run_id);
  for (const [instance, { tables }] of Object.entries(m.instances))
    for (const [name, t] of Object.entries(tables)) {
      const at = `instances.${instance}.tables.${name}`;
      if (t.parts > 0 && neverExported(name, t.columns)) throw new ApiError('forbidden');
      if (t.sha256s.length !== t.parts) throw issue(`${at}.sha256s`, 'one per part');
      if (t.part_rows && t.part_rows.length !== t.parts) throw issue(`${at}.part_rows`, 'one per part');
      t.sha256s.forEach((sha, i) => {
        if (stored.get(partKey(m.run_id, instance, name, i + 1)) !== sha)
          throw issue(`${at}.sha256s.${i}`, 'no part stored with this SHA-256');
      });
    }
}

const vaultOf = (env: Env): R2Bucket => {
  const v = (env as Partial<Env>).VAULT;
  if (!v) throw new ApiError('not_configured');
  return v;
};
const issue = (path: string, what: string) => new ApiError('validation', [{ path, issue: what }]);

export const importRoutes = new Hono<AppEnv>()
  .post('/ops/import/parts', guard('POST /v1/ops/import/parts'), async (c) => {
    const vault = vaultOf(c.env);
    const where =
      /^([A-Za-z0-9_-]{1,64})\/([A-Za-z_][A-Za-z0-9_-]{0,63})\/([A-Za-z_][A-Za-z0-9_-]{0,63})\/(\d{4})$/.exec(
        c.req.header('TH-Import') ?? '',
      );
    if (!where || where[4] === '0000') throw issue('TH-Import', '<run_id>/<instance>/<table>/<nnnn>, from 0001');
    // A table the old export never sends: refused by name here, by its columns below.
    if (IMPORT_NEVER_EXPORT.includes(where[3])) throw new ApiError('forbidden');
    const sha = c.req.header('TH-Sha256') ?? '';
    if (!SHA.test(sha)) throw issue('TH-Sha256', 'lowercase hex SHA-256 of the body');
    const rows = Number(c.req.header('TH-Rows'));
    if (!Number.isInteger(rows) || rows < 0 || rows > IMPORT_PART_ROWS) throw issue('TH-Rows', `0-${IMPORT_PART_ROWS}`);
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > IMPORT_PART_BYTES) throw new ApiError('too_large');
    const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    if (head[0] !== 0x1f || head[1] !== 0x8b) throw new ApiError('unsupported_media_type');
    if ((await sha256(bytes)) !== sha) throw issue('TH-Sha256', 'does not match the body');
    // In memory: the body once (≤ 25 MiB, its digest, and the first row's names, read in slices).
    const keys = await firstKeys(bytes).catch(() => {
      throw new ApiError('unsupported_media_type');
    });
    if (keys.some((k) => IMPORT_SECRET_COLUMN.test(k))) throw new ApiError('forbidden');
    const key = partKey(where[1], where[2], where[3], Number(where[4]));
    const stored = await putOnce(vault, key, bytes, sha, 'application/gzip', { rows: String(rows) });
    if (stored === 'conflict') throw new ApiError('conflict');
    return c.json({ key }, 201);
  })
  .put('/ops/import/manifest/:run_id', guard('PUT /v1/ops/import/manifest/:run_id'), async (c) => {
    const vault = vaultOf(c.env);
    const runId = c.req.param('run_id') ?? '';
    if (!RUN_ID.test(runId)) throw issue('run_id', 'letters, digits, _ and -, at most 64');
    const body = await json(c, manifestBody);
    if (body.run_id !== runId) throw issue('run_id', 'the path and the body name the same run');
    await partsStored(vault, body);
    const text = JSON.stringify(body);
    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
    const stored = await putOnce(vault, manifestKey(runId), bytes, await sha256(bytes), 'application/json');
    if (stored === 'conflict') throw new ApiError('conflict');
    return c.body(null, 201);
  })
  .post('/import/runs', guard('POST /v1/import/runs'), async (c) => {
    const vault = vaultOf(c.env);
    const body = await json(c, runBody);
    const spec = IMPORT_DATASETS[body.dataset];
    if (!spec.built) throw issue('dataset', `waits for ${spec.waits}`);
    const manifest = await readManifest(vault, body.run_id);
    if (!manifest) throw issue('run_id', 'no manifest for this run yet');
    const t = manifest.instances[spec.instance]?.tables[spec.table];
    if (!t || t.never_export || t.sha256s.length !== t.parts) throw issue('dataset', `the run has no ${spec.table}`);
    const threads = manifest.instances[spec.instance]?.tables.cc_threads;
    const out = value(
      await fresh(
        coreObject(c.env).importStart(callerOf(c), {
          ...body,
          instance: spec.instance,
          table: spec.table,
          rows: t.rows,
          sha256s: t.sha256s,
          part_rows: t.part_rows,
          run_started: manifest.started_at,
          threads: body.dataset === 'messages' && threads ? { sha256s: threads.sha256s } : undefined,
          prefix: prefix(body.run_id),
        }),
      ),
    );
    return c.json(out, 202);
  })
  .get('/import/runs/:id', guard('GET /v1/import/runs/:id'), async (c) => {
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id)) throw issue('id', 'a lowercase UUID');
    const found = await fresh(coreObject(c.env).importStatus(id));
    if (!found) throw new ApiError('not_found');
    return c.json(found satisfies ImportStatus);
  });
