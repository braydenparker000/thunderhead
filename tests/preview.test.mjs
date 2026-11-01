// Previews (.github/workflows/preview.yml, AGENTS.md: the owner tries a pull request on the phone
// before merging it): the branch name that goes on the label is checked, the config carries it, and
// the workflow runs by hand only, with a Pages-only token, never main, never a pull request's code
// with secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configJs, previewName } from '../scripts/site-config.mjs';

test('a preview build names its branch; anything else in that name is refused', () => {
  assert.match(configJs({ preview: 'claude/streaming' }), /"preview":"claude\/streaming"/);
  assert.doesNotMatch(configJs({}), /preview/, 'the live build carries no preview');
  for (const bad of ['a b', '<script>', 'x'.repeat(81), 'a"b']) assert.throws(() => previewName(bad), /not a branch name/);
});

test('the preview workflow: by hand only, a Pages token, the branch checked before use', () => {
  const y = readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8');
  assert.match(y, /^on:\n  workflow_dispatch:/m, 'run by hand only');
  assert.doesNotMatch(y, /pull_request|push:|schedule:/, 'no automatic trigger');
  assert.match(y, /secrets\.CLOUDFLARE_PAGES_TOKEN/);
  assert.doesNotMatch(y, /secrets\.CLOUDFLARE_API_TOKEN|AZURE_|DRIVE_CONFIG/, "never the Worker's or the site's keys");
  assert.match(y, /\$REF" != main/, 'never main');
  assert.match(y, /persist-credentials: false/);
  // The branch name reaches the shell only through an environment variable.
  for (const line of y.split('\n').filter((l) => /^\s+(run:|\S.*\$\{\{ inputs)/.test(l) && l.includes('run:'))) assert.doesNotMatch(line, /\$\{\{ inputs/);
});
