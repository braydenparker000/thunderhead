// Astra's range reader within a TorBox link's limits (source-gate.js, source-renew.js), against an invented host:
// never more than three requests to the film at once, playback's downloads first, side reads next and previews
// last and given up when playback needs their connection; and a link that dies while the film plays renewed
// once through the page's `renew`, every read waiting carrying on from the same place, while without `renew`,
// at the first open, or when renewing fails, the reader fails as it always did. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, HttpSource, TIMING } from '../frontend/astra/src/engine/http-source.js';
import { Gate, gated, CONNECTIONS } from '../frontend/astra/src/engine/source-gate.js';
import { renewed, dead } from '../frontend/astra/src/engine/source-renew.js';
import { SourceError } from '../frontend/astra/src/engine/source-stream.js';
import { until } from './fixtures/waits.mjs';

Object.assign(TIMING, { backoff: 10, closing: 10, renew: 300, stall: 3000 });
const SIZE = 64 * BLOCK;
const A = 'https://cdn.example/a/film.mkv', B = 'https://cdn.example/b/film.mkv';
const byteAt = (offset) => (offset * 11 + (offset >> 18)) & 255;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (bytes, start) => bytes.length > 0 && bytes.every((b, i) => b === byteAt(start + i));

/**
 * A host for one film at any address, sending 64 KiB every `pace` ms. `dead` maps an address to a status it
 * answers instead, or to 'refused' (the request fails outright). `open` is how many answers are being sent now,
 * from their headers to their last byte (or their end), and `peak` the most at once. Requests are in `calls`.
 */
