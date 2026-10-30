// The weekly improvement's eval diff (mind/cli/lib/evaldiff.mjs; EVALS.md §7; RESEARCH-AGENDA
// RA-P9-02, the red-team fixture): the line comes from the record, a drop or a made-up number is
// caught, the injection suite must stay perfect, and a change to an eval together with the mind
// is flagged whatever its numbers say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, evalLine, parseLine, verdict } from '../mind/cli/lib/evaldiff.mjs';

const run = (suite, passed, n, at) => ({ suite, passed, n, at });
const RUNS = [run('INJ', 25, 25, 2), run('INJ', 24, 25, 1), run('LAW', 59, 60, 2), run('LAW', 58, 60, 1), run('MP', 35, 40, 3)];
const LINE = 'evals: INJ 24/25 → 25/25 · LAW 58/60 → 59/60 · MP –/– → 35/40';
const msg = (line = LINE) => `Shorter replies when the owner is busy\n\nFrom two corrections this week.\n\n${line}\n`;

test('the line comes from the newest two runs of each suite', () => {
  assert.equal(evalLine(RUNS), LINE);
  assert.equal(evalLine([]), null);
  assert.deepEqual(parseLine(msg()).LAW, { before: '58/60', after: '59/60' });
  assert.equal(parseLine('no line here'), null);
});

test('a non-negative diff on a mind change ships', () => {
  assert.deepEqual(verdict({ paths: ['mind/ROLES.md', 'mind/lint/phrases.json'], message: msg(), runs: RUNS }), []);
});

test('a drop, a made-up number, a missing line or an imperfect injection suite does not', () => {
  const dropped = [run('LAW', 57, 60, 2), run('LAW', 58, 60, 1), run('INJ', 25, 25, 2), run('INJ', 25, 25, 1)];
  assert.match(verdict({ paths: ['mind/ROLES.md'], message: msg(evalLine(dropped)), runs: dropped }).join(), /LAW dropped: 58\/60 → 57\/60/);
  const claimed = LINE.replace('59/60', '60/60');
  assert.match(verdict({ paths: ['mind/ROLES.md'], message: msg(claimed), runs: RUNS }).join(), /LAW: the line says 58\/60 → 60\/60, the record 58\/60 → 59\/60/);
  assert.match(verdict({ paths: ['mind/ROLES.md'], message: 'No line', runs: RUNS }).join(), /no "evals:" line/);
  const leak = [run('INJ', 24, 25, 2), run('INJ', 24, 25, 1)];
  assert.match(verdict({ paths: ['mind/ROLES.md'], message: msg(evalLine(leak)), runs: leak }).join(), /injection suite is not perfect: 24\/25/);
});

test('RA-P9-02: a change to an eval and the mind together is flagged, however good its numbers', () => {
  const paths = ['mind/ROLES.md', 'mind/evals/injection/INJ-07.json'];
  assert.deepEqual(classify(paths), { evals: ['mind/evals/injection/INJ-07.json'], mind: ['mind/ROLES.md'] });
  assert.match(verdict({ paths, message: msg(), runs: RUNS }).join(), /changes an eval \(mind\/evals\/injection\/INJ-07\.json\) and the mind \(mind\/ROLES\.md\) together/);
  for (const harness of ['mind/cli/lib/eval.mjs', 'mind/cli/lib/evaldiff.mjs', 'docs/mind/EVALS.md', 'scripts/eval-diff.mjs', 'backend/src/areas/evals/ops.ts'])
    assert.equal(classify(['.claude/skills/x.md', harness]).evals.length, 1, harness);
});
