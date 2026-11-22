// The night in one pass against the fake Worker (2026-11-22): `th night start` hands over the whole
// job (the day in brief, errors and health in a line each, each due step's exact command, the rest
// with why not), writing commands close their own steps and the open ones before them, and
// `th night done` closes what is left. A quiet night takes at most 8 th commands; a busy one still
// closes every step; a stopped run resumes at its first open step.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, startFake, th} from './helpers.mjs';

const ORDER = [1, 2, 3, 4, 7, 13, 5, 12, 6, 8, 9, 11, 10];
const NOTE = 'A calm night here 🙂\n\nI set a study tile for the next chapter; nothing is waiting on you.';

/** Runs th and counts it; the briefing (the session start hook's) is not one of the night's commands. */
function counter(e) {
  const ran = [];
  const run = async (args, input) => {
    ran.push(args.join(' '));
    const r = await th(args, e, input);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    return r;
  };
  return {ran, run};
}

const closedAll = run => ORDER.every(n => run.closed.includes(n) || run.skipped.includes(n));

test('a quiet night: at most 8 th commands, no help or skill lookup, every due step closed', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    assert.equal((await th(['brief', '--claim'], e)).code, 0);
    const {ran, run} = counter(e);
    const start = (await run(['night', 'start'])).json;
    const day = fake.state.nightCalls[0].day;
    assert.equal(start.resume_from, 1);
    assert.deepEqual(start.todo.map(t => t.step), [2, 7, 12, 11, 10], 'not Saturday: no growth; the songs are offered after the report');
    for (const t of start.todo) assert.doesNotMatch(t.run, /th (help|skill)\b/, `step ${t.step} needs no lookup`);
    const why = Object.fromEntries(start.not_tonight.map(n => [n.step, n.why]));
    assert.deepEqual(why[3], 'no messages from the owner');
    assert.deepEqual(why[6], 'no book queued');
    assert.deepEqual(why[9], 'not Sunday');
    assert.match(why[13], /week/);
    assert.equal(start.errors, 'none open in 24 h');
    assert.equal(start.health, 'ok');
    assert.deepEqual(start.day_brief.owner_messages, []);
    await run(['daynote', day, '--summary', 'A quiet day.', '--importance', '2', '--voice', 'A day that kept to itself.']);
    await run(['surface', 'briefing', 'study', '--kind', 'tile', '--payload', '{"label":"Study","value":"Chapter 3"}', '--why', 'From the reading plan you agreed.', '--topic', 'study.today']);
    await run(['report', '--headline', 'A quiet night', '--note', '-'], NOTE);
    await run(['night', 'done']);
    assert.ok(ran.length <= 8, ran.join('\n'));
    const r = fake.state.night.get(day);
    assert.ok(r.done && closedAll(r), JSON.stringify(r));
    assert.equal(fake.state.nightCalls.filter(c => c.action === 'step_done').length, 0, 'no step bookkeeping');
    assert.deepEqual(fake.state.nightCalls.filter(c => c.action === 'through').map(c => c.step), [2, 4, 12]);
    assert.equal(fake.state.nightReports.get(day).sent.note, NOTE);
  } finally { await fake.stop(); }
});

test('a busy night: messages, a book and songs; every step still closes, in order', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    const said = fake.addOwnerMessage('I want to finish the invented novel this week');
    fake.state.books = [{id: 'b1', state: 'queued'}, {id: 'b2', state: 'ready'}];
    fake.state.openThreads.set('t1', {id: 't1', text: 'Fix the invented tile bug', status: 'open', tags: ['agreed']});
    assert.equal((await th(['brief', '--claim'], e)).code, 0);
    const {run} = counter(e);
    const start = (await run(['night', 'start'])).json;
    const day = fake.state.nightCalls[0].day;
    assert.deepEqual(start.todo.map(t => t.step), [2, 3, 4, 7, 5, 12, 6, 11, 10]);
    assert.match(start.todo.find(t => t.step === 5).run, /t1/);
    assert.match(start.todo.find(t => t.step === 6).run, /study-ingest/);
    assert.deepEqual(start.day_brief.owner_messages.map(m => m.id), [said.id]);
    await run(['daynote', day, '--summary', 'Talked about reading.', '--decision', 'Finish the novel this week', '--importance', '5']);
    await run(['thread', 'add', 'Check in on the novel', '--evidence', `msg:${said.id}`]);
    await run(['facts', '--batch', '-', '--night'], JSON.stringify({ops: [{op: 'add', kind: 'goal', subject: 'owner', text: 'Wants to finish a novel this week', source: 'user', evidence: [`msg:${said.id}`]}]}));
    assert.equal(fake.state.night.get(day).resume, 4, 'facts closed the loose ends, not itself');
    await run(['surface', 'briefing', 'study', '--kind', 'tile', '--payload', '{"label":"Study","value":"Novel"}', '--why', 'You said you want to finish it.', '--topic', 'study.today']);
    await run(['report', '--headline', 'Reading week ahead', '--note', 'Your novel goal is noted 📚'], undefined);
    assert.equal(fake.state.night.get(day).resume, 6, 'the report closed arranging and health with it');
    await run(['night', 'done']);
    const r = fake.state.night.get(day);
    assert.ok(r.done && closedAll(r), JSON.stringify(r));
    assert.deepEqual(r.closed, [1, 2, 3, 4, 7, 13, 5, 12, 6, 11, 10]);
  } finally { await fake.stop(); }
});

