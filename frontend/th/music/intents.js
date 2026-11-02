// @ts-check
// Music's pending intents (API.md §11.11 "Pending intents"; MUSIC.md §10.2): the verbs the mind
// queued for what lives in the player, its queue and its ratings, applied when Music opens (and when
// it comes back into view), through the player's own operations, so the Queue sheet, the heart and
// Music's own `music.rate` sense follow as if the owner had done it. Each returns its inverse:
// - `music.queue` adds to the Queue (next, or at the end), the songs this library holds; its undo
//   `music.unqueue` takes them back out where they haven't played;
// - `music.play_mix` makes the songs the queue, loaded and paused (sound waits for the owner's own
//   gesture, MUSIC.md §10.3); its undo is the queue before (its first 500 songs and the place);
// - `music.rate` rates a song only while the owner hasn't (`owner_rated`); its undo `music.unrate`
//   clears it while it is still the rating set (`owner_edited`).
// Loaded by th/music/dj.js `installDj`, which the player runs. The plumbing is th/ported/intents.js.
import { applyIntents, workerIo } from '../ported/intents.js';

/** @typedef {{ id: string, rating?: number }} Track */
/** @typedef {{ player: any, library: any }} Music */

/** The Worker's song ids (shared/contract/verbs.ts): a local file in the library has none. */
const SONG_ID = /^r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
/** Songs an undo restores at most (PLAY_MAX in shared/contract/verbs.ts). */
export const PLAY_MAX = 500;
/** How long Music waits for its library before applying (the songs must be there to queue). */
const LIBRARY_WAIT_MS = 30_000;
/** How often Music looks again while it is in view: one small read a minute (the open verbs). */
const LOOK_MS = 60_000;

const idOf = (/** @type {string} */ ref) => ref.slice('music:'.length);
/** @param {any} library @param {string} ref @returns {Track | null} */
const trackOf = (library, ref) => library?.byId?.get(idOf(ref)) ?? null;
const refsOf = (/** @type {Track[]} */ tracks) => tracks.map((t) => `music:${t.id}`);

/** @type {import('../ported/intents.js').Executors<Music>} */
export const EXECUTORS = {
  'music.queue': {
    1: async ({ player, library }, { refs, at }) => {
      const tracks = /** @type {Track[]} */ (refs.map((/** @type {string} */ r) => trackOf(library, r)).filter(Boolean));
      if (tracks.length) player.enqueue(tracks, at === 'next');
      const result = { queued: tracks.length, missing: refs.length - tracks.length };
      return tracks.length
        ? { ok: true, result, undo: { verb: 'music.unqueue', schema: 1, args: { refs: refsOf(tracks) } } }
        : { ok: true, result };
    },
  },
  'music.unqueue': {
    1: async ({ player }, { refs }) => {
      const entries = /** @type {{ track?: Track, played?: boolean }[]} */ (player.entries ?? []);
      const playing = player.queueMode ? entries[player.index] : null;
      let removed = 0;
      // Each song once, the newest entry of it first: the one the queue verb added.
      for (const ref of refs) {
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          if (e === playing || e.played || e.track?.id !== idOf(ref)) continue;
          entries.splice(i, 1);
          removed++;
          break;
        }
      }
      if (removed) player.queueUpdated?.(false);
      return { ok: true, result: { removed } };
    },
  },
  'music.play_mix': {
    1: async ({ player, library }, { refs, index }) => {
      const tracks = /** @type {Track[]} */ ((refs ?? []).map((/** @type {string} */ r) => trackOf(library, r)).filter(Boolean));
      if (!tracks.length) return { ok: false, error: { code: 'no_songs', message: 'none of these songs is in this library' } };
      // The queue before, as songs the Worker can name, and where it was.
      const was = /** @type {Track[]} */ (player.queue ?? []).filter((t) => typeof t?.id === 'string' && SONG_ID.test(t.id));
      const before = was.slice(0, PLAY_MAX);
      const at = before.indexOf(player.track);
      player.setQueue(tracks, Math.min(Math.max(0, index ?? 0), tracks.length - 1), null, false);
      const result = { tracks: tracks.length, started: false };
      return before.length
        ? { ok: true, result, undo: { verb: 'music.play_mix', schema: 1, args: { refs: refsOf(before), index: Math.max(0, at) } } }
        : { ok: true, result };
    },
  },
  'music.rate': {
    1: async ({ library }, { ref, rating }) => {
      const t = trackOf(library, ref);
      if (!t) return { ok: false, error: { code: 'not_in_library' } };
      // The owner's rating stays theirs: the mind rates only a song they haven't.
      if (Number(t.rating) > 0) return { ok: false, error: { code: 'owner_rated' } };
      library.setRating(t, rating);
      return { ok: true, result: { previous: 0 }, undo: { verb: 'music.unrate', schema: 1, args: { ref, rating } } };
    },
  },
  'music.unrate': {
    1: async ({ library }, { ref, rating }) => {
      const t = trackOf(library, ref);
      if (!t || !(Number(t.rating) > 0)) return { ok: true, result: {} };
      if (Number(t.rating) !== rating) return { ok: false, error: { code: 'owner_edited', message: 'the owner has rated it since' } };
      library.setRating(t, 0);
      return { ok: true, result: {} };
    },
  },
};

/** Applies Music's pending intents once its library has songs; again whenever Music comes back
 * into view, and every LOOK_MS while it is in view (Music playing as home's island stays in view,
 * so a song queued from the chat joins within a minute). Never throws.
 * @param {any} ctx the player's context (its library) @param {any} player */
export function installIntents(ctx, player) {
  let busy = false;
  const go = async () => {
    if (busy || !ctx.library?.byId?.size) return;
    busy = true;
    try {
      const io = await workerIo('music');
      if (io) await (await applyIntents(EXECUTORS, { player, library: ctx.library }, io)).send();
    } catch {
      // The next open, or the next time Music is in view, tries again.
    } finally {
      busy = false;
    }
  };
  const start = Date.now();
  const wait = setInterval(() => {
    if (ctx.library?.byId?.size || Date.now() - start > LIBRARY_WAIT_MS) {
      clearInterval(wait);
      void go();
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void go();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void go();
  }, LOOK_MS);
}
