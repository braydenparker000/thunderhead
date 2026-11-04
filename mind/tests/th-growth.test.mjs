// th guitar week, th study week and th growth against the fake Worker (shared/contract/growth.ts,
// RUNTIME.md §12 step 13): the week questions by name with the day (--to, else the night's day),
// their row printed as it comes with its rows read, a song whose id holds words marked outside;
// growth asks for the night's day and prints what the Worker placed. Usage errors stop before the
// network. Invented songs and books only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, errCode, startFake, th} from './helpers.mjs';

const WEEK = {
  guitar_week: {from: '2026-10-25', to: '2026-10-31', sessions: 4, minutes: 95, days: 4, cleared: 1, gained: 1,
    songs: [{ref: 'tab:g:invented-artist/invented-song', outside: true, sessions: 4, minutes: 95,
      sections: [{key: '8-11', bars: '9-12', best_bpm: 92, before_bpm: 84, gained: 8, cleared: false, clean: 6}]}]},
  study_week: {from: '2026-10-25', to: '2026-10-31', reads: 5, pages: 48, minutes: 70, days: 4, books: 1,
    items: [{ref: 'book:b-invented-1', reads: 5, pages: 48, minutes: 70, days: 4}]},
};

test('th guitar week and th study week ask the senses by name and print counts and ids', async () => {
  const fake = await startFake();
  try {
    const music = fake.senseQuery;
    fake.senseQuery = body => (WEEK[body.name] ? {rows: [WEEK[body.name]], rows_read: 12} : music(body));
    const g = await th(['guitar', 'week', '--to', '2026-10-31'], env(fake));
    assert.equal(g.code, 0, g.stderr);
    assert.deepEqual(g.json, {...WEEK.guitar_week, rows_read: 12});
    assert.equal(g.json.songs[0].outside, true, 'an id that holds a title is marked outside');
    const asked = fake.state.requests.filter(r => r.path === '/v1/senses/query').map(r => r.body);
    assert.deepEqual(asked, [{name: 'guitar_week', params: {to: '2026-10-31'}}]);
    const s = await th(['study', 'week', '--to', '2026-10-31'], env(fake));
    assert.equal(s.code, 0, s.stderr);
    assert.deepEqual(s.json, {...WEEK.study_week, rows_read: 12});
    const before = fake.state.requests.length;
    for (const bad of [['guitar'], ['guitar', 'month'], ['study', 'week', 'extra'], ['study', 'week', '--to', 'yesterday']])
      assert.equal((await th(bad, env(fake))).code, 8, bad.join(' '));
    assert.equal(fake.state.requests.length, before, 'refused before the network');
  } finally {
    await fake.stop();
  }
});

test('th growth asks for the night\'s day and prints what the Worker placed', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    fake.state.growth.answer = {from: '2026-10-25', rows_read: 40,
      guitar: {sessions: 4, tile: 'led-1', plan: 'led-2', reason: null}, study: {sessions: 2, tile: null, plan: null, reason: 'quiet'}};
    const r = await th(['growth', '--day', '2026-10-31'], e);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.study, {sessions: 2, tile: null, plan: null, reason: 'quiet'});
    assert.equal(r.json.guitar.plan, 'led-2');
    assert.deepEqual(fake.state.growth.asked, ['2026-10-31']);
    assert.equal((await th(['growth', 'now'], e)).code, 8);
    assert.equal(errCode(await th(['growth', '--day', '2026-10-31'], env(fake))), 'forbidden', 'the night\'s only');
  } finally {
    await fake.stop();
  }
});
