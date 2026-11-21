// CI's test parts (scripts/test-part.mjs): every test file runs in exactly one part, and the parts
// take about as long by the measured table (scripts/test-durations.json).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { QUIET, deal, durations, heavy, kept, median, only, paste, run, testFiles, timesLine, weights } from '../scripts/test-part.mjs';

/** The site parts in .github/workflows/checks.yml: "site k/n" in its matrix. */
const PARTS = Number(/part: \[site 1\/(\d+)/.exec(readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8'))?.[1]);

test('every test file lands in exactly one of the five parts', () => {
  assert.equal(PARTS, 5, 'checks.yml runs the site and mind suites in five parts');
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
  // A new file, not measured yet, counts as the table's median file (by its bytes until 2026-11-21: far from its time).
  const [estimated] = weights(['tests/test-part.test.mjs', 'tests/site.test.mjs'], { 'tests/site.test.mjs': 1000 });
  assert.equal(estimated.weight, 1000, 'an unmeasured file weighs as the median file');
  assert.deepEqual([median({ a: 5, b: 1, c: 9 }), median({ a: 1, b: 2, c: 9, d: 10 }), median({})], [5, 6, 1000]);
  assert.equal(weights(['tests/x.test.mjs'], { 'tests/a.test.mjs': 300, 'tests/b.test.mjs': 100_000, 'tests/c.test.mjs': 2000 })[0].weight, 2000, 'one huge file does not move it');
});

test('a CI part prints its files\' times in a line --paste writes back into the table', () => {
  // the reporter's milliseconds, kept as --measure keeps them: plus a second for the process, to the tenth of a second
  const line = timesLine({ 'tests/site.test.mjs': 1234.5, 'mind/tests/th.test.mjs': 40 });
  assert.equal(line, 'test-durations {"mind/tests/th.test.mjs":1000,"tests/site.test.mjs":2200}');
  assert.equal(kept(0), 1000);
  // a log as GitHub gives it: a time before each line, the parts of one run one after another
  const log = `2026-11-21T10:00:00.1Z part 1 of 5\n2026-11-21T10:02:00.1Z ${line}\n2026-11-21T10:02:01.0Z ${timesLine({ 'tests/gone.test.mjs': 5, 'tests/site.test.mjs': 3000 })}\n`;
  const files = ['mind/tests/th.test.mjs', 'tests/site.test.mjs', 'tests/test-part.test.mjs'];
  assert.deepEqual(paste(log, { 'tests/test-part.test.mjs': 700, 'tests/site.test.mjs': 9 }, files),
    { 'mind/tests/th.test.mjs': 1000, 'tests/site.test.mjs': 4000, 'tests/test-part.test.mjs': 700 }, 'the last line wins; a file that has gone is left out');
  const main = readFileSync(new URL('../scripts/test-part.mjs', import.meta.url), 'utf8');
  assert.match(main, /console\.log\(`\\n\$\{timesLine\(measured\)\}`\)/, 'every part prints the line');
});

test('the files that draw on the software GPU are known, and a part has time for its own one after another', () => {
  // they run after a part's other files, one at a time (a test beside one waited past its own limits, twice in CI)
  assert.deepEqual(['tests/lab-editor-net-browser.test.mjs', 'tests/lab-engine-pictures-browser.test.mjs', 'tests/lab-compare-browser.test.mjs', 'tests/photos-export-browser.test.mjs', 'tests/lab-editor-recipes.test.mjs', 'tests/photos-browser.test.mjs', 'mind/tests/th.test.mjs'].map(heavy),
    [true, true, true, true, false, false, false]);
  const files = testFiles(), of = new Map(weights(files).map((w) => [w.file, w.weight]));
  assert.ok(files.filter(heavy).length >= 15, 'the editor\'s browser tests are among the test files');
  assert.match(readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8'), /\n    timeout-minutes: 20\n/, 'the job\'s limit this is reckoned against');
  for (const [i, part] of deal(weights(files), PARTS).entries()) {
    const ms = part.filter(heavy).reduce((s, f) => s + of.get(f), 0);
    assert.ok(ms < 420_000, `part ${i + 1}'s software-GPU files take ${Math.round(ms / 1000)} s one after another: under seven of the job's twenty minutes (CI makes them about twice as slowly, and the part's other files and set-up take the rest)`);
  }
});

test('on a branch a re-run of the checks cannot pass: a failing test is fixed, not retried into green', () => {
  // TESTING.md §1 rule 8, kept by the workflow itself since the day it was broken by hand three times (2026-11-14).
  const checks = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8'), ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const steps = checks.slice(checks.indexOf('    steps:'));
  assert.match(steps, /^    steps:\n(      #.*\n)*      - if: \$\{\{ inputs\.first_only && github\.run_attempt > 1 \}\}\n        run: \|\n.*\n          exit 1\n/, 'the first step of every part fails a re-run');
  assert.match(ci, /uses: \.\/\.github\/workflows\/checks\.yml\n    with:\n(      .*\n)*?      first_only: true\n/, 'Test asks for it');
  assert.doesNotMatch(readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'), /first_only/, 'Deploy does not: its re-run after an outage stays possible');
});

test('a run that reports nothing for long enough is ended, and says the last test that finished', async () => {
  // scripts/test-part.mjs `run`. A stalled browser left a CI part silent until the job's limit cancelled it.
  const dir = mkdtempSync(join(tmpdir(), 'th-stall-')), stall = join(dir, 'stall.test.mjs'), fine = join(dir, 'fine.test.mjs');
  writeFileSync(stall, "import { test } from 'node:test';\ntest('the one before', () => {});\ntest('never ends', async () => { await new Promise(() => { setInterval(() => {}, 1000); }); });\n");
  writeFileSync(fine, "import { test } from 'node:test';\nfor (let i = 0; i < 3; i++) test('half a second ' + i, async () => { await new Promise((r) => setTimeout(r, 500)); });\n");
  // (a runner started inside a test would report to this one in its own form: it is started as from a shell)
  const context = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  const written = [], say = (text) => { written.push(text); };
  let stalled, passed;
  try {
    const began = Date.now();
    stalled = [await run([stall], [], 1500, say), Date.now() - began];
    passed = await run([fine], [], 1500, say);   // a file longer than the quiet time, with tests that keep finishing
  } finally { if (context !== undefined) process.env.NODE_TEST_CONTEXT = context; }
  const said = written.join('');
  assert.equal(stalled[0], 1, said);
  assert.ok(stalled[1] < 15_000, `ended soon after going quiet (${stalled[1]} ms)`);
  assert.match(said, /nothing was reported for 2 s: a test has stalled, and the run is ended\. The last test it reported was:\n {2}(ok 1 - |✔ )the one before/);
  assert.equal(passed, 0, said);
  assert.ok(QUIET >= 4 * 60_000 && QUIET <= 6 * 60_000, 'longer than any one test on CI, well under the job\'s limit');
});


test('quick and slow: every file in exactly one, the software-GPU files the slow ones, and the workflows run them so', () => {
  const files = testFiles(), quick = only(files, 'quick'), slow = only(files, 'slow');
  assert.deepEqual([...quick, ...slow].sort(), files); assert.equal(new Set([...quick, ...slow]).size, files.length);
  assert.ok(slow.length >= 15 && slow.every(heavy) && !quick.some(heavy));
  const yml = (f) => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8');
  assert.match(yml('ci.yml'), /uses: \.\/\.github\/workflows\/checks\.yml\n    with:\n(?:      .*\n)*      files: quick\n/, 'a branch waits for the quick checks');
  assert.match(yml('deploy.yml'), /uses: \.\/\.github\/workflows\/checks\.yml\n    with:\n(?:      .*\n)*      files: quick\n/, 'and so does a release');
  assert.match(yml('slow.yml'), /workflows: \[Deploy\]/, 'the slow ones run once it is live');
  assert.match(yml('slow.yml'), /files: slow\n/);
});

test('each part keeps npm\'s cache by the lockfile and Playwright\'s browser by its version', () => {
  const checks = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  assert.match(checks, /\n {10}cache: \$\{\{ .* && 'npm' \|\| '' \}\}\n {10}cache-dependency-path: package-lock\.json\n/);
  assert.match(checks, /packages\['node_modules\/playwright-core'\]\.version/, 'the version the lockfile installs');
  assert.match(checks, /uses: actions\/cache@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}path: ~\/\.cache\/ms-playwright\n {10}key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.browser\.outputs\.version \}\}-/);
  assert.match(checks, /cache-hit != 'true' \}\}\n {8}run: npx playwright install --with-deps --only-shell chromium\n/, 'a miss fetches the browser and the system\'s libraries');
  assert.match(checks, /cache-hit == 'true' \}\}\n {8}run: npx playwright install-deps chromium\n/, 'a hit still installs the libraries');
});
