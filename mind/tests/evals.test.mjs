// The memory-probe harness on the synthetic seed with a stub model (EVALS.md §3.3 acceptance):
// fixed answers produce the expected score, folding ignores case and accents, abstentions and
// forbidden keys are scored as written, and only numbers come out.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './helpers.mjs';
import {correct, fold, score} from '../evals/probes/score.mjs';

const json = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const {probes} = json('mind/evals/probes/memory.json');
const {phrases} = json('mind/evals/abstain.json');

test('the stub model scores 4 of 5 on the synthetic probes', () => {
  const stub = {
    'MP-S01': 'You said 100 BPM for the second piece.',
    'MP-S02': 'A classical guitar.',
    'MP-S03': 'Mornings now; you moved it from the evening.', // names the old value: wrong
    'MP-S04': "I don't know. Want me to remember it when you tell me?",
    'MP-S05': "You haven't told me.",
  };
  assert.deepEqual(score(probes, stub, phrases), {
    suite: 'MP', n: 5, correct: 4,
    by_cat: {A: {n: 2, correct: 2}, D: {n: 1, correct: 0}, E: {n: 2, correct: 2}},
  });
});

test('folding, abstention, hedges and missing answers', () => {
  assert.equal(fold('Café  ÉCLAIR'), 'cafe eclair');
  const e = {cat: 'E', expected_keys: [], forbidden_keys: ['herb']};
  assert.equal(correct(e, 'I do not know.', phrases), true);
  assert.equal(correct(e, 'Herbs, I think.', phrases), false);
  assert.equal(correct(e, 'Basil.', phrases), false, 'an invented value is not an abstention');
  const f = {cat: 'F', expected_keys: ['daily'], forbidden_keys: []};
  assert.equal(correct(f, 'You practise daily.', phrases), false);
  assert.equal(correct(f, 'Last I knew (2026-11-03) you practised daily.', phrases), true);
  assert.equal(score(probes, {}, phrases).correct, 0);
});

test('the seed only holds synthetic, neutral lines', () => {
  const lines = readFileSync(join(ROOT, 'mind/evals/seed.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.every(l => ['say', 'add', 'supersede', 'forget'].includes(l.t)));
  for (const p of probes) assert.match(p.id, /^MP-S\d\d$/);
});
