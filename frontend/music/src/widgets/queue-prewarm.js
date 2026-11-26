// Up next's and History's lists and a window of their rows made in idle time after start (view/idle-work.js,
// like the library's spare rows: PowerList.prewarm): their first opens made them, 220–340 ms on a slow phone.
import {idleWork} from '../view/idle-work.js';

// Rows per window: a window's height of songs, its subheads and its quiet line.
const ROWS = [{track: 14, separator: 3, queueEmpty: 1}, {track: 14, queueEmpty: 1}];

/** contents: the windows' contents, made (and kept) when asked (up-next.js windowContent). */
export function prewarmWindows(ctx, contents) {
  if (!globalThis.requestIdleCallback) return;
  // A piece makes the window's list; then its rows, a row a step (PowerList.spareSteps).
  idleWork(ctx, 'spare-rows', contents.flatMap((content, i) => [() => { content(); }, ...Object.entries(ROWS[i]).map(([type, n]) => () => content().list.spareSteps(type, n))]));
}
