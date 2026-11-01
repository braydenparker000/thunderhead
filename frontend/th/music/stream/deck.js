// @ts-check
// One deck of Music's player, streamed (NEXT-BATCH.md part 2; MUSIC.md §5): the player's decks stay as
// they are (its cross-fades, gapless joins, the lock screen and the AirPods all work as before), but a
// deck playing a song from the network gets it through the stream feed instead of `src`: it starts
// from the first bytes (the song heads the worker keeps, so at once), holds at most 60 s ahead, and
// never asks for the whole file. The song starts at the element's time 0, so the player's own
// position, length, seeks and end are the song's. Every move of the deck's position (the player's
// seeks, a reload or a restored place, from wherever it sets `currentTime`) goes through here: before
// the song streams it is where it starts; after, inside the buffer the element moves itself, outside
// it the feed fetches from there, and a later move wins over one still on its way. A deck the player
// isn't going to play yet ('none') waits for its first play before it fetches anything. The feed's
// exact length (at its end of stream) corrects the catalog's (onLength). On any trouble the feed gives
// up (`fallback`) and the player goes back to the plain element for that song.
import { covered, supported } from './buffer.js';
import { StreamFeed } from './feed.js';

const OFF = 'th.music.stream';

/** Whether this song can play through the feed here: Opus from the network, a known length, not a
 * part of a longer file, and streaming not switched off on this phone (`th.music.stream` = 'off').
 * @param {any} t the player's track @param {string} url */
export function streamable(t, url) {
  let off = false;
  try {
    off = localStorage.getItem(OFF) === 'off';
  } catch {}
  return (
    !off &&
    supported() &&
    /^https?:/.test(url) &&
    t?.format === 'OPUS' &&
    !t.video &&
    !t.startMs &&
    !t.endMs &&
    Number(t.durationMs) > 0
  );
}

const TIME = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime'));

/**
 * Streams `url` (the song `t`) into the deck `el`. `before`: waited for before the first read (the
 * song's head finishing its download, so the start comes from the phone).
 * @param {HTMLAudioElement} el @param {string} url @param {any} t
 * @param {{ lazy?: boolean, before?: (() => Promise<unknown>) | null, onFallback: (d: { reason: string, ms: number }) => void, onLength?: (s: number) => void, log?: (type: string, data: object) => void }} o
 */
export function streamInto(el, url, t, o) {
  const feed = new StreamFeed(el);
  const track = { id: String(t.id), url: () => url, bytes: Number(t.size) || undefined, durationMs: Number(t.durationMs) || undefined };
  let asked = false;
  let loaded = false;
  let open = false;
  let dead = false;
  /** Until its first play (a lazy deck), nothing is fetched. */
  let waiting = !!o.lazy;
  /** Where to start, in ms (the player's position before the song streams). */
  let want = 0;
  // The deck's position, from here on (deleted again by destroy).
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => (loaded || !want ? TIME.get?.call(el) : want / 1000),
    set: (/** @type {number} */ v) => {
      const s = Math.max(0, Number(v) || 0);
      if (feed.moving) TIME.set?.call(el, s);
      else if (!loaded) want = s * 1000;
      else if (feed.seekTo === null && feed.sb && covered(feed.sb, s)) TIME.set?.call(el, s);
      else if (feed.seekTo === null || Math.abs(feed.seekTo - s) > 0.001) feed.seek(s * 1000);
    },
  });
  const start = () => {
    if (asked || !open || waiting) return;
    asked = true;
    // (A seek meanwhile moves where it starts.)
    const go = () => {
      if (dead) return;
      loaded = true;
      feed.load([track], { index: 0, ms: want, at: 0 });
    };
    if (o.before) o.before().then(go, go);
    else go();
  };
  feed.ready.then(
    () => {
      open = true;
      // The song's length from the catalog, so the player's time left and the lock screen are right
      // before the last bytes arrive (the feed's end of stream then sets the exact length).
      try {
        const s = (track.durationMs ?? 0) / 1000;
        if (s > 0 && feed.ms?.readyState === 'open' && !(feed.ms.duration > 0)) feed.ms.duration = s;
      } catch {}
      start();
    },
    () => {},
  );
  const onPlay = () => {
    waiting = false;
    start();
  };
  // The exact length, once the feed has read the song's end (the catalog's is close, not exact).
  const onLength = () => {
    if (loaded && Number.isFinite(el.duration) && el.duration > 0) o.onLength?.(el.duration);
  };
  el.addEventListener('play', onPlay);
  el.addEventListener('durationchange', onLength);
  feed.addEventListener('fallback', (e) => {
    const d = /** @type {CustomEvent} */ (e).detail ?? {};
    o.log?.('stream fallback', { track: track.id, reason: String(d.reason ?? 'unknown') });
    o.onFallback({ reason: String(d.reason ?? 'unknown'), ms: Number(d.ms) || 0 });
  });
  feed.addEventListener('stall', () => o.log?.('stream stall', { track: track.id }));
  return {
    feed,
    destroy() {
      dead = true;
      el.removeEventListener('play', onPlay);
      el.removeEventListener('durationchange', onLength);
      delete (/** @type {any} */ (el).currentTime);
      feed.destroy();
    },
  };
}
