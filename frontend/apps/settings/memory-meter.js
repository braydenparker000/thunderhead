// @ts-check
// "How well I know you" at the end of What I remember (EVALS.md §9, P9): the mind's own checks in
// plain words, read when the owner opens it (GET /v1/insight): corrections (M-8), memory checks
// (M-10) and what it arranged and what the owner did with it (M-16); its guesses about the owner's
// day left with the predictions (2026-11-22). A check on the mind, never a score for
// the owner, and never a comparison with anyone (law 16).
import { api, signedIn } from '/th/client.js';
import { el } from '/th/ui.js';
import { icon } from './components.js';

/** @typedef {import('../../../shared/contract/predictions.ts').InsightResponse} InsightResponse */

/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const day = (/** @type {number} */ at) => new Date(at).toLocaleDateString('en', { weekday: 'long' });

/** @param {InsightResponse} r @returns {HTMLElement[]} */
export function meterParts(r) {
  /** @param {string} title @param {string | string[]} text one line, or one per item @param {string} [more] */
  const part = (title, text, more) =>
    el('section', { class: 'msec mmeter' }, [
      el('h3', { class: 'group-title', text: title }),
      ...[text].flat().map((t) => el('p', { class: 'shelp', text: t })),
      ...(more ? [el('p', { class: 'st2', text: more })] : []),
    ]);
  const fixed = r.corrections.reduce((n, w) => n + w.fixed, 0);
  const learned = r.corrections.reduce((n, w) => n + w.learned, 0);
  const [last, ...before] = r.memory;
  const a = r.arrangements;
  const decided = a.kept + a.undone + a.ignored;
  return [
    part(
      'Corrections',
      learned
        ? `You fixed or forgot ${fixed} of the ${count(learned, 'thing', 'things')} I learned in the last 4 weeks.`
        : fixed
          ? `You fixed or forgot ${count(fixed, 'thing', 'things')} in the last 4 weeks.`
          : 'Nothing learned or corrected in the last 4 weeks.',
      learned ? `By week, oldest first: ${r.corrections.map((w) => `${w.fixed} of ${w.learned}`).join(' · ')}` : undefined,
    ),
    part(
      'Memory checks',
      last ? `${last.passed} of ${last.n} right on the last check (${day(last.at)}).` : 'No memory check yet. The night shift runs one on Sundays.',
      before.length ? `Before: ${before.map((m) => `${m.passed} of ${m.n}`).join(' · ')}` : undefined,
    ),
    part(
      'What I arranged',
      decided
        ? `Of the ${count(decided, 'thing', 'things')} I arranged in the last 4 weeks, you used ${a.kept}, took back ${a.undone} and left ${a.ignored}.`
        : 'Nothing I arranged has been out for 2 days yet.',
      a.waiting ? `${count(a.waiting, 'more is', 'more are')} still new.` : undefined,
    ),
    el('p', { class: 'st2', text: 'This is how I check myself, never a score for you.' }),
  ];
}

/** The fold, read the first time it opens. */
export function meterFold() {
  const host = el('div', { class: 'mmeters', 'aria-live': 'polite' });
  const caret = icon('caret-right');
  caret.setAttribute('class', 'i row-caret');
  const fold = el('details', { class: 'group mfold' }, [el('summary', { class: 'row' }, [icon('brain'), el('span', { class: 'row-copy row-title', text: 'How well I know you' }), caret]), host]);
  let read = false;
  fold.addEventListener('toggle', async () => {
    if (!(/** @type {HTMLDetailsElement} */ (fold).open) || read) return;
    read = true;
    host.replaceChildren(el('p', { class: 'st2', text: 'Reading…' }));
    try {
      host.replaceChildren(...meterParts(/** @type {InsightResponse} */ (await signedIn((t) => api.call('/v1/insight', { token: t })))));
    } catch {
      read = false;
      host.replaceChildren(el('p', { class: 'sempty', text: "I couldn't read this just now. Close and open it to try again." }));
    }
  });
  return fold;
}
