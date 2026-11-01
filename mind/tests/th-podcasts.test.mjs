// th podcasts new against the fake Worker (RUNTIME.md §12.1, NEXT-BATCH.md part 7): the night reads
// the followed shows due a check (never an unfollowed one, at most 20, the longest unchecked first),
// counts the episodes published since the show's last check that no phone has started, sends the
// checks back, and prints a home line of at most 44 characters with the count and the shows' names.
// A refired night reads nothing again and still has the line; a feed that fails stays due; the
// Worker's "no more reads today" stops the rest. Synthetic shows and episodes only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {episodeID} from '../../frontend/th/podcasts/feed.js';
import {due, freshOf, lineFor} from '../cli/lib/podcasts.mjs';
import {env, startFake, th} from './helpers.mjs';

const H = 3_600_000;
const feed = (n) => `https://feeds.example.org/show-${n}.xml`;
/** A feed whose items were published these many hours ago (guids g-<n>-<i>). */
const rss = (n, hoursAgo) =>
  `<?xml version="1.0"?><rss><channel><title>Show ${n}</title>${hoursAgo
    .map((h, i) => `<item><title>Episode ${i}</title><guid>g-${n}-${i}</guid><pubDate>${new Date(Date.now() - h * H).toUTCString()}</pubDate><enclosure url="https://media.example.org/${n}-${i}.mp3" type="audio/mpeg"/></item>`)
    .join('')}</channel></rss>`;
const night = fake => env(fake, {TH_ROLE: 'night'});
const withFake = fn => async () => {
  const fake = await startFake();
  try { await fn(fake); } finally { await fake.stop(); }
};

test('lineFor: the count and the names, at most 44 characters, a full stop at the end', () => {
  assert.equal(lineFor([]), null);
  assert.equal(lineFor([{title: 'History', new: 0}]), null);
  assert.equal(lineFor([{title: 'History', new: 1}]), '1 new episode: History.');
  assert.equal(lineFor([{title: 'History', new: 1}, {title: 'Science Hour', new: 1}]), '2 new episodes: History and Science Hour.');
  assert.equal(lineFor([{title: 'Long Show Name', new: 2}, {title: 'Another Long Name', new: 1}, {title: 'Third', new: 1}]), '4 new episodes: Long Show Name and 2 more.');
  assert.equal(lineFor([{title: 'A Remarkably Long Podcast Title That Goes On', new: 3}]), '3 new episodes: A Remarkably Long Podcast.');
  assert.equal(lineFor([{title: 'Abcdefghijklmnopqrstuvwxyzabcdefghij', new: 2}, {title: 'B', new: 1}]), '3 new episodes: Abcdefghijklmnop and 1 more.');
  assert.equal(lineFor([{title: 'Wow! 🎙 News.', new: 1}]), '1 new episode: Wow News.');
  for (const shows of [[{title: 'x'.repeat(80), new: 12}, {title: 'y', new: 3}], [{title: '', new: 2}], [{title: 'Inc.', new: 1}]]) {
    const line = lineFor(shows);
    assert.ok(line.length <= 44 && line.endsWith('.') && !/[!\n]/.test(line), line);
  }
});

test('due: followed shows never checked or not for 20 hours, the longest unchecked first', () => {
  const now = Date.now();
  const rows = [
    {feed_url: 'a', followed: true, checked_at: now - 2 * H},
    {feed_url: 'b', followed: true, checked_at: now - 30 * H},
    {feed_url: 'c', followed: false, checked_at: null},
    {feed_url: 'd', followed: true, checked_at: null},
    {feed_url: 'e', followed: true, checked_at: now - 21 * H},
  ];
  assert.deepEqual(due(rows, now).map(f => f.feed_url), ['d', 'b', 'e']);
});

test('freshOf: published since the last check (the first time: the last day), not started, the newest kept', () => {
  const now = Date.now();
  const id = i => episodeID(`g-1-${i}`);
  const episodes = [3, 10, 30, -5].map((h, i) => ({id: id(i), publishedAt: new Date(now - h * H).toISOString()}));
  const started = new Set([`${feed(1)}#${id(0)}`]);
  // Last check saw an episode 20 hours ago: the 10 h one is new, the 3 h one was started, a future one is left out.
  assert.deepEqual(freshOf({feed_url: feed(1), latest_at: now - 20 * H, updated_at: 0}, {episodes}, started, now),
    {feed_url: feed(1), latest_at: now - 3 * H, new_n: 1});
  // Never checked: the last day only.
  assert.equal(freshOf({feed_url: feed(1), latest_at: null, updated_at: 0}, {episodes}, new Set(), now).new_n, 2);
});

