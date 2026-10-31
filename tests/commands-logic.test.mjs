// The phone's own commands (th/commands/commands.js, NEXT-BATCH.md part 5): what the grammar reads
// exactly, the times it understands, and that anything else stays words for the mind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandOf, whenOf, whenWords } from '../frontend/th/commands/commands.js';

// Saturday 2026-10-31 14:20 local.
const NOW = new Date(2026, 9, 31, 14, 20).getTime();
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

test('open an app by the name the owner calls it', () => {
  for (const [t, app] of [['open guitar', 'guitar'], ['Open Music.', 'music'], ['go to my media', 'media'], ['launch the podcasts app', 'podcasts'], ['abre la guitarra', null], ['abre guitarra', 'guitar'], ['open study', 'study']])
    assert.deepEqual(commandOf(t, NOW), app ? { kind: 'open', app } : null, t);
  assert.equal(commandOf('open the door for me', NOW), null);
  assert.equal(commandOf('can you open guitar?', NOW), null, 'only the plain order; a question goes to the mind');
});

test('remind me: when first or last, the words kept in their own case', () => {
  assert.deepEqual(commandOf('remind me at 5 to Call the bank', NOW), { kind: 'remind', at: at(31, 17), text: 'Call the bank' });
  assert.deepEqual(commandOf('Remind me to water the seedlings in 20 minutes.', NOW), { kind: 'remind', at: NOW + 20 * 60_000, text: 'water the seedlings' });
  assert.deepEqual(commandOf('remind me tomorrow at 8 to stretch', NOW), { kind: 'remind', at: at(32, 8), text: 'stretch' });
  assert.deepEqual(commandOf('remind me tonight to take out the bins', NOW), { kind: 'remind', at: at(31, 20), text: 'take out the bins' });
  assert.equal(commandOf('remind me about the car sometime', NOW), null, 'no time it can read: the mind takes it');
  assert.equal(commandOf('remind me what we said yesterday', NOW), null);
});

test('times: the next one the clock will read, with or without am and pm', () => {
  assert.equal(whenOf('at 5', NOW), at(31, 17), 'at 5 in the afternoon means 17:00');
  assert.equal(whenOf('at 9', NOW), at(31, 21));
  assert.equal(whenOf('at 9am', NOW), at(32, 9));
  assert.equal(whenOf('at 17:30', NOW), at(31, 17, 30));
  assert.equal(whenOf('at 2:15pm', NOW), at(31, 14, 15) > NOW ? at(31, 14, 15) : at(32, 14, 15));
  assert.equal(whenOf('in an hour', NOW), NOW + 3_600_000);
  assert.equal(whenOf('in half an hour', NOW), NOW + 1_800_000);
  assert.equal(whenOf('in two hours', NOW), NOW + 7_200_000);
  assert.equal(whenOf('tomorrow', NOW), at(32, 8));
  assert.equal(whenOf('at 25', NOW), null);
  assert.equal(whenOf('in 9999 hours', NOW), null);
  assert.equal(whenWords(at(31, 17), NOW), '17:00');
  assert.equal(whenWords(at(32, 8), NOW), 'tomorrow 08:00');
});
