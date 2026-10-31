// @ts-check
// The shell's error reports without the page (NEXT-BATCH.md part 1; API.md §11.16 `POST /v1/ops/errors`):
// one inbox item per uncaught error or rejection: the error's own words, cleaned (ui/scrub.js: every
// address only its host, and quoted text and a `/pattern/` cut, since browsers quote what was typed
// in their own errors), where in this site's code it came from instead of a stack, at most 300
// characters. A thrown or rejected value that isn't an Error goes as its type only (its words may be
// anything). Each distinct error has a fingerprint of its own (its kind, words and place), so the
// inbox keeps them apart; one error is counted at most 3 times a page load (repeats in one batch as
// one item with its count), and 20 items go at most in all, in batches of up to 10. ui/errors.js runs
// it on the page; tests/shell-errors.test.mjs checks it.
import { cleanText } from './scrub.js';

export const PER_ERROR = 3;
export const PER_PAGE = 20;
const PER_BATCH = 10;

const MESSAGE_MAX = 300;
/** A value's kind, for one that isn't an Error. @param {unknown} v */
const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

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
  // The Error itself says it best ("TypeError: x is undefined"). With no value at all, the browser's
  // own message (an "error" event's); any other value only by its kind.
  const text =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : err == null && e.kind === 'error'
        ? String(e.message ?? '')
        : `${e.kind === 'error' ? 'Thrown' : 'Rejected'}: not an Error (${kindOf(err)})`;
  if (!text || /^(Uncaught )?Script error\.?$/i.test(text)) return null;
  const at = where(String(err?.stack ?? ''), e.origin);
  const words = cleanText(text, MESSAGE_MAX);
  return {
    fingerprint: `${e.app}:${hash(`${e.kind}|${words}|${at ?? ''}`)}`,
    source: /** @type {const} */ ('client'),
    code: `${e.app}.${e.kind}`,
    route: e.path.slice(0, 200),
    message: (at ? `${words} @ /${at}` : words).slice(0, MESSAGE_MAX),
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
