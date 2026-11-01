// Music's streaming path, the WebM writer (frontend/th/music/stream/webm.js; MUSIC.md §5): its
// output read back by an EBML reader written here from RFC 8794 and the Matroska element table
// (RFC 9559), not by the writer's own code. The init segment's header, Segment of unknown size, Info
// and Opus track; Clusters of SimpleBlocks with relative times; the last packet's DiscardPadding in a
// BlockGroup; sizes in their shortest form and every element exactly as long as it says. Node only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cluster, init, samplesToNs, vint } from '../frontend/th/music/stream/webm.js';
import { headForMse } from '../frontend/th/music/stream/plan.js';
import { TONE, tonePackets } from './fixtures/ogg-make.mjs';

const MASTER = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe1, 0x1f43b675, 0xa0]);

/** An EBML variable-size integer at `at`: its value, its length, and whether it is the reserved "unknown". */
function readVint(b, at, isId) {
  const first = b[at];
  let len = 1;
  while (len <= 8 && !(first & (0x100 >> len))) len++;
  if (len > 8) throw new Error(`bad vint at ${at}`);
  let v = isId ? first : first & ((0x100 >> len) - 1);
  let ones = v === (0x100 >> len) - 1;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[at + i];
    ones &&= b[at + i] === 0xff;
  }
  return { v, len, unknown: !isId && ones };
}

/** The shortest vint length that holds `v` (all-ones is reserved). */
const shortest = (v) => {
  for (let n = 1; n <= 8; n++) if (v < 2 ** (7 * n) - 1) return n;
  return 9;
};

/** Elements of `b[from, to)`, masters read into their children; every size must fit its parent exactly. */
function parse(b, from = 0, to = b.length) {
  const out = [];
  let at = from;
  while (at < to) {
    const id = readVint(b, at, true);
    const size = readVint(b, at + id.len, false);
    const start = at + id.len + size.len;
    const end = size.unknown ? to : start + size.v;
    assert.ok(end <= to, `element 0x${id.v.toString(16)} runs past its parent`);
    if (!size.unknown) assert.equal(size.len, shortest(size.v), `size of 0x${id.v.toString(16)} in its shortest form`);
    const el = { id: id.v, unknown: size.unknown, sizeBytes: b.subarray(at + id.len, start), data: b.subarray(start, end), children: MASTER.has(id.v) ? parse(b, start, end) : null };
    out.push(el);
    at = end;
  }
  assert.equal(at, to, 'elements fill their parent exactly');
  return out;
}

const one = (els, id) => {
  const found = els.filter((e) => e.id === id);
  assert.equal(found.length, 1, `exactly one 0x${id.toString(16)}`);
  return found[0];
};
const uint = (e) => e.data.reduce((n, x) => n * 256 + x, 0);
const sint = (e) => Number(BigInt.asIntN(8 * e.data.length, BigInt('0x' + Buffer.from(e.data).toString('hex'))));
const str = (e) => new TextDecoder().decode(e.data);
const float = (e) => (e.data.length === 8 ? new DataView(e.data.buffer, e.data.byteOffset).getFloat64(0) : new DataView(e.data.buffer, e.data.byteOffset).getFloat32(0));

test('EBML sizes: shortest form, the all-ones value kept for "unknown"', () => {
  assert.deepEqual([...vint(0)], [0x80]);
  assert.deepEqual([...vint(126)], [0xfe]);
  assert.deepEqual([...vint(127)], [0x40, 0x7f], '127 in one byte would read as unknown');
  assert.deepEqual([...vint(16382)], [0x7f, 0xfe]);
  assert.deepEqual([...vint(16383)], [0x20, 0x3f, 0xff]);
  assert.deepEqual([...vint(2 ** 35)], [0x04, 0x08, 0, 0, 0, 0], 'six bytes: marker 0x04, then 2^35');
  for (const v of [0, 1, 126, 127, 128, 16382, 16383, 2 ** 21 - 2, 2 ** 21 - 1, 123456789]) {
    const r = readVint(vint(v), 0, false);
    assert.deepEqual([r.v, r.len, r.unknown], [v, shortest(v), false]);
  }
  assert.throws(() => vint(-1), RangeError);
});

