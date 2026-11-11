// @ts-check
// Home's settings that need a line of code rather than a style (shared/contract/settings-phone.ts,
// MENU-AND-SETTINGS.md §6.2): the date's form, the ask bar's words, spelling marks, capitals and
// whether the keyboard is up as home opens. Read once as home starts and again whenever one of
// them changes in Settings (`th:setting`), so nothing waits for a reload.
import { pref, prefOn } from '/th/pref.js';

const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('#q'));
const date = document.querySelector('#date');
const FORMS = /** @type {const} */ ({ short: { weekday: 'short', day: 'numeric', month: 'short' }, long: { weekday: 'long', day: 'numeric', month: 'long' } });

export function apply() {
  if (date) {
    try {
      date.textContent = new Date().toLocaleDateString(undefined, FORMS[pref('chat.date') === 'long' ? 'long' : 'short']);
    } catch {}
  }
  if (!q) return;
  const words = pref('chat.placeholder') || 'Ask anything';
  // Dictation borrows the placeholder while it listens and puts `data-ph` back after (th/dictate/mic.js).
  if (q.placeholder === (q.dataset.ph || 'Ask anything')) q.placeholder = words;
  q.dataset.ph = words;
  q.spellcheck = prefOn('chat.spellcheck');
  q.setAttribute('autocapitalize', pref('chat.autocap') === 'off' ? 'off' : 'sentences');
}

apply();
document.addEventListener('th:setting', (e) => {
  if (/^chat\./.test(/** @type {CustomEvent} */ (e).detail?.key ?? '')) apply();
});
// The date is today's when the app comes back the next morning.
document.addEventListener('visibilitychange', () => { if (!document.hidden) apply(); });
// Keyboard on open: home itself only, never a page opened over it or a framed copy.
if (q && prefOn('chat.autofocus', false) && location.pathname === '/' && window.top === window.self)
  requestAnimationFrame(() => q.focus({ preventScroll: true }));
