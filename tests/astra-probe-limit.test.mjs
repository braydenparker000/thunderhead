// Describing a film is bounded (probe-limit.js). Mediabunny finds DTS's codec string in the track's first frame, reading
// clusters whole from the film's start until one holds a block of it: a film whose DTS track begins a minute in sat
// 35.8 s in "Reading what is inside…" and read 23 MB before anything was planned (scripts/astra/real.mjs, 2026-11-18).
// Here dts.mkv (scripts/astra/fixtures.sh) has its DTS track numbered so that no block is its own, on a browser that
// takes DTS as it is (a Media Source that says so): the hunt walks the clusters until the limit (shortened here) stops
// it; the track is left unread, the plan converts it, and the converter is given the setup its header holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.MediaSource = { isTypeSupported: (type) => /dts[cehlx]/.test(type) }; // read by capabilities.js as it loads
const { probe } = await import('../frontend/astra/src/engine/probe.js');
const { LIMIT, describeLimit } = await import('../frontend/astra/src/engine/probe-limit.js');
const { planPlayback } = await import('../frontend/astra/src/engine/plan.js');

const film = new Uint8Array(readFileSync(new URL('./fixtures/astra/dts.mkv', import.meta.url)));
// The DTS track's TrackNumber (D7 81 02, just before its codec id) becomes 9: its blocks are no longer its own.
const at = Buffer.from(film).indexOf(Buffer.from('A_DTS')), number = Buffer.from(film.subarray(at - 48, at)).lastIndexOf(Buffer.from([0xd7, 0x81, 0x02]));
assert.ok(number > 0, 'the DTS track entry is found');
film[at - 48 + number + 2] = 9;

/** A host that honours ranges and sends 16 KiB pieces as they are read, 2 ms apart. */
const fetchFn = async (url, { headers = {}, method = 'GET' }) => {
  const [, a, b] = /bytes=(\d*)-(\d*)/.exec(headers.Range || 'bytes=0-');
  const from = +a, to = b ? Math.min(+b + 1, film.length) : film.length;
  let at = from;
  const body = method === 'HEAD' ? null : new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 2)); if (at >= to) return c.close(); const n = Math.min(16384, to - at); c.enqueue(film.slice(at, at + n)); at += n; } }, { highWaterMark: 0 });
  return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${film.length}`, 'content-length': String(to - from) } });
};

test('a DTS track whose first frame is not near the start is left unread once the limit is reached, and is converted', async (t) => {
  const bytes = LIMIT.bytes;
  LIMIT.bytes = 32 << 10; // the second cluster (110 kB) is past it
  t.after(() => { LIMIT.bytes = bytes; });
  const steps = [];
  const probed = await probe('https://files.example/film.mkv', { fetchFn, onStep: (step, d) => steps.push([step, d]) });
  t.after(() => { probed.input?.dispose(); probed.source?.close(); });
  const dts = probed.info.audio.find((a) => a.codec === 'dts');
  assert.ok(dts, 'the DTS track is listed');
  assert.equal(dts.codecString, null, 'no codec string');
  assert.equal(dts.decoderConfig, null, 'no decoder setup');
  assert.equal(dts.limited, true, 'marked as left by the limit');
  assert.equal(dts.label, 'DTS', 'still named');
  assert.ok(probed.info.video[0]?.codecString?.startsWith('avc1'), 'the picture is described as before');
  const plan = planPlayback(probed, { mse: (m) => !/dts/.test(m), native: () => false, opusEncode: true, software: false });
  assert.equal(plan.audioOptions.find((o) => o.track === dts)?.delivery, 'rebuilt', 'the plan converts it');
  assert.deepEqual(await dts.ref.getDecoderConfig(), { codec: 'dtsc', numberOfChannels: dts.channels, sampleRate: dts.sampleRate }, 'the converter is given its header\'s setup');
  assert.deepEqual(steps.map(([s]) => s).filter((s) => s !== 'track'), ['open', 'index'], 'the steps the engine logs');
});

test('the limit: the part read freely is not counted; past it, a read over the bytes left is refused and those waiting are let go', async () => {
  const let_go = [];
  const source = { cachedUntil: (s) => s, letGo: (ranges, after) => let_go.push([ranges, after]) };
  const limit = describeLimit(source, () => 1000);
  let release;
  const slow = () => new Promise((r) => { release = r; });
  const read = limit.wrap((s, e) => (s === 2000 ? slow() : Promise.resolve(new Uint8Array(e - s))));
  assert.equal((await read(0, 5000)).length, 5000, 'before start(): any read');
  limit.start();
  assert.equal((await read(0, 1000)).length, 1000, 'the part read freely');
  const waiting = read(2000, 3000); // counted, and left waiting
  await assert.rejects(read(3000, 3000 + LIMIT.bytes), /took too long/, 'a read past the bytes left');
  await assert.rejects(waiting, /took too long/, 'the one waiting is let go');
  assert.deepEqual(let_go, [[[[2000, 3000]], 1000]], 'the source is told which reads and from where');
  await assert.rejects(read(0, 10), /took too long/, 'later reads are refused until the tracks are described');
  assert.equal(limit.over, true);
  limit.end();
  release(new Uint8Array(1000));
  assert.equal((await read(5000, 6000)).length, 1000, 'after end(): reads pass again');
});
