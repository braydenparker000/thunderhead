// @ts-check
// The rules of adding a book (STUDY.md §3.1), with nothing of the page in them so a node test runs
// them: what is refused, the title, which failures are tried again, and sending the parts not yet
// received, in order, each up to four times (waits of 1 s, 5 s, 15 s), counting bytes as they go.

export const MAX_BYTES = 500 * 1024 * 1024;
export const WAITS = [1_000, 5_000, 15_000];

/** How many parts a file of `size` bytes takes. @param {number} size @param {number} partBytes */
export const partsOf = (size, partBytes) => Math.max(1, Math.ceil(size / partBytes));

/** Why a file can't be added, in the owner's words, or null. @param {{ size: number, name: string, type: string }} f */
export function refuse(f) {
  if (f.size > MAX_BYTES) return 'This PDF is over 500 MB.';
  if (f.size === 0 || (f.type && f.type !== 'application/pdf') || !/\.pdf$/i.test(f.name))
    return "That file isn't a PDF.";
  return null;
}

/** The title from the PDF's own metadata, else the file name without `.pdf`.
 * @param {string | undefined | null} metaTitle @param {string} fileName */
export function titleFor(metaTitle, fileName) {
  const t = (metaTitle ?? '').replace(/\s+/g, ' ').trim();
  if (t && !/^(untitled|microsoft word - )/i.test(t)) return t.slice(0, 300);
  return fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 300) || 'Untitled book';
}

/** A failure worth another try: no answer, the Worker or the bucket busy; not the day's free
 * allowance spent (429 `budget_exhausted`), which only midnight UTC ends. @param {any} e */
export const retriable = (e) => !e?.status || e.status >= 500 || (e.status === 429 && e.code !== 'budget_exhausted');

/**
 * The toast when an upload stops: what happened, and when Resume will work. A signed-out 401 never
 * gets here (it goes to sign-in).
 * @param {{ kind: string, status: number, code: string | null, retryAfter: number | null }} f th/flow.js's failure
 * @param {string} line th/copy.js's lineFor(f), for every other failure @param {number} [now]
 */
export function stopLine(f, line, now = Date.now()) {
  if (f.code === 'budget_exhausted') {
    const at = new Date(now + (f.retryAfter ?? 0) * 1000);
    const when = f.retryAfter ? `after ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : 'tomorrow';
    return `The upload stopped: the Thunderhead has used up today's free allowance. Tap Resume ${when} to go on.`;
  }
  if (f.status === 429) return 'The upload stopped: too many tries at once. Wait a minute, then tap Resume.';
  if (f.status >= 500) return "The upload stopped: the Thunderhead had a problem on its side. Wait a few minutes, then tap Resume.";
  return `The upload stopped. ${line} Tap Resume to go on.`;
}

/**
 * Sends every part not yet received, in order.
 * @param {{
 *   file: Blob, bookId: string, partBytes: number, have: number[],
 *   put: (bookId: string, n: number, bytes: Blob, onSent: (sent: number) => void) => Promise<{ parts: number[] }>,
 *   wait?: (ms: number) => Promise<void>,
 *   onProgress?: (fraction: number) => void,
 * }} o
 * @returns {Promise<number[]>} the parts the Worker has
 */
export async function sendParts(o) {
  const put = o.put;
  const wait = o.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const total = partsOf(o.file.size, o.partBytes);
  const sizeOf = (/** @type {number} */ n) => Math.min(o.partBytes, o.file.size - (n - 1) * o.partBytes);
  let have = new Set(o.have);
  let base = [...have].reduce((s, n) => s + sizeOf(n), 0);
  o.onProgress?.(base / o.file.size);
  for (let n = 1; n <= total; n++) {
    if (have.has(n)) continue;
    const blob = o.file.slice((n - 1) * o.partBytes, (n - 1) * o.partBytes + sizeOf(n));
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await put(o.bookId, n, blob, (sent) => o.onProgress?.((base + Math.min(sent, blob.size)) / o.file.size));
        have = new Set(r.parts);
        base += blob.size;
        break;
      } catch (e) {
        // The part's bytes were sent but not taken: the ring goes back while it waits.
        o.onProgress?.(base / o.file.size);
        if (attempt >= WAITS.length || !retriable(e)) throw e;
        await wait(WAITS[attempt]);
      }
    }
  }
  return [...have].sort((a, b) => a - b);
}