test('th podcasts new: the due shows read, the checks sent, the line printed; a refire reads nothing again', withFake(async fake => {
  const now = Date.now();
  fake.addFollow({feed_url: feed(1), title: 'History Hour', latest_at: now - 48 * H, checked_at: now - 24 * H});
  fake.addFollow({feed_url: feed(2), title: 'Science Talk', latest_at: now - 48 * H, checked_at: now - 25 * H});
  fake.addFollow({feed_url: feed(3), title: 'Quiet Show', latest_at: now - 2 * H, checked_at: now - 22 * H});
  fake.addFollow({feed_url: feed(4), title: 'Gone Show', followed: false});
  fake.addFollow({feed_url: feed(5), title: 'Checked Today', checked_at: now - 3 * H, new_n: 0});
  fake.setFeed(feed(1), rss(1, [5, 20, 60]));
  fake.setFeed(feed(2), rss(2, [10, 70]));
  fake.setFeed(feed(3), rss(3, [2]));
  // Episode 0 of show 2 was started on a phone: not new.
  fake.addPosition({key: `${feed(2)}#${episodeID('g-2-0')}`, position_s: 120});
  const r = await th(['podcasts', 'new'], night(fake));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json, {checked: 3, failed: 0, waiting: 0, new: [{title: 'History Hour', new: 2}], total: 2, line: '2 new episodes: History Hour.'});
  assert.deepEqual(fake.state.podcasts.reads, [feed(2), feed(1), feed(3)]);
  assert.deepEqual(fake.state.podcasts.checks[0].map(c => [c.feed_url, c.new_n]), [[feed(2), 0], [feed(1), 2], [feed(3), 0]]);
  // A refire the same night: nothing is due, nothing read, and the line is the same.
  const again = await th(['podcasts', 'new'], night(fake));
  assert.equal(again.json.line, '2 new episodes: History Hour.');
  assert.equal(again.json.checked, 0);
  assert.equal(fake.state.podcasts.reads.length, 3);
}));

test('th podcasts new: at most 20 shows a night; a failing feed stays due; no more reads today stops the rest', withFake(async fake => {
  for (let i = 0; i < 23; i++) {
    fake.addFollow({feed_url: feed(i), title: `Show ${i}`});
    fake.setFeed(feed(i), rss(i, [1]));
  }
  fake.setFeed(feed(0), {status: 502, code: 'upstream'});
  const r = await th(['podcasts', 'new'], night(fake));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.state.podcasts.reads.length, 20);
  assert.deepEqual([r.json.checked, r.json.failed, r.json.waiting], [19, 1, 3]);
  assert.equal(r.json.total, 19);
  assert.ok(r.json.line.length <= 44 && r.json.line.startsWith('19 new episodes: '), r.json.line);
  // The next run: the 3 not read, and the failed one, are due; the Worker refuses the third read.
  const left = fake.state.podcasts.follows.filter(f => f.checked_at === null).map(f => f.feed_url).sort();
  assert.equal(left.length, 4);
  assert.ok(left.includes(feed(0)));
  fake.state.podcasts.reads = [];
  left.forEach((url, i) => fake.setFeed(url, i === 2 ? {status: 429, code: 'rate_limited'} : rss(9, [1])));
  const next = await th(['podcasts', 'new'], night(fake));
  assert.equal(next.code, 0, next.stderr);
  assert.equal(fake.state.podcasts.reads.length, 3);
  assert.deepEqual([next.json.checked, next.json.waiting], [2, 2]);
}));

test('th podcasts new: usage, and only the night may', withFake(async fake => {
  assert.equal((await th(['podcasts'], night(fake))).code, 8);
  assert.equal((await th(['podcasts', 'old'], night(fake))).code, 8);
  assert.equal((await th(['podcasts', 'new'], env(fake, {TH_ROLE: 'chat'}))).code, 6);
}));
