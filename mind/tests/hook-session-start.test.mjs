// SessionStart hook (RUNTIME.md §6.1, check HK-1) and the truncation rule it shares with th.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {HOOK, ROOT, env, runNode, startFake} from './helpers.mjs';
import {CUT_MARKER, sectionOf, truncateBriefing} from '../cli/lib/brief.mjs';
import {constitutionText, roleSection, roleText} from '../hooks/lib/laws.mjs';

/** Runs the SessionStart hook as .claude/settings.json does: five commands at once, one piece each. */
const COMMANDS = [['laws'], ['role'], ['brief', '1'], ['brief', '2'], ['brief', '3']];
async function start(payload, e) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const runs = await Promise.all(COMMANDS.map(args => runNode(HOOK('session-start'), args, {env: e, input})));
  return Object.fromEntries(COMMANDS.map((args, i) => [args.join(' '), runs[i]]));
}
/** brief 1's text after its heading line. */
const briefOne = r => r['brief 1'].stdout.replace(/^# Briefing[^\n]*\n/, '');

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


const ROLE_HEAD = '# Your role (mind/ROLES.md)\n';
const constitution = () => `${constitutionText()}\n`;

test('startup: five pieces, each with its heading and ≤ 9,500; one claim, the env file and brief.md', async () => {
  const fake = await startFake();
  try {
    const wake = fake.fireWake('chat', 'prewarm');
    const e = env(fake);
    e.CLAUDE_ENV_FILE = join(e.TMPDIR, 'env.sh');
    writeFileSync(e.CLAUDE_ENV_FILE, '');
    const r = await start({hook_event_name: 'SessionStart', source: 'startup', session_id: 'abc'}, e);
    for (const [name, run] of Object.entries(r)) {
      assert.equal(run.code, 0, name);
      assert.ok(run.stdout.length <= 9500, `${name}: ${run.stdout.length}`);
      assert.match(run.stdout, /^# /, `${name} starts with a heading line`);
    }
    assert.equal(r.laws.stdout, constitution());
    assert.ok(r.laws.stdout.startsWith('# The Thunderhead'), 'the constitution\'s own heading');
    assert.equal(r.role.stdout, `${ROLE_HEAD}${roleText('chat')}\n`);
    assert.match(r['brief 1'].stdout, /^# Briefing, part 1 of 3\n## 1\. Now/);
    assert.equal(r['brief 2'].stdout, "# Briefing, part 2 of 3\n## Today's conversation\nNo messages yet today.\n");
    assert.match(r['brief 3'].stdout, /^# Briefing, part 3 of 3\n## 8\. On demand/);
    assert.equal(fake.state.requests.filter(q => q.path === '/v1/mind/brief').length, 1, 'one claim');
    assert.equal(fake.state.wakes[0].status, 'claimed');
    assert.match(readFileSync(join(e.TMPDIR, 'th/brief.md'), 'utf8'), /## 8\. Profile/);
    const envFile = readFileSync(e.CLAUDE_ENV_FILE, 'utf8');
    assert.equal(envFile.match(/^export PATH=/gm).length, 1, 'written once, by brief 1');
    assert.match(envFile, /^export PATH='.*\/mind\/bin':"\$PATH"$/m);
    assert.match(envFile, /^export TH_SESSION_CLAIMED=1$/m);
    assert.match(envFile, new RegExp(`^export TH_WAKE_ID='${wake.id}'$`, 'm'));
  } finally { await fake.stop(); }
});

test('full parts of 9,400 characters print ≤ 9,500 each; role_section picks the ROLES.md section', async () => {
  const part = n => section(n, 9_300).slice(0, 9_400);
  const fake = await startFake({parts: [part(1), part(2), part(3)], roleSection: 'night'});
  try {
    const r = await start({source: 'startup'}, env(fake));
    for (const k of ['brief 1', 'brief 2', 'brief 3']) {
      assert.ok(r[k].stdout.length <= 9500, `${k}: ${r[k].stdout.length}`);
      assert.ok(r[k].stdout.includes(part(Number(k.slice(-1)))), `${k} whole`);
    }
    assert.equal(r.role.stdout, `${ROLE_HEAD}${roleText('night')}\n`);
  } finally { await fake.stop(); }
  const unknown = await startFake({roleSection: 'no such role'});
  try {
    const r = await start({source: 'startup'}, env(unknown));
    assert.equal(r.role.stdout, `${ROLE_HEAD}${roleText('chat')}\n`, 'an unknown name: the role\'s own');
  } finally { await unknown.stop(); }
});

test('a Worker without parts: brief 1 prints its core cut to fit, brief 2 and 3 print nothing', async () => {
  const fake = await startFake({coreOverride: big, fullOverride: big, parts: null});
  try {
    const r = await start({source: 'startup'}, env(fake));
    assert.ok(r['brief 1'].stdout.length <= 9500, String(r['brief 1'].stdout.length));
    assert.match(r['brief 1'].stdout, /^# Briefing\n## 1\. Section 1\n/);
    assert.ok(r['brief 1'].stdout.endsWith(`${CUT_MARKER}\n`));
    const kept = briefOne(r).slice(0, -CUT_MARKER.length - 2).split(/\n(?=## )/).map(s => s.replace(/\n+$/, ''));
    for (const [i, s] of kept.entries()) assert.equal(s, sectionOf(big, i + 1), `section ${i + 1} is whole`);
    assert.deepEqual([r['brief 2'].stdout, r['brief 3'].stdout], ['', '']);
    assert.equal(r.role.stdout, `${ROLE_HEAD}${roleText('chat')}\n`);
  } finally { await fake.stop(); }
});

test('compact, resume and clear print the same pieces again without a claim', async () => {
  const fake = await startFake();
  try {
    fake.fireWake('chat');
    for (const source of ['compact', 'resume', 'clear']) {
      const r = await start({source}, env(fake));
      assert.match(r['brief 1'].stdout, /^# Briefing, part 1 of 3\n## 1\. Now/, source);
      assert.match(r['brief 2'].stdout, /^# Briefing, part 2 of 3/);
      assert.equal(r.laws.stdout, constitution());
      assert.equal(r.role.stdout, `${ROLE_HEAD}${roleText('chat')}\n`);
    }
    assert.equal(fake.state.wakes[0].status, 'fired');
    assert.ok(fake.state.requests.filter(q => q.path === '/v1/mind/brief').every(q => q.body.claim === false));
  } finally { await fake.stop(); }
});

test('HK-1: Worker down → the exact fallback line from brief 1 only, the laws still, exit 0', async () => {
  const r = await start({source: 'startup'}, env(null));
  for (const run of Object.values(r)) assert.equal(run.code, 0);
  assert.equal(FALLBACK.exec(briefOne(r))?.[1], 'unreachable');
  assert.match(r['brief 1'].stdout, /^# Briefing\n/);
  assert.equal(r.laws.stdout, constitution());
  assert.deepEqual([r.role.stdout, r['brief 2'].stdout, r['brief 3'].stdout], ['', '', '']);
  assert.ok(r.role.ms < 10_000, 'the others stop at the failure, not at 27 s');
});

test('fallback on a refused token, a hung Worker, and bad JSON input still exits 0', async () => {
  const fake = await startFake({holdUnitMs: 20});
  try {
    const refused = await start({source: 'startup'}, env(fake, {TH_TOKEN: 'thm_wrong_key_one'}));
    assert.equal(FALLBACK.exec(briefOne(refused))?.[1], 'unauthorized');
    const garbage = await start('not json', env(fake));
    assert.equal(garbage['brief 1'].code, 0);
    assert.match(garbage['brief 1'].stdout, /^# Briefing, part 1 of 3\n## 1\. Now/, 'bad input is treated as startup');
  } finally { await fake.stop(); }
  const hung = await startFake();
  hung.failNext('POST', '/v1/mind/brief', 503, 'unavailable', 99);
  try {
    const r = await start({source: 'startup'}, {...env(hung), TH_HOOK_TIMEOUT_MS: '300', TH_RETRY_BASE_MS: '1000'});
    assert.equal(r['brief 1'].code, 0);
    assert.equal(FALLBACK.exec(briefOne(r))?.[1], 'timeout');
  } finally { await hung.stop(); }
});

test('already_live and night_done print their end instructions from brief 1 alone', async () => {
  const fake = await startFake({nightDone: true});
  try {
    await start({source: 'startup'}, env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_first'}));
    const second = await start({source: 'startup'}, env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_second'}));
    assert.equal(briefOne(second), 'Another chat session is live. End this session now.\n');
    assert.deepEqual([second.role.stdout, second['brief 2'].stdout], ['', '']);
    const night = await start({source: 'startup'}, env(fake, {TH_ROLE: 'night'}));
    assert.equal(briefOne(night), 'Night work for 2026-10-28 is already done. End now.\n');
    assert.equal(night['brief 3'].stdout, '');
  } finally { await fake.stop(); }
});

test('TH_ROLE unset (a developer session): every command exits 0 with no output, no Worker call, no files', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: undefined});
    e.CLAUDE_ENV_FILE = join(e.TMPDIR, 'env.sh');
    writeFileSync(e.CLAUDE_ENV_FILE, '');
    const r = await start({source: 'startup'}, e);
    for (const run of Object.values(r)) assert.deepEqual([run.code, run.stdout, run.stderr], [0, '', '']);
    assert.equal(fake.state.requests.length, 0);
    assert.equal(readFileSync(e.CLAUDE_ENV_FILE, 'utf8'), '');
    const down = await start({source: 'startup'}, env(null, {TH_ROLE: undefined}));
    for (const run of Object.values(down)) assert.deepEqual([run.code, run.stdout], [0, '']);
  } finally { await fake.stop(); }
});

test('role and brief 2|3 wait for a state file written after their start; a stale one is not theirs', async () => {
  const e = {...env(null), TH_HOOK_WAIT_MS: '400'};
  const stateFile = join(e.TMPDIR, 'th/state/brief_parts.json');
  mkdirSync(join(e.TMPDIR, 'th/state'), {recursive: true});
  writeFileSync(stateFile, JSON.stringify({at: Date.now() - 60_000, ok: true, parts: ['## 1. Old', '## Old two']}));
  const stale = await runNode(HOOK('session-start'), ['brief', '2'], {env: e, input: '{}'});
  assert.deepEqual([stale.code, stale.stdout], [0, ''], 'gives up silently');
  const waiting = runNode(HOOK('session-start'), ['brief', '2'], {env: {...e, TH_HOOK_WAIT_MS: '20000'}, input: '{}'});
  writeFileSync(stateFile, JSON.stringify({at: Date.now(), ok: true, parts: ['## 1. New', '## New two']}));
  const fresh = await waiting;
  assert.equal(fresh.stdout, '# Briefing, part 2 of 2\n## New two\n');
  const none = await runNode(HOOK('session-start'), ['brief', '3'], {env: e, input: '{}'});
  assert.equal(none.stdout, '', 'no part 3 in the answer: nothing');
});

test('the role section is its own only, for each role', () => {
  const roles = readFileSync(join(ROOT, 'mind/ROLES.md'), 'utf8');
  for (const role of ['chat', 'night', 'reflex']) {
    const s = roleSection(roles, role);
    assert.ok(s.startsWith(`## ${role}\n`) && !s.includes('\n## '), `${role}: its own section only`);
    assert.equal(roleText(role), s);
  }
  assert.ok(constitutionText().length + 1 <= 9500, 'the constitution fits its piece');
});
