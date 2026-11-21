// A book's file for the phone (STUDY.md §2.3): whole, or one byte range of it (`Range: bytes=a-b`,
// `bytes=a-` or `bytes=-n`), so the reader shows page 1 from a few ranges while the whole file is
// kept in the background, and a dropped download goes on from the bytes it has. Anything else in
// `Range` (several ranges, other units) gets the whole file, as HTTP allows.
import type { Context } from 'hono';
import type { AppEnv } from '../../http/auth';
import { ApiError } from '../../http/errors';

export type Want = { offset: number; end: number | null } | { suffix: number };

/** The one range asked for, or null for the whole file. */
export function rangeOf(h: string | undefined): Want | null {
  const m = /^bytes=(\d{1,15})-(\d{0,15})$/.exec(h?.trim() ?? '');
  if (m) {
    const end = m[2] === '' ? null : Number(m[2]);
    return end !== null && end < Number(m[1]) ? null : { offset: Number(m[1]), end };
  }
  const s = /^bytes=-(\d{1,15})$/.exec(h?.trim() ?? '');
  return s && Number(s[1]) > 0 ? { suffix: Number(s[1]) } : null;
}

/** First and last byte of a range in a file of `size`, or null when it starts past the end. */
export function spanOf(w: Want, size: number): [number, number] | null {
  if ('suffix' in w) return size ? [Math.max(0, size - w.suffix), size - 1] : null;
  if (w.offset >= size) return null;
  return [w.offset, Math.min(size - 1, w.end ?? size - 1)];
}

const HEADERS = { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' };

/** The stored file at `key`, as asked: 200 whole, 206 a range, 416 a range past its end. */
export async function serveFile(c: Context<AppEnv>, key: string): Promise<Response> {
  const want = rangeOf(c.req.header('Range'));
  if (!want) {
    const obj = await c.env.VAULT.get(key);
    if (!obj) throw new ApiError('not_found');
    return c.body(obj.body, 200, { ...HEADERS, 'Content-Length': String(obj.size) });
  }
  const head = await c.env.VAULT.head(key);
  if (!head) throw new ApiError('not_found');
  const span = spanOf(want, head.size);
  if (!span) return c.body(null, 416, { ...HEADERS, 'Content-Range': `bytes */${head.size}` });
  const [a, b] = span;
  const obj = await c.env.VAULT.get(key, { range: { offset: a, length: b - a + 1 } });
  if (!obj) throw new ApiError('not_found');
  return c.body(obj.body, 206, {
    ...HEADERS,
    'Content-Length': String(b - a + 1),
    'Content-Range': `bytes ${a}-${b}/${head.size}`,
  });
}
