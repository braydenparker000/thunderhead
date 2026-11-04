// @ts-check
// The night's report on the Briefing (BRIEFING.md "The report card"): the first tile after the
// weather, folded to "Overnight", the headline and the Worker's counts; a tap on it opens its lines
// in place (`aria-expanded`) and a second tap folds it. A line opens its app when it names one, and
// a line whose ledger row can still be undone has an Undo: POST /v1/ledger/:id/undo, the same as
// `th undo` on that row; an undone line says so. The tile stays open across the page's redraws.
// Text is set with textContent only.
import { api, signedIn } from '../client.js';
import { el, toast } from '../ui.js';

/** @typedef {import('../../../shared/contract/briefing.ts').ReportTile} ReportTile */

/** The reports open on this page, by day. */
const open = new Set();
/** Lines undone from this phone (`<day>|<ledger id>`), until the Worker's answer says so too. */
const undone = new Set();

/** @param {ReportTile} t @param {(name: string) => SVGElement} icon @param {() => void} changed */
export function reportTile(t, icon, changed) {
  const node = el('div', { class: 'tile wide report' });
  const id = `rlines-${t.day}`;
  const head = el('button', { type: 'button', class: 'ohead', 'aria-expanded': String(open.has(t.day)), 'aria-controls': id });
  const k = el('span', { class: 'k' });
  k.append(icon('moon-stars'), t.label);
  head.append(k, el('span', { class: 'v', text: t.value }), el('span', { class: 's', text: t.detail }));
  head.setAttribute('aria-label', `${t.label}, ${t.value}, ${t.detail}`);
  const list = el('ul', { class: 'rlines', id });
  list.hidden = !open.has(t.day);
  for (const l of t.lines) list.append(line(t.day, l, changed));
  if (t.cut.length) list.append(el('li', { class: 'rcut', text: `Cut by the time limit: step${t.cut.length > 1 ? 's' : ''} ${t.cut.join(', ')}` }));
  head.addEventListener('click', () => {
    const now = !open.has(t.day);
    if (now) open.add(t.day);
    else open.delete(t.day);
    head.setAttribute('aria-expanded', String(now));
    list.hidden = !now;
  });
  node.append(head, list);
  return node;
}

/** @param {string} day @param {ReportTile['lines'][number]} l @param {() => void} changed */
function line(day, l, changed) {
  const li = el('li', { class: 'rline' });
  li.append(l.path ? el('a', { class: 'rt', href: l.path, text: l.text }) : el('span', { class: 'rt', text: l.text }));
  const key = `${day}|${l.ledger_id}`;
  const done = () => {
    li.classList.add('undone');
    return el('span', { class: 'rstate', text: 'Undone' });
  };
  if (l.ledger_id && (l.undo === 'undone' || undone.has(key))) li.append(done());
  else if (l.ledger_id && l.undo === 'open') {
    const ledger = l.ledger_id;
    const b = el('button', { type: 'button', class: 'rundo', text: 'Undo', 'aria-label': `Undo: ${l.text}` });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        /** @type {{ status: string }} */
        const r = await signedIn((tok) => api.call(`/v1/ledger/${encodeURIComponent(ledger)}/undo`, { method: 'POST', token: tok, body: {} }));
        if (r?.status === 'queued') b.replaceWith(el('span', { class: 'rstate', text: 'Undoing' }));
        else {
          undone.add(key);
          b.replaceWith(done());
        }
        changed();
      } catch {
        b.disabled = false;
        toast('That didn’t undo. Try again.');
      }
    });
    li.append(b);
  }
  return li;
}
