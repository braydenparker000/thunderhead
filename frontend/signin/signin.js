// /signin/: username + password, the countdown after too many tries, and the reason line after
// a device was signed out (SIGN-IN.md §5, §6.2, §11.2). Works with password-manager autofill.
import { api, configured } from '/th/client.js';
import { LINES, REASON_LINES } from '/th/copy.js';
import { deviceHints } from '/th/device.js';
import { createSignin, safeNext, waitLabel } from '/th/flow.js';
import { store } from '/th/session.js';
import { countdown, el, wireShowButtons } from '/th/ui.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const next = safeNext(q.get('next'));
const form = $('#signin'), user = $('#username'), pass = $('#current-password'), go = $('#go'), line = $('#line'), sr = $('#sr');
const say = (text, ok = false) => { line.textContent = text; line.classList.toggle('ok', ok); sr.textContent = text; };

wireShowButtons();

const reason = q.get('reason');
if (reason && REASON_LINES[reason]) {
  const box = $('#reason');
  box.textContent = REASON_LINES[reason];
  if (['password_changed', 'recovery_used', 'reset_used'].includes(reason))
    box.append(' ', el('a', { href: '/recover/', text: 'Use recovery code' }));
  box.hidden = false;
}

if (!configured) {
  say("Sign-in isn't switched on for this site yet.", true);
  go.disabled = true;
} else {
  const m = createSignin({ api, store, device: deviceHints, online: () => navigator.onLine });
  if ((await m.boot()).state === 'signed_in') location.replace(next);
  else api.authState().then((s) => { if (s.setup === 'open') location.replace('/setup/'); }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (window.top !== window.self || go.disabled) return;
    if (navigator.onLine === false) { say(LINES.offline); return; }
    go.disabled = true;
    go.textContent = 'Signing in…';
    const v = await m.submit({ username: user.value, password: pass.value });
    if (v.state === 'signed_in') {
      if ('PasswordCredential' in window) {
        try { await navigator.credentials.store(new window.PasswordCredential({ id: user.value, password: pass.value })); } catch {}
      }
      location.replace(next);
      return;
    }
    if (v.redirect) { location.replace(v.redirect); return; }
    if (v.state === 'waiting') {
      line.textContent = v.line;
      line.classList.remove('ok');
      countdown(go, sr, () => m.tick(), 'Sign in', v.line.replace(' Wait a moment.', ''), waitLabel);
      return;
    }
    go.disabled = false;
    go.textContent = 'Sign in';
    say(v.line);
    $('#reload').hidden = !v.reload;
    if (v.wrong > 0) { pass.focus(); pass.select(); }
    $('#forgot').classList.toggle('hot', v.wrong >= 3);
  });
  $('#reload').addEventListener('click', () => location.reload());
}
