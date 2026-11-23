// th music facts, credits, unmatched, picks and pick against the fake Worker (MUSIC.md §19.3–19.5):
// facts compact, with what came from elsewhere under `outside`; a name only on stdin; picks with their
// line; a decline and an order (the words first, the pick ordered only with the order th order new
// placed). Bad ids, kinds and limits stop before the network. Invented artists and albums only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactFacts} from '../cli/lib/know.mjs';
import {env, startFake, th} from './helpers.mjs';

const MBID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};
const artist = {
  kind: 'artist', mbid: MBID(1), name: 'Invented Artist 1', type: 'Group', origin: null, begin: '1995', end: null,
  members: [], member_of: [], influenced_by: [], influenced: [], awards: [], library: 2,
  discography: Array.from({length: 40}, (_, i) => ({mbid: MBID(100 + i), title: `Album ${i}`, type: 'Album', secondary: [], date: `20${String(i).padStart(2, '0')}-01-01`, listens: i})),
  filled: {musicbrainz: 1, wikipedia: 2},
  outside: {wikipedia: {title: 'Invented Artist 1', lead: 'An invented band.', reception: null}, tags: [{name: 'dream pop', weight: 100}], styles: []},
};

test('compactFacts: the empty left out, the best-loved 30 of a discography, the outside text apart', () => {
  const c = compactFacts(artist);
  assert.equal(c.discography.length, 30);
  assert.equal(c.more, 10);
  assert.match(c.discography[0], /^2039 Album 39 · Album · 39 · /);
  assert.equal(c.origin, undefined);
  assert.deepEqual(c.sources, ['musicbrainz', 'wikipedia']);
  assert.deepEqual(c.outside, {wikipedia: artist.outside.wikipedia, tags: ['dream pop 100']});
  assert.equal(compactFacts(artist, true).discography.length, 40);
});

test('th music facts and credits: an id as an argument, a name only on stdin', withFake(async fake => {
  fake.state.facts = [artist];
  const byId = await th(['music', 'facts', MBID(1)], env(fake));
  assert.equal(byId.code, 0, byId.stderr);
  assert.equal(byId.json.items[0].name, 'Invented Artist 1');
  const byName = await th(['music', 'facts', '-'], env(fake), 'Invented Artist 1\n');
  assert.equal(byName.code, 0, byName.stderr);
  assert.deepEqual(fake.state.requests.at(-1).query, {ref: 'Invented Artist 1'});
  const asked = fake.state.requests.length;
  assert.notEqual((await th(['music', 'facts', 'Invented Artist 1'], env(fake))).code, 0);
  assert.notEqual((await th(['music', 'credits'], env(fake))).code, 0);
  assert.equal(fake.state.requests.length, asked, 'refused before the network');
  const c = await th(['music', 'credits', '-'], env(fake), 'Invented Producer');
  assert.equal(c.json.person.name, 'Invented Producer');
  const u = await th(['music', 'unmatched'], env(fake));
  assert.equal(u.json.items[0].reason, 'artist_unknown');
}));

test('th music picks, pick decline and pick order', withFake(async fake => {
  fake.state.picks = [
    {id: MBID(200), kind: 'gap', album: 'The Loved One', artist: 'Invented Artist 1', year: 2006, score: 0.9, state: 'new', line: 'The Loved One (2006) by Invented Artist 1: one of their best-loved albums, and not in your library.'},
    {id: MBID(201), kind: 'new', album: 'A New Dawn', artist: 'Invented Artist 1', year: 2026, score: 0.8, state: 'new', line: 'A New Dawn (2026) by Invented Artist 1: out 10 days ago.'},
  ];
  const p = await th(['music', 'picks', '--kind', 'gap', '--limit', '5'], env(fake));
  assert.equal(p.code, 0, p.stderr);
  assert.deepEqual(p.json.items.map(i => i.line), [fake.state.picks[0].line]);
  assert.deepEqual(fake.state.requests.at(-1).query, {kind: 'gap', limit: '5'});
  const asked = fake.state.requests.length;
  for (const bad of [['picks', '--kind', 'odd'], ['picks', '--limit', '99'], ['pick', 'decline', 'not-an-id'], ['pick', 'keep', MBID(200)]])
    assert.notEqual((await th(['music', ...bad], env(fake))).code, 0, bad.join(' '));
  assert.equal(fake.state.requests.length, asked, 'refused before the network');
  const d = await th(['music', 'pick', 'decline', MBID(201), '--why', 'not for me'], env(fake));
  assert.deepEqual(d.json, {id: MBID(201), state: 'declined'});
  assert.deepEqual(fake.state.requests.at(-1).body, {why: 'not for me'});
  const words = await th(['music', 'pick', 'order', MBID(200)], env(fake));
  assert.equal(words.json.state, 'new');
  assert.match(words.json.words, /The Loved One/);
  assert.match(words.json.next, /only on the owner's yes/);
  const placed = await th(['music', 'pick', 'order', MBID(200), '--placed', 'ord_invented1'], env(fake));
  assert.equal(placed.json.state, 'ordered');
  assert.deepEqual(fake.state.requests.at(-1).body, {order_id: 'ord_invented1'});
}));

test('a pick\'s order words go on stdin to th order new --words -, never in a quoted argument', withFake(async fake => {
  fake.state.picks = [{id: MBID(300), kind: 'gap', album: 'X', artist: 'Y', year: null, score: 1, state: 'new', line: 'x'}];
  const w = await th(['music', 'pick', 'order', MBID(300)], env(fake));
  assert.match(w.json.next, /--words -/);
  assert.doesNotMatch(w.json.next, /--words "/);
  const words = 'Find and upload the album Bad (touch x) Title by Invented Band to the music library.\n';
  const n = await th(['order', 'new', '--words', '-', '--app', 'music'], env(fake), words);
  assert.equal(n.code, 0, n.stderr);
  assert.equal(fake.state.orders.get(n.json.id).value.spec.words, words.trim());
}));
