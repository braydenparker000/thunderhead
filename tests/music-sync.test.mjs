// frontend/th/music/sync.js with the player's own playlists (frontend/music/src/library/playlists.js)
// against a fake Worker (MUSIC.md §1.4): two phones, each with its own storage and clock, sync the
// owner's Music data one record per song and per playlist. The newer change wins both ways, on the
// phone and on the Worker, for a rating ("never play this again" is a 1), a like (5), a playlist
// rename and a playlist delete (a deleted playlist does not come back); plays keep the larger count;
// a fresh phone gets everything; with nothing on the Worker nothing in the library changes (so
// nothing about what plays, or in what order); a rating from another phone is marked `synced`, so
// it is not sent back as a sense. The limits agree with the contract. Invented songs only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_PLAYLIST_ID, MUSIC_SYNC_LIMITS } from '../shared/contract/music-sync.ts';
import { Playlists } from '../frontend/music/src/library/playlists.js';
import * as sync from '../frontend/th/music/sync.js';

const NOW = 1_800_000_000_000;
const world = { t: NOW };
const song = (i) => `r2_native_${i.toString(16).padStart(64, '0')}`;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

/** The Worker's four routes: a rating's newer `rated_at` wins, plays the larger, a playlist's newer
 * `updated_at` wins; pages by when it took each. */
function fakeWorker() {
  const w = { marks: new Map(), lists: new Map(), requests: [], reset: 0, during: null };
  const page = (rows, u) => {
    const since = Number(u.searchParams.get('since') ?? 0);
    const items = [...rows.values()].filter((r) => r.synced_at >= since).sort((a, b) => a.synced_at - b.synced_at);
    const out = items.map(({ synced_at: _, ...r }) => (r.last_played !== undefined && r.last_played <= w.reset ? { ...r, plays: 0, last_played: 0 } : r));
    return { items: out, next_since: world.t, next: null, reset_at: w.reset };
  };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.requests.push({ method: init.method, path: u.pathname, body });
    world.t += 1;
    // Something the owner does while this request is on its way.
    if (init.method === 'PUT' && w.during) {
      const fn = w.during;
      w.during = null;
      fn();
    }
    const json = (b) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    const marks = u.pathname.endsWith('/marks');
    if (init.method !== 'PUT') return json(page(marks ? w.marks : w.lists, u));
    let applied = 0;
    if (marks && body.reset_at) w.reset = Math.max(w.reset, body.reset_at);
    for (const x of body.items) {
      if (marks) {
        const had = w.marks.get(x.id) ?? { id: x.id, rating: null, rated_at: null, plays: 0, last_played: 0 };
        const next = { ...had };
        if (x.rating !== null && x.rated_at > (had.rated_at ?? 0)) Object.assign(next, { rating: x.rating, rated_at: x.rated_at });
        if (x.last_played > w.reset) {
          next.plays = had.last_played <= w.reset ? x.plays : Math.max(had.plays, x.plays);
          next.last_played = Math.max(had.last_played, x.last_played);
        }
        if (JSON.stringify(next) === JSON.stringify(had)) continue;
        next.updated_at = Math.max(1, next.rated_at ?? 0, next.last_played);
        w.marks.set(x.id, { ...next, synced_at: world.t });
      } else {
        const had = w.lists.get(x.id);
        if (had && had.updated_at >= x.updated_at) continue;
        w.lists.set(x.id, { ...x, synced_at: world.t });
      }
      applied++;
    }
    return json({ applied, stale: body.items.length - applied, refused: [], at: world.t });
  };
  return w;
}

/** A phone: its storage and clock (`skew` ms off the Worker's), a library of `n` catalog songs as
 * the player keeps them, the player's real Playlists, and a synchronous bus. */
