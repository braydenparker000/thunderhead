// Settings → Agents (SIGN-IN.md §17): the keys the mind, Muse and CI use. A new key needs the
// current password and is shown once, with where it goes; revoking needs only a confirm.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { dMMM, lastUsed, ROLES } from '/th/format.js';
import { confirmSheet, el, toast, tooSoon } from '/th/ui.js';
import { errLine } from './settings.js';

const UNUSED_MS = 90 * 86_400_000;

/** @param {HTMLElement} body @param {{ role?: string }} opts */
export async function agents(body, opts = {}) {
  const list = el('div', { class: 'slist', 'aria-busy': 'true' });
  const add = el('button', { type: 'button', class: 'btn', text: 'New agent key' });
  const sheet = el('div', { class: 'srec' });
  body.replaceChildren(list, add, sheet);

  const load = async () => {
    try {
      const { items } = await signedIn((t) => api.agents(t));
      list.replaceChildren(...(items.length ? items.map((a) => row(a, load)) : [el('p', { class: 'sempty', text: 'No agent keys yet.' })]));
      list.removeAttribute('aria-busy');
      errLine(body, null);
    } catch (e) {
      errLine(body, e);
    }
  };
  add.addEventListener('click', () => newKey(sheet, add, load, opts.role));
  await load();
  if (opts.role && opts.role in ROLES) newKey(sheet, add, load, opts.role);
}

function row(a, reload) {
  const role = ROLES[a.role]?.label ?? a.role;
  const meta = `Made ${dMMM(a.created_at)} on ${a.created_on} · ${lastUsed(a.last_used_at)}${a.last_country ? ` · ${a.last_country}` : ''}`;
  const text = el('div', { class: 'stext' }, [
    el('div', { class: 'st1' }, [el('span', { class: 'sname static', text: a.name }), el('span', { class: 'badge', text: role })]),
    el('div', { class: 'st2', text: meta }),
  ]);
  if (Date.now() - (a.last_used_at ?? a.created_at) > UNUSED_MS) text.append(el('div', { class: 'st2 gold', text: 'Not used for 90 days — revoke?' }));
  const revoke = el('button', { type: 'button', class: 'sbtn', text: 'Revoke' });
  revoke.addEventListener('click', async () => {
    if (tooSoon() || !(await confirmSheet({ title: `Revoke '${a.name}'?`, body: 'Anything using it stops working within a minute.', action: 'Revoke', keep: 'Cancel' }))) return;
    try { await signedIn((t) => api.revokeAgent(t, a.id)); toast('Key revoked'); reload(); } catch (e) { toast(lineFor(failure(e))); }
  });
  return el('div', { class: 'srow' }, [text, revoke]);
}

function newKey(host, add, reload, preset) {
  add.hidden = true;
  const first = preset in ROLES ? preset : 'mind:chat';
  const name = el('input', { id: 'agent-name', name: 'agent-name', maxlength: '32', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', value: ROLES[first].name });
  let named = false;
  name.addEventListener('input', () => { named = true; });
  const roles = el('div', { class: 'sroles', role: 'radiogroup', 'aria-label': 'Role' });
  for (const [value, r] of Object.entries(ROLES)) {
    const input = el('input', { type: 'radio', name: 'role', value, id: `role-${value.replace(':', '-')}` });
    input.checked = value === first;
    input.addEventListener('change', () => { if (!named) name.value = r.name; });
    roles.append(el('label', { class: 'srole', for: input.id }, [input, el('span', {}, [el('b', { text: r.label }), el('small', { text: r.does })])]));
  }
  const pw = el('input', { id: 'current-password', name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
  const go = el('button', { type: 'submit', class: 'btn', text: 'Make key' });
  const cancel = el('button', { type: 'button', class: 'btn soft', text: 'Cancel' });
  const line = el('p', { class: 'line', role: 'status' });
  const form = el('form', { class: 'sform', novalidate: '' }, [
    el('h2', { text: 'New agent key' }),
    el('div', { class: 'fld' }, [el('label', { for: 'agent-name', text: 'Name' }), name]),
    el('div', { class: 'fld' }, [el('span', { class: 'lbl', text: 'Role' }), roles]),
    el('div', { class: 'fld' }, [el('label', { for: 'current-password', text: 'Current password' }), pw]),
    go, cancel, line,
  ]);
  host.replaceChildren(form);
  const close = () => { host.replaceChildren(); add.hidden = false; };
  cancel.addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (tooSoon() || go.disabled) return;
    const role = form.querySelector('input[name="role"]:checked')?.value ?? 'mind:chat';
    go.disabled = true;
    line.textContent = '';
    try {
      const r = await signedIn((t) => api.newAgent(t, { name: name.value.trim(), role, current_password: pw.value }));
      shownOnce(host, r.token, ROLES[role], close);
      reload();
    } catch (err) {
      go.disabled = false;
      line.textContent = lineFor(failure(err));
    }
  });
  name.focus({ preventScroll: true });
}

/** The key, once, with Copy and where it goes. Done clears it from memory and the page. */
function shownOnce(host, token, role, close) {
  let secret = token;
  const box = el('div', { class: 'codebox small', id: 'agent-token', text: secret });
  const copy = el('button', { type: 'button', class: 'btn soft', text: 'Copy' });
  const done = el('button', { type: 'button', class: 'btn', text: 'Done' });
  const goes = el('p', { class: 'shelp' });
  // `name` in backticks reads as code.
  role.goes.split(/(`[^`]+`)/).forEach((part) => goes.append(part.startsWith('`') ? el('code', { text: part.slice(1, -1) }) : part));
  host.replaceChildren(el('div', { class: 'sform' }, [
    el('h2', { text: 'Your new key' }),
    box, el('div', { class: 'row2' }, [copy]), goes,
    el('p', { class: 'shelp strong', text: "You won't see it again." }),
    done,
  ]));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(secret); toast('Copied'); } catch { toast('Select the key and copy it'); }
  });
  done.addEventListener('click', () => { secret = ''; box.textContent = ''; close(); });
  done.focus({ preventScroll: true });
}
