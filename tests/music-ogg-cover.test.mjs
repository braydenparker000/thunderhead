// A cover embedded into an Ogg Opus file as it streams (frontend/th/music/ogg-cover.js; MUSIC.md "Downloads"):
// invented streams (tests/fixtures/ogg-make.mjs) run through it in awkward pieces and read back by an
// independent reader (tests/fixtures/ogg-read.mjs): every page's CRC, the sequence numbers without a gap,
// OpusHead as it was, the comments kept, one front cover equal to the one given, the audio packets and their
// granule positions as they were, the length grown by exactly what it says. Not Ogg Opus, no cover, a head
// past 1 MiB, more than one stream: the bytes as they came. Every byte here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concat, lace, opusHeadBytes, packet, page } from './fixtures/ogg-make.mjs';
import { picturesOf, readOgg, readTags } from './fixtures/ogg-read.mjs';

await import('../frontend/th/music/ogg-cover.js');
const { Embedder, embed, pictureBlock, imageInfo, fitCover, HEAD_LIMIT } = globalThis.thOggCover;
const enc = new TextEncoder();
const SERIAL = 0x2a2b2c2d;

/** An OpusTags packet: a vendor, comments, and bytes after them. */
function tags(vendor, comments, rest = new Uint8Array(0)) {
  const parts = [enc.encode('OpusTags')];
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const v = enc.encode(vendor);
  parts.push(u32(v.length), v, u32(comments.length));
  for (const c of comments) { const b = typeof c === 'string' ? enc.encode(c) : c; parts.push(u32(b.length), b); }
  parts.push(rest);
  return concat(parts);
}

/** A packet laced onto pages of at most `per` lacing values, granule 0 (a header packet). */
function headerPages(data, seq, per = 255, serial = SERIAL) {
  const values = lace(data.length);
  const out = [];
  let body = 0;
  for (let i = 0; i * per < values.length; i++) {
    const l = values.slice(i * per, (i + 1) * per);
    const n = l.reduce((s, x) => s + x, 0);
    out.push(page({ flags: i ? 1 : 0, granule: 0, serial, seq: seq + i, lacing: l, body: data.subarray(body, body + n) }));
    body += n;
  }
  return out;
}

/** A stream: OpusHead, the tags (on as many pages as `per` makes), then `count` audio packets, three a page. */
function stream({ tagsPacket = tags('invented vendor 1.0', ['TITLE=Morning Static', 'ARTIST=Cobalt Field']), per = 255, count = 12, serial = SERIAL, junk = null } = {}) {
  const pages = [page({ flags: 2, granule: 0, serial, seq: 0, lacing: lace(19), body: opusHeadBytes() })];
  pages.push(...headerPages(tagsPacket, 1, per, serial));
  const audio = Array.from({ length: count }, (_, i) => packet(20, 40 + ((i * 37) % 300), (i * 13) & 255));
  let seq = pages.length, granule = 312;
  for (let i = 0; i < audio.length; i += 3) {
    const group = audio.slice(i, i + 3);
    granule += 960 * group.length;
    const last = i + 3 >= audio.length;
    pages.push(page({ flags: last ? 4 : 0, granule, serial, seq: seq++, lacing: group.flatMap((p) => lace(p.length)), body: concat(group) }));
  }
  if (junk) pages.push(junk);
  return concat(pages);
}

/** An invented JPEG: SOI, an APP0, a baseline frame header (800 × 600, three components), filler, EOI. */
function jpeg(n = 2000, seed = 1) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0, 16, ...enc.encode('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const body = Array.from({ length: Math.max(0, n - head.length - 2) }, (_, i) => (i * 7 + seed * 29 + (i >> 5)) & 0x7f);
  return Uint8Array.from([...head, ...body, 0xff, 0xd9]);
}

/** Runs bytes through in pieces of the given sizes (cycled). */
async function run(bytes, block, sizes = [bytes.length || 1]) {
  async function* source() {
    let i = 0;
    for (let at = 0; at < bytes.length; i++) {
      const n = sizes[i % sizes.length];
      yield bytes.slice(at, at + n);
      at += n;
    }
  }
  const e = new Embedder(block);
  const parts = [];
  for await (const c of embed(source(), block, e)) parts.push(c);
  return { out: concat(parts), e };
}

