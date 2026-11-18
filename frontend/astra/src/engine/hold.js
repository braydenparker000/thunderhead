// How much of a film Astra holds at once, in bytes as well as in seconds. A film of a few Mbit/s is held by
// time: the pipelines read 40 s ahead of the playhead (remux.js; 20 with the data saver), the browser's buffer
// keeps 20 s behind it (mse.js) and the reader's cache keeps 80 s of the film (source-tuning.js). On a 25 Mbit/s
// film those seconds are 125 MB ahead in the browser's buffer, which then sits at its own limit (about 150 MB of
// video in Chrome, which drops what is behind the playhead to make room), the film's last 96 MiB again in the
// cache, and copies of both on their way to the garbage collector: measured 2026-11-18 (scripts/astra/real.mjs),
// a page of about 600 MB. So each is held to bytes too, by the film's average bitrate (the reader's `byteRate`):
// - the pipelines to HOLD.ahead past the playhead (15 s at 25 Mbit/s), never under `minAhead` seconds;
// - the browser's buffer behind the playhead to HOLD.behind (7 s at 25 Mbit/s), never under `minBehind`;
// - the cache to HOLD.cache, or to what reading needs when that is more: the reach and the sound read up to
//   `trail` seconds behind the picture. Its 30 s back-seek is never whole at such a bitrate anyway.
// A film under about 5 Mbit/s is held as it was; up to about 10 Mbit/s only its cache is smaller.

export const HOLD = {ahead: 48 << 20, behind: 24 << 20, cache: 48 << 20, minAhead: 10, minBehind: 4, trail: 4};

/** Seconds the pipelines read past the playhead: `seconds`, or as many as HOLD.ahead bytes of the film last. */
export const aheadSeconds = (seconds, byteRate) => byteRate > 0 ? Math.min(seconds, Math.max(HOLD.minAhead, HOLD.ahead / byteRate)) : seconds;

/** Seconds of played film the browser's buffer keeps: `seconds`, or as many as HOLD.behind bytes last. */
export const behindSeconds = (seconds, byteRate) => byteRate > 0 ? Math.min(seconds, Math.max(HOLD.minBehind, HOLD.behind / byteRate)) : seconds;

/** The most bytes the reader's cache needs to keep for a download reaching `reach` bytes ahead. */
export const cacheBytes = (reach, byteRate) => Math.max(HOLD.cache, reach + HOLD.trail * (byteRate || 0));
