// CI's test parts (scripts/test-part.mjs): every test file runs in exactly one part, and the parts
// are about the same size.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import { deal, testFiles } from '../scripts/test-part.mjs';

test('every test file lands in exactly one of the three parts', () => {
  const files = testFiles();
  assert.ok(files.includes('tests/test-part.test.mjs') && files.includes('mind/tests/th.test.mjs'));
  const parts = deal(
    files.map((file) => ({ file, bytes: statSync(file).size })),
    3,
  );
  assert.deepEqual(parts.flat().sort(), files);
  assert.equal(new Set(parts.flat()).size, files.length);
  const sizes = parts.map((p) => p.reduce((s, f) => s + statSync(f).size, 0));
  assert.ok(Math.max(...sizes) < 1.25 * Math.min(...sizes), `parts of ${sizes.join(', ')} bytes`);
});

test('the deal is the same on every machine: largest first, ties by name', () => {
  const files = [
    { file: 'b', bytes: 5 },
    { file: 'a', bytes: 5 },
    { file: 'c', bytes: 9 },
    { file: 'd', bytes: 1 },
  ];
  assert.deepEqual(deal(files, 2), [['c', 'd'], ['a', 'b']]);
  assert.deepEqual(deal(files, 1), [['a', 'b', 'c', 'd']]);
});
