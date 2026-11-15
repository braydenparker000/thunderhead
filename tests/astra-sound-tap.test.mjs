// Skip intro's sound tap on sound passed through as it is (frontend/astra/src/engine/sound-tap.js): WebCodecs is
// asked whether it can decode the sound before a decoder is started, and where it cannot (Dolby Digital and DTS on
// most phones) the tap ends for that film with one plain line in the log, never an error. A fake AudioDecoder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TapFeed } from '../frontend/astra/src/engine/sound-tap.js';

const made = [], asked = [];
let decodes = new Set();
class FakeDecoder {
  static async isConfigSupported(config) { asked.push(config.codec); return { supported: decodes.has(config.codec), config }; }
  constructor({ output, error }) { this.output = output; this.error = error; this.state = 'unconfigured'; this.decodeQueueSize = 0; this.chunks = []; made.push(this); }
  configure(config) { if (!decodes.has(config.codec)) throw new DOMException('Unsupported', 'NotSupportedError'); this.config = config; this.state = 'configured'; }
  decode(chunk) {
    this.chunks.push(chunk);
    this.output({ numberOfChannels: 2, numberOfFrames: 4, sampleRate: 48000, timestamp: chunk.timestamp, copyTo: (dest) => dest.fill(0.25), close() {} });
  }
  close() { this.state = 'closed'; }
}
class FakeChunk { constructor(o) { Object.assign(this, o); } }
const saved = {};
before(() => { for (const [k, v] of [['AudioDecoder', FakeDecoder], ['EncodedAudioChunk', FakeChunk]]) { saved[k] = globalThis[k]; globalThis[k] = v; } });
after(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } });

const track = (codec, id = 1) => ({ id, decoderConfig: { codec, numberOfChannels: 6, sampleRate: 48000 } });
const packet = (t) => ({ timestamp: t, duration: 0.032, data: new Uint8Array(8) });
const flush = () => new Promise((r) => setTimeout(r, 0));

function feed() {
  const fed = [], log = [];
  const f = new TapFeed({ wants: () => true, feed: (channels, rate, t) => fed.push(t) }, (l) => log.push(l)).forLoad(1);
  return { f, fed, log };
}

test('sound WebCodecs can decode: asked once, then decoded, the packets read while it answered included', async () => {
  decodes = new Set(['mp4a.40.2']); made.length = 0; asked.length = 0;
  const { f, fed, log } = feed();
  f.packet(packet(10), track('mp4a.40.2'), 0, '1:0');
  f.packet(packet(10.032), track('mp4a.40.2'), 0, '1:0');
  assert.equal(made.length, 0, 'no decoder before the answer');
  await flush();
  assert.equal(made.length, 1);
  assert.deepEqual(fed, [10, 10.032]);
  f.packet(packet(10.064), track('mp4a.40.2'), 0, '1:0');
  assert.equal(fed.length, 3);
  // A seek (a new pipeline) opens a decoder at once: the answer is known.
  f.packet(packet(50), track('mp4a.40.2'), 0, '1:1');
  assert.equal(made.length, 2);
  assert.equal(fed.at(-1), 50);
  assert.deepEqual(asked, ['mp4a.40.2']);
  assert.deepEqual(log, []);
  assert.equal(f.dead, false);
});

test('sound WebCodecs cannot decode (Dolby Digital passed through): one plain line, no decoder, no error, and the next film asks again from what is known', async () => {
  decodes = new Set(); made.length = 0; asked.length = 0;
  const { f, fed, log } = feed();
  f.packet(packet(10), track('ac-3'), 0, '1:0');
  f.packet(packet(10.032), track('ac-3'), 0, '1:0');
  await flush();
  assert.equal(made.length, 0, 'no decoder was started for it');
  assert.equal(f.dead, true);
  assert.deepEqual(fed, []);
  assert.deepEqual(log, ["Skip intro cannot hear this film's sound: this browser cannot decode Dolby Digital for it"]);
  f.packet(packet(11), track('ac-3'), 0, '1:0');
  assert.equal(log.length, 1, 'said once for the film');
  // The next film with the same sound ends at once, without asking WebCodecs again.
  f.forLoad(2);
  f.packet(packet(0), track('ac-3'), 0, '1:0');
  assert.equal(f.dead, true);
  assert.match(log.at(-1), /cannot hear this film's sound: .*Dolby Digital/);
  assert.equal(log.some((l) => /tapping ended/.test(l)), false, 'not reported as a failure');
  assert.deepEqual(asked, ['ac-3']);
  // A film whose sound it can decode is tapped again.
  decodes = new Set(['opus']);
  f.forLoad(3);
  f.packet(packet(0), track('opus', 2), 0, '2:0');
  await flush();
  assert.equal(f.dead, false);
  assert.deepEqual(fed, [0]);
});

test('an answer that comes after a seek or a new film serves only the pipeline that asked', async () => {
  decodes = new Set(['ec-3']); made.length = 0;
  const { f, fed } = feed();
  f.packet(packet(10), track('ec-3'), 0, '1:0');
  f.packet(packet(40), track('ec-3'), 0, '1:1'); // a seek before the answer: the later pipeline asks for itself
  await flush();
  assert.equal(made.length, 1, 'one decoder, for the pipeline now playing');
  assert.deepEqual(fed, [40]);
});
