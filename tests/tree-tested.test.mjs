// scripts/tree-tested.mjs: Deploy skips its checks only when Test already passed on the same files
// (deploy.yml, job `tested`). Parsing on a fixture of the runs API; the command itself without network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headOf, passed } from '../scripts/tree-tested.mjs';

const runs = JSON.parse(readFileSync(new URL('./fixtures/tree-tested-runs.json', import.meta.url), 'utf8'));
const sha = (c) => c.repeat(40);

test('Test ran on a merge’s second parent, or on the commit itself', () => {
  assert.equal(headOf(`${sha('m')} ${sha('1')} ${sha('2')}\n`), sha('2'));
  assert.equal(headOf(`${sha('m')} ${sha('1')}`), sha('m'));
  assert.equal(headOf(sha('m')), sha('m'), 'a root commit');
  assert.equal(headOf(`${sha('m')} ${sha('1')} ${sha('2')} ${sha('3')}`), null, 'an octopus merge has no one head');
});

test('only a completed, successful run on that commit with that tree counts', () => {
  assert.equal(passed(runs, sha('1'), sha('a')), true);
  assert.equal(passed(runs, sha('1'), sha('b')), false, 'another tree');
  assert.equal(passed(runs, sha('2'), sha('b')), false, 'a failed run');
  assert.equal(passed(runs, sha('3'), sha('c')), false, 'a run still going');
  assert.equal(passed(runs, sha('4'), sha('d')), false, 'no tree reported');
  assert.equal(passed(runs, sha('5'), sha('a')), false, 'no run on that commit');
  for (const bad of [null, {}, { workflow_runs: 'x' }, { workflow_runs: [null] }]) assert.equal(passed(bad, sha('1'), sha('a')), false);
});

test('the command answers untested on any doubt, before asking GitHub', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-tested-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], { cwd: dir, encoding: 'utf8' });
  const put = (f) => {
    writeFileSync(join(dir, f), `${f}\n`);
    git('add', f);
    git('commit', '-qm', f);
  };
  const cli = () => {
    const r = spawnSync('node', [fileURLToPath(new URL('../scripts/tree-tested.mjs', import.meta.url))], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REPOSITORY: '', GH_TOKEN: '' },
    });
    return `${r.stdout.trim()} (${r.stderr.trim()})`;
  };
  git('init', '-q', '-b', 'main');
  put('a');
  git('switch', '-qc', 'topic');
  put('b');
  assert.match(cli(), /^untested \(tree-tested: GITHUB_REPOSITORY is not set\)$/, 'no repository to ask');
  git('switch', '-q', 'main');
  put('c');
  git('merge', '-q', '--no-ff', '--no-edit', 'topic');
  assert.match(cli(), /^untested \(tree-tested: [0-9a-f]{40} has another tree/, 'the merge has files the head never had');
});
