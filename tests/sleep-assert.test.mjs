// A browser check must not measure the machine (TESTING.md §10.1 rule 1): a `waitForTimeout(` followed within two
// lines by an `assert` reads the page after a fixed sleep, so it passes or fails with the runner's speed. Today's
// offenders are listed by file with their count (tests/fixtures/sleep-assert-allow.json); no file may gain one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
const allow = JSON.parse(readFileSync(new URL('./fixtures/sleep-assert-allow.json', import.meta.url), 'utf8'));

/** The line numbers (1-based) of each `waitForTimeout(` with an `assert` on its own line or the next two. */
export function sleepThenAssert(text) {
  const lines = text.split('\n');
  return lines.flatMap((line, i) => (/waitForTimeout\(/.test(line) && lines.slice(i, i + 3).some((l, k) => /\bassert\b/.test(k ? l : line.slice(line.indexOf('waitForTimeout(')))) ? [i + 1] : []));
}

test('the rule finds a sleep followed by an assertion, and nothing else', () => {
  assert.deepEqual(sleepThenAssert('await page.waitForTimeout(300);\nassert.equal(a, 1);'), [1]);
  assert.deepEqual(sleepThenAssert('await page.waitForTimeout(300);\nconst a = 1;\nassert.ok(a);'), [1]);
  assert.deepEqual(sleepThenAssert('await page.waitForTimeout(300);\nconst a = 1;\nconst b = 2;\nassert.ok(a);'), []);
  assert.deepEqual(sleepThenAssert('assert.ok(x); await page.waitForTimeout(300);\nawait until(page, f);'), [], 'an assertion before the sleep');
  assert.deepEqual(sleepThenAssert('await until(page, f);\nassert.ok(x);'), []);
});

test('no browser check gains a sleep followed by an assertion', () => {
  const found = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('-browser.test.mjs')).sort()) {
    const n = sleepThenAssert(readFileSync(new URL(f, dir), 'utf8')).length;
    if (n) found[f] = n;
  }
  const over = Object.entries(found).filter(([f, n]) => n > (allow[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${allow[f] ?? 0})`);
  assert.deepEqual(over, [], 'wait for a condition instead (tests/fixtures/waits.mjs: until, resting, outlast)');
});
