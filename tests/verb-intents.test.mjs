// Pending intents on the phone (API.md §11.11): the apps' executors against fakes of the player and
// the Podcasts app's storage, each returning its inverse; and the plumbing that claims, runs and
// reports them (an intent another phone took is skipped, one the app lacks is unsupported_verb, and
// nothing is reported until the caller sends). Everything is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTORS as MUSIC } from '../frontend/th/music/intents.js';
import { EXECUTORS as PODCASTS } from '../frontend/th/podcasts/intents.js';
import { episodeID } from '../frontend/th/podcasts/feed.js';
import { applyIntents } from '../frontend/th/ported/intents.js';

const id = (n) => `r2_song${String(n).padStart(8, '0')}`;
const ref = (n) => `music:${id(n)}`;

/** The player and library as the executors use them. */
function music(n = 5) {
  const tracks = Array.from({ length: n }, (_, i) => ({ id: id(i + 1), rating: 0 }));
  const library = {
    byId: new Map(tracks.map((t) => [t.id, t])),
    setRating(t, r) {
      t.rating = r;
    },
  };
  const player = {
    queue: [tracks[0], tracks[1]],
    index: 1,
    entries: [],
    queueMode: false,
    get track() {
      return this.queue[this.index];
    },
    enqueue(list, next) {
      const add = list.map((track) => ({ track, played: false }));
      if (next) this.entries.unshift(...add);
      else this.entries.push(...add);
    },
    queueUpdated() {},
    setQueue(list, index) {
      this.queue = list;
      this.index = index;
    },
  };
  return { player, library, tracks };
}

test('music.queue adds what the library holds and returns music.unqueue; that takes them back out', async () => {
  const m = music();
  const out = await MUSIC['music.queue'][1](m, { refs: [ref(3), ref(4), ref(99)], at: 'end' });
  assert.deepEqual(out, { ok: true, result: { queued: 2, missing: 1 }, undo: { verb: 'music.unqueue', schema: 1, args: { refs: [ref(3), ref(4)] } } });
  assert.deepEqual(m.player.entries.map((e) => e.track.id), [id(3), id(4)]);
  m.player.entries[0].played = true;
  const back = await MUSIC['music.unqueue'][1](m, out.undo.args);
  // A song that already played stays where it was.
  assert.deepEqual(back, { ok: true, result: { removed: 1 } });
  assert.deepEqual(m.player.entries.map((e) => e.track.id), [id(3)]);
});

test('music.play_mix makes the songs the queue, paused, and its undo is the queue before', async () => {
  const m = music();
  const out = await MUSIC['music.play_mix'][1](m, { mix_id: 'x', refs: [ref(5), ref(4)] });
  assert.deepEqual(out.result, { tracks: 2, started: false });
  assert.deepEqual(m.player.queue.map((t) => t.id), [id(5), id(4)]);
  assert.deepEqual(out.undo, { verb: 'music.play_mix', schema: 1, args: { refs: [ref(1), ref(2)], index: 1 } });
  await MUSIC['music.play_mix'][1](m, out.undo.args);
  assert.deepEqual([m.player.queue.map((t) => t.id), m.player.index], [[id(1), id(2)], 1]);
  assert.equal((await MUSIC['music.play_mix'][1](m, { refs: [ref(77)] })).ok, false);
});

test("music.rate only rates a song the owner hasn't; music.unrate only clears its own rating", async () => {
  const m = music();
  m.tracks[1].rating = 2;
  assert.deepEqual(await MUSIC['music.rate'][1](m, { ref: ref(2), rating: 5 }), { ok: false, error: { code: 'owner_rated' } });
  const out = await MUSIC['music.rate'][1](m, { ref: ref(1), rating: 5 });
  assert.deepEqual(out, { ok: true, result: { previous: 0 }, undo: { verb: 'music.unrate', schema: 1, args: { ref: ref(1), rating: 5 } } });
  m.tracks[0].rating = 3;
  assert.equal((await MUSIC['music.unrate'][1](m, out.undo.args)).ok, false);
  m.tracks[0].rating = 5;
  assert.equal((await MUSIC['music.unrate'][1](m, out.undo.args)).ok, true);
  assert.equal(m.tracks[0].rating, 0);
});

test('podcasts: follow and unfollow are each other\'s undo; an episode joins Up Next from the saved feed', async () => {
  const FEED = 'https://feeds.example.test/maps.xml';
  const show = episodeID(FEED);
  const app = { follows: [], queue: [] };
  const saved = { show: { title: 'Maps', feedUrl: FEED }, episodes: [{ id: 'e2', title: 'Two' }, { id: 'e1', title: 'One' }] };
  const p = { app, storedFeed: async (url) => (url === FEED ? saved : null) };
  const f = await PODCASTS['podcasts.follow'][1](p, { feed_url: FEED, title: 'Maps' });
  assert.deepEqual(f, { ok: true, result: { show_id: show }, undo: { verb: 'podcasts.unfollow', schema: 1, args: { show_id: show } } });
  assert.deepEqual(await PODCASTS['podcasts.follow'][1](p, { feed_url: FEED, title: 'Maps' }), { ok: true, result: { show_id: show } });
  const q = await PODCASTS['podcasts.queue_episode'][1](p, { show_id: show });
  assert.deepEqual(q, { ok: true, result: { key: `${FEED}#e2` }, undo: { verb: 'podcasts.unqueue_episode', schema: 1, args: { key: `${FEED}#e2` } } });
  assert.equal(app.queue[0].show.feedUrl, FEED);
  await PODCASTS['podcasts.unqueue_episode'][1](p, q.undo.args);
  assert.deepEqual(app.queue, []);
  const u = await PODCASTS['podcasts.unfollow'][1](p, { show_id: show });
  assert.deepEqual(u.undo, { verb: 'podcasts.follow', schema: 1, args: { feed_url: FEED, title: 'Maps' } });
  assert.deepEqual(app.follows, []);
  assert.deepEqual(await PODCASTS['podcasts.queue_episode'][1](p, { show_id: show }), { ok: false, error: { code: 'not_followed' } });
});

test('the plumbing: claims each pending intent, skips one another phone took, reports only when sent', async () => {
  const reported = [];
  const io = {
    pending: async () => [
      { id: 'a', verb: 'music.rate', schema: 1, args: { ref: ref(1), rating: 4 }, status: 'pending' },
      { id: 'b', verb: 'music.rate', schema: 1, args: { ref: ref(2), rating: 4 }, status: 'pending' },
      { id: 'c', verb: 'music.dance', schema: 1, args: {}, status: 'pending' },
      { id: 'd', verb: 'music.rate', schema: 1, args: {}, status: 'claimed' },
    ],
    claim: async (v) => v !== 'b',
    report: async (v, out) => void reported.push([v, out.ok ? 'ok' : out.error.code]),
  };
  const m = music();
  const r = await applyIntents(MUSIC, m, io);
  assert.equal(m.tracks[0].rating, 4);
  assert.equal(m.tracks[1].rating, 0);
  assert.deepEqual(reported, []);
  await r.send();
  assert.deepEqual(reported, [['a', 'ok'], ['c', 'unsupported_verb']]);
});
