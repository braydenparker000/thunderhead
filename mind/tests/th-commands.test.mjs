// Every th command against the fake Worker: request shape, stdout JSON, and exit codes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {VERSION} from '../cli/lib/io.mjs';
import {DAY_PAGES, nightBatchId} from '../cli/lib/memory.mjs';
import {env, errCode, startFake, th} from './helpers.mjs';

/** A fresh fake per test, stopped afterwards. */
const withFake = (options, fn) => async () => {
  const fake = await startFake(options);
  try { await fn(fake); } finally { await fake.stop(); }
};
const last = (fake, path) => fake.state.requests.filter(r => r.path.startsWith(path)).at(-1);

test('brief prints the core, --claim binds the wake and writes $TMPDIR/th/brief.md', withFake({}, async fake => {
  const wake = fake.fireWake('chat', 'message');
  fake.addOwnerMessage('Is the music app working?');
  const e = env(fake);
  const r = await th(['brief', '--claim'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^## 1\. Now/);
  assert.match(r.stdout, /Is the music app working\?/);
  assert.equal(fake.state.wakes[0].status, 'claimed');
  assert.equal(fake.state.wakes[0].id, wake.id);
  assert.match(readFileSync(join(e.TMPDIR, 'th', 'brief.md'), 'utf8'), /## 8\. Profile/);
  const req = last(fake, '/v1/mind/brief');
  assert.equal(req.headers['th-client'], `th/${VERSION}`);
  assert.equal(req.headers['th-role'], 'chat');
  assert.equal(req.headers['th-session'], 'cse_test_session_1');
  const section = await th(['brief', '--section', '2'], e);
  assert.match(section.stdout, /^## 2\. Waiting/);
  const full = await th(['brief', '--full'], e);
  assert.match(full.stdout, /## 8\. Profile/);
  assert.equal((await th(['brief', '--section', '42'], e)).code, 8);
}));

test('brief --claim exits 11 when another chat session holds the lease', withFake({}, async fake => {
  assert.equal((await th(['brief', '--claim'], env(fake))).code, 0);
  const other = await th(['brief', '--claim'], env(fake, {CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_other'}));
  assert.equal(other.code, 11);
  assert.equal(errCode(other), 'already_live');
}));

test('say posts with a client UUIDv7 and reply_to; a lost response is retried with the same id', withFake({}, async fake => {
  const m = fake.addOwnerMessage('hello');
  fake.failNext('PUT', '/v1/messages/', 503, 'unavailable', 1, true); // handled, then the answer is lost
  const r = await th(['say', 'today', '--reply-to', m.id, 'Hi there.'], env(fake));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.json.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const mine = fake.state.messages.filter(x => x.author === 'mind');
  assert.equal(mine.length, 1, 'the retry did not create a second message');
  assert.equal(fake.state.requests.filter(x => x.method === 'PUT' && x.path.startsWith('/v1/messages/')).length, 2);
  assert.ok(m.answered_at, 'reply_to answered the owner message');
}));

test('say reads stdin with -, validates kind locally, and night may only post errors (exit 6)', withFake({}, async fake => {
  const r = await th(['say', 'today', '--kind', 'progress', '-'], env(fake), 'Running the tests\n');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.state.messages.at(-1).body, 'Running the tests');
  assert.equal((await th(['say', 'today', '--kind', 'shout', 'x'], env(fake))).code, 8);
  const night = await th(['say', 'today', 'hello'], env(fake, {TH_ROLE: 'night'}));
  assert.equal(night.code, 6);
  assert.equal(errCode(night), 'forbidden');
  assert.equal((await th(['say', 'system', '--kind', 'error', 'Night shift failed at step 3'], env(fake, {TH_ROLE: 'night'}))).code, 0);
}));

test('say --attach uploads the file; th file downloads it without sending the token', withFake({}, async fake => {
  const e = env(fake);
  const path = join(e.TMPDIR, 'note.txt');
  writeFileSync(path, 'synthetic attachment');
  const r = await th(['say', 'today', '--attach', path, 'See attached.'], e);
  assert.equal(r.code, 0, r.stderr);
  const ref = fake.state.messages.at(-1).attachments[0];
  assert.match(ref, /^file:/);
  const d = await th(['file', ref.slice(5)], e);
  assert.equal(d.code, 0, d.stderr);
  assert.equal(readFileSync(d.json.path, 'utf8'), 'synthetic attachment');
  assert.equal(last(fake, '/_files/').headers.authorization, undefined);
}));

test('status acknowledges, records state, and prints th: STOP when the owner tapped Stop', withFake({}, async fake => {
  const e = env(fake);
  let r = await th(['status', 'working', '--thread', fake.today.id, '--note', 'Reading the player code'], e);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, {ok: true});
  assert.equal(fake.state.statuses.at(-1).note, 'Reading the player code');
  fake.tapStop();
  r = await th(['status', 'working'], e);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /^th: STOP/m);
  r = await th(['say', 'today', 'Stopped. Done: the fix. Not done: the deploy.'], e);
  assert.match(r.stderr, /th: STOP/);
  r = await th(['status', 'listening'], e);
  assert.doesNotMatch(r.stderr, /STOP/, 'the reply cleared the Stop');
  assert.equal((await th(['status', 'dancing'], e)).code, 8);
}));

test('amend, history, title', withFake({}, async fake => {
  const e = env(fake);
  const posted = await th(['say', 'today', '--kind', 'card', '--meta', '{"state":"checks"}', 'PR: fix search'], e);
  const a = await th(['amend', posted.json.id, '--meta', '{"state":"passed"}'], e);
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(fake.state.messages.at(-1).meta, {state: 'passed'});
  const h = await th(['history', fake.today.id, '--limit', '5'], e);
  assert.equal(h.code, 0);
  assert.equal(h.json.items.length, 1);
  assert.equal((await th(['history', 'today'], e)).json.items.length, 1);
  assert.equal((await th(['history', 'no-such-thread'], e)).code, 8);
  assert.equal((await th(['title', fake.today.id, 'Search', 'fix'], e)).code, 0);
  assert.equal(fake.today.title, 'Search fix');
  fake.today.title_source = 'owner';
  assert.equal((await th(['title', fake.today.id, 'Other'], e)).code, 7);
}));

test('note --session enforces 120 words and records note_at', withFake({}, async fake => {
  const e = env(fake);
  const r = await th(['note', '--session', 'Fixed the player bug; tests pass.', '--open', '["Deploy after CI"]'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.state.notes[0].open_items[0].text, 'Deploy after CI');
  assert.ok(JSON.parse(readFileSync(join(e.TMPDIR, 'th/state/note_at.json'), 'utf8')) > 0);
  assert.equal((await th(['note', '--session', Array(121).fill('word').join(' ')], e)).code, 8);
}));

test('remember, recall, confirm, supersede, forget', withFake({}, async fake => {
  const e = env(fake);
  const said = fake.addOwnerMessage('I prefer short answers on the phone');
  const rem = await th(['remember', '--kind', 'preference', '--text', 'Prefers short answers on the phone', '--evidence', said.id], e);
  assert.equal(rem.code, 0, rem.stderr);
  assert.ok(rem.json.fact_id && rem.json.ledger_id);
  assert.equal(fake.state.facts[0].evidence[0], `msg:${said.id}`);
  const rec = await th(['recall', 'short answers', '--kind', 'facts'], e);
  assert.equal(rec.json.items[0].ref, `fact:${rem.json.fact_id}`);
  assert.deepEqual(Object.keys(rec.json.items[0]).sort(), ['at', 'ref', 'score', 'snippet', 'source']);
  assert.equal(rec.json.items[0].source, 'facts');
  assert.equal((await th(['search', 'short answers', '--sources', 'nope'], e)).code, 8);
  assert.equal((await th(['confirm', rem.json.fact_id, '--evidence', said.id], e)).code, 0);
  const sup = await th(['supersede', rem.json.fact_id, '--text', 'Prefers very short answers', '--evidence', said.id], e);
  assert.equal(sup.code, 0, sup.stderr);
  assert.equal(fake.state.facts.find(f => f.id === sup.json.fact_id).kind, 'preference');
  const fg = await th(['forget', sup.json.fact_id, '--why', 'The owner asked to forget it'], e);
  assert.equal(fg.code, 0);
  assert.equal(fake.state.proposals.get(fg.json.proposal_id).value.spec.op, 'memory.forget');
  const mindMsg = fake.state.messages.find(m => m.author !== 'owner') ?? (await th(['say', 'today', 'ok'], e), fake.state.messages.at(-1));
  const bad = await th(['remember', '--kind', 'rule', '--text', 'Always do X', '--evidence', mindMsg.id], e);
  assert.equal(bad.code, 8);
  assert.equal((await th(['remember', '--kind', 'mood', '--text', 'x', '--evidence', said.id], e)).code, 8);
  assert.equal((await th(['taint', '--source', 'WebFetch', '--ref', 'https://example.com/page'], e)).code, 0);
  assert.equal(fake.state.requests.at(-1).path, '/v1/mind/taint');
  const tainted = await th(['remember', '--kind', 'fact', '--text', 'Something', '--evidence', said.id], e);
  assert.equal(tainted.code, 6);
  assert.equal(errCode(tainted), 'session_tainted');
}));

test('thread add, list, done, drop', withFake({}, async fake => {
  const e = env(fake);
  const said = fake.addOwnerMessage('remind me to restring the guitar');
  const add = await th(['thread', 'add', 'Restring', 'the', 'guitar', '--owner', 'owner', '--evidence', said.id], e);
  assert.equal(add.code, 0, add.stderr);
  assert.equal((await th(['thread', 'list'], e)).json.items.length, 1);
  assert.equal((await th(['thread', 'done', add.json.id], e)).code, 0);
  assert.equal(fake.state.openThreads.get(add.json.id).status, 'done');
  const two = await th(['thread', 'add', 'Look into playlists', '--evidence', said.id], e);
  assert.equal((await th(['thread', 'drop', two.json.id], e)).code, 8, '--why is required');
  assert.equal((await th(['thread', 'drop', two.json.id, '--why', 'No longer needed'], e)).code, 0);
  assert.equal((await th(['thread', 'list'], e)).json.items.length, 0);
}));

test('propose, decide --by-message (owner words verified), decision budget exit 7', withFake({}, async fake => {
  const e = env(fake);
  const args = ['propose', '--class', 'delete', '--question', 'Forget this fact for good?', '--why', 'You said it was wrong.',
    '--spec', '{"op":"memory.forget","args":{"id":"01890a5d-ac96-774b-bcce-b302099a8057"}}', '--if-ignored', 'Nothing happens.', '--odds', '0.9', '--options', 'Forget it|Keep it'];
  const p = await th(args, e);
  assert.equal(p.code, 0, p.stderr);
  assert.match(p.json.spec_hash, /^[0-9a-f]{64}$/);
  const early = fake.addOwnerMessage('hmm');
  fake.state.messages.at(-1).seq = 0; // sent before the card
  assert.equal((await th(['decide', p.json.proposal_id, '--by-message', early.id], e)).code, 6);
  const yes = fake.addOwnerMessage('yes, delete them');
  const wrong = await th(['decide', p.json.proposal_id, '--by-message', yes.id, '--spec-hash', 'f'.repeat(64)], e);
  assert.equal(wrong.code, 7, 'spec_hash is sent and checked');
  assert.equal(errCode(wrong), 'spec_mismatch');
  const d = await th(['decide', p.json.proposal_id, '--by-message', yes.id], e); // spec_hash read from the waiting proposal
  assert.equal(d.code, 0, d.stderr);
  assert.equal(d.json.status, 'approved');
  assert.ok(d.json.ledger_id);
  const decided = fake.state.proposals.get(p.json.proposal_id).value;
  assert.deepEqual([decided.decided_via, decided.decided_message_id], ['words', yes.id]);
  assert.equal((await th(['decide', p.json.proposal_id, '--by-message', yes.id, '--spec-hash', p.json.spec_hash], e)).code, 7, 'already decided');
  assert.equal((await th(['decide', p.json.proposal_id, '--by-message', yes.id], e)).code, 8, 'no longer waiting');
  for (let i = 0; i < 3; i++) assert.equal((await th(args, e)).code, 0);
  const over = await th(args, e);
  assert.equal(over.code, 7);
  assert.equal(errCode(over), 'decision_budget');
  assert.equal((await th(['propose', '--class', 'fun', '--question', 'q', '--why', 'w', '--spec', '{"op":"verb"}', '--if-ignored', 'x'], e)).code, 8);
  // Checked against the contract's executor map before the network: an unknown op, a wrong class,
  // bad args, and an op the role may not raise.
  const before = fake.state.requests.length;
  const card = spec => ['propose', '--class', 'delete', '--question', 'q', '--why', 'w', '--spec', spec, '--if-ignored', 'x'];
  assert.equal((await th(card('{"op":"sql.run","args":{}}'), e)).code, 8);
  assert.equal((await th(['propose', '--class', 'money', ...card('{"op":"memory.forget","args":{"id":"01890a5d-ac96-774b-bcce-b302099a8057"}}').slice(3)], e)).code, 8);
  assert.equal((await th(card('{"op":"memory.forget","args":{"id":"nope"}}'), e)).code, 8);
  assert.equal((await th(card('{"op":"memory.forget","args":{"id":"01890a5d-ac96-774b-bcce-b302099a8057"}}'), {...e, TH_ROLE: 'night'})).code, 8);
  assert.equal(fake.state.requests.length, before);
}));

test('verb (checked against the contract), undo, ledger', withFake({}, async fake => {
  const e = env(fake);
  const why = ['--why', 'the owner asked for night mode'];
  const v = await th(['verb', 'shell.appearance', '{"mode":"night"}', ...why], e);
  assert.equal(v.code, 0, v.stderr);
  assert.ok(v.json.verb_id && v.json.ledger_id);
  const u = await th(['undo', v.json.ledger_id], e);
  assert.equal(u.code, 0);
  assert.equal(u.json.status, 'undone');
  assert.equal((await th(['undo', v.json.ledger_id], e)).code, 7);
  const l = await th(['ledger', '--kind', 'verb'], e);
  assert.equal(l.json.items.length, 1);
  assert.equal(fake.state.requests.at(-1).query.kind, 'verb');
  // Refused before the network: unknown verb, owner-tap-only verb, bad args, missing why.
  const before = fake.state.requests.length;
  for (const args of [['verb', 'NotAVerb'], ['verb', 'music.queue_add', '{}', ...why], ['verb', 'app.open', '{"app":"music","path":"/music/"}', ...why],
    ['verb', 'shell.appearance', '{"mode":"purple"}', ...why], ['verb', 'shell.appearance', '{"mode":"day"}']]) {
    const r = await th(args, e);
    assert.equal(r.code, 8, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.equal(fake.state.requests.length, before);
}));

test('order new, list, get, cancel; a personal order needs an approved reach_people proposal', withFake({}, async fake => {
  const e = env(fake);
  const n = await th(['order', 'new', '--kind', 'board.story', '--title', 'Weather story', '--spec', '{"topic":"weather"}', '--schema', '{"type":"object"}', '--deadline', '2026-10-29T06:00:00Z'], e);
  assert.equal(n.code, 0, n.stderr);
  const stored = fake.state.orders.get(n.json.id).value;
  assert.deepEqual([stored.deadline_at, stored.personal, stored.title], [Date.parse('2026-10-29T06:00:00Z'), false, 'Weather story']);
  assert.equal((await th(['order', 'list'], e)).json.items.length, 1);
  assert.equal((await th(['order', 'get', n.json.id], e)).json.kind, 'board.story');
  assert.equal((await th(['order', 'cancel', n.json.id], e)).code, 8, '--why is required');
  assert.equal((await th(['order', 'cancel', n.json.id, '--why', 'No longer needed today'], e)).json.status, 'cancelled');
  assert.equal((await th(['order', 'get', 'nope'], e)).code, 8);
  const personal = await th(['order', 'new', '--kind', 'reply.draft', '--personal', '--spec', '{}', '--schema', '{}', '--deadline', '2026-10-29T06:00:00Z'], e);
  assert.equal(personal.code, 6);
  assert.equal(errCode(personal), 'needs_approval');
}));

test('surface, push (quiet hours exit 7), pending, health, errors', withFake({}, async fake => {
  const e = env(fake);
  const s = await th(['surface', 'home', 'line.1', '--kind', 'line', '--payload', '{"text":"Rain at 3"}', '--why', 'Owner walks at 3 pm', '--topic', 'weather-walk'], e);
  assert.equal(s.code, 0, s.stderr);
  assert.ok(s.json.ledger_id);
  const pu = await th(['push', '--title', 'Rain soon', '--body', 'Rain at 3', '--ref', 'app:music', '--why', 'Owner walks at 3 pm', '--topic', 'weather'], e);
  assert.equal(pu.code, 0, pu.stderr);
  fake.options.quietHours = true;
  assert.equal((await th(['push', '--title', 't', '--body', 'b', '--ref', 'app:music', '--why', 'because why', '--topic', 'x'], e)).code, 7);
  fake.addOwnerMessage('are you there?');
  const p = await th(['pending'], e);
  assert.equal(p.json.unanswered.length, 1);
  assert.equal((await th(['health'], e)).json.ok, true);
  assert.equal((await th(['health', '--deep'], e)).json.ok, true);
  assert.deepEqual((await th(['errors', '--hours', '1'], e)).json, {items: []});
}));

test('night role: day, daynote, facts, night progress', withFake({}, async fake => {
  const e = env(fake, {TH_ROLE: 'night'});
  const said = fake.addOwnerMessage('I like slow jazz in the evening');
  assert.equal((await th(['brief', '--claim'], e)).code, 0);
  const d = await th(['day', '2026-10-28'], e);
  assert.equal(d.code, 0, d.stderr);
  assert.equal(d.json.stats.owner, 1);
  assert.deepEqual(d.json.messages, [{id: said.id, author: 'owner', kind: 'text', body: said.body, reply_to: null, at: said.created_at}],
    'each message as the night reads it: what it says and its id for evidence');
  assert.deepEqual(d.json.next, {messages: null, ledger: null, notes: null});
  assert.equal((await th(['daynote', '2026-10-28', '--summary', 'A quiet day.', '--decisions', '[]', '--importance', '3'], e)).json.version, 1);
  fake.state.dayNotes.set('2026-10-27', {summary: 'The owner wrote this.', decisions: [], importance: 4, version: 2, written_by: 'owner'});
  assert.deepEqual((await th(['daynote', '2026-10-27', '--summary', 'Night words.', '--decisions', '[]', '--importance', '3'], e)).json,
    {version: 2, kept_owner_edit: true}, "the owner's edit stands, and th says so");
  const batch = join(e.TMPDIR, 'batch.json');
  writeFileSync(batch, JSON.stringify({ops: [{op: 'add', kind: 'preference', subject: 'music', text: 'Likes slow jazz in the evening', source: 'user', evidence: [`msg:${said.id}`], sensitivity: 0}]}));
  assert.deepEqual((await th(['facts', '--batch', batch], e)).json, {applied: 1, proposed: 0, rejected: []});
  writeFileSync(batch, JSON.stringify([{op: 'add', kind: 'routine', subject: 'music', text: 'Plays guitar after dinner', source: 'observed', evidence: [`msg:${said.id}`], sensitivity: 0},
    {op: 'add', kind: 'fact', subject: 'x', text: 'Unsupported', source: 'user', evidence: ['msg:does-not-exist'], sensitivity: 0}]));
  assert.deepEqual((await th(['facts', '--batch', batch], e)).json, {applied: 1, proposed: 0, rejected: [{i: 1, reason: 'bad_evidence'}]}, 'valid ops apply, bad ones are listed');
  assert.deepEqual((await th(['night', 'start'], e)).json, {resume_from: 1, done: false, cursor: null, skipped: []});
  const ahead = await th(['night', 'step', '3', 'done'], e);
  assert.equal(ahead.code, 7, 'a step ahead of the run is a conflict');
  assert.equal(JSON.parse(ahead.stderr).error.details.resume_from, 1, 'and says where the run is');
  for (const n of ['1', '2', '3']) assert.equal((await th(['night', 'step', n, 'done'], e)).code, 0);
  assert.deepEqual((await th(['night', 'step', '4', 'cursor', 'msg:abc'], e)).json, {resume_from: 4, done: false, cursor: 'msg:abc', skipped: []});
  assert.equal((await th(['night', 'step', '2', 'cursor', 'x'], e)).code, 8, 'step 2 keeps no cursor, checked before the call');
  assert.equal((await th(['night', 'step', '12', 'done'], e)).code, 8, 'no step 12');
  assert.equal((await th(['night', 'done'], e)).code, 7, 'steps are left');
  assert.deepEqual((await th(['night', 'done', '--partial'], e)).json, {resume_from: 11, done: true, cursor: null, skipped: [4, 5, 6, 7, 8, 9]});
  assert.equal((await th(['day', '2026-10-28'], env(fake))).code, 6, 'chat may not read night input');
}));

test('night steps come from the contract; the day comes from the briefing or --day', withFake({}, async fake => {
  const e = env(fake, {TH_ROLE: 'night'});
  const r = await th(['night', 'steps'], e);
  assert.deepEqual(r.json.steps.map(s => s.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(r.json.steps.filter(s => s.cursor).map(s => s.step), [4]);
  assert.deepEqual(r.json.budget_min, {target: 30, hard: 45, sunday_hard: 60});
  assert.equal(fake.state.requests.length, 0, 'listing the steps asks the Worker nothing');
  assert.equal((await th(['night', 'start'], e)).code, 8, 'no briefing day recorded and no --day');
  assert.deepEqual((await th(['night', 'start', '--day', '2026-10-25'], e)).json.resume_from, 1);
  assert.ok(fake.state.night.has('2026-10-25'));
  for (const bad of [['night', 'step', 'x', 'done'], ['night', 'step', '4', 'cursor'], ['night', 'later']])
    assert.equal((await th(bad, e)).code, 8, bad.join(' '));
}));

test('facts --night: a part of the night run\'s day is one batch; the same file again is `already`, other ops an error', withFake({}, async fake => {
  const e = env(fake, {TH_ROLE: 'night'});
  const said = fake.addOwnerMessage('I take the bus to work');
  assert.equal((await th(['brief', '--claim'], e)).code, 0);
  const batch = join(e.TMPDIR, 'night.json');
  const op = text => ({op: 'add', kind: 'routine', subject: 'commute', text, source: 'user', evidence: [`msg:${said.id}`], sensitivity: 0});
  writeFileSync(batch, JSON.stringify({ops: [op('Takes the bus to work')]}));
  assert.equal((await th(['facts', '--batch', batch, '--night'], e)).code, 8, 'no night run started yet');
  assert.equal((await th(['night', 'start'], e)).code, 0);
  assert.deepEqual((await th(['facts', '--batch', batch, '--night'], e)).json, {applied: 1, proposed: 0, rejected: []});
  assert.deepEqual((await th(['facts', '--batch', batch, '--night'], e)).json, {applied: 1, proposed: 0, rejected: [], already: true},
    'the same file is the same batch: the Worker answers what it applied the first time');
  writeFileSync(batch, JSON.stringify({ops: [op('Goes to work by bus')]}));
  const again = await th(['facts', '--batch', batch, '--night'], e);
  assert.equal(again.code, 7, 'a second file without --part is part 1 again, with other ops');
  assert.match(JSON.parse(again.stderr).error.message, /part 1 of the night of 2026-10-28 .* as --part 2/);
  assert.deepEqual((await th(['facts', '--batch', batch, '--night', '--part', '2'], e)).json, {applied: 1, proposed: 0, rejected: []});
  // A backfill night: its own day, so its own batch ids.
  assert.equal((await th(['night', 'start', '--day', '2026-10-25'], e)).code, 0);
  assert.equal((await th(['night', 'step', '1', 'done'], e)).json.resume_from, 2, 'the steps go to the run started');
  assert.equal(fake.state.night.get('2026-10-25').resume, 2);
  assert.deepEqual((await th(['facts', '--batch', batch, '--night'], e)).json, {applied: 1, proposed: 0, rejected: []});
  assert.deepEqual([...fake.state.batches.keys()],
    [nightBatchId('2026-10-28', 1), nightBatchId('2026-10-28', 2), nightBatchId('2026-10-25', 1)]);
  for (const bad of [['--part', '2'], ['--day', '2026-10-25'], ['--night', '--part', '0']])
    assert.equal((await th(['facts', '--batch', batch, ...bad], e)).code, 8, bad.join(' '));
}));

test('th day reads every page of a part up to its cap; --part reads one page after --cursor', withFake({}, async fake => {
  const e = env(fake, {TH_ROLE: 'night'});
  for (let i = 0; i < 25; i++) fake.addOwnerMessage(`message ${i}`);
  fake.state.dayPage = 2;
  const all = await th(['day', '2026-10-28'], e);
  assert.equal(all.json.messages.length, 2 * DAY_PAGES, 'the cap: ten pages');
  assert.equal(all.json.next.messages, 'c20', 'and where to go on');
  const rest = await th(['day', '2026-10-28', '--part', 'messages', '--cursor', 'c20'], e);
  assert.deepEqual(rest.json.items.map(m => m.body), ['message 20', 'message 21']);
  assert.equal(rest.json.next, 'c22');
  assert.equal((await th(['day', '2026-10-28', '--part', 'everything'], e)).code, 8);
}));

test('exit codes: 1 bad JSON, 2 bad token, 8 unknown command, 9 unreachable, 10 budget', withFake({}, async fake => {
  fake.failNext('GET', '/v1/mind/pending', 200, 'garbage');
  assert.equal((await th(['pending'], env(fake))).code, 1);
  const bad = await th(['pending'], env(fake, {TH_TOKEN: 'thm_wrong_key_two'}));
  assert.equal(bad.code, 2);
  assert.equal((await th(['frobnicate'], env(fake))).code, 8);
  const down = await th(['pending'], env(null));
  assert.equal(down.code, 9);
  assert.equal(errCode(down), 'unreachable');
  fake.failNext('GET', '/v1/mind/pending', 503, 'budget_exhausted');
  assert.equal((await th(['pending'], env(fake))).code, 10);
  fake.failNext('GET', '/v1/mind/pending', 429, 'rate_limited');
  assert.equal((await th(['pending'], env(fake))).code, 10);
  fake.failNext('GET', '/v1/mind/pending', 503, 'unavailable', 2);
  assert.equal((await th(['pending'], env(fake))).code, 0, 'two 503s then success: retried');
  fake.failNext('GET', '/v1/mind/pending', 502, 'upstream', 4);
  const gaveUp = await th(['pending'], env(fake));
  assert.equal(gaveUp.code, 9, '5xx after 3 retries');
  assert.equal(fake.state.requests.filter(r => r.path === '/v1/mind/pending').length, 1 + 1 + 1 + 1 + 3 + 4);
}));

test('approved: an executed repo.change card for these paths and this base (exit 0), anything else exit 6', withFake({}, async fake => {
  const e = env(fake);
  const base = 'a'.repeat(40);
  const put = (paths, status) => {
    const id = `01890a5d-ac96-774b-bcce-${String(fake.state.proposals.size + 1).padStart(12, '0')}`;
    fake.state.proposals.set(id, {value: {id, status, spec: {v: 1, op: 'repo.change', args: {paths, base}}}});
  };
  put(['.github/workflows/ci.yml', 'mind/hooks/stop.mjs'], 'executed');
  put(['.claude/settings.json'], 'waiting');
  const ask = (paths, sha = base) => th(['approved', '--paths', paths, '--sha', sha], e);
  const yes = await ask('.github/workflows/ci.yml,mind/hooks/stop.mjs');
  assert.equal(yes.code, 0, yes.stderr);
  assert.equal(yes.json.approved, true);
  assert.equal((await ask('.github/workflows/ci.yml')).code, 0);
  assert.equal((await ask('.claude/settings.json')).code, 6, 'a waiting card approves nothing');
  assert.equal((await ask('.github/workflows/ci.yml,.github/workflows/deploy.yml')).code, 6, 'every path must be covered');
  assert.equal((await ask('.github/workflows/ci.yml', 'b'.repeat(40))).code, 6, 'another base');
  assert.equal((await ask('.github/workflows/ci.yml', 'HEAD')).code, 8);
}));
