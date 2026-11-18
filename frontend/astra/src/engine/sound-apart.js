// The page's side of converted sound decoded and encoded in a worker (sound-worker.js): one worker for the page,
// started the first time a film's sound needs converting (or its decoder is fetched ahead, audio-decoders.js) and
// kept for later films. Here only the reading stays: the track's packets from Astra's own Matroska reader, held to the
// same read-ahead as before (session.room, and for whole surround sixRoom, through `gate`), posted in batches of a
// quarter second (or after 30 ms, when reading pauses) as one buffer handed over; what comes back is appended to the
// audio buffer as it is. The worker is kept at most LAG seconds of sound behind the reading, so a phone too slow to
// convert in time holds the reading back rather than piling packets up there, and the same when what it sent back
// waits to be appended (QUEUED).
//
// A worker that cannot start or fails (and a conversion it cannot do) is answered by the caller with the page's own
// way (remux-audio.js); a decoder that cannot be downloaded fails as {kind: 'network'}, as it does on the page.

// on: off, converted sound is decoded on the page's thread (tests compare the two). fragment: seconds of sound in each
// MP4 fragment at least. The picture cannot start after a seek until the sound's first fragment is in, so it is a quarter
// of a second rather than the second the page's writer uses (fragments.js): measured on a 25 Mbit/s film from a
// 40 Mbit/s host, picture and sound came back about 0.5 s sooner after a far seek.
export const APART = {on: true, fragment: 0.25};
// QUEUED: bytes the worker's fragments may wait to be appended. Whole surround (576 kB a second) came back from the worker
// faster than a slowed page appended it: up to 6.5 MB waited, beside an audio buffer the browser holds to about 12 MB;
// so it is also kept within a second of the reading (lag).
const LAG = 6, QUEUED = 2 << 20, BATCH = 0.25, PAUSE = 30;
let worker = null, broken = false, ids = 0;
const pipes = new Map(), loads = new Map();

/** True when converted sound can go to the worker here. */
export const apartUsable = () => APART.on && !broken && typeof Worker === 'function';

function theWorker() {
  if (worker || !apartUsable()) return worker;
  try { worker = new Worker(new URL('./sound-worker.js', import.meta.url), {type: 'module'}); } catch { broken = true; return null; }
  worker.onmessage = ({data: m}) => {
    if (m.type === 'loaded' || m.type === 'loadfail') return void loads.get(m.codec)?.settle(m);
    const pipe = pipes.get(m.id);
    if (!pipe) return;
    if (m.type === 'bytes') { pipe.session.stats.appended += m.bytes.byteLength; pipe.session.queues.audio?.append(m.bytes, pipe.generation); }
    else if (m.type === 'tap') tapped(pipe.session, m);
    else if (m.type === 'done') pipe.done = true;
    else if (m.type === 'error') pipe.error = Object.assign(new Error(m.message), m.kind ? {kind: m.kind, detail: m.detail} : {});
    if (m.upTo != null) pipe.upTo = m.upTo;
    pipe.wake?.();
  };
  // A worker that will not load or has died: everything waiting on it is told, and the page converts from here on.
  worker.onerror = event => {
    event.preventDefault?.();
    broken = true; worker = null;
    for (const pipe of pipes.values()) { pipe.error = new Error('The sound worker stopped.'); pipe.wake?.(); }
    for (const [codec, load] of loads) load.settle({type: 'gone'}), loads.delete(codec);
  };
  return worker;
}

/** Fetches a codec's decoder into the worker ahead of need; rejects as {kind: 'network'} when it cannot be downloaded. */
export function warmApart(codec) {
  const w = theWorker();
  if (!w) return Promise.reject(Error('no sound worker'));
  if (loads.has(codec)) return loads.get(codec).promise;
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = m => {
      if (m.type === 'loaded') return resolve();
      loads.delete(codec);
      reject(m.type === 'gone' ? Error('The sound worker stopped.') : Object.assign(new Error('The audio converter could not be downloaded.'), {kind: 'network', detail: m.detail}));
    };
  });
  loads.set(codec, {promise, settle});
  w.postMessage({type: 'load', codec});
  return promise;
}

