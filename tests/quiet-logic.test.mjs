// "Go quiet" in the browser (frontend/th/chat/quiet.js, BEHAVIOR.md §8.1; EVALS.md §6 `go_quiet`,
// 100% required): the command alone, with or without a time, in English or the second language's
// few words; "I'm back" ends it; anything more is for the mind. On the local clock, so any zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quietLine, quietOrder } from '../frontend/th/chat/quiet.js';
import { voiceLine } from '../frontend/th/chat/model.js';

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime(); // 30 October 2026 is a Friday
const NOW = at(30, 14);
const H = 3_600_000;
const until = (text, now = NOW) => quietOrder(text, now)?.until;

test('the go_quiet rows: each is caught, with its end', () => {
  assert.equal(until('go quiet'), at(31, 6, 30));
  assert.equal(until('quiet until 6'), at(30, 18));
  assert.equal(until('silencio por dos horas'), NOW + 2 * H);
  assert.equal(until('not now please, be quiet'), at(31, 6, 30));
  assert.equal(until('Go quiet for 2 hours.'), NOW + 2 * H);
  assert.equal(until('quiet for an hour'), NOW + H);
  assert.equal(until('be quiet for 30 min'), NOW + 30 * 60_000);
  assert.equal(until('Quiet today'), at(31, 6, 30));
  assert.equal(until('quiet until tomorrow'), at(31, 6, 30));
  assert.equal(until('quiet until Monday'), at(33, 6, 30));
  assert.equal(until('quiet until friday'), at(37, 6, 30));
  assert.equal(until('be quiet until 18:30'), at(30, 18, 30));
  assert.equal(until('quiet until 6am'), at(31, 6));
  assert.equal(until('quiet until 12pm'), at(31, 12));
  assert.equal(until('stop talking'), at(31, 6, 30));
  assert.equal(until('quiet until I’m back'), NOW + 168 * H);
  assert.equal(until('quiet for 500 hours'), NOW + 168 * H);
  assert.equal(until('¡Silencio!'), at(31, 6, 30));
  assert.equal(until('silencio hasta las 6'), at(30, 18));
  assert.equal(until('modo silencio por una hora'), NOW + H);
});

test('the default end is the next 06:30: at 01:00 the same morning, at 06:45 the next', () => {
  assert.equal(until('go quiet', at(31, 1)), at(31, 6, 30));
  assert.equal(until('go quiet', at(30, 6, 45)), at(31, 6, 30));
  assert.equal(until('quiet until 6', at(30, 3)), at(30, 6));
});

test('"I\'m back" ends it; anything that is not only the command is for the mind', () => {
  for (const t of ["I'm back", 'you can talk now', 'end quiet', 'ok, quiet off', 'Ya volví', 'puedes hablar']) assert.deepEqual(quietOrder(t, NOW), { end: true }, t);
  for (const t of ['quiet hours', 'why is it so quiet today?', 'play something quiet', 'go quiet about the trip', 'quiet until 25', 'quiet until 13pm', 'quiet for zero hours', 'stop talking about music', 'I’m back home, what did I miss?'])
    assert.equal(quietOrder(t, NOW), null, t);
});

test('the voice line: "Quiet until 06:30." (with the day when over a day away) holds the rest', () => {
  assert.equal(quietLine(at(31, 6, 30), NOW), 'Quiet until 06:30.');
  assert.equal(quietLine(at(33, 6, 30), NOW), 'Quiet until Monday 06:30.');
  const base = { presence: null, firstRun: true, homeLine: 'Rain at 4.', decisions: 2 };
  assert.deepEqual(voiceLine({ ...base, quiet: 'Quiet until 06:30.' }), ['Quiet until 06:30.', "I'll hold everything until then."]);
  assert.deepEqual(voiceLine({ ...base, presence: { state: 'failed', note: null, since: 0 }, quiet: 'Quiet until 06:30.' }), ["I can't wake just now.", "I'll answer when I'm back."]);
});
