// th music taste, similar and find --like-history against the fake Worker (MUSIC.md §11.3): the
// owner's taste as counts, ids and canonical names; artists like one by MusicBrainz id; songs weighted
// by history. Bad ids and limits stop before the network. Invented artists only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {env, startFake, th} from './helpers.mjs';

const MBID = '00000000-0000-4000-8000-000000000001';

test('th music taste and similar print counts, ids and canonical names', async () => {
  const fake = await startFake();
  try {
    fake.state.taste = [
      {id: MBID, mbid: MBID, name: 'Invented Artist 1', plays: 90, minutes: 240, songs: 3},
      {id: 'h_0a1b2c3d', mbid: null, name: null, plays: 30, minutes: 60, songs: 0},
    ];
    fake.state.similar = [{mbid: '00000000-0000-4000-8000-000000000002', name: 'Invented Artist 2', score: 1, plays: 4, songs: 1}];
    const t = await th(['music', 'taste', '--limit', '2'], env(fake));
    assert.equal(t.code, 0, t.stderr);
    assert.equal(t.json.top[1].name, null);
    assert.deepEqual(fake.state.requests.find(r => r.path === '/v1/music/taste').query, {limit: '2'});
    const s = await th(['music', 'similar', MBID], env(fake));
    assert.equal(s.code, 0, s.stderr);
    assert.equal(s.json.items[0].name, 'Invented Artist 2');
    const asked = fake.state.requests.length;
    assert.notEqual((await th(['music', 'similar', 'Invented Artist 1'], env(fake))).code, 0);
    assert.notEqual((await th(['music', 'taste', '--limit', '99'], env(fake))).code, 0);
    assert.equal(fake.state.requests.length, asked, 'refused before the network');
  } finally {
    await fake.stop();
  }
});

test('th music find --like-history asks find with history=1, no mood needed', async () => {
  const fake = await startFake();
  try {
    fake.addTracks([{id: `r2_native_${'1'.padStart(64, '0')}`, title: 'Invented song', artist: 'Invented Artist 1'}]);
    const r = await th(['music', 'find', '--like-history', '--limit', '5'], env(fake));
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(fake.state.requests.find(x => x.path === '/v1/music/find').query, {history: '1', limit: '5'});
    assert.equal(r.json.items[0].why.history, 1);
    assert.notEqual((await th(['music', 'find'], env(fake))).code, 0);
  } finally {
    await fake.stop();
  }
});
