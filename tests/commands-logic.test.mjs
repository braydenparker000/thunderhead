// The phone's own commands (th/commands/commands.js, NEXT-BATCH.md part 5): what the grammar reads
// exactly, the times it understands, and that anything else stays words for the mind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandOf, preview, whenOf, whenWords } from '../frontend/th/commands/commands.js';

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

test('playback orders for the app playing in home (th/island): plain words only; "stop" alone stays the mind\'s', () => {
  const c = (t) => commandOf(t, NOW);
  for (const [t, cmd] of [['pause', 'pause'], ['Pause the music.', 'pause'], ['stop the music', 'pause'], ['play', 'play'], ['resume', 'play'], ['skip', 'next'], ['Skip this song', 'next'], ['next song', 'next'], ['previous', 'previous'], ['go back a song', 'previous'], ['siguiente', 'next']])
    assert.deepEqual(c(t), { kind: 'control', cmd }, t);
  assert.deepEqual(c('never play this again'), { kind: 'control', cmd: 'never' }, 'the mind hears it as a music.rate sense with the id');
  assert.deepEqual(c("Don't play that song again!"), { kind: 'control', cmd: 'never' });
  assert.equal(c('stop'), null, 'may mean the mind\'s work');
  assert.equal(c('play Evening'), null, 'a playlist by name is the mind\'s for now');
  assert.equal(c('can you skip this?'), null);
});

test('the sleep timer: until I fall asleep is 30 minutes; a time from 1 minute to 4 hours', () => {
  const c = (t) => commandOf(t, NOW);
  assert.deepEqual(c('play until I fall asleep'), { kind: 'control', cmd: 'sleep', minutes: 30 });
  assert.deepEqual(c('sleep timer'), { kind: 'control', cmd: 'sleep', minutes: 30 });
  assert.deepEqual(c('sleep timer 20 minutes'), { kind: 'control', cmd: 'sleep', minutes: 20 });
  assert.deepEqual(c('Stop the music in an hour.'), { kind: 'control', cmd: 'sleep', minutes: 60 });
  assert.deepEqual(c('turn off the music in half an hour'), { kind: 'control', cmd: 'sleep', minutes: 30 });
  assert.equal(c('sleep timer 500 hours'), null);
  assert.match(preview(c('sleep timer 20 minutes')), /in 20 minutes/);
  // Off again.
  for (const t of ['cancel the sleep timer', 'Stop the sleep timer.', 'sleep timer off', 'turn off sleep timer'])
    assert.deepEqual(c(t), { kind: 'control', cmd: 'sleep', minutes: 0 }, t);
  assert.equal(preview(c('cancel the sleep timer')), 'Turns the sleep timer off.');
});
