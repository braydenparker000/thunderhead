// The Memory page's loose ends and days (MEMORY.md §12): an open thread is closed with Done or
// Dropped (with a reason), or added by the owner; a day note is read and edited, which writes a
// new version in the owner's name. Text is always set as text, never as markup.
import { api, signedIn } from '/th/client.js';
import { uuidv7 } from '/th/chat/model.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { choice, icon } from './components.js';
import { memoryLine } from './memory-facts.js';

const dayMonth = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** A loose end or day note a session wrote after reading outside text (MEMORY.md §6 M11): kept and
 * used, marked so the owner knows. */
const FROM_OUTSIDE = ' · after reading outside text';
const weekday = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A loose end: whose it is, when it's due, and Done / Drop. */
export function threadRow(t, ctx) {
  const whose = t.owner === 'mind' ? "I'll do this" : 'Yours';
  const meta = `${whose}${t.due_at ? ` · due ${dayMonth(t.due_at)}` : ''} · since ${dayMonth(t.opened_at)}${t.provenance === 'outside' ? FROM_OUTSIDE : ''}`;
  const host = el('div', { class: 'mdetail' });
  const done = el('button', { type: 'button', class: 'btn soft sbtn', text: 'Done' });
  const drop = el('button', { type: 'button', class: 'btn soft sbtn', text: 'Drop' });
  const row = el('div', { class: 'mrow', 'data-id': t.id }, [
    el('div', { class: 'mtext row static' }, [icon('clock'), el('span', { class: 'row-copy row-title', text: t.text })]),
    el('div', { class: 'st2', text: meta }),
    el('div', { class: 'macts' }, [done, drop]),
    host,
  ]);
  done.addEventListener('click', async () => {
    if (tooSoon()) return;
    done.disabled = true;
    try { await signedIn((tok) => api.patchThread(tok, t.id, { status: 'done' })); toast('Done'); ctx.reload(); } catch (e) { done.disabled = false; toast(memoryLine(e)); }
  });
  drop.addEventListener('click', () => {
    const why = el('input', { id: `why-${t.id}`, class: 'field sedit', maxlength: '200', placeholder: 'Why drop it?' });
    const go = el('button', { type: 'submit', class: 'btn', text: 'Drop it' });
    const form = el('form', { class: 'mform' }, [el('label', { for: `why-${t.id}`, class: 'st2', text: 'A few words, so I know' }), why, go]);
    host.replaceChildren(form);
    why.focus({ preventScroll: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const words = why.value.trim();
      if (!words) return;
      go.disabled = true;
      try { await signedIn((tok) => api.patchThread(tok, t.id, { status: 'dropped', why: words })); toast('Dropped'); ctx.reload(); } catch (err) { go.disabled = false; toast(memoryLine(err)); }
    });
  });
  return row;
}

/** "Add a loose end": the owner's own, or one for the mind. The page keeps one across refreshes,
 * so it goes back to its button once the loose end is added. */
export function threadAdd(ctx) {
  const host = el('div', { class: 'srec' });
  const button = el('button', { type: 'button', class: 'btn soft', text: 'Add a loose end' });
  host.append(button);
  button.addEventListener('click', () => {
    const text = el('input', { id: 'thread-text', class: 'field sedit', maxlength: '200' });
    let selectedOwner = 'owner';
    const owner = choice('Whose is it', [['owner', "It's mine to do"], ['mind', "It's for you to do"]], selectedOwner, (value) => { selectedOwner = value; });
    owner.id = 'thread-owner';
    const save = el('button', { type: 'submit', class: 'btn', text: 'Add' });
    const form = el('form', { class: 'mform' }, [
      el('label', { for: 'thread-text', class: 'st2', text: 'What should happen' }), text,
      owner, save,
    ]);
    host.replaceChildren(form);
    text.focus({ preventScroll: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const words = text.value.replace(/\s+/g, ' ').trim();
      if (!words) return;
      save.disabled = true;
      try {
        await signedIn((tok) => api.putThread(tok, uuidv7(), { text: words, owner: selectedOwner, evidence: [] }));
        toast('Added');
        host.replaceChildren(button);
        ctx.reload();
      } catch (err) {
        save.disabled = false;
        toast(memoryLine(err));
      }
    });
  });
  return host;
}

/** A day note: the day, how much it mattered, the summary and its decisions; Edit. */
export function dayRow(d, ctx) {
  const summary = el('div', { class: 'mtext row static' }, [icon('newspaper'), el('span', { class: 'row-copy row-title', text: d.summary })]);
  const host = el('div', { class: 'mdetail' });
  const edit = el('button', { type: 'button', class: 'btn soft sbtn', text: 'Edit' });
  const kids = [
    el('div', { class: 'st2', text: `${weekday(d.day)} · ${d.written_by === 'owner' ? 'edited by you' : `importance ${d.importance} of 10`}${d.provenance === 'outside' ? FROM_OUTSIDE : ''}` }),
    summary,
  ];
  for (const decision of d.decisions) kids.push(el('div', { class: 'st2', text: `Decided: ${decision}` }));
  const row = el('div', { class: 'mrow', 'data-day': d.day }, [...kids, el('div', { class: 'macts' }, [edit]), host]);
  edit.addEventListener('click', () => {
    const id = `day-${d.day}`;
    const area = el('textarea', { id, class: 'field sedit marea', rows: '5', maxlength: '1200' });
    area.value = d.summary;
    const save = el('button', { type: 'submit', class: 'btn', text: 'Save' });
    const form = el('form', { class: 'mform' }, [el('label', { for: id, class: 'st2', text: 'The day, in at most 150 words' }), area, save]);
    host.replaceChildren(form);
    area.focus({ preventScroll: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = area.value.trim();
      if (!text || text.split(/\s+/).length > 150) return toast('Keep it to 150 words.');
      save.disabled = true;
      try {
        await signedIn((tok) => api.putDayNote(tok, d.day, { summary: text, decisions: d.decisions, importance: d.importance }));
        toast('Saved');
        ctx.reload();
      } catch (err) {
        save.disabled = false;
        toast(memoryLine(err));
      }
    });
  });
  return row;
}
