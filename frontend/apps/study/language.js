// @ts-check
// A book's language, asked as it is added (STUDY.md §3.1): English or Spanish, the phone's own
// language first. The mind's OCR reads the book's scans in it.
import { el } from '/th/ui.js';

/** @typedef {'eng' | 'spa'} BookLanguage */

/** The phone's language as a book's: Spanish when the phone is in Spanish, else English. @returns {BookLanguage} */
export const phoneLanguage = () => (/^es\b/i.test(navigator.languages?.[0] ?? navigator.language ?? '') ? 'spa' : 'eng');

/** Asks, in a sheet; null when the owner closes it. @returns {Promise<BookLanguage | null>} */
export function askLanguage() {
  return new Promise((resolve) => {
    const first = phoneLanguage();
    const dim = el('div', { class: 'cdim' });
    const box = el('div', { class: 'csheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'What language is this book in?' }, [
      el('h2', { text: 'What language is this book in?' }),
      el('p', { text: 'Scanned pages are read in it.' }),
    ]);
    const row = el('div', { class: 'lang' });
    /** @type {[BookLanguage, string][]} */
    const choices = [['eng', 'English'], ['spa', 'Spanish']];
    if (first === 'spa') choices.reverse();
    const done = (/** @type {BookLanguage | null} */ v) => {
      document.removeEventListener('keydown', onKey, true);
      dim.remove();
      box.remove();
      resolve(v);
    };
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') done(null);
    };
    for (const [code, name] of choices) {
      const b = el('button', { type: 'button', class: code === first ? 'btn' : 'btn soft', text: name });
      b.addEventListener('click', () => done(code));
      row.append(b);
    }
    box.append(row);
    document.body.append(dim, box);
    requestAnimationFrame(() => {
      dim.classList.add('on');
      box.classList.add('on');
    });
    /** @type {HTMLElement} */ (row.firstChild).focus({ preventScroll: true });
    document.addEventListener('keydown', onKey, true);
    dim.addEventListener('click', () => done(null));
  });
}