/** Hands the sound tap what the worker sent back for it, as the decoded sample it would have been given. */
function tapped(session, {timestamp, rate, planes}) {
  const n = planes[0]?.length || 0;
  session.tap?.samples({timestamp, numberOfFrames: n, numberOfChannels: planes.length, sampleRate: rate, duration: n / rate, copyTo: (to, {planeIndex}) => to.set(planes[planeIndex])}, session.offset);
}

/** The packet Mediabunny's sample reader would start from for `from`: one pre-roll back, for TrueHD at a major sync. */
async function firstPacket(sink, codec, from, preRoll) {
  const alone = codec !== 'truehd', at = await sink.getPacket(from), t = (at?.timestamp ?? from) - preRoll;
  let p = alone ? await sink.getPacket(t) : await sink.getKeyPacket(t, {verifyKeyPackets: true});
  if (p) return p;
  p = await sink.getFirstPacket();
  for (let guard = 0; p && p.type !== 'key' && guard < 4096; guard++) p = await sink.getNextPacket(p);
  return p?.type === 'key' ? p : null;
}

/**
 * Converts `track` (a Mediabunny InputAudioTrack read by `sink`, a mkv-sink.js TrackSink) from `from` (file time) in the
 * worker into the session's audio buffer for `generation`. `gate(timestamp)` holds the reading (false: replaced);
 * `live()` says the pipeline is still wanted. Resolves true once all is written, false when it was replaced.
 */
export async function convertApart(session, {generation, from, sink, track, channels, whole, gate, live}) {
  const w = theWorker();
  if (!w) throw Error('The sound worker could not start.');
  const codec = track.codec, config = await track.getDecoderConfig(), preRoll = await track.getPreRollDuration();
  const first = await firstPacket(sink, codec, from, preRoll);
  if (!live()) return false;
  const id = ++ids, pipe = {session, generation, upTo: first?.timestamp ?? from, done: false, error: null, wake: null};
  const nap = ms => new Promise(resolve => { const done = () => { clearTimeout(timer); pipe.wake = null; resolve(); }; const timer = setTimeout(done, ms); pipe.wake = done; });
  pipes.set(id, pipe);
  w.postMessage({type: 'start', id, codec, config, from, whole: !!whole, channels, rate: track.sampleRate, centre: session.centre ?? 1, fragment: APART.fragment});
  let batch = [], timer = 0, sent = 0, finished = false;
  const lag = whole ? 1 : LAG; // whole surround is ten times the bytes, and cheap to write: kept close
  const flush = () => {
    clearTimeout(timer); timer = 0;
    if (!batch.length) return;
    const buf = new Uint8Array(batch.reduce((n, p) => n + p.data.byteLength, 0)), items = [];
    let at = 0;
    for (const p of batch) { buf.set(p.data, at); items.push([at, p.data.byteLength, p.timestamp, p.duration, p.type === 'key' ? 1 : 0, p.sequenceNumber]); at += p.data.byteLength; }
    const t0 = batch[0].timestamp, t1 = batch.at(-1).timestamp + batch.at(-1).duration;
    const tap = session.tap?.wants?.(t0 - session.offset, t1 - t0) ? [t0, t1] : null;
    w.postMessage({type: 'packets', id, buf: buf.buffer, items, tap, centre: session.centre ?? 1}, [buf.buffer]);
    sent = t1; batch = [];
  };
  try {
    for (let p = first; p; p = await sink.getNextPacket(p)) {
      if (pipe.error) throw pipe.error;
      if (!live() || !await gate(p.timestamp)) return false;
      batch.push(p);
      if (p.timestamp + p.duration - batch[0].timestamp >= BATCH) flush(); else timer ||= setTimeout(flush, PAUSE);
      while ((sent - pipe.upTo > lag || session.queues.audio.pending() > QUEUED) && !pipe.error && !pipe.done) { await nap(250); if (!live() || !await gate(p.timestamp)) return false; }
    }
    flush();
    w.postMessage({type: 'end', id});
    while (!pipe.done && !pipe.error) { await nap(250); if (!live()) return false; }
    if (pipe.error) throw pipe.error;
    return finished = true;
  } finally {
    clearTimeout(timer);
    pipes.delete(id);
    if (!finished && !pipe.error) w.postMessage({type: 'stop', id});
  }
}
