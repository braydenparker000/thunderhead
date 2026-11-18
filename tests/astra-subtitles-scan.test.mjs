// The film's own text subtitles gathered as its blocks land (frontend/astra/src/engine/embedded-subtitles.js), on
// tests/fixtures/astra/multi.mkv in small blocks with an invented cache standing in for the range reader: every line
// is found, block by block in order and after a jump, and only the blocks no known cluster covers are searched byte
// by byte (each cluster names the next): that search on every block was most of the scan's cost on a 25 Mbit/s film.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLayout, subtitleTracks } from '../frontend/astra/src/engine/mkv.js';
import { MkvSubtitleScanner } from '../frontend/astra/src/engine/embedded-subtitles.js';

const bytes = new Uint8Array(readFileSync(new URL('./fixtures/astra/multi.mkv', import.meta.url)));
const BLOCK = 16 << 10;
const settle = () => new Promise((r) => setTimeout(r, 60));

/** A cache of `bytes` in BLOCK-sized blocks: `land(i)` stores one and tells the listeners, as the reader does. */
function cache() {
  const have = new Set(), listeners = new Set();
  const all = (s, e) => { for (let i = Math.floor(s / BLOCK); i <= Math.floor((Math.max(s, e - 1)) / BLOCK); i++) if (!have.has(i)) return false; return true; };
  return {
    size: bytes.length, blockSize: BLOCK,
    has: (s, e) => all(s, e), peek: (s, e) => (all(s, e) ? bytes.subarray(s, e) : null),
    onBlock: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, cachedBlocks: () => [...have],
    land(i) { have.add(i); for (const fn of listeners) fn(i); },
  };
}

/** Scans with the blocks landing in `order`; `search` false searches every block (the old way). */
async function scan(order, search = true) {
  const layout = await readLayout(async (s, e) => bytes.slice(s, e), bytes.length);
  const source = cache(), lines = [], searched = [];
  const scanner = new MkvSubtitleScanner(source, layout, subtitleTracks(layout).filter((t) => !t.image), (id, cues) => lines.push(...cues));
  const discover = scanner.discover.bind(scanner);
  scanner.discover = (i) => { searched.push(i); return discover(i); };
  if (!search) scanner.covered = () => false;
  scanner.start();
  for (const i of order) { source.land(i); await new Promise((r) => setTimeout(r, 1)); }
  await settle();
  scanner.stop();
  const text = lines.map((c) => `${c.start.toFixed(2)} ${c.spans.map((s) => s.text).join('')}`).sort();
  return { text, searched: [...new Set(searched)].length, blocks: order.length };
}

test('every line is found from blocks landing in order, searching only the blocks no known cluster covers', async () => {
  const order = Array.from({ length: Math.ceil(bytes.length / BLOCK) }, (_, i) => i);
  const old = await scan(order, false), now = await scan(order);
  assert.equal(old.text.length, 3, 'the film\'s three lines');
  assert.deepEqual(now.text, old.text, 'the same lines as searching every block');
  assert.equal(old.searched, old.blocks);
  assert.ok(now.searched <= 3, `${now.searched} of ${now.blocks} blocks searched byte by byte`);
});

test('after a jump into the middle (a seek) and back, the same lines', async () => {
  const n = Math.ceil(bytes.length / BLOCK), mid = n >> 1;
  const order = [...Array.from({ length: n - mid }, (_, i) => mid + i), ...Array.from({ length: mid }, (_, i) => i)];
  const old = await scan(order, false), now = await scan(order);
  assert.deepEqual(now.text, old.text);
  assert.ok(now.searched < old.searched / 2, `${now.searched} of ${now.blocks} searched`);
});
