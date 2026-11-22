// th voice against the fake Worker: the page as text with who changed it last; `set` replaces the
// whole page from stdin with a why; local refusals (exit 8, one line naming the limit) before the
// network; the Worker's refusal after outside text comes back as one line too.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {voiceBody} from '../cli/lib/voice.mjs';
import {FAKE_DEFAULT} from './fake-voice.mjs';
import {env, errCode, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const puts = fake => fake.state.requests.filter(r => r.method === 'PUT' && r.path === '/v1/mind/voice');

test('voiceBody: the page trimmed at its end, 1 to 4,000 characters; a why of 8 to 200', () => {
  assert.deepEqual(voiceBody('Warm.\nQuick.\n\n', '  you asked for warmer  '), {text: 'Warm.\nQuick.', why: 'you asked for warmer'});
  assert.throws(() => voiceBody('  \n', 'a fine reason'), /1 to 4,000/);
  assert.throws(() => voiceBody('x'.repeat(4001), 'a fine reason'), /4001 characters \(at most 4,000\)/);
  assert.throws(() => voiceBody('Warm.', 'short'), /5 characters \(8 to 200\)/);
  assert.throws(() => voiceBody('Warm.', undefined), /0 characters \(8 to 200\)/);
});

test('th voice prints the page; th voice set replaces it from stdin', withFake(async fake => {
  const e = env(fake);
  const first = await th(['voice'], e);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, `${FAKE_DEFAULT}\n\n(the first page: nobody has changed it yet)\n`);
  const set = await th(['voice', 'set', '--why', 'you said my replies run long'], e, 'Warm and plain.\nShort replies; deep when asked.\n');
  assert.equal(set.code, 0, set.stderr);
  assert.deepEqual({by: set.json.by, chars: set.json.chars}, {by: 'mind', chars: 47});
  assert.deepEqual(puts(fake)[0].body, {text: 'Warm and plain.\nShort replies; deep when asked.', why: 'you said my replies run long'});
  const now = await th(['voice'], e);
  assert.match(now.stdout, /^Warm and plain\.\nShort replies; deep when asked\.\n\n\(changed by you, \d{4}-\d\d-\d\d \d\d:\d\d UTC: you said my replies run long\)\n$/);
}));

test('th voice set refuses before the network in one line, and passes the Worker\'s refusal as one line', withFake(async fake => {
  const e = env(fake);
  for (const [args, input, words] of [
    [['voice', 'set'], 'Warm.', '(8 to 200)'],
    [['voice', 'set', '--why', 'a fine reason'], '', '1 to 4,000'],
    [['voice', 'set', '--why', 'a fine reason'], 'x'.repeat(4001), 'at most 4,000'],
    [['voice', 'sing'], '', 'usage'],
  ]) {
    const r = await th(args, e, input);
    assert.equal(r.code, 8, args.join(' '));
    assert.equal(errCode(r), 'validation');
    assert.ok(r.stderr.includes(words), r.stderr);
    assert.equal(r.stderr.trim().split('\n').length, 1);
  }
  assert.equal(puts(fake).length, 0);
  fake.state.tainted.add('cse_test_session_1');
  const r = await th(['voice', 'set', '--why', 'a page said so'], e, 'Loud.');
  assert.equal(r.code, 6);
  assert.equal(errCode(r), 'session_tainted');
}));
