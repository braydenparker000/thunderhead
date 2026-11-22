// th checkin say and done against the fake Worker (backend/src/areas/mind/checkin-session.ts): the
// message comes from stdin with a fresh id, done carries --nothing's why; usage errors stop before
// the network; the night key only. Invented words only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, errCode, startFake, th} from './helpers.mjs';

test('th checkin say sends stdin as the one message; done ends it with the outcome', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    const said = await th(['checkin', 'say'], e, 'How did the trail go?\n');
    assert.equal(said.code, 0, said.stderr);
    assert.equal(fake.state.checkins[0].action, 'say');
    assert.equal(fake.state.checkins[0].body, 'How did the trail go?');
    assert.match(fake.state.checkins[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    assert.equal(said.json.message_id, fake.state.checkins[0].id);
    const done = await th(['checkin', 'done', '--nothing', 'a quiet day'], e);
    assert.equal(done.code, 0, done.stderr);
    assert.deepEqual(done.json, {outcome: 'nothing', slot: '12:30'});
    assert.deepEqual(fake.state.checkins[1], {session: fake.state.checkins[1].session, action: 'done', nothing: 'a quiet day'});
    const before = fake.state.requests.length;
    for (const [bad, input] of [[['checkin'], ''], [['checkin', 'say'], '  \n'], [['checkin', 'say', 'words'], ''], [['checkin', 'later'], '']])
      assert.equal((await th(bad, e, input)).code, 8, bad.join(' '));
    assert.equal(fake.state.requests.length, before, 'refused before the network');
    assert.equal(errCode(await th(['checkin', 'done'], env(fake))), 'forbidden', 'the night key only');
  } finally {
    await fake.stop();
  }
});
