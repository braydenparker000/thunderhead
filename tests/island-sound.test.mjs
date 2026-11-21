// frontend/th/island/island.js with Music and Podcasts as fakes in home's layer: one sound at a time
// (PODCASTS.md rule 1), the one starting pausing the other through its own pause call; and the island's
// play on Podcasts goes through the app's own togglePlay (which loads a restored episode's audio) and
// answers with what really happened, so the chat never says "Playing." over silence. No page.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
const island = await import('../frontend/th/island/island.js');
const { frames } = await import('../frontend/th/island/frames.js');

/** A media element: an EventTarget with `paused`, as the players use it. */
function deck() {
  const el = new EventTarget();
  Object.assign(el, { paused: true, ended: false, currentTime: 0, duration: 600 });
  el.play = () => { el.paused = false; el.dispatchEvent(new Event('play')); return Promise.resolve(); };
  el.pause = () => { el.paused = true; };
  return el;
}
let music, podcasts, calls;
beforeEach(() => {
  calls = [];
  frames.clear();
  const decks = [deck(), deck()];
  const player = { decks, audio: decks[0], pause() { calls.push('music.pause'); decks[0].pause(); }, play() { decks[0].play(); } };
  music = { id: 'music', frame: { contentWindow: { __cp: { player } } } };
  const audio = deck();
  const app = {
    togglePlay: async () => { calls.push('podcasts.togglePlay'); },
    skip: (n) => calls.push(`podcasts.skip ${n}`),
    pause: () => { calls.push('podcasts.pause'); audio.pause(); },
  };
  podcasts = { id: 'podcasts', frame: { contentWindow: { document: { querySelectorAll: () => [audio], querySelector: () => audio }, __podcasts: app } }, audio, app };
  frames.set('music', /** @type {any} */ (music));
  frames.set('podcasts', /** @type {any} */ (podcasts));
  island.oneSound(/** @type {any} */ (music), music.frame.contentWindow);
  island.oneSound(/** @type {any} */ (podcasts), podcasts.frame.contentWindow);
  island.st.layer = /** @type {any} */ (podcasts);
});

test('Podcasts starting pauses Music through its own pause', () => {
  music.frame.contentWindow.__cp.player.play();
  assert.deepEqual(calls, ['podcasts.pause'], 'Music starting asks Podcasts to pause');
  calls = [];
  podcasts.audio.play();
  assert.deepEqual(calls, ['music.pause']);
  assert.equal(music.frame.contentWindow.__cp.player.audio.paused, true);
});

test('Music starting on its other deck pauses Podcasts; a quiet Music is left alone', () => {
  podcasts.audio.play();
  assert.deepEqual(calls, [], 'Music was not playing: no pause call');
  music.frame.contentWindow.__cp.player.decks[1].play();
  assert.deepEqual(calls, ['podcasts.pause']);
  assert.equal(podcasts.audio.paused, true);
});

test('the island’s play on a restored episode that does not start says so', async () => {
  const r = island.control('play');
  assert.notEqual(r.text, 'Playing.');
  assert.deepEqual(await r.outcome, { ok: false, text: "Podcasts didn't start. Open it and tap Play." });
  assert.deepEqual(calls, ['podcasts.togglePlay'], 'through the app’s own togglePlay');
});

test('the island’s play answers "Playing." once the app really plays; skips go through the app', async () => {
  podcasts.app.togglePlay = async () => { calls.push('podcasts.togglePlay'); podcasts.audio.paused = false; };
  const r = island.control('play');
  assert.deepEqual(await r.outcome, { ok: true, text: 'Playing.' });
  assert.deepEqual(island.control('play'), { ok: true, text: 'Playing.' }, 'already playing: no second call');
  island.control('next');
  island.control('previous');
  assert.deepEqual(calls, ['podcasts.togglePlay', 'podcasts.skip 30', 'podcasts.skip -15']);
});
