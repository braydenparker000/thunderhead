// The listening pass's Actions side (JOBS.md §2, §3.4): the workflow runs from main only, on dispatch
// only, one at a time, never on a pull request, its job id checked before use and its secrets only in
// the env of the step that needs them, with nothing that prints them; the Python job logs fixed words
// and counts only; its lists equal the contract's; every Python dependency is pinned with its hash; a
// result the analyzer made from synthetic tones passes schema v2; and the analyzer's own tests run when
// numpy and scipy are installed (they are not on CI's runners, so there the fixture check stands in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from '../backend/src/areas/work/validate.ts';
import { ANALYSIS_SCHEMA, ANALYZER, CLAP_MODEL, LISTEN_LIMITS, MOODS } from '../shared/contract/listen.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const yml = read('.github/workflows/jobs-audio.yml');
const code = (yml.split('\n').filter((l) => !l.trim().startsWith('#'))).join('\n');

test('the workflow runs from main only, on dispatch only, one at a time, its job id checked first', () => {
  assert.match(code, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}job_id:\n/m);
  for (const t of ['pull_request', 'pull_request_target', 'push:', 'schedule:', 'workflow_run', 'workflow_call'])
    assert.ok(!code.includes(t), `no ${t}`);
  assert.match(code, /^permissions: \{\}$/m);
  assert.match(code, /\n {4}permissions:\n {6}contents: read\n/);
  assert.ok(!/id-token|write-all|: write/.test(code), 'no write permission, no id-token');
  assert.match(code, /\n {4}if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}\n/);
  assert.match(code, /concurrency:\n {2}group: jobs-audio\n {2}cancel-in-progress: false/);
  const minutes = Number(/timeout-minutes: (\d+)/.exec(code)?.[1]);
  assert.ok(minutes > 0 && minutes <= 300, `timeout ${minutes}`);
  assert.match(code, /\n {4}environment: jobs\n/);
  const check = code.indexOf('name: Check the job id');
  assert.ok(check > 0 && check < code.indexOf('actions/checkout'), 'the id is checked before anything else');
  assert.match(code, /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$/);
  // The input only ever reaches a step through env, never pasted into a script.
  for (const line of code.split('\n').filter((l) => l.includes('inputs.job_id')))
    assert.match(line, /^ +JOB_ID: \$\{\{ inputs\.job_id \}\}$/, line);
});

