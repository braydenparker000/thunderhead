// Bounded range requests of Astra's range reader (http-source.js) that stand apart from its downloads: a
// side read (seek previews) and the first part of a block a download began inside of. Neither goes through
// the streams, the cache's order or the read-ahead, so neither can end, starve or redirect a download that
// playback reads from. They send the same headers, keep the same time limits, fail with the same kinds of
// error, and count their bytes in what the film has cost.

import {BLOCK, TIMING, SourceError, parseContentRange, ask} from './source-stream.js';

/**
 * Bytes [start, end) of the file in one request of their own. Rejects a SourceError ('closed', 'stall', 'gone', 'status',
 * 'range', 'network'). `into` (end - start long) receives them, and `onBytes(filled)` hears of each piece as it arrives.
 */
export async function sideRead(source, start, end, signal, {into = null, onBytes = null} = {}) {
  if (source.closed) throw new SourceError('closed', 'The file was closed.');
  end = Math.min(end, source.size ?? end);
  if (!(end > start)) return new Uint8Array(0);
  const controller = new AbortController(), stop = () => controller.abort();
  signal?.addEventListener('abort', stop, {once: true});
  if (signal?.aborted) stop();
  const closed = () => new SourceError('closed', signal?.aborted ? 'The read was ended.' : 'The file was closed.');
  const watch = setInterval(() => { if (source.closed) stop(); }, 250); // the file closed meanwhile: this ends too
  try {
    let response;
    try {
      response = await ask(source, {Range: `bytes=${start}-${end - 1}`}, controller.signal, TIMING.stall, 'stall');
    } catch (error) {
      if (controller.signal.aborted) throw closed();
      throw error instanceof SourceError ? error : new SourceError('network', 'The connection to the host dropped.', String(error?.message || error));
    }
    const range = parseContentRange(response.headers.get('content-range'));
    if (response.status !== 206 || (range && range.start !== start)) {
      response.body?.cancel().catch(() => {});
      const kind = response.status === 404 || response.status === 410 ? 'gone' : response.status === 200 ? 'range' : 'status';
      throw new SourceError(kind, `The host answered ${response.status} to a range request.`, response.status);
    }
    const out = into || new Uint8Array(end - start), reader = response.body.getReader();
    let filled = 0;
    try {
      while (filled < out.length) {
        let stall;
        const {done, value} = await Promise.race([reader.read(), new Promise((_, reject) => { stall = setTimeout(() => reject(new SourceError('stall', 'The host stopped sending.')), TIMING.stall); })])
          .finally(() => clearTimeout(stall));
        if (done) throw new SourceError('network', 'The host ended its answer early.');
        source.bytesFetched += value.length;
        const n = Math.min(value.length, out.length - filled); // a host that sends past the range: the rest is not kept
        out.set(value.subarray(0, n), filled); filled += n;
        onBytes?.(filled);
      }
    } catch (error) {
      if (controller.signal.aborted) throw closed();
      throw error instanceof SourceError ? error : new SourceError('network', 'The connection to the host dropped.', String(error?.message || error));
    } finally { reader.cancel().catch(() => {}); }
    return out;
  } finally {
    clearInterval(watch);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * A download that began inside a block (a seek) leaves its first part unfetched; the subtitle scanners look
 * at whole blocks only, so once playback is under way that part is fetched on the side and the block is whole.
 */
export function fillHole(source, rec) {
  setTimeout(async () => {
    if (source.closed || source.partials.get(rec.index) !== rec || rec.from === 0) return;
    const start = rec.index * BLOCK;
    try {
      const head = await sideRead(source, start, start + rec.from);
      if (source.closed || source.partials.get(rec.index) !== rec || source.blocks.has(rec.index)) return;
      rec.bytes.set(head, 0); rec.from = 0;
      if (rec.filled === rec.bytes.length) source.store(rec.index, rec.bytes);
    } catch {} // only the scanners lose: playback never needed these bytes
  }, TIMING.hole);
}