/** Everything a rewritten stream must keep, and the one picture it must carry. */
function check(before, after, cover, e) {
  const a = readOgg(before), b = readOgg(after);
  assert.equal(b.tail.length, a.tail.length, 'nothing left over that was not');
  assert.ok(Buffer.from(b.tail).equals(Buffer.from(a.tail)), 'bytes after the last page as they were');
  assert.equal(after.length, before.length + e.added, 'grown by exactly what it says');
  b.pages.forEach((p, i) => assert.equal(p.seq, i, `page ${i}: its sequence number, without a gap`));
  assert.ok(b.pages.every((p) => p.serial === SERIAL));
  assert.ok(Buffer.from(b.pages[0].raw).equals(Buffer.from(a.pages[0].raw)), 'OpusHead’s page unchanged');
  const tagPages = b.packets[1].pages;
  for (let i = tagPages[0]; i <= tagPages[1]; i++) {
    assert.equal(b.pages[i].granule, 0n, `header page ${i}: granule 0`);
    assert.ok(b.pages[i].lacing.length <= 255);
  }
  assert.equal(b.pages[tagPages[1] + 1]?.flags & 1, 0, 'the tags packet ends its page: the next page starts a packet');
  // The audio: the same packets, on pages with the same granule positions and flags.
  assert.equal(b.packets.length, a.packets.length);
  for (let i = 2; i < a.packets.length; i++) {
    assert.ok(Buffer.from(b.packets[i].data).equals(Buffer.from(a.packets[i].data)), `audio packet ${i}: its bytes`);
    assert.equal(b.packets[i].granule, a.packets[i].granule, `audio packet ${i}: its page's granule`);
  }
  const audioA = a.pages.slice(a.packets[1].pages[1] + 1), audioB = b.pages.slice(tagPages[1] + 1);
  assert.deepEqual(audioB.map((p) => [p.flags, p.granule, p.lacing.join()]), audioA.map((p) => [p.flags, p.granule, p.lacing.join()]));
  // The comments kept, in order; one front cover, equal to the cover given.
  const ta = readTags(a.packets[1].data), tb = readTags(b.packets[1].data);
  assert.equal(tb.vendor, ta.vendor);
  assert.ok(Buffer.from(tb.rest).equals(Buffer.from(ta.rest)), 'the bytes after the comments kept');
  const fronts = picturesOf(after).filter((p) => p.type === 3);
  assert.equal(fronts.length, 1, 'exactly one front cover');
  assert.ok(Buffer.from(fronts[0].data).equals(Buffer.from(cover)), 'the cover’s own bytes');
  return { a, b, ta, tb, front: fronts[0] };
}

test('a cover goes into OpusTags: one page, comments kept, the audio as it was', async () => {
  const before = stream();
  const cover = jpeg(2000);
  const block = pictureBlock({ bytes: cover, ...imageInfo(cover) });
  const { out, e } = await run(before, block);
  assert.equal(e.embedded, true);
  const { tb, front } = check(before, out, cover, e);
  assert.deepEqual(tb.comments.slice(0, 2), ['TITLE=Morning Static', 'ARTIST=Cobalt Field']);
  assert.match(tb.comments[2], /^METADATA_BLOCK_PICTURE=/);
  assert.deepEqual([front.mime, front.description, front.width, front.height, front.depth, front.colours], ['image/jpeg', '', 800, 600, 24, 0]);
  // The tags still fit on one page: the audio pages are byte for byte as they were.
  const a = readOgg(before), b = readOgg(out);
  assert.equal(b.pages.length, a.pages.length);
  for (let i = 2; i < a.pages.length; i++) assert.ok(Buffer.from(b.pages[i].raw).equals(Buffer.from(a.pages[i].raw)), `page ${i} unchanged`);
});

test('tags across two pages, a cover that needs more, fed in awkward pieces: pages renumbered, CRCs made again', async () => {
  // A long comment puts the tags on two pages (more than 255 lacing values); a 150 KB cover needs four.
  const long = `DESCRIPTION=${'invented words '.repeat(5000)}`;
  const before = stream({ tagsPacket: tags('invented vendor 2.0', ['TITLE=Slow Orbit', long], Uint8Array.of(1, 9, 9, 9)), count: 40 });
  assert.equal(readOgg(before).packets[1].pages.join(), '1,2', 'the input’s tags span two pages');
  const cover = jpeg(150_000, 2);
  const block = pictureBlock({ bytes: cover, ...imageInfo(cover) });
  for (const sizes of [[1], [3, 7, 13, 27, 64], [26, 27, 28, 255, 4096], [65_536], [before.length]]) {
    const { out, e } = await run(before, block, sizes);
    const { a, b, tb } = check(before, out, cover, e);
    assert.ok(b.pages.length > a.pages.length, `${sizes}: pages added`);
    assert.deepEqual(tb.comments.slice(0, 2), ['TITLE=Slow Orbit', long]);
  }
});

test('a front cover already there is replaced; other pictures kept', async () => {
  // (The name in lower case: a comment's name is read in any letter case.)
  const withType = (type, bytes) => {
    const b = pictureBlock({ bytes, mime: 'image/png' });
    new DataView(b.buffer).setUint32(0, type);
    return `metadata_block_picture=${Buffer.from(b).toString('base64')}`;
  };
  const back = Uint8Array.from({ length: 300 }, (_, i) => i & 255);
  const before = stream({ tagsPacket: tags('v', ['ALBUM=Low Tide', withType(3, Uint8Array.of(1, 2, 3)), withType(4, back)]) });
  const cover = jpeg(900, 3);
  const { out, e } = await run(before, pictureBlock({ bytes: cover, mime: 'image/jpeg' }), [5, 11]);
  check(before, out, cover, e);
  const pics = picturesOf(out);
  assert.deepEqual(pics.map((p) => p.type), [4, 3], 'the back cover kept, the front cover the new one');
  assert.ok(Buffer.from(pics[0].data).equals(Buffer.from(back)));
});

