// th against the real Worker (RUNTIME.md §5.3 acceptance): `wrangler dev --local` runs the Worker
// and its Durable Objects in workerd with synthetic secrets, the owner is set up over HTTP as on a
// phone, and th runs as a child process with a dev key per role. It walks the P2 loop (claim,
// hand-out, ack, reply, search, verb, surface, undo, Stop) and produces every exit code the real
// Worker can give here: 0, 2, 3, 4, 6, 7, 8, 9 and 11. (5 day closed, 10 budget and 1 bad JSON
// need a clock or a broken Worker; the fake-Worker tests cover them.)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {freshTmp, th} from './helpers.mjs';
import {available, setupOwner, startWorker} from './worker-dev.mjs';

test('th against the real Worker', {timeout: 300_000, skip: available() ? false : 'wrangler is not installed'}, async t => {
  const w = await startWorker();
  t.after(() => w.stop());
  const {device, keys} = await setupOwner(w, ['mind:chat', 'mind:night']);
  const base = {PATH: process.env.PATH, HOME: process.env.HOME, TH_API: w.url, TH_RETRY_BASE_MS: '50'};
  const chat = {...base, TMPDIR: freshTmp(), TH_ROLE: 'chat', TH_TOKEN: keys['mind:chat'], CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_e2e_first'};
  const say = body => w.call('PUT', `/v1/messages/${crypto.randomUUID().replace(/^(.{14})./, '$17')}`, {token: device, body: {body}});
  const ok = (r, what) => assert.equal(r.code, 0, `${what}: ${r.stderr}`);

  await t.test('brief --claim holds the lease; a second chat session is refused (11)', async () => {
    ok(await th(['health'], chat), 'health');
    const b = await th(['brief', '--claim'], chat);
    ok(b, 'brief');
    assert.match(b.stdout, /^## 1\. Now/m);
    assert.ok(existsSync(join(chat.TMPDIR, 'th', 'brief.md')));
    const other = {...chat, TMPDIR: freshTmp(), CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_e2e_second'};
    assert.equal((await th(['brief', '--claim'], other)).code, 11);
  });

  let asked = '';
  await t.test('wait hands out the owner message; status acknowledges; a reply settles it', async () => {
    asked = (await say('What is the plan for the evening')).body.id;
    const r = await th(['wait', '--minutes', '0.5'], chat);
    ok(r, 'wait');
    assert.equal(r.json.messages[0].id, asked);
    ok(await th(['status', 'working'], chat), 'status');
    ok(await th(['say', 'today', '--reply-to', asked, 'The plan is a walk, then music.'], chat), 'say');
    assert.deepEqual((await th(['pending'], chat)).json.unanswered, []);
    assert.equal((await th(['say', 'today', 'Great question. A walk.'], chat)).code, 8, 'the phrase lint');
  });

  await t.test('search, get and help reach the built routes; later phases exit 8 not_built', async () => {
    const s = await th(['search', 'evening plan'], chat);
    ok(s, 'search');
    assert.equal(s.json.items[0].source, 'messages');
    const today = await th(['get', '/v1/threads/today'], chat);
    ok(today, 'get');
    assert.ok(today.json.messages.some(m => m.id === asked));
    assert.match((await th(['help'], chat)).stdout, /shell\.appearance/);
    const later = await th(['remember', '--kind', 'fact', '--text', 'x', '--evidence', `msg:${asked}`], chat);
    assert.equal(later.code, 8);
    assert.match(later.stderr, /not_built/);
  });

  await t.test('a verb reaches the phone; a surface is placed, undone, and the 14-day quiet rule is 7', async () => {
    const v = await th(['verb', 'shell.appearance', '{"mode":"night"}', '--why', 'the owner asked for night mode'], chat);
    ok(v, 'verb');
    const pending = await w.call('GET', '/v1/verbs/pending', {token: device});
    assert.ok(pending.body.items.some(x => x.id === v.json.verb_id));
    const line = ['surface', 'home', 'line.1', '--kind', 'line', '--payload', '{"text":"Good evening."}', '--why', 'a short evening greeting', '--topic', 'greeting'];
    const placed = await th(line, chat);
    ok(placed, 'surface');
    const undo = await th(['undo', placed.json.ledger_id], chat);
    ok(undo, 'undo');
    assert.equal(undo.json.status, 'undone');
    ok(await th(line, chat), 'surface again');
    assert.equal((await w.call('DELETE', '/v1/surfaces/home/line.1', {token: device})).status, 204);
    assert.equal((await th(line, chat)).code, 7, 'nudge_repeat');
  });

  await t.test("the owner's Stop: wait exits 4, replies say STOP, the next reply clears it", async () => {
    assert.equal((await w.call('POST', '/v1/mind/stop', {token: device})).status, 204);
    assert.equal((await th(['wait', '--minutes', '0.5'], chat)).code, 4);
    const st = await th(['status', 'working'], chat);
    ok(st, 'status');
    assert.match(st.stderr, /th: STOP/);
    ok(await th(['say', 'today', 'Stopped. Done: the plan. Not done: nothing.'], chat), 'say');
    assert.equal((await th(['pending'], chat)).json.stop, false);
    assert.equal((await th(['wait', '--minutes', '0.05'], chat)).code, 3, 'nothing more: timeout');
  });

  await t.test('roles, tokens and reachability: 6, 2 and 9', async () => {
    const night = {...base, TMPDIR: freshTmp(), TH_ROLE: 'night', TH_TOKEN: keys['mind:night'], CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_e2e_night'};
    assert.equal((await th(['say', 'today', 'Hello there.'], night)).code, 6, 'night posts only errors');
    ok(await th(['say', 'system', '--kind', 'error', 'Night step 2 failed.'], night), 'night error post');
    assert.equal((await th(['pending'], {...chat, TH_TOKEN: 'thm_not_a_real_key'})).code, 2);
    assert.equal((await th(['pending'], {...chat, TH_API: 'http://127.0.0.1:9'})).code, 9);
  });
});
