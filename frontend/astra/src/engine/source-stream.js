// One download of Astra's range reader (http-source.js): an open-ended range
// request read into 1 MiB blocks (source-blocks.js), and what happens when it breaks off. A
// download that brought a fair part of the file before it broke (a host that
// cuts every connection after so many bytes) is simply continued from the
// byte it reached. One that brought next to nothing is a failure: tried again
// with a growing pause, for up to a minute from the first failed try a read
// was waiting on. Read-ahead nobody waits for is reopened quietly or left.

import {BLOCK, keepPart, takePart} from './source-blocks.js';

export {BLOCK};
export const READ_AHEAD = 24 * BLOCK; // a stream pauses at most this far past the furthest byte read from it (the source's readAhead; less with the data saver)
export const PROBE_AHEAD = 2 * BLOCK; // ...and this far while the file is being described, or before the film's bitrate is known
export const PROBE_MARGIN = 64 << 10; // while describing, a download stops this far past the last byte asked of it
export const REUSE_WINDOW = 12 * BLOCK; // a request this close ahead of a stream waits for it
const RETRIES = 3; // for answers that will not change by asking again (a refused range)
const PIECE = 64 << 10; // a download that brought at least this much before breaking off made progress
/** Waits in milliseconds; tests shorten them. */
export const TIMING = {
  open: 15000, // the host must start answering the first request within this
  stall: 20000, // a later request must be answered, and a stream must keep sending, within this
  keepTrying: 60000, // a lost connection is retried this long before reads fail
  backoff: 400, // the first pause before a retry; it doubles up to five seconds
  hole: 4000, // after a seek, the place playback reads from has the connection to itself this long (side-read.js)
  quiet: 3000, // when the network changes, a download that has brought nothing for this long is asked again
};

export class SourceError extends Error {
  constructor(kind, message, detail) { super(message); this.kind = kind; this.detail = detail; }
}

/** Parses "bytes 0-1023/4096" into {start, end, size}; size is null for "*". */
export function parseContentRange(value) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || '').trim());
  return m ? {start: +m[1], end: +m[2], size: m[3] === '*' ? null : +m[3]} : null;
}

/**
 * One request whose answer must begin within `ms` (its body may then take as long as it needs).
 * A host or a dead socket that never sends headers ends as a SourceError of kind `late`.
 */
export async function ask(source, headers, signal, ms, late, method = 'GET') {
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), ms);
  try {
    return await source.request(headers, signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal, method);
  } catch (error) {
    if (timeout.signal.aborted && !signal?.aborted) throw new SourceError(late, 'The host did not answer.');
    throw error;
  } finally { clearTimeout(timer); }
}

