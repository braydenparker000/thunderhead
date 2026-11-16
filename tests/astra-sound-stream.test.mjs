// Rebuilt sound decoded from Astra's own Matroska reader's packets (sound-stream.js) against Mediabunny's own
// AudioSampleSink: on Dolby Digital 5.1 (surround.mkv), Dolby TrueHD (truehd.mkv) and DTS 5.1 (dts.mkv) the same
// samples (count, times, frames, every PCM value) from the start and from seeks, cluster starts among them; the first
// sample comes after a few blocks of a cluster, not the whole of it; and a track the reader does not read is left to
// Mediabunny. dts.mkv: scripts/astra/fixtures.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as MB from '../frontend/astra/vendor/mediabunny.js';
import { readLayout } from '../frontend/astra/src/engine/mkv.js';
import { mkvPackets } from '../frontend/astra/src/engine/mkv-packets.js';
import { ownSampleSink, usable } from '../frontend/astra/src/engine/sound-stream.js';
import { registerAc3Decoder } from '../frontend/astra/vendor/mediabunny-ac3.js';
import { registerDtsDecoder } from '../frontend/astra/vendor/mediabunny-dts.js';
import { registerTrueHdDecoder } from '../frontend/astra/vendor/mediabunny-truehd.js';

registerAc3Decoder(); registerDtsDecoder(); registerTrueHdDecoder();
const film = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/astra/${name}.mkv`, import.meta.url)));

async function open(name, onRead = () => {}) {
  const bytes = film(name);
  const read = async (s, e) => { onRead(s, e); return bytes.slice(s, Math.min(e, bytes.length)); };
  const reader = mkvPackets({ layout: await readLayout(read, bytes.length) }, read);
  const input = new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  return { reader, track, own: () => ownSampleSink(track, reader.sink({ id: track.id, type: 'audio', codec: track.codec, ref: track })) };
}

async function samples(sink, from) {
  const out = [];
  for await (const s of sink.samples(from)) {
    const pcm = new Float32Array(s.allocationSize({ planeIndex: 0, format: 'f32' }) / 4);
    s.copyTo(pcm, { planeIndex: 0, format: 'f32' });
    out.push({ t: s.timestamp, frames: s.numberOfFrames, channels: s.numberOfChannels, pcm });
    s.close();
  }
  return out;
}

test('the vendored Mediabunny has what sound-stream.js relies on', () => assert.ok(usable));

for (const [name, codec, channels, preRoll] of [['surround', 'ac3', 6, 256 / 48000], ['truehd', 'truehd', 2, 0], ['dts', 'dts', 6, 512 / 48000]]) {
  test(`${name}.mkv (${codec}): the same samples as Mediabunny's sink, from the start and from seeks`, async () => {
    const { reader, track, own } = await open(name);
    assert.equal(track.codec, codec);
    // The pre-roll Mediabunny (and so this path) decodes before a start: one AC-3 block, one DTS frame; TrueHD none,
    // but it starts at a major sync (a key packet: mkv-packets.js marks them).
    assert.ok(Math.abs(await track.getPreRollDuration() - preRoll) < 1e-9);
    const duration = await track.computeDuration();
    const cues = [...reader.layout.trackCues.values()][0].map((c) => c.ticks / 1000);
    for (const from of [0, 0.5, 1.37, duration / 2, ...cues, cues.at(-1) + 0.004, duration - 0.3]) {
      const a = await samples(new MB.AudioSampleSink(track), from), b = await samples(own(), from);
      assert.ok(a.length > 3, `${from}: Mediabunny gives ${a.length}`);
      assert.equal(b.length, a.length, `${from}: as many samples`);
      assert.equal(b[0].channels, channels);
      for (let i = 0; i < a.length; i++) {
        assert.ok(Math.abs(a[i].t - b[i].t) < 1 / 48000, `${from}: sample ${i} at ${b[i].t}, not ${a[i].t}`);
        assert.equal(b[i].frames, a[i].frames);
        assert.ok(a[i].pcm.every((x, k) => x === b[i].pcm[k]), `${from}: sample ${i}'s sound is the same`);
      }
    }
  });
}

test('the first sample comes after a few blocks of the first cluster, not the whole cluster', async () => {
  let reached = 0;
  const { reader, own } = await open('surround', (s, e) => { reached = Math.max(reached, e); });
  const [first, second] = [...reader.layout.trackCues.values()][0].map((c) => c.position);
  const sink = own();
  reached = 0;
  const it = sink.samples(0)[Symbol.asyncIterator]();
  const { value } = await it.next();
  value.close();
  await it.return();
  assert.ok(reached - first <= (second - first) / 2, `read ${reached - first} bytes of a ${second - first}-byte cluster`);
});

test('a track Astra\'s reader does not read, or no reader, is left to Mediabunny', async () => {
  const { track } = await open('surround');
  assert.equal(ownSampleSink(track, null), null);
  assert.equal(ownSampleSink({ codec: 'ac3' }, {}), null);
});

test('whole surround for Headphone surround (sound-six.js): FLAC frames ffmpeg decodes back to the same 16-bit sound', async (t) => {
  const { FlacFrames, codedNumber } = await import('../frontend/astra/src/engine/sound-six.js');
  // FLAC's coded sample numbers, as its specification writes them.
  assert.deepEqual(codedNumber(0x7f), [0x7f]);
  assert.deepEqual(codedNumber(0x80), [0xc2, 0x80]);
  assert.deepEqual(codedNumber(0x7ff), [0xdf, 0xbf]);
  assert.deepEqual(codedNumber(0x800), [0xe0, 0xa0, 0x80]);
  assert.deepEqual(codedNumber(2 ** 36 - 1), [0xfe, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf]);
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { return t.skip('ffmpeg is not installed'); }
  const frames = new FlacFrames(6, 48000), want = [];
  const parts = [frames.config.description];
  // Samples of uneven lengths (AC-3's 1536, DTS's 512, TrueHD's 40), the centre raised by 2 on the last.
  let at = 0;
  for (const [n, centre] of [[1536, 1], [512, 1], [40, 1], [1536, 2]]) {
    const planar = new Float32Array(6 * n);
    for (let c = 0; c < 6; c++) for (let i = 0; i < n; i++) planar[c * n + i] = 0.4 * Math.sin((c + 1) * (at + i) / 30);
    const sample = new MB.AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 6, sampleRate: 48000, timestamp: at / 48000 });
    for (const p of frames.packets(sample, centre)) parts.push(p.data);
    for (let i = 0; i < n; i++) for (let c = 0; c < 6; c++) want.push(Math.round(planar[c * n + i] * (c === 2 ? centre : 1) * 32767));
    sample.close(); at += n;
  }
  const flac = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
  const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-err_detect', 'crccheck+explode', '-f', 'flac', '-i', 'pipe:0', '-f', 's16le', 'pipe:1'], { input: flac });
  const got = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  assert.equal(got.length, want.length);
  assert.ok(want.every((v, i) => got[i] === Math.max(-32768, Math.min(32767, v))), 'every value the same');
});
