// th music against the fake Worker (RUNTIME.md §5.3, MUSIC.md §10.5): the night's page of untagged
// songs with short handles and a batch of notes written by handle; notes checked against the
// contract's vocabularies before the network; find and like as queries; what is playing now (or
// was last) with its note; what the owner has been into this week. A synthetic catalog only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkNote} from '../cli/lib/music.mjs';
import {CONTRACT} from '../cli/lib/contract.mjs';
import {SONG_TAINT} from '../cli/lib/state.mjs';
import {env, errCode, freshTmp, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const id = i => `r2_native_${String(i).padStart(64, '0')}`;
const SONGS = [
  {id: id(1), title: 'Quiet Lake', artist: 'Artist A', genre: 'Ambient', dur: 200},
  {id: id(2), title: 'Night Drive', artist: 'Artist B', genre: 'Synthwave', year: 1986},
  {id: id(3), title: 'Morning Light', artist: 'Artist A', genre: 'Folk'},
];
const puts = fake => fake.state.requests.filter(r => r.method === 'PUT' && r.path === '/v1/music/notes');
const finds = fake => fake.state.requests.filter(r => r.method === 'GET' && r.path === '/v1/music/find');
const calm = (over = {}) => ({known: true, moods: {calm: 0.8}, occasions: {'wind-down': 0.7}, themes: [], language: null, era: null, energy: 0.2, conf: {energy: 0.6}, ...over});

test('checkNote: the contract\'s vocabularies and confidence rules, every problem named', () => {
  assert.deepEqual(checkNote({id: id(1), ...calm()}, 0), []);
  const bad = checkNote({id: 'x', known: false, moods: {happy: 0.5, calm: 0.9}, occasions: {gym: 0.5}, themes: ['war'],
    language: 'english', era: 1995, energy: 2, conf: {themes: 0.5}}, 3);
  assert.deepEqual(bad, [
    'items.3.id: a track id',
    `items.3.moods.happy: not one of calm, peaceful, melancholy, sad, hopeful, joyful, romantic, nostalgic, dark, tense, energetic, triumphant, playful, dreamy, reverent, focused`,
    'items.3.moods.calm: 0.05 to 0.5',
    'items.3.occasions.gym: not one of focus, wind-down, morning, workout, drive, study, worship, party, rainy-day, sunday, sleep',
    'items.3.themes: at most 3 of love, heartbreak, longing, faith, gratitude, family, friendship, home, loss, freedom, journey, nature, night, celebration, struggle, growing-up',
    'items.3.language: an ISO 639-1 code, or null',
    'items.3.era: a decade (1990), or null',
    'items.3.energy: 0 to 1, or null',
    'items.3.conf.language: needed, language is set',
    'items.3.conf.era: needed, era is set',
    'items.3.conf.energy: needed, energy is set',
  ]);
  assert.deepEqual(checkNote({id: id(1), ...calm({language: 'en', conf: {energy: 0.6, language: 0.9, era: 0.5}})}, 0), ['items.0.conf.era: era is empty']);
});

test('th music page lists the untagged songs with handles; th music note writes by handle', withFake(async fake => {
  fake.addTracks(SONGS);
  const e = env(fake, {TH_ROLE: 'night'});
  const page = await th(['music', 'page', '--limit', '2'], e);
  assert.equal(page.code, 0, page.stderr);
  assert.deepEqual(page.json, {more: true, items: [
    {n: 1, title: 'Quiet Lake', artist: 'Artist A', genre: 'Ambient', dur: 200},
    {n: 2, title: 'Night Drive', artist: 'Artist B', genre: 'Synthwave', year: 1986, dur: 200},
  ]});
  assert.equal(page.stdout.includes(id(1)), false, 'the long ids stay out of the page');
  assert.deepEqual(fake.state.requests.at(-1).query, {untagged: '1', limit: '2'});

  const notes = [{n: 1, ...calm()}, {n: 2, ...calm({known: false, moods: {dreamy: 0.4}, occasions: {drive: 0.5}, energy: 0.6, conf: {energy: 0.3}})}];
  const wrote = await th(['music', 'note'], e, JSON.stringify(notes));
  assert.equal(wrote.code, 0, wrote.stderr);
  assert.deepEqual(wrote.json, {written: 2, unchanged: 0, kept: 0});
  assert.deepEqual(puts(fake).at(-1).body.items.map(n => n.id), [id(1), id(2)]);
  assert.equal(puts(fake).at(-1).body.items[0].n, undefined);
  assert.equal(fake.state.trackNotes.get(id(1)).by, 'mind:night');

  // The same notes again, as {items}: nothing changes. Then the next page holds what is left.
  assert.deepEqual((await th(['music', 'note'], e, JSON.stringify({items: notes}))).json, {written: 0, unchanged: 2, kept: 0});
  const next = await th(['music', 'page'], e);
  assert.deepEqual(next.json, {more: false, items: [{n: 1, title: 'Morning Light', artist: 'Artist A', genre: 'Folk', dur: 200}]});
  // By id works too, and from a file.
  const file = join(freshTmp(), 'notes.json');
  writeFileSync(file, JSON.stringify([{id: id(3), ...calm()}]));
  const byId = await th(['music', 'note', '--file', file], env(fake));
  assert.deepEqual(byId.json, {written: 1, unchanged: 0, kept: 0});
  assert.equal(fake.state.trackNotes.get(id(3)).by, 'mind:chat');
}));

test('th music note refuses before the network; the Worker\'s refusal is exit 8 too', withFake(async fake => {
  fake.addTracks(SONGS);
  const e = env(fake, {TH_ROLE: 'night'});
  await th(['music', 'page'], e);
  for (const [input, what] of [
    ['not json', 'not JSON'],
    ['[]', 'empty'],
    [JSON.stringify(Array.from({length: 201}, () => ({id: id(1), ...calm()}))), 'over 200'],
    [JSON.stringify([{n: 9, ...calm()}]), 'a handle not on the page'],
    [JSON.stringify([{n: 1, ...calm({moods: {happy: 0.8}})}]), 'a mood not in the list'],
    [JSON.stringify([{n: 1, ...calm({known: false})}]), 'too sure of a song not known'],
    [JSON.stringify([{n: 1, ...calm({language: 'en'})}]), 'no confidence for the language'],
  ]) {
    const r = await th(['music', 'note'], e, input);
    assert.equal(r.code, 8, `${what}: ${r.stderr}`);
    assert.equal(errCode(r), 'validation', what);
  }
  assert.equal(puts(fake).length, 0, 'nothing reached the Worker');
  const unknown = await th(['music', 'note'], e, JSON.stringify([{id: id(99), ...calm()}]));
  assert.equal(unknown.code, 8);
  assert.match(unknown.stderr, /not in the catalog/);
  // Reflex has no music.
  assert.equal((await th(['music', 'page'], env(fake, {TH_ROLE: 'reflex'}))).code, 6);
}));

test('th music find and like ask by feeling and by song; bad words stop before the network', withFake(async fake => {
  fake.addTracks(SONGS);
  const e = env(fake);
  await th(['music', 'note'], e, JSON.stringify([{id: id(1), ...calm()}, {id: id(3), ...calm({moods: {calm: 0.5, hopeful: 0.8}})}]));
  const r = await th(['music', 'find', '--mood', 'calm', '--occasion', 'wind-down', '--energy', 'low', '--limit', '5'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(finds(fake).at(-1).query, {moods: 'calm', occasion: 'wind-down', energy: 'low', limit: '5'});
  assert.deepEqual(r.json.items.map(i => i.title), ['Quiet Lake', 'Morning Light']);
  assert.equal(r.json.items[0].year, undefined, 'empty tags left out');
  await th(['music', 'find', '--mood', 'calm', '--mood', 'dreamy'], e);
  assert.deepEqual(finds(fake).at(-1).query, {moods: 'calm,dreamy', limit: '30'});
  await th(['music', 'find', '--mood', 'calm,hopeful'], e);
  assert.equal(finds(fake).at(-1).query.moods, 'calm,hopeful');

  const like = await th(['music', 'like', `music:${id(1)}`], env(fake, {TH_ROLE: 'night'}));
  assert.equal(like.code, 0, like.stderr);
  assert.deepEqual(finds(fake).at(-1).query, {like: id(1), limit: '20'});
  assert.deepEqual(like.json.items.map(i => i.title), ['Night Drive', 'Morning Light']);
  assert.equal((await th(['music', 'like', id(99)], e)).code, 8, 'a song the catalog does not hold');

  const before = finds(fake).length;
  for (const args of [['music', 'find'], ['music', 'find', '--mood', 'happy'], ['music', 'find', '--occasion', 'gym'],
    ['music', 'find', '--mood', 'calm', '--energy', 'loud'], ['music', 'find', '--mood', 'calm', '--limit', '101'],
    ['music', 'like'], ['music', 'like', 'song-1'], ['music'], ['music', 'shuffle']]) {
    const x = await th(args, e);
    assert.equal(x.code, 8, `${args.join(' ')}: ${x.stderr}`);
  }
  assert.equal(finds(fake).length, before, 'nothing reached the Worker');
}));

test('th music now: the song playing, or the last one played, with its note', withFake(async fake => {
  fake.addTracks(SONGS);
  const e = env(fake);
  assert.deepEqual((await th(['music', 'now'], e)).json, {playing: false, at: null, track: null, note: null});
  await th(['music', 'note'], e, JSON.stringify([{id: id(1), ...calm()}]));
  const at = fake.now() - 30_000;
  fake.addSense({type: 'music.play', id: id(1), at});
  const r = await th(['music', 'now'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual({...r.json, note: undefined}, {playing: true, at, ago_min: 1, track: {id: id(1), title: 'Quiet Lake', artist: 'Artist A', genre: 'Ambient', dur: 200}, note: undefined});
  assert.deepEqual(r.json.note.moods, {calm: 0.8});
  // --id: the song's id alone (no tags: the session takes in no outside text).
  assert.deepEqual((await th(['music', 'now', '--id'], e)).json, {playing: true, at, ago_min: 1, id: id(1)});
  // Skipped since: the last one played, not playing.
  fake.addSense({type: 'music.skip', id: id(1), at: at + 10_000});
  assert.equal((await th(['music', 'now'], e)).json.playing, false);
  // A song played an hour ago that would have ended: not playing either.
  fake.addSense({type: 'music.play', id: id(2), at: fake.now() - 3_600_000});
  const old = await th(['music', 'now'], env(fake, {TH_ROLE: 'night'}));
  assert.deepEqual([old.json.playing, old.json.ago_min, old.json.track.title, old.json.note], [false, 60, 'Night Drive', null]);
}));

test('th music week: plays, the top songs, artists and moods of the week', withFake(async fake => {
  fake.addTracks(SONGS);
  const e = env(fake, {TH_ROLE: 'night'});
  await th(['music', 'note'], e, JSON.stringify([{id: id(1), ...calm()}, {id: id(2), ...calm({moods: {dreamy: 0.9}})}]));
  for (let i = 0; i < 3; i++) fake.addSense({type: 'music.play', id: id(1)});
  fake.addSense({type: 'music.play', id: id(2)});
  fake.addSense({type: 'music.skip', id: id(2)});
  fake.addSense({type: 'music.play', id: id(3), at: fake.now() - 9 * 86_400_000});
  const r = await th(['music', 'week'], e);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.top, [{id: id(1), title: 'Quiet Lake', artist: 'Artist A', n: 3}, {id: id(2), title: 'Night Drive', artist: 'Artist B', n: 1}]);
  assert.deepEqual(r.json.artists, [['Artist A', 3], ['Artist B', 1]]);
  assert.deepEqual(r.json.moods, [['calm', 2.4], ['dreamy', 0.9]]);
  assert.deepEqual([r.json.days, r.json.skips, r.json.noted, r.json.of], [7, 1, 2, 2]);
  assert.equal((await th(['music', 'week', '--days', '0'], e)).code, 8);
}));

test('a title goes on stdin, never in a quoted argument: th verb - and th surface --payload -', withFake(async fake => {
  const e = env(fake, {TH_ROLE: 'night'});
  const name = "More like Don't Stop \"Now\"; echo $(id)";
  const mix = await th(['verb', 'music.create_playlist', '-', '--why', 'A mix like the song played most this week'], e,
    JSON.stringify({name, refs: [`music:${id(1)}`, `music:${id(2)}`]}));
  assert.equal(mix.code, 0, mix.stderr);
  const sent = fake.state.requests.find(r => r.method === 'PUT' && r.path.startsWith('/v1/verbs/'));
  assert.deepEqual(sent.body.args, {name, refs: [`music:${id(1)}`, `music:${id(2)}`]});
  const line = await th(['surface', 'home', 'line.4', '--kind', 'line', '--payload', '-', '--why', 'This week: 42 plays, mostly calm and dreamy',
    '--topic', 'music-week', '--ref', 'app:music'], e, JSON.stringify({text: "This week: Artist A's quiet songs."}));
  assert.equal(line.code, 0, line.stderr);
  assert.equal(fake.state.surfaces.get('home/line.4').payload.text, "This week: Artist A's quiet songs.");
  assert.equal((await th(['verb', 'music.create_playlist', '-', '--why', 'A mix for the evening'], e, 'not json')).code, 8);
}));

test('th\'s songs taint is the contract\'s (the Worker holds it for its own session only)', () => {
  assert.equal(SONG_TAINT, CONTRACT.music.taint_source);
});
