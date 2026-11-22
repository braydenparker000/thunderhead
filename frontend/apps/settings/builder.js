// @ts-check
// Settings › For the builder (shared/contract/issues.ts, MENU-AND-SETTINGS.md §4.10): what annoyed
// the owner or broke, kept for the next building session. The open items newest first, each opening
// to what happened, where, how bad, when, and its notes, with Mark done; the done ones in a fold,
// each with Reopen; Add one by hand; Copy all copies the open list as plain text. The mind files
// items from the chat. Read from GET /v1/issues; added with PUT, marked with PATCH. Nothing is deleted.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { choice, icon } from './components.js';

/** @typedef {import('../../../shared/contract/issues.ts').Issue} Issue */
/** @typedef {import('../../../shared/contract/issues.ts').IssuesResponse} IssuesResponse */

/** ISSUE_LIMITS (the Worker checks them again). */
const MAX = { title: 120, what: 1000, where: 60 };
const KINDS = /** @type {[string, string][]} */ ([['annoying', 'Annoying'], ['broken', 'Broken'], ['idea', 'Idea']]);
const KIND = Object.fromEntries(KINDS);
/** "4 Nov" in the phone's own zone. @param {number} ms */
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** "4 Nov · Music · Broken" @param {Issue} i */
const meta = (i) => [day(i.at), i.where, KIND[i.kind]].filter(Boolean).map((p) => String(p).replace(/ /g, ' ')).join(' · ');
const uuidv7 = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const t = Date.now();
  for (let k = 0; k < 6; k++) b[k] = Math.floor(t / 2 ** (8 * (5 - k))) & 255;
  b[6] = (b[6] & 15) | 0x70;
  b[8] = (b[8] & 63) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** The open list as plain text, for a building session. @param {Issue[]} items */
export function plainList(items) {
  if (!items.length) return 'Nothing open for the builder.';
  const one = (/** @type {Issue} */ i, n = 0) => [
    `${n}. ${i.title} (${[KIND[i.kind], i.where, new Date(i.at).toISOString().slice(0, 10)].filter(Boolean).join(', ')})`,
    `   ${i.what.replace(/\n/g, '\n   ')}`,
    ...(i.release || i.seen ? [`   Site then: ${[i.release && `release ${i.release}`, i.seen].filter(Boolean).join(', ')}`] : []),
    ...i.notes.map((x) => `   Note (${x.by === 'owner' ? 'you' : 'the mind'}, ${new Date(x.at).toISOString().slice(0, 10)}): ${x.text.replace(/\n/g, ' ')}`),
    `   id ${i.id}`,
  ].join('\n');
  return [`For the builder: ${items.length} open, newest first.`, ...items.map((i, k) => one(i, k + 1))].join('\n\n');
}

