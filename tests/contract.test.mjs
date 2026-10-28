// The API contract in shared/ is checked from the frontend's plain JS through JSDoc
// (decision X5): the real client must type-check, and a deliberately drifted copy must not,
// which proves the check is not vacuous. The backend checks the same types with `satisfies`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = project => {
  try {
    execFileSync(process.execPath, [tsc, '-p', project], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: `${e.stdout}${e.stderr}` };
  }
};

test('the frontend API client type-checks against shared/contract', () => {
  const r = run('tsconfig.json');
  assert.ok(r.ok, r.out);
});

test('a client that drifts from the contract is rejected', () => {
  const r = run('tests/fixtures/tsconfig.drift.json');
  assert.equal(r.ok, false);
  assert.match(r.out, /'pasword' does not exist in type 'LoginRequest'/);
  assert.match(r.out, /Property 'toFixed' does not exist on type 'string'/);
});
