// The live watch (.github/workflows/live-watch.yml, scripts/live-watch.mjs): two failed runs in a row open one issue,
// a failing run comments on the open one, a passing run closes it; the issue names checks and links the run only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { body, decide, failingChecks, TITLE, WORKFLOW } from '../scripts/live-watch.mjs';

test('two failures in a row open the issue, later ones comment, a pass closes it', () => {
  assert.equal(decide({ passed: false, previous: 'success', open: null }), 'none', 'one failure is not yet an outage');
  assert.equal(decide({ passed: false, previous: 'failure', open: null }), 'open');
  assert.equal(decide({ passed: false, previous: null, open: null }), 'open', 'the run before unknown counts as failed');
  assert.equal(decide({ passed: false, previous: 'failure', open: 7 }), 'comment', 'never a second issue');
  assert.equal(decide({ passed: false, previous: 'success', open: 7 }), 'comment');
  assert.equal(decide({ passed: true, previous: 'failure', open: 7 }), 'close');
  assert.equal(decide({ passed: true, previous: 'failure', open: null }), 'none');
});

test('the issue names the failing checks and the run, never an address with a query or a body', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - missing files get a 404',
    'not ok 2 - the expected commit is live',
    '  ---',
    "  actual: '<html>a response body</html>'",
    '  ...',
    'not ok 3 - the page at https://site.example/a?token=1 \\# loads',
    '    not ok 1 - a subtest',
    'not ok 4 - tests/live-api.test.mjs',
    'not ok 5 - the expected commit is live',
  ].join('\n');
  const names = failingChecks(tap);
  assert.deepEqual(names, ['the expected commit is live', 'the page at (an address) # loads', 'tests/live-api.test.mjs']);
  const text = body(names, 'https://github.com/owner/repo/actions/runs/123?pr=1');
  assert.match(text, /- the expected commit is live\n/);
  assert.match(text, /Run: https:\/\/github\.com\/owner\/repo\/actions\/runs\/123\n$/);
  assert.doesNotMatch(text, /\?|response body|token/);
  assert.match(body([], 'https://github.com/o/r/actions/runs/1'), /no check name/);
});

test('the workflow runs every 30 minutes with the least permissions, on the read-only checks', () => {
  const yml = readFileSync(new URL(`../.github/workflows/${WORKFLOW}`, import.meta.url), 'utf8');
  assert.match(yml, /schedule:\n {4}- cron: '\*\/30 \* \* \* \*'/);
  assert.match(yml, /\npermissions:\n {2}contents: read\n {2}issues: write\nconcurrency:/, 'only these two');
  assert.doesNotMatch(yml, /secrets\./, 'no secret');
  assert.match(yml, /tests\/live\.test\.mjs tests\/live-api\.test\.mjs/);
  assert.match(yml, /node scripts\/live-watch\.mjs/);
  assert.equal(TITLE, 'The live site check is failing');
});
