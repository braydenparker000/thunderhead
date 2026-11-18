// One download of Astra's range reader (http-source.js): an open-ended range
// request read into 1 MiB blocks (source-blocks.js), and what happens when it breaks off. A
// download that brought a fair part of the file before it broke (a host that
// cuts every connection after so many bytes) is simply continued from the
// byte it reached. One that brought next to nothing is a failure: tried again
// with a growing pause, for up to a minute from the first failed try a read
// was waiting on. Read-ahead nobody waits for is reopened quietly or left. An address that has died is
// renewed first, where the page gave a way to (source-renew.js).

import {BLOCK, keepPart, takePart, present} from './source-blocks.js';
import {renewed, dead} from './source-renew.js';

export {BLOCK};
export const READ_AHEAD = 24 * BLOCK; // a stream pauses at most this far past the furthest byte read from it (the source's readAhead; less with the data saver)
export const PROBE_AHEAD = 2 * BLOCK; // ...and this far while the file is being described, or before the film's bitrate is known
export const PROBE_MARGIN = 64 << 10; // while describing, a download stops this far past the last byte asked of it
export const REUSE_WINDOW = 12 * BLOCK; // the most a read ahead of a download waits for it, however fast it runs
export const GAP = 256 << 10; // a read this close past a download, or past a block's start, is reached by reading on, not by asking again
export const SOON = 1000; // a read further ahead waits for a download only when it will get there within this (ms)
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
  closing: 100, // a request broken off keeps its connection slot this long while it closes (source-gate.js)
  renew: 15000, // the page has this long to give a fresh address for a link that died (source-renew.js)
};

/**
 * How far ahead of a download a read waits for it rather than asking for its bytes itself: what the download
 * brings in SOON at the speed it has shown (bytes received over the time it has run, its pauses left out), at
 * least GAP (a read at or just past it always waits: the demuxer walking forward) and at most REUSE_WINDOW.
 * Waiting by bytes made a resume ten seconds in wait for megabytes the viewer skips on a slow link. While the
 * file is described reads stay close (GAP). A download younger than SOON that has not brought a piece yet has
 * no measure and is waited for, since a second request then would race it for the same link; the reads waiting
 * are weighed again as each block lands (store), by then on its measure. Older and still without one: GAP.
 */
export function soon(source, stream, now = Date.now()) {
  if (source.probing) return GAP;
  const ran = (stream.ran || 0) + (stream.paused || !stream.since ? 0 : now - stream.since);
  if (!(stream.received >= PIECE)) return ran < SOON ? REUSE_WINDOW : GAP;
  return Math.floor(Math.max(GAP, Math.min(REUSE_WINDOW, (stream.received / Math.max(ran, 1)) * SOON)));
}
/** A download pauses (true) or reads on (false): its running time, for its speed, leaves the pauses out. */
function pause(stream, on) {
  const now = Date.now();
  if (on && !stream.paused) stream.ran = (stream.ran || 0) + now - (stream.since || now);
  else if (!on && stream.paused) stream.since = now;
  stream.paused = on;
}

export class SourceError extends Error {
  constructor(kind, message, detail) { super(message); this.kind = kind; this.detail = detail; }
}

/** Parses "bytes 0-1023/4096" into {start, end, size}; size is null for "*". */
export function parseContentRange(value) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || '').trim());
  return m ? {start: +m[1], end: +m[2], size: m[3] === '*' ? null : +m[3]} : null;
}

/**
 * One request whose answer must begin within `ms` (its body may then take as long as it needs; the wait for
 * a free connection counts in `ms`). A host or a dead socket that never sends headers ends as a SourceError
 * of kind `late`. `kind` places it in the connection gate's queue (source-gate.js).
 */
export async function ask(source, headers, signal, ms, late, method = 'GET', kind = 'play') {
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), ms);
  try {
    return await source.request(headers, signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal, method, kind);
  } catch (error) {
    if (timeout.signal.aborted && !signal?.aborted) throw new SourceError(late, 'The host did not answer.');
    throw error;
  } finally { clearTimeout(timer); }
}

/**
 * Asks for bytes [from, to) of the file (to the end when `to` is the size) and checks the answer is that part of
 * that file. Resolves the answer and the end of what it will bring: a host that ignores a range's end sends to
 * the end of the file, and is then asked open-ended from here on (source.bounded false).
 */
async function request(source, stream, from, to) {
  const bounded = to < source.size && source.bounded !== false;
  const response = await ask(source, {Range: bounded ? `bytes=${from}-${to - 1}` : `bytes=${from}-`}, stream.controller.signal, TIMING.stall, 'stall');
  const range = parseContentRange(response.headers.get('content-range'));
  if (response.status !== 206 || (range && (range.start !== from || (range.size != null && range.size !== source.size)))) {
    response.body?.cancel().catch(() => {});
    if (response.status === 206) throw new SourceError('status', 'The host answered with another part of the file, or another file.');
    throw new SourceError(response.status === 200 ? 'range' : 'status', `The host answered ${response.status} to a range request.`, response.status);
  }
  if (response.url) source.url = response.url; // where a redirect led, for the requests that follow
  return finish(source, response, from, bounded ? to : source.size);
}

