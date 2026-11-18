// A Matroska film with fonts attached is described as fast as one without. Mediabunny read the Attachments element
// whole while describing the film, so an 8 MB font held the first picture 12.2 s on a 5.4 Mbit/s link with 110 ms a
// request (0.29 s without it; scripts/astra/real.mjs, 2026-11-18). Now Mediabunny is shown that element as Void
// (mkv-hide.js), the download at the film's start stops where the fonts begin, and the fonts are read only when a
// styled track is shown, in requests of their own that end with the element (mkv-attachments.js sideReader). The
// software decoder (libmedia, which steps over a Void by reading through it) gets the fonts as zeros it never fetches,
// and what has arrived as it arrives (software-loader.js): an HEVC 10-bit film went from 14.0 s to 1.3 s. The film
// is anime.mkv (scripts/astra/fixtures.sh) with 8 MiB of made-up font added to its attachments here, its seek head and
// cue index moved to match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probe } from '../frontend/astra/src/engine/probe.js';
import { header, MKV_ID as ID } from '../frontend/astra/src/engine/mkv.js';
import { voidHeader } from '../frontend/astra/src/engine/mkv-hide.js';
import { readFonts, sideReader } from '../frontend/astra/src/engine/mkv-attachments.js';
import { sourceLoader } from '../frontend/astra/src/engine/software-loader.js';

const BIG = 8 << 20;
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const be8 = (v) => { const b = new Uint8Array(8); for (let i = 7; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v % 256; return b; };
const size8 = (v) => { const b = be8(v); b[0] |= 0x01; return b; };
const sizeOf = (v) => { let n = 1; while (v >= 2 ** (7 * n) - 1) n++; const b = be8(v).subarray(8 - n); b[0] |= 0x80 >> (n - 1); return b; };
const idOf = (id) => { const out = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256); return Uint8Array.from(out); };
const el = (id, ...body) => { const data = cat(...body.map((b) => (typeof b === 'string' ? new TextEncoder().encode(b) : b))); return cat(idOf(id), sizeOf(data.length), data); };
/** The children of bytes [start, end): {id, at, body: [dataStart, dataEnd), raw: [at, dataEnd)}. */
const kids = (bytes, start = 0, end = bytes.length) => {
  const out = [];
  for (let at = start; at < end;) { const h = header(bytes, at), d = h.dataStart; out.push({ id: h.id, at, body: [d, d + h.size], raw: bytes.subarray(at, d + h.size) }); at = d + h.size; }
  return out;
};

/** anime.mkv with a font of `extra` made-up bytes added to its attachments: positions after it are moved to match. */
function grow(film, extra) {
  const ebml = header(film, 0), segAt = ebml.dataStart + ebml.size, seg = header(film, segAt), base = seg.dataStart;
  const items = kids(film, base, base + seg.size);
  const att = items.find((i) => i.id === ID.Attachments), data = new Uint8Array(extra).map((_, i) => (i * 7) & 255);
  att.raw = el(ID.Attachments, ...kids(film, ...att.body).filter((k) => k.id !== 0xbf).map((k) => k.raw), // its CRC-32 would no longer match
    el(ID.AttachedFile, el(ID.FileName, 'Big.ttf'), el(ID.FileMediaType, 'application/x-truetype-font'), el(ID.FileData, data), el(0x46ae, be8(7))));
  const byOld = new Map(items.map((i) => [i.at - base, i])), place = new Map();
  const head = items.findIndex((i) => i.id === ID.SeekHead), room = items[head].raw.length + items[head + 1].raw.length;
  for (let pass = 0; pass < 2; pass++) { // the seek head and the cues are the same size whatever the positions: placed, then written again
    items[head].raw = el(ID.SeekHead, ...kids(film, ...items[head].body).filter((s) => s.id === ID.Seek).map((s) => {
      const [id, pos] = kids(film, ...s.body).map((f) => film.subarray(...f.body));
      return el(ID.Seek, el(ID.SeekID, id), el(ID.SeekPosition, be8(place.get(byOld.get(pos.reduce((n, b) => n * 256 + b, 0)))?.rel || 0)));
    }));
    const left = room - items[head].raw.length;
    items[head + 1].raw = cat([0xec], size8(left - 9), new Uint8Array(left - 9));
    const cues = items.find((i) => i.id === ID.Cues), walk = (start, end) => kids(film, start, end).filter((k) => k.id !== 0xbf).map((k) =>
      k.id === ID.CuePoint || k.id === ID.CueTrackPositions ? el(k.id, ...walk(...k.body))
        : k.id === ID.CueClusterPosition ? el(k.id, be8(place.get(byOld.get(film.subarray(...k.body).reduce((n, b) => n * 256 + b, 0)))?.rel || 0)) : k.raw);
    cues.raw = el(ID.Cues, ...walk(...cues.body));
    let rel = 0;
    for (const i of items) { place.set(i, { rel }); rel += i.raw.length; }
  }
  return cat(film.subarray(0, segAt), idOf(ID.Segment), size8(items.reduce((n, i) => n + i.raw.length, 0)), ...items.map((i) => i.raw));
}