function host({ pace = 2 } = {}) {
  const calls = [], dead = new Map();
  let open = 0, peak = 0;
  const fetchFn = async (url, { headers = {}, signal }) => {
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(headers.Range || 'bytes=0-');
    const from = +a, to = b ? +b + 1 : SIZE, call = { url, from, to, sent: 0 };
    calls.push(call);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (dead.get(url) === 'refused') throw new TypeError('Failed to fetch');
    if (dead.get(url)) return new Response(null, { status: dead.get(url) });
    open++; peak = Math.max(peak, open);
    let ended = false;
    const end = () => { if (!ended) { ended = true; open--; } };
    signal?.addEventListener('abort', end, { once: true });
    let at = from;
    const body = new ReadableStream({
      async pull(c) {
        await sleep(pace);
        if (signal?.aborted) { end(); return c.error(new DOMException('Aborted', 'AbortError')); }
        const piece = new Uint8Array(Math.min(64 << 10, to - at));
        for (let i = 0; i < piece.length; i++) piece[i] = byteAt(at + i);
        at += piece.length; call.sent += piece.length;
        c.enqueue(piece);
        if (at >= to) { end(); c.close(); } // the last byte sent ends the answer
      },
      cancel() { end(); },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${SIZE}`, 'content-length': String(to - from) } });
  };
  return { calls, dead, fetchFn, get open() { return open; }, get peak() { return peak; } };
}
const source = (h, more = {}) => new HttpSource(A, { fetchFn: h.fetchFn, memory: null, connection: null, ...more });

test('never more than three requests at once: playback first, side reads next, previews last and given up for playback', async () => {
  assert.equal(CONNECTIONS, 3, 'a TorBox link allows four; one is kept in hand');
  const h = host({ pace: 6 });
  const s = source(h);
  await s.open();
  await s.read(0, 16);
  // Two previews take the other two connections; a side read then has to wait.
  const previews = [s.sideRead(30 * BLOCK, 31 * BLOCK, { kind: 'preview' }), s.sideRead(33 * BLOCK, 34 * BLOCK, { kind: 'preview' })].map((p) => p.then(() => 'done', (e) => e.kind));
  const side = s.sideRead(50 * BLOCK, 50 * BLOCK + 1000);
  await until(() => h.calls.length === 3, { message: 'the previews were sent' });
  assert.equal(s.gate.held.size, 3);
  assert.equal(s.gate.waiting.length, 1, 'the side read waits');
  // Playback jumps far ahead: its download takes a preview's connection, ahead of the side read.
  const far = s.read(20 * BLOCK + 100, 20 * BLOCK + 200);
  assert.ok(same(await far, 20 * BLOCK + 100));
  assert.ok(same(await side, 50 * BLOCK));
  const order = h.calls.slice(3).map((c) => c.from);
  assert.deepEqual(order.slice(0, 2), [20 * BLOCK, 50 * BLOCK], 'playback’s request went first, then the side read');
  assert.deepEqual((await Promise.all(previews)).sort(), ['busy', 'done'], 'one preview gave its connection up');
  assert.ok(h.peak <= 3, `at most three answers at once on the host (${h.peak})`);
  assert.ok(s.gate.peak <= 3);
  s.close();
});

test('a slot is given back at the answer’s last byte, at once; one broken off a moment later; a waiter that ends leaves the queue', async () => {
  const gate = new Gate(1), fake = { gate };
  const answer = (n) => async () => new Response(new Uint8Array(n), { status: 206, headers: { 'content-length': String(n) } });
  const r = await gated(fake, 'play', null, answer(10));
  assert.equal(gate.held.size, 1);
  const reader = r.body.getReader();
  assert.equal((await reader.read()).value.length, 10);
  assert.equal(gate.held.size, 0, 'all of it here: free before the reader even sees the end');
  // A waiter whose signal ends leaves the queue; the next one gets the slot.
  const held = await gated(fake, 'play', null, answer(10));
  const controller = new AbortController();
  const quitter = gated(fake, 'side', controller.signal, answer(10));
  const next = gated(fake, 'preview', null, answer(10));
  controller.abort();
  await assert.rejects(quitter);
  assert.equal(gate.waiting.length, 1);
  await held.body.cancel(); // broken off: the slot stays TIMING.closing longer
  assert.equal(gate.held.size, 1);
  await next;
  assert.equal(gate.held.size, 1, 'the preview has it now');
  const closed = gated(fake, 'side', null, answer(10));
  gate.close();
  await assert.rejects(closed, (e) => e.kind === 'closed');
  // A request that fails outright gives its slot back too; one without a body at once.
  const lone = new Gate(1), solo = { gate: lone };
  await assert.rejects(gated(solo, 'play', null, async () => { throw new TypeError('Failed to fetch'); }));
  await until(() => lone.held.size === 0);
  await gated(solo, 'play', null, async () => new Response(null, { status: 200 }));
  assert.equal(lone.held.size, 0);
});

test('a link that dies after the film opened is renewed once for every read waiting, and reading goes on from the same place', async () => {
  const h = host();
  let asked = 0;
  const states = [];
  const s = source(h, { renew: async () => { asked++; await sleep(30); return B; } });
  s.onState((x) => states.push(x));
  await s.open();
  assert.ok(same(await s.read(0, 300_000), 0));
  h.dead.set(A, 403);
  const reads = [s.read(20 * BLOCK + 5, 20 * BLOCK + 50), s.read(40 * BLOCK + 5, 40 * BLOCK + 50)];
  const [x, y] = await Promise.all(reads);
  assert.ok(same(x, 20 * BLOCK + 5) && same(y, 40 * BLOCK + 5), 'both reads got their bytes');
  assert.equal(asked, 1, 'one renewal for both');
  assert.deepEqual([s.url, s.given], [B, B], 'the address given and the one read both moved');
  assert.ok(h.calls.some((c) => c.url === B && c.from === 20 * BLOCK) && h.calls.some((c) => c.url === B && c.from === 40 * BLOCK));
  assert.ok(s.has(0, 300_000), 'what was held stays');
  assert.deepEqual(states, [], 'nothing shown: no reconnecting');
  assert.equal(s.failures, 0);
  // A side read (a preview, the hash) on a dead address is renewed as well, at most once a minute.
  h.dead.set(B, 410);
  assert.equal(await renewed(s), false, 'not twice in a minute');
  s.renewedAt -= 60_000;
  s.renew = async () => { asked++; return A.replace('/a/', '/c/'); };
  assert.ok(same(await s.sideRead(10 * BLOCK, 10 * BLOCK + 99, { kind: 'preview' }), 10 * BLOCK));
  assert.equal(asked, 2);
  assert.match(s.url, /\/c\//);
  s.close();
});

test('a refused connection is renewed once it is refused again; a dead answer at once', async () => {
  assert.equal(dead(new SourceError('status', 'x', 403)), 'status');
  assert.equal(dead(new SourceError('status', 'x', 503)), '');
  assert.equal(dead(new SourceError('stall', 'x')), '');
  assert.equal(dead(new TypeError('Failed to fetch')), 'refused');
  const h = host();
  let asked = 0;
  const s = source(h, { renew: async () => { asked++; return B; } });
  await s.open();
  await s.read(0, 16);
  h.dead.set(A, 'refused');
  assert.ok(same(await s.read(30 * BLOCK, 30 * BLOCK + 10), 30 * BLOCK));
  assert.equal(h.calls.filter((c) => c.url === A && c.from === 30 * BLOCK).length, 2, 'asked twice before renewing');
  assert.equal(asked, 1);
  s.close();
});

test('without renew, at the first open, when renewing fails or the fresh address is dead too: the reader fails as it did', async () => {
  // The first open: the existing error, no renewal.
  let asked = 0;
  const h1 = host();
  h1.dead.set(A, 403);
  const first = source(h1, { renew: async () => { asked++; return B; } });
  // (a dead link at the first open is 'gone', which leads to choosing another source)
  await assert.rejects(first.open(), (e) => e.kind === 'gone' && e.detail === 403);
  assert.equal(asked, 0);
  // No renew, a renew that throws, one that gives nothing in time, one whose address is dead too.
  const ways = [
    ['no renew', null, 0],
    ['renew throws', async () => { asked++; throw new Error('not signed in'); }, 1],
    ['renew never answers', () => { asked++; return new Promise(() => {}); }, 1],
    ['the fresh address is dead too', async () => { asked++; return B; }, 1],
  ];
  for (const [name, renew, times] of ways) {
    asked = 0;
    const h = host();
    const s = source(h, { renew });
    await s.open();
    await s.read(0, 16);
    h.dead.set(A, 403); h.dead.set(B, 410);
    await assert.rejects(s.read(25 * BLOCK, 25 * BLOCK + 10), (e) => e.kind === 'status' && [403, 410].includes(e.detail), name);
    assert.equal(asked, times, `${name}: asked ${times} time(s)`);
    s.close();
  }
});