/** The end of what an answer from `from` brings: what its Content-Range says, else what was asked for. */
function finish(source, response, from, to) {
  const range = parseContentRange(response.headers.get('content-range'));
  const end = range ? Math.min(source.size, range.end + 1) : to;
  if (to < source.size && end > to) source.bounded = false;
  else if (to < source.size && end === to) source.bounded = true;
  return {response, end};
}

/**
 * Reads one download into the source's blocks until it ends, pauses for good or is closed. Rejects when it
 * breaks off. A download asks for what the reader wants and its reach, then for the next part once the reader
 * has come within half the reach of its end: a paused open-ended answer would go on filling the connection's
 * window (megabytes) with bytes a seek or a stop throws away. A host that ignores ranges' ends is read
 * open-ended and paused instead (TCP backpressure).
 */
export async function runStream(source, stream, response) {
  const signal = stream.controller.signal;
  let index = Math.floor(stream.at / BLOCK), rec = null, reader = null;
  // Where a download may read to now: a little past the last byte asked while the file is described, else the reach.
  const limit = () => Math.floor(Math.min(source.size, stream.held ? stream.until + PROBE_MARGIN : stream.want + source.reach()));
  const open = async answer => {
    stream.end = answer.end; stream.lastAt = Date.now(); reader = answer.response.body.getReader();
    const r = reader; signal.addEventListener('abort', () => r.cancel().catch(() => {}), {once: true});
  };
  try {
    if (!response) {
      // A download that broke off inside this block left its first part: go on from the byte it reached.
      rec = takePart(source, index, stream.at);
      if (rec) { stream.at = index * BLOCK + rec.filled; source.filling.add(rec); }
      await open(await request(source, stream, stream.at, Math.max(limit(), Math.min(source.size, stream.at + PIECE))));
    } else await open(finish(source, response, stream.at, source.size));
    if (!rec) { const off = stream.at - index * BLOCK; rec = {index, bytes: new Uint8Array(source.blockLength(index)), from: off, filled: off}; source.filling.add(rec); }
    while (index < source.blockCount()) {
      // What comes next is already here (another download fetched it): nothing to add.
      if (rec.filled === rec.from && source.blocks.has(index)) { stream.abort(); return; }
      if (stream.at >= stream.end) {
        // All that was asked for came: the next part is asked for once the reader wants half a reach more.
        pause(stream, true);
        while (limit() - stream.at < Math.min(source.reach() / 2, source.size - stream.at) && !(stream.held && limit() > stream.at) && !signal.aborted) await new Promise(r => { stream.wake = r; });
        pause(stream, false);
        if (signal.aborted) return;
        // Bytes here already (the film's end, asked for beside its start; what another download brought) are not
        // asked for again: the next part stops where they begin, and a download that would bring none of its own ends.
        const to = present(source, stream.at, limit());
        if (to <= stream.at) { stream.abort(); return; }
        await open(await request(source, stream, stream.at, to));
      } else if (stream.at - stream.want > source.reach()) {
        // Far ahead of every reader on an open-ended answer: asked again in parts where the host allows it, else paused.
        if (source.bounded !== false) { reader.cancel().catch(() => {}); stream.end = stream.at; continue; }
        pause(stream, true);
        while (stream.at - stream.want > source.reach() && !signal.aborted) await new Promise(r => { stream.wake = r; });
        pause(stream, false);
        if (signal.aborted) return;
      }
      // A connection that goes quiet (no error, no bytes) would hang reads forever.
      let stall;
      const {done, value} = await Promise.race([reader.read(), new Promise((_, reject) => { stall = setTimeout(() => reject(new SourceError('stall', 'The host stopped sending.')), TIMING.stall); })])
        .catch(error => { reader.cancel().catch(() => {}); throw error; })
        .finally(() => clearTimeout(stall));
      if (done && stream.at >= stream.end) continue;
      // The answer ended before the part asked for did.
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
      // While the file is being described, an open-ended download stops a little past the last byte asked of
      // it: where playback will start is not known yet, and a paused connection still fills its window.
      if (stream.held && stream.end >= source.size && stream.at > stream.until + PROBE_MARGIN) { stream.abort(); return; }
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
  // The address itself has died (a refused connection only once it is refused again): with a fresh one from the
  // page, the download goes on from where it was, nothing counted and nothing shown (source-renew.js).
  const gone = dead(error);
  if (gone && (gone === 'status' || source.failures) && await renewed(source)) {
    if (!source.closed) { source.calm(); if (source.servingWaiter(stream)) source.startStream(stream.at, null, stream.want); }
    return source.reschedule();
  }
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
