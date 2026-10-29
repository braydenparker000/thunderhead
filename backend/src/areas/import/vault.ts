// Where the old export lives in the private bucket (DATA.md §7.1, §12): each part as the old
// Worker sent it, `imports/old/<run_id>/<instance>/<table>/part-<nnnn>.jsonl.gz`, and the manifest
// written last, `imports/old/<run_id>/manifest.json`. A part is stored once: sent again with the
// same bytes it is the same part, with other bytes a conflict. Reading one back checks its
// SHA-256 against the manifest before a row of it is used.
import type { ImportManifest } from '../../../../shared/contract/api';
import { JobError } from '../jobs/runner';

export const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export const prefix = (runId: string) => `imports/old/${runId}/`;
export const partKey = (runId: string, instance: string, table: string, n: number) =>
  `${prefix(runId)}${instance}/${table}/part-${String(n).padStart(4, '0')}.jsonl.gz`;
export const manifestKey = (runId: string) => `${prefix(runId)}manifest.json`;

export const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (bytes: ArrayBuffer | Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes));

/** Stores bytes once at `key`: `stored` when new or the same bytes again, `conflict` when other
 * bytes are there. R2 checks the SHA-256 on the way in. */
export async function putOnce(
  vault: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
  sha: string,
  type: string,
  meta: Record<string, string> = {},
): Promise<'stored' | 'conflict'> {
  const had = await vault.head(key);
  if (had) return had.customMetadata?.sha256 === sha ? 'stored' : 'conflict';
  await vault.put(key, bytes, {
    sha256: sha,
    httpMetadata: { contentType: type },
    customMetadata: { ...meta, sha256: sha },
  });
  return 'stored';
}

export async function readManifest(vault: R2Bucket, runId: string): Promise<ImportManifest | null> {
  const obj = await vault.get(manifestKey(runId));
  return obj ? ((await obj.json()) as ImportManifest) : null;
}

/** One part's rows, after checking its bytes against the manifest's SHA-256. */
export async function readPart(
  vault: R2Bucket,
  runId: string,
  instance: string,
  table: string,
  n: number,
  sha: string,
): Promise<Record<string, unknown>[]> {
  const obj = await vault.get(partKey(runId, instance, table, n));
  if (!obj) throw new JobError('missing_part');
  const bytes = await obj.arrayBuffer();
  if ((await sha256(bytes)) !== sha) throw new JobError('bad_part');
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
