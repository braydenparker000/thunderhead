// Astra's early fragments (frontend/astra/src/engine/early.js): a video fragment is cut every half
// second at a frame shown after all before it, handed to the writer as a key frame, and written back
// as an ordinary frame when the fragment comes out. Packets and boxes here are invented. And the writer's mdat made
// in one array of its size (fragments.js), not grown from 1 KiB by doubling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EarlyCuts, demote, startsWithKey } from '../frontend/astra/src/engine/early.js';
import { fragmentWriter, sampleBytes } from '../frontend/astra/src/engine/fragments.js';
import * as MB from '../frontend/astra/vendor/mediabunny.js';

const packet = (timestamp, type = 'delta') => ({ timestamp, type, clone(over) { return { ...this, ...over, copy: true }; } });

/** A box: its size, its four letters, then what it holds. */
function box(name, ...parts) {
  const body = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(8 + body.reduce((n, p) => n + p.length, 0)), view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
  let at = 8;
  for (const p of body) { out.set(p, at); at += p.length; }
  return out;
}
const u32 = (...values) => { const b = new Uint8Array(values.length * 4), v = new DataView(b.buffer); values.forEach((x, i) => v.setUint32(i * 4, x)); return b; };
const KEY = 0x02000000, ORDINARY = 0x01010000;
/** A fragment whose track run gives only its first sample's flags (the writer's usual layout)... */
const fragment = (first) => box('moof', box('mfhd', u32(0, 1)), box('traf', box('tfhd', u32(0x020038, 1, 1000, 100, ORDINARY)), box('trun', u32(0x000b05, 2, 64, first, 1000, 500, 0, 1000, 400, 0))));
/** ...and one that gives every sample its own flags. */
const fragmentEach = (first) => box('moof', box('mfhd', u32(0, 1)), box('traf', box('tfhd', u32(0x020000, 1)), box('trun', u32(0x000f01, 2, 64, 1000, 500, first, 0, 1000, 400, ORDINARY, 0))));
const firstFlags = (moof, each) => new DataView(moof.buffer).getUint32(each ? moof.length - 24 : moof.length - 28);

test('a cut comes half a second after the last, at a frame shown after all before it', () => {
  const cuts = new EarlyCuts();
  // decode order with B-frames: I0 P3 b1 b2 P6 b4 b5 ... at 8 frames a second
  const shown = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8, 12, 10, 11], out = [];
  for (const [i, n] of shown.entries()) out.push(cuts.mark(packet(n / 8, i === 0 ? 'key' : 'delta')));
  const cutAt = out.filter((p) => p.copy).map((p) => p.timestamp * 8);
  assert.deepEqual(cutAt, [6, 12], 'cuts at the anchors 0.75 s and 1.5 s in, never at a frame shown before an earlier one');
  assert.ok(out.filter((p) => p.copy).every((p) => p.type === 'key'));
  assert.deepEqual(cuts.forced, [false, true, true]);
  assert.equal(out[1].copy, undefined, 'a frame within half a second of the key frame goes on as it is');
});

test('a real key frame begins a fragment of its own and restarts the half second', () => {
  const cuts = new EarlyCuts();
  const out = [packet(0, 'key'), packet(0.3), packet(0.6), packet(0.7, 'key'), packet(1.0), packet(1.3)].map((p) => cuts.mark(p));
  assert.deepEqual(out.map((p) => !!p.copy), [false, false, true, false, false, true]);
  assert.deepEqual(cuts.forced, [false, true, false, true]);
});

test('a pipeline that starts at a frame that is not a key frame is not given one', () => {
  const cuts = new EarlyCuts();
  assert.equal(cuts.mark(packet(5)).copy, undefined);
});

test('a fragment cut here comes out with its first frame written as an ordinary frame; the others are untouched', () => {
  const cuts = new EarlyCuts();
  for (const p of [packet(0, 'key'), packet(0.6), packet(1.2)]) cuts.mark(p);
  const real = cuts.settle(fragment(KEY)), early = cuts.settle(fragment(KEY)), early2 = cuts.settle(fragmentEach(KEY));
  assert.equal(firstFlags(real), KEY);
  assert.equal(startsWithKey(real), true);
  assert.equal(firstFlags(early), ORDINARY);
  assert.equal(startsWithKey(early), false);
  assert.equal(firstFlags(early2, true), ORDINARY);
  assert.equal(new DataView(early2.buffer).getUint32(early2.length - 8), ORDINARY, 'the second sample keeps its flags');
  assert.deepEqual(cuts.forced, []);
});

test('demote leaves sizes, durations and offsets alone', () => {
  const before = fragment(KEY), after = demote(fragment(KEY));
  const differing = [...before].map((b, i) => (b !== after[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(differing, [before.length - 28, before.length - 27], 'only the two flag bytes change');
});

test("each fragment's mdat comes in one array of its own size, as its moof's sample sizes say", async () => {
  const sent = [], queue = { append: (bytes) => sent.push(bytes) };
  const output = fragmentWriter(queue, { appended: 0 }, 'video', 0, new EarlyCuts());
  const source = new MB.EncodedVideoPacketSource('avc');
  output.addVideoTrack(source);
  await output.start();
  const config = { codec: 'avc1.64001f', codedWidth: 64, codedHeight: 64, description: new Uint8Array([1, 100, 0, 31, 255, 225, 0, 4, 103, 100, 0, 31, 1, 0, 4, 104, 238, 60, 128]) };
  for (let i = 0; i < 96; i++) await source.add(new MB.EncodedPacket(new Uint8Array(20_000 + i * 97), i % 24 ? 'delta' : 'key', i / 24, 1 / 24), i ? undefined : { decoderConfig: config });
  await output.finalize();
  const type = (b) => String.fromCharCode(...b.subarray(4, 8));
  const pairs = sent.slice(1).reduce((out, b) => (type(b) === 'moof' ? out.push([b]) : out.at(-1).push(b), out), []);
  assert.equal(pairs.length, 4, "a fragment for each key frame");
  for (const [moof, mdat] of pairs) {
    assert.equal(mdat.byteLength - 8, sampleBytes(moof), 'the moof says how large its mdat is');
    assert.ok(mdat.buffer.byteLength <= mdat.byteLength + 16, `made at its size (${mdat.buffer.byteLength} for ${mdat.byteLength})`);
  }
});

test('sound passed through goes in quarter-second fragments: a film cannot play at a new place before its first', async () => {
  const sent = [], queue = { append: (bytes, generation, at) => sent.push(at) };
  const output = fragmentWriter(queue, { appended: 0 }, 'audio', 0);
  const source = new MB.EncodedAudioPacketSource('aac');
  output.addAudioTrack(source);
  await output.start();
  const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description: new Uint8Array([0x11, 0x90]) };
  for (let i = 0; i < 94; i++) await source.add(new MB.EncodedPacket(new Uint8Array(300), 'key', i * 1024 / 48000, 1024 / 48000), i ? undefined : { decoderConfig: config });
  await output.finalize();
  const starts = [...new Set(sent.filter((at) => at != null))];
  assert.ok(starts.length >= 7, `about two seconds of sound in ${starts.length} fragments`);
  assert.ok(starts.every((at, i) => !i || at - starts[i - 1] < 0.3), starts.map((x) => x.toFixed(2)).join(' '));
});
