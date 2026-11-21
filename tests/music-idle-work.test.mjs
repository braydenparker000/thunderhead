// Music's idle work (frontend/music/src/view/idle-work.js; MUSIC.md §5.11 "Idle work"): pieces run in idle
// callbacks, none within 300 ms of an input nor while a transition moves or a list scrolls, back to back
// only within an 8 ms slice; each piece is named for the recorder (ui/long-work.js), which names a long
// task after start-up by the idle job that ran in it. Node, with a stand-in requestIdleCallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ timeRemaining: () => 40, didTimeout: false }), 1);
const { idleWork, noteInput, busy, QUIET_MS, SLICE_MS } = await import('../frontend/music/src/view/idle-work.js');
const { longWork, idleAt } = await import('../frontend/music/src/ui/long-work.js');

const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };
const until = async (f, ms = 3000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };

test('no piece within 300 ms of an input, nor while a transition moves or a list scrolls; then all run', async () => {
  const ctx = { moving: new Set(['scene']), listWidget: { libList: { _fling: null } } };
  const ran = [];
  noteInput();
  const t0 = performance.now();
  const done = idleWork(ctx, 'test-a', [1, 2, 3].map((k) => () => ran.push([k, performance.now() - t0])));
  await new Promise((r) => setTimeout(r, QUIET_MS + 100));
  assert.deepEqual(ran, [], 'a transition moves: nothing');
  ctx.moving.clear();
  ctx.listWidget.libList._fling = {};
  assert.equal(busy(ctx), true, 'a fling counts');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(ran, []);
  ctx.listWidget.libList._fling = null;
  await done;
  assert.deepEqual(ran.map((r) => r[0]), [1, 2, 3]);
  assert.ok(ran[0][1] >= QUIET_MS, 'not within 300 ms of the input');
});

test('pieces back to back only within a slice: a long piece yields at once', async () => {
  const ctx = { moving: new Set() };
  const calls = [];
  let cb = 0;
  const real = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => setTimeout(() => { cb++; fn({ timeRemaining: () => 40, didTimeout: false }); }, 1);
  try {
    await new Promise((r) => setTimeout(r, QUIET_MS));
    await idleWork(ctx, 'test-b', [0, 1, 2, 3].map((k) => () => { calls.push([k, cb]); spin(SLICE_MS + 2); }));
  } finally {
    globalThis.requestIdleCallback = real;
  }
  // Each piece is over the slice: one piece per idle callback.
  assert.equal(new Set(calls.map((c) => c[1])).size, 4);
});

test('a long task is named by the idle piece that ran in it; each job keeps its longest piece', async () => {
  const ctx = { moving: new Set() };
  await new Promise((r) => setTimeout(r, QUIET_MS));
  let at = 0;
  await idleWork(ctx, 'test-c', [() => { at = performance.now(); spin(25); }]);
  await until(() => longWork.longestPiece['test-c'] >= 25);
  assert.equal(idleAt(at + 5, 60), 'idle:test-c');
  assert.equal(idleAt(at + 1000, 60), '');
});

test('the screens built ahead go before spare rows already queued (a transition needs them first)', async () => {
  const ctx = { moving: new Set() };
  await new Promise((r) => setTimeout(r, QUIET_MS));
  const order = [];
  const rows = idleWork(ctx, 'spare-rows', Array.from({ length: 6 }, (_, k) => () => { order.push('row' + k); spin(SLICE_MS + 1); }));
  const screens = idleWork(ctx, 'prebuild', [() => order.push('screen1'), () => order.push('screen2')]);
  await screens;
  assert.ok(order.indexOf('screen2') < 3, `screens first: ${order.join(' ')}`);
  await rows;
  assert.deepEqual(order.filter((x) => x.startsWith('row')), ['row0', 'row1', 'row2', 'row3', 'row4', 'row5'], 'each job keeps its order');
});
