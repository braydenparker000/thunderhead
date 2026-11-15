// How many cores the software decoder may use (frontend/astra/src/engine/software-threads.js): one fewer
// than the phone has and at most 4, only on a cross-origin isolated page, set through libmedia's own
// switches before its script loads; the script every libmedia worker runs first tells it that number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import vm from 'node:vm';
import { THREADS, threadCap, prepareThreads, threadsReport } from '../frontend/astra/src/engine/software-threads.js';

const page = (isolated, cores) => ({ crossOriginIsolated: isolated, SharedArrayBuffer: isolated ? SharedArrayBuffer : undefined, navigator: { hardwareConcurrency: cores } });

test('one core fewer than the phone has, at most 4, at least 1', () => {
  assert.deepEqual([8, 6, 5, 4, 2, 1, 0, undefined].map(threadCap), [4, 4, 4, 3, 1, 1, 1, 1]);
});

test('a page that is not isolated: one thread, and libmedia\'s switches are left alone', () => {
  const scope = page(false, 8);
  assert.equal(prepareThreads(scope), 1);
  assert.equal(scope.CHEAP_DISABLE_THREAD, undefined);
  assert.equal(scope.CHEAP_POLYFILL_URL, undefined);
  assert.match(threadsReport(scope), /^Not isolated: one core/);
});

test('isolated with threads off (as shipped): libmedia is told to stay on one thread', () => {
  assert.equal(THREADS, false, 'off until they show a picture as soon as one thread does');
  const scope = page(true, 8);
  assert.equal(prepareThreads(scope), 1);
  assert.equal(scope.CHEAP_DISABLE_THREAD, true);
});

test('isolated: every libmedia worker is told the phone has 4 cores (of 8), once', async () => {
  const scope = page(true, 8);
  assert.equal(prepareThreads(scope, true), 4);
  const url = scope.CHEAP_POLYFILL_URL;
  assert.equal(prepareThreads(scope, true), 4);
  assert.equal(scope.CHEAP_POLYFILL_URL, url, 'one script for the page');
  const code = await resolveObjectURL(url).text();
  const worker = { navigator: { hardwareConcurrency: 8 } };
  vm.runInNewContext(code, { self: worker });
  assert.equal(worker.navigator.hardwareConcurrency, 4);
  assert.equal(threadsReport(scope, true), 'Isolated: up to 4 of 8 cores');
});
