#!/usr/bin/env node
// One part of the site and mind suites, so CI can run the parts at once (TESTING.md §1.1,
// .github/workflows/checks.yml). The test files are dealt by how long each took in one measured full
// run (scripts/test-durations.json), those that draw on the software GPU first, then largest first, each
// to the part with the least time so far, so the parts take about as long and share the slow files; a
// file the table doesn't know yet counts by its size at the table's own rate. Every file lands in exactly one part; `npm test` still runs them all in one go. Within a
// part the files that draw on the software GPU (`heavy`) run after the others, one at a time.
// Usage: node scripts/test-part.mjs <k> <n>   (part k of n, from 1)
//        node scripts/test-part.mjs --measure (runs every file once and rewrites the table)
// As a test reporter (--measure passes it to node --test), it writes each file's time to its destination.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['tests', 'mind/tests'];
const TABLE = join(ROOT, 'scripts/test-durations.json');

/** Every test file, relative to the repository root, sorted. */
export function testFiles(root = ROOT) {
  return DIRS.flatMap((d) =>
    readdirSync(join(root, d))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => `${d}/${f}`),
  ).sort();
}

/** The measured milliseconds per test file (scripts/test-durations.json). @returns {Record<string, number>} */
export function durations(table = TABLE) {
  return JSON.parse(readFileSync(table, 'utf8')).ms;
}

/**
 * Each file's weight: its measured milliseconds, or, for a file the table doesn't have yet, its bytes
 * at the measured files' own milliseconds per byte. The same on every machine (the table and the
 * checked-out files are). @param {string[]} files @param {Record<string, number>} [ms]
 * @returns {{ file: string, weight: number }[]}
 */
export function weights(files, ms = durations(), root = ROOT) {
  const bytes = (f) => statSync(join(root, f)).size;
  const known = files.filter((f) => f in ms);
  const rate = known.reduce((s, f) => s + ms[f], 0) / Math.max(1, known.reduce((s, f) => s + bytes(f), 0));
  return files.map((file) => ({ file, weight: file in ms ? ms[file] : Math.round(bytes(file) * rate) }));
}

/**
 * The files dealt into `n` parts by weight, largest first, each to the lightest part so far (ties by
 * name, so every machine deals alike). The files that draw on the software GPU (`heavy`) are dealt
 * first, among themselves: a part runs its own one after another, so no part may be given most of them
 * (one was, and its job ran out of time). @param {{ file: string, weight: number }[]} files @param {number} n
 * @returns {string[][]}
 */
export function deal(files, n) {
  const parts = Array.from({ length: n }, () => ({ weight: 0, files: /** @type {string[]} */ ([]) }));
  const order = [...files].sort((a, b) => Number(heavy(b.file)) - Number(heavy(a.file)) || b.weight - a.weight || (a.file < b.file ? -1 : 1));
  for (const f of order) {
    const lightest = parts.reduce((min, p) => (p.weight < min.weight ? p : min));
    lightest.weight += f.weight;
    lightest.files.push(f.file);
  }
  return parts.map((p) => p.files.sort());
}

/** Whether a test file draws on the software GPU (the editor's and the engine's browser tests): each keeps every
 * core busy for minutes, and a test beside one has waited past its own limits (a page's 15 s wait, twice in CI).
 * A part runs these after its other files, one at a time. @param {string} file */
export const heavy = (file) => /^tests\/lab-.*-browser\.test\.mjs$/.test(file);

/** The reporter for --measure: each file's top-level tests' time, plus its start-up (the gap between
 * the runner starting the file and its first test), as { file: ms }. @param {AsyncIterable<any>} source */
export default async function* reporter(source) {
  /** @type {Record<string, number>} */
  const ms = {};
  for await (const e of source) {
    if ((e.type === 'test:pass' || e.type === 'test:fail') && e.data.nesting === 0 && e.data.file) {
      const file = relative(ROOT, e.data.file);
      ms[file] = (ms[file] ?? 0) + (e.data.details?.duration_ms ?? 0);
    }
  }
  yield JSON.stringify(ms);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && process.argv[2] === '--measure') {
  // One full run, as `npm test` runs the site and mind suites, with this module as a second reporter.
  const out = join(tmpdir(), `th-test-durations-${process.pid}.json`);
  const files = testFiles();
  const run = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${fileURLToPath(import.meta.url)}`, `--test-reporter-destination=${out}`, ...files], { cwd: ROOT, stdio: 'inherit' });
  const measured = JSON.parse(readFileSync(out, 'utf8'));
  // Each file also costs its process and its hooks (a browser's launch): one second, by the table's rule.
  const ms = Object.fromEntries(files.filter((f) => f in measured).map((f) => [f, Math.round((measured[f] + 1000) / 100) * 100]));
  const note = 'Milliseconds per test file from one full local run (node scripts/test-part.mjs --measure): each file\'s top-level tests plus one second for its process and hooks. scripts/test-part.mjs deals CI\'s parts by these.';
  writeFileSync(TABLE, `${JSON.stringify({ note, ms }, null, 2)}\n`);
  console.log(`measured ${Object.keys(ms).length} of ${files.length} test files into scripts/test-durations.json`);
  process.exit(run.status ?? 1);
} else if (isMain) {
  const [k, n] = process.argv.slice(2).map(Number);
  if (!(Number.isInteger(n) && n >= 1 && Number.isInteger(k) && k >= 1 && k <= n)) {
    console.error('usage: node scripts/test-part.mjs <k> <n>  |  node scripts/test-part.mjs --measure');
    process.exit(2);
  }
  const all = testFiles();
  const mine = deal(weights(all), n)[k - 1], light = mine.filter((f) => !heavy(f)), slow = mine.filter(heavy);
  console.log(`part ${k} of ${n}: ${mine.length} of ${all.length} test files (${slow.length} of them on the software GPU, run after the rest, one at a time)`);
  // --test-force-exit: a browser a failed test left open ends with the run, not at CI's timeout.
  // --test-timeout: a test with no limit of its own that stops answering (a browser that stalled: CI, 2026-11-14,
  // thirteen silent minutes until the job's limit cancelled the part) fails in three minutes, by name.
  const run = (/** @type {string[]} */ files, /** @type {string[]} */ more = []) => (files.length ? spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-timeout=180000', ...more, ...files], { cwd: ROOT, stdio: 'inherit' }).status ?? 1 : 0);
  const first = run(light), second = run(slow, ['--test-concurrency=1']);
  process.exit(first || second);
}
