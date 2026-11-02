// Settings → Account: change password (SIGN-IN.md §9.1, also /settings/password/ for the
// browser's change-password link) and signing out this device. The hidden username lets the
// password manager update the right entry.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { store } from '/th/session.js';
import { el, wireShowButtons } from '/th/ui.js';
import { signOutAsking } from './settings.js';
import { group, icon, row, switchRow } from './components.js';

/** @param {HTMLElement} body */
export async function account(body) {
  const session = await store.read();
  const user = el('input', { id: 'username', name: 'username', type: 'text', autocomplete: 'username', value: session?.username ?? '', class: 'sr field', tabindex: '-1', 'aria-hidden': 'true' });
  const cur = el('input', { class: 'field', id: 'current-password', name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
  const next = el('input', { class: 'field', id: 'new-password', name: 'new-password', type: 'password', autocomplete: 'new-password', required: '' });
  let signOutOthers = true;
  const others = switchRow('Sign out all other devices', 'devices', true, (on) => { signOutOthers = on; });
  others.id = 'sign-out-others';
  const go = el('button', { type: 'submit', class: 'btn', text: 'Change password' });
  const line = el('p', { class: 'line', role: 'status' });
  const form = el('form', { class: 'sform', id: 'password', method: 'post', action: '/settings/password/', novalidate: '' }, [
    el('h2', { class: 'group-title', text: 'Change password' }),
    el('div', { class: 'group' }, [user,
    el('div', { class: 'fld' }, [el('label', { for: 'current-password', text: 'Current password' }), cur]),
    el('div', { class: 'fld' }, [
      el('label', { for: 'new-password', text: 'New password' }),
      el('div', { class: 'inp' }, [next, el('button', { type: 'button', class: 'btn quiet inline show', 'aria-pressed': 'false', 'aria-label': 'Show password as plain text. Warning: this will display your password on the screen.', text: 'Show' })]),
      el('span', { class: 'help', text: 'At least 15 characters. A long phrase works well, or let your password manager make one.' }),
    ]),
    others]),
    go, line,
  ]);
  const out = row({ title: 'Sign out of this device', icon: 'devices' });
  out.addEventListener('click', () => signOutAsking());
  // MIGRATION.md §5.3: the phone's app data from the old site's /export/ page.
  const bring = el('a', { class: 'row', href: '/import/' }, [icon('download-simple'), el('span', { class: 'row-copy' }, [el('span', { class: 'row-title', text: 'Bring data from the old site' })])]);
  body.replaceChildren(form, group('This phone', [bring, out]));
  wireShowButtons(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (go.disabled) return;
    go.disabled = true;
    line.textContent = '';
    try {
      const r = await signedIn((t) => api.password(t, { current_password: cur.value, new_password: next.value, sign_out_others: signOutOthers }));
      if (r?.token && session) await store.write({ ...session, token: r.token });
      if ('PasswordCredential' in window && session?.username) {
        try { await navigator.credentials.store(new window.PasswordCredential({ id: session.username, password: next.value })); } catch {}
      }
      form.replaceChildren(el('h2', { class: 'group-title', text: 'Change password' }), el('p', { class: 'line ok', role: 'status', text: 'Password changed.' }));
    } catch (err) {
      go.disabled = false;
      line.textContent = lineFor(failure(err));
    }
  });
  if (!session?.username) cur.focus({ preventScroll: true });
}
