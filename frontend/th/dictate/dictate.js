// @ts-check
// Dictation (HOME.md §6.4, NEXT-BATCH.md part 8): hold the mic and the words appear in the bar as
// they are said; let go and they stay there to edit, then send. A tap still records a voice memo.
// The voice goes in pieces of at most 15 s to the Worker's own Whisper (POST /v1/dictate, the one
// that writes up voice memos; never Google's recogniser), which answers the words and keeps
// nothing. Each piece is its own recording, so each is a whole file: while it grows it goes again
// every 2 s for the words so far, and once more, whole, when it ends. The microphone is open only
// while the finger is down: letting go, leaving the page or the screen going off stops it
// (PRIVACY.md §7). Two minutes at most; under 0.6 s is thrown away.
import { DICTATE_LIMITS } from '../contract.js';

/** A press longer than this is a hold (dictation); a shorter one is a tap (a voice memo). */
export const HOLD_MS = 280;
/** How often the piece so far goes for its words. */
export const EVERY_MS = 2000;
/** A take shorter than this is thrown away. */
export const SHORT_MS = 600;
const PIECE_MS = DICTATE_LIMITS.piece_seconds * 1000;
const TAKE_MS = DICTATE_LIMITS.take_seconds * 1000;

/** The bar's text: what was typed before, then each piece's words, one space between.
 * @param {string} before @param {readonly string[]} pieces */
export function barText(before, pieces) {
  const said = pieces.map((p) => p.trim()).filter(Boolean).join(' ');
  if (!said) return before;
  if (!before.trim()) return said;
  return /\s$/.test(before) ? before + said : `${before} ${said}`;
}

/** Answers can come back out of order: a piece takes only an answer newer than the one it shows.
 * @param {number[]} shown the newest answer each piece shows @param {number} piece @param {number} seq */
export function takes(shown, piece, seq) {
  if (seq <= (shown[piece] ?? -1)) return false;
  shown[piece] = seq;
  return true;
}

/** @typedef {'listening' | 'finishing' | 'done'} State */
/** @typedef {{ hear: (audio: Blob) => Promise<string>, onWords: (pieces: readonly string[]) => void,
 *   onState: (s: State) => void, onEnd: (why: 'ok' | 'short' | 'deaf' | 'denied') => void }} Ears */

/** Starts listening; `stop()` (the finger lifted) may come before the microphone is even open.
 * @param {Ears} ears */
export function listen(ears) {
  /** @type {string[]} */
  const words = [];
  /** @type {number[]} */
  const shown = [];
  /** @type {Promise<unknown>[]} */
  const finals = [];
  let seq = 0;
  let live = false;
  let heardAny = false;
  let failed = 0;
  let stopping = false;
  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {{ rec: MediaRecorder, chunks: Blob[], i: number, at: number } | null} */
  let cur = null;
  let discard = false;
  let started = 0;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let tick;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let cap;
  let type = '';

  /** Sends audio for piece `i`; its answer shows if it is the newest for that piece.
   * @param {number} i @param {Blob} blob */
  const send = (i, blob) => {
    const n = seq++;
    return ears.hear(blob).then(
      (text) => {
        heardAny = true;
        if (takes(shown, i, n)) {
          words[i] = text;
          ears.onWords(words);
        }
      },
      () => void failed++,
    );
  };

  const piece = () => {
    if (!stream) return;
    const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : {});
    const p = { rec, chunks: /** @type {Blob[]} */ ([]), i: words.length, at: Date.now() };
    words.push('');
    rec.addEventListener('dataavailable', (e) => e.data.size && p.chunks.push(e.data));
    // Once a piece ends it goes whole, and its words are the ones kept.
    rec.addEventListener('stop', () => !discard && p.chunks.length && finals.push(send(p.i, new Blob(p.chunks, { type: rec.mimeType || type }))), { once: true });
    rec.start(250);
    cur = p;
  };

  const everyTick = () => {
    if (!cur || stopping) return;
    if (Date.now() - cur.at >= PIECE_MS) {
      // The next piece starts first, so no word falls between the two.
      const old = cur;
      piece();
      old.rec.stop();
      return;
    }
    if (live || !cur.chunks.length) return;
    live = true;
    const p = cur;
    send(p.i, new Blob(p.chunks, { type: p.rec.mimeType || type })).finally(() => (live = false));
  };

  const hidden = () => document.visibilityState === 'hidden' && stop();

  const open = (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      stopping = true;
      ears.onState('done');
      ears.onEnd('denied');
      return false;
    }
    if (stopping) {
      for (const t of stream.getTracks()) t.stop();
      ears.onState('done');
      ears.onEnd('short');
      return false;
    }
    type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    started = Date.now();
    piece();
    ears.onState('listening');
    navigator.vibrate?.(18);
    tick = setInterval(everyTick, EVERY_MS);
    cap = setTimeout(() => {
      navigator.vibrate?.(8);
      stop();
    }, TAKE_MS);
    document.addEventListener('visibilitychange', hidden);
    return true;
  })();

  async function stop() {
    if (stopping) return;
    stopping = true;
    if (!(await open)) return;
    clearInterval(tick);
    clearTimeout(cap);
    document.removeEventListener('visibilitychange', hidden);
    const short = Date.now() - started < SHORT_MS;
    const last = cur;
    if (last) {
      discard = short; // a slip of the finger: nothing goes
      const ended = new Promise((r) => last.rec.addEventListener('stop', r, { once: true }));
      last.rec.stop();
      await ended;
    }
    for (const t of stream?.getTracks() ?? []) t.stop();
    if (short) {
      ears.onState('done');
      return ears.onEnd('short');
    }
    ears.onState('finishing');
    await Promise.allSettled(finals);
    ears.onState('done');
    ears.onEnd(heardAny || !failed ? 'ok' : 'deaf');
  }

  return { stop };
}
