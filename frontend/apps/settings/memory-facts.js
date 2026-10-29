// The Memory page's facts (MEMORY.md §12, MENU-AND-SETTINGS.md §4.4): a row per fact with its
// source, its odds in words and its age; tap for the detail (what it rests on, earlier versions,
// why) and the owner's actions. Fix writes a new version in the owner's words; Forget asks once,
// gives 10 s to undo, then deletes for good. Text is always set as text, never as markup.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { uuidv7 } from '/th/chat/model.js';
import { failure } from '/th/flow.js';
import { evidenceLabel, odds, sourceLabel } from '/th/registry/memory.js';
import { confirmSheet, el, toast, tooSoon } from '/th/ui.js';

/** The owner's words for a refused op (API.md §11.13 reasons); anything else is the usual line. */
const REFUSED = {
  too_long: 'Keep it to one short sentence (280 characters at most).',
  superseded: 'That changed in the meantime. Here is the newest version.',
  unknown_ref: "That's already gone.",
  bad_op: "That couldn't be saved. Try other words.",
};

/** One line for a failed memory call. */
export function memoryLine(e) {
  const issue = Array.isArray(e?.details) ? e.details[0]?.issue : null;
  return issue && Object.hasOwn(REFUSED, issue) ? REFUSED[issue] : lineFor(failure(e));
}

/** One op from this device; the Worker cites its own ledger row as the evidence. */
export const op = (o, keepalive = false) => signedIn((t) => api.memoryOps(t, uuidv7(), [o], keepalive));

const monthYear = (ms) => new Date(ms).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const dayMonth = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "You said · Pretty sure, about 8 in 10 · since Nov 2026" */
export function metaLine(f) {
  return `${sourceLabel(f.source)} · ${f.kind === 'rule' ? 'A standing rule' : odds(f.confidence_now)} · since ${monthYear(f.valid_from ?? f.recorded_at)}`;
}

/**
 * A fact's row. `ctx.reload()` refreshes the page; `ctx.forget(f, row)` runs the undoable forget.
 * `shelf` adds the shelf's own action: "Still true" (fading) or "Yes, that's right" (review).
 */
export function factRow(f, ctx, shelf) {
  const secret = f.sensitivity === 1;
  const text = el('button', { type: 'button', class: `mtext${secret ? ' blur' : ''}`, 'aria-expanded': 'false', text: f.text });
  if (secret) text.setAttribute('aria-label', 'Private. Tap to show.');
  const badges = el('div', { class: 'mbadges' });
  if (f.pinned) badges.append(el('span', { class: 'badge', text: 'Pinned' }));
  if (!f.may_raise) badges.append(el('span', { class: 'badge', text: "Won't bring up" }));
  if (secret) badges.append(el('span', { class: 'badge', text: 'Private' }));
  const detail = el('div', { class: 'mdetail', hidden: '' });
  const row = el('div', { class: 'mrow', 'data-id': f.id }, [text, el('div', { class: 'st2', text: metaLine(f) }), badges, detail]);
  text.addEventListener('click', () => {
    if (text.classList.contains('blur')) {
      text.classList.remove('blur');
      text.removeAttribute('aria-label');
      return;
    }
    const open = detail.hidden;
    detail.hidden = !open;
    text.setAttribute('aria-expanded', String(open));
    if (open) showDetail(detail, f, ctx, row, shelf);
  });
  return row;
}