test('the init segment: EBML header (webm), a Segment of unknown size, Info at 1 ms, one A_OPUS track', () => {
  const { head } = tonePackets();
  const bytes = init({ opusHead: head, channels: 2 });
  const top = parse(bytes);
  assert.deepEqual(top.map((e) => e.id), [0x1a45dfa3, 0x18538067]);
  const ebml = top[0].children;
  assert.deepEqual([0x4286, 0x42f7, 0x42f2, 0x42f3].map((id) => uint(one(ebml, id))), [1, 1, 4, 8]);
  assert.equal(str(one(ebml, 0x4282)), 'webm');
  assert.equal(uint(one(ebml, 0x4287)), 4, 'DocTypeVersion 4: CodecDelay, SeekPreRoll and DiscardPadding are WebM v4');
  assert.equal(uint(one(ebml, 0x4285)), 2);
  const segment = top[1];
  assert.ok(segment.unknown);
  assert.deepEqual([...segment.sizeBytes], [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  assert.deepEqual(segment.children.map((e) => e.id), [0x1549a966, 0x1654ae6b], 'Info then Tracks; no Cues or Duration in a stream');
  const info = segment.children[0].children;
  assert.equal(uint(one(info, 0x2ad7b1)), 1_000_000);
  assert.ok(str(one(info, 0x4d80)) && str(one(info, 0x5741)), 'MuxingApp and WritingApp (mandatory)');
  const entry = one(one(segment.children, 0x1654ae6b).children, 0xae).children;
  assert.equal(uint(one(entry, 0xd7)), 1, 'TrackNumber');
  assert.ok(uint(one(entry, 0x73c5)) > 0, 'TrackUID');
  assert.equal(uint(one(entry, 0x83)), 2, 'TrackType audio');
  assert.equal(uint(one(entry, 0x9c)), 0, 'FlagLacing off');
  assert.equal(str(one(entry, 0x86)), 'A_OPUS');
  assert.deepEqual(one(entry, 0x63a2).data, head.bytes, 'CodecPrivate is the OpusHead');
  assert.equal(uint(one(entry, 0x56aa)), 6_500_000, 'CodecDelay: 312 samples of pre-skip in ns');
  assert.equal(uint(one(entry, 0x56bb)), 80_000_000, 'SeekPreRoll 80 ms');
  const audio = one(entry, 0xe1).children;
  assert.equal(float(one(audio, 0xb5)), 48000);
  assert.equal(uint(one(audio, 0x9f)), 2);
  // The feeder's head: pre-skip 0 in CodecPrivate, so CodecDelay 0 (feed.js trims with the append window).
  const mse = parse(init({ opusHead: headForMse(head) }));
  const mseEntry = one(one(mse[1].children, 0x1654ae6b).children, 0xae).children;
  assert.equal(uint(one(mseEntry, 0x56aa)), 0);
  assert.deepEqual([...one(mseEntry, 0x63a2).data.subarray(10, 12)], [0, 0]);
  assert.deepEqual(one(mseEntry, 0x63a2).data.subarray(12), head.bytes.subarray(12));
});

test('a Cluster: its time, SimpleBlocks of track 1 with times relative to it, keyframes, packets unchanged', () => {
  const { packets } = tonePackets();
  const some = packets.slice(10, 60);
  const startNs = samplesToNs(some[0].start);
  const c = parse(cluster(some, startNs));
  assert.equal(c.length, 1);
  assert.equal(c[0].id, 0x1f43b675);
  const [time, ...blocks] = c[0].children;
  assert.equal(time.id, 0xe7);
  assert.equal(uint(time), 200, '10 packets of 20 ms in');
  assert.equal(blocks.length, 50);
  for (const [i, b] of blocks.entries()) {
    assert.equal(b.id, 0xa3);
    assert.equal(b.data[0], 0x81, 'track 1 as a one-byte vint');
    assert.equal(new DataView(b.data.buffer, b.data.byteOffset).getInt16(1), i * 20);
    assert.equal(b.data[3], 0x80, 'keyframe, no lacing');
    assert.deepEqual(b.data.subarray(4), some[i].data);
  }
  // Times off the millisecond grid round to the nearest tick, each from the cluster's start.
  const odd = parse(cluster([{ data: some[0].data, samples: 120 }, { data: some[1].data, samples: 120 }, { data: some[2].data, samples: 120 }], 1_234_567))[0].children;
  // At 1.234567, 3.734567 and 6.234567 ms: ticks 1, 4 and 6, so 0, 3 and 5 after the cluster's 1.
  assert.equal(uint(odd[0]), 1);
  assert.deepEqual(odd.slice(1).map((b) => new DataView(b.data.buffer, b.data.byteOffset).getInt16(1)), [0, 3, 5]);
  assert.throws(() => cluster(packets.map((p) => ({ ...p, samples: 48000 })), 0), RangeError, 'a cluster past 32.767 s');
});

test('the song’s last packet carries its end padding as DiscardPadding (ns) inside a BlockGroup', () => {
  const { packets } = tonePackets();
  const tail = packets.slice(-3);
  const c = parse(cluster(tail, samplesToNs(tail[0].start)))[0].children;
  assert.deepEqual(c.map((e) => e.id), [0xe7, 0xa3, 0xa3, 0xa0]);
  const group = c[3].children;
  assert.deepEqual(group.map((e) => e.id), [0xa1, 0x75a2]);
  const block = group[0].data;
  assert.equal(block[0], 0x81);
  assert.equal(new DataView(block.buffer, block.byteOffset).getInt16(1), 40);
  assert.equal(block[3], 0, 'a Block has no keyframe flag');
  assert.deepEqual(block.subarray(4), tail[2].data);
  assert.equal(sint(group[1]), 13_500_000, '648 samples at 48 kHz');
  assert.equal(sint(parse(cluster([{ data: tail[0].data, samples: 960, discard: 1 }], 0))[0].children[1].children[1]), 20_833);
});

test('round trip: the fixture as init + Clusters reads back as the same packets at the same times', () => {
  const { head, packets } = tonePackets();
  const parts = [init({ opusHead: head })];
  for (let i = 0; i < packets.length; i += 40) parts.push(cluster(packets.slice(i, i + 40), samplesToNs(packets[i].start)));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) all.set(p, (o += p.length) - p.length);
  const top = parse(all);
  const clusters = top[1].children.filter((e) => e.id === 0x1f43b675);
  assert.equal(clusters.length, Math.ceil(packets.length / 40));
  const out = [];
  for (const c of clusters) {
    const base = uint(c.children[0]);
    for (const b of c.children.slice(1)) {
      const data = b.id === 0xa0 ? b.children[0].data : b.data;
      out.push({ ms: base + new DataView(data.buffer, data.byteOffset).getInt16(1), data: data.subarray(4), discard: b.id === 0xa0 ? sint(b.children[1]) : 0 });
    }
  }
  assert.equal(out.length, packets.length);
  for (const [i, p] of packets.entries()) {
    assert.equal(out[i].ms, (p.start * 1000) / 48000);
    assert.deepEqual(out[i].data, p.data);
    assert.equal(out[i].discard, samplesToNs(p.discard));
  }
  assert.ok(all.length < TONE.length + 2000, 'about the size of the Ogg file: same packets, a new container');
});
