// Converted sound decoded, mixed and encoded in a worker of its own, off the page's thread (sound-apart.js is the
// page's side). The page reads the track's packets with Astra's own Matroska reader as before and posts them here in
// batches, the bytes handed over rather than copied again; this worker decodes them with Mediabunny and its AC-3, DTS
// or TrueHD decoder (whose WebAssembly runs in a worker of the decoder's own, as on the page), mixes to stereo and
// encodes Opus, or keeps surround whole as FLAC (sound-write.js), writes fragmented MP4 as fragments.js does (each
// fragment `fragment` seconds at least: sound-apart.js) and posts each init segment and fragment back, handed over
// too. On the page, all this took about 110 ms of its thread for each second of TrueHD sound, 20 for Dolby Digital
// Plus and 30 for DTS (a 3-minute 1080p film, desktop Chromium; frontend/astra/README.md, Converted sound).
//
// The decoding is Mediabunny's own sample reader, as sound-stream.js uses it on the page: the same pre-roll, the same
// dropping of what comes before the start and the same timestamps. The page picks the first packet (a pre-roll before
// the start, a TrueHD major sync) exactly as that reader would, and the packets it posts are what the reader is
// answered with here. Mediabunny 1.66 asks a track only for its codec and decoder configuration when it decodes, so a
// stand-in track carries the two (the configuration as the page's track gave it).
//
// Messages in: load {codec}; start {id, codec, config, from, whole, channels, rate, centre, fragment}; packets {id,
// buf, items, tap, centre}; end {id}; stop {id}. Out: loaded / loadfail {codec}; bytes {id, bytes, upTo}; progress
// {id, upTo}; tap {id, timestamp, rate, planes}; done {id}; error {id, message, kind}. A fragment's bytes carry `at`, where it begins.

import * as MB from '../../vendor/mediabunny.js';
import {stereoWriter, wholeWriter} from './sound-write.js';
import {sized} from './fragments.js';

