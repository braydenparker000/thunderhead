// The site's automatic rollback (deploy.yml, job `site`): it builds the previous release with that release's own
// tools, in a worktree at the previous commit, each step that can hang has its own limit inside the job's, and it
// ends only when the live release.json names the previous commit and that release's own live check passes. The
// rollback step's own script runs here in a scratch repository, with stand-ins for the fonts, staging, publishing
// and the live check and a local release.json. Then the real stage.mjs of each of the last five releases on main
// stages that release from a worktree, as the rollback would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const yml = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const site = yml.slice(yml.indexOf('\n  site:\n'));
/** One step of the site job, by name: its text up to the next step. */
const step = (name) => {
  const at = site.indexOf(`- name: ${name}`);
  assert.ok(at > 0, name);
  const next = site.indexOf('\n      - ', at + 1);
  return site.slice(at, next < 0 ? undefined : next);
};
/** A step's `run: |` block, unindented. */
const script = (text) => text.slice(text.indexOf('run: |\n') + 7).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
const limit = (text) => Number(/timeout-minutes: (\d+)/.exec(text)?.[1]);

test('publish, the live check and the rollback each have a limit, together inside the job’s', () => {
  const job = Number(/timeout-minutes: (\d+)/.exec(site)?.[1]);
  const steps = ['Publish', 'Check the live site (read-only)', 'Roll back to the previous live commit'].map((n) => limit(step(n)));
  for (const n of steps) assert.ok(n > 0, 'a step limit');
  assert.ok(steps.reduce((a, b) => a + b) + 5 <= job, `the steps (${steps.join(' + ')}) and five minutes of setup fit in ${job}`);
  assert.match(step('Check the live site (read-only)'), /tests\/live-browser\.test\.mjs/, 'the site as the owner opens it is checked');
});

test('the rollback stages the previous release with its own tools and confirms it is live', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-rollback-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const put = (f, text) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), text); };
  const release = (tools) => {
    put('frontend/index.html', `<p>${tools}</p>\n`);
    put('shared/contract.ts', `export const tools = '${tools}';\n`);
    put('scripts/fonts.mjs', '');
    put('scripts/stage.mjs', `import { writeFileSync, mkdirSync } from 'node:fs'; mkdirSync('.deploy', { recursive: true }); writeFileSync('.deploy/staged', '${tools} ' + process.argv[2] + ' ' + (await import('node:fs')).readFileSync('shared/contract.ts', 'utf8').includes('${tools}'));\n`);
    put('scripts/deploy.sh', `#!/usr/bin/env bash\necho "${tools} $1" > .deploy/published\n`);
    put('tests/live.test.mjs', `import { writeFileSync } from 'node:fs'; writeFileSync('.deploy/checked', '${tools} ' + process.env.EXPECTED_COMMIT);\n`);
    execFileSync('chmod', ['+x', join(dir, 'scripts/deploy.sh')]);
    git('add', '-A');
    git('commit', '-qm', tools);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const prev = release('old');
  release('new');
  put('scripts/only-new.mjs', '');
  git('add', '-A');
  git('commit', '-qm', 'a file the old release does not have');
  const temp = mkdtempSync(join(tmpdir(), 'site-rollback-runner-'));
  const wt = join(temp, 'previous-release');
  let live = prev;
  const server = createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ commit: live })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Without this runner's own marker, so the stand-in live check runs as a test file of its own.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const run = () => new Promise((done) => {
    const p = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(step('Roll back to the previous live commit'))], {
      cwd: dir, env: { ...env, PREV: prev, RUNNER_TEMP: temp, SITE_URL: `http://127.0.0.1:${server.address().port}/` },
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ code, out }));
  });
  try {
    const ok = await run();
    assert.equal(ok.code, 0, ok.out);
    assert.equal(readFileSync(join(wt, '.deploy/staged'), 'utf8'), `old ${prev} true`, "staged by the old release's stage.mjs, with its shared/");
    assert.equal(readFileSync(join(wt, '.deploy/published'), 'utf8'), `old ${prev}\n`, "published by the old release's deploy.sh");
    assert.equal(readFileSync(join(wt, '.deploy/checked'), 'utf8'), `old ${prev}`, "checked live by the old release's own live check");
    assert.equal(readFileSync(join(wt, 'frontend/index.html'), 'utf8'), '<p>old</p>\n');
    assert.throws(() => readFileSync(join(wt, 'scripts/only-new.mjs')), "a newer release's tools are not in the worktree");
    assert.equal(readFileSync(join(dir, 'frontend/index.html'), 'utf8'), '<p>new</p>\n', 'the checkout itself is left as it was');
    assert.match(ok.out, new RegExp(`release\\.json names ${prev}`));
    assert.match(ok.out, /the previous release passes its live check/);
    // A second rollback in the same job (a retry) starts from a clean worktree.
    live = prev;
    const again = await run();
    assert.equal(again.code, 0, again.out);
  } finally {
    server.close();
  }
});

test('the rollback works in a worktree at the previous commit and fails unless that commit is live', () => {
  const text = script(step('Roll back to the previous live commit'));
  assert.match(text, /\[\[ "\$live" == "\$PREV" \]\] \|\| \{ echo "::error::/);
  assert.match(text, /git worktree add --detach "\$wt" "\$PREV"/);
  assert.match(text, /export EXPECTED_COMMIT="\$PREV"/);
});

test('each of the last five releases on main stages from its own worktree', { timeout: 600_000 }, () => {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  const merges = () => git('log', '--merges', '--first-parent', '-n', '5', '--format=%H', 'HEAD').split('\n').filter(Boolean);
  // CI checks out one commit: fetch enough of main's history (the repository is public).
  if (merges().length < 5) git('fetch', '--quiet', '--deepen=200', 'origin');
  const list = merges();
  assert.equal(list.length, 5, 'five releases on main to stage');
  const temp = mkdtempSync(join(tmpdir(), 'stage-releases-'));
  try {
    for (const sha of list) {
      const wt = join(temp, sha.slice(0, 12));
      git('worktree', 'add', '--quiet', '--detach', wt, sha);
      try {
        const env = { ...process.env, WORKER_URL: '', DRIVE_CONFIG_JSON: '', TH_FONTS: '', TH_PREVIEW: '' };
        execFileSync('node', ['scripts/stage.mjs', sha], { cwd: wt, env, stdio: 'pipe' });
        assert.match(readFileSync(join(wt, '.deploy/release.json'), 'utf8'), new RegExp(`"commit":"${sha}"`), sha);
      } catch (e) {
        assert.fail(`${sha} does not stage from a worktree: ${e.stderr ?? e.message}`);
      } finally {
        git('worktree', 'remove', '--force', wt);
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
    git('worktree', 'prune');
  }
});
