// Astra's own Matroska packet reader (mkv-packets.js, mkv-blocks.js) against Mediabunny's: on every Matroska test
// film it hands out the same packets (count, times, durations, key flags, every byte) for the picture and the sound,
// from the start and from seeks; it reads a cluster as its bytes come, not whole; and on films built here byte by
// byte it handles lacing, block groups, header stripping, Void and CRC-32, negative times and a file cut short, and
// steps aside (MkvFallback, so Mediabunny reads the film) for what it will not guess at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as MB from '../frontend/astra/vendor/mediabunny.js';
import { readLayout } from '../frontend/astra/src/engine/mkv.js';
import { mkvPackets } from '../frontend/astra/src/engine/mkv-packets.js';

const FILMS = ['multi', 'surround', 'anime', 'truehd', 'centre', 'hevc', 'clusters', 'frontcues'];
const film = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/astra/${name}.mkv`, import.meta.url)));
const same = (a, b) => (a === null || b === null ? a === b
  : a.timestamp === b.timestamp && a.type === b.type && a.duration === b.duration && a.byteLength === b.byteLength && a.data.every((x, i) => x === b.data[i]));
const sig = (p) => p && `${p.timestamp}/${p.type}/${p.duration}/${p.byteLength}`;

async function open(bytes, read = async (s, e) => bytes.slice(s, Math.min(e, bytes.length))) {
  const layout = await readLayout(read, bytes.length);
  return mkvPackets({ layout }, read);
}

for (const name of FILMS) {
  test(`${name}.mkv: the same packets as Mediabunny's, from the start and from seeks`, async () => {
    const bytes = film(name);
    const reader = await open(bytes);
    const input = new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS });
    const tracks = await input.getTracks();
    // Both sinks first, as a playing film has them: they share the clusters they read.
    const sinks = tracks.map((t) => [t, new MB.EncodedPacketSink(t), reader.sink({ id: t.id, type: t.type, codec: t.codec, ref: t })]);
    const duration = await input.computeDuration();
    for (const [t, theirs, ours] of sinks) {
      assert.ok(ours, `track ${t.id} is read by Astra's reader`);
      let a = await theirs.getFirstPacket(), b = await ours.getFirstPacket(), n = 0;
      assert.equal(await ours.getFirstTimestamp(), await t.getFirstTimestamp());
      while (a || b) {
        assert.ok(same(a, b), `${t.type} packet ${n}: ${sig(a)} vs ${sig(b)}`);
        n++; a = await theirs.getNextPacket(a); b = await ours.getNextPacket(b);
      }
      assert.ok(n > 50);
      const cues = [...reader.layout.trackCues.values()][0].map((c) => c.ticks / 1000);
      for (const time of [0, 0.4, duration * 0.37, duration / 2, ...cues, cues.at(-1) - 0.01, duration * 0.9, duration + 5]) {
        let x = t.type === 'video' ? await theirs.getKeyPacket(time, { verifyKeyPackets: true }) : await theirs.getPacket(time);
        const y = t.type === 'video' ? await ours.getKeyPacket(time, { verifyKeyPackets: true }) : await ours.getPacket(time);
        // Sound at a cluster's very start: Astra's reader takes the cluster's first frame (just after the place) over the
        // last of the cluster before (just before it), which only reading that whole cluster would find.
        if (t.type === 'audio' && !same(x, y) && x && y.timestamp > time && y.timestamp - time <= 2 * y.duration + 1e-9) x = await theirs.getNextPacket(x);
        assert.ok(same(x, y), `${t.type} at ${time}: ${sig(x)} vs ${sig(y)}`);
        // And on from there, as a pipeline started by a seek reads.
        for (let i = 0, p = x, q = y; i < 30 && p; i++) { p = await theirs.getNextPacket(p); q = await ours.getNextPacket(q); assert.ok(same(p, q)); }
      }
    }
  });
}

test('a cluster is read as it arrives: the first frames come after a few kilobytes of a 5-second cluster, not all of it', async () => {
  const bytes = film('clusters');
  let reached = 0;
  const reader = await open(bytes, async (s, e) => { reached = Math.max(reached, e); return bytes.slice(s, Math.min(e, bytes.length)); });
  const { layout } = reader;
  const first = layout.trackCues.get(1)[0].position, second = layout.trackCues.get(1)[1].position;
  const video = reader.sink({ id: 1, type: 'video', codec: 'avc' }), sound = reader.sink({ id: 2, type: 'audio', codec: 'aac' });
  reached = 0;
  const key = await video.getKeyPacket(0);
  assert.equal(key.type, 'key');
  await sound.getPacket(0);
  assert.ok(reached - first < 40_000, `read ${reached - first} bytes of the first cluster, ${second - first} long`);
  // A seek to the middle of the next cued key frame's cluster jumps to the block the cue names.
  reached = 0;
  const mid = await video.getKeyPacket(11);
  assert.equal(mid.timestamp, 10);
  assert.ok(reached - second < 40_000);
});

