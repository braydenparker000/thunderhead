// The Muse stand-in drill (RUNTIME.md §15): the recipe walked against the REAL Worker run locally
// (`wrangler dev --local`, synthetic secrets, a fresh owner), with `th` run the way an outside
// assistant runs it: as the `th` command on PATH (mind/bin), from a plain process with none of
// Claude Code's variables, hooks or task notifications. Every value is invented.
//
//   node --test mind/tests/muse-standin.test.mjs                     the recipe, about a minute
//   MUSE_DRILL_IDLE=1 node --test mind/tests/muse-standin.test.mjs   also the idle cut-off, in real
//     time: mind.idle at its least (15 min), so about 16 minutes more
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from './helpers.mjs';
import {PASSWORD, available, setupOwner, startWorker} from './worker-dev.mjs';

const IDLE = process.env.MUSE_DRILL_IDLE === '1';

/** `th …` as Muse's shell runs it: by name, from PATH, answer on stdin. */
function th(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('th', args, {env, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n').pop() || 'null'); } catch { /* text */ }
      resolve({code, stdout, stderr, json});
    });
    child.stdin.end(input);
  });
}

/** Step 2 of the recipe: the whole environment, and nothing from this process but PATH and HOME. */
const museEnv = (url, role, token, n) => ({
  PATH: `${join(ROOT, 'mind/bin')}:${process.env.PATH}`, HOME: process.env.HOME,
  TMPDIR: mkdtempSync(join(tmpdir(), 'muse-')), TH_API: url, TH_ROLE: role, TH_TOKEN: token,
  CLAUDE_CODE_REMOTE_SESSION_ID: `muse_20261122_${n}`,
});

