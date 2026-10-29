// Small pure pieces of th: argument parsing, UUIDv7, the HTTP → exit code map, evidence refs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs} from '../cli/lib/args.mjs';
import {uuidv7} from '../cli/lib/ids.mjs';
import {EXIT, exitFor} from '../cli/lib/io.mjs';
import {evidenceRefs} from '../cli/lib/memory.mjs';

test('parseArgs: values, =, booleans, repeats, -, and --', () => {
  const {flags, rest} = parseArgs(['today', '--kind', 'card', '--meta={"a":1}', '--claim', '--attach', 'a.png', '--attach', 'b.png', '-', '--', '--not-a-flag'],
    {bool: ['claim'], repeat: ['attach']});
  assert.deepEqual(flags, {kind: 'card', meta: '{"a":1}', claim: true, attach: ['a.png', 'b.png']});
  assert.deepEqual(rest, ['today', '-', '--not-a-flag']);
  assert.deepEqual(parseArgs(['--deep']).flags, {deep: true});
});

test('uuidv7: version 7, variant 10, time-ordered', () => {
  const a = uuidv7(1_700_000_000_000), b = uuidv7(1_700_000_000_001);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b);
  assert.equal(a.slice(0, 13).replace('-', ''), (1_700_000_000_000).toString(16).padStart(12, '0'));
});

test('exit codes follow RUNTIME.md §5.2', () => {
  assert.equal(exitFor(401, 'unauthorized'), EXIT.unauthorized);
  assert.equal(exitFor(403, 'session_tainted'), EXIT.forbidden);
  assert.equal(exitFor(409, 'already_live'), EXIT.already_live);
  for (const code of ['push_budget', 'decision_budget', 'nudge_repeat', 'quiet', 'quiet_hours', 'conflict']) assert.equal(exitFor(409, code), EXIT.conflict);
  assert.equal(exitFor(422, 'validation'), EXIT.validation);
  assert.equal(exitFor(400, 'bad_request'), EXIT.validation);
  assert.equal(exitFor(429, 'rate_limited'), EXIT.budget);
  assert.equal(exitFor(503, 'budget_exhausted'), EXIT.budget);
  assert.equal(exitFor(503, 'unavailable'), EXIT.unreachable);
  assert.deepEqual(Object.values(EXIT), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('evidence: bare ids are messages, prefixed refs are kept, 1–20 required', () => {
  assert.deepEqual(evidenceRefs('a1, day:2026-10-28,event:e9'), ['msg:a1', 'day:2026-10-28', 'event:e9']);
  assert.throws(() => evidenceRefs(undefined), /at least one/);
  assert.throws(() => evidenceRefs(Array.from({length: 21}, (_, i) => `m${i}`).join(',')), /at most 20/);
});