test('a stopped night resumes at its first open step; step done and cursors still work', async () => {
  const fake = await startFake();
  try {
    const first = env(fake, {TH_ROLE: 'night'});
    assert.equal((await th(['brief', '--claim'], first)).code, 0);
    await th(['night', 'start'], first);
    const day = fake.state.nightCalls[0].day;
    assert.equal((await th(['daynote', day, '--summary', 'A day.', '--importance', '3'], first)).code, 0);
    // The hard stop: a refired session, a fresh temp folder.
    const again = env(fake, {TH_ROLE: 'night', CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_test_session_2'});
    assert.equal((await th(['brief', '--claim'], again)).code, 0);
    const start = (await th(['night', 'start'], again)).json;
    assert.equal(start.resume_from, 3);
    assert.ok(start.todo.every(t => ORDER.indexOf(t.step) >= ORDER.indexOf(3)), JSON.stringify(start.todo));
    assert.equal((await th(['night', 'step', '3', 'done'], again)).json.resume_from, 4);
    assert.equal((await th(['night', 'step', '4', 'cursor', 'p1:msg-9'], again)).json.cursor, 'p1:msg-9');
    assert.equal((await th(['night', 'done', '--partial'], again)).json.done, true);
    // After done, a writing command closes nothing more.
    const calls = fake.state.nightCalls.length;
    assert.equal((await th(['daynote', day, '--summary', 'Again.', '--importance', '3'], again)).code, 0);
    assert.equal(fake.state.nightCalls.length, calls);
  } finally { await fake.stop(); }
});

test('th daynote in one call: summary, decisions in each form, the voice line and the thread title', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    fake.addOwnerMessage('Hello');
    assert.equal((await th(['brief', '--claim'], e)).code, 0);
    const day = '2026-10-28';
    const one = await th(['daynote', day, '--summary', 'A day.', '--decisions', '["Walk at six", {"text": "Read before bed"}, {"what": "Call the invented plumber"}]',
      '--importance', '4', '--voice', 'Quiet, with one good walk.', '--title', 'Walks and books'], e);
    assert.equal(one.code, 0, one.stderr);
    assert.deepEqual(fake.state.dayNotes.get(day).decisions, ['Walk at six', 'Read before bed', 'Call the invented plumber']);
    assert.equal(fake.state.dayNotes.get(day).voice, 'Quiet, with one good walk.');
    assert.equal(one.json.voice, 'Quiet, with one good walk.');
    assert.equal(one.json.title.set, true);
    assert.equal(fake.state.threads[0].title, 'Walks and books');
    assert.equal((await th(['daynote', day, '--summary', 'A day.', '--decision', 'One', '--decision', 'Two', '--importance', '4'], e)).code, 0);
    assert.deepEqual(fake.state.dayNotes.get(day).decisions, ['One', 'Two']);
    assert.equal((await th(['daynote', day, '--summary', 'A day.', '--decisions', 'Just one plain sentence', '--importance', '4'], e)).code, 0);
    assert.deepEqual(fake.state.dayNotes.get(day).decisions, ['Just one plain sentence']);
    assert.equal((await th(['daynote', day, '--summary', 'A day.', '--importance', '4'], e)).code, 0, 'decisions are optional');
    for (const bad of [['--decisions', '[1, [2]]'], ['--voice', 'x'.repeat(201)], ['--title', 'x'.repeat(81)], ['--importance', '0']])
      assert.equal((await th(['daynote', day, '--summary', 'A day.', '--importance', '4', ...bad], e)).code, 8, bad.join(' '));
    assert.match((await th(['help', 'daynote'], e)).stdout, /--voice.*--title/);
  } finally { await fake.stop(); }
});
