// @ts-check
// "Routines" at the end of Settings › The mind (MIND-PLAN §3.6, MENU-AND-SETTINGS.md §6.6): each
// arrangement you approved once on a card, with when it runs in words, its switch, when it last ran
// and Undo for that run. A failed run says why once, until the next one runs. A routine switched off
// can be removed. Read when the fold opens (GET /v1/routines), and again after each change.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { icon, switchRow } from './components.js';

/** @typedef {import('../../../shared/contract/routines.ts').Routine} Routine */
/** @typedef {{ toggle: (r: Routine, on: boolean) => unknown, undo: (r: Routine) => unknown, remove: (r: Routine) => unknown }} Acts */

/** "4 Nov, 07:30" in the phone's own zone. @param {number} ms */
const stamp = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** When it last ran, in words. @param {Routine} r */
export function lastLine(r) {
  if (!r.last_run_at) return 'Not run yet.';
  if (r.last_error) return `Last try ${stamp(r.last_run_at)} stopped: ${r.last_error}.`;
  return `Last ran ${stamp(r.last_run_at)}${r.last_undone ? ', then undone' : ''}.`;
}

/** @param {string} text @param {string} label @param {() => unknown} fn */
const button = (text, label, fn) => {
  const b = el('button', { type: 'button', class: 'btn quiet inline sbtn', text, 'aria-label': label });
  b.addEventListener('click', () => {
    if (!tooSoon()) fn();
  });
  return b;
};

/** One routine: its switch (name, when), then its last run with Undo, or Remove once it is off.
 * @param {Routine} r @param {Acts} acts */
export function routineBox(r, acts) {
  const sw = switchRow(r.name, 'clock', r.on, (on) => acts.toggle(r, on));
  sw.querySelector('.row-copy')?.append(el('span', { class: 'row-detail', text: r.when }));
  const copy = el('div', { class: 'row-copy stext' }, [el('div', { class: `st2${r.last_error ? ' gold' : ''}`, text: lastLine(r) })]);
  const last = el('div', { class: 'row srow', 'data-last': '' }, [icon('arrow-counter-clockwise'), copy]);
  if (r.last_ledger_id && !r.last_undone && !r.last_error) last.append(button('Undo', `Undo the last run of ${r.name}`, () => acts.undo(r)));
  if (!r.on) last.append(button('Remove', `Remove ${r.name}`, () => acts.remove(r)));
  return el('div', { class: 'group', 'data-routine': r.id }, [sw, last]);
}

/** The rows, or the line when there are none. @param {{items: Routine[]}} res @param {Acts} acts */
export function routinesParts(res, acts) {
  return [
    el('p', { class: 'shelp', text: 'Things you said yes to once, which I now do on my own at their time. Switch one off to stop it.' }),
    ...(res.items.length ? res.items.map((r) => routineBox(r, acts)) : [el('p', { class: 'sempty', text: 'No routines yet. I ask before I set one up.' })]),
  ];
}

/** The fold, read the first time it opens and again after each switch, Undo or Remove. */
export function routinesFold() {
  const host = el('div', { class: 'mmeters', 'aria-live': 'polite' });
  const caret = icon('caret-right');
  caret.setAttribute('class', 'i row-caret');
  const summary = el('summary', { class: 'row', 'data-info': '' }, [icon('clock'), el('span', { class: 'row-copy row-title', text: 'Routines' }), caret]);
  const fold = el('details', { class: 'group mfold', id: 'mind-routines' }, [summary, host]);
  let read = false;
  const load = async () => {
    try {
      host.replaceChildren(...routinesParts(/** @type {{items: Routine[]}} */ (await signedIn((t) => api.call('/v1/routines', { token: t }))), acts));
    } catch {
      read = false;
      host.replaceChildren(el('p', { class: 'sempty', text: "I couldn't read this just now. Close and open it to try again." }));
    }
  };
  /** @param {string} path @param {string} method @param {object} [body] @param {string} [done] */
  const send = async (path, method, body, done) => {
    try {
      await signedIn((tok) => api.call(path, { method, token: tok, ...(body ? { body } : {}) }));
      if (done) toast(done);
    } catch (e) {
      toast(lineFor(failure(e)));
    }
    await load();
  };
  /** @type {Acts} */
  const acts = {
    toggle: (r, on) => send(`/v1/routines/${encodeURIComponent(r.id)}/switch`, 'POST', { on }, on ? `${r.name} is on.` : `${r.name} is off. It won't run until you switch it on.`),
    undo: (r) => send(`/v1/ledger/${encodeURIComponent(String(r.last_ledger_id))}/undo`, 'POST', {}, `Undid the last run of ${r.name}.`),
    remove: (r) => send(`/v1/routines/${encodeURIComponent(r.id)}`, 'DELETE', undefined, `Removed ${r.name}.`),
  };
  fold.addEventListener('toggle', () => {
    if (!(/** @type {HTMLDetailsElement} */ (fold).open) || read) return;
    read = true;
    host.replaceChildren(el('p', { class: 'st2', text: 'Reading…' }));
    load();
  });
  return fold;
}
