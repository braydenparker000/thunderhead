// Replies that show their work and the island line, from the mind's side: `th help` names
// island.show with its rule (one sentence, never a question) and island.clear as its undo only;
// `th status --using` takes a file, a day and a search; `th verb island.show` checks its length
// before it leaves.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, startFake, th} from './helpers.mjs';

const withFake = (fn) => async () => {
  const fake = await startFake({});
  try { await fn(fake); } finally { await fake.stop(); }
};

test('th help names island.show with its rule, and island.clear as an undo only', withFake(async fake => {
  const help = (await th(['help'], env(fake))).stdout;
  const show = help.split('\n').find(l => l.startsWith('  island.show v1'));
  assert.ok(show, 'island.show is listed');
  assert.match(show, /\{text\} \[phone · tiles · undo reported\]/);
  assert.match(show, /never a question/);
  assert.match(show, /at most 80 characters/);
  assert.match(help, /^ {2}island\.clear v1 \{line\} .*\(not yours to queue: an owner tap or an undo\)/m);
  assert.match(help, /tiles \(default [a-z]+\): .*island\.show/);
  assert.match((await th(['help', 'status'], env(fake))).stdout, /How I got this/);
}));

test('status --using takes a file by its id, a day by its date and a search with no id', withFake(async fake => {
  const e = env(fake);
  const r = await th(['status', 'working', '--title', 'Reading last week',
    '--using', 'file:0192f0c4-0000-7000-8000-0000000000f1:The packing list', '--using', 'day:2026-11-02:Monday',
    '--using', 'search:Songs for a slow evening'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fake.state.statuses.at(-1).using, [
    {kind: 'file', id: '0192f0c4-0000-7000-8000-0000000000f1', label: 'The packing list'},
    {kind: 'day', id: '2026-11-02', label: 'Monday'},
    {kind: 'search', label: 'Songs for a slow evening'},
  ]);
  for (const bad of ['day:monday:Monday', 'file:packing.txt:The list', 'search:evening:Evening songs']) {
    const out = await th(['status', 'working', '--using', bad], e);
    assert.equal(out.code, 8, bad);
    assert.match(out.stderr, new RegExp(`--using ${bad.split(':')[0]}:`));
  }
}));

test('th verb island.show refuses a line over 80 characters before it leaves', withFake(async fake => {
  const e = env(fake);
  const sent = () => fake.state.requests.filter(r => r.path.startsWith('/v1/verbs/')).length;
  const before = sent();
  const long = await th(['verb', 'island.show', JSON.stringify({text: 'x'.repeat(81)}), '--why', 'a word about what plays'], e);
  assert.equal(long.code, 8);
  assert.equal(sent(), before, 'nothing reached the Worker');
}));