// ---- Films built byte by byte -----------------------------------------------------------------

const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const idBytes = (id) => { const b = []; for (let v = id; v > 0; v = Math.floor(v / 256)) b.unshift(v & 255); return Uint8Array.from(b); };
const size = (n, len = 8) => { const b = new Uint8Array(len); let v = n; for (let i = len - 1; i > 0; i--) { b[i] = v & 255; v = Math.floor(v / 256); } b[0] = (0x100 >> len) | v; return b; };
const el = (id, ...body) => { const data = cat(...body.map((x) => (typeof x === 'string' ? new TextEncoder().encode(x) : x))); return cat(idBytes(id), size(data.length), data); };
const u = (n, len = 8) => { const b = new Uint8Array(len); for (let i = len - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 255; return b; };
const UNKNOWN = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
// A block body: track 1-byte vint, signed 16-bit time, flags, then the payload.
const block = (track, rel, flags, ...payload) => cat(Uint8Array.of(0x80 | track, (rel >> 8) & 255, rel & 255, flags), ...payload);
const SB = (...a) => el(0xa3, block(...a));
const BG = (b, { ref = false, duration = null } = {}) => el(0xa0, el(0xa1, b), ...(duration != null ? [el(0x9b, u(duration))] : []), ...(ref ? [el(0xfb, u(1, 2))] : []));
const fill = (n, v) => new Uint8Array(n).fill(v);

const TRACKS = el(0x1654ae6b,
  el(0xae, el(0xd7, u(1)), el(0x83, u(1)), el(0x86, 'V_MPEG4/ISO/AVC'), el(0x23e383, u(40e6))),
  el(0xae, el(0xd7, u(2)), el(0x83, u(2)), el(0x86, 'A_AAC'), el(0x23e383, u(20e6))),
  el(0xae, el(0xd7, u(3)), el(0x83, u(2)), el(0x86, 'A_AC3'), el(0x6d80, el(0x6240, el(0x5034, el(0x4254, u(3)), el(0x4255, Uint8Array.of(0xab, 0xcd)))))),
  el(0xae, el(0xd7, u(4)), el(0x83, u(2)), el(0x86, 'A_AC3'), el(0x6d80, el(0x6240, el(0x5034, el(0x4254, u(0)))))));

/** A Matroska file of the given clusters (each [timestamp, ...children]), its cue index before them. */
function build(clusters, { raw = null } = {}) {
  const head = el(0x1a45dfa3, el(0x4282, 'matroska'));
  const info = el(0x1549a966, el(0x2ad7b1, u(1e6)));
  const bodies = raw || clusters.map(([ts, ...kids]) => el(0x1f43b675, el(0xe7, u(ts)), ...kids));
  const cues = (positions) => el(0x1c53bb6b, ...positions.map((p, i) => el(0xbb, el(0xb3, u(clusters[i][0])), el(0xb7, el(0xf7, u(1)), el(0xf1, u(p))))));
  const before = info.length + TRACKS.length + cues(bodies.map(() => 0)).length;
  const positions = []; let at = before;
  for (const b of bodies) { positions.push(at); at += b.length; }
  return cat(head, idBytes(0x18538067), UNKNOWN, info, TRACKS, cues(positions), ...bodies);
}

const FILM = () => build([
  [0,
    el(0xec, fill(5, 0)), el(0xbf, fill(4, 7)), // Void and CRC-32: stepped over
    SB(2, -20, 0x80, fill(6, 1)), // sound before the cluster's time
    SB(1, 0, 0x80, fill(50, 9)),
    SB(2, 0, 0x80 | 0x02, Uint8Array.of(2, 3, 4), fill(3, 1), fill(4, 2), fill(5, 3)), // Xiph lacing: 3, 4, then 5
    SB(3, 0, 0x80, Uint8Array.of(1, 2)), // header stripping puts AB CD back
    BG(block(1, 80, 0, fill(20, 8)), { ref: true }), // shown later than the next: a B-frame order
    BG(block(1, 40, 0, fill(10, 7)), { ref: true, duration: 40 }),
    SB(2, 60, 0x80 | 0x06, Uint8Array.of(2, 0x85, 0xbd), fill(5, 4), fill(3, 5), fill(6, 6)), // EBML lacing: 5, 3, 6
  ],
  [1000,
    SB(1, 0, 0x80, fill(40, 6)),
    SB(2, 0, 0x80 | 0x04, Uint8Array.of(1), fill(4, 1), fill(4, 2)), // fixed lacing: two of 4
    BG(block(1, 40, 0, fill(12, 5)), { ref: true, duration: 40 }),
    BG(block(1, 80, 0, fill(12, 4))), // a block group with no reference: a key frame
  ],
]);

const collect = async (sink) => { const out = []; for (let p = await sink.getFirstPacket(); p; p = await sink.getNextPacket(p)) out.push(p); return out; };
const rows = (ps) => ps.map((p) => [+p.timestamp.toFixed(3), p.type, +p.duration.toFixed(3), p.byteLength, p.data[0]]);

test('built by hand: block groups, B-frame order, lacing of all three kinds, header stripping, Void and CRC-32, negative times', async () => {
  const reader = await open(FILM());
  const video = reader.sink({ id: 1, type: 'video', codec: 'avc' });
  const sound = reader.sink({ id: 2, type: 'audio', codec: 'aac' });
  const stripped = reader.sink({ id: 3, type: 'audio', codec: 'ac3' });
  assert.equal(reader.sink({ id: 4, type: 'audio', codec: 'ac3' }), null, 'a zlib track is left to Mediabunny');
  assert.deepEqual(rows(await collect(video)), [
    [0, 'key', 0.04, 50, 9], [0.08, 'delta', 0.04, 20, 8], [0.04, 'delta', 0.04, 10, 7],
    [1, 'key', 0.04, 40, 6], [1.04, 'delta', 0.04, 12, 5], [1.08, 'key', 0.04, 12, 4]]);
  assert.deepEqual(rows(await collect(sound)), [
    [-0.02, 'key', 0.02, 6, 1],
    [0, 'key', 0.02, 3, 1], [0.02, 'key', 0.02, 4, 2], [0.04, 'key', 0.02, 5, 3], // laced: the gap to the next block, shared
    [0.06, 'key', 0.02, 5, 4], [0.08, 'key', 0.02, 3, 5], [0.1, 'key', 0.02, 6, 6], // the cluster's last: the default each
    [1, 'key', 0.02, 4, 1], [1.02, 'key', 0.02, 4, 2]]);
  const [s] = await collect(stripped);
  assert.deepEqual([...s.data], [0xab, 0xcd, 1, 2]);
  assert.equal((await video.getKeyPacket(1.06)).timestamp, 1);
  assert.equal((await video.getKeyPacket(1.5)).timestamp, 1.08);
  assert.equal((await video.getKeyPacket(0.07)).timestamp, 0);
  assert.equal((await sound.getPacket(0.05)).timestamp, 0.04);
  assert.equal(await sound.getPacket(-1), null);
});

test('a file cut off inside a cluster ends cleanly where the bytes end', async () => {
  const whole = FILM();
  const cut = whole.subarray(0, whole.length - 20); // inside the second cluster's last block group
  const reader = await open(cut);
  const ts = (await collect(reader.sink({ id: 1, type: 'video', codec: 'avc' }))).map((p) => p.timestamp);
  assert.deepEqual(ts, [0, 0.08, 0.04, 1, 1.04]);
});

test('what the reader will not guess at makes it step aside (Mediabunny then reads the film), quickly', async () => {
  const fails = async (clusters, what, opts) => {
    const reader = await open(build(clusters, opts));
    const t = Date.now();
    await assert.rejects(collect(reader.sink({ id: 1, type: 'video', codec: 'avc' })), (e) => e.kind === 'mkv-fallback', what);
    assert.ok(Date.now() - t < 200, what);
  };
  const ok = [0, SB(1, 0, 0x80, fill(10, 1))];
  // A block that claims to run past its cluster, inside the file.
  const past = el(0x1f43b675, el(0xe7, u(1000)), cat(Uint8Array.of(0xa3), size(1e6), block(1, 0, 0x80, fill(4, 1))));
  await fails([ok, [1000], ok], 'a block larger than its cluster', { raw: [el(0x1f43b675, el(0xe7, u(0)), SB(1, 0, 0x80, fill(10, 1))), past, el(0x1f43b675, el(0xe7, u(2000)))] });
  // Lace sizes that add up to more than the block.
  await fails([ok, [1000, SB(1, 0, 0x82, Uint8Array.of(1, 200), fill(4, 1))]], 'lace sizes past the block');
  // A cluster of unknown size after the first, and one claiming 2^56 bytes.
  await fails([ok, [1000]], 'a cluster of unknown size', { raw: [el(0x1f43b675, el(0xe7, u(0)), SB(1, 0, 0x80, fill(10, 1))), cat(idBytes(0x1f43b675), UNKNOWN, el(0xe7, u(1000)), SB(1, 0, 0x80, fill(10, 1)))] });
  await fails([ok, [1000]], 'a cluster of 2^56 bytes', { raw: [el(0x1f43b675, el(0xe7, u(0)), SB(1, 0, 0x80, fill(10, 1))), cat(idBytes(0x1f43b675), size(2 ** 55), el(0xe7, u(1000)))] });
  // Something that is not a cluster or a known element between clusters.
  await fails([ok, [500], [1000]], 'junk between clusters', { raw: [el(0x1f43b675, el(0xe7, u(0)), SB(1, 0, 0x80, fill(10, 1))), el(0x4d80, fill(8, 1)), el(0x1f43b675, el(0xe7, u(1000)))] });
});