/** A host that honours ranges and sends its answers in 64 KiB pieces as they are read, 5 ms apart: `served` counts what left. */
function host(bytes) {
  const log = { served: 0, ranges: [] };
  log.fetchFn = async (url, { headers = {}, method = 'GET' }) => {
    const [, a, b] = /bytes=(\d*)-(\d*)/.exec(headers.Range || 'bytes=0-');
    const from = +a, to = b ? Math.min(+b + 1, bytes.length) : bytes.length;
    const asked = [from, b ? to : null, 0];
    if (method !== 'HEAD') log.ranges.push(asked);
    let at = from;
    const body = method === 'HEAD' ? null : new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 5)); if (at >= to) return c.close(); const n = Math.min(65536, to - at); c.enqueue(bytes.slice(at, at + n)); log.served += n; asked[2] += n; at += n; } }, { highWaterMark: 0 });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${bytes.length}`, 'content-length': String(to - from) } });
  };
  return log;
}

const film = grow(new Uint8Array(readFileSync(new URL('./fixtures/astra/anime.mkv', import.meta.url))), BIG);

test('a film with 8 MiB of fonts attached is described from its start, its end and the first cluster, the fonts left unread', async (t) => {
  const h = host(film);
  const probed = await probe('https://files.example/episode.mkv', { fetchFn: h.fetchFn });
  t.after(() => { probed.input?.dispose(); probed.source?.close(); });
  const { info } = probed, layout = info.layout, fonts = header(film, layout.attachments);
  assert.equal(info.video.length, 1); assert.equal(info.audio.length, 1);
  assert.ok(info.subtitles.some((s) => s.format === 'ass'), 'the styled track is listed');
  assert.ok(layout.firstCluster > BIG && layout.cues.length > 3, `the cue index is read where it moved to (${layout.cues.length} points)`);
  assert.ok(Math.abs(info.duration - 20) < 1, `duration ${info.duration}`);
  assert.ok(fonts.size > BIG, 'the attachments are as large as made');
  await new Promise((r) => setTimeout(r, 200)); // what the downloads begun while describing go on to bring
  const [start, ...rest] = h.ranges, ranges = JSON.stringify(h.ranges);
  assert.ok(start[0] === 0 && start[2] <= 128 << 10, `the download at the start stops where the fonts begin: 64 KiB, a piece more on its way (${ranges})`);
  // Past the fonts, a download asks as far as describing may read on (2 MiB), so playback from 0:00 reads on from it.
  assert.ok(rest.some(([from, to]) => from > BIG && from <= layout.firstCluster && (to == null || to - from >= 1 << 20)), `one request past the fonts (${ranges})`);
  assert.ok(h.served < 640 << 10, `${h.served} bytes served of a ${film.length}-byte film`);

  // Shown later, the fonts are read in requests of their own that end with the element: both fonts, whole.
  const before = h.ranges.length, served = h.served, end = fonts.dataStart + fonts.size;
  const read = await readFonts(sideReader(probed.source), probed.source.size, layout.attachments);
  assert.deepEqual(read.map((f) => [f.name, f.data.byteLength]), [['Inter-Bold.woff2', read[0].data.byteLength], ['Big.ttf', BIG]]);
  assert.ok(read[1].data.every((b, i) => b === ((i * 7) & 255)), 'the made-up font, byte for byte');
  const asked = h.ranges.slice(before);
  assert.ok(asked.length <= 3 && asked.every(([from, to]) => to != null && to <= end), `fonts read in ${JSON.stringify(asked)}, the element ends at ${end}`);
  assert.ok(h.served - served < BIG + (1 << 20), `${h.served - served} bytes for ${BIG + 28_000} of fonts`);
});

test('a Void header of the same length as the element\'s own, for every length of its size field', () => {
  for (let length = 5; length <= 12; length++) {
    const size = 2 ** Math.min(7 * (length - 4), 40) - 2, bytes = voidHeader(length, size);
    assert.equal(bytes.length, length);
    let at = 0, last = null;
    while (at < length) { last = header(bytes, at); assert.equal(last.id, 0xec); at = last.dataStart < length ? last.dataStart + last.size : last.dataStart; }
    assert.equal(at, length, `the last Void's header ends where the element's did (${length} bytes)`);
    assert.equal(last.size, size, 'and says the same size');
  }
});

test('libmedia is handed the fonts as a Void of zeros it never fetches, its seek head naming Info for them, and what is here as it comes', async () => {
  const top = kids(film, header(film, header(film, 0).dataStart + header(film, 0).size).dataStart, film.length);
  const asked = [], att = top.find((k) => k.id === ID.Attachments), cluster = top.find((k) => k.id === ID.Cluster).at;
  const source = { size: film.length, read: async (s, e) => { asked.push([s, e]); return film.subarray(s, e); }, cachedUntil: (s) => s };
  const loader = sourceLoader({ IOLoader: { CustomIOLoader: class {} } }, source, 'mkv');
  const buffer = new Uint8Array(1 << 20), seen = new Uint8Array(film.length);
  let at = 0, first = 0;
  for (let n; at < cluster + 4096 && (n = await loader.read(buffer)) > 0; at += n) { seen.set(buffer.subarray(0, n), at); first ||= n; }
  assert.equal(first, 64 << 10, 'the first read is what may have arrived (64 KiB), not a whole MiB');
  const h = header(seen, att.at);
  assert.equal(h.id, 0xec, 'the attachments read as a Void');
  assert.equal(h.dataStart + h.size, att.body[1], 'of the same length');
  assert.ok(seen.subarray(att.body[0] + 64, att.body[1]).every((b) => b === 0), 'whose body is zeros');
  assert.ok(!asked.some(([s, e]) => s < att.body[1] - 4096 && e > att.body[0] + 4096), `nothing of it was asked for (${JSON.stringify(asked.slice(0, 6))})`);
  const pattern = (bytes) => Buffer.from(bytes.subarray(0, 300)).indexOf(Buffer.from([0x53, 0xab, 0x84, 0x19, 0x41, 0xa4, 0x69]));
  assert.ok(pattern(film) > 0 && pattern(seen) < 0, 'the seek head names the Info element in its place');
  assert.deepEqual([...seen.subarray(cluster, cluster + 4096)], [...film.subarray(cluster, cluster + 4096)], 'the first cluster is the film\'s own');
});
