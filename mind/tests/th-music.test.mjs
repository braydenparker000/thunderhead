// th music against the fake Worker and a fake GitHub CLI: one song's analysis and its nearest songs;
// the night's jobs step collects only jobs whose runs are over, asks for analysis first and the
// neighbours step after, dispatches the workflow with the job's id alone and never prints a hash; a
// refused dispatch or a busy pass is said plainly; local refusals (exit 8) come before the network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {env, errCode, freshTmp, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const HASH = 'ab'.repeat(32);
const ID = '0190a0a0-0000-7000-8000-00000000000';

/** A gh that records its arguments and exits with `code`. */
function fakeGh(code = 0) {
  const dir = freshTmp();
  const gh = join(dir, 'gh');
  writeFileSync(gh, `#!/bin/sh\necho "$@" >> "${dir}/calls"\nexit ${code}\n`);
  chmodSync(gh, 0o755);
  return {gh, calls: () => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : [])};
}
const night = (fake, gh, extra = {}) => env(fake, {TH_ROLE: 'night', TH_GH: gh.gh, TH_REPO: 'owner/repo', ...extra});

test('analysis and like read one song from the listening pass', withFake(async fake => {
  fake.state.analysis.r2_native_x = {
    id: 'r2_native_x', state: 'done', like_at: 5,
    analysis: {bpm: 92.5, key: 'Am', camelot: '8A', energy: 0.4, top_moods: ['calm', 'dreamy', 'peaceful']},
    like: Array.from({length: 12}, (_, i) => ({id: `r2_native_${i}`, title: `Song ${i}`, artist: 'Band', sim: 0.9 - i / 100})),
  };
  const a = await th(['music', 'analysis', 'r2_native_x'], env(fake));
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(a.json, {id: 'r2_native_x', state: 'done', analysis: fake.state.analysis.r2_native_x.analysis});
  const l = await th(['music', 'like', 'r2_native_x', '--n', '3'], env(fake));
  assert.equal(l.json.like.length, 3);
  assert.equal(l.json.like_at, 5);
  const asked = fake.state.requests.filter(r => r.path === '/v1/music/analysis/r2_native_x').map(r => r.query.like);
  assert.deepEqual(asked, ['0', '3']);
  assert.equal(errCode(await th(['music', 'like', 'r2_native_x', '--n', '99'], env(fake))), 'validation');
  assert.equal(errCode(await th(['music', 'analysis'], env(fake))), 'validation');
  assert.equal((await th(['music', 'analysis', 'r2_nope'], env(fake))).code, 8);
}));

test('jobs: collects runs that are over, then sends the next songs by the job id alone', withFake(async fake => {
  const gh = fakeGh();
  const old = fake.now() - 7 * 3_600_000;
  fake.state.jobs.push(
    {job_id: `${ID}1`, kind: 'audio.analysis', state: 'issued', issued_at: old},
    {job_id: `${ID}2`, kind: 'audio.analysis', state: 'issued', issued_at: old, collect: 'no_manifest'},
    {job_id: `${ID}3`, kind: 'audio.analysis', state: 'issued', issued_at: fake.now() - 60_000},
  );
  fake.state.nextJobs['audio.analysis'].push({job_id: `${ID}4`, kind: 'audio.analysis', v: 2, shas: [HASH, 'cd'.repeat(32)]});
  const r = await th(['music', 'jobs'], night(fake, gh));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json, {
    collected: {validating: 1, waiting: 1},
    issued: {kind: 'audio.analysis', job_id: `${ID}4`, count: 2},
    dispatched: true,
  });
  assert.ok(!r.stdout.includes(HASH) && !r.stderr.includes(HASH), 'no hash printed');
  assert.deepEqual(gh.calls(), [`workflow run jobs-audio.yml --ref main -f job_id=${ID}4 -R owner/repo`]);
  const collects = fake.state.requests.filter(x => x.method === 'POST').map(x => x.path);
  assert.deepEqual(collects, [`/v1/jobs/${ID}1/collect`, `/v1/jobs/${ID}2/collect`], 'a run still within its hours is left alone');
  assert.deepEqual(fake.state.requests.find(x => x.path === '/v1/jobs/next').query, {kind: 'audio.analysis', max: '500'});
}));

test('jobs: the neighbours step once nothing waits; a refused dispatch and a busy pass are said', withFake(async fake => {
  const refused = fakeGh(1);
  fake.state.nextJobs['audio.neighbours'].push({job_id: `${ID}5`, kind: 'audio.neighbours', v: 1, n: 9000});
  const r = await th(['music', 'jobs', '--max', '200'], night(fake, refused));
  assert.deepEqual(r.json, {collected: {}, issued: {kind: 'audio.neighbours', job_id: `${ID}5`, count: 9000}, dispatched: false, reason: 'dispatch_refused'});
  assert.equal(refused.calls().length, 1);
  const kinds = fake.state.requests.filter(x => x.path === '/v1/jobs/next').map(x => x.query.kind);
  assert.deepEqual(kinds, ['audio.analysis', 'audio.neighbours']);
  fake.state.nextJobs['audio.analysis'].push('busy');
  const gh = fakeGh();
  const b = await th(['music', 'jobs'], night(fake, gh));
  assert.deepEqual(b.json, {collected: {}, issued: null, dispatched: false, reason: 'open_jobs'});
  const none = await th(['music', 'jobs'], night(fake, gh));
  assert.deepEqual(none.json, {collected: {}, issued: null, dispatched: false});
  assert.deepEqual(gh.calls(), []);
  assert.equal(errCode(await th(['music', 'jobs', '--max', '501'], night(fake, gh))), 'validation');
}));
