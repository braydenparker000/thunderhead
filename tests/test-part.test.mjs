// CI's test parts (scripts/test-part.mjs): every test file runs in exactly one part, and the parts
// take about as long by the measured table (scripts/test-durations.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deal, durations, testFiles, weights } from '../scripts/test-part.mjs';

/** The site parts in .github/workflows/checks.yml: "site k/n" in its matrix. */
const PARTS = Number(/part: \[site 1\/(\d+)/.exec(readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8'))?.[1]);

test('every test file lands in exactly one of the four parts', () => {
  assert.equal(PARTS, 4, 'checks.yml runs the site and mind suites in four parts');
  const files = testFiles();
  assert.ok(files.includes('tests/test-part.test.mjs') && files.includes('mind/tests/th.test.mjs'));
  const weighed = weights(files);
  const parts = deal(weighed, PARTS);
  assert.equal(parts.length, PARTS);
  assert.deepEqual(parts.flat().sort(), files);
  assert.equal(new Set(parts.flat()).size, files.length);
  const of = new Map(weighed.map((w) => [w.file, w.weight]));
  const ms = parts.map((p) => p.reduce((s, f) => s + of.get(f), 0));
  assert.ok(Math.max(...ms) < 1.25 * Math.min(...ms), `parts of ${ms.join(', ')} ms`);
});

test('the deal is the same on every machine: largest first, ties by name', () => {
  const files = [
    { file: 'b', weight: 5 },
    { file: 'a', weight: 5 },
    { file: 'c', weight: 9 },
    { file: 'd', weight: 1 },
  ];
  assert.deepEqual(deal(files, 2), [['c', 'd'], ['a', 'b']]);
  assert.deepEqual(deal(files, 1), [['a', 'b', 'c', 'd']]);
});

test('the measured table names only test files that exist, and a file it lacks still weighs', () => {
  const files = testFiles();
  const ms = durations();
  assert.deepEqual(Object.keys(ms).filter((f) => !files.includes(f)), [], 'a test file left the repository: run node scripts/test-part.mjs --measure');
  assert.ok(Object.values(ms).every((v) => Number.isInteger(v) && v > 0));
  // A new file, not measured yet, counts by its size at the table's own rate: never zero.
  const [estimated] = weights(['tests/test-part.test.mjs', 'tests/site.test.mjs'], { 'tests/site.test.mjs': 1000 });
  assert.ok(estimated.weight > 0, 'an unmeasured file weighs by its bytes');
});
