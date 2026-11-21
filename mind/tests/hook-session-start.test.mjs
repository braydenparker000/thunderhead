// SessionStart hook (RUNTIME.md §6.1, check HK-1) and the truncation rule it shares with th.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, env, hook, startFake} from './helpers.mjs';
import {CUT_MARKER, sectionOf, truncateBriefing} from '../cli/lib/brief.mjs';
import {lawsText, roleSection} from '../hooks/lib/laws.mjs';

/** A mind session's output starts with its laws; returns what follows them (the briefing or a line). */
function afterLaws(stdout, role = 'chat') {
  const laws = lawsText(role);
  assert.ok(laws.length > 2000, 'the laws are read');
  assert.ok(stdout.startsWith(laws), `starts with the constitution and the ${role} section`);
  return stdout.slice(laws.length);
}

const FALLBACK = /^BRIEFING UNAVAILABLE \(([a-z_0-9]+)\)\. Before answering anything, run: th brief --claim\. If that fails, run th status limited --error briefing and end\.\n$/;
const section = (n, size) => `## ${n}. Section ${n}\n${Array.from({length: Math.ceil(size / 80)}, (_, i) => `line ${i} `.padEnd(79, 'x')).join('\n')}`;
const big = Array.from({length: 15}, (_, i) => section(i + 1, 2000)).join('\n\n'); // ~30,000 characters