function phone(n = 4, skew = 0) {
  const subs = [];
  const posted = [];
  const bus = { subscribe: (_b, fn) => subs.push(fn), post: (b, msg, src, d) => (posted.push([msg, d]), subs.forEach((fn) => fn(msg, src, d, b))) };
  const tracks = Array.from({ length: n }, (_, i) => ({ id: song(i + 1), remote: true }));
  const state = new Map();
  const db = { setState: async (k, v) => state.set(k, v), deleteState: async (k) => state.delete(k), stateEntries: async () => [] };
  const library = {
    db,
    tracks,
    remoteTracks: tracks,
    byId: new Map(tracks.map((t) => [t.id, t])),
    saveTrack: async (t) => state.set('u:' + t.id, { rating: t.rating, ratedAt: t.ratedAt, plays: t.plays, lastPlayed: t.lastPlayed }),
    setRating(t, r) {
      t.rating = r;
      void this.saveTrack(t);
      bus.post('bus_data', 'msg_data_track_rating_changed', this, { track: t, arg1: r });
    },
    async resetStats() {
      for (const t of tracks) Object.assign(t, { plays: 0, lastPlayed: 0 });
      bus.post('bus_data', 'msg_data_track_played', this, {});
    },
    markPlayed(t) {
      t.plays = (t.plays ?? 0) + 1;
      t.lastPlayed = p.now();
      void this.saveTrack(t);
      bus.post('bus_data', 'msg_data_track_played', this, { track: t });
    },
  };
  const ctx = { bus, library, settings: {}, res: { stringByName: () => 'Playlist' } };
  new Playlists(ctx, library);
  const p = { ctx, library, storage: memoryStorage(), skew, posted, state, now: () => world.t + skew, song: (i) => library.byId.get(song(i)) };
  sync.watch(ctx, () => {});
  return p;
}

let worker;
/** Runs as `p`: its storage, its clock, the shared Worker. */
function as(p) {
  sync.reset();
  Object.assign(sync.deps, {
    fetch: worker.fetch,
    now: p.now,
    storage: () => p.storage,
    token: async () => 'device-token',
    framed: () => false,
    api: () => 'https://worker.invalid',
    online: () => true,
  });
  return p;
}
const pull = (p) => sync.pull(as(p).ctx);
const push = (p) => sync.push(as(p).ctx);
/** The owner acts on `p` at its own clock. @param {any} p @param {() => void} fn */
const act = (p, fn) => {
  as(p);
  Date.now = p.now; // Playlists stamps `modified` with Date.now
  fn();
  world.t += 10;
};
const realNow = Date.now;

beforeEach(() => {
  world.t = NOW;
  worker = fakeWorker();
  Date.now = realNow;
});

test('the limits and the playlist id agree with the contract', () => {
  for (const [k, v] of Object.entries(sync.L)) assert.equal(v, MUSIC_SYNC_LIMITS[k], k);
  assert.equal(String(MUSIC_PLAYLIST_ID), '/^[a-z0-9]{4,40}$/');
});

test('a rating and a like: the newer wins both ways, on the phone and on the Worker', async () => {
  const a = phone(), b = phone(4, -5_000);
  await pull(a), await pull(b);
  // "Never play this again" on phone A: rated 1.
  act(a, () => a.library.setRating(a.song(1), 1));
  await push(a);
  await pull(b);
  assert.equal(b.song(1).rating, 1);
  const msg = b.posted.find(([m]) => m === 'msg_data_track_rating_changed');
  assert.equal(msg[1].synced, true, 'a rating from another phone is not sent back as a sense');
  // Later, phone B likes it: back on A.
  act(b, () => b.library.setRating(b.song(1), 5));
  await push(b);
  await pull(a);
  assert.equal(a.song(1).rating, 5);
  // A rates song 2 first, B rates it after (both offline); A pushes last: B's newer word wins on both.
  act(a, () => a.library.setRating(a.song(2), 2));
  act(b, () => b.library.setRating(b.song(2), 4));
  await push(b);
  await push(a);
  await pull(a), await pull(b);
  assert.equal(worker.marks.get(song(2)).rating, 4);
  assert.deepEqual([a.song(2).rating, b.song(2).rating], [4, 4]);
});

