// @ts-check
// The streaming feeder's decisions without the page (feed.js; MUSIC.md §5, NEXT-BATCH.md part 2):
// how many bytes to ask for next under the 15 s cap (stop at the cap, start again under 10 s), how
// much to append now, and the OpusHead the init segment carries. tests/music-stream-track.test.mjs.

import { RATE } from './ogg.js';

/** At most this much is buffered ahead of the play position (owner, NEXT-BATCH.md part 2). */
export const CAP_S = 15;
/** Once at the cap, fetching starts again only when less than this is buffered ahead. */
export const RESUME_S = 10;
/** What lies further behind the play position is removed. */
export const BEHIND_S = 10;
/** The first request of a song (no byte rate known yet), then 32–128 KB sized to the room left. */
export const CHUNK_FIRST = 64 * 1024;
export const CHUNK_MIN = 32 * 1024;
export const CHUNK_MAX = 128 * 1024;
/** Samples in one appended Cluster (its blocks' times are 16-bit ms from the cluster's). */
export const CLUSTER_MAX = 5 * RATE;
/** Once a couple of seconds are buffered, appends wait until this much fits (not a sliver a timeupdate). */
export const APPEND_MIN = 2 * RATE;

/**
 * Bytes to ask for next (0: wait) and whether the buffer now counts as full.
 * @param {{ ahead: number, queued: number, full: boolean, bytesPerSecond: number, head: boolean, capS?: number, resumeS?: number }} o
 *   `ahead`: seconds appended ahead of the play position; `queued`: seconds read but not appended
 */
export function nextFetch({ ahead, queued, full, bytesPerSecond, head, capS = CAP_S, resumeS = RESUME_S }) {
  if ((full && ahead >= resumeS) || ahead + queued >= capS - 0.05) return { bytes: 0, full: true };
  const want = (capS - ahead - queued) * bytesPerSecond;
  return { bytes: head ? Math.round(Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, want))) : CHUNK_FIRST, full: false };
}

/**
 * Samples that may be appended now (0: wait).
 * @param {{ now: number, appended: number, done: boolean, queued: number, capS?: number }} o `now`: the
 *   play position (s); `appended`: the timeline sample where appended data ends; `done`: the song is
 *   all read; `queued`: its samples read but not appended
 */
export function appendRoom({ now, appended, done, queued, capS = CAP_S }) {
  const room = Math.floor((now + capS) * RATE) - appended;
  if (appended / RATE - now > 2 && room < APPEND_MIN && !(done && queued <= room)) return 0;
  return Math.max(0, Math.min(room, CLUSTER_MAX));
}

/**
 * The OpusHead as the init segment carries it: pre-skip 0. Chromium's decoder drops the head's
 * pre-skip itself whenever it starts afresh, which at a join happens only when the next song's head
 * differs, so the feeder's append window does all the trimming instead (feed.js).
 * @param {{ bytes: Uint8Array }} head
 */
export function headForMse(head) {
  const b = head.bytes.slice();
  b[10] = 0;
  b[11] = 0;
  return b;
}
