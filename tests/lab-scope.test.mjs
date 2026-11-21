// scripts/lab-scope.mjs: Test runs only the lab checks when a branch changes nothing but test pages
// (docs/engineering/TESTING.md §1, "Lab changes"); anything else runs every suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALWAYS, astraChange, astraTests, labPages, labTests, labVerdict } from '../scripts/lab-scope.mjs';

test('only lab pages and their engine builds count as a lab change', () => {
  assert.deepEqual([...(labPages(['frontend/lab/engine/engine.js', 'engine/raw/src/lib.rs']) ?? [])], ['engine', 'editor'], 'the editor is made of the engine, so its tests run too');
  assert.deepEqual([...(labPages(['frontend/lab/editor/boot.js']) ?? [])], ['editor']);
  assert.deepEqual([...(labPages(['engine/lightcraft-web/README.md', 'frontend/lab/editor/index.html']) ?? [])].sort(), ['editor', 'lightcraft']);
  assert.equal(labPages(['frontend/lab/engine/engine.js', 'frontend/sw.js']), null, 'the service worker serves every page');
  assert.equal(labPages(['frontend/lab/index.html']), null, 'the labs index is not one page');
  assert.equal(labPages(['engine/other/x.rs']), null, 'an engine folder no lab page loads');
  assert.equal(labPages(['scripts/stage.mjs']), null, 'the budgets alone are no lab change');
  // a page's own tests, the table CI deals by and the page budgets go with a lab change (owner, 2026-11-14)
  const sources = { 'tests/lab-engine-x.test.mjs': "goto(`${base}/lab/engine/?readback`)", 'tests/photos-browser.test.mjs': "open('/settings/photos/')" };
  assert.deepEqual([...(labPages(['frontend/lab/editor/app/save.js', 'tests/lab-engine-x.test.mjs', 'scripts/test-durations.json'], sources) ?? [])].sort(), ['editor', 'engine']);
  // the staging builds every page and the service worker's list: with it, every suite runs (audit 2026-11-20)
  for (const staging of ['scripts/stage.mjs', 'scripts/site-config.mjs']) {
    assert.equal(labPages(['frontend/lab/editor/app/save.js', staging], sources), null, `${staging} is no lab change`);
    assert.equal(astraChange(['frontend/astra/app.js', staging]), false, `${staging} is no Astra change`);
  }
  assert.deepEqual([...(labPages(['tests/lab-engine-x.test.mjs'], sources) ?? [])], ['engine', 'editor'], 'a lab test changed alone is still a lab change');
  assert.equal(labPages(['frontend/lab/editor/app/save.js', 'tests/photos-browser.test.mjs'], sources), null, 'a test of another page is not');
  assert.equal(labPages(['frontend/lab/editor/app/save.js', 'tests/fixtures/waits.mjs'], sources), null, 'what every test shares is not');
  assert.equal(labPages(['frontend/lab/editor/app/save.js', 'frontend/th/report/send.js'], sources), null, "the shell's code is not");
  assert.equal(labPages([]), null, 'no change at all runs everything');
});

test("a lab change runs the static checks and each changed page's own tests", () => {
  const sources = { 'tests/lightcraft-lab.test.mjs': "goto(`${base}/lab/lightcraft/`)", 'tests/sw-browser.test.mjs': "'/lab/engine/'", 'tests/photos.test.mjs': '/photos/' };
  assert.deepEqual(labTests(new Set(['engine']), sources), [...ALWAYS, 'tests/sw-browser.test.mjs'].sort());
  assert.deepEqual(labTests(new Set(['lightcraft', 'engine']), sources), [...ALWAYS, 'tests/lightcraft-lab.test.mjs', 'tests/sw-browser.test.mjs'].sort());
  assert.deepEqual(labTests(new Set(['engine']), sources, ['frontend/lab/engine/x.js', 'scripts/test-durations.json']), [...ALWAYS, 'tests/sw-browser.test.mjs', 'tests/test-part.test.mjs'].sort(), 'a changed table runs the test that reads it');
});

test("an Astra change is the film app's own files, tests and tools; it runs Astra's checks and those that read /astra/", () => {
  assert.equal(astraChange(['frontend/astra/src/engine/probe.js', 'tests/astra-probe-reads.test.mjs', 'tests/fixtures/astra/anime.mkv', 'tests/fixtures/astra-host.mjs', 'scripts/astra/real.mjs']), true);
  assert.equal(astraChange(['frontend/astra/README.md', 'frontend/whats-new.json', 'scripts/test-durations.json', 'frontend/ported.json', 'docs/product/apps/ASTRA.md']), true, 'what goes with it');
  assert.equal(astraChange(['frontend/astra/src/engine/probe.js', 'backend/src/areas/astra/routes.ts']), false, 'the Worker runs every suite');
  assert.equal(astraChange(['frontend/astra/src/engine/probe.js', 'shared/contract/astra.ts']), false, 'the contract too');
  assert.equal(astraChange(['frontend/astra/src/engine/software.js', 'frontend/assets/libmedia/97.avplayer.js']), false, 'and the vendored decoders');
  assert.equal(astraChange(['frontend/astra/src/main.js', 'frontend/th/ported/session.js']), false, "the shell's code is not Astra's");
  assert.equal(astraChange(['frontend/astra/src/main.js', 'frontend/lab/editor/boot.js']), false, 'nor a lab page');
  assert.equal(astraChange(['tests/fixtures/waits.mjs']), false, 'what every test shares is not');
  assert.equal(astraChange([]), false, 'no change at all runs everything');
  const sources = { 'tests/astra-plan.test.mjs': 'plan', 'tests/ported.test.mjs': "'/astra/index.html'", 'tests/sw.test.mjs': 'precache of /astra/', 'tests/photos-browser.test.mjs': "open('/settings/photos/')", 'tests/lab-editor-menu-browser.test.mjs': '/lab/editor/' };
  assert.deepEqual(astraTests(sources), [...ALWAYS, 'tests/astra-plan.test.mjs', 'tests/ported.test.mjs', 'tests/sw.test.mjs'].sort(), "the labs' and Photos' own tests are not run");
  assert.deepEqual(astraTests(sources, ['frontend/whats-new.json', 'scripts/test-durations.json']), [...ALWAYS, 'tests/astra-plan.test.mjs', 'tests/news-browser.test.mjs', 'tests/ported.test.mjs', 'tests/sw.test.mjs', 'tests/test-part.test.mjs'].sort(), 'a changed note or table runs the test that reads it');
});

test('the verdict scripts/test-scope.mjs asks for: from git\'s changed lines, a deleted or renamed file runs everything', () => {
  const sources = { 'tests/lab-engine-x.test.mjs': '/lab/engine/', 'tests/astra-plan.test.mjs': 'plan' };
  assert.equal(labVerdict(['M\tfrontend/lab/engine/engine.js'], sources), `lab ${[...ALWAYS, 'tests/lab-engine-x.test.mjs'].sort().join(' ')}`);
  assert.equal(labVerdict(['M\tfrontend/astra/app.js'], sources), `lab ${[...ALWAYS, 'tests/astra-plan.test.mjs'].sort().join(' ')}`);
  assert.equal(labVerdict(['D\tfrontend/lab/engine/old.js'], sources), 'all');
  assert.equal(labVerdict(['M\tdocs/engineering/TESTING.md'], sources), 'all', 'a doc is test-scope.mjs\'s to narrow');
  assert.equal(labVerdict([], sources), 'all');
});
