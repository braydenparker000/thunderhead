// th ci: waits for GitHub Actions on one commit through the public API (RUNTIME.md §5.3), with a fake
// GitHub and a fake clock: the workflow chosen by its file, the newest run, the exit codes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ci, repoOf, stateOf} from '../cli/lib/ci.mjs';

const SHA = 'a'.repeat(40);
const run = (path, status, conclusion = null, created = '2026-10-31T10:00:00Z') =>
  ({path: `.github/workflows/${path}`, status, conclusion, html_url: `https://github.example/${path}/${status}`, created_at: created});

/** A GitHub that answers each poll with the next list of runs, and records what was asked. */
function fakeGitHub(answers) {
  const asked = [];
  let i = 0;
  const f = async (url) => {
    asked.push(url);
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a instanceof Error) throw a;
    if (typeof a === 'number') return new Response('{}', {status: a});
    return Response.json({workflow_runs: a});
  };
  return {f, asked};
}
/** Captures what th prints. */
async function capture(fn) {
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try { return {code: await fn(), out: lines.join('')}; } finally { process.stdout.write = write; }
}
const clock = () => { let t = 0; return {now: () => t, sleep: async (ms) => { t += ms; }}; };

test('waits until the chosen workflow on that commit finishes, and says how', async () => {
  const gh = fakeGitHub([[], [run('ci.yml', 'in_progress'), run('deploy.yml', 'completed', 'failure')], [run('ci.yml', 'completed', 'success')]]);
  const c = clock();
  const r = await capture(() => ci([SHA], {fetch: gh.f, ...c, repo: 'owner/repo'}));
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), {state: 'passed', url: 'https://github.example/ci.yml/completed'});
  assert.equal(gh.asked.length, 3);
  assert.match(gh.asked[0], /^https:\/\/api\.github\.com\/repos\/owner\/repo\/actions\/runs\?head_sha=a{40}&per_page=30$/);
});

test('--workflow deploy reads the Deploy run; a failure exits 1; the newest run wins', async () => {
  const gh = fakeGitHub([[run('deploy.yml', 'completed', 'success', '2026-10-31T09:00:00Z'), run('deploy.yml', 'completed', 'failure', '2026-10-31T11:00:00Z')]]);
  const r = await capture(() => ci([SHA, '--workflow', 'deploy'], {fetch: gh.f, ...clock(), repo: 'owner/repo'}));
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.out).state, 'failed');
});

test('still running at the time limit exits 3; GitHub unreachable exits 9; its limit exits 10', async () => {
  const running = fakeGitHub([[run('ci.yml', 'queued')]]);
  const r = await capture(() => ci([SHA, '--minutes', '1'], {fetch: running.f, ...clock(), repo: 'o/r'}));
  assert.equal(r.code, 3);
  assert.equal(JSON.parse(r.out).state, 'running');
  assert.equal(running.asked.length, 4, 'one poll every 20 s: at 0, 20, 40 and 60 s');
  await assert.rejects(ci([SHA], {fetch: fakeGitHub([new TypeError('fetch failed')]).f, ...clock(), repo: 'o/r'}), (e) => e.exit === 9);
  await assert.rejects(ci([SHA], {fetch: fakeGitHub([403]).f, ...clock(), repo: 'o/r'}), (e) => e.exit === 10);
});

test('refuses what is not a full commit or a known workflow', async () => {
  await assert.rejects(ci(['abc123'], {repo: 'o/r'}), (e) => e.exit === 8);
  await assert.rejects(ci([SHA, '--workflow', 'release'], {repo: 'o/r'}), (e) => e.exit === 8);
});

test('the repository comes from TH_REPO, a github.com remote, or a proxy remote', () => {
  assert.equal(repoOf({TH_REPO: 'me/thunderhead'}), 'me/thunderhead');
  assert.equal(repoOf({}, () => 'https://github.com/me/thunderhead.git\n'), 'me/thunderhead');
  assert.equal(repoOf({}, () => 'git@github.com:me/thunderhead.git'), 'me/thunderhead');
  assert.equal(repoOf({}, () => 'http://local_proxy@127.0.0.1:41297/git/me/thunderhead'), 'me/thunderhead');
  assert.equal(stateOf(null), 'waiting');
});