async function showDetail(host, f, ctx, row, shelf) {
  host.replaceChildren(el('p', { class: 'st2', text: 'Loading…' }));
  let d;
  try {
    d = await signedIn((t) => api.fact(t, f.id));
  } catch (e) {
    host.replaceChildren(el('p', { class: 'line', text: memoryLine(e) }));
    return;
  }
  const kids = [];
  // The mind's own reason, when it gave one (the Worker's default lines say nothing new).
  if (d.why && !/^(from |the owner |confirmed )/.test(d.why)) kids.push(el('p', { class: 'mwhy', text: `Why: ${d.why}` }));
  if (d.evidence.length) {
    const list = el('ul', { class: 'mev', 'aria-label': 'What this rests on' });
    for (const e of d.evidence) {
      const head = `${evidenceLabel(e)}${e.at ? `, ${dayMonth(e.at)}` : ''}`;
      list.append(el('li', {}, [el('span', { class: 'st2', text: head }), ...(e.text ? [el('q', { text: e.text })] : [])]));
    }
    kids.push(list);
  }
  if (d.history.length) {
    const list = el('ul', { class: 'mhist', 'aria-label': 'Earlier versions' });
    for (const h of d.history) list.append(el('li', { text: `${h.text}${h.superseded_at ? ` (until ${dayMonth(h.superseded_at)})` : ''}` }));
    kids.push(el('p', { class: 'st2', text: 'Before:' }), list);
  }
  host.replaceChildren(...kids, actions(f, ctx, row, host, shelf));
}

function actions(f, ctx, row, host, shelf) {
  const bar = el('div', { class: 'macts' });
  const add = (label, fn, cls = '') => {
    const b = el('button', { type: 'button', class: `sbtn${cls}`, text: label });
    b.addEventListener('click', async () => {
      if (tooSoon()) return;
      b.disabled = true;
      try { await fn(); } finally { b.disabled = false; }
    });
    bar.append(b);
  };
  const run = async (o, done) => {
    try { await op(o); toast(done); ctx.reload(); } catch (e) { toast(memoryLine(e)); if (e?.details?.[0]?.issue === 'superseded') ctx.reload(); }
  };
  if (shelf === 'review') add("Yes, that's right", () => run({ op: 'confirm', id: f.id }, 'Thanks. Saved in your words'));
  if (shelf === 'fading') add('Still true', () => run({ op: 'confirm', id: f.id }, 'Kept'));
  add('Fix', async () => fix(host, f, ctx, row, shelf));
  if (f.kind !== 'rule') add(f.pinned ? 'Unpin' : 'Pin', () => run({ op: 'pin', id: f.id, pinned: !f.pinned }, f.pinned ? 'Unpinned' : 'Pinned'));
  if (f.kind !== 'rule')
    add(f.may_raise ? "Don't bring this up" : 'You can bring this up', () =>
      run({ op: 'may_raise', id: f.id, value: !f.may_raise }, f.may_raise ? "I won't bring it up" : 'Noted'));
  add('Forget', () => ctx.forget(f), ' danger');
  return bar;
}

/** Fix: the text as the owner wants it, saved as a new version (the old one stays as history). */
function fix(host, f, ctx, row, shelf) {
  const id = `fix-${f.id}`;
  const area = el('textarea', { id, class: 'sedit marea', maxlength: '280', rows: '3' });
  area.value = f.text;
  const save = el('button', { type: 'submit', class: 'btn', text: 'Save' });
  const cancel = el('button', { type: 'button', class: 'btn soft', text: 'Cancel' });
  const form = el('form', { class: 'mform' }, [el('label', { for: id, class: 'st2', text: 'Say it the way it is' }), area, save, cancel]);
  host.replaceChildren(form);
  area.focus({ preventScroll: true });
  cancel.addEventListener('click', () => showDetail(host, f, ctx, row, shelf));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = area.value.replace(/\s+/g, ' ').trim();
    if (!text || text === f.text) return showDetail(host, f, ctx, row, shelf);
    save.disabled = true;
    try {
      await op({ op: 'supersede', id: f.id, new: { id: uuidv7(), text, evidence: [] } });
      toast('Fixed');
      ctx.reload();
    } catch (err) {
      save.disabled = false;
      toast(memoryLine(err));
      if (err?.details?.[0]?.issue === 'superseded') ctx.reload();
    }
  });
}

/** Asks once ("It can't be brought back"); the caller then hides the row and offers Undo. */
export const confirmForget = () =>
  confirmSheet({
    title: 'Forget this?',
    body: "It can't be brought back. The system's recovery points keep it for up to 30 days, then it's gone everywhere.",
    action: 'Forget',
    keep: 'Keep',
  });