test('secrets reach a step only through its env, and nothing prints them or keeps job data', () => {
  const secrets = new Set();
  for (const line of code.split('\n').filter((l) => l.includes('secrets.'))) {
    const m = /^ {10}([A-Z0-9_]+): \$\{\{ secrets\.([A-Z0-9_]+) \}\}$/.exec(line);
    assert.ok(m, `a secret outside a step's env: ${line.trim()}`);
    secrets.add(m[2]);
  }
  assert.deepEqual([...secrets].sort(), ['R2_ACCOUNT_ID', 'R2_JOBS_ACCESS_KEY_ID', 'R2_JOBS_SECRET', 'TH_CI_TOKEN']);
  assert.ok(!/\$\{\{ (secrets|vars|inputs)\.[^}]*\}\}[^\n]*$/m.test(code.split('\n').filter((l) => /^\s+run: /.test(l)).join('\n')), 'nothing pasted into a run line');
  for (const banned of [/set -x/, /\bprintenv\b/, /^\s+(run: )?env\s*$/m, /\becho\b[^\n]*\$\{\{/, /--verbose/, /upload-artifact/, /actions\/cache/, /ACTIONS_STEP_DEBUG/])
    assert.ok(!banned.test(code), `no ${banned}`);
  for (const m of code.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} is pinned by its commit`);
  assert.match(code, /persist-credentials: false/);
  assert.ok(!code.includes('thunderhead-private'), 'no key or name of the private bucket');
});

test('the Python job logs fixed words and counts only, and never a traceback', () => {
  const dir = new URL('../jobs/audio/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.py'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/traceback|print_exc|logging\.exception/.test(src), `${f}: no traceback`);
    // A placeholder may count things (len(…)), never show one.
    for (const m of src.matchAll(/\blog\((f?"[^"]*")\)/g))
      for (const [, p] of m[1].matchAll(/\{([^}]*)\}/g))
        assert.ok(p.startsWith('len(') || !/sha|host|path|token|secret|key|url|spec|name|job/.test(p), `${f}: ${m[1]}`);
    const prints = [...src.matchAll(/\bprint\(/g)].length;
    const allowed = { 'run.py': 2, '__main__.py': 4, 'projection.py': 1 }[f] ?? 0;
    assert.ok(prints <= allowed, `${f}: ${prints} print calls (the log goes through log())`);
  }
  const main = read('jobs/audio/__main__.py');
  assert.match(main, /except BaseException:[^\n]*\n\s+print\("fail: internal"/, 'any other failure prints one fixed line');
});

test('the job’s lists equal the contract’s', () => {
  const init = read('jobs/audio/__init__.py');
  assert.equal(/^NAME = "([^"]+)"/m.exec(init)?.[1], ANALYZER.name);
  assert.equal(/^VERSION = "([^"]+)"/m.exec(init)?.[1], ANALYZER.version);
  const moods = read('jobs/audio/moods.py');
  const keys = [...moods.slice(moods.indexOf('MOODS = {'), moods.indexOf('}')).matchAll(/^ {4}"([a-z]+)":/gm)].map((m) => m[1]);
  assert.deepEqual(keys, [...MOODS]);
  const clap = read('jobs/audio/clap.py');
  assert.equal(/^MODEL = "([^"]+)"/m.exec(clap)?.[1], CLAP_MODEL.id);
  assert.equal(/^REVISION = "([0-9a-f]{40})"/m.exec(clap)?.[1], CLAP_MODEL.revision);
  assert.equal(Number(/^DIM_OUT = (\d+)/m.exec(read('jobs/audio/projection.py'))?.[1]), LISTEN_LIMITS.dim);
});

test('every Python dependency is pinned to one version with its hash', () => {
  for (const f of ['jobs/audio/requirements.txt', 'jobs/audio/requirements-clap.txt']) {
    const text = read(f);
    const blocks = text.split('\n').filter((l) => l && !l.startsWith('#')).join('\n').split(/\n(?=\S)/);
    assert.ok(blocks.length >= 2, f);
    for (const b of blocks) {
      if (b === '--extra-index-url https://download.pytorch.org/whl/cpu') continue;
      assert.match(b, /^[a-z0-9][a-z0-9._-]*==[0-9][^\s\\]* \\\n(?: {4}--hash=sha256:[0-9a-f]{64}(?: \\\n|$))+/, `${f}: ${b.split('\n')[0]}`);
    }
  }
  assert.match(read('jobs/audio/requirements-clap.txt'), /^torch==[0-9.]+\+cpu /m, 'the CPU build of PyTorch');
});

test('a result the analyzer made from synthetic tones passes schema v2; words never do', () => {
  const r = JSON.parse(read('tests/fixtures/listen/result-v2.json'));
  assert.deepEqual(check(r, ANALYSIS_SCHEMA), []);
  assert.equal(Object.keys(r.moods).length, MOODS.length);
  assert.equal(r.emb.length, LISTEN_LIMITS.dim);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= LISTEN_LIMITS.result_bytes);
  assert.notDeepEqual(check({ ...r, note: 'a word' }, ANALYSIS_SCHEMA), []);
  assert.notDeepEqual(check({ ...r, key: 'C major, probably' }, ANALYSIS_SCHEMA), []);
  assert.notDeepEqual(check({ ...r, moods: { ...r.moods, wistful: 0.5 } }, ANALYSIS_SCHEMA), []);
  assert.notDeepEqual(check({ ...r, analyzer: { name: 'th-audio', version: 'latest' } }, ANALYSIS_SCHEMA), []);
});

const python = spawnSync('python3', ['-c', 'import numpy, scipy'], { encoding: 'utf8' }).status === 0;
test('the analyzer’s own tests (synthetic tones with known BPM, key and loudness)', { skip: !python && 'numpy and scipy are not installed' }, () => {
  const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'jobs/audio/tests', '-t', '.'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const d = spawnSync('python3', ['-m', 'jobs.audio', '--describe'], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(d.stdout).moods, [...MOODS]);
});
