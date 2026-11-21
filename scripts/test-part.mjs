#!/usr/bin/env node
// One part of the site and mind suites, so CI can run the parts at once (TESTING.md §1.1,
// .github/workflows/checks.yml). The test files are dealt by how long each took in one measured full
// run (scripts/test-durations.json), those that draw on the software GPU first, then largest first, each
// to the part with the least time so far, so the parts take about as long and share the slow files; a
// file the table doesn't know yet counts as the table's median file. Every file lands in exactly one part; `npm test` still runs them all in one go. Within a
// part the files that draw on the software GPU (`heavy`) run after the others, one at a time.
// Usage: node scripts/test-part.mjs <k> <n> [--quick | --slow] [--only <files>]   (part k of n, from 1)
//        --quick: all but the software-GPU files (what a merge and a release wait for); --slow: those only (run after a
//        release: .github/workflows/slow.yml; the owner, 2026-11-18: "better to go live and have a good recording and reporting pipeline")
//        node scripts/test-part.mjs --measure (runs every file once and rewrites the table)
//        node scripts/test-part.mjs --paste < log (writes into the table the `test-durations {…}` lines a part printed:
//        each CI part prints its files' times so, as CI measured them; paste every part's log of one run)
// As a test reporter (--measure passes it to node --test), it writes each file's time to its destination.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The table's median file, in milliseconds (one second for an empty table). @param {Record<string, number>} ms */
export function median(ms) {
  const v = Object.values(ms).sort((a, b) => a - b), mid = v.length >> 1;
  return !v.length ? 1000 : v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * Each file's weight: its measured milliseconds, or, for a file the table doesn't have yet, the table's median file
 * (until 2026-11-21 its bytes at the table's milliseconds per byte, which put 66 unmeasured files far from their real
 * times and the parts out of balance). The same on every machine (the table is). @param {string[]} files
 * @param {Record<string, number>} [ms] @returns {{ file: string, weight: number }[]}
 */
export function weights(files, ms = durations()) {
  const guess = median(ms);
  return files.map((file) => ({ file, weight: file in ms ? ms[file] : guess }));
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
export const heavy = (file) => /^tests\/lab-.*-browser\.test\.mjs$/.test(file) || SOFTWARE_GPU.includes(file);
/** Browser tests outside the labs that draw on the software GPU too: Photos' export renders on WebGPU over SwiftShader
 * (about 250 s by the table, the heaviest quick file; slow since 2026-11-21). tests/lightcraft-lab.test.mjs (WebGL, about
 * 130 s) stays quick: with it the slow files no longer fit a part's seven minutes (the test of `heavy` below). */
export const SOFTWARE_GPU = ['tests/photos-export-browser.test.mjs'];
/** The files of a kind: `quick` all but the heavy ones, `slow` the heavy ones, anything else all. @param {string[]} files @param {string} [kind] */
export const only = (files, kind) => (kind === 'quick' ? files.filter((f) => !heavy(f)) : kind === 'slow' ? files.filter(heavy) : files);

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

/** A measured time as the table keeps it: the file's tests plus one second for its process and hooks (a browser's
 * launch), to the tenth of a second. @param {number} ms */
export const kept = (ms) => Math.round((ms + 1000) / 100) * 100;
/** The line a part prints with its files' times (from the reporter's output), for `--paste`. @param {Record<string, number>} measured */
export const timesLine = (measured) => `test-durations ${JSON.stringify(Object.fromEntries(Object.entries(measured).sort().map(([f, ms]) => [f, kept(ms)])))}`;
/** The table with the times of every `test-durations {…}` line in `log` written in (the last line wins for a file), for
 * the test files there are. @param {string} log @param {Record<string, number>} ms @param {string[]} [files] */
export function paste(log, ms, files = testFiles()) {
  const out = { ...ms };
  for (const [, json] of log.matchAll(/test-durations (\{.*\})/g)) for (const [f, v] of Object.entries(JSON.parse(json))) if (files.includes(f) && Number.isInteger(v) && v > 0) out[f] = v;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** How long a run may say nothing before a test is taken to have stalled. The longest single test takes about two
 * and a half minutes on CI's slowest day; nothing but a stall is silent for five. */
export const QUIET = 5 * 60_000;
/** Runs `node --test` on the files and gives its exit status. If it reports nothing for `quiet` ms a test has
 * stalled (a browser that stopped answering: on CI, 2026-11-14, a part sat silent for thirteen minutes until the
 * job's limit cancelled it, with no word of which test): the run is ended and the last test it reported is said: the
 * stalled one is the next after it in its file. (Node's own --test-timeout was tried first: on Node 22 it limits a whole
 * file, so a long file of quick tests failed, and what it does differs between versions.)
 * @param {string[]} files @param {string[]} [more] @param {number} [quiet] @param {(text: string) => void} [say] where its words go (a test collects them) @returns {Promise<number>} */
export function run(files, more = [], quiet = QUIET, say = (text) => { process.stdout.write(text); }) {
  if (!files.length) return Promise.resolve(0);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-force-exit', ...more, ...files], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    let last = '', stalled = false;
    const end = () => { stalled = true; say(`\n✖ nothing was reported for ${Math.round(quiet / 1000)} s: a test has stalled, and the run is ended. The last test it reported was:\n  ${last || '(none yet)'}\n`); try { process.kill(-(child.pid ?? 0), 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    let timer = setTimeout(end, quiet);
    child.stdout.on('data', (d) => {
      say(String(d));
      last = String(d).split('\n').filter((l) => /^\s*(✔|✖|ok \d+ - |not ok \d+ - )/.test(l)).at(-1)?.trim() || last;   // the last test it named, in either of the runner's forms
      clearTimeout(timer); timer = setTimeout(end, quiet);
    });
    child.on('exit', (code) => { clearTimeout(timer); resolve(stalled ? 1 : code ?? 1); });
  });
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
  const ms = Object.fromEntries(files.filter((f) => f in measured).map((f) => [f, kept(measured[f])]));
  const note = 'Milliseconds per test file from one full local run (node scripts/test-part.mjs --measure): each file\'s top-level tests plus one second for its process and hooks. scripts/test-part.mjs deals CI\'s parts by these.';
  writeFileSync(TABLE, `${JSON.stringify({ note, ms }, null, 2)}\n`);
  console.log(`measured ${Object.keys(ms).length} of ${files.length} test files into scripts/test-durations.json`);
  process.exit(run.status ?? 1);
} else if (isMain && process.argv[2] === '--paste') {
  const before = durations(), ms = paste(readFileSync(0, 'utf8'), before);
  writeFileSync(TABLE, `${JSON.stringify({ note: JSON.parse(readFileSync(TABLE, 'utf8')).note, ms }, null, 2)}\n`);
  console.log(`${Object.keys(ms).length} of ${testFiles().length} test files in scripts/test-durations.json (${Object.keys(ms).length - Object.keys(before).length} new)`);
} else if (isMain) {
  // `--only <files>`: a lab change's tests (scripts/lab-scope.mjs), dealt over the parts like the whole suite
  const args = process.argv.slice(2), at = args.indexOf('--only'), named = at < 0 ? null : new Set(args.slice(at + 1));
  const kind = args.includes('--quick') ? 'quick' : args.includes('--slow') ? 'slow' : 'all';
  const [k, n] = args.slice(0, 2).map(Number);
  if (!(Number.isInteger(n) && n >= 1 && Number.isInteger(k) && k >= 1 && k <= n)) {
    console.error('usage: node scripts/test-part.mjs <k> <n> [--quick | --slow] [--only <test files>]  |  node scripts/test-part.mjs --measure');
    process.exit(2);
  }
  const all = only(testFiles().filter((f) => !named || named.has(f)), kind);
  const mine = deal(weights(all), n)[k - 1], light = mine.filter((f) => !heavy(f)), slow = mine.filter(heavy);
  console.log(`part ${k} of ${n}${kind === 'all' ? '' : ` (${kind})`}: ${mine.length} of ${all.length} test files (${slow.length} of them on the software GPU, run after the rest, one at a time)`);
  // --test-force-exit: a browser a failed test left open ends with the run, not at CI's timeout. This module also
  // reports each file's time, printed at the end as a line `--paste` reads back into the table.
  const out = (/** @type {number} */ i) => join(tmpdir(), `th-test-part-${process.pid}-${i}.json`);
  const timed = (/** @type {number} */ i) => ['--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${fileURLToPath(import.meta.url)}`, `--test-reporter-destination=${out(i)}`];
  const first = await run(light, timed(1)), second = await run(slow, ['--test-concurrency=1', ...timed(2)]);
  const measured = Object.assign({}, ...[1, 2].map((i) => { try { return existsSync(out(i)) ? JSON.parse(readFileSync(out(i), 'utf8') || '{}') : {}; } catch { return {}; } }));
  console.log(`\n${timesLine(measured)}`);
  process.exit(first || second);
}
