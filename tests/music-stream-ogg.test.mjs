// Music's streaming path, the Ogg Opus demuxer (frontend/th/music/stream/ogg.js; MUSIC.md §5,
// RFC 3533, RFC 7845, RFC 6716 §3.1): the fixture's head and packets in any split of its bytes, pages
// and packets that span chunks and pages, the TOC durations, the checks that fail cleanly on
// corrupt input, and the pre-skip and end-trim arithmetic. Node only, synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OggError, OggOpusDemuxer, endTrim, findPage, opusHead, packetSamples, readPage } from '../frontend/th/music/stream/ogg.js';
import { TONE, concat, opusHeadBytes, packet, page, writeOgg } from './fixtures/ogg-make.mjs';

/** Every packet from `bytes` fed in pieces of the given sizes (cycled). */
function demux(bytes, sizes = [bytes.length], o = {}) {
  const d = new OggOpusDemuxer(o);
  let head = null;
  const packets = [];
  for (let i = 0, k = 0; i < bytes.length; k++) {
    const n = sizes[k % sizes.length];
    const r = d.push(bytes.subarray(i, i + n), { last: i + n >= bytes.length });
    head ??= r.head;
    packets.push(...r.packets);
    i += n;
  }
  d.end();
  return { d, head, packets };
}

const err = (code) => (e) => e instanceof OggError && e.code === code;

test('the fixture: its OpusHead, 151 packets of 20 ms placed by granule, and its end trimmed to 3.000 s', () => {
  const { d, head, packets } = demux(TONE);
  assert.deepEqual({ ...head, bytes: head.bytes.length }, { version: 1, channels: 2, preSkip: 312, inputRate: 48000, outputGain: 0, mapping: 0, bytes: 19 });
  assert.equal(packets.length, 151);
  assert.ok(packets.every((p) => p.samples === 960));
  assert.deepEqual(packets.slice(0, 3).map((p) => p.start), [0, 960, 1920]);
  assert.equal(d.origin, 0);
  assert.equal(d.audioStart, 137, 'audio pages begin after the two header pages');
  const last = packets[packets.length - 1];
  assert.deepEqual([last.start, last.discard, last.eos], [144000, 648, true]);
  assert.ok(packets.slice(0, -1).every((p) => !p.eos && p.discard === 0));
  // RFC 7845 §4: playable samples = last granule − pre-skip.
  assert.equal(packets.reduce((n, p) => n + p.samples - p.discard, 0) - head.preSkip, 3 * 48000);
});

test('any split of the bytes gives the same packets, pages cut mid-header and mid-lacing included', () => {
  const whole = demux(TONE).packets;
  for (const sizes of [[1], [7], [26, 1, 100], [27 + 3], [4096], [137, 13, 27, 5000], [9999]]) {
    const got = demux(TONE, sizes).packets;
    assert.equal(got.length, whole.length, `sizes ${sizes}`);
    for (let i = 0; i < got.length; i++) {
      assert.deepEqual(got[i].data, whole[i].data);
      assert.equal(got[i].start, whole[i].start);
      assert.equal(got[i].discard, whole[i].discard);
    }
  }
});

test('packets that span pages (continued flags, lacing values of 255) and packets of exactly 255·k bytes', () => {
  const big = packet(20, 700, 0x11); // 255, 255, 190: split over pages of 2 lacing values
  const even = packet(10, 510, 0x22); // 255, 255, 0
  const small = packet(5, 3, 0x33);
  const packets = [big, even, small, big].map((data) => ({ data, samples: packetSamples(data) }));
  const bytes = writeOgg({ packets, maxSegments: 2 });
  // Audio pages of two lacing values each: [255 255] [190 255]c [255 0]c [3 255] [255 190]c.
  let at = 0;
  const flags = [];
  while (at < bytes.length) {
    const p = readPage(bytes, at);
    flags.push(p.flags & 1);
    at += p.size;
  }
  assert.deepEqual(flags, [0, 0, 0, 1, 1, 0, 1], 'packets go on across pages');
  for (const sizes of [[bytes.length], [1], [31]]) {
    const got = demux(bytes, sizes).packets;
    assert.deepEqual(got.map((p) => p.data.length), [700, 510, 3, 700]);
    assert.deepEqual(got[1].data, even);
    assert.deepEqual(got.map((p) => p.samples), [960, 480, 240, 960]);
    assert.deepEqual(got.map((p) => p.start), [0, 960, 1440, 1680]);
  }
});

test('corrupt input fails cleanly with a code: CRC, capture pattern, version, a lost page, truncation, not Opus', () => {
  const bad = TONE.slice();
  bad[5000] ^= 0x40; // inside the fourth page's body
  assert.throws(() => demux(bad), err('ogg-crc'));
  assert.throws(() => demux(bad, [100]), err('ogg-crc'), 'also when the page arrives in pieces');
  const junk = new TextEncoder().encode('<!doctype html><title>404</title>');
  assert.throws(() => demux(junk), err('ogg-capture'));
  const version = TONE.slice();
  version[4] = 1;
  assert.throws(() => demux(version), err('ogg-version'));
  // A page cut out of the middle: the sequence numbers show it.
  const p3 = readPage(TONE, 137);
  const lost = concat([TONE.subarray(0, 137), TONE.subarray(137 + p3.size)]);
  assert.throws(() => demux(lost), err('ogg-seq'));
  // The bytes stop mid-page.
  const d = new OggOpusDemuxer();
  d.push(TONE.subarray(0, 6000));
  assert.throws(() => d.end(), err('ogg-truncated'));
  // A valid Ogg stream that is not Opus, or Opus with a channel mapping WebM can't carry.
  const vorbis = page({ flags: 2, lacing: [30], body: new Uint8Array(30).fill(1) });
  assert.throws(() => demux(vorbis), err('opus-head'));
  assert.throws(() => opusHead(opusHeadBytes({ channels: 2, mapping: 2 })), err('opus-mapping'));
  assert.throws(() => opusHead(opusHeadBytes({ channels: 3, mapping: 0 })), err('opus-mapping'));
  assert.equal(opusHead(opusHeadBytes({ channels: 6, mapping: 1, table: [0, 4, 1, 2, 3, 5] })).channels, 6);
  // A first page that isn't flagged as the stream's first.
  assert.throws(() => demux(TONE.subarray(47)), err('ogg-bos'));
});