test('truncateBriefing keeps short text, cuts between whole sections, and ends with the marker', () => {
  assert.equal(truncateBriefing('## 1. Now\nshort'), '## 1. Now\nshort');
  assert.ok(big.length > 29_000);
  const cut = truncateBriefing(big);
  assert.ok(cut.length <= 9500, String(cut.length));
  assert.ok(cut.endsWith(`\n${CUT_MARKER}`));
  const kept = cut.slice(0, -CUT_MARKER.length - 1).split(/\n(?=## )/).map(s => s.replace(/\n+$/, ''));
  for (const [i, s] of kept.entries()) assert.equal(s, sectionOf(big, i + 1), `section ${i + 1} is whole`);
  assert.equal(kept.length, 4);
});

test('truncateBriefing falls back to the last full line when one section is over the cap', () => {
  const one = section(1, 20_000);
  const cut = truncateBriefing(one);
  assert.ok(cut.length <= 9500);
  const body = cut.slice(0, -CUT_MARKER.length - 1);
  assert.ok(one.startsWith(body) && one[body.length] === '\n', 'cut at a line end');
});

test('startup: claims, prints the core, writes the full briefing and the env file', async () => {
  const fake = await startFake();
  try {
    const wake = fake.fireWake('chat', 'prewarm');
    const e = env(fake);
    e.CLAUDE_ENV_FILE = join(e.TMPDIR, 'env.sh');
    writeFileSync(e.CLAUDE_ENV_FILE, '');
    const r = await hook('session-start', {hook_event_name: 'SessionStart', source: 'startup', session_id: 'abc'}, e);
    assert.equal(r.code, 0);
    assert.match(afterLaws(r.stdout), /^## 1\. Now/);
    assert.equal(fake.state.wakes[0].status, 'claimed');
    assert.match(readFileSync(join(e.TMPDIR, 'th/brief.md'), 'utf8'), /## 8\. Profile/);
    const envFile = readFileSync(e.CLAUDE_ENV_FILE, 'utf8');
    assert.match(envFile, /^export PATH='.*\/mind\/bin':"\$PATH"$/m);
    assert.match(envFile, /^export TH_SESSION_CLAIMED=1$/m);
    assert.match(envFile, new RegExp(`^export TH_WAKE_ID='${wake.id}'$`, 'm'));
  } finally { await fake.stop(); }
});

test('HK-1: a 30,000-character core prints ≤ 9,500 characters ending with the cut marker', async () => {
  const fake = await startFake({coreOverride: big, fullOverride: big});
  try {
    const r = await hook('session-start', {source: 'startup'}, env(fake));
    assert.equal(r.code, 0);
    assert.ok(r.stdout.length <= 9500, String(r.stdout.length));
    assert.ok(r.stdout.endsWith(`${CUT_MARKER}\n`));
  } finally { await fake.stop(); }
});

test('compact/resume re-brief without claiming', async () => {
  const fake = await startFake();
  try {
    fake.fireWake('chat');
    const r = await hook('session-start', {source: 'compact'}, env(fake));
    assert.equal(r.code, 0);
    assert.match(afterLaws(r.stdout), /^## 1\. Now/);
    assert.equal(fake.state.wakes[0].status, 'fired');
  } finally { await fake.stop(); }
});

test('HK-1: Worker down → the exact fallback line, exit 0', async () => {
  const r = await hook('session-start', {source: 'startup'}, env(null));
  assert.equal(r.code, 0);
  assert.match(afterLaws(r.stdout), FALLBACK);
  assert.equal(FALLBACK.exec(afterLaws(r.stdout))[1], 'unreachable');
});

test('fallback on a refused token, a hung Worker, and bad JSON input still exits 0', async () => {
  const fake = await startFake({holdUnitMs: 20});
  try {
    const refused = await hook('session-start', {source: 'startup'}, env(fake, {TH_TOKEN: 'thm_wrong_key_one'}));
    assert.equal(FALLBACK.exec(afterLaws(refused.stdout))?.[1], 'unauthorized');
    const garbage = await hook('session-start', 'not json', env(fake));
    assert.equal(garbage.code, 0);
    assert.match(afterLaws(garbage.stdout), /^## 1\. Now/, 'bad input is treated as startup');
  } finally { await fake.stop(); }
  const hung = await startFake();
  hung.failNext('POST', '/v1/mind/brief', 503, 'unavailable', 99);
  try {
    const r = await hook('session-start', {source: 'startup'}, {...env(hung), TH_HOOK_TIMEOUT_MS: '300', TH_RETRY_BASE_MS: '1000'});
    assert.equal(r.code, 0);
    assert.equal(FALLBACK.exec(afterLaws(r.stdout))?.[1], 'timeout');
  } finally { await hung.stop(); }
});

test('already_live and night_done print their end instructions', async () => {
  const fake = await startFake({nightDone: true});
  try {
    await hook('session-start', {source: 'startup'}, env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_first'}));
    const second = await hook('session-start', {source: 'startup'}, env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_second'}));
    assert.equal(afterLaws(second.stdout), 'Another chat session is live. End this session now.\n');
    const night = await hook('session-start', {source: 'startup'}, env(fake, {TH_ROLE: 'night'}));
    assert.equal(afterLaws(night.stdout, 'night'), 'Night work for 2026-10-28 is already done. End now.\n');
  } finally { await fake.stop(); }
});

test('TH_ROLE unset (a developer session): exit 0, no output, no Worker call, no files', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: undefined});
    e.CLAUDE_ENV_FILE = join(e.TMPDIR, 'env.sh');
    writeFileSync(e.CLAUDE_ENV_FILE, '');
    const r = await hook('session-start', {source: 'startup'}, e);
    assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', '']);
    assert.equal(fake.state.requests.length, 0);
    assert.equal(readFileSync(e.CLAUDE_ENV_FILE, 'utf8'), '');
    const down = await hook('session-start', {source: 'startup'}, env(null, {TH_ROLE: undefined}));
    assert.deepEqual([down.code, down.stdout], [0, ''], 'not even the fallback line when the Worker is down');
  } finally { await fake.stop(); }
});

test('the laws come first on every source, for each role, and the whole output stays ≤ 9,500', async () => {
  const fake = await startFake({coreOverride: big, fullOverride: big});
  try {
    const constitution = readFileSync(join(ROOT, 'mind/CONSTITUTION.md'), 'utf8').replace(/\n+$/, '');
    const roles = readFileSync(join(ROOT, 'mind/ROLES.md'), 'utf8');
    for (const role of ['chat', 'night', 'reflex']) {
      const section = roleSection(roles, role);
      assert.ok(section.startsWith(`## ${role}\n`) && !section.includes('\n## '), `${role}: its own section only`);
      assert.equal(lawsText(role), `${constitution}\n\n${section}\n\n`);
    }
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      fake.fireWake('chat');
      const r = await hook('session-start', {source}, env(fake));
      assert.equal(r.code, 0);
      assert.ok(r.stdout.length <= 9500, `${source}: ${r.stdout.length}`);
      const rest = afterLaws(r.stdout);
      assert.match(rest, /^## 1\. Section 1\n/, `${source}: the briefing follows the laws`);
      assert.ok(rest.endsWith(`${CUT_MARKER}\n`));
      assert.ok(!rest.includes('## night'), 'no other role\'s section');
    }
    const night = await hook('session-start', {source: 'compact'}, env(fake, {TH_ROLE: 'night'}));
    assert.ok(!afterLaws(night.stdout, 'night').includes('## chat'));
  } finally { await fake.stop(); }
});
