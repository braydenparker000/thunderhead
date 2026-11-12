// The compare page's pure parts (frontend/lab/editor/compare/tiles.js): which tiles a view covers, the order tiles
// are made in, the cache of finished tiles, the difference of two tiles, and the marks kept on the device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lru, TILE, cleanMarks, covered, difference, key, letters, order, plan, prune } from '../frontend/lab/editor/compare/tiles.js';

const at = (tiles) => tiles.map((t) => `${t.tx},${t.ty}`);

test('the tiles a view covers, at several zooms and at the photo\'s edges', () => {
  const W = 6000, H = 4000;
  assert.equal(TILE, 512);
  // 100 % on a 412-pixel-wide screen at 3 device pixels to a CSS pixel: 1236 photo pixels across, in the middle
  assert.deepEqual(at(covered({ x: 2382, y: 1200, w: 1236, h: 1600 }, W, H)), ['4,2', '5,2', '6,2', '7,2', '4,3', '5,3', '6,3', '7,3', '4,4', '5,4', '6,4', '7,4', '4,5', '5,5', '6,5', '7,5']);
  // 300 % of the same: a third as much, inside one tile
  assert.deepEqual(at(covered({ x: 2600, y: 2100, w: 412, h: 400 }, W, H)), ['5,4']);
  // exactly one tile: it ends where the next begins, so the next is not in view
  assert.deepEqual(at(covered({ x: 512, y: 512, w: 512, h: 512 }, W, H)), ['1,1']);
  // the top left corner, the view reaching past the photo
  assert.deepEqual(at(covered({ x: -100, y: -50, w: 600, h: 600 }, W, H)), ['0,0', '0,1']);
  // the bottom right: the last tiles are cut to the photo
  const end = covered({ x: 5500, y: 3700, w: 1000, h: 1000 }, W, H);
  assert.deepEqual(at(end), ['10,7', '11,7']);
  assert.deepEqual(end.map((t) => [t.w, t.h]), [[512, 416], [368, 416]]);
  // a photo smaller than the view, in its middle: all of it, and nothing outside
  assert.deepEqual(at(covered({ x: -200, y: -300, w: 1400, h: 1300 }, 996, 660)), ['0,0', '1,0', '0,1', '1,1']);
  assert.deepEqual(covered({ x: 7000, y: 0, w: 100, h: 100 }, W, H), []);
});

test('the method on screen is made first, then the other of the pair, then the rest; a pan drops what left the view', () => {
  const tiles = covered({ x: 0, y: 0, w: 1024, h: 512 }, 6000, 4000);
  const done = new Set([key('faster', 0, 0)]);
  const jobs = plan(tiles, ['classic', 'faster', 'network', 'camera'], 'network', 'faster', (k) => done.has(k));
  assert.deepEqual(jobs.map((j) => `${j.method}:${j.tx}`), ['network:0', 'network:1', 'faster:1', 'classic:0', 'classic:1', 'camera:0', 'camera:1']);
  // the order alone, row by row within a method
  const mixed = [{ method: 'b', tx: 1, ty: 1 }, { method: 'a', tx: 1, ty: 0 }, { method: 'c', tx: 0, ty: 0 }, { method: 'a', tx: 0, ty: 1 }];
  assert.deepEqual(order(mixed, 'a', 'b', ['c', 'b', 'a']).map((j) => `${j.method}${j.tx}${j.ty}`), ['a10', 'a01', 'b11', 'c00']);
  // after a pan only the jobs still in view stay queued
  assert.deepEqual(prune(jobs, covered({ x: 600, y: 0, w: 400, h: 400 }, 6000, 4000)).map((j) => `${j.method}:${j.tx}`), ['network:1', 'faster:1', 'classic:1', 'camera:1']);
});

test('the cache forgets the least recently used first, never a tile in view', () => {
  const gone = [], lru = new Lru(3, (v, k) => gone.push(k));
  lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
  lru.get('a');   // a is now the newest
  assert.deepEqual(lru.set('d', 4), ['b']);
  assert.deepEqual(lru.keys(), ['c', 'a', 'd']);
  // c is in view: the next oldest goes in its place
  assert.deepEqual(lru.set('e', 5, (k) => k === 'c'), ['a']);
  // every one in view: it holds more for a while rather than drop what shows
  assert.deepEqual(lru.set('f', 6, () => true), []);
  assert.equal(lru.size, 4);
  assert.deepEqual(lru.trim(), ['c']);
  assert.deepEqual(gone, ['b', 'a', 'c']);
  lru.clear();
  assert.deepEqual(gone, ['b', 'a', 'c', 'd', 'e', 'f']);
});

test('the difference of two tiles is |A - B| x 8 per channel, opaque', () => {
  const a = { width: 2, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255, 200, 0, 0, 255]) };
  const b = { width: 2, height: 1, data: new Uint8ClampedArray([12, 20, 25, 255, 0, 0, 0, 128]) };
  assert.deepEqual([...difference(a, b).data], [16, 0, 40, 255, 255, 0, 0, 255]);
});

test('blind letters are one per method and shuffled', () => {
  const l = letters(['classic', 'faster', 'network'], () => 0);
  assert.equal(new Set(Object.values(l)).size, 3);
  assert.deepEqual(Object.keys(l), ['classic', 'faster', 'network']);
});

test('marks keep only their own fields and names, and the newest 200', () => {
  const good = (i) => ({ at: 1_700_000_000_000 + i, x: 0.5, y: 0.25, zoom: 2, a: 'classic', b: 'network', picked: 'network' });
  assert.deepEqual(cleanMarks(null), []);
  assert.deepEqual(cleanMarks({ at: 1 }), []);
  const stored = [
    good(0),
    { ...good(1), name: 'IMG_0042.RAF' },   // an extra field: dropped whole
    { ...good(2), a: 'IMG_0042' },   // not a method's kind
    { ...good(3), picked: 'camera' },   // picked neither of the two
    { ...good(4), x: 1.5 },
    { at: 1, x: 0, y: 0, zoom: 1, a: 'file', b: 'camera' },   // a field missing
    'a mark', 42, null, [good(5)],
    { ...good(6), a: 'file', b: 'camera', picked: 'file' },
  ];
  assert.deepEqual(cleanMarks(stored), [good(0), { ...good(6), a: 'file', b: 'camera', picked: 'file' }]);
  const many = Array.from({ length: 250 }, (_, i) => good(i));
  const kept = cleanMarks(many);
  assert.equal(kept.length, 200);
  assert.deepEqual([kept[0].at, kept[199].at], [good(50).at, good(249).at], 'the newest are kept');
  for (const m of kept) assert.deepEqual(Object.keys(m).sort(), ['a', 'at', 'b', 'picked', 'x', 'y', 'zoom']);
});