test('no cover, not Ogg, not Opus, two streams, a head past 1 MiB: the bytes as they came', async () => {
  const cover = jpeg(500);
  const block = pictureBlock({ bytes: cover, mime: 'image/jpeg' });
  const same = async (bytes, b, sizes, why) => {
    const { out, e } = await run(bytes, b, sizes);
    assert.ok(Buffer.from(out).equals(Buffer.from(bytes)), why);
    assert.equal(e.added, 0, why);
    assert.equal(e.embedded, false, why);
  };
  await same(stream(), null, [100], 'no cover');
  await same(Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 255), block, [7], 'not Ogg');
  await same(new Uint8Array(0), block, [1], 'nothing');
  // An Ogg stream that is not Opus (a Vorbis-like head).
  const vorbis = concat([page({ flags: 2, serial: SERIAL, seq: 0, lacing: [30], body: Uint8Array.from([1, ...enc.encode('vorbis'), ...new Uint8Array(23)]) }), ...headerPages(tags('v', []), 1)]);
  await same(vorbis, block, [9], 'not Opus');
  // A second stream's first page between the head and the tags (multiplexed).
  const s = readOgg(stream());
  const other = page({ flags: 2, serial: 7, seq: 0, lacing: lace(19), body: opusHeadBytes() });
  await same(concat([s.pages[0].raw, other, ...s.pages.slice(1).map((p) => p.raw)]), block, [64], 'two streams');
  // A broken CRC in the head.
  const bad = stream();
  bad[30] ^= 1;
  await same(bad, block, [1000], 'a wrong CRC');
  // Tags longer than the bytes it holds for them.
  const huge = stream({ tagsPacket: tags('v', [`COMMENT=${'x'.repeat(HEAD_LIMIT + 1000)}`]) });
  await same(huge, block, [32_768], 'a head past 1 MiB');
  // Cut off in the head: what came, as it came.
  await same(stream().subarray(0, 60), block, [10], 'cut off');
});

test('after the head: bytes that are not pages, and a page with a wrong CRC, pass as they came', async () => {
  const cover = jpeg(150_000, 4);
  const block = pictureBlock({ bytes: cover, mime: 'image/jpeg' });
  // Bytes after the stream's pages (as a file with something stuck on its end).
  const junk = Uint8Array.from({ length: 3000 }, (_, i) => (i * 11 + 5) & 255);
  const before = stream({ junk });
  const { out, e } = await run(before, block, [333]);
  check(before, out, cover, e);
  assert.ok(Buffer.from(out.subarray(out.length - junk.length)).equals(Buffer.from(junk)));
  // A broken audio page: it and everything after it as it came; the length still as it says.
  const broken = stream();
  const pages = readOgg(broken).pages;
  const at = pages[4].at + 40;
  broken[at] ^= 0xff;
  const r = await run(broken, block, [100]);
  assert.equal(r.out.length, broken.length + r.e.added);
  assert.ok(Buffer.from(r.out.subarray(pages[4].at + r.e.added)).equals(Buffer.from(broken.subarray(pages[4].at))));
});

test('images: JPEG and PNG sizes read from their headers; a cover up to 1 MiB embedded as it is', async () => {
  assert.deepEqual(imageInfo(jpeg(100)), { mime: 'image/jpeg', width: 800, height: 600, depth: 24 });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...enc.encode('IHDR'), 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 6, 0, 0, 0, 1, 2, 3, 4]);
  assert.deepEqual(imageInfo(png), { mime: 'image/png', width: 640, height: 480, depth: 32 });
  assert.deepEqual(imageInfo(Uint8Array.of(1, 2, 3), 'image/webp'), { mime: 'image/webp', width: 0, height: 0, depth: 0 });
  const small = jpeg(1024 * 1024);
  assert.equal((await fitCover(small, 'image/jpeg')).bytes, small, 'up to 1 MiB: the stored bytes');
  // Larger, where nothing can draw it (no OffscreenCanvas here): as it is.
  const big = jpeg(1024 * 1024 + 10);
  const f = await fitCover(big, 'image/jpeg');
  assert.equal(f.bytes, big);
  assert.deepEqual([f.mime, f.width, f.height], ['image/jpeg', 800, 600]);
  // The block: type 3, the mime type, no description, the sizes, no palette, the bytes.
  const b = pictureBlock({ bytes: Uint8Array.of(9, 8, 7), mime: 'image/png', width: 2, height: 3, depth: 24 });
  assert.deepEqual([...b], [0, 0, 0, 3, 0, 0, 0, 9, ...enc.encode('image/png'), 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 24, 0, 0, 0, 0, 0, 0, 0, 3, 9, 8, 7]);
});
