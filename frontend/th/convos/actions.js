// @ts-check
// A conversation card held (450 ms, GESTURES.md §1; MENU-AND-SETTINGS.md §3.3): a sheet with
// Continue this (the mind reads it in today's briefing), Rename (the owner's name wins forever;
// empty gives naming back) and Pin or Unpin. Delete waits for its own step (decisions.md). Today's
// card has none of these.
import { lineFor } from '../copy.js';
import { failure } from '../flow.js';
import { toast } from '../ui.js';
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
  host.addEventListener('pointerdown', (e) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.row.thr[data-id]'));
    if (!row || !e.isPrimary) return;
    held = { row, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      if (!held) return;
      swallow = true;
      setTimeout(() => (swallow = false), 400);
      try {
        navigator.vibrate?.(8);
      } catch {}
      sheet(/** @type {string} */ (row.dataset.id), pins, redraw);
      held = null;
    }, HOLD_MS) };
  });
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
  host.addEventListener('click', (e) => {
    if (!swallow) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

/** The sheet over the menu, near the thumb. @param {string} id @param {{ get: () => string[], set: (ids: string[]) => void }} pins @param {() => void} redraw */
function sheet(id, pins, redraw) {
  document.querySelector('.csheet')?.remove();
  const t = data.list.threads.get(id);
  const box = el('div', 'csheet');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Conversation');
  const title = el('div', 'cstitle', t?.title || 'This conversation');
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
  act('Continue this', async () => {
    close();
    try {
      await data.carryOn(id);
      toast("I'll keep that in mind today.");
    } catch (e) {
      toast(lineFor(failure(e)));
    }
  });
  act('Rename', () => {
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
  act(pinned ? 'Unpin' : 'Pin', () => {
    close();
    const before = pins.get();
    pins.set(pinned ? before.filter((p) => p !== id) : [id, ...before].slice(0, 20));
    toast(pinned ? 'Unpinned' : 'Pinned', { label: 'Undo', run: () => pins.set(before) });
  });
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
