// Reading a podcast feed (frontend/th/podcasts/feed.js; PODCASTS.md §4), as the old Worker did
// (ported from the old repo's backend/tests/podcasts.test.js): the public-address guard, stable
// ids, text-only notes, duplicates and non-audio left out, DTDs refused, pages with stable ids, one
// episode by id, and a feed cut short keeping its whole items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationSeconds, episodeID, parseFeed, publicURL } from '../frontend/th/podcasts/feed.js';

const FEED = 'https://feeds.example.org/podcast.xml';
const RSS = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>History &amp; Sound</title><itunes:author>Somebody</itunes:author><description><![CDATA[<p>A good <b>show</b></p>]]></description><itunes:image href="https://images.example.org/show.jpg"/><item><title>Episode &amp; one</title><guid isPermaLink="false">episode-1</guid><description><![CDATA[<p>Notes with &amp; characters and </item> text.</p>]]></description><pubDate>Fri, 02 Oct 2026 12:00:00 GMT</pubDate><itunes:duration>01:02:03</itunes:duration><enclosure url="https://media.example.org/audio.mp3?a=1&amp;b=2" type="audio/mpeg" length="12000"/></item><item><title>Episode two</title><guid>episode-2</guid><itunes:duration>120</itunes:duration><enclosure url="https://media.example.org/two.mp3" type="audio/mpeg"/></item><item><title>Duplicate</title><guid>episode-1</guid><enclosure url="https://media.example.org/audio.mp3" type="audio/mpeg"/></item><item><title>Private</title><enclosure url="http://127.0.0.1/audio.mp3" type="audio/mpeg"/></item><item><title>Video</title><enclosure url="https://media.example.org/video.mp4" type="video/mp4"/></item></channel></rss>`;

test('public addresses only: no credentials, ports, local or numeric hosts, other protocols', () => {
  for (const url of ['file:///etc/passwd', 'https://localhost/feed', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/', 'https://a.internal/feed', 'https://127.0.0.1.nip.io/', 'https://name:pass@feeds.example.org/', 'https://feeds.example.org:8443/', 'https://metadata.google.internal/'])
    assert.throws(() => publicURL(url), url);
  assert.equal(publicURL(`${FEED}#test`), FEED);
});

test('stable guids, text-only notes, real dates, the publisher’s audio, no duplicates', () => {
  const { show, episodes } = parseFeed(RSS, FEED);
  assert.deepEqual([show.title, show.description, show.artwork, show.id], ['History & Sound', 'A good show', 'https://images.example.org/show.jpg', episodeID(FEED)]);
  assert.equal(episodes.length, 2);
  assert.deepEqual([episodes[0].id, episodes[0].duration, episodes[0].audioUrl, episodes[0].publishedAt], [episodeID('episode-1'), 3723, 'https://media.example.org/audio.mp3?a=1&b=2', '2026-10-02T12:00:00.000Z']);
  assert.match(episodes[0].description, /^Notes with & characters and/);
  assert.doesNotMatch(episodes[0].description, /<p>/);
  assert.throws(() => parseFeed(`<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>${RSS}`, FEED), /unsupported XML/);
  assert.throws(() => parseFeed('<html>Not a feed</html>', FEED), (e) => e.status === 400);
  assert.equal(durationSeconds('4:30'), 270);
  assert.equal(durationSeconds('invalid'), 0);
});

test('pages keep stable ids; one episode is found by its id, far down too', () => {
  const body = `<rss><channel><title>Archive</title>${Array.from({ length: 100 }, (_, i) => `<item><title>Episode ${i}</title><guid>id-${i}</guid><enclosure url="https://media.example.org/${i}.mp3" type="audio/mpeg"/></item>`).join('')}</channel></rss>`;
  const first = parseFeed(body, FEED, { limit: 40 });
  const second = parseFeed(body, FEED, { offset: 40, limit: 40 });
  const last = parseFeed(body, FEED, { offset: 80, limit: 40 });
  assert.deepEqual([first.episodes.length, first.nextOffset, second.episodes[0].id, last.episodes.length, last.nextOffset], [40, 40, episodeID('id-40'), 20, null]);
  const one = parseFeed(body, FEED, { id: episodeID('id-99') });
  assert.deepEqual(one.episodes.map((e) => e.title), ['Episode 99']);
  assert.deepEqual(parseFeed(body, FEED, { id: 'missing' }).episodes, []);
});

test('a feed cut short keeps its whole items only', () => {
  const cut = RSS.slice(0, RSS.indexOf('<item><title>Duplicate') + 30);
  assert.deepEqual(parseFeed(cut, FEED).episodes.map((e) => e.title), ['Episode & one', 'Episode two']);
});
