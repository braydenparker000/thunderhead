// Settings → Account: change password (SIGN-IN.md §9.1, also /settings/password/ for the
// browser's change-password link) and signing out this device. The hidden username lets the
// password manager update the right entry.
import { api, signedIn, signOutHere } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { store } from '/th/session.js';
import { el, wireShowButtons } from '/th/ui.js';

/** @param {HTMLElement} body */
export async function account(body) {
  const session = await store.read();
  const user = el('input', { id: 'username', name: 'username', type: 'text', autocomplete: 'username', value: session?.username ?? '', class: 'sr', tabindex: '-1', 'aria-hidden': 'true' });
  const cur = el('input', { id: 'current-password', name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
  const next = el('input', { id: 'new-password', name: 'new-password', type: 'password', autocomplete: 'new-password', required: '' });
  const others = el('input', { id: 'sign-out-others', type: 'checkbox' });
  others.checked = true;
  const go = el('button', { type: 'submit', class: 'btn', text: 'Change password' });
  const line = el('p', { class: 'line', role: 'status' });
  const form = el('form', { class: 'sform', id: 'password', method: 'post', action: '/settings/password/', novalidate: '' }, [
    el('h2', { text: 'Change password' }),
    user,
    el('div', { class: 'fld' }, [el('label', { for: 'current-password', text: 'Current password' }), cur]),
    el('div', { class: 'fld' }, [
      el('label', { for: 'new-password', text: 'New password' }),
      el('div', { class: 'inp' }, [next, el('button', { type: 'button', class: 'show', 'aria-pressed': 'false', 'aria-label': 'Show password as plain text. Warning: this will display your password on the screen.', text: 'Show' })]),
      el('span', { class: 'help', text: 'At least 15 characters. A long phrase works well, or let your password manager make one.' }),
    ]),
    el('label', { class: 'check', for: 'sign-out-others' }, [others, 'Sign out all other devices']),
    go, line,
  ]);
  const out = el('button', { type: 'button', class: 'btn soft', text: 'Sign out of this device' });
  out.addEventListener('click', () => signOutHere());
  // MIGRATION.md §5.3: the phone's app data from the old site's /export/ page.
  const bring = el('a', { class: 'btn soft', href: '/import/', text: 'Bring data from the old site' });
  body.replaceChildren(form, el('div', { class: 'sactions' }, [bring, out]));
  wireShowButtons(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (go.disabled) return;
    go.disabled = true;
    line.textContent = '';
    try {
      const r = await signedIn((t) => api.password(t, { current_password: cur.value, new_password: next.value, sign_out_others: others.checked }));
      if (r?.token && session) await store.write({ ...session, token: r.token });
      if ('PasswordCredential' in window && session?.username) {
        try { await navigator.credentials.store(new window.PasswordCredential({ id: session.username, password: next.value })); } catch {}
      }
      form.replaceChildren(el('h2', { text: 'Change password' }), el('p', { class: 'line ok', role: 'status', text: 'Password changed.' }));
    } catch (err) {
      go.disabled = false;
      line.textContent = lineFor(failure(err));
    }
  });
  if (!session?.username) cur.focus({ preventScroll: true });
}
