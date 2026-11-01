// @ts-check
// A conversation card held (450 ms, GESTURES.md §1; MENU-AND-SETTINGS.md §3.3): a sheet with
// Continue this (the mind reads it in today's briefing), Rename (the owner's name wins forever;
// empty gives naming back), Pin or Unpin, and Delete. Today's card (Now) offers Delete alone, which
// starts a fresh today. Delete asks once; the Worker hides it at once, Settings › Recently deleted
// keeps it 30 days (with Restore), then it is purged. Only this device can (the Worker checks).
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { confirmSheet, toast } from '../ui.js';
import * as data from './data.js';

const HOLD_MS = 450;

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Watches `host` for a held card; `pins` reads and writes the pinned ids; `redraw` repaints the list.
 * @param {HTMLElement} host @param {{ get: () => string[], set: (ids: string[]) => void }} pins @param {() => void} redraw */
export function holdCards(host, pins, redraw) {
  /** @type {{ row: HTMLElement, x: number, y: number, timer: ReturnType<typeof setTimeout> } | null} */
  let held = null;
  let swallow = false;
  const now = /** @type {HTMLElement} */ (document.querySelector('#now'));
  /** @param {PointerEvent} e */
  const down = (e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.row.thr[data-id], #now'));
    if (!row || !e.isPrimary) return;
    held = { row, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      if (!held) return;
      swallow = true;
      setTimeout(() => (swallow = false), 400);
      try {
        navigator.vibrate?.(8);
      } catch {}
      if (row === now) data.today().then((t) => t.id && sheet(/** @type {string} */ (t.id), pins, redraw, true), () => {});
      else sheet(/** @type {string} */ (row.dataset.id), pins, redraw);
      held = null;
    }, HOLD_MS) };
  };
  host.addEventListener('pointerdown', down);
  now.addEventListener('pointerdown', down);
  const drop = () => {
    if (held) clearTimeout(held.timer);
    held = null;
  };
  addEventListener('pointermove', (e) => {
    if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 10) drop();
  });
  addEventListener('pointerup', drop);
  addEventListener('pointercancel', drop);
  host.addEventListener('contextmenu', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.row.thr')) e.preventDefault();
  });
  // The click a hold ends in does nothing else (Now's own tap would go home or say it is here).
  addEventListener('click', (e) => {
    const t = /** @type {Node} */ (e.target);
    if (!swallow || !(host.contains(t) || now.contains(t))) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
}

/** The sheet over the menu, near the thumb; today's offers Delete alone.
 * @param {string} id @param {{ get: () => string[], set: (ids: string[]) => void }} pins @param {() => void} redraw @param {boolean} [today] */
function sheet(id, pins, redraw, today = false) {
  document.querySelector('.holdsheet')?.remove();
  const t = data.list.threads.get(id);
  const box = el('div', 'holdsheet');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Conversation');
  const title = el('div', 'cstitle', today ? 'Now' : t?.title || 'This conversation');
  const list = el('div', 'csacts');
  const close = () => {
    box.classList.remove('in');
    setTimeout(() => box.remove(), 260);
  };
  /** @param {string} label @param {() => void | Promise<void>} run */
  const act = (label, run) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', () => run());
    list.append(b);
    return b;
  };
  if (!today) act('Continue this', async () => {
    close();
    try {
      await data.carryOn(id);
      toast("I'll keep that in mind today.");
    } catch (e) {
      toast(lineFor(failure(e)));
    }
  });
  if (!today) act('Rename', () => {
    const input = el('input', 'csname');
    Object.assign(input, { type: 'text', maxLength: 60, value: t?.title ?? '', enterKeyHint: 'done' });
    input.setAttribute('aria-label', 'Name');
    const save = el('button', 'cssave', 'Save');
    save.type = 'button';
    const done = async () => {
      save.disabled = true;
      try {
        await data.rename(id, input.value);
        close();
        redraw();
        toast(input.value.trim() ? 'Renamed' : "I'll name it again tonight");
      } catch (e) {
        save.disabled = false;
        toast(lineFor(failure(e)));
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done();
      if (e.key === 'Escape') close();
    });
    save.addEventListener('click', done);
    list.replaceChildren(input, save);
    input.focus();
    input.select();
  });
  const pinned = pins.get().includes(id);
  if (!today) act(pinned ? 'Unpin' : 'Pin', () => {
    close();
    const before = pins.get();
    pins.set(pinned ? before.filter((p) => p !== id) : [id, ...before].slice(0, 20));
    toast(pinned ? 'Unpinned' : 'Pinned', { label: 'Undo', run: () => pins.set(before) });
  });
  act('Delete', async () => {
    close();
    const yes = await confirmSheet({ title: 'Delete this conversation?', body: 'It goes now; you can undo for 30 days in Settings › Recently deleted.', action: 'Delete' });
    if (!yes) return;
    try {
      await data.remove(id);
      redraw();
      toast('Deleted.', { label: 'Undo', run: () => data.restore(id).then(() => (redraw(), toast('Restored.')), (e) => toast(lineFor(failure(e)))) });
    } catch (e) {
      toast(lineFor(failure(e)));
    }
  }).classList.add('del');
  const cancel = el('button', 'cscancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  box.append(title, list, cancel);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  /** @type {HTMLElement} */ (document.querySelector('#side')).append(box);
  requestAnimationFrame(() => box.classList.add('in'));
  /** @type {HTMLElement | null} */ (list.querySelector('button'))?.focus({ preventScroll: true });
}
