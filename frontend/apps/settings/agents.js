// Settings → Agents (SIGN-IN.md §17): the keys the mind, Muse and CI use. A new key needs the
// current password and is shown once, with where it goes; revoking needs only a confirm.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { dMMM, lastUsed, ROLES } from '/th/format.js';
import { el, toast, tooSoon } from '/th/ui.js';
import { errLine } from './settings.js';
import { confirmSheet, icon, row as choiceRow } from './components.js';

const UNUSED_MS = 90 * 86_400_000;

/** @param {HTMLElement} body @param {{ role?: string }} opts */
export async function agents(body, opts = {}) {
  const list = el('div', { class: 'group slist', 'aria-busy': 'true' });
  const add = el('button', { type: 'button', class: 'btn', text: 'New agent key' });
  const sheet = el('div', { class: 'srec' });
  body.replaceChildren(el('h2', { class: 'group-title', text: 'Agent keys' }), list, add, sheet);

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
  const text = el('div', { class: 'row-copy stext' }, [
    el('div', { class: 'st1' }, [el('span', { class: 'sname static', text: a.name }), el('span', { class: 'badge', text: role })]),
    el('div', { class: 'st2', text: meta }),
  ]);
  if (Date.now() - (a.last_used_at ?? a.created_at) > UNUSED_MS) text.append(el('div', { class: 'st2 gold', text: 'Not used for 90 days — revoke?' }));
  const revoke = el('button', { type: 'button', class: 'btn quiet inline sbtn', text: 'Revoke' });
  revoke.addEventListener('click', async () => {
    if (tooSoon() || !(await confirmSheet({ title: `Revoke '${a.name}'?`, body: 'Anything using it stops working within a minute.', action: 'Revoke', keep: 'Cancel' }))) return;
    try { await signedIn((t) => api.revokeAgent(t, a.id)); toast('Key revoked'); reload(); } catch (e) { toast(lineFor(failure(e))); }
  });
  return el('div', { class: 'row srow' }, [icon('key'), text, revoke]);
}

function newKey(host, add, reload, preset) {
  add.hidden = true;
  const first = preset in ROLES ? preset : 'mind:chat';
  const name = el('input', { class: 'field', id: 'agent-name', name: 'agent-name', maxlength: '32', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', value: ROLES[first].name });
  let named = false;
  name.addEventListener('input', () => { named = true; });
  const roles = el('div', { class: 'group sroles', role: 'radiogroup', 'aria-label': 'Role' });
  for (const [value, r] of Object.entries(ROLES)) {
    const option = choiceRow({ title: r.label, detail: r.does, icon: 'key' });
    option.id = `role-${value.replace(':', '-')}`;
    option.value = value;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(value === first));
    option.tabIndex = value === first ? 0 : -1;
    const check = icon('check'); check.setAttribute('class', 'i row-check'); check.toggleAttribute('hidden', value !== first);
    option.append(check);
    option.addEventListener('click', () => {
      for (const button of roles.querySelectorAll('button')) {
        const selected = button === option;
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.querySelector('.row-check').toggleAttribute('hidden', !selected);
      }
      if (!named) name.value = r.name;
    });
    roles.append(option);
  }
  roles.addEventListener('keydown', (e) => {
    const buttons = [...roles.querySelectorAll('button')];
    const current = buttons.indexOf(document.activeElement);
    const direction = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : direction ? (current + direction + buttons.length) % buttons.length : -1;
    if (index < 0) return;
    e.preventDefault(); buttons[index].click(); buttons[index].focus();
  });
  const pw = el('input', { class: 'field', id: 'current-password', name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
  const go = el('button', { type: 'submit', class: 'btn', text: 'Make key' });
  const cancel = el('button', { type: 'button', class: 'btn soft', text: 'Cancel' });
  const line = el('p', { class: 'line', role: 'status' });
  const form = el('form', { class: 'sform', novalidate: '' }, [
    el('h2', { class: 'group-title', text: 'New agent key' }),
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
    const role = roles.querySelector('button[aria-checked="true"]')?.value ?? 'mind:chat';
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
    el('h2', { class: 'group-title', text: 'Your new key' }),
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
