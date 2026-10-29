// The Memory page's Forget (MEMORY.md §12): asked once, the fact leaves the page at once, and the
// request goes after a 10 s Undo. It has to reach the Worker however the page ends:
// - the id (never the text) is kept in this phone's storage until the Worker has it
//   (memory-queue.js), and what is left goes again on the next open of this page or Home;
// - leaving the page, or the page going to the background, sends what waits at once with a
//   keepalive fetch started inside that event (the token is read when the page opens, because
//   nothing can be awaited while a page unloads), and its Undo goes with it;
// - a send that fails for the network or the server waits and is tried again with back-off
//   ("Not forgotten yet. I'll keep trying."); any other refusal puts the fact back, with its line.
// A fact stays off the page until its Forget went through, so it never flashes back.
import { signedIn } from '/th/client.js';
import { failure } from '/th/flow.js';
import { store } from '/th/session.js';
import { el, toast } from '/th/ui.js';
import { confirmForget, memoryLine } from './memory-facts.js';
import { gone, pendingIds, remember, sendForget, settled } from './memory-queue.js';

const UNDO_MS = 10_000;
const RETRY_MS = [5_000, 15_000, 60_000, 300_000];
export const NOT_YET = "Not forgotten yet. I'll keep trying.";

/** A failure worth trying again: no network, a timeout, the server, or a rate limit. */
const transient = (/** @type {unknown} */ e) => {
  const f = failure(e);
  return f.kind !== 'api' || f.status >= 500 || f.status === 429;
};

/**
 * @param {{ changed: () => void, done: () => void }} on `changed`: which facts are hidden changed
 *   (re-render); `done`: a Forget went through (reload).
 */
export async function forgets(on) {
  /** id → its Undo window (`undo`), its retry timer and how many tries failed. */
  /** @type {Map<string, { undo: boolean, timer?: ReturnType<typeof setTimeout>, tries: number }>} */
  const waiting = new Map();
  const token = (await store.read())?.token ?? null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let undoHide;
  /** The page closed: no more retries here (the stored ids go on the next open), no redraws. */
  let closed = false;

  const finished = (/** @type {string} */ id) => {
    clearTimeout(waiting.get(id)?.timer);
    waiting.delete(id);
    settled(id);
    if (!closed) on.done();
  };

  async function send(/** @type {string} */ id) {
    const w = waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    w.undo = false;
    try {
      await signedIn((t) => sendForget(t, id, false));
      finished(id);
    } catch (e) {
      if (gone(e)) return finished(id);
      if (!transient(e)) {
        // Refused for good: the fact is still there, so it shows again, with the reason.
        waiting.delete(id);
        settled(id);
        if (!closed) on.changed();
        return toast(memoryLine(e));
      }
      later(id);
      toast(NOT_YET);
    }
  }

  /** Tries again after the next back-off step, while the page is open. */
  function later(/** @type {string} */ id) {
    const w = waiting.get(id);
    if (!w || closed) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => send(id), RETRY_MS[Math.min(w.tries++, RETRY_MS.length - 1)]);
  }

  /** The page is going away or out of sight: everything waiting goes now, with keepalive. */
  function flush() {
    hideUndo();
    for (const [id, w] of waiting) {
      clearTimeout(w.timer);
      w.undo = false;
      if (!token) {
        later(id); // signed out when the page opened: the retry signs in first
        continue;
      }
      sendForget(token, id, true).then(
        () => finished(id),
        (e) => (gone(e) ? finished(id) : later(id)),
      );
    }
  }

  function hideUndo() {
    clearTimeout(undoHide);
    document.querySelector('.utoast')?.classList.remove('show');
  }

  /** The toast with an Undo button (COPY.md `toast.forgotten`), one at a time, in one live region;
   * a second Forget takes it over for its own full 10 s. */
  function undoToast(/** @type {string} */ id) {
    let t = document.querySelector('.utoast');
    if (!t) {
      t = el('div', { class: 'toast utoast', role: 'status', 'aria-live': 'polite' });
      document.body.append(t);
    }
    const undo = el('button', { type: 'button', class: 'uundo', text: 'Undo' });
    t.replaceChildren(el('span', { text: 'Forgotten.' }), undo);
    t.classList.add('show');
    clearTimeout(undoHide);
    undoHide = setTimeout(hideUndo, UNDO_MS);
    undo.addEventListener(
      'click',
      () => {
        const w = waiting.get(id);
        hideUndo();
        if (!w?.undo) return; // already sent: nothing to take back
        clearTimeout(w.timer);
        waiting.delete(id);
        settled(id);
        on.changed();
      },
      { once: true },
    );
  }

  /** Asks once; then the fact leaves the page and its Forget waits out the Undo. @param {{ id: string }} f */
  async function ask(f) {
    if (!(await confirmForget())) return false;
    remember(f.id);
    waiting.set(f.id, { undo: true, tries: 0, timer: setTimeout(() => send(f.id), UNDO_MS) });
    undoToast(f.id);
    on.changed();
    return true;
  }

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const onOnline = () => {
    for (const [id, w] of waiting) if (!w.undo) send(id);
  };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide);
  addEventListener('online', onOnline);
  // What an earlier visit left (the page closed before the Worker answered) goes now.
  for (const id of pendingIds())
    if (!waiting.has(id)) {
      waiting.set(id, { undo: false, tries: 0 });
      send(id);
    }

  return {
    has: (/** @type {string} */ id) => waiting.has(id),
    ask,
    /** Leaving the page in the app: what waits goes now, and no Undo outlives the page. */
    cleanup() {
      closed = true;
      flush();
      document.querySelector('.utoast')?.remove();
      removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      removeEventListener('online', onOnline);
    },
  };
}
