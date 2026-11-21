// scripts/test-scope.mjs: Test runs the checks a change can break (docs/engineering/TESTING.md §2, "Scopes"): a docs,
// Worker or mind change runs its own tests and no browser; anything else, or any doubt, runs everything.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { browser, covers, testScope } from '../scripts/test-scope.mjs';

const sources = {
  'tests/docs-paths.test.mjs': "walk('docs/')",
  'tests/contract.test.mjs': "import '../shared/contract/index.ts'",
  'tests/contract-gen.test.mjs': "run('scripts/contract.mjs') // docs/engineering/CONTRACT.md",
  'tests/senses-logic.test.mjs': "import '../backend/src/areas/senses/rules.ts'",
  'tests/eval-diff.test.mjs': "read('mind/evals/seed.jsonl')",
  'tests/site.test.mjs': "read('frontend/index.html')",
  // (the import is spelt in two halves, or this file would read as a browser test itself)
  'tests/lightcraft-lab.test.mjs': `import { chromium } from ${"'play"}wright'; // engine/lightcraft-web/README.md, docs/x/ONLY-BROWSER.md`,
  'tests/settings-browser.test.mjs': "import { SETTINGS } from '../shared/contract/settings.ts'; import './fixtures/mock-api.mjs';",
  'tests/fixtures/mock-api.mjs': "import './mock-work.mjs';",
  'tests/fixtures/mock-work.mjs': '// as backend/src/areas/work/ops.ts answers',
  'tests/fixtures/contract-drift.js': "/** @typedef {import('../../shared/contract/api.ts').X} X */",
  'mind/tests/th.test.mjs': "spawn('mind/cli/th.mjs') // docs/mind/TH.md",
  'mind/tests/skills.test.mjs': "read('mind/skills/')",
  'shared/contract/settings.ts': "import { kit } from './settings-kit.ts';",
  'shared/contract/settings-kit.ts': 'export const kit = 1;',
  'shared/contract/api.ts': 'export {};',
  'shared/contract/evals.ts': '// the synthetic seed, mind/evals/seed.jsonl',
  'backend/tests/unit/brief.test.ts': "import.meta.glob('../../../docs/mind/BEHAVIOR.md')",
  'backend/tests/evals.test.ts': "import.meta.glob('../../../mind/evals/probes/*.json')",
  'backend/src/export.ts': "put('README.md')",
};
const scope = (/** @type {string[]} */ paths) => testScope(paths, sources);

test('a docs-only change runs the tests that read the docs, and no browser and no Worker', () => {
  assert.deepEqual(scope(['docs/engineering/TESTING.md', 'AGENTS.md']), { word: 'docs', tests: ['mind/tests/th.test.mjs', 'tests/contract-gen.test.mjs', 'tests/docs-paths.test.mjs'] });
  assert.equal(scope(['docs/mind/BEHAVIOR.md']), null, "a doc the Worker's tests read runs everything");
  assert.equal(scope(['docs/x/ONLY-BROWSER.md']), null, 'so does one a browser test names');
  assert.equal(scope(['README.md']), null, 'a root file the Worker names');
  assert.deepEqual(scope(['CLAUDE.md'])?.word, 'docs', 'engine/lightcraft-web/README.md is not the root README');
  assert.equal(scope(['mind/skills/x/SKILL.md'])?.word, 'mind', "the mind's Markdown is the mind's, not a doc");
  assert.equal(scope(['frontend/lab/README.md']), null, 'nor is a page\'s');
});

test('a Worker or contract change runs the Worker, the contract and the tests that read them, and no browser', () => {
  assert.deepEqual(scope(['backend/src/areas/senses/rules.ts', 'docs/engineering/API.md']),
    { word: 'backend', tests: ['mind/tests/th.test.mjs', 'tests/contract-gen.test.mjs', 'tests/contract.test.mjs', 'tests/docs-paths.test.mjs', 'tests/senses-logic.test.mjs'] });
  assert.equal(scope(['backend/src/export.ts', 'docs/mind/BEHAVIOR.md'])?.word, 'backend', "a doc the Worker reads goes with it: the Worker's job runs");
  assert.equal(scope(['shared/contract/api.ts'])?.word, 'backend', 'a fixture only a type check reads is no browser test\'s');
  assert.equal(scope(['shared/contract/settings.ts']), null, 'a browser test imports it: everything runs');
  assert.equal(scope(['shared/contract/settings-kit.ts']), null, 'and what it imports');
  assert.equal(scope(['backend/src/areas/work/ops.ts']), null, 'a fixture a browser test loads names it');
  assert.equal(scope(['backend/src/x.ts', 'mind/cli/th.mjs']), null, 'the Worker and the mind together: everything');
});

test('a mind change runs the mind\'s tests and those that read mind/, and no browser and no Worker', () => {
  assert.deepEqual(scope(['mind/cli/th.mjs']), { word: 'mind', tests: ['mind/tests/skills.test.mjs', 'mind/tests/th.test.mjs', 'tests/eval-diff.test.mjs'] });
  assert.equal(scope(['mind/evals/seed.jsonl']), null, "the Worker's contract reads it");
  assert.equal(scope(['mind/evals/probes/memory.json']), null, "the Worker's tests read it (a glob)");
});

test('anything else, or no change at all, runs everything', () => {
  for (const paths of [[], ['frontend/th/home.js'], ['docs/a.md', 'scripts/stage.mjs'], ['tests/site.test.mjs'], ['.github/workflows/ci.yml'], ['package.json']]) assert.equal(scope(paths), null, paths.join(', '));
  assert.ok(browser('tests/x-browser.test.mjs') && browser('tests/lightcraft-lab.test.mjs', sources['tests/lightcraft-lab.test.mjs']) && !browser('tests/site.test.mjs', ''));
  assert.ok(covers('mind/evals/probes/*.json', 'mind/evals/probes/a.json') && covers('shared/contract/', 'shared/contract/a.ts') && covers('mind/evals', 'mind/evals/a.json'));
  assert.ok(!covers('mind/evals/probes/*.json', 'mind/evals/probes/x/a.json') && !covers('docs/a.md', 'docs/a.mdx'));
});

test('Test passes the scope with its files, so only a run of everything is named Scope: full', () => {
  // scripts/tree-tested.mjs: Deploy skips its checks only after a run whose job `record` is `Scope: full`
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'), checks = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  assert.match(ci, /verdict="\$\(node scripts\/test-scope\.mjs origin\/main \|\| echo all\)"/);
  assert.match(ci, /name: "\$\{\{ \(needs\.scope\.result == 'success' && needs\.scope\.outputs\.lab\) && 'Scope: narrowed' \|\| 'Scope: full' \}\}"/);
  assert.match(ci, /\n {6}lab: \$\{\{ needs\.scope\.result == 'success' && needs\.scope\.outputs\.lab \|\| '' \}\}\n {6}scope: \$\{\{ needs\.scope\.result == 'success' && needs\.scope\.outputs\.lab && needs\.scope\.outputs\.scope \|\| '' \}\}\n/);
  // an empty `lab` runs every suite, whatever `scope` says; the Worker runs for every suite and a Worker change
  assert.match(checks, /if \[\[ -n "\$LAB" \]\]; then\n {12}if \[\[ "\$PART" == worker && "\$SCOPE" == backend \]\]; then npm run test:backend; exit; fi\n/);
  assert.match(checks, /if: \$\{\{ matrix\.part != 'worker' && \(inputs\.lab == '' \|\| inputs\.scope == 'lab'\) \}\}/, 'a browser only where browser tests run');
});
