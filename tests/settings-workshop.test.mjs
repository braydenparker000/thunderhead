// The rules of sending a file to the workshop, without a browser (frontend/apps/settings/workshop-send.js):
// what is refused, which stored file a picked one is, only the missing pieces sent, each with its own
// SHA-256, each tried up to four times (waits of 1 s, 5 s, 15 s), with byte progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FILE_BYTES, known, partsOf, refuse, sendFile, sizeOf, WAITS } from '../frontend/apps/settings/workshop-send.js';

const hash = async (blob) => createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');

test('a picked file: anything but an empty one, up to 512 MB; sizes in words', () => {
  assert.equal(refuse({ size: 0 }), 'That file is empty.');
  assert.equal(refuse({ size: FILE_BYTES + 1 }), 'That file is over 512 MB.');
  assert.equal(refuse({ size: FILE_BYTES }), null);
  assert.deepEqual([partsOf(1, 8), partsOf(16, 8), partsOf(17, 8)], [1, 2, 3]);
  assert.deepEqual([512, 4096, 40_100_000, 4 * 1024 ** 3].map(sizeOf), ['512 B', '4 KB', '38.2 MB', '4 GB']);
});

test('a file with the same name and size is the one already there, so it goes on from where it stopped', () => {
  const items = [{ id: 'a', name: 'DSCF0001.RAF', bytes: 40 }, { id: 'b', name: 'DSCF0002.RAF', bytes: 40 }];
  assert.equal(known(items, { name: 'DSCF0002.RAF', size: 40 })?.id, 'b');
  assert.equal(known(items, { name: 'DSCF0002.RAF', size: 41 }), null);
  assert.equal(known(items, { name: 'DSCF0003.RAF', size: 40 }), null);
});

test('only the missing pieces are sent, each with its own hash, with byte progress', async () => {
  const bytes = Uint8Array.from({ length: 25 }, (_, i) => i * 7);
  const file = new Blob([bytes]), sent = [], progress = [];
  const have = await sendFile({
    file, id: 'f', partBytes: 10, have: [2], hash, onProgress: (p) => progress.push(p),
    put: async (id, n, blob, sha, onSent) => {
      onSent(blob.size / 2);
      sent.push([id, n, blob.size, sha === createHash('sha256').update(bytes.subarray((n - 1) * 10, n * 10)).digest('hex')]);
      return { have: [n] };
    },
  });
  assert.deepEqual(sent, [['f', 1, 10, true], ['f', 3, 5, true]]);
  assert.deepEqual(have, [1, 2, 3]);
  assert.deepEqual(progress, [0.4, 0.6, 0.8, 0.9, 1]);
});

test('a piece that fails is tried again after 1 s, 5 s and 15 s, then the file stops; a refusal stops at once', async () => {
  const file = new Blob([new Uint8Array(12)]), waits = [];
  let tries = 0;
  const flaky = async () => { if (++tries < 4) throw Object.assign(new Error('busy'), { status: 503 }); return { have: [1] }; };
  assert.deepEqual(await sendFile({ file, id: 'f', partBytes: 20, have: [], hash, put: flaky, wait: async (ms) => { waits.push(ms); } }), [1]);
  assert.deepEqual(waits, WAITS);
  tries = 0;
  const down = async () => { tries++; throw Object.assign(new Error('network'), { status: 0 }); };
  await assert.rejects(sendFile({ file, id: 'f', partBytes: 20, have: [], hash, put: down, wait: async () => {} }), /network/);
  assert.equal(tries, 4);
  tries = 0;
  const refused = async () => { tries++; throw Object.assign(new Error('validation'), { status: 422 }); };
  await assert.rejects(sendFile({ file, id: 'f', partBytes: 20, have: [], hash, put: refused, wait: async () => {} }), /validation/);
  assert.equal(tries, 1);
});
