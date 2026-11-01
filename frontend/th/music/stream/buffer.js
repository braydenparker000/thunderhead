// @ts-check
// The streaming feeder's one SourceBuffer (feed.js; MUSIC.md §5): open it on the element, run a job
// on it and wait for its `updateend`, append (a full buffer drops what lies behind and tries once
// more), remove, and read what is buffered around the play position.

import { StreamError } from './track.js';

export const MIME = 'audio/webm; codecs="opus"';

/** Whether this browser can play the path at all. */
export const supported = () => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MIME);

/** A MediaSource on `audio` with its one SourceBuffer. @param {HTMLMediaElement} audio */
export async function openSource(audio) {
  if (!supported()) throw new StreamError('unsupported');
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  audio.src = url;
  await new Promise((resolve) => ms.addEventListener('sourceopen', resolve, { once: true }));
  return { ms, sb: ms.addSourceBuffer(MIME), url };
}

/** Starts a job on `sb` and waits for its end. @param {SourceBuffer} sb @param {() => void} start @returns {Promise<void>} */
export function settle(sb, start) {
  return new Promise((resolve, reject) => {
    const done = () => (off(), resolve());
    const bad = () => (off(), reject(new StreamError('append')));
    const off = () => (sb.removeEventListener('updateend', done), sb.removeEventListener('error', bad));
    sb.addEventListener('updateend', done);
    sb.addEventListener('error', bad);
    try {
      start();
    } catch (e) {
      off();
      reject(e);
    }
  });
}

/** @param {MediaSource} ms @param {SourceBuffer} sb @param {number} from @param {number} to */
export async function remove(ms, sb, from, to) {
  if (ms.readyState === 'closed' || !sb.buffered.length || to <= from) return;
  await settle(sb, () => sb.remove(from, to));
}

/** @param {MediaSource} ms @param {SourceBuffer} sb @param {Uint8Array} bytes @param {number} now the play position (s) */
export async function append(ms, sb, bytes, now) {
  const data = /** @type {BufferSource} */ (bytes);
  try {
    await settle(sb, () => sb.appendBuffer(data));
  } catch (e) {
    if (/** @type {Error} */ (e).name !== 'QuotaExceededError') throw e;
    // Full: drop all but the last 2 s behind, then once more.
    if (sb.buffered.length && now - 2 > sb.buffered.start(0)) await remove(ms, sb, 0, now - 2);
    await settle(sb, () => sb.appendBuffer(data));
  }
}

/** Whether `t` (s) is buffered. @param {SourceBuffer | null} sb @param {number} t */
export function covered(sb, t) {
  const b = sb?.buffered;
  if (!b) return false;
  for (let i = 0; i < b.length; i++) if (t >= b.start(i) && t < b.end(i)) return true;
  return false;
}

/** Seconds buffered ahead of `t`. @param {SourceBuffer | null} sb @param {number} t */
export function aheadOf(sb, t) {
  const b = sb?.buffered;
  if (!b) return 0;
  for (let i = 0; i < b.length; i++) if (t >= b.start(i) - 0.001 && t < b.end(i)) return b.end(i) - t;
  return 0;
}
