// One download of Astra's range reader (http-source.js): an open-ended range
// request read into 1 MiB blocks, and what happens when it fails. A lost
// connection is tried again with a growing pause while a read waits for it;
// read-ahead nobody waits for is reopened once, quietly, or left closed.

export const BLOCK = 1 << 20;
export const READ_AHEAD = 24 * BLOCK; // a stream pauses this far past the furthest block read from it
export const PROBE_AHEAD = 2 * BLOCK; // ...and this far while the file is being described: where playback starts is not known yet
export const REUSE_WINDOW = 12 * BLOCK; // a request this close ahead of a stream waits for it
const RETRIES = 3; // for answers that will not change by asking again (a refused range)
const PIECE = 64 << 10; // an answer that ends early after at least this much is a piece of the file, not a failure
/** Waits in milliseconds; tests shorten them. */
export const TIMING = {
  open: 15000, // the host must start answering the first request within this
  stall: 20000, // a later request must be answered, and a stream must keep sending, within this
  keepTrying: 60000, // a lost connection is retried this long before reads fail
  backoff: 400, // the first pause before a retry; it doubles up to five seconds
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
  let index = Math.floor(stream.position / BLOCK), block = null, filled = 0;
  try {
    if (!response) {
      // A download that broke off inside this block left its first part: go on from where it stopped.
      const part = source.partial;
      if (part?.index === index && stream.position === index * BLOCK) { block = part.bytes; filled = part.filled; source.partial = null; }
      const from = stream.position + filled;
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
    block ??= new Uint8Array(source.blockLength(index));
    while (index < source.blockCount()) {
      // What comes next is already here (another download fetched it): nothing to add.
      if (!filled && source.blocks.has(index)) { stream.abort(); return; }
      // Stop reading (TCP backpressure) when far ahead of every reader.
      while ((index - stream.want) * BLOCK > (source.probing ? PROBE_AHEAD : READ_AHEAD) && !signal.aborted) await new Promise(r => { stream.wake = r; });
      if (signal.aborted) return;
      // A connection that goes quiet (no error, no bytes) would hang reads forever.
      let stall;
      const {done, value} = await Promise.race([reader.read(), new Promise((_, reject) => { stall = setTimeout(() => reject(new SourceError('stall', 'The host stopped sending.')), TIMING.stall); })])
        .catch(error => { reader.cancel().catch(() => {}); throw error; })
        .finally(() => clearTimeout(stall));
      // The answer ended before the file did.
      if (done) throw Object.assign(new SourceError('network', 'The host ended its answer early.'), {short: true});
      source.bytesFetched += value.length; stream.received += value.length;
      for (let offset = 0; offset < value.length;) {
        const n = Math.min(block.length - filled, value.length - offset);
        block.set(value.subarray(offset, offset + n), filled); filled += n; offset += n;
        if (filled < block.length) continue;
        const whole = block;
        stream.position = (index + 1) * BLOCK; stream.delivered++;
        filled = 0; block = null;
        source.store(index++, whole);
        // The end of the file, or of what was missing here.
        if (index >= source.blockCount() || source.blocks.has(index)) { stream.abort(); return; }
        block = new Uint8Array(source.blockLength(index));
      }
    }
  } finally {
    source.streams.delete(stream);
    if (block && filled && !source.closed) source.partial = {index, bytes: block, filled};
  }
}

/** A download broke off: try again, quietly reopen read-ahead, or give up and fail the reads waiting on it. */
export async function streamFailed(source, stream, error) {
  if (stream.controller.signal.aborted || source.closed) return source.reschedule();
  // An answer that stopped after a fair part of the file is a host that sends it in pieces: ask for the next
  // piece (what a piece left of an unfinished block is kept, so every piece counts). One that brought next to
  // nothing is a failure like any other, so a host that answers with nothing is not asked hundreds of times a second.
  if (error?.short && (stream.delivered || stream.received >= PIECE)) { source.startStream(stream.position, null, stream.want); return; }
  source.url = source.given; // a signed address a redirect led to may have expired: the next try starts from the address given
  if (![...source.waiters.keys()].some(i => source.servedBy(stream, i))) {
    // Read-ahead nobody is waiting for, usually a connection the host closed while it was paused: opened again
    // when it had been working, and otherwise left for the read that needs it. No clock starts and nothing is shown.
    if (stream.delivered) source.startStream(stream.position, null, stream.want);
    return source.reschedule();
  }
  // A lost or stalled connection is retried with a growing pause for up to a minute from the first failed try a
  // read was waiting on (at once when the phone is back online); reads wait meanwhile, so playback goes on from
  // what is buffered and resumes by itself.
  const refused = error instanceof SourceError && (error.kind === 'status' || error.kind === 'range');
  source.failures++;
  source.failingSince ||= Date.now();
  if (refused ? source.failures <= RETRIES : Date.now() - source.failingSince < TIMING.keepTrying) {
    if (!refused) source.setState('reconnecting');
    await source.backOff(Math.min(5000, TIMING.backoff * 2 ** (source.failures - 1)));
    if (!source.waiters.size) source.calm(); // playback moved to data it already has: nothing is being waited for
    return source.reschedule();
  }
  source.setState('lost');
  source.failures = 0; source.failingSince = 0; // a later read gets a minute of its own
  const failure = error instanceof SourceError ? error : new SourceError('network', 'The connection to the host dropped.', String(error?.message || error));
  for (const [i, list] of source.waiters) {
    if (i * BLOCK < stream.position) continue;
    source.waiters.delete(i);
    for (const w of list) w.reject(failure);
  }
}