/** Reads one download into the source's blocks until it ends, pauses for good or is closed. Rejects when it breaks off. */
export async function runStream(source, stream, response) {
  const signal = stream.controller.signal;
  let index = Math.floor(stream.at / BLOCK), rec = null;
  try {
    if (!response) {
      // A download that broke off inside this block left its first part: go on from the byte it reached.
      rec = takePart(source, index, stream.at);
      if (rec) stream.at = index * BLOCK + rec.filled;
      const from = stream.at;
      if (rec) source.filling.add(rec);
      response = await ask(source, {Range: `bytes=${from}-`}, signal, TIMING.stall, 'stall');
      const range = parseContentRange(response.headers.get('content-range'));
      if (response.status !== 206 || (range && (range.start !== from || (range.size != null && range.size !== source.size)))) {
        response.body?.cancel().catch(() => {});
        if (response.status === 206) throw new SourceError('status', 'The host answered with another part of the file, or another file.');
        throw new SourceError(response.status === 200 ? 'range' : 'status', `The host answered ${response.status} to a range request.`, response.status);
      }
      if (response.url) source.url = response.url; // where a redirect led, for the requests that follow
    }
    const reader = response.body.getReader();
    signal.addEventListener('abort', () => reader.cancel().catch(() => {}), {once: true});
    if (!rec) { const off = stream.at - index * BLOCK; rec = {index, bytes: new Uint8Array(source.blockLength(index)), from: off, filled: off}; source.filling.add(rec); }
    while (index < source.blockCount()) {
      // What comes next is already here (another download fetched it): nothing to add.
      if (rec.filled === rec.from && source.blocks.has(index)) { stream.abort(); return; }
      // Stop reading (TCP backpressure) when far ahead of every reader.
      while (stream.at - stream.want > source.reach() && !signal.aborted) await new Promise(r => { stream.wake = r; });
      if (signal.aborted) return;
      // A connection that goes quiet (no error, no bytes) would hang reads forever.
      let stall;
      const {done, value} = await Promise.race([reader.read(), new Promise((_, reject) => { stall = setTimeout(() => reject(new SourceError('stall', 'The host stopped sending.')), TIMING.stall); })])
        .catch(error => { reader.cancel().catch(() => {}); throw error; })
        .finally(() => clearTimeout(stall));
      // The answer ended before the file did.
      if (done) throw new SourceError('network', 'The host ended its answer early.');
      source.bytesFetched += value.length; stream.received += value.length; stream.lastAt = Date.now();
      if (stream.received >= PIECE && (source.failures || source.failingSince)) source.calm(); // the host is sending again
      let ended = false;
      for (let offset = 0; offset < value.length;) {
        const n = Math.min(rec.bytes.length - rec.filled, value.length - offset);
        rec.bytes.set(value.subarray(offset, offset + n), rec.filled); rec.filled += n; offset += n; stream.at += n;
        if (rec.filled < rec.bytes.length) continue;
        source.filling.delete(rec); stream.delivered++; index++;
        if (rec.from === 0) source.store(rec.index, rec.bytes); else source.holed(rec);
        rec = null;
        // The end of the file, or of what was missing here.
        if (index >= source.blockCount() || source.blocks.has(index) || signal.aborted) { ended = true; break; }
        rec = {index, bytes: new Uint8Array(source.blockLength(index)), from: 0, filled: 0}; source.filling.add(rec);
      }
      source.arrived();
      if (ended) { stream.abort(); return; }
      // While the file is being described, a download stops a little past the last byte asked of it: where
      // playback will start is not known yet, and a paused connection still fills its window.
      if (stream.held && stream.at > stream.until + PROBE_MARGIN) { stream.abort(); return; }
    }
  } finally {
    source.streams.delete(stream);
    // What arrived of an unfinished block is kept, so the next download asks only for the rest.
    if (rec) { source.filling.delete(rec); keepPart(source, rec); }
  }
}

/** A download broke off: continue it, try again after a pause, quietly reopen read-ahead, or give up and fail the reads waiting. */
export async function streamFailed(source, stream, error) {
  if (stream.controller.signal.aborted || source.closed) return source.reschedule();
  // It brought a fair part of the file first (a host that cuts connections after so many bytes, or one that
  // answers in pieces): go on from where it stopped, at once and without counting a failure.
  if (stream.delivered || stream.received >= PIECE) { source.startStream(stream.at, null, stream.want); return source.reschedule(); }
  // A little came before the break (a browser drops what it had not handed over yet when a connection is cut):
  // that is still progress, continued after the shortest pause rather than counted.
  if (stream.received && source.servingWaiter(stream)) {
    await source.backOff(TIMING.backoff);
    if (!source.closed) source.startStream(stream.at, null, stream.want);
    return source.reschedule();
  }
  // Read-ahead nobody is waiting for that brought nothing: left for the read that needs it. No clock starts.
  if (!source.servingWaiter(stream)) return source.reschedule();
  source.url = source.given; // a signed address a redirect led to may have expired: the next try starts from the address given
  // A lost, stalled or empty answer is retried with a growing pause for up to a minute from the first failed try a
  // read was waiting on (at once when the phone is back online); reads wait meanwhile, so playback goes on from
  // what is buffered and resumes by itself.
  const refused = error instanceof SourceError && (error.kind === 'status' || error.kind === 'range');
  source.failures++;
  source.failingSince ||= Date.now();
  if (refused ? source.failures <= RETRIES : Date.now() - source.failingSince < TIMING.keepTrying) {
    // Just after data arrived (a host that cuts connections, of which some bring nothing) the pause stays short.
    const recent = Date.now() - source.progressAt < 10000;
    if (!refused && !recent) source.setState('reconnecting');
    await source.backOff(recent ? TIMING.backoff : Math.min(5000, TIMING.backoff * 2 ** (source.failures - 1)));
    if (!source.waiters.size) source.calm(); // playback moved to data it already has: nothing is being waited for
    return source.reschedule();
  }
  source.setState('lost');
  source.failures = 0; source.failingSince = 0; // a later read gets a minute of its own
  const failure = error instanceof SourceError ? error : new SourceError('network', 'The connection to the host dropped.', String(error?.message || error));
  // The host is lost: every read waiting on it ends with that, not only the ones this download served.
  for (const w of source.waiters) w.reject(failure);
  source.waiters.clear();
}
