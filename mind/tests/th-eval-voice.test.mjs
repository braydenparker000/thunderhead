// th eval voice (EVALS.md §4.1, mind/skills/voice.md): thirty invented prompts, each with its
// briefing lines and a right and a wrong reply in our own words; the grader passes every right one
// and fails every wrong one without a model; `th eval voice` prints the task with the skill and
// every prompt; `check` grades a file of replies, records the TONE run in the owner's Core and
// prints what changed since the last run, ids and reasons only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {grade, sentences, voiceDiff, voiceFixtures} from '../cli/lib/eval-voice.mjs';
import {lintReply} from '../cli/lib/lint.mjs';
import {env, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const GRADED = ['knows', 'lacks', 'admit', 'rule', 'quiet', 'depth'];

test('thirty fixtures, each with its briefing lines; every right reply passes and every wrong one fails', () => {
  const all = voiceFixtures();
  assert.deepEqual(all.map(f => f.id), Array.from({length: 30}, (_, i) => `VOI-${String(i + 1).padStart(2, '0')}`));
  for (const f of all) {
    assert.ok(f.prompt && f.brief.length && f.brief.every(l => typeof l === 'string' && l.length <= 200), f.id);
    assert.ok(GRADED.some(k => f[k] !== undefined), `${f.id}: graded on something`);
    assert.deepEqual(grade(f, f.good), [], `${f.id}: ${f.good}`);
    assert.equal(lintReply(f.good), null, f.id);
    assert.ok(grade(f, f.bad).length, `${f.id}: the wrong reply should fail: ${f.bad}`);
    assert.doesNotMatch(JSON.stringify(f), /claude|opus|sonnet|haiku|fable/i, f.id);
  }
  // Each grader has prompts that lean on it.
  for (const k of GRADED) assert.ok(all.filter(f => f[k]).length >= 2, k);
});

test('the graders: shape, knowing, honesty, the admission, a kept correction, register', () => {
  const f = {knows: ['dentist']};
  assert.deepEqual(sentences('Morning. The dentist at 9:30, then choir. Rain from four.'), ['Morning.', 'The dentist at 9:30, then choir.', 'Rain from four.']);
  assert.match(grade(f, 'One. Two. Three. The dentist.').join(), /4 sentences/);
  assert.match(grade(f, 'The dentist:\n- at 9:30').join(), /a list or a heading/);
  assert.match(grade(f, 'What do you want to know?').join(), /names none of dentist.*asks what the briefing holds/);
  assert.match(grade({lacks: true}, 'It should be open.').join(), /honesty/);
  assert.deepEqual(grade({lacks: true}, 'About four in five it is open.'), []);
  assert.deepEqual(grade({lacks: true}, "I don't know."), []);
  assert.match(grade({admit: true}, 'Weather is hard. I was wrong.').join(), /first sentence/);
  assert.match(grade({rule: true}, 'Noted.').join(), /kept/);
  assert.match(grade({quiet: true}, 'Nothing. Really. Truly.').join(), /at most 2/);
  assert.match(grade(f, 'The dentist, perhaps!').join(), /exclamation.*hedging/);
  assert.match(grade(f, 'The dentist. Want me to move it?').join(), /banned shape/);
  assert.deepEqual(grade(f, ''), ['no reply']);
});

test('th eval voice prints the task; check records the TONE run and what changed since the last one', withFake(async fake => {
  const e = env(fake, {TH_ROLE: 'night'});
  const task = await th(['eval', 'voice'], e);
  assert.equal(task.code, 0, task.stderr);
  assert.equal(task.json.n, 30);
  assert.match(task.json.task, /## What you must not do/);
  for (const f of voiceFixtures()) assert.ok(task.json.task.includes(`${f.id}\nBriefing: ${f.brief.join(' · ')}\nOwner: ${f.prompt}`), f.id);
  assert.match(task.json.next, /th eval voice check --file/);
  const answers = task.json.answers;
  mkdirSync(dirname(answers), {recursive: true});
  const send = async (wrong = []) => {
    writeFileSync(answers, JSON.stringify(voiceFixtures().map(f => ({id: f.id, reply: wrong.includes(f.id) ? f.bad : f.good}))));
    const r = await th(['eval', 'voice', 'check', '--file', answers], e);
    assert.equal(r.code, 0, r.stderr);
    return r.json;
  };
  const first = await send();
  assert.deepEqual([first.suite, first.n, first.passed, first.before, first.failures], ['TONE', 30, 30, null, []]);
  const run = [...fake.state.evalRuns.values()].at(-1);
  assert.deepEqual([run.suite, run.n, run.passed, run.failures], ['TONE', 30, 30, []]);
  assert.match(run.git_sha, /^[0-9a-f]{7,40}$/);
  const second = await send(['VOI-03', 'VOI-20']);
  assert.equal(second.passed, 28);
  assert.equal(second.before, '30/30');
  assert.deepEqual(second.failures.map(x => x.id), ['VOI-03', 'VOI-20']);
  assert.ok(second.failures.every(x => x.why.length));
  assert.deepEqual(second.diff, {newly_failing: ['VOI-03', 'VOI-20'], still_failing: [], newly_passing: []});
  assert.deepEqual(voiceDiff({failures: ['VOI-03']}, ['VOI-03', 'VOI-09']), {newly_failing: ['VOI-09'], still_failing: ['VOI-03'], newly_passing: []});
  writeFileSync(answers, '{"not": "an array"}');
  assert.equal((await th(['eval', 'voice', 'check', '--file', answers], e)).code, 8);
  assert.equal((await th(['eval', 'voice', 'nonsense'], e)).code, 8);
}));
