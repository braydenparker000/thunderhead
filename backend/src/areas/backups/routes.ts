// /v1/ops/backups, /v1/ops/drill (API.md §11.16) and /v1/export (MENU-AND-SETTINGS.md §4.9): start
// a weekly backup or the restore drill by hand (night, ci), list the backups (counts only), and
// "download everything": the password again, then a job builds the files, then the device that
// asked downloads them as one ZIP for an hour. The sandbox has none of it.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { Page } from '../../../../shared/contract/api';
import type {
  BackupItem,
  BackupRunResponse,
  DrillRunResponse,
  ExportStartResponse,
  ExportStatus,
} from '../../../../shared/contract/backups.ts';
import { type AppEnv, guard, principalOf } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import type { ExportFile } from './store';
import { zipLength, zipStream } from './zip';

const runBody = z.strictObject({ class: z.optional(z.literal('core')) });
const listQuery = z.object({ limit: z.optional(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100))) });
const exportBody = z.strictObject({ password: z.string().check(z.minLength(1), z.maxLength(1024)) });
const ID = /^[0-9a-f-]{36}$/;

const noSandbox = () => {
  if (inSandbox())
    throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no backups or exports' }]);
};
const vault = (env: Env) => {
  const v = (env as { VAULT?: R2Bucket }).VAULT;
  if (!v) throw new ApiError('not_configured');
  return v;
};
const exportId = (raw: string) => {
  if (!ID.test(raw)) throw new ApiError('not_found');
  return raw;
};
/** The device session that asks (exports are the device's alone). */
const sessionOf = (c: Parameters<typeof principalOf>[0]) => {
  const p = principalOf(c);
  if (p.kind !== 'device') throw new ApiError('forbidden');
  return p.session_id;
};

export const backupsRoutes = new Hono<AppEnv>()
  .post('/ops/backups/run', guard('POST /v1/ops/backups/run'), async (c) => {
    noSandbox();
    vault(c.env);
    await json(c, runBody);
    const out = value(await fresh(coreObject(c.env).backupRun(callerOf(c))));
    return c.json(out satisfies BackupRunResponse, 202);
  })
  .get('/ops/backups', guard('GET /v1/ops/backups'), async (c) => {
    noSandbox();
    const q = parse(listQuery, c.req.query());
    const items = (await fresh(coreObject(c.env).backups(q.limit ?? 20))) as BackupItem[];
    return c.json({ items, next: null } satisfies Page<BackupItem>);
  })
  .post('/ops/drill/run', guard('POST /v1/ops/drill/run'), async (c) => {
    noSandbox();
    vault(c.env);
    await json(c, z.strictObject({}));
    const out = value(await fresh(coreObject(c.env).drillRun(callerOf(c))));
    return c.json(out satisfies DrillRunResponse, 202);
  })
  .post('/export', guard('POST /v1/export'), async (c) => {
    noSandbox();
    vault(c.env);
    const session = sessionOf(c);
    const { password } = await json(c, exportBody);
    const step = await authObject(c.env).stepUp(session, password);
    if (!step.ok) throw new ApiError(step.code, step.details, { retry_after: step.retry_after, scope: step.scope });
    const out = value(await fresh(coreObject(c.env).exportStart(callerOf(c))));
    return c.json(out satisfies ExportStartResponse, 202);
  })
  .get('/export/:id', guard('GET /v1/export/:id'), async (c) => {
    noSandbox();
    const id = exportId(c.req.param('id'));
    const s = (await fresh(coreObject(c.env).exportStatus(id, sessionOf(c)))) as ExportStatus | null;
    if (!s) throw new ApiError('not_found');
    return c.json(s);
  })
  .get('/export/:id/zip', guard('GET /v1/export/:id/zip'), async (c) => {
    noSandbox();
    const bucket = vault(c.env);
    const id = exportId(c.req.param('id'));
    const z0 = (await fresh(coreObject(c.env).exportFiles(id, sessionOf(c)))) as {
      files: ExportFile[];
      at: number;
      date: string;
    } | null;
    if (!z0) throw new ApiError('not_found');
    const entries = z0.files.map((f) => ({
      ...f,
      open: async () => (await bucket.get(f.key))?.body ?? null,
    }));
    return new Response(zipStream(entries, z0.at), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(zipLength(entries)),
        'content-disposition': `attachment; filename="thunderhead-export-${z0.date}.zip"`,
        'cache-control': 'no-store',
      },
    });
  });