test('packet durations from the TOC byte (RFC 6716 §3.1)', () => {
  const toc = (config, code, ...rest) => Uint8Array.of((config << 3) | code, ...rest);
  // SILK 10/20/40/60 ms, hybrid 10/20 ms, CELT 2.5/5/10/20 ms; one frame.
  assert.deepEqual([0, 1, 2, 3, 9, 11].map((c) => packetSamples(toc(c, 0))), [480, 960, 1920, 2880, 960, 2880]);
  assert.deepEqual([12, 13, 14, 15].map((c) => packetSamples(toc(c, 0))), [480, 960, 480, 960]);
  assert.deepEqual([16, 17, 18, 19, 28, 31].map((c) => packetSamples(toc(c, 0))), [120, 240, 480, 960, 120, 960]);
  // Codes 1 and 2: two frames; code 3: the count in the second byte's low 6 bits (VBR and padding flags ignored).
  assert.equal(packetSamples(toc(31, 1)), 1920);
  assert.equal(packetSamples(toc(31, 2)), 1920);
  assert.equal(packetSamples(toc(31, 3, 0xc6)), 6 * 960);
  assert.equal(packetSamples(toc(16, 3, 48)), 48 * 120);
  assert.throws(() => packetSamples(toc(3, 3, 3)), err('opus-toc'), '180 ms is longer than a packet may be');
  assert.throws(() => packetSamples(toc(31, 3, 0)), err('opus-toc'));
  assert.throws(() => packetSamples(toc(31, 3)), err('opus-toc'));
  assert.throws(() => packetSamples(new Uint8Array(0)), err('opus-packet'));
});

test('pre-skip and end trimming: the arithmetic of RFC 7845 §4', () => {
  assert.equal(endTrim(144312, 144960), 648);
  assert.equal(endTrim(5000, 4800), 0, 'a granule past the packets trims nothing');
  assert.equal(endTrim(-1, 960), 960);
  const p = () => ({ data: packet(20), samples: 960 });
  // A trim longer than the last packet reaches into the one before.
  let got = demux(writeOgg({ packets: [p(), p(), p(), p()], endGranule: 4 * 960 - 1500 })).packets;
  assert.deepEqual(got.map((x) => x.discard), [0, 0, 540, 960]);
  assert.equal(got.reduce((n, x) => n + x.samples - x.discard, 0), 4 * 960 - 1500);
  // A single audio page that is also the last: counted from 0, trimmed at the end.
  got = demux(writeOgg({ packets: [p(), p()], endGranule: 1000 })).packets;
  assert.deepEqual(got.map((x) => [x.start, x.discard]), [[0, 0], [960, 920]]);
  // A stream that begins later than granule 0 (cut from a longer one) keeps its positions.
  const later = demux(writeOgg({ packets: [p(), p(), p()], start: 48000, perPage: 2 }));
  assert.equal(later.d.origin, 48000);
  assert.deepEqual(later.packets.map((x) => x.start), [48000, 48960, 49920]);
  // A first page whose packets would start before granule 0 is invalid unless it is the last.
  assert.throws(() => demux(writeOgg({ packets: [p(), p(), p()], start: -1000, perPage: 2 })), err('ogg-granule'));
  // The last page without its end-of-stream flag still trims when the caller says the bytes end there.
  const noEos = writeOgg({ packets: [p(), p(), p()], perPage: 2, endGranule: 2500, eos: false });
  got = demux(noEos).packets;
  assert.deepEqual(got.map((x) => x.discard), [0, 0, 380]);
  assert.ok(got[2].eos);
});

test('a resync mid-file finds the next valid page, drops the packet it continues and places packets by its granule', () => {
  const { head } = demux(TONE);
  const from = 5000; // inside the fourth page
  const found = findPage(TONE, from);
  assert.ok(found && found.at > from);
  const d = new OggOpusDemuxer({ head, resync: true });
  const r = d.push(TONE.subarray(from), { last: true });
  d.end();
  assert.equal(r.head, null);
  assert.equal(d.consumed, TONE.length - from);
  // The fixture's pages hold 50 whole packets each, so the run starts with the found page's first.
  assert.equal(r.packets[0].start, found.page.granule - 50 * 960);
  assert.equal(r.packets[r.packets.length - 1].discard, 648);
  // A resync into a page whose first packet began on the page before: that piece is dropped.
  const split = writeOgg({ packets: [700, 700, 700].map((n) => ({ data: packet(20, n), samples: 960 })), maxSegments: 2 });
  const second = readPage(split, 47 + readPage(split, 47).size);
  const at2 = 47 + readPage(split, 47).size + second.size; // the page [190 255]: continues packet 1
  const d2 = new OggOpusDemuxer({ head, resync: true });
  const r2 = d2.push(split.subarray(at2), { last: true });
  assert.deepEqual(r2.packets.map((x) => [x.data.length, x.start]), [[700, 960], [700, 1920]]);
  // Bytes with no Ogg page in them at all.
  const noise = new Uint8Array(400_000).fill(0x4f);
  assert.throws(() => new OggOpusDemuxer({ head, resync: true }).push(noise), err('ogg-capture'));
});
