// @ts-check
// The rules of sending a file to the workshop (shared/contract/workshop.ts), with nothing of the page
// in them so a node test runs them: what is refused, which stored file a picked one is, and sending
// the pieces not yet in, in order, each with its SHA-256 and each tried up to four times (waits of
// 1 s, 5 s, 15 s), counting bytes as they go.

/** One file: WORKSHOP_LIMITS.file_bytes. */
export const FILE_BYTES = 512 * 1024 * 1024;
export const WAITS = [1_000, 5_000, 15_000];

/** @param {number} bytes @param {number} partBytes */
export const partsOf = (bytes, partBytes) => Math.max(1, Math.ceil(bytes / partBytes));

/** A size in words: 38.2 MB. @param {number} bytes */
export function sizeOf(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${units[u]}`;
}

/** Why a file can't be sent, in the owner's words, or null. @param {{ size: number }} f */
export const refuse = (f) => (f.size === 0 ? 'That file is empty.' : f.size > FILE_BYTES ? 'That file is over 512 MB.' : null);

/** The stored file a picked one is (the same name and size), so a file half sent goes on from where it
 * stopped; null for a new one.
 * @template {{ name: string, bytes: number }} T @param {T[]} items @param {{ name: string, size: number }} file @returns {T | null} */
export const known = (items, file) => items.find((f) => f.bytes === file.size && f.name === file.name.normalize('NFC').trim()) ?? null;

/** A failure worth another try: no answer, the Worker or the bucket busy. @param {any} e */
export const retriable = (e) => !e?.status || e.status >= 500 || e.status === 429;

/**
 * Sends every piece not yet in, in order.
 * @param {{
 *   file: Blob, id: string, partBytes: number, have: number[],
 *   put: (id: string, n: number, bytes: Blob, sha: string, onSent: (sent: number) => void) => Promise<{ have: number[] }>,
 *   hash: (bytes: Blob) => Promise<string>,
 *   wait?: (ms: number) => Promise<void>,
 *   onProgress?: (fraction: number) => void,
 * }} o
 * @returns {Promise<number[]>} the pieces that are in
 */
export async function sendFile(o) {
  const wait = o.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const total = partsOf(o.file.size, o.partBytes);
  const sizeAt = (/** @type {number} */ n) => Math.min(o.partBytes, o.file.size - (n - 1) * o.partBytes);
  let have = new Set(o.have);
  let base = [...have].reduce((s, n) => s + sizeAt(n), 0);
  o.onProgress?.(base / o.file.size);
  for (let n = 1; n <= total; n++) {
    if (have.has(n)) continue;
    const blob = o.file.slice((n - 1) * o.partBytes, (n - 1) * o.partBytes + sizeAt(n));
    const sha = await o.hash(blob);
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await o.put(o.id, n, blob, sha, (sent) => o.onProgress?.((base + Math.min(sent, blob.size)) / o.file.size));
        have = new Set([...have, ...r.have]);
        base += blob.size;
        o.onProgress?.(base / o.file.size);
        break;
      } catch (e) {
        if (attempt >= WAITS.length || !retriable(e)) throw e;
        await wait(WAITS[attempt]);
      }
    }
  }
  return [...have].sort((a, b) => a - b);
}
