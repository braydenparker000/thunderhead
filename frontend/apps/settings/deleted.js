// Settings › Recently deleted (MENU-AND-SETTINGS.md §4.8; decisions.md 2026-11-01): the
// conversations deleted in the last 30 days, newest first, each with when it goes for good and
// Restore. Restore gives it back to the menu as it was (beside a fresh today when deleting today's
// started one). Only this device can see or restore them (the Worker checks). Text is set as text.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { dMMM } from '/th/format.js';
import { el, toast } from '/th/ui.js';
import { icon } from './components.js';

/** @typedef {import('../../../shared/contract/api.ts').DeletedThread} DeletedThread */

const DAY = 86_400_000;
const title = (/** @type {DeletedThread} */ t) =>
  (t.title ?? '').replace(/\s+/g, ' ').trim() ||
  (t.kind === 'off_record' ? 'Off the record' : new Date(`${t.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
/** "Deleted 3 Nov · gone in 28 days · 14 messages" */
const meta = (/** @type {DeletedThread} */ t, now = Date.now()) => {
  const n = Math.max(1, Math.ceil((t.purge_at - now) / DAY));
  // Each part keeps its words together, so a line breaks only between parts.
  const parts = [`Deleted ${dMMM(t.deleted_at)}`, `gone in ${n} day${n === 1 ? '' : 's'}`, `${t.message_count} message${t.message_count === 1 ? '' : 's'}`];
  return parts.map((p) => p.replace(/ /g, '\u00a0')).join(' · ');
};

/** @param {HTMLElement} body */
export async function deletedPage(body) {
  const list = el('div', { class: 'group slist sdeleted' });
  const line = el('p', { class: 'line', role: 'status' });
  body.append(el('p', { class: 'slead', text: 'Conversations you deleted stay here for 30 days, then they are gone for good, with their files.' }), el('h2', { class: 'group-title', text: 'Conversations' }), list, line);
  const draw = async () => {
    line.textContent = '';
    line.classList.remove('ok');
    try {
      /** @type {{ items: DeletedThread[] }} */
      const r = await signedIn((t) => api.call('/v1/threads/deleted', { token: t }));
      list.hidden = !r.items.length;
      list.replaceChildren(...r.items.map(row));
      if (!r.items.length) { line.classList.add('ok'); line.textContent = 'Nothing deleted in the last 30 days.'; }
    } catch (e) {
      line.textContent = lineFor(failure(e));
    }
  };
  /** @param {DeletedThread} t */
  const row = (t) => {
    const go = el('button', { type: 'button', class: 'btn quiet inline', text: 'Restore', 'aria-label': `Restore ${title(t)}` });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await signedIn((tk) => api.call(`/v1/threads/${encodeURIComponent(t.id)}/restore`, { method: 'POST', token: tk }));
        toast('Restored. It is back in the menu.');
        await draw();
      } catch (e) {
        go.disabled = false;
        toast(lineFor(failure(e)));
      }
    });
    return el('div', { class: 'row srow sdel', 'data-id': t.id }, [
      icon('trash'), el('div', { class: 'row-copy stext' }, [el('span', { class: 'row-title t', text: title(t) }), el('small', { class: 'row-detail', text: meta(t) })]),
      go,
    ]);
  };
  await draw();
}
