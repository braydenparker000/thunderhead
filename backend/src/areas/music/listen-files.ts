// Where the listening pass keeps its files in the private bucket (VAULT, DATA.md §7.1). What an
// Actions run uploads through the Worker waits, unchecked, under `jobs/incoming/<job_id>/` until it is
// collected; a neighbours spec's hashes and embeddings under `jobs/specs/`. Both go once the job is
// applied, rejected or expired. Only the Worker reads or writes the bucket: Actions holds no key to it.
import { LISTEN_LIMITS as L, type ListenKind } from '../../../../shared/contract/listen.ts';
import { partsFor } from './listen-check';

export const incoming = (id: string) => `jobs/incoming/${id}/`;
export const specKey = (id: string, part: 'order' | 'emb') => `jobs/specs/${id}.${part}`;
export const MANIFEST = 'manifest.json';
export const NEIGHBOURS_FILE = 'neighbours.bin';
const PART = /^part-(\d{3})\.jsonl$/;

/** The largest upload a file name takes for this job, or 0 when the name isn't one of its files. */
export function uploadLimit(kind: ListenKind, name: string, songs: number): number {
  if (name === MANIFEST) return L.manifest_bytes;
  if (kind === 'audio.neighbours') return name === NEIGHBOURS_FILE ? L.neighbours_bytes : 0;
  const m = PART.exec(name);
  const p = m ? Number(m[1]) : 0;
  return p >= 1 && p <= partsFor(songs) ? L.part_bytes : 0;
}

/** Deletes everything a job left in the bucket (its uploads and its spec files). */
export async function dropJobFiles(vault: R2Bucket, id: string): Promise<void> {
  const listed = await vault.list({ prefix: incoming(id), limit: 100 });
  await vault.delete([...listed.objects.map((o) => o.key), specKey(id, 'order'), specKey(id, 'emb')]);
}

/** Base64 of bytes, in slices (a spread of 400 KB would overflow the call stack). */
export function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