test('plays keep the larger count and the later time', async () => {
  const a = phone(), b = phone();
  await pull(a), await pull(b);
  act(a, () => [1, 2, 3].forEach(() => a.library.markPlayed(a.song(3))));
  act(b, () => b.library.markPlayed(b.song(3)));
  await push(a), await push(b);
  await pull(a), await pull(b);
  assert.deepEqual([a.song(3).plays, b.song(3).plays], [3, 3]);
  assert.equal(a.song(3).lastPlayed, b.song(3).lastPlayed);
});

test('a playlist rename: the newer wins both ways', async () => {
  const a = phone(), b = phone();
  await pull(a), await pull(b);
  let pl;
  act(a, () => {
    pl = a.ctx.playlists.create('Morning');
    a.ctx.playlists.add(pl, [a.song(1), a.song(2)]);
  });
  await push(a);
  await pull(b);
  assert.deepEqual(b.ctx.playlists.get(pl.id), { ...pl });
  act(b, () => b.ctx.playlists.rename(b.ctx.playlists.get(pl.id), 'Evening'));
  await push(b);
  await pull(a);
  assert.equal(a.ctx.playlists.get(pl.id).name, 'Evening');
  // Edited on both: A renames first, B reorders after; whichever pushes last, B's newer record wins.
  act(a, () => a.ctx.playlists.rename(a.ctx.playlists.get(pl.id), 'Old idea'));
  act(b, () => b.ctx.playlists.move(b.ctx.playlists.get(pl.id), 0, 1));
  await push(b), await push(a);
  await pull(a), await pull(b);
  for (const p of [a, b]) assert.deepEqual([p.ctx.playlists.get(pl.id).name, p.ctx.playlists.get(pl.id).ids], ['Evening', [song(2), song(1)]]);
});

test('a playlist delete: the newer wins both ways, and a deleted playlist does not come back', async () => {
  const a = phone(), b = phone();
  await pull(a), await pull(b);
  let pl;
  act(a, () => (pl = a.ctx.playlists.create('Short lived')));
  await push(a), await pull(b);
  // B renamed it earlier (offline), A deletes it later: deleted on both.
  act(b, () => b.ctx.playlists.rename(b.ctx.playlists.get(pl.id), 'Kept?'));
  act(a, () => a.ctx.playlists.remove(a.ctx.playlists.get(pl.id)));
  await push(a), await push(b);
  await pull(a), await pull(b);
  assert.equal(worker.lists.get(pl.id).deleted, true);
  assert.deepEqual([a.ctx.playlists.get(pl.id), b.ctx.playlists.get(pl.id)], [null, null]);
  assert.equal(b.state.has('pl:' + pl.id), false);
  // The other way: B deletes one, A renames it later: A's rename wins on both.
  let q;
  act(b, () => (q = b.ctx.playlists.create('Second')));
  await push(b), await pull(a);
  act(b, () => b.ctx.playlists.remove(b.ctx.playlists.get(q.id)));
  act(a, () => a.ctx.playlists.rename(a.ctx.playlists.get(q.id), 'Second, kept'));
  await push(b), await push(a);
  await pull(a), await pull(b);
  assert.deepEqual([a.ctx.playlists.get(q.id)?.name, b.ctx.playlists.get(q.id)?.name], ['Second, kept', 'Second, kept']);
});

test('a fresh phone gets everything: ratings, likes, plays and playlists', async () => {
  const a = phone();
  // What phone A had before the sync existed: no stamps, all sent by the first sync.
  Object.assign(a.song(1), { rating: 1 });
  Object.assign(a.song(2), { rating: 5, plays: 9, lastPlayed: NOW - 1000 });
  act(a, () => a.ctx.playlists.add(a.ctx.playlists.create('Mine'), [a.song(2)]));
  await pull(a), await push(a);
  const fresh = phone();
  await pull(fresh);
  assert.deepEqual(
    [fresh.song(1).rating, fresh.song(2).rating, fresh.song(2).plays, fresh.song(2).lastPlayed],
    [1, 5, 9, NOW - 1000],
  );
  assert.deepEqual(fresh.ctx.playlists.items.map((p) => [p.name, p.ids]), [['Mine', [song(2)]]]);
});

