// An add-on's JSON answer (frontend/astra/src/addons/client.js getJson): read whole when it is a fair size,
// refused in plain words when it says or turns out to be larger than 5 MB, and a stream that never ends is cut
// there instead of filling the phone's memory. The add-on is invented; fetch is stood in for.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, MAX_ANSWER } from '../frontend/astra/src/addons/client.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const answer = (body, init = {}) => { globalThis.fetch = async () => new Response(body, init); };

test('a fair answer is read whole, a UTF-8 one across its pieces', async () => {
  const text = JSON.stringify({ metas: [{ id: 'tt1', name: 'Café — 東京' }] });
  const bytes = new TextEncoder().encode(text);
  // Pieces that split a character in two.
  answer(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.subarray(i, i + 3)); c.close(); } }));
  assert.deepEqual(await getJson('https://addon.example/catalog/movie/top.json'), JSON.parse(text));
});

test('an answer that says it is larger than 5 MB is refused before it is read', async () => {
  let pulled = 0;
  answer(new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }), { headers: { 'content-length': String(MAX_ANSWER + 1) } });
  await assert.rejects(getJson('https://addon.example/meta/movie/tt1.json'), { message: 'The add-on sent too much (more than 5 MB).', kind: 'size' });
  assert.ok(pulled <= 2, `next to nothing was read (${pulled} pieces)`);
});

test('an answer that never ends is cut at 5 MB', async () => {
  let sent = 0, cancelled = false;
  answer(new ReadableStream({ pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536).fill(32)); }, cancel() { cancelled = true; } }));
  await assert.rejects(getJson('https://addon.example/stream/movie/tt1.json'), { kind: 'size' });
  assert.ok(sent <= MAX_ANSWER + 3 * 65536, `stopped at the limit (${(sent / 1048576).toFixed(2)} MB sent)`);
  assert.ok(cancelled, 'and the download is closed');
});

test('failures keep their plain words', async () => {
  answer('nope', { status: 404 });
  await assert.rejects(getJson('https://addon.example/manifest.json'), { message: 'The add-on answered 404.', kind: 'http' });
  answer('<html>not json</html>');
  await assert.rejects(getJson('https://addon.example/manifest.json'), { message: "That page isn't an add-on manifest.", kind: 'SyntaxError' });
});
