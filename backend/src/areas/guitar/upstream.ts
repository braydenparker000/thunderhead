// One GET to a tab source (GUITAR.md §11, the old repo's backend/songsterr.js and
// guitar-sources.js): a fixed origin, same-origin redirects only (at most 3), a time limit, a size
// limit read as it streams, and a gzip body unpacked when a CDN sends one without saying so. The
// edge may keep a public file (a Guitar Pro download, a sample) for `ttl` seconds; nothing is ever
// logged or stored here. Tests swap the fetch.

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch the sources use. */
export function useFetch(f: typeof fetch): void {
  fetcher = f;
}

async function bounded(r: Response, limit: number, tooLarge: string): Promise<Uint8Array> {
  const reader = r.body?.getReader();
  if (!reader) throw new SourceError('The source returned an empty response.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new SourceError(tooLarge, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

export interface Get {
  limit: number;
  accept: string;
  ttl?: number;
  timeout?: number;
  /** What the owner reads when the source is out of reach, says no, or is too large. */
  words?: { unreachable?: string; unavailable?: string; notFound?: string; tooLarge?: string; slow?: string };
}

export async function get(url: string, g: Get): Promise<{ bytes: Uint8Array; type: string }> {
  const w = {
    unreachable: "Couldn't reach the source. Please try again.",
    unavailable: 'Source unavailable',
    notFound: 'Not found',
    tooLarge: 'This file is too large.',
    slow: 'The source took too long. Please try again.',
    ...g.words,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), g.timeout ?? 15_000);
  try {
    let target = url;
    let r: Response | null = null;
    for (let hops = 0; ; hops++) {
      r = await fetcher(target, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { Accept: g.accept, 'User-Agent': 'Thunderhead-Guitar/1.0' },
        ...(g.ttl ? { cf: { cacheTtl: g.ttl, cacheEverything: true } } : {}),
      });
      if (![301, 302, 303, 307, 308].includes(r.status)) break;
      await r.body?.cancel();
      const next = new URL(r.headers.get('Location') || '', target);
      if (hops >= 3 || next.origin !== new URL(url).origin) throw new SourceError(w.unavailable);
      target = next.href;
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new SourceError(r.status === 404 ? w.notFound : w.unavailable, r.status === 404 ? 404 : 502);
    }
    let bytes = await bounded(r, g.limit, w.tooLarge);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b)
      bytes = await bounded(
        new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))),
        g.limit,
        w.tooLarge,
      );
    return { bytes, type: r.headers.get('Content-Type') || '' };
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(controller.signal.aborted ? w.slow : w.unreachable, controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}
