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
 * bytes are there. The put is conditional (`If-None-Match: *`), so of two senders racing for one
 * key only the first writes; R2 checks the SHA-256 on the way in. */
export async function putOnce(
  vault: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
  sha: string,
  type: string,
  meta: Record<string, string> = {},
): Promise<'stored' | 'conflict'> {
  const put = await vault.put(key, bytes, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    sha256: sha,
    httpMetadata: { contentType: type },
    customMetadata: { ...meta, sha256: sha },
  });
  if (put) return 'stored';
  const had = await vault.head(key);
  return had?.customMetadata?.sha256 === sha ? 'stored' : 'conflict';
}

/** Every object stored under a run's prefix, with the SHA-256 it was stored with: one list call
 * per 1,000 objects, where a head per part would spend the request's subrequests. */
export async function storedShas(vault: R2Bucket, runId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await vault.list({ prefix: prefix(runId), include: ['customMetadata'], cursor });
    for (const o of page.objects) out.set(o.key, o.customMetadata?.sha256 ?? '');
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const SLICE = 64 * 1024;
const FIRST_ROW_TEXT = 1024 * 1024;

/** The column names of a gzip JSONL part's first row (none for an empty part); throws on a body
 * that is not gzip JSONL. It decompresses from 64 KiB slices of the part, never a copy of all of
 * it, and only as far as the first newline or 1 MiB of text: a first row longer than that (a big
 * BLOB) gives the names seen so far. */
export async function firstKeys(bytes: ArrayBuffer): Promise<string[]> {
  let at = 0;
  const slices = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.byteLength) {
        c.close();
        return;
      }
      c.enqueue(new Uint8Array(bytes.slice(at, at + SLICE)));
      at += SLICE;
    },
  });
  const reader = slices.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  try {
    while (!text.includes('\n') && text.length < FIRST_ROW_TEXT) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const end = text.indexOf('\n');
  if (end === -1 && text.length >= FIRST_ROW_TEXT)
    return [...text.matchAll(/"([A-Za-z_][A-Za-z0-9_]{0,63})":/g)].map((m) => m[1]);
  const line = end === -1 ? text : text.slice(0, end);
  if (!line) return [];
  const row = JSON.parse(line) as unknown;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('not a row');
  return Object.keys(row);
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