test('with nothing on the Worker, nothing in the library changes', async () => {
  const a = phone(6);
  Object.assign(a.song(1), { rating: 1 });
  Object.assign(a.song(4), { rating: 4, plays: 2, lastPlayed: NOW - 5000 });
  act(a, () => a.ctx.playlists.add(a.ctx.playlists.create('As it was'), [a.song(4), a.song(1)]));
  const before = JSON.stringify([a.library.tracks, a.ctx.playlists.items]);
  a.posted.length = 0;
  await pull(a);
  assert.equal(JSON.stringify([a.library.tracks, a.ctx.playlists.items]), before);
  assert.deepEqual(a.posted, []);
  // And what goes up changes nothing here either.
  await push(a);
  assert.equal(JSON.stringify([a.library.tracks, a.ctx.playlists.items]), before);
});

test('nothing goes up before a pull has come back; only catalog songs go up', async () => {
  const a = phone();
  a.library.byId.set('local-file-1', { id: 'local-file-1', rating: 5 });
  act(a, () => a.library.setRating(a.library.byId.get('local-file-1'), 5));
  await push(a);
  assert.equal(worker.requests.length, 0);
  await pull(a), await push(a);
  assert.equal(worker.marks.has('local-file-1'), false);
});

test('a change made while its push is on the way stays queued and goes up next time', async () => {
  const a = phone(), b = phone();
  await pull(a), await pull(b);
  let pl;
  act(a, () => {
    a.library.setRating(a.song(1), 2);
    pl = a.ctx.playlists.create('First name');
  });
  // While the songs' PUT is out, the owner rates song 1 again; while the playlists' PUT is out, renames it.
  worker.during = () => act(a, () => {
    a.library.setRating(a.song(1), 3);
    worker.during = () => act(a, () => a.ctx.playlists.rename(a.ctx.playlists.get(pl.id), 'Second name'));
  });
  await push(a);
  assert.equal(worker.marks.get(song(1)).rating, 2);
  assert.equal(worker.lists.get(pl.id).name, 'First name');
  await push(a);
  assert.equal(worker.marks.get(song(1)).rating, 3);
  assert.equal(worker.lists.get(pl.id).name, 'Second name');
  await pull(b);
  assert.deepEqual([b.song(1).rating, b.ctx.playlists.get(pl.id).name], [3, 'Second name']);
});

test('Reset stats is a record with its own time: the next pull does not undo it, and it reaches the other phone', async () => {
  const a = phone(), b = phone();
  await pull(a), await pull(b);
  act(a, () => [1, 2].forEach(() => a.library.markPlayed(a.song(1))));
  act(b, () => b.library.markPlayed(b.song(2)));
  await push(a), await push(b), await pull(a), await pull(b);
  assert.deepEqual([a.song(1).plays, b.song(1).plays, a.song(2).plays], [2, 2, 1]);
  act(a, () => a.library.resetStats());
  // Even a pull that asks for everything again, before the reset went up, does not bring them back.
  a.storage.setItem(sync.SYNC_KEY, JSON.stringify({ ...JSON.parse(a.storage.getItem(sync.SYNC_KEY)), marks: 1 }));
  await pull(a);
  assert.deepEqual([a.song(1).plays, a.song(2).plays], [0, 0], 'a pull before the reset went up does not bring the counts back');
  await push(a), await pull(a);
  assert.deepEqual([a.song(1).plays, a.song(2).plays], [0, 0]);
  // Phone B, which still had the old counts, takes the reset; its older plays never come back.
  await pull(b);
  assert.deepEqual([b.song(1).plays, b.song(2).plays], [0, 0]);
  await push(b), await pull(a);
  assert.deepEqual([a.song(1).plays, a.song(2).plays], [0, 0]);
  // Plays after the reset count again, on both.
  act(b, () => b.library.markPlayed(b.song(1)));
  await push(b), await pull(a);
  assert.equal(a.song(1).plays, 1);
});
