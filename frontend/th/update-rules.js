// @ts-check
// When the shell may apply a waiting service worker (ARCHITECTURE.md §8.3), without the DOM, so
// node tests can check it. The DOM side is th/update.js.

/** The shell asks the worker for an update at most this often (on becoming visible). */
export const CHECK_EVERY_MS = 60 * 60 * 1000;
/** While an update waits, the shell looks for a safe moment this often. */
export const RETRY_MS = 5000;
/** The fade before the reload. */
export const FADE_MS = 150;

/**
 * @typedef {object} ShellState
 * @property {boolean} visible  the page is in the foreground
 * @property {boolean} playing  some audio or video is playing
 * @property {boolean} typing   the ask bar holds text, or a text field has focus
 * @property {boolean} overlay  a sheet, the menu, the ring or a settings page is open
 * @property {boolean} [written] the ask bar, or the field with focus, holds text
 * @property {boolean} [busy]    something the owner is making or reading that a reload would lose: a voice
 *   memo recording, files (or a stopped memo) picked and not sent, dictation, the Remind sheet, an old
 *   conversation, or a place other than home (the Briefing)
 */

/** A safe moment: nothing playing, nothing typed, nothing open or under way, the owner looking at the page.
 * @param {ShellState} s */
export function safeToApply(s) {
  return s.visible && !s.playing && !s.typing && !s.overlay && !s.busy;
}

/** The page has gone out of view, the safest moment: the same, except that the owner need not be looking and
 * a field with focus but no text holds nothing to lose. @param {ShellState} s */
export function safeWhenHidden(s) {
  return !s.playing && !s.written && !s.overlay && !s.busy;
}

/** Whichever of the two the page's view calls for. @param {ShellState} s */
export const safeNow = (s) => (s.visible ? safeToApply(s) : safeWhenHidden(s));

/** Whether to ask the browser for a new worker now. @param {number} lastCheck @param {number} now */
export function checkDue(lastCheck, now) {
  return now - lastCheck >= CHECK_EVERY_MS;
}

/** The menu line for "Check for update" (COPY.md `set.about.update`).
 * @param {'checking' | 'current' | 'waiting' | 'unsupported'} state */
export function updateLine(state) {
  return { checking: 'Checking…', current: 'Up to date', waiting: "Updating when it's safe", unsupported: 'Updates come with each visit' }[state];
}
