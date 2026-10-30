#!/usr/bin/env node
// One part of the site and mind suites, so CI can run the parts at once (TESTING.md §1.1,
// .github/workflows/checks.yml). The test files are dealt by size, largest first, each to the part
// with the fewest bytes so far: size follows run time closely enough that the parts take about as
// long, with no timing table to keep up to date. Every file lands in exactly one part; `npm test`
// still runs them all in one go.
// Usage: node scripts/test-part.mjs <k> <n>   (part k of n, from 1)
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['tests', 'mind/tests'];

/** Every test file, relative to the repository root, sorted. */
export function testFiles(root = ROOT) {
  return DIRS.flatMap((d) =>
    readdirSync(join(root, d))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => `${d}/${f}`),
  ).sort();
}

/**
 * The files dealt into `n` parts by size (ties by name, so every machine deals alike).
 * @param {{ file: string, bytes: number }[]} files @param {number} n @returns {string[][]}
 */
export function deal(files, n) {
  const parts = Array.from({ length: n }, () => ({ bytes: 0, files: /** @type {string[]} */ ([]) }));
  const order = [...files].sort((a, b) => b.bytes - a.bytes || (a.file < b.file ? -1 : 1));
  for (const f of order) {
    const lightest = parts.reduce((min, p) => (p.bytes < min.bytes ? p : min));
    lightest.bytes += f.bytes;
    lightest.files.push(f.file);
  }
  return parts.map((p) => p.files.sort());
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [k, n] = process.argv.slice(2).map(Number);
  if (!(Number.isInteger(n) && n >= 1 && Number.isInteger(k) && k >= 1 && k <= n)) {
    console.error('usage: node scripts/test-part.mjs <k> <n>');
    process.exit(2);
  }
  const files = testFiles().map((file) => ({ file, bytes: statSync(join(ROOT, file)).size }));
  const mine = deal(files, n)[k - 1];
  console.log(`part ${k} of ${n}: ${mine.length} of ${files.length} test files`);
  const run = spawnSync(process.execPath, ['--test', ...mine], { cwd: ROOT, stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
