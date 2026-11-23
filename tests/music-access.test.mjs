// Music when it can't reach the owner's songs (frontend/music/src/library/access.js): signed out, it
// says so and Play goes to sign-in, until a new session is on the phone; with no library after a
// failure, it says so and Play, the connection back or a slow timer try again. Node, with stand-ins.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/site-imports.mjs';

const { Access, WORDS } = await import('../frontend/music/src/library/access.js');

function setup({ tracks = [], error = null, token = 'old' } = {}) {
  const posts = [];
  const ctx = { bus: { post: (bus, msg, src, d) => posts.push([msg, d]) } };
  const library = { tracks, r2Error: error, refreshs: 0, async refreshR2() { this.refreshs++; } };
  const player = { playing: true, track: tracks[0] ?? null, paused: 0, guard: { timer: 0, pending: false }, pause() { this.paused++; this.playing = false; } };
  const deps = { token: async () => deps.now, now: token, signIns: 0, signIn: () => deps.signIns++, hidden: () => false };
  const access = new Access(ctx, player, library, deps);
  return { ctx, library, player, deps, access, posts };
}
const turn = async () => { for (let i = 0; i < 10; i++) await null; };

test('no library and a 401: the sign-in words, Play goes to sign-in, and a new session loads the library', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { library, deps, access, posts } = setup({ error: { status: 401 } });
    access.checkLibrary();
    await turn();
    assert.equal(access.state, 'signin');
    assert.equal(posts[0][1].title, WORDS.signin.title);
    assert.equal(access.onPlay(), true);
    assert.equal(deps.signIns, 1);
    mock.timers.tick(3000); await turn();
    assert.equal(access.state, 'signin', 'the same session: still signed out');
    deps.now = 'new';
    library.r2Error = null;
    mock.timers.tick(3000); await turn();
    assert.equal(access.state, null);
    assert.equal(library.refreshs, 1, 'the library is asked for again');
    assert.equal(posts.at(-1)[0], 'cmd_gui_close_toast');
  } finally {
    mock.timers.reset();
  }
});

test('a song refused mid-library: the player stops where it was, with Play waiting to reload it', async () => {
  const { player, access } = setup({ tracks: [{ id: 'a', src: 'https://x.test/a' }] });
  player.guard.timer = 7;
  access.signedOut();
  await turn();
  assert.equal(player.paused, 1);
  assert.equal(player.guard.pending, true);
  assert.equal(access.state, 'signin');
  access.clear();
});

test('no library after a failure: the words, Play tries again, and so does a slow timer (the connection back: the browser test)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { library, access, posts } = setup({ error: { status: 500 } });
    access.checkLibrary();
    assert.equal(access.state, 'failed');
    assert.equal(posts[0][1].title, WORDS.failed.title);
    assert.equal(access.onPlay(), true);
    await turn();
    assert.equal(library.refreshs, 1);
    library.r2Error = null;
    library.tracks = [{ id: 'a' }];
    mock.timers.tick(600_000); await turn();
    assert.equal(access.state, null, 'the slow timer tried again, and it came');
  } finally {
    mock.timers.reset();
  }
});

test('a library already on the phone says nothing at the open, as before', () => {
  const { access, posts } = setup({ tracks: [{ id: 'a' }], error: { status: 500 } });
  access.checkLibrary();
  assert.equal(access.state, null);
  assert.deepEqual(posts, []);
});