const FILES = {ac3: ['mediabunny-ac3.js', 'registerAc3Decoder'], dts: ['mediabunny-dts.js', 'registerDtsDecoder'], truehd: ['mediabunny-truehd.js', 'registerTrueHdDecoder']};
const family = codec => codec === 'dts' ? 'dts' : codec === 'truehd' ? 'truehd' : codec === 'ac3' || codec === 'eac3' ? 'ac3' : null;
const loaded = {}, pipes = new Map();
const post = (message, transfer = []) => self.postMessage(message, transfer);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Loads the decoder a codec needs, tried three times as on the page (audio-decoders.js); fails as {kind: 'network'}. */
function load(codec) {
  const wanted = family(codec);
  if (!wanted) return Promise.resolve();
  return loaded[wanted] ??= (async () => {
    const [file, register] = FILES[wanted];
    for (let attempt = 0; ; attempt++) {
      try { return (await import(`../../vendor/${file}${attempt ? `?retry=${Date.now()}` : ''}`))[register](); } catch (error) {
        if (attempt >= 2) throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  })().catch(error => {
    delete loaded[wanted];
    throw Object.assign(new Error('The audio converter could not be downloaded.'), {kind: 'network', detail: String(error?.message || error)});
  });
}

/** The packets posted for one pipeline, answering what Mediabunny's sample reader asks of a packet sink. */
class Feed {
  constructor() { this.queue = []; this.head = 0; this.ended = false; this.wake = null; }
  push(packets) { for (const p of packets) this.queue.push(p); this.wake?.(); }
  end() { this.ended = true; this.wake?.(); }
  async ready() { while (this.head >= this.queue.length && !this.ended) await new Promise(resolve => { this.wake = resolve; }); }
  // The page sent the first packet the reader would start from, so every start the reader looks for is that one.
  async getPacket() { await this.ready(); return this.queue[this.head] ?? null; }
  getKeyPacket() { return this.getPacket(); }
  getFirstKeyPacket() { return this.getPacket(); }
  async *packets() {
    for (;;) {
      await this.ready();
      if (this.head >= this.queue.length) return;
      yield this.queue[this.head++];
      if (this.head >= 4096) { this.queue = this.queue.slice(this.head); this.head = 0; } // TrueHD: 1,200 packets a second
    }
  }
}

class FedSink extends MB.AudioSampleSink {
  constructor(track, feed) { super(track); this.feed = feed; }
  _createPacketSink() { return this.feed; }
  async _getPreRollDuration() { return 0; }
}

/** A stand-in for the page's track: what Mediabunny asks of one to decode it. */
const fedTrack = (codec, config) => Object.create(MB.InputAudioTrack.prototype, {
  input: {value: {_disposed: false}},
  canDecode: {value: async () => true},
  getCodec: {value: async () => codec},
  getDecoderConfig: {value: async () => config},
});

async function start(m) {
  const pipe = {id: m.id, feed: new Feed(), centre: m.centre ?? 1, taps: [], stopped: false, upTo: 0, told: 0, samples: null};
  pipes.set(m.id, pipe);
  try {
    await load(m.codec);
    if (pipe.stopped) return;
    const output = writer(m.fragment, (bytes, at) => post({type: 'bytes', id: m.id, bytes, upTo: pipe.upTo, at}, [bytes.buffer]));
    const write = m.whole ? wholeWriter(output, m.channels, m.rate) : stereoWriter(output, m.rate);
    await output.start();
    pipe.samples = new FedSink(fedTrack(m.codec, m.config), pipe.feed).samples(m.from);
    for await (const sample of pipe.samples) {
      if (pipe.stopped) { sample.close(); break; }
      if (pipe.taps.length) tap(pipe, sample);
      // An MP4's first sample can start a few milliseconds before zero, which the writer refuses.
      if (sample.timestamp >= 0) await write(sample, pipe.centre);
      pipe.upTo = sample.timestamp + sample.duration;
      sample.close();
      if (pipe.upTo - pipe.told >= 0.25) { pipe.told = pipe.upTo; post({type: 'progress', id: m.id, upTo: pipe.upTo}); }
    }
    if (pipe.stopped) { await output.cancel().catch(() => {}); return; }
    await output.finalize();
    post({type: 'done', id: m.id});
  } catch (error) {
    if (!pipe.stopped) post({type: 'error', id: m.id, message: String(error?.message || error).slice(0, 200), kind: error?.kind, detail: error?.detail});
  } finally { pipes.delete(m.id); }
}

/** Fragmented MP4 as fragments.js writes it for the page, each init segment and fragment one buffer, cut every `fragment` s at least. */
function writer(fragment, send) {
  let head = [], moof = null, at = null; // at: where the fragment begins
  const join = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.byteLength; } return out; };
  const format = new MB.Mp4OutputFormat({
    fastStart: 'fragmented', minimumFragmentDuration: fragment ?? 1,
    onFtyp: data => { head.push(data.slice()); },
    onMoov: data => { head.push(data.slice()); send(join(head)); head = []; },
    onMoof: (data, position, timestamp) => { moof = data.slice(); at = timestamp; sized(output, moof); }, // the mdat's array made at its size
    onMdat: data => { send(join([moof, data]), at); moof = null; },
  });
  const output = new MB.Output({format, target: new MB.NullTarget()});
  return output;
}

/** Decoded sound the page's sound tap asked for (sound-tap.js), sent back as planes. */
function tap(pipe, sample) {
  const t0 = sample.timestamp, t1 = t0 + sample.duration;
  while (pipe.taps.length && pipe.taps[0][1] < t0 - 1) pipe.taps.shift();
  if (!pipe.taps.some(([a, b]) => a < t1 && b > t0)) return;
  const planes = [];
  for (let c = 0; c < sample.numberOfChannels; c++) {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, {planeIndex: c, format: 'f32-planar'});
    planes.push(plane);
  }
  post({type: 'tap', id: pipe.id, timestamp: t0, rate: sample.sampleRate, planes}, planes.map(p => p.buffer));
}

self.onmessage = ({data: m}) => {
  if (m.type === 'load') return void load(m.codec).then(() => post({type: 'loaded', codec: m.codec}), error => post({type: 'loadfail', codec: m.codec, detail: error.detail}));
  if (m.type === 'start') return void start(m);
  const pipe = pipes.get(m.id);
  if (!pipe) return;
  if (m.type === 'packets') {
    pipe.centre = m.centre ?? pipe.centre;
    if (m.tap) { const last = pipe.taps.at(-1); if (last && m.tap[0] <= last[1] + 0.05) last[1] = Math.max(last[1], m.tap[1]); else pipe.taps.push(m.tap); }
    pipe.feed.push(m.items.map(([at, size, timestamp, duration, key, sequence]) => new MB.EncodedPacket(new Uint8Array(m.buf, at, size), key ? 'key' : 'delta', timestamp, duration, sequence)));
  } else if (m.type === 'end') pipe.feed.end();
  else if (m.type === 'stop') { pipe.stopped = true; pipe.feed.end(); pipe.samples?.return?.().catch(() => {}); }
};
