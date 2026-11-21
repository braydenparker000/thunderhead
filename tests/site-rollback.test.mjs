// The site's automatic rollback (deploy.yml, job `site`): it builds the previous release with that release's own
// tools (frontend/, scripts/ and shared/ from the previous commit), each step that can hang has its own limit inside
// the job's, and it ends only when the live release.json names the previous commit. The rollback step's own script
// runs here in a scratch repository, with stand-ins for the fonts, staging and publishing and a local release.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  let live = prev;
  const server = createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ commit: live })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const run = () => new Promise((done) => {
    const p = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(step('Roll back to the previous live commit'))], {
      cwd: dir, env: { ...process.env, PREV: prev, SITE_URL: `http://127.0.0.1:${server.address().port}/` },
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ code, out }));
  });
  try {
    const ok = await run();
    assert.equal(ok.code, 0, ok.out);
    assert.equal(readFileSync(join(dir, '.deploy/staged'), 'utf8'), `old ${prev} true`, "staged by the old release's stage.mjs, with its shared/");
    assert.equal(readFileSync(join(dir, '.deploy/published'), 'utf8'), `old ${prev}\n`, "published by the old release's deploy.sh");
    assert.equal(readFileSync(join(dir, 'frontend/index.html'), 'utf8'), '<p>old</p>\n');
    assert.throws(() => readFileSync(join(dir, 'scripts/only-new.mjs')), "a newer release's tools are gone");
    assert.match(ok.out, new RegExp(`release\\.json names ${prev}`));
  } finally {
    server.close();
  }
});
