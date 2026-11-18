// Astra's range reader (frontend/astra/src/engine/http-source.js) against an invented host: after a
// seek, the reads the dropped pipelines were waiting for end and their downloads are closed, so the
// place playback jumped to has the whole connection; the same bytes can be read again afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, HttpSource, TIMING } from '../frontend/astra/src/engine/http-source.js';

const SIZE = 40 * BLOCK;
const byteAt = (offset) => (offset * 7 + (offset >> 20)) & 255;

/** A host that honours ranges and sends slowly, in 256 KiB pieces; `calls` records each request. */
function host() {
  const calls = [];
  const fetchFn = async (url, { headers, signal }) => {
    const from = Number(/bytes=(\d+)-/.exec(headers.Range)[1]);
    const call = { from, sent: 0, closed: () => signal.aborted || call.cancelled };
    calls.push(call);
    let at = from;
    const body = new ReadableStream({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 2));
        if (signal.aborted) return controller.error(new DOMException('Aborted', 'AbortError'));
        if (at >= SIZE) return controller.close();
        const piece = new Uint8Array(Math.min(256 << 10, SIZE - at));
        for (let i = 0; i < piece.length; i++) piece[i] = byteAt(at + i);
        at += piece.length; call.sent += piece.length;
        controller.enqueue(piece);
      },
      cancel() { call.cancelled = true; }, // the first download is closed through its reader, the rest by their signal
    });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${SIZE - 1}/${SIZE}`, 'content-length': String(SIZE - from), 'content-type': 'video/x-matroska' } });
  };
  return { calls, fetchFn };
}

test('a read returns the file’s bytes, across blocks', async () => {
  const { fetchFn } = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  assert.equal((await source.open()).size, SIZE);
  const bytes = await source.read(BLOCK - 3, BLOCK + 3);
  assert.deepEqual([...bytes], [BLOCK - 3, BLOCK - 2, BLOCK - 1, BLOCK, BLOCK + 1, BLOCK + 2].map(byteAt));
  source.close();
});

test('after a jump: waiting reads end as closed, their downloads stop, and reading goes on elsewhere', async () => {
  const { calls, fetchFn } = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  await source.read(0, 16);
  // A pipeline far ahead of the start, waiting for a block that has not arrived...
  const waiting = source.read(10 * BLOCK, 10 * BLOCK + 8);
  const before = calls.length;
  // ...when the viewer seeks.
  source.jumped();
  await assert.rejects(waiting, (error) => error.kind === 'closed');
  assert.equal(source.streams.size, 0, 'no download is left open');
  for (const call of calls.slice(0, before)) assert.equal(call.closed(), true, `the download from byte ${call.from} was closed`);
  // The new place is read by a download of its own.
  const there = await source.read(30 * BLOCK + 5, 30 * BLOCK + 9);
  assert.deepEqual([...there], [5, 6, 7, 8].map((i) => byteAt(30 * BLOCK + i)));
  assert.equal(calls.at(-1).from, 30 * BLOCK);
  // What was being waited for can be read again later: the ended read left nothing behind.
  const again = await source.read(10 * BLOCK, 10 * BLOCK + 4);
  assert.deepEqual([...again], [0, 1, 2, 3].map((i) => byteAt(10 * BLOCK + i)));
  // The closed downloads did not go on sending in the background.
  const sent = calls.slice(0, before).map((c) => c.sent);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls.slice(0, before).map((c) => c.sent), sent);
  source.close();
});

test('a scanner that looks at every block as it lands does not pull the download along: it pauses at the read-ahead limit', async () => {
  const { calls, fetchFn } = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  await source.read(0, 16); // playback has read the first block, and is paused there
  // The subtitle scanner's way: every block that lands is looked at, as a whole and across its edge.
  let looked = 0;
  source.onBlock((i) => { if (source.peek(i * BLOCK, (i + 1) * BLOCK) && (i === 0 || source.peek(i * BLOCK - 3, i * BLOCK + 3))) looked++; });
  await new Promise((r) => setTimeout(r, 600));
  const cached = source.cachedBlocks();
  assert.ok(looked >= 20, `the scanner saw the blocks (${looked})`);
  assert.ok(Math.max(...cached) <= 26, `the download stopped near 24 MiB past what was read, not at the end (block ${Math.max(...cached)})`);
  assert.equal(calls.length, 1, 'and nothing was fetched twice');
  // Peeking leaves the cache's order alone: the block read longest ago is still the first to go.
  source.peek(0, 4);
  assert.equal(source.cachedBlocks()[0], 0);
  assert.equal(source.peek(39 * BLOCK, 39 * BLOCK + 4), null, 'a block not here is not fetched for a peek');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!source.cachedBlocks().includes(39));
  source.close();
});

test('a host busy at the first ask (429 while a link’s connections close, 503) is asked again; one that stays busy is refused', async (t) => {
  const pause = TIMING.backoff;
  TIMING.backoff = 2;
  t.after(() => { TIMING.backoff = pause; });
  for (const status of [429, 503]) {
    const { calls, fetchFn } = host();
    let busy = 2;
    const source = new HttpSource('https://files.example/film.mkv', { fetchFn: (url, init) => (busy-- > 0 ? Promise.resolve(new Response('busy', { status })) : fetchFn(url, init)) });
    assert.equal((await source.open()).size, SIZE, `${status} twice, then the film`);
    assert.equal(calls.length, 1);
    source.close();
  }
  let asked = 0;
  const never = new HttpSource('https://files.example/film.mkv', { fetchFn: async () => { asked++; return new Response('busy', { status: 429 }); } });
  await assert.rejects(never.open(), (error) => error.kind === 'status' && /429/.test(error.message));
  assert.equal(asked, 4, 'the first ask and three more');
  never.close();
});