/** @param {HTMLElement} body */
export async function page(body) {
  const line = el('p', { class: 'line', role: 'status', text: 'Reading…' });
  const list = el('div', { class: 'group', 'data-items': '' });
  const doneList = el('div', { class: 'mmeters', 'data-done': '' });
  const caret = icon('caret-right');
  caret.setAttribute('class', 'i row-caret');
  const doneFold = el('details', { class: 'group mfold' }, [
    el('summary', { class: 'row', 'data-info': '' }, [icon('check'), el('span', { class: 'row-copy row-title', text: 'Done' }), caret]),
    doneList,
  ]);
  const copy = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'btn soft', text: 'Copy all', 'data-copy': '' }));
  copy.disabled = true;
  /** @type {Issue[]} */
  let open = [];

  /** One item: its row opens to the details. @param {Issue} i */
  const item = (i) => {
    const detail = el('div', { class: 'mdetail' });
    const head = el('button', { type: 'button', class: 'row', 'aria-expanded': 'false', 'data-issue': i.id }, [
      icon(i.kind === 'broken' ? 'warning-circle' : i.kind === 'idea' ? 'sparkle' : 'flag'),
      el('span', { class: 'row-copy' }, [el('span', { class: 'row-title', text: i.title }), el('span', { class: 'row-detail', text: meta(i) })]),
    ]);
    head.addEventListener('click', () => {
      const shut = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!shut));
      if (shut) { detail.replaceChildren(); return; }
      const mark = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'btn soft', text: i.state === 'open' ? 'Mark done' : 'Reopen' }));
      mark.addEventListener('click', () => { if (!tooSoon()) setState(i, mark); });
      detail.replaceChildren(
        el('p', { class: 'shelp', 'data-what': '', text: i.what }),
        el('p', { class: 'st2', text: `${i.origin === 'mind' ? 'From the chat' : 'Added here'}, ${day(i.at)}${i.release ? ` · release ${i.release}` : ''}` }),
        ...i.notes.map((n) => el('p', { class: 'st2', 'data-note': '', text: `${n.by === 'owner' ? 'You' : 'The mind'}, ${day(n.at)}: ${n.text}` })),
        mark,
      );
    });
    return el('div', { class: 'mrow' }, [head, detail]);
  };

  /** @param {Issue} i @param {HTMLButtonElement} button */
  const setState = async (i, button) => {
    button.disabled = true;
    try {
      await signedIn((t) => api.call(`/v1/issues/${encodeURIComponent(i.id)}`, { method: 'PATCH', token: t, body: { state: i.state === 'open' ? 'done' : 'open' } }));
      toast(i.state === 'open' ? 'Marked done.' : 'Open again.');
      await load();
    } catch (e) {
      button.disabled = false;
      toast(lineFor(failure(e)));
    }
  };

  const load = async () => {
    if (!navigator.onLine) {
      line.textContent = "You're offline. The list shows once you're back.";
      return;
    }
    try {
      const [o, d] = /** @type {IssuesResponse[]} */ (await Promise.all(['open', 'done'].map((s) => signedIn((t) => api.call(`/v1/issues?state=${s}`, { token: t })))));
      open = o.items;
      list.hidden = !open.length;
      list.replaceChildren(...open.map(item));
      line.textContent = open.length ? '' : 'Nothing open. When something annoys you, tell me in the chat or add it here.';
      doneFold.hidden = !d.items.length;
      doneList.replaceChildren(...d.items.map(item));
      copy.disabled = !open.length;
    } catch (e) {
      line.textContent = lineFor(failure(e));
    }
  };

  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(plainList(open)); toast('Copied'); } catch { toast("Couldn't copy. Try again."); }
  });

  // Add one by hand.
  const field = (/** @type {string} */ id, /** @type {string} */ label, /** @type {number} */ max, area = false) => {
    const input = el(area ? 'textarea' : 'input', { id, class: area ? 'field marea' : 'field', maxlength: String(max), ...(area ? { rows: '4' } : { type: 'text' }) });
    return [el('label', { for: id, class: 'st2', text: label }), input];
  };
  const [titleLabel, title] = field('issue-title', 'In a few words', MAX.title);
  const [whatLabel, what] = field('issue-what', 'What happened', MAX.what, true);
  const [whereLabel, where] = field('issue-where', 'Where (an app or page, if you like)', MAX.where);
  let kind = 'annoying';
  const state = el('p', { class: 'st2', role: 'status' });
  const save = /** @type {HTMLButtonElement} */ (el('button', { type: 'submit', class: 'btn', text: 'Add' }));
  const form = el('form', { class: 'sform', 'data-add': '' }, [titleLabel, title, whatLabel, what, whereLabel, where, choice('How bad', KINDS, kind, (v) => { kind = v; }), state, save]);
  const addCaret = icon('caret-right');
  addCaret.setAttribute('class', 'i row-caret');
  const addFold = el('details', { class: 'group mfold', 'data-add-fold': '' }, [
    el('summary', { class: 'row', 'data-info': '' }, [icon('plus'), el('span', { class: 'row-copy row-title', text: 'Add one' }), addCaret]),
    form,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (/** @type {Element} */ n) => /** @type {HTMLInputElement} */ (n).value.trim();
    if (!v(title) || !v(what)) { state.textContent = 'Say what it is and what happened.'; return; }
    save.disabled = true;
    try {
      const req = { title: v(title), what: v(what), kind, ...(v(where) ? { where: v(where) } : {}) };
      await signedIn((t) => api.call(`/v1/issues/${uuidv7()}`, { method: 'PUT', token: t, body: req }));
      for (const n of [title, what, where]) /** @type {HTMLInputElement} */ (n).value = '';
      state.textContent = 'Added.';
      await load();
    } catch (err) {
      state.textContent = lineFor(failure(err));
    }
    save.disabled = false;
  });

  const back = () => void load();
  addEventListener('online', back);
  body.append(
    el('p', { class: 'slead', text: 'What annoyed you or broke, kept for the next time someone builds. Tell me in the chat, or add one here.' }),
    el('h2', { class: 'group-title', text: 'Open' }), list, line, copy, addFold, doneFold,
  );
  doneFold.hidden = true;
  await load();
  return () => removeEventListener('online', back);
}
