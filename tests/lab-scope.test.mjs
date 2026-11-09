// scripts/lab-scope.mjs: Test runs only the lab checks when a branch changes nothing but test pages
// (docs/engineering/TESTING.md §1, "Lab changes"); anything else runs every suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALWAYS, labPages, labTests } from '../scripts/lab-scope.mjs';

test('only lab pages and their engine builds count as a lab change', () => {
  assert.deepEqual([...(labPages(['frontend/lab/engine/engine.js', 'engine/raw/src/lib.rs']) ?? [])], ['engine']);
  assert.deepEqual([...(labPages(['engine/lightcraft-web/README.md', 'frontend/lab/editor/index.html']) ?? [])].sort(), ['editor', 'lightcraft']);
  assert.equal(labPages(['frontend/lab/engine/engine.js', 'frontend/sw.js']), null, 'the service worker serves every page');
  assert.equal(labPages(['frontend/lab/index.html']), null, 'the labs index is not one page');
  assert.equal(labPages(['engine/other/x.rs']), null, 'an engine folder no lab page loads');
  assert.equal(labPages(['scripts/stage.mjs']), null);
  assert.equal(labPages([]), null, 'no change at all runs everything');
});

test("a lab change runs the static checks and each changed page's own tests", () => {
  const sources = { 'tests/lightcraft-lab.test.mjs': "goto(`${base}/lab/lightcraft/`)", 'tests/sw-browser.test.mjs': "'/lab/engine/'", 'tests/photos.test.mjs': '/photos/' };
  assert.deepEqual(labTests(new Set(['engine']), sources), [...ALWAYS, 'tests/sw-browser.test.mjs'].sort());
  assert.deepEqual(labTests(new Set(['lightcraft', 'engine']), sources), [...ALWAYS, 'tests/lightcraft-lab.test.mjs', 'tests/sw-browser.test.mjs'].sort());
});