test('Muse stands in for the mind (RUNTIME.md §15)', {timeout: IDLE ? 1_500_000 : 300_000,
  skip: available() ? false : 'wrangler is not installed'}, async t => {
  const w = await startWorker();
  t.after(() => w.stop());
  const {device} = await setupOwner(w, []);
  const ok = (r, what) => assert.equal(r.code, 0, `${what}: exit ${r.code} ${r.stderr}`);
  const say = body => w.call('PUT', `/v1/messages/${crypto.randomUUID().replace(/^(.{14})./, '$17')}`, {token: device, body: {body}});
  const keyFor = async (name, role) => {
    const r = await w.call('POST', '/v1/auth/agents', {token: device, body: {name, role, current_password: PASSWORD}});
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.token;
  };

  // Step 1: the owner makes a Mind · chat key named muse-standin (Settings › Agents does this call).
  const chat = museEnv(w.url, 'chat', await keyFor('muse-standin', 'mind:chat'), 1);

  let asked = '';
  await t.test('3. start: one command gives the claim, the laws, the role, the voice page and the briefing', async () => {
    const s = await th(['brief', '--claim', '--start'], chat);
    ok(s, 'brief --claim --start');
    assert.match(s.stdout, /^# The laws \(mind\/CONSTITUTION\.md\)/m);
    assert.match(s.stdout, /^## chat$/m);
    assert.match(s.stdout, /^# The briefing/m);
    assert.match(s.stdout, /^## 1\. Now/m);
    assert.match(s.stdout, /voice/i);
    const other = {...chat, TMPDIR: mkdtempSync(join(tmpdir(), 'muse-')), CLAUDE_CODE_REMOTE_SESSION_ID: 'muse_20261122_x'};
    assert.equal((await th(['brief', '--claim'], other)).code, 11, 'the lease is held: a second start is already_live');
  });

  await t.test('4. an owner message comes to th listen; nothing waits after it', async () => {
    asked = (await say('I prefer tea to coffee. Remind me to water the plants in two hours.')).body.id;
    const r = await th(['listen', '--minutes', '0.5'], chat);
    ok(r, 'listen');
    assert.equal(r.json.messages[0].id, asked);
    assert.deepEqual((await th(['pending'], chat)).json.unanswered, [asked]);
  });

  await t.test('6. memory and a reminder through the same routes as the mind', async () => {
    const fact = await th(['remember', '--kind', 'preference', '--text', 'Prefers tea to coffee', '--evidence', `msg:${asked}`], chat);
    ok(fact, 'remember');
    assert.equal(fact.json.provenance, 'owner');
    const rem = await th(['remind', '+2h', '-', '--from', asked], chat, 'Water the plants');
    ok(rem, 'remind');
    assert.ok(rem.json.id);
    assert.ok((await th(['remind', 'list'], chat)).json.items.some(x => x.id === rem.json.id));
  });

  await t.test('4–5. th reply sends the answer with the stand-in line, then listens: exit 3 quiet', async () => {
    const r = await th(['reply', '--to', asked, '--minutes', '0.1'], chat,
      'Muse is answering while the mind is away.\n\nNoted: tea, not coffee. I will remind you about the plants in two hours.');
    assert.equal(r.code, 3, r.stderr);
    assert.ok(r.json.quiet, r.stdout);
    assert.deepEqual((await th(['pending'], chat)).json.unanswered, []);
    const today = await w.call('GET', '/v1/threads/today', {token: device});
    const answer = today.body.messages.find(m => m.reply_to === asked);
    assert.equal(answer.author, 'mind');
    assert.match(answer.body, /^Muse is answering while the mind is away\./);
  });

  await t.test('7. an outside read marked by hand: what Muse writes after is labelled outside', async () => {
    const m = await th(['taint', '--source', 'web', '--ref', 'https://example.org/tea'], chat);
    ok(m, 'taint');
    assert.equal(m.json.tainted, true);
    const later = await th(['remember', '--kind', 'fact', '--text', 'Green tea has less caffeine than coffee', '--evidence', `msg:${asked}`], chat);
    ok(later, 'remember after the read');
    assert.equal(later.json.provenance, 'outside');
  });

  await t.test('9. what the site shows: a manual claim, no fire, the key last used', async () => {
    const wakes = await th(['get', '/v1/mind/wakes'], chat);
    ok(wakes, 'wakes');
    assert.ok(JSON.stringify(wakes.json).includes('manual'), wakes.stdout);
    const agents = await w.call('GET', '/v1/auth/agents', {token: device});
    const key = agents.body.items.find(a => a.name === 'muse-standin');
    assert.ok(key.last_used_at > 0, JSON.stringify(key));
  });

  if (IDLE) {
    await t.test('4. the idle cut-off: listen exits 3 until mind.idle passes, then 12 closed', async () => {
      assert.equal((await w.call('PATCH', '/v1/settings', {token: device, body: {'mind.idle': 15}})).status, 200);
      let r;
      for (let i = 0; i < 3; i++) {
        r = await th(['listen'], chat);
        if (r.code !== 3) break;
      }
      assert.equal(r.code, 12, r.stdout + r.stderr);
      assert.ok(r.json.closed);
      const again = museEnv(w.url, 'chat', chat.TH_TOKEN, 2);
      ok(await th(['brief', '--claim'], again), 'the lease is free again');
      ok(await th(['status', 'stopping'], again), 'and that start lets go');
    });
  }

  await t.test('10. going back: th status stopping frees the lease at once for the next session', async () => {
    ok(await th(['status', 'stopping'], chat), 'stopping');
    const next = museEnv(w.url, 'chat', chat.TH_TOKEN, 3);
    ok(await th(['brief', '--claim'], next), 'a new start claims');
    ok(await th(['status', 'stopping'], next), 'and lets go');
  });

  await t.test('8. a night run with a Mind · night key: start, the day note and the morning note, done (partial)', async () => {
    const night = museEnv(w.url, 'night', await keyFor('muse-night', 'mind:night'), 9);
    const s = await th(['brief', '--claim', '--start'], night);
    ok(s, 'night brief --claim --start');
    assert.match(s.stdout, /^## night$/m);
    const run = await th(['night', 'start'], night);
    ok(run, 'night start');
    assert.ok(Array.isArray(run.json.todo) && run.json.todo.length, run.stdout);
    const day = run.json.day ?? (await th(['brief', '--json'], night)).json.day;
    ok(await th(['daynote', day, '--summary', 'A quiet day: tea noted, a plant reminder set.', '--decision', 'Tea over coffee',
      '--importance', '3', '--voice', 'They keep their days simple.'], night), 'step 2: daynote');
    ok(await th(['report', '--headline', 'A quiet night', '--note', '-'], night,
      'Muse ran the night while the mind is away: the day note is written; the rest waits for the mind.'), 'step 12: report');
    const done = await th(['night', 'done', '--partial'], night);
    ok(done, 'night done');
    assert.equal(done.json.done, true);
  });
});
