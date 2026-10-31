// @ts-check
// The shell's error reports without the page (NEXT-BATCH.md part 1; API.md §11.16 `POST /v1/ops/errors`):
// one inbox item per uncaught error or rejection, scrubbed as the ported pages' reporter scrubs
// (assets/error-report.js): the error's own words with every address cut to its host, where in this
// site's code it came from instead of a stack, at most 300 characters. Each distinct error has a
// fingerprint of its own (its kind, words and place), so the inbox keeps them apart; one error is
// counted at most 3 times a page load (repeats in one batch as one item with its count), and 20
// items go at most in all, in batches of up to 10. ui/errors.js runs it on the page;
// tests/shell-errors.test.mjs checks it.

export const PER_ERROR = 3;
export const PER_PAGE = 20;
const PER_BATCH = 10;

/** Each address keeps only its host. @param {string} text */
export const bare = (text) => text.replace(/\bhttps?:\/\/([^/\s?#]+)\S*/g, '$1/…');

/** The first place in this site's own code a stack names (`th/chat/view.js:12:5`). @param {string} stack @param {string} origin */
const where = (stack, origin) => stack.split(`${origin}/`)[1]?.match(/^[^\s()]+:\d+:\d+/)?.[0];

/** FNV-1a (32 bits) as 8 hex digits: a short, stable name. @param {string} s */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The inbox item for one uncaught error (`kind` error) or rejection, or null when it says nothing
 * (a cross-origin "Script error.").
 * @param {{ app: string, kind: 'error' | 'rejection', error: unknown, message?: string, origin: string, path: string, build: number, at: number }} e
 */
export function itemOf(e) {
  const err = /** @type {any} */ (e.error);
  // The Error itself says it best ("TypeError: x is undefined"); an event's message adds "Uncaught ".
  const text = String(err instanceof Error ? `${err.name}: ${err.message}` : e.message || err || '').slice(0, 300);
  if (!text || /^Script error\.?$/i.test(text)) return null;
  const at = where(String(err?.stack ?? ''), e.origin);
  const words = bare(text);
  return {
    fingerprint: `${e.app}:${hash(`${e.kind}|${words}|${at ?? ''}`)}`,
    source: /** @type {const} */ ('client'),
    code: `${e.app}.${e.kind}`,
    route: e.path.slice(0, 200),
    message: (at ? `${words} @ /${at}` : words).slice(0, 300),
    build: e.build,
    at: e.at,
  };
}

/** @typedef {NonNullable<ReturnType<typeof itemOf>> & { count?: number }} Item */

/**
 * Collects a page's items and hands them to `post` in batches: `batchMs` after the last one, or at
 * once with `flush` (the page is hidden). The same error again while its batch waits adds to its count.
 * @param {(items: Item[]) => void} post @param {number} [batchMs]
 */
export function collector(post, batchMs = 2000) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Item[]} */
  let queue = [];
  let sent = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!queue.length) return;
    const items = queue.slice(0, PER_BATCH);
    queue = queue.slice(PER_BATCH);
    sent += items.length;
    post(items);
    if (queue.length) timer = setTimeout(flush, batchMs);
  };
  return {
    /** @param {Item | null} item @returns {boolean} whether it was kept */
    add(item) {
      if (!item || sent + queue.length >= PER_PAGE) return false;
      const n = seen.get(item.fingerprint) ?? 0;
      if (n >= PER_ERROR) return false;
      seen.set(item.fingerprint, n + 1);
      const waiting = queue.find((i) => i.fingerprint === item.fingerprint);
      if (waiting) waiting.count = (waiting.count ?? 1) + 1;
      else queue.push(item);
      clearTimeout(timer);
      timer = setTimeout(flush, batchMs);
      return true;
    },
    flush,
  };
}
